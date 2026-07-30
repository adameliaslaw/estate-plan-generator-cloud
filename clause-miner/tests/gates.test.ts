import { describe, expect, it } from 'vitest';
import {
  gate1Recall,
  gate2Purity,
  gate3Fidelity,
  gate4Canary,
  gate5Roundtrip,
  runGates,
  summarizeGates,
} from '../src/stages/gates.js';
import { canonicalPath, seedFileDocPath, seedMatchPath } from '../src/paths.js';
import { FakeBlobStore, FakeDocStore, makeEnv } from './helpers/fakes.js';
import type { SeedPiece } from '../src/stages/seed.js';
import type { SeedMatch } from '../src/seed-match.js';
import type { CanonicalFamily } from '../src/stages/canonicalize.js';

function piece(id: string, overrides: Partial<SeedPiece> = {}): SeedPiece {
  return {
    pieceId: id,
    seedFileId: 'seed1',
    seedFileName: 'AAA WILL PIECES.doc',
    pieceIndex: Number(id.replace(/\D/g, '')) || 0,
    title: `Piece ${id}`,
    normText: `text ${id}`,
    sigText: `text ${id}`,
    ring0Hash: `hash_${id}`,
    separatorSignal: 'rule',
    canary: false,
    trustRelevant: true,
    kind: 'clause',
    ...overrides,
  };
}

function match(pieceId: string, familyId: string, overrides: Partial<SeedMatch> = {}): SeedMatch {
  return {
    pieceId,
    seedFileId: 'seed1',
    familyId,
    matchedHash: `hash_${pieceId}`,
    ring: 0,
    kind: 'exact',
    scores: {},
    adjudicationRef: null,
    ...overrides,
  };
}

function family(id: string, overrides: Partial<CanonicalFamily> = {}): CanonicalFamily {
  return {
    familyId: id,
    canonicalHash: `c_${id}`,
    canonicalText: 'canonical',
    title: `Family ${id}`,
    functionSummary: '',
    category: 'general',
    switchName: `include_${id}`,
    fillContract: [],
    variants: [],
    countingUnitCount: 5,
    piiScanStatus: 'clean',
    piiFindings: [],
    seedDivergent: false,
    labelError: null,
    executionBlock: false,
    relatedTo: [],
    positionMedian: 0.5,
    ...overrides,
  };
}

describe('Gate 1 — recall', () => {
  it('passes at or above 90% of trust-relevant seed clauses', () => {
    const pieces = Array.from({ length: 10 }, (_, i) => piece(`p${i}`));
    const matches = pieces.slice(0, 9).map((p) => match(p.pieceId, 'fam_A'));
    const result = gate1Recall(pieces, matches);
    expect(result.status).toBe('pass');
    expect(result.value).toBeCloseTo(0.9);
  });

  it('fails below the threshold and names every miss', () => {
    const pieces = Array.from({ length: 10 }, (_, i) => piece(`p${i}`));
    const matches = pieces.slice(0, 8).map((p) => match(p.pieceId, 'fam_A'));
    const result = gate1Recall(pieces, matches);
    expect(result.status).toBe('fail');
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toContain('AAA WILL PIECES.doc');
  });

  it('excludes commentary and non-trust pieces from the denominator', () => {
    const pieces = [
      piece('p1'),
      piece('p2', { kind: 'commentary' }),
      piece('p3', { trustRelevant: false }),
    ];
    const result = gate1Recall(pieces, [match('p1', 'fam_A')]);
    expect(result.value).toBe(1);
    expect(result.detail).toContain('1/1');
  });

  it('excludes canary pieces — Gate 4 measures those', () => {
    const pieces = [piece('p1'), piece('c1', { canary: true })];
    const result = gate1Recall(pieces, [match('p1', 'fam_A')]);
    expect(result.status).toBe('pass');
  });

  it('FAILS on an empty gold set rather than reporting a vacuous pass', () => {
    // 0/0 is not 100%. A gate that greenlights on no evidence is worse than
    // no gate — it launders "we did not check" as "we checked and it's fine".
    const result = gate1Recall([], []);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('nothing to measure');
  });
});

