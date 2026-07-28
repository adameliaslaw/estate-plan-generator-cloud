/**
 * The two deduction attestations, checked from both ends.
 *
 * The client-side rules exist so the attorney is asked the question beside the field; the server
 * is still the validator. So every case here asserts BOTH: what the page reports as still needed,
 * and what the server's own `validateMatter` does with the matter the page would send. A client
 * rule that drifts from the regulation fails on the server assertion, not just its own.
 *
 * Before this, neither `executor_commission` (for a death from 2025-12-15) nor
 * `transfer_taxes_other_states` could be saved from the UI at all: the server required an
 * attestation no screen collected.
 */
import { describe, expect, it } from 'vitest';
import { validateMatter } from '../../functions/src/inheritance-tax/validation/matter';
import {
  EXECUTOR_COMMISSION_ATTESTATION_FROM,
  attestationProblems,
  needsExecutorCommissionAttestation,
  needsTransferTaxAttestation,
  withApplicableAttestations,
} from '@/lib/inheritance-tax-attestations';
import type { ITRDeduction, ITRMatterInput } from '@/types/inheritance-tax';

function matterWith(deductions: ITRDeduction[], dateOfDeath = '2026-03-01'): ITRMatterInput {
  return {
    matterId: 'ITR-TEST-1',
    createdAt: '2026-03-02T10:00:00.000Z',
    decedent: {
      firstName: 'Jane', lastName: 'Doe', ssn: '123-45-6789',
      dateOfDeath, countyOfResidence: 'Mercer', isNJResident: true,
    },
    willExists: true,
    trustExists: false,
    federalReturnFiled: false,
    virtualCurrencyExists: false,
    disclaimersExist: false,
    personalRepresentative: {
      name: 'Sam Sibling', title: 'Executor',
      address: '1 Example Street, Trenton, NJ 08600', phone: '609-555-0100',
    },
    beneficiaries: [{
      id: 'ben-001', firstName: 'Sam', lastName: 'Sibling',
      address: '1 Example Street, Trenton, NJ 08600', relationship: 'sibling',
      bequests: [{ id: 'beq-001', type: 'bank_account', description: 'Checking', fairMarketValue: 100000 }],
    }],
    deductions,
  };
}

/** What the page actually sends: the matter with inapplicable attestations dropped. */
const serverAccepts = (m: ITRMatterInput): boolean => {
  try {
    validateMatter(withApplicableAttestations(m));
    return true;
  } catch {
    return false;
  }
};

const commission = (over: Partial<ITRDeduction> = {}): ITRDeduction => ({
  id: 'ded-001', type: 'executor_commission', description: 'Commission on the Ewing sale',
  amount: 12000, ...over,
});

const otherState = (over: Partial<ITRDeduction> = {}): ITRDeduction => ({
  id: 'ded-002', type: 'transfer_taxes_other_states', description: 'PA inheritance tax',
  amount: 4500, ...over,
});

