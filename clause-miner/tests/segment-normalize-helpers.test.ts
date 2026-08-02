import { describe, expect, it } from 'vitest';
import {
  buildBoundaryRequest,
  computeSpans,
  paragraphStartOffsets,
  runSegmentNormalize,
  segmentDocument,
  SEGMENTER_VERSION,
  verifyBoundaries,
} from '../src/stages/segment-normalize.js';
import { fileDocPath, segmentsReadyPath } from '../src/paths.js';
import { FakeBatchClient, FakeBlobStore, FakeDocStore, makeEnv } from './helpers/fakes.js';
import type { SegmentsReadyFile } from '../src/stages/convert.js';
import type { OoxmlParagraph } from '../src/ooxml.js';

function para(text: string, styleId: string | null = null): OoxmlParagraph {
  return { text, styleId, numIlvl: null, inTable: false, bold: false, centered: false };
}

function ready(paragraphs: OoxmlParagraph[], structureConfidence = 'ooxml'): SegmentsReadyFile {
  return { parserVersion: 'clause-miner-parser/1', structureConfidence: structureConfidence as SegmentsReadyFile['structureConfidence'], paragraphs };
}

describe('paragraphStartOffsets / verifyBoundaries (§4.2 signal 4)', () => {
  const paragraphs = ['ARTICLE I', 'Some body text.', 'ARTICLE II', 'More text.'];

  it('computes join("\\n") offsets', () => {
    expect(paragraphStartOffsets(paragraphs)).toEqual([0, 10, 26, 37]);
  });

  it('accepts offsets that land exactly on paragraph starts', () => {
    const hints = verifyBoundaries(paragraphs, [
      { offset: 0, level: 'article' },
      { offset: 26, level: 'article' },
    ]);
    expect(hints).toEqual([
      { paragraphIndex: 0, level: 'article', signal: 'llm-fallback' },
      { paragraphIndex: 2, level: 'article', signal: 'llm-fallback' },
    ]);
  });

  it('rejects the WHOLE set when any offset misses a paragraph break', () => {
    expect(
      verifyBoundaries(paragraphs, [
        { offset: 0, level: 'article' },
        { offset: 27, level: 'article' }, // mid-paragraph
      ]),
    ).toBeNull();
    expect(verifyBoundaries(paragraphs, [{ offset: 5, level: 'section' }])).toBeNull();
    expect(verifyBoundaries(paragraphs, [{ offset: 0, level: 'chapter' }])).toBeNull();
  });

  it('boundary request targets haiku with offset instructions', () => {
    const req = buildBoundaryRequest('doc1', 'text');
    expect(req.model).toBe('haiku');
    expect(req.customId).toBe('boundary:doc1');
    expect(req.system).toContain('character offset');
  });
});

describe('computeSpans', () => {
  it('assigns advancing, non-overlapping spans', () => {
    const text = 'ARTICLE I\nBody one.\nARTICLE II\nBody two.';
    const spans = computeSpans(text, [
      { articleIndex: 1, sectionIndex: 0, paragraphs: ['ARTICLE I', 'Body one.'], structureSignal: 'text-grammar' },
      { articleIndex: 2, sectionIndex: 0, paragraphs: ['ARTICLE II', 'Body two.'], structureSignal: 'text-grammar' },
    ]);
    expect(spans[0]).toEqual([0, 19]);
    expect(spans[1]).toEqual([20, 40]);
    expect(text.slice(spans[0][0], spans[0][1])).toBe('ARTICLE I\nBody one.');
  });
});

describe('segmentDocument (Stages 4-5 wiring)', () => {
  const gazetteer = [
    { role: 'GRANTOR_NAME', names: ['JOHN DOE'] },
    { role: 'TRUSTEE_1', names: ['RICHARD ROE'] },
  ];

  it('segments, normalizes with the gazetteer, and hashes', () => {
    const result = segmentDocument(
      'doc1',
      ready([
        para('ARTICLE I', 'Heading1'),
        para('JOHN DOE declares this trust and appoints RICHARD ROE for thirty (30) days.'),
        para('ARTICLE II', 'Heading1'),
        para('IN WITNESS WHEREOF the grantor signs below.'),
      ]),
      gazetteer,
      'text/doc1.txt',
      'text-reflowed/doc1.txt',
    );
    expect(result.artifact.reflowed).toBe(false);
    const segments = result.artifact.segments;
    expect(segments.length).toBe(2);
    expect(segments[0].normText).toContain('{{GRANTOR_NAME}}');
    expect(segments[0].normText).toContain('{{TRUSTEE_1}}');
    expect(segments[0].normText).toContain('{{DURATION}}');
    expect(segments[0].parameters.DURATION).toEqual(['thirty (30) days']);
    expect(segments[0].ring0Hash).toMatch(/^[0-9a-f]{64}$/);
    expect(segments[0].structureSignal).toBe('style');
    expect(segments[1].executionBlock).toBe(true);
    expect(result.artifact.textArtifactPath).toBe('text/doc1.txt');
  });

  it('identical values hash identically after typed-placeholder folding (§4.3 Ring 0)', () => {
    const make = (duration: string) =>
      segmentDocument(
        'd',
        ready([para('ARTICLE I', 'Heading1'), para(`Survivorship period of ${duration}.`)]),
        [],
        't',
        'tr',
      ).artifact.segments[0];
    expect(make('thirty (30) days').ring0Hash).toBe(make('sixty (60) days').ring0Hash);
  });

  it('reflows hard-wrapped legacy docs and points spans at the reflowed artifact', () => {
    const lines = [
      'THE JOHN DOE TRUST',
      '',
      'The grantor declares that all of the rest,',
      'residue and remainder of the estate shall',
      'be distributed to the beneficiaries named herein.',
    ];
    const result = segmentDocument(
      'doc2',
      ready(lines.map((l) => para(l)), 'none'),
      [],
      'text/doc2.txt',
      'text-reflowed/doc2.txt',
    );
    expect(result.artifact.reflowed).toBe(true);
    expect(result.reflowedText).not.toBeNull();
    expect(result.artifact.textArtifactPath).toBe('text-reflowed/doc2.txt');
    // The three wrapped lines re-joined into one logical paragraph.
    expect(result.reflowedText).toContain(
      'The grantor declares that all of the rest, residue and remainder',
    );
  });

  it('flags under-segmented documents for the LLM fallback', () => {
    const bigProse = 'word '.repeat(1000).trim() + '.';
    const result = segmentDocument('doc3', ready([para(bigProse)]), [], 't', 'tr');
    expect(result.flags).toContain('needs-llm-fallback');
  });

  it('detects enumerated powers sections and computes item sets', () => {
    const result = segmentDocument(
      'doc4',
      ready([
        para('TRUSTEE POWERS', 'Heading1'),
        para('(a) To sell any property of the trust;'),
        para('(b) To invest and reinvest trust assets;'),
        para('(c) To employ agents and advisors;'),
      ]),
      [],
      't',
      'tr',
    );
    const seg = result.artifact.segments[0];
    expect(seg.itemSet).toHaveLength(3);
  });
});

