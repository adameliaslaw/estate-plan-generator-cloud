import { describe, expect, it } from 'vitest';
import {
  buildCardRequest,
  buildStatsGrid,
  eraBandOf,
  isExploratory,
  passesCardGate,
  statsHashOf,
  type StatRow,
  type UnitFacts,
} from '../src/stages/stats.js';
import type { FactVector } from '../src/facts-vocabulary.js';

function facts(overrides: Partial<FactVector> = {}): FactVector {
  return {
    married: 'unknown',
    childCountBand: 'unknown',
    hasMinorChildren: 'unknown',
    blendedFamily: 'unknown',
    specialNeedsBeneficiary: 'unknown',
    charitableBeneficiary: 'unknown',
    businessInterests: 'unknown',
    outOfStateRealProperty: 'unknown',
    trustStructures: [],
    distributionStandard: 'unknown',
    fundedStatus: 'unknown',
    estateSizeBand: 'unknown',
    ...overrides,
  };
}

function unit(id: string, minor: 'true' | 'false' | 'unknown', attorney = 'adams'): UnitFacts {
  return {
    countingUnitId: id,
    matterKey: `m_${id}`,
    attorneyFolder: attorney,
    eraBand: 'post-2012',
    facts: facts({ hasMinorChildren: minor }),
  };
}

describe('eraBandOf', () => {
  it('buckets years and unknowns', () => {
    expect(eraBandOf(2005)).toBe('pre-2013');
    expect(eraBandOf(2013)).toBe('post-2012');
    expect(eraBandOf(null)).toBe('unknown');
  });
});

describe('buildStatsGrid (§7.3)', () => {
  // 40 units: 20 with minor children (18 have the clause), 20 without (2 have it).
  const units: UnitFacts[] = [];
  const present = new Set<string>();
  for (let i = 0; i < 20; i++) {
    units.push(unit(`minor${i}`, 'true', i % 2 === 0 ? 'adams' : 'george'));
    if (i < 18) present.add(`minor${i}`);
  }
  for (let i = 0; i < 20; i++) {
    units.push(unit(`adult${i}`, 'false'));
    if (i < 2) present.add(`adult${i}`);
  }

  it('computes the contingency table over counting units', () => {
    const grid = buildStatsGrid([{ familyId: 'fam1', presentUnits: present }], units);
    const row = grid.primary.find((r) => r.fact === 'hasMinorChildren' && r.value === 'true');
    expect(row).toBeDefined();
    expect(row?.table).toEqual({ a: 18, b: 2, c: 2, d: 18 });
    expect(row?.pGivenFact).toBeCloseTo(0.9);
    expect(row?.pGivenNotFact).toBeCloseTo(0.1);
    expect(row?.lift).toBeCloseTo(9);
    expect(row?.pAdj).not.toBeNull();
  });

  it("excludes 'unknown' fact values from BOTH cells", () => {
    const withUnknowns = [...units, unit('u1', 'unknown'), unit('u2', 'unknown')];
    const grid = buildStatsGrid([{ familyId: 'fam1', presentUnits: present }], withUnknowns);
    const row = grid.primary.find((r) => r.fact === 'hasMinorChildren' && r.value === 'true');
    expect((row?.nFact ?? 0) + (row?.nNotFact ?? 0)).toBe(40); // unknowns absent
  });

  it('computes per-attorney strata for display without pAdj', () => {
    const grid = buildStatsGrid([{ familyId: 'fam1', presentUnits: present }], units);
    const stratum = grid.strata.find(
      (r) => r.stratum === 'attorney:adams' && r.value === 'true',
    );
    expect(stratum).toBeDefined();
    expect(stratum?.pAdj).toBeNull(); // strata never enter the BH grid
  });

  it('applies BH across the whole primary grid', () => {
    const grid = buildStatsGrid([{ familyId: 'fam1', presentUnits: present }], units);
    for (const row of grid.primary) {
      expect(row.pAdj).not.toBeNull();
      expect(row.pAdj as number).toBeGreaterThanOrEqual(row.fisherP);
    }
  });
});

describe('card gate (§7.3: lift ≥2 or ≤0.5, pAdj < 0.01, n ≥ 10)', () => {
  function row(overrides: Partial<StatRow>): StatRow {
    return {
      familyId: 'f',
      fact: 'hasMinorChildren',
      factClass: 'intake',
      value: 'true',
      stratum: 'all',
      table: { a: 18, b: 2, c: 2, d: 18 },
      pGivenFact: 0.9,
      pGivenNotFact: 0.1,
      lift: 9,
      fisherP: 1e-6,
      pAdj: 1e-5,
      nFact: 20,
      nNotFact: 20,
      ...overrides,
    };
  }

  it('passes a strong positive association', () => {
    expect(passesCardGate(row({}))).toBe(true);
  });

  it('passes a strong NEGATIVE association (lift ≤ 0.5)', () => {
    expect(passesCardGate(row({ lift: 0.2 }))).toBe(true);
  });

  it('fails on weak lift, weak pAdj, or thin support', () => {
    expect(passesCardGate(row({ lift: 1.4 }))).toBe(false);
    expect(passesCardGate(row({ pAdj: 0.02 }))).toBe(false);
    expect(passesCardGate(row({ nFact: 9 }))).toBe(false);
    expect(passesCardGate(row({ pAdj: null }))).toBe(false);
  });

  it('exploratory tier: big lift + support but uncorrected significance', () => {
    expect(isExploratory(row({ pAdj: 0.2 }))).toBe(true);
    expect(isExploratory(row({}))).toBe(false); // already significant
    expect(isExploratory(row({ lift: 1.1, pAdj: 0.2 }))).toBe(false);
  });
});

describe('statsHash + card request (§7.4)', () => {
  const rows: StatRow[] = [
    {
      familyId: 'f',
      fact: 'married',
      factClass: 'intake',
      value: 'true',
      stratum: 'all',
      table: { a: 1, b: 2, c: 3, d: 4 },
      pGivenFact: 0.25,
      pGivenNotFact: 0.33,
      lift: 0.75,
      fisherP: 1,
      pAdj: 1,
      nFact: 4,
      nNotFact: 6,
    },
  ];

  it('statsHash pins prose to its evidence', () => {
    expect(statsHashOf(rows)).toBe(statsHashOf([...rows]));
    const tweaked = [{ ...rows[0], lift: 0.76 }];
    expect(statsHashOf(rows)).not.toBe(statsHashOf(tweaked));
  });

  it('opus card request carries only title, rows, and ≤3 snippets', () => {
    const req = buildCardRequest('fam1', 'Spendthrift', 'significant', rows, [], ['s1', 's2', 's3', 's4']);
    expect(req.model).toBe('opus');
    const payload = JSON.parse(req.userText) as { provenanceSnippets: string[] };
    expect(payload.provenanceSnippets).toEqual(['s1', 's2', 's3']);
    expect(req.system).toContain('AT MOST 3 sentences');
  });
});
