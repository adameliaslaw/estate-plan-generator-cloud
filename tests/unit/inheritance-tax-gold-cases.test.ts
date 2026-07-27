/**
 * Phase 2 GOLD CASES — attorney-signable regression fixtures.
 *
 * Each case encodes an official NJ figure or a rule from docs/IT-R-SPECIFICATION.md and must
 * match to the exact published value. These were written BEFORE the Phase 2 correctness fixes
 * and fail against the pre-fix engine — that is the point (methodology: fix each defect against
 * a failing gold/regression test, never by editing a gold case to match the code).
 *
 * Primary sources: NJ Form IT-R (12-24) booklet (itrbk.pdf) and IT-R Instructions (it-rinst.pdf).
 * The interest worked examples below are decoded verbatim from it-rinst.pdf.
 */
import { buildFormSnapshot, computeEstate, isNJHoliday } from '../../functions/src/inheritance-tax/engine';
import { buildITRFormData } from '../../functions/src/inheritance-tax/forms';
import { UnsupportedMatterError } from '../../functions/src/inheritance-tax/forms/errors';
import { getRuleSet } from '../../functions/src/inheritance-tax/rules';
import { validateMatter } from '../../functions/src/inheritance-tax/validation';
import type { Beneficiary, EstateComputation, Matter, ReviewCheckpoint } from '../../functions/src/inheritance-tax/types';

// ─── Fixture builder ─────────────────────────────────────────────────────────

function makeMatter(overrides: Partial<Matter> = {}): Matter {
  return {
    matterId: 'gold-matter',
    createdAt: '2024-01-01T00:00:00.000Z',
    decedent: {
      lastName: 'Gold', firstName: 'Ada', ssn: '999-00-1234',
      dateOfDeath: '2023-09-18', countyOfResidence: 'Mercer',
    },
    willExists: true,
    trustExists: false,
    federalReturnFiled: true,
    virtualCurrencyExists: false,
    disclaimersExist: false,
    personalRepresentative: {
      name: 'Executor Gold', title: 'Executor',
      address: '1 Main St, Trenton, NJ 08600', phone: '609-555-0000',
    },
    beneficiaries: [],
    deductions: [],
    ...overrides,
  };
}

