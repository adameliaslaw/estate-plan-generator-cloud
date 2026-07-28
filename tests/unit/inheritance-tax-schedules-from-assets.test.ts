/**
 * PR 2 of the allocation model — the schedules render from assets, and the duplication dies.
 *
 * The bug these tests exist for, reproduced against the real engine on 2026-07-28: a $500,000
 * house split two ways printed **two Schedule A rows**, same address, same lot, same block, each
 * showing the decedent's interest as $250,000 — asserting the decedent held two half-interests in
 * one house on the schedule that *"goes directly onto the tax waiver"*. A bank account did the
 * same on B-1. Six schedules, one cause.
 *
 * Every assertion below fails against PR 1's code, where `collectScheduleItems` emitted one row
 * per derived bequest. The figures must not move: the row count changes, the totals do not.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, test } from 'vitest';
import { deriveEngineMatter } from '../../functions/src/inheritance-tax/allocations';
import { computeEstate } from '../../functions/src/inheritance-tax/engine';
import { buildITRFormData, buildL9AFormData } from '../../functions/src/inheritance-tax/forms';
import { fillITRPdf } from '../../functions/src/inheritance-tax/forms/it-r-pdf';
import { getRuleSet } from '../../functions/src/inheritance-tax/rules';
import { validateMatter } from '../../functions/src/inheritance-tax/validation';
import type {
  Beneficiary,
  EstateComputation,
  Matter,
  ReviewCheckpoint,
} from '../../functions/src/inheritance-tax/types';

const BLANK = readFileSync(resolve(__dirname, '../../functions/assets/itr-blank.pdf'));
const DOD = '2023-09-18';
const RULES = getRuleSet(DOD);

function person(
  id: string,
  firstName: string,
  lastName: string,
  relationship: Beneficiary['relationship'],
): Beneficiary {
  return {
    id, firstName, lastName,
    address: `${id} Elm St, Trenton, NJ 08600`,
    relationship,
    bequests: [],
  };
}

const CHILD = person('b1', 'Cara', 'Child', 'child');
const SECOND_CHILD = person('b2', 'Colin', 'Child', 'child');
const NIECE = person('b3', 'Nina', 'Niece', 'niece_nephew');

function makeMatter(overrides: Partial<Matter> = {}): Matter {
  return {
    matterId: 'sched-matter',
    createdAt: '2024-01-01T00:00:00.000Z',
    decedent: {
      lastName: 'Gold', firstName: 'Ada', ssn: '999-00-1234',
      dateOfDeath: DOD, countyOfResidence: 'Mercer',
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

/** The reproduction case: one house split two ways, one account split two ways. */
const SPLIT = makeMatter({
  beneficiaries: [CHILD, SECOND_CHILD],
  assets: [
    {
      id: 'a1', type: 'nj_real_property', description: '12 Oak Ave', fairMarketValue: 500_000,
      realPropertyDetails: {
        county: 'Mercer', streetAddress: '12 Oak Ave', lots: '4.02', block: '117',
        municipality: 'Hamilton', ownersAndTitle: 'Ada Gold, sole owner',
        fullMarketValue: 500_000, taxAssessedValue: 480_000,
      },
      allocations: [
        { beneficiaryId: 'b1', fraction: 0.5 },
        { beneficiaryId: 'b2', fraction: 0.5 },
      ],
    },
    {
      id: 'a2', type: 'bank_account', description: 'Chase …4821', fairMarketValue: 40_000,
      accountDetails: { institutionName: 'Chase', accountNumberLast4: '4821' },
      allocations: [
        { beneficiaryId: 'b1', fraction: 0.5 },
        { beneficiaryId: 'b2', fraction: 0.5 },
      ],
    },
  ],
});

const compute = (m: Matter) => computeEstate(deriveEngineMatter(m), RULES);

