/**
 * Intake in the allocation model — inventory first, allocate second.
 *
 * Checked from both ends, the same way the deduction attestations are: every rule asserts what
 * the page reports as still needed AND what the server's own `validateMatter` does with the
 * matter the page would send. A client rule that drifts from the server fails the second
 * assertion, not just its own — which is the only way to keep an intake screen honest.
 *
 * The scope's acceptance criteria, each with a test below:
 *   - a 1/3 : 2/3 split is enterable without the attorney computing anything;
 *   - an over-allocated asset cannot be saved.
 */
import { describe, expect, it } from 'vitest';
import { validateMatter } from '../../functions/src/inheritance-tax/validation/matter';
import { deriveEngineMatter } from '../../functions/src/inheritance-tax/allocations';
import { computeEstate } from '../../functions/src/inheritance-tax/engine';
import { getRuleSet } from '../../functions/src/inheritance-tax/rules';
import {
  allocationProblems,
  formatShare,
  grossFromAssets,
  normalizeMatterToAssets,
  parseShare,
  residuaryPool,
  shareAmount,
  unallocatedFraction,
  usesAssetModel,
  withAllocationsForSave,
} from '@/lib/inheritance-tax-allocations';
import type { ITRAsset, ITRMatterInput, ITRResiduaryShare } from '@/types/inheritance-tax';
import type { Matter } from '../../functions/src/inheritance-tax/types';

const CHILD = {
  id: 'ben-1', firstName: 'Cara', lastName: 'Child',
  address: '1 Example Street, Trenton, NJ 08600',
  relationship: 'child' as const, bequests: [],
};
const SIBLING = {
  id: 'ben-2', firstName: 'Sam', lastName: 'Sibling',
  address: '2 Example Street, Trenton, NJ 08600',
  relationship: 'sibling' as const, bequests: [],
};

function matterWith(assets: ITRAsset[], residuary: ITRResiduaryShare[] = []): ITRMatterInput {
  return {
    matterId: 'ITR-TEST-ALLOC',
    createdAt: '2026-03-02T10:00:00.000Z',
    decedent: {
      firstName: 'Jane', lastName: 'Doe', ssn: '123-45-6789',
      dateOfDeath: '2026-03-01', countyOfResidence: 'Mercer', isNJResident: true,
    },
    willExists: true,
    trustExists: false,
    federalReturnFiled: false,
    virtualCurrencyExists: false,
    disclaimersExist: false,
    personalRepresentative: {
      name: 'Sam Sibling', title: 'Executor',
      address: '2 Example Street, Trenton, NJ 08600', phone: '609-555-0100',
    },
    beneficiaries: [CHILD, SIBLING],
    assets,
    residuary,
    deductions: [],
  };
}

/** What the page actually sends. */
const serverAccepts = (m: ITRMatterInput): boolean => {
  try {
    validateMatter(withAllocationsForSave(m));
    return true;
  } catch {
    return false;
  }
};

const house = (over: Partial<ITRAsset> = {}): ITRAsset => ({
  id: 'ast-1', type: 'nj_real_property', description: '12 Oak Ave', fairMarketValue: 500_000,
  allocations: [],
  ...over,
});

// ═══════════════════════════════════════════════════════════════════════════
// The share picker does the arithmetic
// ═══════════════════════════════════════════════════════════════════════════