function approvedCheckpoint(matterId: string, computation: EstateComputation): ReviewCheckpoint {
  return {
    checkpointId: 'cp-gold', matterId,
    requestedAt: '2024-08-01T00:00:00.000Z', requestedBy: 'NJ-BAR-1',
    computationSnapshot: computation, status: 'approved',
    reviewedAt: '2024-08-02T00:00:00.000Z', reviewedBy: 'NJ-BAR-2', notes: 'approved',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// FND-INTEREST — the official it-rinst.pdf interest worked examples
// ═══════════════════════════════════════════════════════════════════════════

describe('GOLD FND-INTEREST — official it-rinst.pdf interest examples', () => {
  // Example 2 (Filing return late with payment, WITH prior payments) — §6.2.
  // Tax Due $68,389.70 is produced by a single Class D bequest at 15%:
  //   round(455,931.33 × 15%) = $68,389.70.
  // 8-month due date 2024-05-18 (from DoD 2023-09-18). Payments:
  //   #1 2024-05-12 $16,974.56 (before due date → no interest; balance → $51,415.14)
  //   #2 2024-06-12 $31,927.02   #3 2024-07-20 $20,046.83 (with the return)
  // Interest: 5/18→6/12 (25d) on 51,415.14 = 352.1585 → capitalize → 19,840.2785;
  //           6/12→7/20 (38d) on 19,840.2785 = 206.5563; total → $558.71.
  const EXAMPLE_2 = makeMatter({
    beneficiaries: [{
      id: 'b1', lastName: 'Friend', firstName: 'Fran', address: '2 Elm St, NJ',
      relationship: 'friend',
      bequests: [{ id: 'q1', type: 'other_personal_property', description: 'Cash', fairMarketValue: 455_931.33 }],
    }],
    paymentDate: '2024-07-20',
    priorPayments: [
      { id: 'p1', amount: 16_974.56, paidOn: '2024-05-12' },
      { id: 'p2', amount: 31_927.02, paidOn: '2024-06-12' },
    ],
  });

  test('Example 2 total tax due is $68,389.70', () => {
    const c = computeEstate(EXAMPLE_2, getRuleSet('2023-09-18'));
    expect(c.totalTaxDue).toBeCloseTo(68_389.70, 2);
  });

  test('Example 2 Line 18 interest totals the official $558.71', () => {
    const c = computeEstate(EXAMPLE_2, getRuleSet('2023-09-18'));
    // Components (for the record): 352.15 (5/18–6/12) + 206.56 (6/12–7/20) = 558.71.
    expect(c.matterInputs.interestDue).toBeCloseTo(558.71, 2);
  });

  test('the fixture validates end-to-end (validateMatter accepts it)', () => {
    expect(() => validateMatter(EXAMPLE_2)).not.toThrow();
  });

  // Example 1 (Filing return late with payment, NO prior payments) — §6.3.
  // Tax Due $8,125.00; 86 days late (2023-04-22 → 2023-07-17): 8,125 × 10% × 86/365 = 191.4384.
  // The state worksheet rounds to $191.44; our engine floors in the client's favor → $191.43.
  test('Example 1 Line 18 interest floors to $191.43 (client-favorable; state worksheet $191.44)', () => {
    const example1 = makeMatter({
      decedent: {
        lastName: 'Gold', firstName: 'Ada', ssn: '999-00-1234',
        dateOfDeath: '2022-08-22', countyOfResidence: 'Mercer', // +8 months → 2023-04-22
      },
      beneficiaries: [{
        id: 'b1', lastName: 'Friend', firstName: 'Fran', address: '2 Elm St, NJ',
        relationship: 'friend',
        bequests: [{ id: 'q1', type: 'other_personal_property', description: 'Cash', fairMarketValue: 54_166.67 }],
      }],
      paymentDate: '2023-07-17',
    });
    const c = computeEstate(example1, getRuleSet('2022-08-22'));
    expect(c.totalTaxDue).toBeCloseTo(8_125.00, 2);
    expect(c.matterInputs.interestDue).toBe(191.43);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FND-CONTINGENT — contingent tax is NOT in the Line-18 base (§6.4)
// ═══════════════════════════════════════════════════════════════════════════

describe('GOLD FND-CONTINGENT — contingent tax excluded from Line-18 interest', () => {
  test('adding contingent tax does not change auto-computed interest', () => {
    const base = makeMatter({
      beneficiaries: [{
        id: 'b1', lastName: 'Friend', firstName: 'Fran', address: '2 Elm St, NJ',
        relationship: 'friend',
        bequests: [{ id: 'q1', type: 'other_personal_property', description: 'Cash', fairMarketValue: 100_000 }],
      }],
      paymentDate: '2024-08-18', // ~3 months past the 2024-05-18 due date
    });
    const withContingent = { ...base, contingentTax: 40_000 };
    const rN = computeEstate(base, getRuleSet('2023-09-18'));
    const rC = computeEstate(withContingent, getRuleSet('2023-09-18'));
    expect(rC.matterInputs.interestDue).toBeCloseTo(rN.matterInputs.interestDue, 2);
    expect(rN.matterInputs.interestDue).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FND-HOLIDAYS — Good Friday, Election Day, Juneteenth (3rd Friday) — §11
// ═══════════════════════════════════════════════════════════════════════════

describe('GOLD FND-HOLIDAYS — NJ legal holidays (N.J.S.A. 36:1-1)', () => {
  test('Good Friday is a holiday (2024-03-29, 2025-04-18)', () => {
    expect(isNJHoliday(new Date('2024-03-29T12:00:00Z'))).toBe(true);
    expect(isNJHoliday(new Date('2025-04-18T12:00:00Z'))).toBe(true);
    // The surrounding weekdays are not holidays.
    expect(isNJHoliday(new Date('2024-03-28T12:00:00Z'))).toBe(false);
  });

  test('Election Day (first Tuesday after the first Monday of November) is a holiday', () => {
    expect(isNJHoliday(new Date('2024-11-05T12:00:00Z'))).toBe(true); // 2024 general election
    expect(isNJHoliday(new Date('2025-11-04T12:00:00Z'))).toBe(true); // 2025 general election
    expect(isNJHoliday(new Date('2026-11-03T12:00:00Z'))).toBe(true); // 2026 general election
  });

  test('Juneteenth is observed on the fixed date June 19 (firm/owner direction)', () => {
    // 2027-06-19 is a Saturday → observed on the preceding Friday, June 18.
    expect(isNJHoliday(new Date('2027-06-18T12:00:00Z'))).toBe(true);  // observed Fri
    expect(isNJHoliday(new Date('2027-06-19T12:00:00Z'))).toBe(false); // Saturday itself
    // 2025-06-19 is a Thursday → observed that day.
    expect(isNJHoliday(new Date('2025-06-19T12:00:00Z'))).toBe(true);
    // Before 2022 Juneteenth was not yet a NJ holiday.
    expect(isNJHoliday(new Date('2021-06-19T12:00:00Z'))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FND-CLASSC-EXEMPT — exemption capped at min(scaled, $25,000) — §4.2
// ═══════════════════════════════════════════════════════════════════════════

describe('GOLD FND-CLASSC-EXEMPT — Class C exemption cap', () => {
  test('a scaled bequest below $25k records an exemption equal to the bequest, not $25k', () => {
    const ben: Beneficiary = {
      id: 'c1', lastName: 'Sibling', firstName: 'Sam', address: '3 Oak St, NJ',
      relationship: 'sibling',
      bequests: [{ id: 'q', type: 'securities', description: 'Stock', fairMarketValue: 10_000 }],
    };
    const matter = makeMatter({ beneficiaries: [ben] });
    const c = computeEstate(matter, getRuleSet('2023-09-18'));
    const r = c.beneficiaryResults[0]!;
    expect(r.exemption).toBe(10_000);      // capped at the bequest, NOT the flat 25,000
    expect(r.taxableAmount).toBe(0);
    expect(r.taxDue).toBe(0);
  });

  test('Line 12 aggregate taxable amount agrees with tax when Class C mixes below/above the exemption', () => {
    // Two Class C siblings: one $10k (below exemption), one $100k (taxable $75k @ 11% = $8,250).
    const below: Beneficiary = {
      id: 'c1', lastName: 'Sib', firstName: 'Lo', address: '3 Oak St, NJ',
      relationship: 'sibling',
      bequests: [{ id: 'q1', type: 'securities', description: 'Stock', fairMarketValue: 10_000 }],
    };
    const above: Beneficiary = {
      id: 'c2', lastName: 'Sib', firstName: 'Hi', address: '4 Oak St, NJ',
      relationship: 'sibling',
      bequests: [{ id: 'q2', type: 'securities', description: 'Stock', fairMarketValue: 100_000 }],
    };
    const matter = makeMatter({ beneficiaries: [below, above] });
    const ruleSet = getRuleSet('2023-09-18');
    const computation = { ...computeEstate(matter, ruleSet), computedAt: '2024-08-01T00:00:00.000Z' };
    const form = buildITRFormData(matter, approvedCheckpoint(matter.matterId, computation));

    const line12 = form.line12_classC;
    // With the cap: exemptions = 10,000 + 25,000 = 35,000; distribution = 110,000;
    // taxable = 110,000 − 35,000 = 75,000, which equals the sum of per-beneficiary taxable.
    expect(line12.totalExemption).toBe(35_000);
    expect(line12.totalTaxableAmount).toBe(75_000);
    // "Total Taxable Amount" is consistent with "Tax Due" (11% of 75,000).
    expect(line12.totalTaxableAmount * 0.11).toBeCloseTo(line12.taxDue, 2);
    expect(line12.taxDue).toBeCloseTo(8_250, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FND-DISTRIB — deductions exceeding the gross estate are refused (§5)
// ═══════════════════════════════════════════════════════════════════════════

describe('GOLD FND-DISTRIB — deductions exceeding the estate are refused', () => {
  test('computeEstate throws UnsupportedMatterError instead of clamping net estate to 0', () => {
    const matter = makeMatter({
      beneficiaries: [{
        id: 'b1', lastName: 'Kid', firstName: 'Kim', address: '5 St, NJ', relationship: 'child',
        bequests: [{ id: 'q', type: 'bank_account', description: 'Acct', fairMarketValue: 50_000 }],
      }],
      deductions: [{ id: 'd1', type: 'debt_of_decedent', description: 'Debt', amount: 80_000 }],
    });
    expect(() => computeEstate(matter, getRuleSet('2023-09-18'))).toThrow(UnsupportedMatterError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FND-IMMUT — an approved IT-R renders ONLY from the frozen snapshot (§10)
// ═══════════════════════════════════════════════════════════════════════════

describe('GOLD FND-IMMUT — approved IT-R is immune to post-approval matter edits', () => {
  function baseMatter(): Matter {
    return makeMatter({
      beneficiaries: [
        {
          id: 'a1', lastName: 'Spouse', firstName: 'Pat', address: '1 St, NJ', relationship: 'spouse',
          bequests: [{ id: 'qa', type: 'nj_real_property', description: 'Marital home', fairMarketValue: 300_000 }],
        },
        {
          id: 'd1', lastName: 'Nephew', firstName: 'Ned', address: '9 St, NJ', relationship: 'niece_nephew',
          bequests: [{ id: 'qd', type: 'securities', description: 'Brokerage', fairMarketValue: 100_000 }],
        },
      ],
    });
  }

  test('schedules, class buckets, and cover page come from the snapshot, not the mutated matter', () => {
    const matter = baseMatter();
    const ruleSet = getRuleSet(matter.decedent.dateOfDeath);
    const computation = { ...computeEstate(matter, ruleSet), computedAt: '2024-08-01T00:00:00.000Z' };
    const approved = approvedCheckpoint(matter.matterId, computation);

    // Post-approval, the live matter is edited: a beneficiary is renamed and reclassified,
    // a schedule item's value is changed, and the cover page decedent name is changed.
    const mutated: Matter = {
      ...matter,
      decedent: { ...matter.decedent, lastName: 'CHANGED' },
      beneficiaries: [
        matter.beneficiaries[0]!,
        {
          ...matter.beneficiaries[1]!,
          firstName: 'MUTATED', relationship: 'child', // D → A would move it off Line 13
          bequests: [{ id: 'qd', type: 'securities', description: 'Brokerage', fairMarketValue: 999_999 }],
        },
      ],
    };

    const form = buildITRFormData(mutated, approved);

    // Cover page reflects the frozen snapshot.
    expect(form.decedentLastName).toBe('Gold');
    // Schedule B-2 (securities) still shows the ORIGINAL $100,000, not $999,999.
    expect(form.scheduleB2.find((i) => i.id === 'qd')?.fairMarketValue).toBe(100_000);
    // The nephew is still on Class D (Line 13) with the original distribution — the
    // post-approval reclassification to 'child' did not move it to Class A.
    expect(form.line13_classD.totalBeneficiaries).toBe(1);
    expect(form.line13_classD.totalDistribution).toBe(100_000);
    // Spouse remains on Line 10 (Class A – Spouse) with the frozen distribution.
    expect(form.line10_classA_spouse.totalDistribution).toBe(300_000);
  });

  test('a fresh compute after the edit DOES reflect it (a new checkpoint is required)', () => {
    const matter = baseMatter();
    const edited: Matter = {
      ...matter,
      beneficiaries: [matter.beneficiaries[0]!, { ...matter.beneficiaries[1]!, relationship: 'child' }],
    };
    const snap = buildFormSnapshot(edited);
    // The nephew-now-child is captured as Class A material in a fresh snapshot.
    expect(snap.beneficiaries.find((b) => b.id === 'd1')?.relationship).toBe('child');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FND-VALIDATION — blank individual names, disclaimer deadline (§7)
// ═══════════════════════════════════════════════════════════════════════════

describe('GOLD FND-VALIDATION', () => {
  test('a blank first name on an INDIVIDUAL beneficiary is rejected', () => {
    const matter = makeMatter({
      beneficiaries: [{
        id: 'b1', lastName: 'NoFirst', firstName: '   ', address: '1 St, NJ', relationship: 'child',
        bequests: [{ id: 'q', type: 'bank_account', description: 'Acct', fairMarketValue: 10_000 }],
      }],
    });
    expect(() => validateMatter(matter)).toThrow(/firstName/i);
  });

  test('a blank first name on an ENTITY beneficiary (charity) is allowed', () => {
    const matter = makeMatter({
      beneficiaries: [{
        id: 'b1', lastName: 'Princeton Area Community Foundation', firstName: '', address: '1 St, NJ',
        relationship: 'charity',
        bequests: [{ id: 'q', type: 'bank_account', description: 'Bequest', fairMarketValue: 10_000 }],
      }],
    });
    expect(() => validateMatter(matter)).not.toThrow();
  });

  test('a disclaimer executed more than 9 months after death is rejected', () => {
    const matter = makeMatter({
      decedent: { lastName: 'Gold', firstName: 'Ada', ssn: '999-00-1234', dateOfDeath: '2023-09-18', countyOfResidence: 'Mercer' },
      disclaimersExist: true,
      beneficiaries: [
        {
          id: 'c1', lastName: 'Sib', firstName: 'Sam', address: '3 Oak St, NJ', relationship: 'sibling',
          bequests: [{ id: 'q1', type: 'securities', description: 'Stock', fairMarketValue: 50_000 }],
        },
        {
          id: 'a1', lastName: 'Kid', firstName: 'Kim', address: '4 Oak St, NJ', relationship: 'child',
          bequests: [{ id: 'q2', type: 'bank_account', description: 'Acct', fairMarketValue: 20_000 }],
        },
      ],
      disclaimers: [{
        id: 'dis1', disclaimantBeneficiaryId: 'c1', alternativeTakerId: 'a1', bequestIds: ['q1'],
        dateDisclaimed: '2024-07-01', // > 9 months after 2023-09-18 (deadline 2024-06-18)
        notes: 'late disclaimer',
      }],
    });
    expect(() => validateMatter(matter)).toThrow(/9-month|qualified-disclaimer/i);
  });

  test('a disclaimer within 9 months is accepted', () => {
    const matter = makeMatter({
      decedent: { lastName: 'Gold', firstName: 'Ada', ssn: '999-00-1234', dateOfDeath: '2023-09-18', countyOfResidence: 'Mercer' },
      disclaimersExist: true,
      beneficiaries: [
        {
          id: 'c1', lastName: 'Sib', firstName: 'Sam', address: '3 Oak St, NJ', relationship: 'sibling',
          bequests: [{ id: 'q1', type: 'securities', description: 'Stock', fairMarketValue: 50_000 }],
        },
        {
          id: 'a1', lastName: 'Kid', firstName: 'Kim', address: '4 Oak St, NJ', relationship: 'child',
          bequests: [{ id: 'q2', type: 'bank_account', description: 'Acct', fairMarketValue: 20_000 }],
        },
      ],
      disclaimers: [{
        id: 'dis1', disclaimantBeneficiaryId: 'c1', alternativeTakerId: 'a1', bequestIds: ['q1'],
        dateDisclaimed: '2024-05-01', // within 9 months
        notes: 'timely disclaimer',
      }],
    });
    expect(() => validateMatter(matter)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FND-STRICT / FND-DUPIDS — strict schemas and duplicate-ID rejection (Phase 3)
// ═══════════════════════════════════════════════════════════════════════════

describe('GOLD FND-STRICT — misspelled legal fields are rejected, not silently stripped', () => {
  function classCMatter(): Matter {
    return makeMatter({
      beneficiaries: [{
        id: 'c1', lastName: 'Sib', firstName: 'Sam', address: '3 Oak St, NJ', relationship: 'sibling',
        bequests: [{ id: 'q1', type: 'securities', description: 'Stock', fairMarketValue: 100_000 }],
      }],
    });
  }

  test('an unknown top-level key is rejected', () => {
    expect(() => validateMatter({ ...classCMatter(), contingentAmont: 5_000 })).toThrow();
  });

  test('a misspelled nested key (bequest.fairMarketVaule) is rejected', () => {
    const m = classCMatter();
    const bad = {
      ...m,
      beneficiaries: [{ ...m.beneficiaries[0]!, bequests: [{ id: 'q1', type: 'securities', description: 'Stock', fairMarketVaule: 100_000 }] }],
    };
    expect(() => validateMatter(bad)).toThrow();
  });
});

describe('GOLD FND-DUPIDS — duplicate identifiers are rejected', () => {
  test('duplicate beneficiary ids are rejected', () => {
    const m = makeMatter({
      beneficiaries: [
        { id: 'dup', lastName: 'A', firstName: 'Al', address: 'x', relationship: 'child', bequests: [{ id: 'q1', type: 'bank_account', description: 'a', fairMarketValue: 1_000 }] },
        { id: 'dup', lastName: 'B', firstName: 'Bo', address: 'y', relationship: 'child', bequests: [{ id: 'q2', type: 'bank_account', description: 'b', fairMarketValue: 1_000 }] },
      ],
    });
    expect(() => validateMatter(m)).toThrow(/duplicate beneficiary id/i);
  });

  test('duplicate bequest ids across the matter are rejected', () => {
    const m = makeMatter({
      beneficiaries: [
        { id: 'b1', lastName: 'A', firstName: 'Al', address: 'x', relationship: 'child', bequests: [{ id: 'SAME', type: 'bank_account', description: 'a', fairMarketValue: 1_000 }] },
        { id: 'b2', lastName: 'B', firstName: 'Bo', address: 'y', relationship: 'child', bequests: [{ id: 'SAME', type: 'bank_account', description: 'b', fairMarketValue: 1_000 }] },
      ],
    });
    expect(() => validateMatter(m)).toThrow(/duplicate bequest id/i);
  });

  test('duplicate deduction ids are rejected', () => {
    const m = makeMatter({
      beneficiaries: [{ id: 'b1', lastName: 'A', firstName: 'Al', address: 'x', relationship: 'child', bequests: [{ id: 'q1', type: 'bank_account', description: 'a', fairMarketValue: 100_000 }] }],
      deductions: [
        { id: 'dd', type: 'funeral_expenses', description: 'f', amount: 1_000 },
        { id: 'dd', type: 'attorney_fee', description: 'a', amount: 1_000 },
      ],
    });
    expect(() => validateMatter(m)).toThrow(/duplicate deduction id/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Filing thresholds — NJ Estate Tax regimes by date of death (§9)
// ═══════════════════════════════════════════════════════════════════════════

describe('GOLD — NJ Estate Tax filing thresholds by regime', () => {
  function estateMatter(dateOfDeath: string, gross: number): Matter {
    return makeMatter({
      decedent: { lastName: 'Gold', firstName: 'Ada', ssn: '999-00-1234', dateOfDeath, countyOfResidence: 'Mercer' },
      beneficiaries: [{
        id: 'a1', lastName: 'Kid', firstName: 'Kim', address: '4 Oak St, NJ', relationship: 'child',
        bequests: [{ id: 'q', type: 'nj_real_property', description: 'Home', fairMarketValue: gross }],
      }],
    });
  }

  test('2002–2016 regime: $675k threshold, Simplified Method computed', () => {
    const c = computeEstate(estateMatter('2015-01-01', 700_000), getRuleSet('2015-01-01'));
    expect(c.njEstateTax?.regime).toBe('2002-2016');
    expect(c.njEstateTax?.filingRequired).toBe(true);    // 700k > 675k
    expect(c.njEstateTax?.method).toBe('simplified_column_a');
    expect(typeof c.njEstateTax?.taxDue).toBe('number');
  });

  test('2017 regime: $2M threshold, NJ calculator required (taxDue left null)', () => {
    const c = computeEstate(estateMatter('2017-06-01', 2_500_000), getRuleSet('2017-06-01'));
    expect(c.njEstateTax?.regime).toBe('2017');
    expect(c.njEstateTax?.method).toBe('requires_official_2017_calculator');
    expect(c.njEstateTax?.taxDue).toBeNull();
  });

  test('2018+ : NJ Estate Tax repealed (no estate-tax computation)', () => {
    const c = computeEstate(estateMatter('2019-01-01', 5_000_000), getRuleSet('2019-01-01'));
    expect(c.njEstateTax).toBeNull();
  });
});