function approved(matterId: string, computation: EstateComputation): ReviewCheckpoint {
  return {
    checkpointId: 'cp-sched', matterId,
    requestedAt: '2024-08-01T00:00:00.000Z', requestedBy: 'NJ-BAR-1',
    computationSnapshot: computation, status: 'approved',
    reviewedAt: '2024-08-02T00:00:00.000Z', reviewedBy: 'NJ-BAR-2', notes: 'approved',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// One asset, one row
// ═══════════════════════════════════════════════════════════════════════════

describe('a split asset prints once, at the decedent\'s whole interest', () => {
  test('the $500,000 house is ONE Schedule A row at $500,000, not two at $250,000', () => {
    const snapshot = compute(SPLIT).formSnapshot;
    expect(snapshot?.scheduleA).toHaveLength(1);
    expect(snapshot?.scheduleA[0]?.fairMarketValue).toBe(500_000);
    expect(snapshot?.scheduleA[0]?.id).toBe('a1');
  });

  test('the split account is ONE B-1 row at $40,000', () => {
    const snapshot = compute(SPLIT).formSnapshot;
    expect(snapshot?.scheduleB1).toHaveLength(1);
    expect(snapshot?.scheduleB1[0]?.fairMarketValue).toBe(40_000);
  });

  test('the row carries the property\'s columns once — one lot, one block, one address', () => {
    const row = compute(SPLIT).formSnapshot?.scheduleA[0];
    expect(row?.realPropertyDetails?.lots).toBe('4.02');
    expect(row?.realPropertyDetails?.block).toBe('117');
    expect(row?.description).toBe('12 Oak Ave');
  });

  test('no figure moved: gross estate and the schedule totals are unchanged', () => {
    const c = compute(SPLIT);
    expect(c.grossEstate).toBe(540_000);
    const total = (rows: ReadonlyArray<{ fairMarketValue: number }> | undefined) =>
      (rows ?? []).reduce((s, r) => s + r.fairMarketValue, 0);
    expect(total(c.formSnapshot?.scheduleA)).toBe(500_000);
    expect(total(c.formSnapshot?.scheduleB1)).toBe(40_000);
    // Each child still takes half of each asset — the tax is computed from the allocations,
    // not from the rows.
    expect(c.beneficiaryResults.map((r) => r.totalBequeathed)).toEqual([270_000, 270_000]);
  });

  test('the schedules still reconcile to the Summary Page lines they feed', () => {
    const c = compute(SPLIT);
    const formData = buildITRFormData(deriveEngineMatter(SPLIT), approved(SPLIT.matterId, {
      ...c, computedAt: '2024-08-01T00:00:00.000Z',
    } as EstateComputation));
    expect(formData.line1_njRealProperty).toBe(500_000);
    expect(formData.line3_allOtherPersonalProperty).toBe(40_000);
    expect(formData.line5_grossEstate).toBe(540_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The beneficiary column — ours, not the State's, so it must stay readable
// ═══════════════════════════════════════════════════════════════════════════

describe('the workpaper names who takes the asset', () => {
  test('a split asset names both takers with their shares, so the split is still visible', () => {
    expect(compute(SPLIT).formSnapshot?.scheduleA[0]?.beneficiaryName)
      .toBe('Cara Child (50%), Colin Child (50%)');
  });

  test('a whole asset to one person is still a plain name', () => {
    const m = makeMatter({
      beneficiaries: [CHILD],
      assets: [{
        id: 'a1', type: 'nj_real_property', description: '12 Oak Ave', fairMarketValue: 400_000,
        allocations: [{ beneficiaryId: 'b1', fraction: 1 }],
      }],
    });
    expect(compute(m).formSnapshot?.scheduleA[0]?.beneficiaryName).toBe('Cara Child');
  });

  test('an asset falling wholly into residue is named for the residue, not for nobody', () => {
    const m = makeMatter({
      beneficiaries: [CHILD, NIECE],
      assets: [{ id: 'a1', type: 'bank_account', description: 'Chase …4821', fairMarketValue: 100_000 }],
      residuary: [
        { beneficiaryId: 'b1', fraction: 0.75 },
        { beneficiaryId: 'b3', fraction: 0.25 },
      ],
    });
    expect(compute(m).formSnapshot?.scheduleB1[0]?.beneficiaryName).toBe('Residuary estate');
    expect(compute(m).formSnapshot?.scheduleB1).toHaveLength(1);
  });

  test('part specific, part residue names both, and a third reads as 33.3333%', () => {
    const m = makeMatter({
      beneficiaries: [CHILD, NIECE],
      assets: [{
        id: 'a1', type: 'bank_account', description: 'Chase …4821', fairMarketValue: 120_000,
        allocations: [{ beneficiaryId: 'b3', fraction: 1 / 3 }],
      }],
      residuary: [{ beneficiaryId: 'b1', fraction: 1 }],
    });
    expect(compute(m).formSnapshot?.scheduleB1[0]?.beneficiaryName)
      .toBe('Nina Niece (33.3333%), Residuary estate (66.6667%)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Read it back out of the State's own booklet
// ═══════════════════════════════════════════════════════════════════════════

describe('the filled IT-R carries one property block, not two', () => {
  async function fill() {
    const derived = deriveEngineMatter(SPLIT);
    const c = computeEstate(derived, RULES);
    const formData = buildITRFormData(derived, approved(SPLIT.matterId, {
      ...c, computedAt: '2024-08-01T00:00:00.000Z',
    } as EstateComputation));
    const filled = await fillITRPdf(formData, new Uint8Array(BLANK));
    return (await PDFDocument.load(filled)).getForm();
  }

  const D_COLUMN = (n: 1 | 2) =>
    `D Value of Decedents Interest Not including mortgage balances${n} New Jersey County Fractional or percent interest Street address with number unit Lots Block Municipality Owners namesProperty Title Check if there is a mortgage lien against this property reported on Schedule D`;

  test('the first property block holds the whole house, and the second is empty', async () => {
    const form = await fill();
    expect(form.getTextField('Street address with number unit').getText()).toBe('12 Oak Ave');
    expect(form.getTextField(D_COLUMN(1)).getText()).toBe('500,000.00');
    // The proof the duplicate row is gone: before PR 2 this second block held the other $250,000.
    expect(form.getTextField('New Jersey County_2').getText()).toBeFalsy();
    expect(form.getTextField(D_COLUMN(2)).getText()).toBeFalsy();
  });

  test('column (C) is the whole property and (D) the decedent\'s interest — both $500,000 here', async () => {
    const form = await fill();
    const c = `C Full Market Value at Date of Death1 New Jersey County Fractional or percent interest Street address with number unit Lots Block Municipality Owners namesProperty Title Check if there is a mortgage lien against this property reported on Schedule D`;
    expect(form.getTextField(c).getText()).toBe('500,000.00');
    expect(form.getTextField(D_COLUMN(1)).getText()).toBe('500,000.00');
  });

  test('Summary Page line 1 reads back as the total of column D', async () => {
    const form = await fill();
    expect(form.getTextField('2aa').getText()).toBe('500,000');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The L-9 releases a lien on a parcel — it must not list one parcel twice
// ═══════════════════════════════════════════════════════════════════════════

describe('the L-9 affidavit lists each parcel once', () => {
  // All Class A, no tax due — the L-9's own precondition.
  const CLASS_A_SPLIT = makeMatter({
    matterId: 'l9-matter',
    beneficiaries: [CHILD, SECOND_CHILD],
    assets: [{
      id: 'a1', type: 'nj_real_property', description: '12 Oak Ave', fairMarketValue: 500_000,
      realPropertyDetails: { county: 'Mercer', lots: '4.02', block: '117', municipality: 'Hamilton' },
      allocations: [
        { beneficiaryId: 'b1', fraction: 0.5 },
        { beneficiaryId: 'b2', fraction: 0.5 },
      ],
    }],
  });

  function l9() {
    const derived = deriveEngineMatter(CLASS_A_SPLIT);
    const c = computeEstate(derived, RULES);
    return buildL9AFormData(derived, approved(CLASS_A_SPLIT.matterId, {
      ...c, computedAt: '2024-08-01T00:00:00.000Z',
    } as EstateComputation));
  }

  test('one parcel, once, at its whole value — a lien is not released twice by halves', () => {
    const data = l9();
    expect(data.realProperties).toHaveLength(1);
    expect(data.realProperties[0]?.fairMarketValue).toBe(500_000);
    expect(data.realProperties[0]?.lots).toBe('4.02');
  });

  test('each beneficiary\'s interest is stated from their allocation, not left at $0', () => {
    // The affidavit sums each beneficiary's bequests. On an allocation-model matter those are
    // derived — handing it the stored matter would state every interest as $0 and pass the
    // Class A eligibility check vacuously.
    expect(l9().beneficiaries.map((b) => b.interestValue)).toEqual([250_000, 250_000]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Nothing about the legacy path moved
// ═══════════════════════════════════════════════════════════════════════════

describe('a legacy nested matter renders exactly as before', () => {
  const LEGACY = makeMatter({
    beneficiaries: [
      {
        ...CHILD,
        bequests: [
          { id: 'q1', type: 'nj_real_property', description: '12 Oak Ave', fairMarketValue: 250_000 },
          { id: 'q3', type: 'bank_account', description: 'Chase …4821', fairMarketValue: 20_000 },
        ],
      },
      {
        ...SECOND_CHILD,
        bequests: [
          { id: 'q2', type: 'nj_real_property', description: '12 Oak Ave', fairMarketValue: 250_000 },
        ],
      },
    ],
  });

  test('it still prints one row per bequest, under each taker\'s own name', () => {
    const snapshot = computeEstate(LEGACY, RULES).formSnapshot;
    expect(snapshot?.scheduleA).toHaveLength(2);
    expect(snapshot?.scheduleA.map((r) => r.beneficiaryName)).toEqual(['Cara Child', 'Colin Child']);
    expect(snapshot?.scheduleA.map((r) => r.id)).toEqual(['q1', 'q2']);
  });

  test('both shapes validate and reach the same gross estate', () => {
    expect(() => validateMatter(LEGACY)).not.toThrow();
    expect(() => validateMatter(SPLIT)).not.toThrow();
    expect(computeEstate(LEGACY, RULES).grossEstate).toBe(520_000);
  });
});
