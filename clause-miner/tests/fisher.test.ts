import { describe, expect, it } from 'vitest';
import {
  benjaminiHochberg,
  fisherExactTwoSided,
  lift,
  logFactorial,
} from '../src/core/fisher.js';

describe('logFactorial', () => {
  it('matches known values', () => {
    expect(logFactorial(0)).toBe(0);
    expect(logFactorial(1)).toBe(0);
    expect(logFactorial(5)).toBeCloseTo(Math.log(120), 12);
    expect(logFactorial(10)).toBeCloseTo(Math.log(3628800), 10);
  });
});

describe('fisherExactTwoSided (§7.3 — checked against known 2×2 values)', () => {
  it("Fisher's tea-tasting table [[3,1],[1,3]] → 34/70 two-sided", () => {
    // Classic value: one-sided 0.242857…, two-sided 0.485714… (= 34/70).
    expect(fisherExactTwoSided({ a: 3, b: 1, c: 1, d: 3 })).toBeCloseTo(34 / 70, 10);
  });

  it('perfect separation [[10,0],[0,10]] → 2/C(20,10)', () => {
    // Both extreme tables have probability 1/184756; two-sided sums them.
    expect(fisherExactTwoSided({ a: 10, b: 0, c: 0, d: 10 })).toBeCloseTo(2 / 184756, 12);
  });

  it('perfect independence [[5,5],[5,5]] → 1', () => {
    expect(fisherExactTwoSided({ a: 5, b: 5, c: 5, d: 5 })).toBeCloseTo(1, 10);
  });

  it('[[1,9],[11,3]] matches the exact BigInt enumeration (p ≈ 0.00275946)', () => {
    // Independently computed with exact integer hypergeometric enumeration.
    expect(fisherExactTwoSided({ a: 1, b: 9, c: 11, d: 3 })).toBeCloseTo(0.0027594561852, 9);
  });

  it('empty table → 1', () => {
    expect(fisherExactTwoSided({ a: 0, b: 0, c: 0, d: 0 })).toBe(1);
  });
});

describe('lift', () => {
  it('computes P(clause|fact)/P(clause|¬fact)', () => {
    // P(clause|fact) = 8/10, P(clause|¬fact) = 2/10 → lift 4.
    expect(lift({ a: 8, b: 2, c: 2, d: 8 })).toBeCloseTo(4, 10);
  });

  it('keeps the zero-denominator edge finite (M9: Infinity JSON-serializes to null)', () => {
    // b = 0: half-count smoothing — pGF 0.5 against 0.5/(0+10+1).
    expect(lift({ a: 5, b: 0, c: 5, d: 10 })).toBeCloseTo(11);
    expect(lift({ a: 0, b: 0, c: 5, d: 10 })).toBe(1);
    expect(Number.isFinite(lift({ a: 10, b: 0, c: 0, d: 40 }))).toBe(true);
  });
});

describe('benjaminiHochberg (§7.3)', () => {
  it('adjusts a hand-computed example with monotonicity', () => {
    // sorted: [.005,.01,.03,.04]; raw adj: [.02,.02,.04,.04]
    const adj = benjaminiHochberg([0.01, 0.04, 0.03, 0.005]);
    expect(adj[0]).toBeCloseTo(0.02, 10); // p=.01 rank2 → .02
    expect(adj[1]).toBeCloseTo(0.04, 10); // p=.04 rank4 → .04
    expect(adj[2]).toBeCloseTo(0.04, 10); // p=.03 rank3 → .04
    expect(adj[3]).toBeCloseTo(0.02, 10); // p=.005 rank1 → min(.02, .02)
  });

  it('caps at 1 and preserves original order', () => {
    const adj = benjaminiHochberg([0.9, 0.95, 0.99]);
    expect(adj.every((p) => p <= 1)).toBe(true);
    expect(adj).toHaveLength(3);
  });

  it('returns [] for an empty grid and identity for m=1', () => {
    expect(benjaminiHochberg([])).toEqual([]);
    expect(benjaminiHochberg([0.03])).toEqual([0.03]);
  });

  it('a uniform grid is unchanged', () => {
    const adj = benjaminiHochberg([0.05, 0.05, 0.05, 0.05]);
    // p*m/rank with monotone floor: every value becomes 0.05 (rank m).
    for (const p of adj) expect(p).toBeCloseTo(0.05, 10);
  });
});
