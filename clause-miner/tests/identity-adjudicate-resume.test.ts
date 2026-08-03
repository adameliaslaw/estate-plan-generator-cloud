/**
 * Paid-batch recovery in adjudicatePairs: batch ids are ledgered before
 * polling but transcripts are written only after, so a crash in between
 * orphans results Anthropic was already paid for. A resume must convert
 * those ledgered batches into transcripts WITHOUT re-submitting the pairs
 * (pilot-1 identity attempt 1 paid ~$94 then died mid-transcript-write;
 * every resume before this fix re-submitted — and re-paid — those pairs).
 */
import { describe, expect, it } from 'vitest';
import { adjudicatePairs, pairId, type IdentityEdge, type IdentitySummary, type UniqueSignature } from '../src/stages/identity.js';
import { adjudicationPath } from '../src/paths.js';
import { FakeBlobStore, FakeDocStore, FakeEmbeddings, makeEnv } from './helpers/fakes.js';
import type { BatchClient, BatchResultItem } from '../src/clients/interfaces.js';

function sig(hash: string, text: string): UniqueSignature {
  return {
    ring0Hash: hash,
    sigText: text,
    normText: text,
    itemSet: null,
    executionBlock: false,
    clusterSeed: true,
    occurrenceCount: 1,
  };
}

function emptySummary(): IdentitySummary {
  return {
    uniqueSignatures: 0, autoMerges: 0, adjudicated: 0, merges: 0,
    separates: 0, normalizationMisses: 0, ring2Proposals: 0, relatedEdges: 0, families: 0,
  };
}

describe('adjudicatePairs ledgered-batch recovery', () => {
  it('replays results from a ledgered batch instead of re-submitting (re-paying)', async () => {
    const env = makeEnv();
    const store = new FakeDocStore();
    const blobs = new FakeBlobStore();
    const a = sig('aaaaaaaaaaaaaaaa', 'the trustee shall have power one');
    const b = sig('bbbbbbbbbbbbbbbb', 'the trustee shall have power two');
    const id = pairId(a.ring0Hash, b.ring0Hash);

    // A prior attempt ledgered this batch before crashing pre-transcript.
    await store.set(`firms/${env.firmId}/clauseMining/${env.runId}`, {
      batches: { 'ring1-adjudication': 'msgbatch_paid' },
    });

    const submitted: string[] = [];
    const batches: BatchClient = {
      async submitBatch(name) {
        submitted.push(name);
        throw new Error('must not submit: results were already paid for');
      },
      async submitBatchChunked(name) {
        submitted.push(name);
        throw new Error('must not submit: results were already paid for');
      },
      async pollBatch(batchId): Promise<BatchResultItem[]> {
        if (batchId !== 'msgbatch_paid') return [];
        return [
          {
            customId: `adj:${id}`,
            ok: true,
            toolInput: { verdict: 'SEPARATE', rationale: 'materially different powers' },
            text: undefined,
            usage: { inputTokens: 10, outputTokens: 5 },
            error: undefined,
          },
        ];
      },
    };

    const edges: IdentityEdge[] = [];
    const summary = emptySummary();
    await adjudicatePairs(
      { store, blobs, batches, embeddings: new FakeEmbeddings() },
      env,
      'ring1-adjudication',
      1,
      [{ a, b, scores: { jaccard: 0.8 } }],
      edges,
      summary,
    );

    expect(submitted).toEqual([]); // zero re-submission = zero re-payment
    expect(summary.adjudicated).toBe(1);
    expect(summary.separates).toBe(1);
    expect(edges).toHaveLength(1);
    expect(edges[0].verdict).toBe('SEPARATE');
    expect(edges[0].merged).toBe(false);
    // The recovered verdict is durably transcribed, so the NEXT resume
    // replays it from the blob without even polling.
    expect(await blobs.exists(adjudicationPath(env.firmId, env.runId, id))).toBe(true);
  });

  it('submits only the pairs the ledgered batches do not cover, under a non-clobbering name', async () => {
    const env = makeEnv();
    const store = new FakeDocStore();
    const blobs = new FakeBlobStore();
    const a = sig('aaaaaaaaaaaaaaaa', 'power of sale one');
    const b = sig('bbbbbbbbbbbbbbbb', 'power of sale two');
    const c = sig('cccccccccccccccc', 'spendthrift provision');
    const coveredId = pairId(a.ring0Hash, b.ring0Hash);

    await store.set(`firms/${env.firmId}/clauseMining/${env.runId}`, {
      batches: { 'ring1-adjudication': 'msgbatch_paid' },
    });

    const submitted: Array<{ name: string; count: number }> = [];
    const batches: BatchClient = {
      async submitBatch() {
        throw new Error('unused');
      },
      async submitBatchChunked(name, requests) {
        submitted.push({ name, count: requests.length });
        return ['msgbatch_new'];
      },
      async pollBatch(batchId): Promise<BatchResultItem[]> {
        if (batchId === 'msgbatch_paid') {
          return [
            {
              customId: `adj:${coveredId}`,
              ok: true,
              toolInput: { verdict: 'MERGE', rationale: 'same clause' },
              text: undefined,
              usage: { inputTokens: 10, outputTokens: 5 },
              error: undefined,
            },
          ];
        }
        return [
          {
            customId: `adj:${pairId(a.ring0Hash, c.ring0Hash)}`,
            ok: true,
            toolInput: { verdict: 'SEPARATE', rationale: 'different function' },
            text: undefined,
            usage: { inputTokens: 10, outputTokens: 5 },
            error: undefined,
          },
        ];
      },
    };

    const edges: IdentityEdge[] = [];
    const summary = emptySummary();
    await adjudicatePairs(
      { store, blobs, batches, embeddings: new FakeEmbeddings() },
      env,
      'ring1-adjudication',
      1,
      [
        { a, b, scores: { jaccard: 0.8 } },
        { a, b: c, scores: { jaccard: 0.7 } },
      ],
      edges,
      summary,
    );

    // Only the uncovered pair went out, and NOT under a name that would
    // overwrite the ledger key the recovery path reads.
    expect(submitted).toEqual([{ name: 'ring1-adjudication-r1', count: 1 }]);
    expect(summary.adjudicated).toBe(2);
    expect(summary.merges).toBe(1);
    expect(summary.separates).toBe(1);
  });
});