describe('a share can be typed as a percentage, a dollar amount or a fraction', () => {
  it('reads "1/3" as a third, and derives the dollars', () => {
    const third = parseShare('1/3', 'fraction', 500_000);
    expect(third).toBeCloseTo(1 / 3, 12);
    expect(shareAmount(third!, 500_000)).toBeCloseTo(166_666.67, 2);
  });

  it('reads a percentage and a dollar amount to the same fraction', () => {
    expect(parseShare('50', 'percent', 500_000)).toBe(0.5);
    expect(parseShare('250000', 'amount', 500_000)).toBe(0.5);
  });

  it('leaves a half-typed entry alone rather than storing a 0 nobody meant', () => {
    expect(parseShare('', 'percent', 100)).toBeNull();
    expect(parseShare('1/', 'fraction', 100)).toBeNull();
    expect(parseShare('abc', 'amount', 100)).toBeNull();
    expect(parseShare('-5', 'percent', 100)).toBeNull();
    // There is no fraction of nothing.
    expect(parseShare('5000', 'amount', 0)).toBeNull();
  });

  it('shows a stored fraction back in whichever way the attorney is working', () => {
    expect(formatShare(1 / 3, 'percent', 500_000)).toBe('33.3333');
    expect(formatShare(1 / 3, 'amount', 500_000)).toBe('166666.67');
  });

  it('THE ACCEPTANCE CASE: a 1/3 : 2/3 split, with no arithmetic done by the attorney', () => {
    const a = house({
      allocations: [
        { beneficiaryId: 'ben-1', fraction: parseShare('1/3', 'fraction', 500_000)! },
        { beneficiaryId: 'ben-2', fraction: parseShare('2/3', 'fraction', 500_000)! },
      ],
    });
    const m = matterWith([a]);
    expect(allocationProblems(m)).toEqual([]);
    expect(serverAccepts(m)).toBe(true);

    // And the engine turns those fractions into cent-exact dollars that sum to the house.
    const derived = deriveEngineMatter(withAllocationsForSave(m) as unknown as Matter);
    const amounts = derived.beneficiaries.map((b) => b.bequests[0]?.fairMarketValue ?? 0);
    expect(amounts[0]).toBeCloseTo(166_666.67, 2);
    expect(amounts[1]).toBeCloseTo(333_333.33, 2);
    expect(amounts[0]! + amounts[1]!).toBe(500_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The remainder, shown as it falls into the pool
// ═══════════════════════════════════════════════════════════════════════════

describe('the residuary pool is computed, never entered', () => {
  it('an asset with no specific gifts is wholly residuary — not an error', () => {
    const m = matterWith([house()], [{ beneficiaryId: 'ben-1', fraction: 1 }]);
    expect(unallocatedFraction(m.assets![0]!)).toBe(1);
    expect(residuaryPool(m)).toBe(500_000);
    expect(allocationProblems(m)).toEqual([]);
    expect(serverAccepts(m)).toBe(true);
  });

  it('part specific, part residue: $50,000 off a $120,000 account leaves $70,000 in the pool', () => {
    const account = house({
      id: 'ast-2', type: 'bank_account', description: 'Chase …4821', fairMarketValue: 120_000,
      allocations: [{ beneficiaryId: 'ben-2', fraction: parseShare('50000', 'amount', 120_000)! }],
    });
    const m = matterWith([account], [{ beneficiaryId: 'ben-1', fraction: 1 }]);
    expect(residuaryPool(m)).toBeCloseTo(70_000, 6);
    expect(allocationProblems(m)).toEqual([]);
    expect(serverAccepts(m)).toBe(true);
  });

  it('the gross estate is the sum of the assets, entered once each', () => {
    const m = matterWith([house(), house({ id: 'ast-2', fairMarketValue: 40_000 })],
      [{ beneficiaryId: 'ben-1', fraction: 1 }]);
    expect(grossFromAssets(m)).toBe(540_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// What cannot be saved
// ═══════════════════════════════════════════════════════════════════════════

describe('the page refuses what the server refuses', () => {
  it('THE ACCEPTANCE CASE: an over-allocated asset cannot be saved', () => {
    const m = matterWith([house({
      allocations: [
        { beneficiaryId: 'ben-1', fraction: 0.6 },
        { beneficiaryId: 'ben-2', fraction: 0.6 },
      ],
    })]);
    expect(allocationProblems(m).join(' ')).toMatch(/cannot be given away more than once/i);
    expect(serverAccepts(m)).toBe(false);
  });

  it('an under-allocated asset with nobody taking the residue is refused', () => {
    const m = matterWith([house({ allocations: [{ beneficiaryId: 'ben-1', fraction: 0.5 }] })]);
    expect(allocationProblems(m).join(' ')).toMatch(/passes under the residuary clause/i);
    expect(serverAccepts(m)).toBe(false);
  });

  it('residuary shares that do not total 100% are refused', () => {
    const m = matterWith([house()], [
      { beneficiaryId: 'ben-1', fraction: 0.6 },
      { beneficiaryId: 'ben-2', fraction: 0.3 },
    ]);
    expect(allocationProblems(m).join(' ')).toMatch(/must total 100%/i);
    expect(serverAccepts(m)).toBe(false);
  });

  it('residuary shares with no residue to divide are refused', () => {
    const m = matterWith(
      [house({ allocations: [{ beneficiaryId: 'ben-1', fraction: 1 }] })],
      [{ beneficiaryId: 'ben-2', fraction: 1 }],
    );
    expect(allocationProblems(m).join(' ')).toMatch(/no residue to divide/i);
    expect(serverAccepts(m)).toBe(false);
  });

  it('a share pointed at nobody is caught before the round trip', () => {
    const m = matterWith([house({ allocations: [{ beneficiaryId: '', fraction: 0.5 }] })]);
    expect(allocationProblems(m).join(' ')).toMatch(/not assigned to anyone/i);
    expect(serverAccepts(m)).toBe(false);
  });

  it('the same beneficiary twice on one asset is caught', () => {
    const m = matterWith([house({
      allocations: [
        { beneficiaryId: 'ben-1', fraction: 0.5 },
        { beneficiaryId: 'ben-1', fraction: 0.5 },
      ],
    })]);
    expect(allocationProblems(m).join(' ')).toMatch(/two shares/i);
    expect(serverAccepts(m)).toBe(false);
  });

  it('an empty residuary array is dropped rather than sent, which the server would reject', () => {
    const m = matterWith([house({ allocations: [{ beneficiaryId: 'ben-1', fraction: 1 }] })], []);
    expect(withAllocationsForSave(m).residuary).toBeUndefined();
    expect(serverAccepts(m)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Opening a matter saved before any of this existed
// ═══════════════════════════════════════════════════════════════════════════

describe('a legacy nested matter opens in the new screen', () => {
  const LEGACY: ITRMatterInput = {
    ...matterWith([]),
    assets: undefined,
    residuary: undefined,
    beneficiaries: [
      {
        ...CHILD,
        bequests: [
          { id: 'beq-1', type: 'nj_real_property', description: '12 Oak Ave', fairMarketValue: 250_000 },
        ],
      },
      {
        ...SIBLING,
        bequests: [
          { id: 'beq-2', type: 'nj_real_property', description: '12 Oak Ave', fairMarketValue: 250_000 },
        ],
      },
    ],
  };

  it('normalises to one asset per bequest, each wholly allocated to whoever held it', () => {
    const normalized = normalizeMatterToAssets(LEGACY);
    expect(usesAssetModel(normalized)).toBe(true);
    expect(normalized.assets).toHaveLength(2);
    expect(normalized.assets?.map((a) => a.allocations)).toEqual([
      [{ beneficiaryId: 'ben-1', fraction: 1 }],
      [{ beneficiaryId: 'ben-2', fraction: 1 }],
    ]);
    expect(normalized.beneficiaries.every((b) => b.bequests.length === 0)).toBe(true);
  });

  it('the normalised matter saves, and computes to the same figures as the original', () => {
    const normalized = normalizeMatterToAssets(LEGACY);
    expect(allocationProblems(normalized)).toEqual([]);
    expect(serverAccepts(normalized)).toBe(true);

    const rules = getRuleSet('2026-03-01');
    const before = computeEstate(LEGACY as unknown as Matter, rules);
    const after = computeEstate(
      deriveEngineMatter(withAllocationsForSave(normalized) as unknown as Matter),
      rules,
    );
    expect(after.grossEstate).toBe(before.grossEstate);
    expect(after.totalTaxDue).toBe(before.totalTaxDue);
    expect(after.beneficiaryResults).toEqual(before.beneficiaryResults);
  });

  it('a matter already in the allocation model is left alone', () => {
    const m = matterWith([house()], [{ beneficiaryId: 'ben-1', fraction: 1 }]);
    expect(normalizeMatterToAssets(m)).toBe(m);
  });
});
