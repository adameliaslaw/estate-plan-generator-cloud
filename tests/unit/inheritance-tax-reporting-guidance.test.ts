/**
 * The reporting guidance on the intake screen, checked against what the engine actually does.
 *
 * These three notes exist because of a failure mode the engine cannot catch: it taxes whatever
 * it is given. Enter an asset the State does not tax and the return comes back higher, entirely
 * self-consistent, with nothing erroring anywhere. Claim a deduction the State disallows and it
 * comes back lower, the same way. The spec calls that "the single worst failure mode for this
 * tool", so the screen has to carry the rule.
 *
 * Every claim below is quoted from the State's own IT-R instructions (`it-rinst.pdf`):
 *
 *   Schedule A — "Exemptions (nonreporting): • Do not report real property held by the decedent
 *   as 'tenants by the entirety' with a surviving spouse or civil union partner; • Do not report
 *   real property located outside New Jersey."
 *
 *   Schedule C Part III — "Life insurance policies payable to a named beneficiary are not
 *   required to be reported." / "Life insurance policies payable to the decedent's Estate are
 *   required to be reported on this schedule."
 *
 *   Schedule D, "Do not deduct" — "• Debts secured by real or tangible property located outside
 *   of New Jersey."
 *
 * What is asserted here is the PAIRING: that each note sits on the control it governs, and that
 * the engine still behaves the way the note warns about. If someone later teaches the engine to
 * exclude these itself, the arithmetic assertions fail and the note becomes wrong — which is the
 * point at which it should be rewritten rather than left contradicting the code.
 */
import { describe, expect, test } from 'vitest';
import { computeEstate } from '../../functions/src/inheritance-tax/engine';
import { getRuleSet } from '../../functions/src/inheritance-tax/rules';
import type { Matter } from '../../functions/src/inheritance-tax/types';
import {
  BEQUEST_TYPES, DEDUCTION_TYPES, NOT_REPORTED_ON_ITR,
} from '@/types/inheritance-tax';

function matterWith(partial: Partial<Matter>): Matter {
  return {
    matterId: 'guidance', createdAt: '2024-01-01T00:00:00.000Z',
    decedent: {
      lastName: 'Gold', firstName: 'Ada', ssn: '999-00-1234',
      dateOfDeath: '2024-03-01', countyOfResidence: 'Mercer', isNJResident: true,
    },
    willExists: true, trustExists: false, federalReturnFiled: false,
    virtualCurrencyExists: false, disclaimersExist: false,
    personalRepresentative: {
      name: 'Executor Gold', title: 'Executor',
      address: '1 Main St, Trenton, NJ 08600', phone: '609-555-0000',
    },
    beneficiaries: [], deductions: [],
    ...partial,
  };
}

/** One Class D beneficiary, so anything includible produces visible tax. */
const classD = (bequests: Matter['beneficiaries'][number]['bequests']) => ([{
  id: 'b1', lastName: 'Friend', firstName: 'Sam', address: '2 Elm St, Trenton, NJ 08600',
  relationship: 'friend' as const, bequests,
}]);

const compute = (m: Matter) => computeEstate(m, getRuleSet(m.decedent.dateOfDeath));

describe('the guidance sits on the control it governs', () => {
  test('the asset picker warns on NJ real property and on transfers', () => {
    const realty = BEQUEST_TYPES.find((t) => t.value === 'nj_real_property');
    expect(realty?.note).toContain('Do not report real property located outside');

    // Life insurance has no bequest type of its own, on purpose — the taxable kind is a
    // Schedule C transfer, and the exempt kind is not entered at all.
    expect(BEQUEST_TYPES.map((t) => t.value)).not.toContain('life_insurance');
    const transfer = BEQUEST_TYPES.find((t) => t.value === 'transfer');
    expect(transfer?.note).toContain('NAMED BENEFICIARY');
    expect(transfer?.note).toContain('Part III B');
  });

  test('the deduction picker warns that an out-of-state mortgage is not deductible', () => {
    const mortgage = DEDUCTION_TYPES.find((t) => t.value === 'mortgage');
    expect(mortgage?.note).toContain('outside');
    expect(mortgage?.note).toContain('Do not deduct');
  });

  test('the standing list names all three exclusions', () => {
    const all = NOT_REPORTED_ON_ITR.map((x) => `${x.what} ${x.why}`).join(' ');
    expect(all).toContain('outside New Jersey');
    expect(all).toContain('named beneficiary');
    expect(all).toContain('tenants by the entirety');
  });
});

describe('why the guidance has to exist — the engine cannot catch these itself', () => {
  test('an asset the State does not tax raises the tax if entered anyway', () => {
    // The out-of-state condo, mis-entered as ordinary personal property.
    const withCondo = compute(matterWith({
      beneficiaries: classD([
        { id: 'q1', type: 'bank_account', description: 'Checking', fairMarketValue: 100_000 },
        { id: 'q2', type: 'other_personal_property', description: 'Florida condo', fairMarketValue: 400_000 },
      ]),
    }));
    const without = compute(matterWith({
      beneficiaries: classD([
        { id: 'q1', type: 'bank_account', description: 'Checking', fairMarketValue: 100_000 },
      ]),
    }));

    // No error, no warning — just a bigger number. That is the whole argument for the note.
    expect(withCondo.grossEstate).toBe(500_000);
    expect(without.grossEstate).toBe(100_000);
    expect(withCondo.totalTaxDue).toBeGreaterThan(without.totalTaxDue);
  });

  test('a deduction the State disallows lowers the tax if claimed anyway', () => {
    const base = matterWith({
      beneficiaries: classD([
        { id: 'q1', type: 'bank_account', description: 'Checking', fairMarketValue: 500_000 },
      ]),
    });
    const withMortgage = compute({
      ...base,
      deductions: [{
        id: 'd1', type: 'mortgage', description: 'Mortgage on the Florida condo', amount: 200_000,
      }],
    });
    const without = compute(base);

    expect(withMortgage.totalDeductions).toBe(200_000);
    // Understating the tax is the harder error to notice, because the return still balances.
    expect(withMortgage.totalTaxDue).toBeLessThan(without.totalTaxDue);
  });

  test('life insurance to a named beneficiary would be taxed if entered — so it must not be', () => {
    const entered = compute(matterWith({
      beneficiaries: classD([
        { id: 'q1', type: 'transfer', description: 'Term life, payable to Sam', fairMarketValue: 250_000 },
      ]),
    }));
    // Exempt under the instructions, yet fully taxed here. The engine has no way to know which
    // kind of policy this is; only the attorney does.
    expect(entered.grossEstate).toBe(250_000);
    expect(entered.totalTaxDue).toBeGreaterThan(0);
  });
});
