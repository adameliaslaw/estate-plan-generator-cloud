import { describe, expect, it } from 'vitest';
import { planSeedMatches, seedPairId, type MatchableUnique } from '../src/seed-match.js';
import { ring0Hash, toSigText } from '../src/core/sigtext.js';
import { normalize } from '../src/core/normalize.js';
import type { SeedPiece } from '../src/stages/seed.js';

function piece(overrides: Partial<SeedPiece> & { pieceId: string; text: string }): SeedPiece {
  const { normText } = normalize(overrides.text, []);
  const sigText = toSigText(normText);
  return {
    pieceId: overrides.pieceId,
    seedFileId: overrides.seedFileId ?? 'seedfile1',
    seedFileName: overrides.seedFileName ?? 'AAA WILL PIECES.doc',
    pieceIndex: overrides.pieceIndex ?? 0,
    title: overrides.title ?? null,
    normText,
    sigText,
    ring0Hash: ring0Hash(sigText),
    structureSignal: 'text-grammar',
    canary: overrides.canary ?? false,
    trustRelevant: overrides.trustRelevant ?? true,
    kind: overrides.kind ?? 'clause',
  };
}

function unique(text: string): MatchableUnique {
  const { normText } = normalize(text, []);
  const sigText = toSigText(normText);
  return { ring0Hash: ring0Hash(sigText), sigText, normText };
}

const SPENDTHRIFT =
  'No beneficiary shall have any right or power to anticipate, pledge, assign, sell, transfer, ' +
  'alienate or encumber his or her interest in the trust estate in any way, nor shall any such ' +
  'interest be liable for or subject to the debts, contracts, obligations or liabilities of ' +
  'such beneficiary.';

describe('planSeedMatches — Ring 0 (§11 Gate 1)', () => {
  it('matches an identical clause on the exact signature hash', () => {
    const p = piece({ pieceId: 'p1', text: SPENDTHRIFT });
    const u = unique(SPENDTHRIFT);
    const plan = planSeedMatches([p], [u], new Map([[u.ring0Hash, 'fam_A']]));
    expect(plan.matches).toHaveLength(1);
    expect(plan.matches[0]).toMatchObject({ pieceId: 'p1', familyId: 'fam_A', ring: 0, kind: 'exact' });
    expect(plan.adjudicationCandidates).toHaveLength(0);
  });

  it('ignores commentary pieces entirely', () => {
    const p = piece({ pieceId: 'p1', text: SPENDTHRIFT, kind: 'commentary' });
    const u = unique(SPENDTHRIFT);
    const plan = planSeedMatches([p], [u], new Map([[u.ring0Hash, 'fam_A']]));
    expect(plan.matches).toHaveLength(0);
  });
});

describe('planSeedMatches — Ring 1 (§4.3 diff filter)', () => {
  it('folds case and punctuation into the same signature — no model needed', () => {
    // sigText folds these before hashing, so a library piece and a client
    // clause differing only in typography land on ONE hash. This is the
    // cost shape the design depends on: the common case is free.
    const p = piece({ pieceId: 'p1', text: SPENDTHRIFT });
    const u = unique(SPENDTHRIFT.replace('sell, transfer', 'sell , transfer').toUpperCase());
    expect(u.ring0Hash).toBe(p.ring0Hash);
    const plan = planSeedMatches([p], [u], new Map([[u.ring0Hash, 'fam_A']]));
    expect(plan.adjudicationCandidates).toHaveLength(0);
    expect(plan.matches.map((m) => m.kind)).toEqual(['exact']);
  });

  it('routes a one-word LEGAL difference to adjudication, never to a match', () => {
    // The case the whole checkpoint exists for: "shall" → "may" scores ~0.99
    // on any similarity measure. It must not become a match without a model
    // and a stored transcript.
    const p = piece({ pieceId: 'p1', text: SPENDTHRIFT });
    const u = unique(SPENDTHRIFT.replace('shall have any right', 'may have any right'));
    const plan = planSeedMatches([p], [u], new Map([[u.ring0Hash, 'fam_A']]));
    expect(plan.matches).toHaveLength(0);
    expect(plan.adjudicationCandidates).toHaveLength(1);
    expect(plan.adjudicationCandidates[0].familyId).toBe('fam_A');
  });

  it('proposes at most one family per seed piece', () => {
    const p = piece({ pieceId: 'p1', text: SPENDTHRIFT });
    const near1 = unique(SPENDTHRIFT.replace('in any way', 'in any manner'));
    const near2 = unique(SPENDTHRIFT.replace('in any way', 'in any fashion whatsoever'));
    const plan = planSeedMatches(
      [p],
      [near1, near2],
      new Map([
        [near1.ring0Hash, 'fam_A'],
        [near2.ring0Hash, 'fam_B'],
      ]),
    );
    expect(plan.matches.length + plan.adjudicationCandidates.length).toBe(1);
  });

  it('reports nothing when there is no corpus to match against', () => {
    const p = piece({ pieceId: 'p1', text: SPENDTHRIFT });
    const plan = planSeedMatches([p], [], new Map());
    expect(plan.matches).toHaveLength(0);
    expect(plan.adjudicationCandidates).toHaveLength(0);
  });
});

describe('seedPairId', () => {
  it('is deterministic and filesystem-safe', () => {
    const id = seedPairId('drive-file:12', 'abcdef0123456789');
    expect(id).toBe(seedPairId('drive-file:12', 'abcdef0123456789'));
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
