import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import {
  buildTriageRequest,
  isPilotDoc,
  parseTriageResult,
  runTriage,
} from '../src/stages/triage.js';
import {
  buildExtractionRequest,
  extractionSystemPrompt,
  parseExtraction,
} from '../src/stages/extract.js';
import { fileDocPath, textPath } from '../src/paths.js';
import type { Env } from '../src/env.js';
import { FakeBatchClient, FakeBlobStore, FakeDocStore, makeEnv } from './helpers/fakes.js';

const env: Env = makeEnv({ gcsBucket: 'b', anthropicApiKey: 'k' });

describe('triage request/parse (Stage 2)', () => {
  it('truncates to ~1,500 tokens of text on haiku', () => {
    const req = buildTriageRequest('d1', 'trust.doc', 'x'.repeat(50_000));
    expect(req.model).toBe('haiku');
    expect(req.userText.length).toBeLessThanOrEqual(config.triage.triageChars + 100);
    expect(req.userText).toContain('File name: trust.doc');
  });

  it('parses categories and trust instrument kinds; garbage → other', () => {
    expect(parseTriageResult({ docCategory: 'trust', instrumentKind: 'restatement', confidence: 0.9 }))
      .toEqual({ docCategory: 'trust', instrumentKind: 'restatement', confidence: 0.9 });
    // Trust with no kind defaults to original.
    expect(parseTriageResult({ docCategory: 'trust', confidence: 0.5 }).instrumentKind).toBe('original');
    // Non-trust docs carry no instrumentKind.
    expect(parseTriageResult({ docCategory: 'will', instrumentKind: 'amendment', confidence: 1 }).instrumentKind).toBeNull();
    expect(parseTriageResult({ docCategory: 'invoiceX', confidence: 1 }).docCategory).toBe('other');
    expect(parseTriageResult(undefined).docCategory).toBe('other');
  });

  it('pilot filter selects trusts only', () => {
    expect(isPilotDoc({ docCategory: 'trust' })).toBe(true);
    expect(isPilotDoc({ docCategory: 'will' })).toBe(false);
    expect(isPilotDoc({})).toBe(false);
  });

  it('runTriage persists classifications and marks failures for review', async () => {
    const store = new FakeDocStore();
    const blobs = new FakeBlobStore();
    await store.set(fileDocPath('firm1', 'run1', 'd1'), { status: 'converted', fileName: 'a.doc' });
    await store.set(fileDocPath('firm1', 'run1', 'd2'), { status: 'converted', fileName: 'b.doc' });
    await blobs.write(textPath('firm1', 'd1'), 'trust text');
    await blobs.write(textPath('firm1', 'd2'), 'other text');
    const batches = new FakeBatchClient((req) =>
      req.customId === 'triage:d1'
        ? { toolInput: { docCategory: 'trust', instrumentKind: 'amendment', confidence: 0.8 } }
        : { ok: false, error: 'errored' },
    );
    const summary = await runTriage({ store, blobs, batches }, env);
    expect(summary.trusts).toBe(1);
    expect(summary.failed).toBe(1);
    expect(store.docs.get(fileDocPath('firm1', 'run1', 'd1'))).toMatchObject({
      docCategory: 'trust',
      instrumentKind: 'amendment',
    });
    expect(store.docs.get(fileDocPath('firm1', 'run1', 'd2'))).toMatchObject({
      docCategory: 'other',
      needs_human_review: true,
    });
  });
});

describe('extraction prompt (Stage 3 — P0.2 few-shots)', () => {
  it('ships three realistic dummy-name few-shots', () => {
    const prompt = extractionSystemPrompt();
    expect(prompt).toContain('JOHN DOE AND MARY DOE REVOCABLE LIVING TRUST');
    expect(prompt).toContain('FIRST AMENDMENT TO THE MARY ROE LIVING TRUST');
    expect(prompt).toContain('AMENDED AND RESTATED DECLARATION OF TRUST');
    // No real client names — dummies only.
    expect(prompt).toMatch(/JOHN DOE|MARY ROE|JOHN SMITH/);
    // The blended-family example teaches the blendedFamily fact.
    expect(prompt).toContain('"blendedFamily":"true"');
  });

  it('builds a sonnet forced-tool request', () => {
    const req = buildExtractionRequest('d1', 'trust text');
    expect(req.model).toBe('sonnet');
    expect(req.tool?.name).toBe('extract_trust_facts');
  });

  it('parses and sanitizes extraction output', () => {
    const parsed = parseExtraction({
      parties: [
        { role: 'GRANTOR_NAME', names: ['JOHN DOE', '  '] },
        { role: 'CHILD_1', names: [] }, // dropped — no names
        { notARole: true },
      ],
      executionDate: '2019-03-14',
      facts: { married: 'true', childCountBand: '2' },
      versionLabel: 'draft',
    });
    expect(parsed.parties).toEqual([{ role: 'GRANTOR_NAME', names: ['JOHN DOE'] }]);
    expect(parsed.executionDate).toBe('2019-03-14');
    expect(parsed.facts.married).toBe('true');
    expect(parsed.facts.fundedStatus).toBe('unknown');
    expect(parsed.versionLabel).toBe('draft');
  });

  it('rejects malformed execution dates (drafts have blank date lines)', () => {
    expect(parseExtraction({ executionDate: 'March 14' }).executionDate).toBeNull();
    expect(parseExtraction({ executionDate: null }).executionDate).toBeNull();
  });
});
