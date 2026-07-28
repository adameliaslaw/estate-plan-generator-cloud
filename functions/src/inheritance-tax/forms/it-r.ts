import type {
  BeneficiaryTaxResult,
  BeneficiaryWorksheetRow,
  ITRFormData,
  ITRFormSnapshot,
  Matter,
  PriorPayment,
  ReviewCheckpoint,
  ScheduleEBeneficiaryRow,
  ScheduleItem,
  TaxClassLine,
} from '../types';
import { getRuleSetById } from '../rules/index';
import { buildFormSnapshot } from '../engine';
import { DISCLAIMER } from './disclaimer';
import { UnsupportedMatterError } from './errors';

/**
 * Reconstructs an {@link ITRFormSnapshot} from a live Matter for LEGACY approved
 * checkpoints that predate snapshot enrichment (FND-IMMUT). New computations always carry
 * `formSnapshot`; this fallback keeps already-approved historical checkpoints rendering.
 */
function legacyFormSnapshotFromMatter(matter: Matter): ITRFormSnapshot {
  return buildFormSnapshot(matter);
}

/**
 * Reads the prior payments from a frozen computation snapshot. Snapshots produced
 * before dated prior payments existed stored Line 20 as a scalar total; an approved
 * checkpoint persisted under that format is read here verbatim (the CLI `form`
 * command does not migrate it). Coerce such a legacy scalar to a single dateless
 * payment so already-approved forms still render instead of throwing on `.reduce`.
 */
function snapshotPriorPayments(value: number | PriorPayment[] | undefined): PriorPayment[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'number' && value > 0) {
    return [{ id: 'legacy-prior-payment', amount: value }];
  }
  return [];
}

/**
 * Builds the data model for the NJ IT-R (Transfer Inheritance Tax Return).
 *
 * All computed values AND attorney-provided inputs (Lines 8, 15, 16, 18, 20)
 * are taken exclusively from approvedCheckpoint.computationSnapshot — the values
 * the attorney actually reviewed and signed off on. The live Matter is used only
 * for cover-page fields (name, SSN, etc.) that are not part of the tax computation,
 * and for schedule detail (individual bequests/deductions) that underlies the totals.
 *
 * Throws if the checkpoint is not in 'approved' status.
 *
 * Line numbers verified against IT-R (12-24) — itrbk.pdf and it-rinst.pdf
 * (nj.gov/treasury/taxation/pdf/other_forms/inheritance, retrieved Jun 2026).
 */
