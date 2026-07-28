/**
 * The allocation model — assets held by the estate, allocated to beneficiaries.
 *
 * Scope: docs/ASSET-ALLOCATION-MODEL.md, as corrected by the residue scope in HOMEWORK.md.
 * This is PR 1 of three: the model, the derivation, and back-compat. The engine is untouched,
 * and the 25 gold cases must stay green — so the load-bearing test here is the one that runs the
 * SAME estate through both shapes and asserts the figures are identical.
 *
 * The three cases the scope names as acceptance criteria each have a test below:
 *   1. whole asset to one person (today's only case);
 *   2. whole asset into residue, no allocation entry;
 *   3. part specific, part residue.
 */
import {
  deriveEngineMatter,
  normalizeMatterToAssets,
  residuaryPool,
  usesAssetModel,
} from '../../functions/src/inheritance-tax/allocations';
import { computeEstate } from '../../functions/src/inheritance-tax/engine';
import { getRuleSet } from '../../functions/src/inheritance-tax/rules';
import { validateMatter } from '../../functions/src/inheritance-tax/validation';
import type {
  Beneficiary,
  BeneficiaryTaxResult,
  Matter,
} from '../../functions/src/inheritance-tax/types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const DOD = '2023-09-18';
const RULES = getRuleSet(DOD);

function makeMatter(overrides: Partial<Matter> = {}): Matter {
  return {
    matterId: 'alloc-matter',
    createdAt: '2024-01-01T00:00:00.000Z',
    decedent: {
      lastName: 'Alloc', firstName: 'Ada', ssn: '999-00-1234',
      dateOfDeath: DOD, countyOfResidence: 'Mercer',
    },
    willExists: true,
    trustExists: false,
    federalReturnFiled: true,
    virtualCurrencyExists: false,
    disclaimersExist: false,
    personalRepresentative: {
      name: 'Executor Alloc', title: 'Executor',
      address: '1 Main St, Trenton, NJ 08600', phone: '609-555-0000',
    },
    beneficiaries: [],
    deductions: [],
    ...overrides,
  };
}

/** A beneficiary carrying identity only — the allocation model's shape. */
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

const SIBLING = person('b1', 'Sam', 'Sibling', 'sibling');
const NIECE = person('b2', 'Nina', 'Niece', 'niece_nephew');
const CHILD = person('b3', 'Cara', 'Child', 'child');

const compute = (m: Matter) => computeEstate(deriveEngineMatter(m), RULES);

