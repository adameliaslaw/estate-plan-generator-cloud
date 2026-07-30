import { describe, expect, it } from 'vitest';
import { matchSeed, seedDivergenceFor, type SeedMatchResult } from '../src/stages/canonicalize.js';
import { seedMatchPath, seedPiecesPath } from '../src/paths.js';
import { normalize } from '../src/core/normalize.js';
import { ring0Hash, toSigText } from '../src/core/sigtext.js';
import { FakeBatchClient, FakeBlobStore, FakeDocStore, makeEnv } from './helpers/fakes.js';
import type { SeedPiece } from '../src/stages/seed.js';
import type { SeedMatch } from '../src/seed-match.js';
import type { Family } from '../src/stages/identity.js';

const env = makeEnv();

const SPENDTHRIFT =
  'No beneficiary shall have any right or power to anticipate, pledge, assign, sell, transfer, ' +
  'alienate or encumber his or her interest in the trust estate in any way, nor shall any such ' +
  'interest be liable for the debts or obligations of such beneficiary.';

function seedPiece(id: string, text: string): SeedPiece {
  const { normText } = normalize(text, []);
  const sigText = toSigText(normText);
  return {
    pieceId: id,
    seedFileId: `file_${id}`,
    seedFileName: 'AAA WILL PIECES.doc',
    pieceIndex: 0,
    title: id,
    normText,
    sigText,
    ring0Hash: ring0Hash(sigText),
    separatorSignal: 'rule',
    canary: false,
    trustRelevant: true,
    kind: 'clause',
  };
}

function hashInfoOf(texts: string[]): Map<string, { normText: string; sigText: string }> {
  const map = new Map<string, { normText: string; sigText: string }>();
  for (const text of texts) {
    const { normText } = normalize(text, []);
    const sigText = toSigText(normText);
    map.set(ring0Hash(sigText), { normText, sigText });
  }
  return map;
}

describe('seedDivergenceFor (§6.2 amended — Adam decision #2)', () => {
  const piece = seedPiece('p1', SPENDTHRIFT);
  const result = (matches: SeedMatch[]): SeedMatchResult => ({
    pieces: [piece],
    matches,
    byFamily: new Map(matches.length > 0 ? [['fam_A', matches]] : []),
  });
  const match: SeedMatch = {
    pieceId: 'p1',
    seedFileId: 'file_p1',
    familyId: 'fam_A',
    matchedHash: 'h',
    ring: 0,
    kind: 'exact',
    scores: {},
    adjudicationRef: null,
  };

  it('does not flag a canonical that closely tracks the curated text', () => {
    const out = seedDivergenceFor(result([match]), 'fam_A', piece.normText);
    expect(out.seedDivergent).toBe(false);
    expect(out.seedEditRatio).toBe(1);
    expect(out.seedSourceFileId).toBe('file_p1');
  });

  it('flags a materially different canonical for side-by-side review', () => {
    const out = seedDivergenceFor(
      result([match]),
      'fam_A',
      'The Trustee shall distribute income annually to my spouse for life.',
    );
    expect(out.seedDivergent).toBe(true);
    expect(out.seedEditRatio).toBeLessThan(0.8);
  });

  it('compares against the CLOSEST matched piece, not the worst', () => {
    // A family can attract more than one curated piece. Measuring against
    // the worst would report divergence that is not there.
    const near = seedPiece('p2', SPENDTHRIFT);
    const far = seedPiece('p3', 'Wholly unrelated guardianship appointment language here.');
    const matches: SeedMatch[] = [
      { ...match, pieceId: 'p2', seedFileId: 'file_p2' },
      { ...match, pieceId: 'p3', seedFileId: 'file_p3' },
    ];
    const out = seedDivergenceFor(
      { pieces: [near, far], matches, byFamily: new Map([['fam_A', matches]]) },
      'fam_A',
      near.normText,
    );
    expect(out.seedDivergent).toBe(false);
    expect(out.seedSourceFileId).toBe('file_p2');
  });

  it('reports nothing for a family no curated piece matched', () => {
    expect(seedDivergenceFor(result([]), 'fam_A', 'anything')).toEqual({ seedDivergent: false });
  });
});

