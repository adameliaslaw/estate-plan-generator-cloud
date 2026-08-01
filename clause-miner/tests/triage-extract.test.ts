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

describe('triage resume (a prior execution submitted a batch and died)', () => {
  it('re-polls the ledgered batch instead of resubmitting — no double billing', async () => {
    const store = new FakeDocStore();
    const blobs = new FakeBlobStore();
    await store.set(fileDocPath('firm1', 'run1', 'd1'), { status: 'converted', fileName: 'a.doc' });
    await store.set(fileDocPath('firm1', 'run1', 'd2'), { status: 'converted', fileName: 'b.doc' });
    await blobs.write(textPath('firm1', 'd1'), 'trust text');
    await blobs.write(textPath('firm1', 'd2'), 'will text');

    // First execution: submits, persists the batchId, then "dies" before applying.
    const batches = new FakeBatchClient((req) => ({
      toolInput: {
        docCategory: req.customId === 'triage:d1' ? 'trust' : 'will',
        confidence: 0.9,
      },
    }));
    const firstBatchId = await batches.submitBatch('triage', [
      buildTriageRequest('d1', 'a.doc', 'trust text'),
      buildTriageRequest('d2', 'b.doc', 'will text'),
    ]);
    await store.set('firms/firm1/clauseMining/run1', { batches: { triage: firstBatchId } });

    // Resume: must classify BOTH rows from the prior batch and submit nothing new.
    const summary = await runTriage({ store, blobs, batches }, env);
    expect(summary.classified).toBe(2);
    expect(summary.trusts).toBe(1);
    expect(batches.submitted.filter((s) => s.name === 'triage')).toHaveLength(1); // only the pre-seeded one
    expect(store.docs.get(fileDocPath('firm1', 'run1', 'd1'))).toMatchObject({ docCategory: 'trust' });
    expect(store.docs.get(fileDocPath('firm1', 'run1', 'd2'))).toMatchObject({ docCategory: 'will' });
  });

  it('submits a fresh batch only for rows the prior batch did not cover', async () => {
    const store = new FakeDocStore();
    const blobs = new FakeBlobStore();
    await store.set(fileDocPath('firm1', 'run1', 'd1'), { status: 'converted', fileName: 'a.doc' });
    await store.set(fileDocPath('firm1', 'run1', 'd3'), { status: 'converted', fileName: 'c.doc' });
    await blobs.write(textPath('firm1', 'd1'), 'trust text');
    await blobs.write(textPath('firm1', 'd3'), 'poa text');

    const batches = new FakeBatchClient(() => ({
      toolInput: { docCategory: 'poa', confidence: 0.7 },
    }));
    // Prior batch covered only d1.
    const firstBatchId = await batches.submitBatch('triage', [
      buildTriageRequest('d1', 'a.doc', 'trust text'),
    ]);
    await store.set('firms/firm1/clauseMining/run1', { batches: { triage: firstBatchId } });

    const summary = await runTriage({ store, blobs, batches }, env);
    // d1 from the prior batch, d3 via a new batch containing ONLY d3.
    expect(summary.classified).toBe(2);
    const triageSubmits = batches.submitted.filter((s) => s.name === 'triage');
    expect(triageSubmits).toHaveLength(2);
    expect(triageSubmits[1].requests.map((r) => r.customId)).toEqual(['triage:d3']);
  });
});

describe('extract resume (same shape as triage)', () => {
  it('re-polls the ledgered extract batch instead of resubmitting', async () => {
    const store = new FakeDocStore();
    const blobs = new FakeBlobStore();
    await store.set(fileDocPath('firm1', 'run1', 't1'), {
      status: 'converted', fileName: 'trust.doc', docCategory: 'trust',
    });
    await blobs.write(textPath('firm1', 't1'), 'trust agreement text');

    const batches = new FakeBatchClient(() => ({
      toolInput: { parties: [], facts: {} },
    }));
    const { runExtract } = await import('../src/stages/extract.js');
    const { buildExtractionRequest } = await import('../src/stages/extract.js');
    const priorId = await batches.submitBatch('extract', [
      buildExtractionRequest('t1', 'trust agreement text'),
    ]);
    await store.set('firms/firm1/clauseMining/run1', { batches: { extract: priorId } });

    const summary = await runExtract({ store, blobs, batches }, env);
    expect(summary.extracted).toBe(1);
    expect(batches.submitted.filter((s) => s.name === 'extract')).toHaveLength(1);
  });
});