describe('Gate 2 — purity', () => {
  it('passes when distinct curated pieces stay in distinct families', () => {
    const pieces = [piece('p1'), piece('p2')];
    const matches = [match('p1', 'fam_A'), match('p2', 'fam_B')];
    expect(gate2Purity(pieces, matches).status).toBe('pass');
  });

  it('HARD FAILS when two separately-filed pieces merge with no transcript', () => {
    const pieces = [piece('p1'), piece('p2')];
    const matches = [
      match('p1', 'fam_A'),
      // ring-1 trivial merge, no adjudication transcript — the silent merge
      // §11 Gate 2 calls a hard fail.
      match('p2', 'fam_A', { ring: 1, kind: 'trivial', adjudicationRef: null }),
    ];
    const result = gate2Purity(pieces, matches);
    expect(result.status).toBe('fail');
    expect(result.items[0]).toContain('fam_A');
    expect(result.detail).toContain('legal-delta lexicon');
  });

  it('allows a co-landing that carries an adjudication transcript', () => {
    const pieces = [piece('p1'), piece('p2')];
    const matches = [
      match('p1', 'fam_A'),
      match('p2', 'fam_A', { ring: 1, kind: 'adjudicated', adjudicationRef: 'gs://t.json' }),
    ];
    expect(gate2Purity(pieces, matches).status).toBe('pass');
  });

  it('does not flag two EXACT matches — the library repeating itself verbatim', () => {
    const pieces = [piece('p1'), piece('p2')];
    const matches = [match('p1', 'fam_A'), match('p2', 'fam_A')];
    expect(gate2Purity(pieces, matches).status).toBe('pass');
  });
});

describe('Gate 3 — canonical fidelity diagnostic', () => {
  it('passes with a minority of seed-divergent families and reports the median', () => {
    const families = [
      family('f1', { seedEditRatio: 0.95 }),
      family('f2', { seedEditRatio: 0.9 }),
      family('f3', { seedEditRatio: 0.7, seedDivergent: true }),
    ];
    const result = gate3Fidelity(families);
    expect(result.status).toBe('pass');
    expect(result.value).toBeCloseTo(0.9);
    expect(result.items).toHaveLength(1);
  });

  it('fails when divergence exceeds half — that reads as a pipeline defect', () => {
    const families = [
      family('f1', { seedEditRatio: 0.4, seedDivergent: true }),
      family('f2', { seedEditRatio: 0.5, seedDivergent: true }),
      family('f3', { seedEditRatio: 0.95 }),
    ];
    const result = gate3Fidelity(families);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('normalization/clustering defect');
  });

  it('does NOT fail merely because divergence is high on a passing share', () => {
    // Adam's decision #2: the seed is evidence to evaluate, not ground truth.
    // A single badly-diverging family is a review card, not a gate failure.
    const families = [
      family('f1', { seedEditRatio: 0.2, seedDivergent: true }),
      family('f2', { seedEditRatio: 0.99 }),
      family('f3', { seedEditRatio: 0.99 }),
    ];
    expect(gate3Fidelity(families).status).toBe('pass');
  });

  it('ignores families that matched no seed piece', () => {
    expect(gate3Fidelity([family('f1'), family('f2')]).value).toBeNull();
  });
});