describe('executor commission — N.J.A.C. 18:26-7.10(d), R.2025 d.152', () => {
  it('is demanded from the effective date, and not before', () => {
    expect(EXECUTOR_COMMISSION_ATTESTATION_FROM).toBe('2025-12-15');
    expect(needsExecutorCommissionAttestation(commission(), '2025-12-15')).toBe(true);
    expect(needsExecutorCommissionAttestation(commission(), '2025-12-14')).toBe(false);
    // A date of death not yet entered demands nothing — the page asks for the date separately.
    expect(needsExecutorCommissionAttestation(commission(), '')).toBe(false);
  });

  it('blocks the save while unattested, and names the regulation', () => {
    const m = matterWith([commission()]);
    expect(attestationProblems(m)).toEqual([
      expect.stringContaining('N.J.A.C. 18:26-7.10(d)'),
    ]);
    expect(serverAccepts(m)).toBe(false);
  });

  it('saves once both statements are attested with a factual basis', () => {
    const m = matterWith([commission({
      executorCommissionEligibility: {
        propertyWasResidueNotSpecificallyDevised: true,
        propertyWasSoldByExecutor: true,
        notes: 'Deed dated 2026-03-04; sale by the executor under Article IV',
      },
    })]);
    expect(attestationProblems(m)).toEqual([]);
    expect(serverAccepts(m)).toBe(true);
  });

  it('refuses a half-attested commission, and says to drop the deduction', () => {
    const m = matterWith([commission({
      executorCommissionEligibility: {
        propertyWasResidueNotSpecificallyDevised: true,
        propertyWasSoldByExecutor: false,
        notes: 'Sold by the residuary beneficiary after distribution',
      },
    })]);
    expect(attestationProblems(m)).toEqual([expect.stringContaining('remove the deduction')]);
    expect(serverAccepts(m)).toBe(false);
  });

  it('requires a non-blank factual basis, matching the server', () => {
    const m = matterWith([commission({
      executorCommissionEligibility: {
        propertyWasResidueNotSpecificallyDevised: true,
        propertyWasSoldByExecutor: true,
        notes: '   ',
      },
    })]);
    expect(attestationProblems(m)).toEqual([expect.stringContaining('attestation notes')]);
    expect(serverAccepts(m)).toBe(false);
  });

  it('leaves a pre-2025-12-15 commission alone, and strips a stale attestation from the payload', () => {
    // The attorney attested, then corrected the date of death to an earlier one. The old rule set
    // asks for nothing, and the half-filled leftover would fail the server's strict schema.
    const m = matterWith([commission({
      executorCommissionEligibility: {
        propertyWasResidueNotSpecificallyDevised: true,
        propertyWasSoldByExecutor: true,
        notes: '',
      },
    })], '2024-06-01');
    expect(attestationProblems(m)).toEqual([]);
    expect(withApplicableAttestations(m).deductions[0]!.executorCommissionEligibility).toBeUndefined();
    expect(serverAccepts(m)).toBe(true);
  });
});

describe('tax paid to another jurisdiction — N.J.A.C. 18:26-7.16', () => {
  it('is demanded whatever the date of death', () => {
    expect(needsTransferTaxAttestation(otherState())).toBe(true);
    expect(attestationProblems(matterWith([otherState()], '2003-01-01'))).toHaveLength(1);
    expect(serverAccepts(matterWith([otherState()], '2003-01-01'))).toBe(false);
  });

  it('saves once attested with the jurisdiction and a factual basis', () => {
    const m = matterWith([otherState({
      transferTaxEligibility: {
        taxedPropertyIsAlsoNJTaxable: true,
        taxingJurisdiction: 'Pennsylvania',
        notes: 'PA tax on the Bucks County property, receipt dated 2026-02-11',
      },
    })]);
    expect(attestationProblems(m)).toEqual([]);
    expect(serverAccepts(m)).toBe(true);
  });

  it('refuses it when the taxed property is not also NJ-taxable', () => {
    const m = matterWith([otherState({
      transferTaxEligibility: {
        taxedPropertyIsAlsoNJTaxable: false,
        taxingJurisdiction: 'Pennsylvania',
        notes: 'PA-situs real property, outside the NJ base',
      },
    })]);
    expect(attestationProblems(m)).toEqual([expect.stringContaining('remove the deduction')]);
    expect(serverAccepts(m)).toBe(false);
  });

  it('names the jurisdiction and the notes separately when each is blank', () => {
    const m = matterWith([otherState({
      transferTaxEligibility: {
        taxedPropertyIsAlsoNJTaxable: true, taxingJurisdiction: '', notes: '',
      },
    })]);
    expect(attestationProblems(m)).toEqual([
      expect.stringContaining('taxing jurisdiction'),
      expect.stringContaining('attestation notes'),
    ]);
    expect(serverAccepts(m)).toBe(false);
  });

  it('strips an attestation left behind when the type is changed away', () => {
    const m = matterWith([otherState({
      type: 'funeral_expenses',
      transferTaxEligibility: {
        taxedPropertyIsAlsoNJTaxable: true, taxingJurisdiction: 'Pennsylvania', notes: '',
      },
    })]);
    expect(attestationProblems(m)).toEqual([]);
    expect(withApplicableAttestations(m).deductions[0]!.transferTaxEligibility).toBeUndefined();
    expect(serverAccepts(m)).toBe(true);
  });
});

describe('several deductions at once', () => {
  it('reports each by its position on the page', () => {
    const m = matterWith([
      { id: 'ded-000', type: 'funeral_expenses', description: 'Funeral', amount: 9000 },
      commission(),
      otherState(),
    ]);
    expect(attestationProblems(m)).toEqual([
      expect.stringContaining('Deduction 2'),
      expect.stringContaining('Deduction 3'),
    ]);
    expect(serverAccepts(m)).toBe(false);
  });
});