/** The figures — everything a filed return turns on. Ids are deliberately not compared. */
function figures(m: Matter) {
  const c = compute(m);
  return {
    grossEstate: c.grossEstate,
    totalDeductions: c.totalDeductions,
    netEstate: c.netEstate,
    totalTaxDue: c.totalTaxDue,
    perBeneficiary: c.beneficiaryResults.map((r: BeneficiaryTaxResult) => ({
      beneficiaryId: r.beneficiaryId,
      taxClass: r.taxClass,
      totalBequeathed: r.totalBequeathed,
      scaledBequeathed: r.scaledBequeathed,
      exemption: r.exemption,
      taxableAmount: r.taxableAmount,
      taxDue: r.taxDue,
    })),
    scheduleATotal: c.formSnapshot?.scheduleA.reduce((s, i) => s + i.fairMarketValue, 0),
    scheduleB1Total: c.formSnapshot?.scheduleB1.reduce((s, i) => s + i.fairMarketValue, 0),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// The load-bearing test: both shapes, identical figures
// ═══════════════════════════════════════════════════════════════════════════

describe('the same estate in both shapes computes to identical figures', () => {
  // A $500,000 house split two ways, plus a $40,000 account, with deductions so the
  // proportional Line-9 scale is exercised rather than defaulting to 1.
  const NESTED = makeMatter({
    beneficiaries: [
      {
        ...SIBLING,
        bequests: [
          { id: 'q1', type: 'nj_real_property', description: '12 Oak Ave', fairMarketValue: 250_000 },
          { id: 'q3', type: 'bank_account', description: 'Chase …4821', fairMarketValue: 40_000 },
        ],
      },
      {
        ...NIECE,
        bequests: [
          { id: 'q2', type: 'nj_real_property', description: '12 Oak Ave', fairMarketValue: 250_000 },
        ],
      },
    ],
    deductions: [
      { id: 'd1', type: 'funeral_expenses', description: 'Funeral', amount: 12_000 },
    ],
  });

  const ALLOCATED = makeMatter({
    beneficiaries: [SIBLING, NIECE],
    assets: [
      {
        id: 'a1', type: 'nj_real_property', description: '12 Oak Ave', fairMarketValue: 500_000,
        allocations: [
          { beneficiaryId: 'b1', fraction: 0.5 },
          { beneficiaryId: 'b2', fraction: 0.5 },
        ],
      },
      {
        id: 'a2', type: 'bank_account', description: 'Chase …4821', fairMarketValue: 40_000,
        allocations: [{ beneficiaryId: 'b1', fraction: 1 }],
      },
    ],
    deductions: [
      { id: 'd1', type: 'funeral_expenses', description: 'Funeral', amount: 12_000 },
    ],
  });

  test('every figure matches — gross, net, per-beneficiary tax, and total tax due', () => {
    expect(figures(ALLOCATED)).toEqual(figures(NESTED));
  });

  test('both shapes validate', () => {
    expect(() => validateMatter(NESTED)).not.toThrow();
    expect(() => validateMatter(ALLOCATED)).not.toThrow();
  });

  test('the tax is not trivially zero — the comparison has something to prove', () => {
    expect(compute(ALLOCATED).totalTaxDue).toBeGreaterThan(0);
  });

  test('PR 1 does NOT fix the duplicate schedule row — that is PR 2', () => {
    // Stated so the next session knows the derivation deliberately stops short of the
    // schedules: the split house still prints twice, from either shape.
    expect(compute(ALLOCATED).formSnapshot?.scheduleA).toHaveLength(2);
    expect(compute(NESTED).formSnapshot?.scheduleA).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Back-compat: the legacy nested shape round-trips exactly
// ═══════════════════════════════════════════════════════════════════════════

describe('normalizeMatterToAssets → deriveEngineMatter round-trips a legacy matter', () => {
  const LEGACY = makeMatter({
    disclaimersExist: false,
    beneficiaries: [
      {
        ...SIBLING,
        bequests: [
          { id: 'q1', type: 'nj_real_property', description: '12 Oak Ave', fairMarketValue: 310_000,
            realPropertyDetails: { county: 'Mercer', lots: '4.02', block: '117', fullMarketValue: 310_000 } },
          { id: 'q2', type: 'bank_account', description: 'Chase …4821', fairMarketValue: 40_000,
            accountDetails: { institutionName: 'Chase', accountNumberLast4: '4821' } },
        ],
      },
      {
        ...NIECE,
        bequests: [
          { id: 'q3', type: 'securities', description: '100 sh ACME', fairMarketValue: 25_500 },
        ],
      },
    ],
    deductions: [{ id: 'd1', type: 'attorney_fee', description: 'Counsel', amount: 5_000 }],
  });

  test('the whole computation is identical, snapshot and ids included', () => {
    const roundTripped = deriveEngineMatter(normalizeMatterToAssets(LEGACY));
    expect(computeEstate(roundTripped, RULES)).toEqual(computeEstate(LEGACY, RULES));
  });

  test('the normalised matter is one asset per bequest, each wholly allocated', () => {
    const normalized = normalizeMatterToAssets(LEGACY);
    expect(usesAssetModel(normalized)).toBe(true);
    expect(normalized.assets).toHaveLength(3);
    expect(normalized.assets?.map((a) => a.allocations)).toEqual([
      [{ beneficiaryId: 'b1', fraction: 1 }],
      [{ beneficiaryId: 'b1', fraction: 1 }],
      [{ beneficiaryId: 'b2', fraction: 1 }],
    ]);
    expect(normalized.residuary).toEqual([]);
    expect(normalized.beneficiaries.every((b) => b.bequests.length === 0)).toBe(true);
  });

  test('a nested matter passes through deriveEngineMatter untouched', () => {
    expect(deriveEngineMatter(LEGACY)).toBe(LEGACY);
  });

  test('the normalised matter validates', () => {
    expect(() => validateMatter(normalizeMatterToAssets(LEGACY))).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The three cases the scope requires to be expressible
// ═══════════════════════════════════════════════════════════════════════════

describe('the three cases that must be expressible', () => {
  test('1. whole asset to one person', () => {
    const m = makeMatter({
      beneficiaries: [CHILD],
      assets: [{
        id: 'a1', type: 'nj_real_property', description: '12 Oak Ave', fairMarketValue: 400_000,
        allocations: [{ beneficiaryId: 'b3', fraction: 1 }],
      }],
    });
    expect(() => validateMatter(m)).not.toThrow();
    expect(residuaryPool(m)).toBe(0);
    const derived = deriveEngineMatter(m);
    expect(derived.beneficiaries[0]?.bequests).toEqual([
      { id: 'a1', type: 'nj_real_property', description: '12 Oak Ave', fairMarketValue: 400_000 },
    ]);
  });

  test('2. whole asset into residue, with no allocation entry at all', () => {
    const m = makeMatter({
      beneficiaries: [SIBLING, NIECE],
      assets: [{
        id: 'a1', type: 'bank_account', description: 'Chase …4821', fairMarketValue: 100_000,
      }],
      residuary: [
        { beneficiaryId: 'b1', fraction: 0.6 },
        { beneficiaryId: 'b2', fraction: 0.4 },
      ],
    });
    expect(() => validateMatter(m)).not.toThrow();
    expect(residuaryPool(m)).toBe(100_000);
    const derived = deriveEngineMatter(m);
    expect(derived.beneficiaries.map((b) => b.bequests.map((q) => q.fairMarketValue))).toEqual([
      [60_000], [40_000],
    ]);
    // The residue keeps the asset's own type, so it lands on the right schedule.
    expect(derived.beneficiaries[0]?.bequests[0]?.type).toBe('bank_account');
  });

  test('3. part specific, part residue — $50,000 of the Chase account to the niece', () => {
    const m = makeMatter({
      beneficiaries: [SIBLING, NIECE],
      assets: [{
        id: 'a1', type: 'bank_account', description: 'Chase …4821', fairMarketValue: 120_000,
        allocations: [{ beneficiaryId: 'b2', fraction: 50_000 / 120_000 }],
      }],
      residuary: [{ beneficiaryId: 'b1', fraction: 1 }],
    });
    expect(() => validateMatter(m)).not.toThrow();
    expect(residuaryPool(m)).toBe(70_000);
    const derived = deriveEngineMatter(m);
    const byId = new Map(derived.beneficiaries.map((b) => [b.id, b.bequests]));
    expect(byId.get('b2')?.[0]?.fairMarketValue).toBe(50_000);
    expect(byId.get('b1')?.[0]?.fairMarketValue).toBe(70_000);
    // The residuary-derived bequest is marked in its id, so a disclaimer can never name it
    // by accident.
    expect(byId.get('b1')?.[0]?.id).toBe('a1::residue::b1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The arithmetic the attorney no longer does by hand
// ═══════════════════════════════════════════════════════════════════════════

describe('shares are apportioned to the cent', () => {
  const thirds = (value: number) => makeMatter({
    beneficiaries: [SIBLING, NIECE],
    assets: [{
      id: 'a1', type: 'nj_real_property', description: '12 Oak Ave', fairMarketValue: value,
      allocations: [
        { beneficiaryId: 'b1', fraction: 1 / 3 },
        { beneficiaryId: 'b2', fraction: 2 / 3 },
      ],
    }],
  });

  test('a 1/3 : 2/3 split of $500,000 sums to exactly the asset — no cent lost or invented', () => {
    const derived = deriveEngineMatter(thirds(500_000));
    const amounts = derived.beneficiaries.map((b) => b.bequests[0]?.fairMarketValue ?? 0);
    expect(amounts[0]).toBeCloseTo(166_666.67, 2);
    expect(amounts[1]).toBeCloseTo(333_333.33, 2);
    expect(amounts[0] + amounts[1]).toBe(500_000);
    expect(computeEstate(derived, RULES).grossEstate).toBe(500_000);
  });

  test('the gross estate equals the sum of the assets on an awkward value', () => {
    expect(computeEstate(deriveEngineMatter(thirds(500_000.01)), RULES).grossEstate)
      .toBe(500_000.01);
  });

  test('a three-way residue of an odd amount still sums to the pool', () => {
    const m = makeMatter({
      beneficiaries: [SIBLING, NIECE, CHILD],
      assets: [{ id: 'a1', type: 'other_personal_property', description: 'Cash', fairMarketValue: 100_000.01 }],
      residuary: [
        { beneficiaryId: 'b1', fraction: 1 / 3 },
        { beneficiaryId: 'b2', fraction: 1 / 3 },
        { beneficiaryId: 'b3', fraction: 1 / 3 },
      ],
    });
    expect(() => validateMatter(m)).not.toThrow();
    expect(computeEstate(deriveEngineMatter(m), RULES).grossEstate).toBe(100_000.01);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// What the model refuses — the sum-check, and residue's own rules
// ═══════════════════════════════════════════════════════════════════════════

describe('validation of assets, allocations and residue', () => {
  const withAssets = (assets: Matter['assets'], residuary?: Matter['residuary']) =>
    makeMatter({
      beneficiaries: [SIBLING, NIECE],
      assets,
      ...(residuary !== undefined ? { residuary } : {}),
    });

  test('an asset cannot be given away more than once', () => {
    expect(() => validateMatter(withAssets([{
      id: 'a1', type: 'nj_real_property', description: '12 Oak Ave', fairMarketValue: 500_000,
      allocations: [
        { beneficiaryId: 'b1', fraction: 0.6 },
        { beneficiaryId: 'b2', fraction: 0.6 },
      ],
    }]))).toThrow(/cannot be given away more than once/i);
  });

  test('an under-allocated asset needs residuary takers — silence is not an answer', () => {
    expect(() => validateMatter(withAssets([{
      id: 'a1', type: 'nj_real_property', description: '12 Oak Ave', fairMarketValue: 500_000,
      allocations: [{ beneficiaryId: 'b1', fraction: 0.5 }],
    }]))).toThrow(/residuary/i);
  });

  test('residuary shares must total exactly 100% of the residue', () => {
    expect(() => validateMatter(withAssets(
      [{ id: 'a1', type: 'bank_account', description: 'Chase', fairMarketValue: 100_000 }],
      [{ beneficiaryId: 'b1', fraction: 0.6 }, { beneficiaryId: 'b2', fraction: 0.3 }],
    ))).toThrow(/must total exactly/i);
  });

  test('residuary shares are rejected when nothing falls into residue', () => {
    expect(() => validateMatter(withAssets(
      [{
        id: 'a1', type: 'bank_account', description: 'Chase', fairMarketValue: 100_000,
        allocations: [{ beneficiaryId: 'b1', fraction: 1 }],
      }],
      [{ beneficiaryId: 'b2', fraction: 1 }],
    ))).toThrow(/no residue to divide/i);
  });

  test('an allocation must name a beneficiary of this matter', () => {
    expect(() => validateMatter(withAssets([{
      id: 'a1', type: 'bank_account', description: 'Chase', fairMarketValue: 100_000,
      allocations: [{ beneficiaryId: 'ghost', fraction: 1 }],
    }]))).toThrow(/does not reference a beneficiary/i);
  });

  test('the same beneficiary cannot be allocated one asset twice', () => {
    expect(() => validateMatter(withAssets([{
      id: 'a1', type: 'bank_account', description: 'Chase', fairMarketValue: 100_000,
      allocations: [
        { beneficiaryId: 'b1', fraction: 0.5 },
        { beneficiaryId: 'b1', fraction: 0.5 },
      ],
    }]))).toThrow(/allocated this asset twice/i);
  });

  test('duplicate asset ids are rejected', () => {
    expect(() => validateMatter(withAssets([
      { id: 'a1', type: 'bank_account', description: 'Chase', fairMarketValue: 10_000,
        allocations: [{ beneficiaryId: 'b1', fraction: 1 }] },
      { id: 'a1', type: 'bank_account', description: 'PNC', fairMarketValue: 20_000,
        allocations: [{ beneficiaryId: 'b1', fraction: 1 }] },
    ]))).toThrow(/duplicate asset id/i);
  });

  test('the two models cannot be mixed', () => {
    const mixed = makeMatter({
      beneficiaries: [{
        ...SIBLING,
        bequests: [{ id: 'q1', type: 'bank_account', description: 'Chase', fairMarketValue: 10_000 }],
      }],
      assets: [{
        id: 'a1', type: 'bank_account', description: 'PNC', fairMarketValue: 20_000,
        allocations: [{ beneficiaryId: 'b1', fraction: 1 }],
      }],
    });
    expect(() => validateMatter(mixed)).toThrow(/must not also nest bequests/i);
  });

  test('residuary shares without assets are rejected', () => {
    const m = makeMatter({
      beneficiaries: [{
        ...SIBLING,
        bequests: [{ id: 'q1', type: 'bank_account', description: 'Chase', fairMarketValue: 10_000 }],
      }],
      residuary: [{ beneficiaryId: 'b1', fraction: 1 }],
    });
    expect(() => validateMatter(m)).toThrow(/require assets/i);
  });

  test('the nested model still requires every beneficiary to take something', () => {
    expect(() => validateMatter(makeMatter({ beneficiaries: [SIBLING] })))
      .toThrow(/at least one bequest/i);
  });

  test('a share of 0 or more than the whole is rejected outright', () => {
    expect(() => validateMatter(withAssets([{
      id: 'a1', type: 'bank_account', description: 'Chase', fairMarketValue: 100_000,
      allocations: [{ beneficiaryId: 'b1', fraction: 0 }],
    }]))).toThrow(/greater than 0/i);
    expect(() => validateMatter(withAssets([{
      id: 'a1', type: 'bank_account', description: 'Chase', fairMarketValue: 100_000,
      allocations: [{ beneficiaryId: 'b1', fraction: 1.5 }],
    }]))).toThrow(/cannot exceed the whole/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Per stirpes is NOT resolved — the model refuses to accept the instruction
// ═══════════════════════════════════════════════════════════════════════════

describe('per stirpes is not computed', () => {
  test('a residuary share carrying perStirpes is rejected, not ignored', () => {
    // Accepting the flag and quietly not acting on it is the dangerous outcome: the substitute
    // taker can be a DIFFERENT TAX CLASS (a deceased sibling's share moves Class C → Class D),
    // so a silently-ignored perStirpes reads as handled and files a wrong return.
    const m = makeMatter({
      beneficiaries: [SIBLING, NIECE],
      assets: [{ id: 'a1', type: 'bank_account', description: 'Chase', fairMarketValue: 100_000 }],
      residuary: [{ beneficiaryId: 'b1', fraction: 1, perStirpes: true }],
    } as unknown as Partial<Matter>);
    expect(() => validateMatter(m)).toThrow(/unrecognized key/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Residuary takers are not always people
// ═══════════════════════════════════════════════════════════════════════════

describe('a charity can take residue', () => {
  const CHARITY: Beneficiary = {
    id: 'b9', firstName: '', lastName: 'American Red Cross',
    address: '431 18th St NW, Washington, DC 20006',
    relationship: 'charity',
    bequests: [],
  };

  const m = makeMatter({
    beneficiaries: [SIBLING, CHARITY],
    assets: [{ id: 'a1', type: 'bank_account', description: 'Chase …4821', fairMarketValue: 200_000 }],
    residuary: [
      { beneficiaryId: 'b1', fraction: 0.5 },
      { beneficiaryId: 'b9', fraction: 0.5 },
    ],
  });

  test('an entity residuary taker validates and computes as Class E, exempt', () => {
    expect(() => validateMatter(m)).not.toThrow();
    const results = compute(m).beneficiaryResults;
    const charity = results.find((r) => r.beneficiaryId === 'b9');
    expect(charity?.taxClass).toBe('E');
    expect(charity?.totalBequeathed).toBe(100_000);
    expect(charity?.taxDue).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Disclaimers: what can be named, and what is refused by name
// ═══════════════════════════════════════════════════════════════════════════

describe('disclaimers in the allocation model', () => {
  const disclaimed = (assets: Matter['assets'], residuary: Matter['residuary'], bequestIds: string[]) =>
    makeMatter({
      beneficiaries: [SIBLING, NIECE, CHILD],
      assets,
      ...(residuary !== undefined ? { residuary } : {}),
      disclaimersExist: true,
      disclaimers: [{
        id: 'dc1',
        disclaimantBeneficiaryId: 'b1',
        alternativeTakerId: 'b3',
        bequestIds,
        dateDisclaimed: '2023-11-01',
        notes: 'Qualified disclaimer executed within 9 months.',
      }],
    });

  test('an asset given WHOLE can be disclaimed, and reallocates exactly as the nested model does', () => {
    const m = disclaimed(
      [
        { id: 'a1', type: 'bank_account', description: 'Chase', fairMarketValue: 100_000,
          allocations: [{ beneficiaryId: 'b1', fraction: 1 }] },
        { id: 'a2', type: 'securities', description: '100 sh ACME', fairMarketValue: 60_000,
          allocations: [{ beneficiaryId: 'b2', fraction: 1 }] },
      ],
      undefined,
      ['a1'],
    );
    expect(() => validateMatter(m)).not.toThrow();
    const results = compute(m).beneficiaryResults;
    expect(results.find((r) => r.beneficiaryId === 'b1')?.totalBequeathed).toBe(0);
    expect(results.find((r) => r.beneficiaryId === 'b3')?.totalBequeathed).toBe(100_000);
  });

  test('a FRACTIONAL share cannot be disclaimed, and says so', () => {
    const m = disclaimed(
      [{ id: 'a1', type: 'bank_account', description: 'Chase', fairMarketValue: 100_000,
        allocations: [
          { beneficiaryId: 'b1', fraction: 0.5 },
          { beneficiaryId: 'b2', fraction: 0.5 },
        ] }],
      undefined,
      ['a1'],
    );
    expect(() => validateMatter(m)).toThrow(/not given whole/i);
  });

  test('a RESIDUARY share cannot be disclaimed, and the refusal names the tax-class reason', () => {
    const m = disclaimed(
      [{ id: 'a1', type: 'bank_account', description: 'Chase', fairMarketValue: 100_000 }],
      [{ beneficiaryId: 'b1', fraction: 1 }],
      ['a1::residue::b1'],
    );
    expect(() => validateMatter(m)).toThrow(/residuary share has no bequest id/i);
    expect(() => validateMatter(m)).toThrow(/Class C → Class D/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Refuse, never guess
// ═══════════════════════════════════════════════════════════════════════════

describe('derivation refuses a matter that never passed validation', () => {
  test('an asset whose shares do not cover it produces no figure at all', () => {
    // Reachable only by a path that skipped validateMatter — the point is that it throws
    // rather than quietly dropping the unallocated half of a house.
    const m = makeMatter({
      beneficiaries: [SIBLING],
      assets: [{
        id: 'a1', type: 'nj_real_property', description: '12 Oak Ave', fairMarketValue: 500_000,
        allocations: [{ beneficiaryId: 'b1', fraction: 0.5 }],
      }],
    });
    expect(() => deriveEngineMatter(m)).toThrow(/allocated/i);
  });
});
