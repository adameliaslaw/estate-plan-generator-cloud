/**
 * Checkpoint-2 C2/M9: two-sided support on both card tiers, and exploratory
 * cards that a reader cannot mistake for findings.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCardRequest,
  EXPLORATORY_PREFIX,
  isExploratory,
  passesCardGate,
  type StatRow,
} from '../src/stages/stats.js';

function row(overrides: Partial<StatRow> = {}): StatRow {
  return {
    familyId: 'fam1',
    fact: 'hasMinorChildren',
    factClass: 'intake',
    value: 'true',
    stratum: 'all',
    table: { a: 14, b: 3, c: 2, d: 38 },
    pGivenFact: 14 / 16,
    pGivenNotFact: 3 / 41,
    lift: 12,
    fisherP: 0.0001,
    pAdj: 0.002,
    nFact: 16,
    nNotFact: 41,
    ...overrides,
  };
}

describe('two-sided support (M9)', () => {
  it('rejects a row with thin nNotFact from BOTH tiers', () => {
    const thin = row({ nNotFact: 7 });
    expect(passesCardGate(thin)).toBe(false);
    expect(isExploratory(thin)).toBe(false);
  });

  it('keeps a well-supported significant row', () => {
    expect(passesCardGate(row())).toBe(true);
  });

  it('keeps a well-supported exploratory row (no pAdj)', () => {
    expect(isExploratory(row({ pAdj: null }))).toBe(true);
  });
});

describe('exploratory disclosure (C2)', () => {
  it('the deterministic prefix says the signal did not pass significance', () => {
    expect(EXPLORATORY_PREFIX).toContain('no correlation');
    expect(EXPLORATORY_PREFIX.toLowerCase()).toContain('exploratory');
  });

  it('the narrator prompt forbids usage-rule phrasing on exploratory cards', () => {
    const req = buildCardRequest('fam1', 'Spendthrift', 'exploratory', [row()], [], []);
    expect(req.system).toContain('did NOT pass');
    const sig = buildCardRequest('fam1', 'Spendthrift', 'significant', [row()], [], []);
    expect(sig.system).not.toContain('did NOT pass');
  });
});