describe('Gate 4 — independent-recovery canary', () => {
  const canaryPieces = [
    ...Array.from({ length: 10 }, (_, i) => piece(`c${i}`, { canary: true })),
    piece('p1'),
  ];

  it('passes when the held-out library is re-derived from client documents', () => {
    const matches = canaryPieces
      .filter((p) => p.canary)
      .slice(0, 9)
      .map((p) => match(p.pieceId, 'fam_A'));
    const result = gate4Canary(canaryPieces, matches, true);
    expect(result.status).toBe('pass');
    expect(result.value).toBeCloseTo(0.9);
  });

  it('fails when too little is recovered, naming what was missed', () => {
    const matches = canaryPieces
      .filter((p) => p.canary)
      .slice(0, 5)
      .map((p) => match(p.pieceId, 'fam_A'));
    const result = gate4Canary(canaryPieces, matches, true);
    expect(result.status).toBe('fail');
    expect(result.items).toHaveLength(5);
  });

  it('FAILS when the canary was not actually held out, whatever the recovery rate', () => {
    // 100% "recovery" of a file the pipeline was handed proves nothing. The
    // exclusion is the gate's precondition, so a broken precondition is a
    // failure and not a pass.
    const matches = canaryPieces.filter((p) => p.canary).map((p) => match(p.pieceId, 'fam_A'));
    const result = gate4Canary(canaryPieces, matches, false);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('NOT excluded from corpus input');
  });

  it('fails when there are no canary pieces at all', () => {
    expect(gate4Canary([piece('p1')], [], true).status).toBe('fail');
  });
});

describe('Gate 5 + report summary', () => {
  it('reports the template round-trip as SKIPPED, never as passed', () => {
    const result = gate5Roundtrip();
    expect(result.status).toBe('skipped');
    expect(result.detail).toContain('checkpoint-2');
  });

  it('a skipped gate makes the report incomplete and not passed', () => {
    const report = summarizeGates(
      'run1',
      [gate1Recall([piece('p1')], [match('p1', 'fam_A')]), gate5Roundtrip()],
      '2026-07-30T00:00:00.000Z',
    );
    expect(report.passed).toBe(false);
    expect(report.incomplete).toBe(true);
  });
});

describe('runGates orchestration', () => {
  const env = makeEnv({ canaryFolderIds: ['f-canary'] });

  async function setup(): Promise<{ store: FakeDocStore; blobs: FakeBlobStore }> {
    const store = new FakeDocStore();
    const blobs = new FakeBlobStore();
    await store.set(seedFileDocPath(env.firmId, env.runId, 'canaryfile'), { canary: true });
    const pieces = [
      piece('p1'),
      ...Array.from({ length: 10 }, (_, i) => piece(`c${i}`, { canary: true })),
    ];
    const matches = pieces.map((p) => match(p.pieceId, `fam_${p.pieceId}`));
    await blobs.write(seedMatchPath(env.firmId, env.runId), JSON.stringify({ pieces, matches }));
    await blobs.write(
      canonicalPath(env.firmId, env.runId),
      JSON.stringify([family('fam_p1', { seedEditRatio: 0.95 })]),
    );
    return { store, blobs };
  }

  it('writes the report and the ledger entry', async () => {
    const { store, blobs } = await setup();
    const report = await runGates({ store, blobs }, env);
    expect(report.results.map((r) => r.gate)).toEqual([
      'gate1',
      'gate2',
      'gate3',
      'gate4',
      'gate5',
    ]);
    // Gates 1-4 green; the report is still not "passed" because Gate 5 is
    // checkpoint-2 work that has not been done.
    expect(report.results.slice(0, 4).every((r) => r.status === 'pass')).toBe(true);
    expect(report.passed).toBe(false);
    expect(report.incomplete).toBe(true);
    expect(blobs.blobs.has(`firms/firm1/clause-mining/runs/run1/validation/gates.json`)).toBe(true);
  });

  it('refuses to run without a seed-match artifact rather than passing vacuously', async () => {
    const store = new FakeDocStore();
    const blobs = new FakeBlobStore();
    await expect(runGates({ store, blobs }, env)).rejects.toThrow(/no seed-match artifact/);
  });

  it('fails Gate 4 when no canary row exists in the seed collection', async () => {
    const { blobs } = await setup();
    const store = new FakeDocStore(); // no canary seed rows
    const report = await runGates({ store, blobs }, env);
    const gate4 = report.results.find((r) => r.gate === 'gate4');
    expect(gate4?.status).toBe('fail');
  });
});
