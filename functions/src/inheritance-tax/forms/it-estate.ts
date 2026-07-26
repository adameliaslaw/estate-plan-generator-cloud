import type { ITEstateFormData, Matter, ReviewCheckpoint } from '../types';
import { DISCLAIMER } from './disclaimer';

/**
 * Builds the data model for Form IT-Estate (NJ Resident Decedent Estate Tax Return),
 * for a pre-2018 death. Statutory basis: N.J.S.A. 54:38-1.
 *
 * All computed values come from the approved computation snapshot (frozen at compute time):
 * the NJ Estate Tax computation (snapshot.njEstateTax) and the inheritance-tax credit
 * (snapshot.totalTaxDue — IT-Estate line 11(a), "Credit for NJ Inheritance Tax Paid").
 * Only decedent/representative identity fields come from the live Matter, as in the IT-R.
 *
 * For 2002-2016 deaths the net estate tax due is computed (tentative tax less the
 * inheritance-tax credit, floored at zero). For 2017 deaths the State requires its
 * official §2058 circular calculator, so tentativeTax and netEstateTaxDue stay null.
 *
 * Throws if the checkpoint is not approved, belongs to a different matter, or the
 * approved computation has no NJ Estate Tax (death on/after 2018-01-01).
 */
export function buildITEstateFormData(
  matter: Matter,
  approvedCheckpoint: ReviewCheckpoint,
): ITEstateFormData {
  if (approvedCheckpoint.status !== 'approved') {
    throw new Error('Cannot generate IT-Estate form data without an approved review checkpoint.');
  }

  if (approvedCheckpoint.matterId !== matter.matterId) {
    throw new Error(
      `Checkpoint matterId '${approvedCheckpoint.matterId}' does not match ` +
      `matter matterId '${matter.matterId}'. ` +
      'Cannot generate IT-Estate form data from a checkpoint belonging to a different matter.',
    );
  }

  const snap = approvedCheckpoint.computationSnapshot;
  const est = snap.njEstateTax;
  if (est === null) {
    throw new Error(
      'Cannot generate IT-Estate: no NJ Estate Tax applies to this date of death ' +
      '(the estate tax was repealed for deaths on or after 2018-01-01).',
    );
  }

  // IT-Estate line 11(a): "Credit for NJ Inheritance Tax Paid (DO NOT INCLUDE INTEREST OR
  // PENALTY)." That is the full IT-R Line 17 tax — beneficiary-class tax plus compromise
  // (Line 15) and contingent (Line 16) tax — excluding only Line 18 interest.
  const mi = snap.matterInputs;
  const inheritanceTaxCredit = snap.totalTaxDue + mi.compromiseTax + mi.contingentTax;
  const tentativeTax = est.taxDue;
  // IT-Estate line 13(a): net = tentative − inheritance-tax credit, floored at zero.
  const netEstateTaxDue = tentativeTax === null
    ? null
    : Math.max(0, Math.round((tentativeTax - inheritanceTaxCredit) * 100) / 100);

  return {
    decedentLastName: matter.decedent.lastName,
    decedentFirstName: matter.decedent.firstName,
    ...(matter.decedent.middleName !== undefined
      ? { decedentMiddleName: matter.decedent.middleName }
      : {}),
    decedentSSN: matter.decedent.ssn,
    dateOfDeath: matter.decedent.dateOfDeath,
    countyOfResidence: matter.decedent.countyOfResidence,
    isNJResident: matter.decedent.isNJResident ?? true,

    representative: matter.personalRepresentative,

    regime: est.regime,
    method: est.method,
    exemptionThreshold: est.exemptionThreshold,
    taxableEstate: est.taxableEstate,
    ...(est.exemptionAmount !== undefined ? { exemptionAmount: est.exemptionAmount } : {}),
    ...(est.adjustedTaxableEstate !== undefined
      ? { adjustedTaxableEstate: est.adjustedTaxableEstate }
      : {}),

    tentativeTax,
    inheritanceTaxCredit,
    netEstateTaxDue,

    filingRequired: est.filingRequired,
    estateTaxDeadline: est.filingDeadline,
    citation: est.citation,
    note: est.note,

    approvedCheckpointId: approvedCheckpoint.checkpointId,
    disclaimer: DISCLAIMER,
    generatedAt: new Date().toISOString(),
  };
}
