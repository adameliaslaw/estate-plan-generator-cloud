/**
 * Checkpoint-2 remediation step ③ — the free recall/purity levers:
 *  M5 — corpus segments truncate at the first execution paragraph, exactly
 *       like the seed segmenter, so a final article's operative prefix
 *       hashes identically on both sides (seg/4).
 *  C4 — NORMALIZATION_MISS edges are mined into a gazetteer worklist.
 *  M2 — Ring-2 proposals share the maxAdjudicationPairs ceiling.
 */
import { describe, expect, it } from 'vitest';
import { segmentDocument, SEGMENTER_VERSION } from '../src/stages/segment-normalize.js';
import {
  checkRing2Cap,
  mineNormalizationMisses,
  type IdentityEdge,
} from '../src/stages/identity.js';
import { config } from '../src/config.js';
import type { SegmentsReadyFile } from '../src/stages/convert.js';

function para(text: string, styleName: string | null = null): SegmentsReadyFile['paragraphs'][number] {
  return { text, styleName, numbered: false, bold: false } as SegmentsReadyFile['paragraphs'][number];
}

function ready(paragraphs: SegmentsReadyFile['paragraphs']): SegmentsReadyFile {
  return { paragraphs } as SegmentsReadyFile;
}

function segment(paras: SegmentsReadyFile['paragraphs']) {
  return segmentDocument('d', ready(paras), [], 'text/d.txt', 'text-reflowed/d.txt').artifact
    .segments;
}

describe('M5 — execution-tail truncation symmetry (seg/4)', () => {
  const OPERATIVE =
    'I give the residue of my estate to my descendants who survive me, to be divided per capita.';

  it('a signature-tailed final article hashes like its clean twin', () => {
    const tailed = segment([
      para('ARTICLE I', 'Heading1'),
      para(OPERATIVE),
      para('IN WITNESS WHEREOF I have set my hand and seal.'),
    ]);
    const clean = segment([para('ARTICLE I', 'Heading1'), para(OPERATIVE)]);
    expect(tailed).toHaveLength(1);
    expect(tailed[0].ring0Hash).toBe(clean[0].ring0Hash);
    expect(tailed[0].normText).not.toContain('IN WITNESS WHEREOF');
    // Truncation, not execution: the operative prefix is real text.
    expect(tailed[0].executionBlock).toBe(false);
  });

  it('a wholly-execution block keeps its text and its flag', () => {
    const segs = segment([
      para('ARTICLE I', 'Heading1'),
      para(OPERATIVE),
      para('ARTICLE II', 'Heading1'),
      para('IN WITNESS WHEREOF the grantor signs below.'),
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[1].executionBlock).toBe(true);
    expect(segs[1].normText.length).toBeGreaterThan(0);
  });

  it('the version stamp moved to seg/4 so stale rows re-segment', () => {
    expect(SEGMENTER_VERSION).toBe('seg/4');
  });
});

describe('C4 — normalization-miss mining', () => {
  function edge(overrides: Partial<IdentityEdge>): IdentityEdge {
    return {
      a: 'ha', b: 'hb', ring: 1, kind: 'adjudicated', scores: {},
      diff: { changedA: [], changedB: [] },
      adjudicationRef: 'adj/p.json', verdict: 'SEPARATE', merged: false,
      ...overrides,
    };
  }

  it('collects only NORMALIZATION_MISS edges and histograms their tokens', () => {
    const report = mineNormalizationMisses([
      edge({ verdict: 'NORMALIZATION_MISS', diff: { changedA: ['SMITH'], changedB: ['JONES'] } }),
      edge({ a: 'hc', b: 'hd', verdict: 'NORMALIZATION_MISS', diff: { changedA: ['SMITH'], changedB: [] } }),
      edge({ a: 'he', b: 'hf', verdict: 'MERGE', merged: true, diff: { changedA: ['IGNORED'], changedB: [] } }),
      edge({ a: 'hg', b: 'hh', verdict: 'SEPARATE', diff: { changedA: ['ALSO IGNORED'], changedB: [] } }),
    ]);
    expect(report.pairs).toHaveLength(2);
    expect(report.tokenCounts[0]).toEqual({ token: 'SMITH', count: 2 });
    expect(report.tokenCounts.map((t) => t.token)).not.toContain('IGNORED');
  });

  it('returns an empty report when nothing missed', () => {
    const report = mineNormalizationMisses([edge({})]);
    expect(report.pairs).toHaveLength(0);
    expect(report.tokenCounts).toHaveLength(0);
  });
});

describe('M2 — shared Ring-2 adjudication cap', () => {
  it('throws once ring1 + ring2 pairs exceed the ceiling', () => {
    const cap = config.identity.maxAdjudicationPairs;
    expect(() => checkRing2Cap(cap - 1, 1, 10)).not.toThrow();
    expect(() => checkRing2Cap(cap - 1, 2, 10)).toThrow(/ring-2 proposals/);
    expect(() => checkRing2Cap(0, cap + 1, 10)).toThrow(/spend approval/);
  });
});