describe('heading extraction (2026-08-02 — position out of the hash)', () => {
  const CLAUSE =
    'I hereby nominate, constitute and appoint my Executor, hereinafter named, to serve as my ' +
    'Funeral and Disposition Representative, pursuant to P.L. 2003, c. 261. My Representative ' +
    'shall have the authority and power to control the arrangements for my funeral and the ' +
    'disposition of my remains in all respects and without exception.';
  const OTHER =
    'I direct that all my just debts and funeral expenses be paid as soon after my death as is ' +
    'practicable by my Executor hereinafter named, without any order of court whatsoever.';

  it('the same clause under FIRST and under THIRD folds to ONE Ring-0 identity', () => {
    const asFirst = segmentDocument(
      'docA',
      ready([para(`FIRST:  ${CLAUSE}`), para(`SECOND: ${OTHER}`)]),
      [],
      't',
      'tr',
    );
    const asThird = segmentDocument(
      'docB',
      ready([para(`FIRST: ${OTHER}`), para(`THIRD: ${CLAUSE}`)]),
      [],
      't',
      'tr',
    );
    const a = asFirst.artifact.segments.find((s) => s.normText.includes('Disposition'));
    const b = asThird.artifact.segments.find((s) => s.normText.includes('Disposition'));
    expect(a?.heading).toBe('FIRST');
    expect(b?.heading).toBe('THIRD');
    expect(a?.normText).not.toContain('FIRST');
    expect(a?.ring0Hash).toBe(b?.ring0Hash);
  });

  it('a block that is ONLY a heading keeps its text instead of hashing empty', () => {
    const result = segmentDocument(
      'docC',
      ready([para('ARTICLE IV'), para('ARTICLE V'), para(`Section 1. ${CLAUSE}`)]),
      [],
      't',
      'tr',
    );
    for (const seg of result.artifact.segments) {
      expect(seg.normText.trim().length).toBeGreaterThan(0);
    }
  });

  it('ordinals in prose are untouched — only the leading marker is extracted', () => {
    const result = segmentDocument(
      'docD',
      ready([
        para(
          'SECOND: Upon the first anniversary of my death the Trustee shall distribute one half ' +
            'of the principal of the trust estate to my then living descendants, per stirpes.',
        ),
      ]),
      [],
      't',
      'tr',
    );
    const seg = result.artifact.segments[0];
    expect(seg.heading).toBe('SECOND');
    expect(seg.normText).toContain('first anniversary');
  });
});

describe('runSegmentNormalize — version-gated re-runs (seg/2)', () => {
  const LONG =
    'I hereby nominate, constitute and appoint my Executor, hereinafter named, to serve as my ' +
    'Funeral and Disposition Representative, pursuant to P.L. 2003, c. 261. My Representative ' +
    'shall have the authority and power to control the arrangements for my funeral and the ' +
    'disposition of my remains in all respects and without exception whatsoever.';

  async function mkRow(
    store: FakeDocStore,
    blobs: FakeBlobStore,
    id: string,
    segmentation?: Record<string, unknown>,
  ) {
    await store.set(fileDocPath('firm1', 'run1', id), {
      status: segmentation !== undefined ? 'segmented' : 'converted',
      docCategory: 'trust',
      fileName: `${id}.doc`,
      ...(segmentation !== undefined ? { segmentation } : {}),
    });
    await blobs.write(
      segmentsReadyPath('firm1', id),
      JSON.stringify(ready([para(`FIRST: ${LONG}`), para(`SECOND: ${LONG}`)])),
    );
  }

  it('re-processes stale-version rows, skips current ones, still takes converted ones', async () => {
    const store = new FakeDocStore();
    const blobs = new FakeBlobStore();
    const batches = new FakeBatchClient(() => ({}));
    await mkRow(store, blobs, 'stale', { version: 'seg/1', segmentCount: 1 });
    await mkRow(store, blobs, 'current', { version: SEGMENTER_VERSION, segmentCount: 2 });
    await mkRow(store, blobs, 'fresh');

    const summary = await runSegmentNormalize({ store, blobs, batches }, makeEnv());
    expect(summary.segmented).toBe(2); // stale + fresh — NOT the up-to-date row
    expect(summary.skipped).toBe(1);
    const staleRow = await store.get(fileDocPath('firm1', 'run1', 'stale'));
    expect((staleRow?.segmentation as Record<string, unknown>).version).toBe(SEGMENTER_VERSION);
  });
});
