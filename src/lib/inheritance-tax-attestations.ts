/**
 * The two deduction attestations the server demands, expressed on the client so the attorney is
 * asked for them before the round trip rather than told about them afterwards.
 *
 * These are single-attorney statements of fact about the estate, not a second-attorney review:
 * the regulation makes the deduction allowable only on those facts, so the return may not claim
 * it unless the person filing says they are true.
 *
 * The rules here mirror `functions/src/inheritance-tax/validation/matter.ts`. That file remains
 * the real validator — this exists so its message arrives as "still needed: …" beside the field
 * instead of as a Zod path in a toast. If the two ever disagree, the server wins.
 */
import type { ITRDeduction, ITRMatterInput } from '@/types/inheritance-tax';

/**
 * R.2025 d.152 amended N.J.A.C. 18:26-7.10(d) effective this date. A death before it is governed
 * by the old rule, which asked for no attestation — so demanding one there would block a
 * deduction the State allows.
 */
export const EXECUTOR_COMMISSION_ATTESTATION_FROM = '2025-12-15';

/** ISO dates compare correctly as strings; a blank date of death demands nothing. */
export function needsExecutorCommissionAttestation(
  deduction: ITRDeduction,
  dateOfDeath: string,
): boolean {
  return deduction.type === 'executor_commission'
    && dateOfDeath >= EXECUTOR_COMMISSION_ATTESTATION_FROM;
}

export function needsTransferTaxAttestation(deduction: ITRDeduction): boolean {
  return deduction.type === 'transfer_taxes_other_states';
}

export function emptyExecutorCommissionEligibility(): NonNullable<ITRDeduction['executorCommissionEligibility']> {
  return {
    propertyWasResidueNotSpecificallyDevised: false,
    propertyWasSoldByExecutor: false,
    notes: '',
  };
}

export function emptyTransferTaxEligibility(): NonNullable<ITRDeduction['transferTaxEligibility']> {
  return { taxedPropertyIsAlsoNJTaxable: false, taxingJurisdiction: '', notes: '' };
}

/**
 * What is still missing or unattested, phrased the way the attorney will have to act on it. An
 * unticked box is not "incomplete" — it is the estate failing the regulation's test, and the
 * honest answer is to drop the deduction, so the message says that rather than nagging.
 */
export function attestationProblems(matter: ITRMatterInput): string[] {
  const problems: string[] = [];
  const dateOfDeath = matter.decedent.dateOfDeath;

  matter.deductions.forEach((d, i) => {
    const at = `Deduction ${i + 1}`;

    if (needsExecutorCommissionAttestation(d, dateOfDeath)) {
      const e = d.executorCommissionEligibility;
      if (!e) {
        problems.push(`${at}: executor commission eligibility attestation (N.J.A.C. 18:26-7.10(d))`);
      } else {
        if (!e.propertyWasResidueNotSpecificallyDevised || !e.propertyWasSoldByExecutor) {
          problems.push(
            `${at}: an executor commission is not allowable unless the property was residue and the ` +
            `representative made the sale — remove the deduction if either is untrue`,
          );
        }
        if (!e.notes.trim()) problems.push(`${at}: attestation notes`);
      }
    }

    if (needsTransferTaxAttestation(d)) {
      const t = d.transferTaxEligibility;
      if (!t) {
        problems.push(`${at}: other-jurisdiction tax eligibility attestation (N.J.A.C. 18:26-7.16)`);
      } else {
        if (!t.taxedPropertyIsAlsoNJTaxable) {
          problems.push(
            `${at}: tax paid to another jurisdiction is deductible only where that property is also ` +
            `subject to NJ Transfer Inheritance Tax — remove the deduction if it is not`,
          );
        }
        if (!t.taxingJurisdiction.trim()) problems.push(`${at}: taxing jurisdiction`);
        if (!t.notes.trim()) problems.push(`${at}: attestation notes`);
      }
    }
  });

  return problems;
}

/**
 * Drops an attestation that no longer applies to the deduction it sits on — the attorney changed
 * the type, or moved the date of death back before R.2025 d.152. It stays in the on-screen matter
 * (so flipping the date back does not lose the typing) but must not be sent: the server's schema
 * is strict about the object's own contents, and a half-filled leftover would fail the save for a
 * deduction that needs no attestation at all.
 */
export function withApplicableAttestations(matter: ITRMatterInput): ITRMatterInput {
  const dateOfDeath = matter.decedent.dateOfDeath;
  return {
    ...matter,
    deductions: matter.deductions.map((d) => {
      const next: ITRDeduction = { ...d };
      if (!needsExecutorCommissionAttestation(d, dateOfDeath)) delete next.executorCommissionEligibility;
      if (!needsTransferTaxAttestation(d)) delete next.transferTaxEligibility;
      return next;
    }),
  };
}