describe('matchSeed', () => {
  const families: Family[] = [
    {
      familyId: 'fam_A',
      memberHashes: [...hashInfoOf([SPENDTHRIFT]).keys()],
      occurrenceCount: 10,
      executionBlock: false,
      relatedTo: [],
    },
  ];

  it('is a no-op when no seed artifact exists — a run can still produce a catalog', async () => {
    const deps = {
      store: new FakeDocStore(),
      blobs: new FakeBlobStore(),
      batches: new FakeBatchClient(() => ({})),
    };
    const out = await matchSeed(deps, env, families, hashInfoOf([SPENDTHRIFT]));
    expect(out.matches).toEqual([]);
    expect(out.pieces).toEqual([]);
  });

  it('matches on the exact hash and writes the artifact the gates read', async () => {
    const blobs = new FakeBlobStore();
    await blobs.write(
      seedPiecesPath(env.firmId, env.runId),
      JSON.stringify([seedPiece('p1', SPENDTHRIFT)]),
    );
    const deps = { store: new FakeDocStore(), blobs, batches: new FakeBatchClient(() => ({})) };
    const out = await matchSeed(deps, env, families, hashInfoOf([SPENDTHRIFT]));

    expect(out.matches).toHaveLength(1);
    expect(out.byFamily.get('fam_A')).toHaveLength(1);
    expect(blobs.blobs.has(seedMatchPath(env.firmId, env.runId))).toBe(true);
  });

  it('counts a SEPARATE verdict as a MISS and stores the transcript anyway', async () => {
    // The adjudicator's refusal is evidence. Gate 1 must see the miss, and
    // Adam must be able to read why — so the transcript is written whichever
    // way the verdict went.
    const blobs = new FakeBlobStore();
    const variant = SPENDTHRIFT.replace('shall have any right', 'may have any right');
    await blobs.write(
      seedPiecesPath(env.firmId, env.runId),
      JSON.stringify([seedPiece('p1', variant)]),
    );
    const batches = new FakeBatchClient(() => ({
      toolInput: { verdict: 'SEPARATE', rationale: 'shall vs may is a legal difference' },
    }));
    const deps = { store: new FakeDocStore(), blobs, batches };
    const out = await matchSeed(deps, env, families, hashInfoOf([SPENDTHRIFT]));

    expect(out.matches).toHaveLength(0);
    expect(batches.submitted[0].name).toBe('seed-match-adjudication');
    const transcripts = [...blobs.blobs.keys()].filter((k) => k.includes('/adjudications/'));
    expect(transcripts).toHaveLength(1);
    expect(blobs.blobs.get(transcripts[0])?.toString()).toContain('SEPARATE');
  });

  it('records a MERGE verdict as an adjudicated match carrying its transcript', async () => {
    const blobs = new FakeBlobStore();
    const variant = SPENDTHRIFT.replace('in any way', 'in any manner whatsoever');
    await blobs.write(
      seedPiecesPath(env.firmId, env.runId),
      JSON.stringify([seedPiece('p1', variant)]),
    );
    const deps = {
      store: new FakeDocStore(),
      blobs,
      batches: new FakeBatchClient(() => ({
        toolInput: { verdict: 'MERGE', rationale: 'same operative effect' },
      })),
    };
    const out = await matchSeed(deps, env, families, hashInfoOf([SPENDTHRIFT]));

    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].kind).toBe('adjudicated');
    // Gate 2 depends on this reference existing — it is what distinguishes a
    // reviewed co-landing from a silent merge.
    expect(out.matches[0].adjudicationRef).not.toBeNull();
  });
});