export function buildITRFormData(
  matter: Matter,
  approvedCheckpoint: ReviewCheckpoint,
): ITRFormData {
  if (approvedCheckpoint.status !== 'approved') {
    throw new Error('Cannot generate IT-R form data without an approved review checkpoint.');
  }

  // Guard: the checkpoint must belong to this matter. Mixing a checkpoint from
  // a different matter with the supplied matter's cover-page data would produce
  // an IT-R that pairs the wrong decedent/representative with the wrong computation.
  if (approvedCheckpoint.matterId !== matter.matterId) {
    throw new Error(
      `Checkpoint matterId '${approvedCheckpoint.matterId}' does not match ` +
      `matter matterId '${matter.matterId}'. ` +
      'Cannot generate IT-R form data from a checkpoint belonging to a different matter.',
    );
  }

  // FND-IMMUT (docs/IT-R-SPECIFICATION.md §10): render EXCLUSIVELY from the frozen,
  // attorney-approved snapshot — never re-read the mutable Matter for any figure or
  // schedule. `formSnapshot` freezes the cover page, representative, beneficiary
  // identity, schedules, deductions, and the disclaimer log at compute time, so a
  // post-approval edit to the Matter cannot render a self-contradicting approved form.
  // Legacy snapshots (produced before enrichment) lack it; those fall back to the live
  // Matter so already-approved historical checkpoints still render.
  const snap = approvedCheckpoint.computationSnapshot;
  const ruleSet = getRuleSetById(snap.ruleSetId);
  const mi = snap.matterInputs;
  const src = snap.formSnapshot ?? legacyFormSnapshotFromMatter(matter);

  // Phase 0 guardrail (docs/CONSOLIDATION_PLAN.md): nonresident decedents are OUT OF SCOPE.
  // NJ requires Form IT-NR for nonresident decedents; producing a resident IT-R would be
  // the wrong official form. Read the FROZEN residency so a post-approval edit cannot flip it.
  if (src.decedent.isNJResident === false) {
    throw new UnsupportedMatterError(
      `Matter '${matter.matterId}': the decedent was a nonresident of New Jersey. ` +
      'NJ requires Form IT-NR (Non-Resident Decedent Inheritance Tax Return) for nonresident ' +
      'decedents, which this tool does not generate. IT-R generation is blocked for nonresident ' +
      'matters (Phase 0 guardrail).',
    );
  }

  // ── Schedule item collections (frozen in the snapshot) ────────────────────
  const { scheduleA, scheduleB, scheduleB1, scheduleB2, scheduleB3, scheduleB4, scheduleC, scheduleD } = src;
  const disclaimerSchedule = src.disclaimerSchedule;

  const njRealProperty = sumSchedule(scheduleA);
  const closelyHeld = sumSchedule(scheduleB);
  const otherPersonal = sumSchedule(scheduleB1) + sumSchedule(scheduleB2) + sumSchedule(scheduleB3) + sumSchedule(scheduleB4);
  const transfers = sumSchedule(scheduleC);

  // Line 8 = contingent amount already included in Line 7 (net estate).
  // Line 9 = Line 7 minus Line 8 (the certain, non-contingent balance).
  // Verified: IT-R (12-24) Summary Page — "Subtract line 8 from line 7."
  const line9_balanceOfEstate = Math.max(0, snap.netEstate - mi.contingentAmounts);

  // Build tax class distribution table (Lines 10-14).
  // Join beneficiary relationship (from matter) with computation results (from snapshot)
  // to split Class A into Spouse (line 10) vs. Other (line 11).
  const resultById = new Map<string, BeneficiaryTaxResult>(
    snap.beneficiaryResults.map((r) => [r.beneficiaryId, r]),
  );

  const classASpouse: BeneficiaryTaxResult[] = [];
  const classAOther: BeneficiaryTaxResult[] = [];
  const classC: BeneficiaryTaxResult[] = [];
  const classD: BeneficiaryTaxResult[] = [];
  const classE: BeneficiaryTaxResult[] = [];

  const classCWorksheet: BeneficiaryWorksheetRow[] = [];
  const classDWorksheet: BeneficiaryWorksheetRow[] = [];
  // Schedule E lists every interest in the estate, exempt classes included — so it is built in
  // the same pass but without the class filter the worksheets apply.
  const scheduleE: ScheduleEBeneficiaryRow[] = [];

  for (const b of src.beneficiaries) {
    const r = resultById.get(b.id);
    if (r === undefined) continue;
    scheduleE.push({
      name: [b.firstName, b.lastName].filter(Boolean).join(' '),
      address: b.address,
      ...(b.addressParts !== undefined ? { addressParts: b.addressParts } : {}),
      relationship: b.relationship,
      taxClass: r.taxClass,
      ...(b.interestDescription ? { interestDescription: b.interestDescription } : {}),
      dollarAmount: r.scaledBequeathed,
    });
    if (r.taxClass === 'A') {
      if (b.isSpouseOrCU) {
        classASpouse.push(r);
      } else {
        classAOther.push(r);
      }
    } else if (r.taxClass === 'C') {
      classC.push(r);
      classCWorksheet.push({
        beneficiaryId: b.id,
        lastName: b.lastName,
        firstName: b.firstName,
        address: b.address,
        relationship: b.relationship,
        result: r,
      });
    } else if (r.taxClass === 'D') {
      classD.push(r);
      classDWorksheet.push({
        beneficiaryId: b.id,
        lastName: b.lastName,
        firstName: b.firstName,
        address: b.address,
        relationship: b.relationship,
        result: r,
      });
    } else if (r.taxClass === 'E') {
      classE.push(r);
    }
  }

  const line17_totalTax = snap.totalTaxDue + mi.compromiseTax + mi.contingentTax;
  const line19_totalAmountDue = line17_totalTax + mi.interestDue;
  // Tolerate legacy snapshots whose priorPayments was a scalar total (see helper).
  const priorPayments = snapshotPriorPayments(
    mi.priorPayments as unknown as number | PriorPayment[] | undefined,
  );
  const priorPaymentsTotal = priorPayments.reduce((sum, p) => sum + p.amount, 0);
  const line21_balanceDue = Math.max(0, line19_totalAmountDue - priorPaymentsTotal);
  const line22_refund = Math.max(0, priorPaymentsTotal - line19_totalAmountDue);

  return {
    decedentLastName: src.decedent.lastName,
    decedentFirstName: src.decedent.firstName,
    ...(src.decedent.middleName !== undefined
      ? { decedentMiddleName: src.decedent.middleName }
      : {}),
    ...(src.decedent.aka !== undefined
      ? { decedentAka: src.decedent.aka }
      : {}),
    decedentSSN: src.decedent.ssn,
    dateOfDeath: src.decedent.dateOfDeath,
    countyOfResidence: src.decedent.countyOfResidence,
    isNJResident: src.decedent.isNJResident,
    willExists: src.willExists,
    trustExists: src.trustExists,
    federalReturnFiled: src.federalReturnFiled,
    virtualCurrencyExists: src.virtualCurrencyExists,
    disclaimersExist: src.disclaimersExist,
    disclaimerCount: disclaimerSchedule.length,
    ...(disclaimerSchedule.length > 0 ? { disclaimerSchedule } : {}),
    representative: src.representative,

    line1_njRealProperty: njRealProperty,
    line2_closelyHeldBusiness: closelyHeld,
    line3_allOtherPersonalProperty: otherPersonal,
    line4_transfers: transfers,
    line5_grossEstate: snap.grossEstate,
    line6_deductions: snap.totalDeductions,
    line7_netEstate: snap.netEstate,
    line8_contingentAmount: mi.contingentAmounts,
    line9_balanceOfEstate,

    line10_classA_spouse: buildTaxClassLine(classASpouse),
    line11_classA_other: buildTaxClassLine(classAOther),
    line12_classC: buildTaxClassLine(classC),
    line13_classD: buildTaxClassLine(classD),
    line14_classE: buildTaxClassLine(classE),

    line15_compromiseTax: mi.compromiseTax,
    line16_contingentTax: mi.contingentTax,

    line17_totalTax,
    line18_interestDue: mi.interestDue,
    line19_totalAmountDue,
    line20_priorPayments: priorPaymentsTotal,
    line20_priorPaymentSchedule: priorPayments,
    line21_balanceDue,
    line22_refund,

    taxClassBreakdown: snap.beneficiaryResults,

    scheduleA,
    scheduleB,
    scheduleB1,
    scheduleB2,
    scheduleB3,
    scheduleB4,
    scheduleC,
    scheduleD,
    scheduleE,
    classCWorksheet,
    classDWorksheet,

    filingDeadline: snap.filingDeadline,
    extendedFilingDeadline: snap.extendedFilingDeadline,
    ruleSetId: snap.ruleSetId,

    njEstateTaxApplies: ruleSet.njEstateTaxApplies,
    ...(ruleSet.njEstateTaxExemption !== undefined
      ? { njEstateTaxExemption: ruleSet.njEstateTaxExemption }
      : {}),

    approvedCheckpointId: approvedCheckpoint.checkpointId,
    disclaimer: DISCLAIMER,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Builds a TaxClassLine for one tax class.
 * Uses r.scaledBequeathed (proportional share of Line 9 balance of estate) for
 * the distribution column — this ensures Lines 10-14 total distribution equals Line 9
 * per IT-R (12-24). Tax is computed by the engine on the same scaled amounts.
 */
function buildTaxClassLine(results: BeneficiaryTaxResult[]): TaxClassLine {
  const totalDistribution = results.reduce((s, r) => s + r.scaledBequeathed, 0);
  const totalExemption = results.reduce((s, r) => s + r.exemption, 0);
  return {
    totalBeneficiaries: results.length,
    totalDistribution,
    totalExemption,
    totalTaxableAmount: Math.max(0, totalDistribution - totalExemption),
    taxDue: results.reduce((s, r) => s + r.taxDue, 0),
  };
}

function sumSchedule(items: ScheduleItem[]): number {
  return items.reduce((s, i) => s + i.fairMarketValue, 0);
}
