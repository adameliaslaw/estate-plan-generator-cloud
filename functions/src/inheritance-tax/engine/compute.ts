import type {
  Beneficiary,
  BeneficiaryTaxResult,
  Bequest,
  BequestType,
  DisclaimerScheduleItem,
  EstateComputation,
  ITRFormSnapshot,
  Matter,
  PriorPayment,
  ScheduleDeductionItem,
  ScheduleItem,
  TaxBracket,
  TaxClass,
} from '../types';
import type { RuleSet } from '../rules';
import { classifyBeneficiary } from './classify';
import { computeFilingDeadline } from './deadline';
import { computeNJEstateTax } from './estate-tax';
import { fromCents, roundCents, toCents } from '../money';
// Imported from the specific file (not the forms barrel) to avoid an engine→forms cycle.
import { UnsupportedMatterError } from '../forms/errors';

/**
 * Applies the graduated brackets to a taxable amount **in integer cents** (FND-MONEY), so no
 * float drift accumulates across brackets. Bracket bounds are dollar breakpoints, converted
 * to cents; each bracket's tax is `round(amountInBracketCents × rate)` to whole cents. The
 * returned breakdown is converted back to dollars for BeneficiaryTaxResult.
 */
function applyBrackets(
  taxableCents: number,
  brackets: TaxBracket[],
): BeneficiaryTaxResult['brackets'] {
  const result: BeneficiaryTaxResult['brackets'] = [];
  let remainingCents = taxableCents;
  for (const bracket of brackets) {
    if (remainingCents <= 0) break;
    const bracketTopCents = bracket.to === null ? Infinity : toCents(bracket.to);
    const widthCents = bracketTopCents - toCents(bracket.from);
    const amountInBracketCents = Math.min(remainingCents, widthCents);
    if (amountInBracketCents <= 0) continue;
    result.push({
      bracket,
      amountInBracket: fromCents(amountInBracketCents),
      tax: fromCents(roundCents(amountInBracketCents * bracket.rate)),
    });
    remainingCents -= amountInBracketCents;
  }
  return result;
}

/**
 * Computes NJ Transfer Inheritance Tax for one beneficiary.
 *
 * deductionScale = (balanceOfEstate / grossEstate) — supplied by computeEstate().
 * Tax brackets are applied to scaledBequeathed (gross FMV × scale), not raw gross FMV,
 * because the IT-R (12-24) distributes Line 9 (balance of estate, post-deductions) across
 * all classes. N.J.A.C. 18:26-1.1 defines "clear market value" as FMV less allowable
 * deductions; N.J.A.C. 18:26-7.1 denies deductions against exempt property but does not
 * reallocate the exempt share to taxable beneficiaries — general deductions reduce the
 * net estate at the estate level and the result is distributed proportionally across all classes.
 *
 * Default scale = 1 so standalone calls (e.g. in tests) continue to work without a full
 * estate context.
 */
export function computeBeneficiaryTax(
  beneficiary: Beneficiary,
  ruleSet: RuleSet,
  deductionScale = 1,
): BeneficiaryTaxResult {
  const taxClass: TaxClass = beneficiary.taxClassOverride?.taxClass
    ?? classifyBeneficiary(beneficiary.relationship);

  // FND-MONEY: sum and scale in integer cents; expose dollars on the result.
  const totalBequeathedCents = beneficiary.bequests.reduce((sum, b) => sum + toCents(b.fairMarketValue), 0);
  // scaledCents = round(totalCents × scale). deductionScale is balanceCents/grossCents (a ratio);
  // for the default scale of 1 this is exactly totalBequeathedCents.
  const scaledCents = deductionScale === 1 ? totalBequeathedCents : roundCents(totalBequeathedCents * deductionScale);
  const totalBequeathed = fromCents(totalBequeathedCents);
  const scaledBequeathed = fromCents(scaledCents);

  const itRules = ruleSet.inheritanceTax;

  if (taxClass === 'A' || taxClass === 'E') {
    return {
      beneficiaryId: beneficiary.id,
      taxClass,
      totalBequeathed,
      scaledBequeathed,
      exemption: scaledBequeathed,
      taxableAmount: 0,
      taxDue: 0,
      brackets: [],
      ruleSetId: ruleSet.id,
    };
  }

  // Class D de minimis: check against SCALED amount (the actual allocation from the estate).
  // If scaledBequeathed < $500, no tax. If ≥ $500, the full scaled amount is taxable.
  // Source: IT-R Instructions — "if an individual beneficiary is receiving less than
  // $500 ($0-$499), there is no tax due on that amount."
  // Form display (confirmed from it-rinst.pdf): the IT-R Class D Beneficiary Worksheet
  // lists de minimis beneficiaries but shows $0 tax per the worksheet header note:
  // "If this amount is $499 or less, beneficiary has no tax."
  // No exemption line exists on the Class D worksheet — the de minimis is a tax FLOOR,
  // not a deduction. The IT-R Summary Page Line 13 shows: distribution / $0 exemption /
  // full taxable amount / $0 tax. buildTaxClassLine() computes this correctly (exemption=0,
  // totalTaxableAmount = totalDistribution). The per-beneficiary taxableAmount: 0 in
  // BeneficiaryTaxResult is an internal simplification that does not affect the tax output.
  // De minimis compared in cents: "< $500" ⇒ scaledCents < 50000 (i.e. ≤ $499.99).
  if (taxClass === 'D' && scaledCents < toCents(itRules.classD.deMinimusThreshold + 1)) {
    return {
      beneficiaryId: beneficiary.id,
      taxClass,
      totalBequeathed,
      scaledBequeathed,
      exemption: 0,
      taxableAmount: 0,
      taxDue: 0,
      brackets: [],
      ruleSetId: ruleSet.id,
    };
  }

  const rules = taxClass === 'C' ? itRules.classC : itRules.classD;
  // FND-CLASSC-EXEMPT (docs/IT-R-SPECIFICATION.md §4.2): the Class C exemption is
  // capped at the scaled bequest — min(scaled, $25,000) — never the flat $25,000.
  // Recording a full $25,000 exemption against a smaller scaled bequest makes the
  // Line-12 aggregate "Total Taxable Amount" (= distribution − exemption) understate
  // the true taxable base whenever Class C mixes below- and above-exemption
  // beneficiaries, so it disagrees with the per-beneficiary "Tax Due".
  const exemptionCents = taxClass === 'C'
    ? Math.min(scaledCents, toCents(itRules.classC.exemptionPerBeneficiary))
    : 0;
  const taxableCents = Math.max(0, scaledCents - exemptionCents);
  const bracketBreakdown = applyBrackets(taxableCents, rules.brackets);
  const taxDueCents = bracketBreakdown.reduce((sum, b) => sum + toCents(b.tax), 0);

  return {
    beneficiaryId: beneficiary.id,
    taxClass,
    totalBequeathed,
    scaledBequeathed,
    exemption: fromCents(exemptionCents),
    taxableAmount: fromCents(taxableCents),
    taxDue: fromCents(taxDueCents),
    brackets: bracketBreakdown,
    ruleSetId: ruleSet.id,
  };
}

function itExtensionMonths(ext: Matter['itExtension']): number {
  if (!ext?.firstExtension) return 0;
  return ext.secondExtension ? 6 : 4;
}

/**
 * Adds `months` calendar months to a YYYY-MM-DD date (UTC), returning YYYY-MM-DD,
 * WITHOUT the next-business-day shift. Interest accrues from the statutory 8-month date
 * (N.J.S.A. 54:35-3), not the business-day-shifted filing deadline: the official IT-R
 * interest worksheet accrues from the exact 8-month calendar date even when it is a
 * Saturday (e.g. 2024-05-18 in Example 2). See docs/IT-R-SPECIFICATION.md §6.1.
 */
function addMonthsNoShift(dateOfDeath: string, months: number): string {
  const d = new Date(dateOfDeath + 'T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * Days between two ISO dates (midnight-to-midnight, UTC).
 * Returns 0 when to < from (never negative).
 */
function daysBetween(from: string, to: string): number {
  const d1 = new Date(from + 'T12:00:00Z').getTime();
  const d2 = new Date(to + 'T12:00:00Z').getTime();
  return Math.max(0, Math.round((d2 - d1) / 86_400_000));
}

/**
 * Computes Line 18 interest (N.J.S.A. 54:35-3 — 10% per annum on unpaid tax) from
 * the 8-month payment deadline to the final payment date, reconciling prior payments,
 * using the **NJ capitalization method** (docs/IT-R-SPECIFICATION.md §6.1, decoded
 * verbatim from the it-rinst.pdf worked examples).
 *
 *   - A payment on or before the deadline reduces the starting balance before any
 *     interest accrues (no interest on it).
 *   - For each subsequent partial payment, in date order: accrue interest on the
 *     current balance to the payment date, ADD (capitalize) that accrued interest
 *     into the balance, THEN subtract the payment. The remaining balance — which may
 *     include unpaid interest — accrues interest going forward.
 *   - Line 18 is the sum of every period's accrued interest, with full precision
 *     carried between periods and a single floor-to-cents at the end — rounded DOWN in
 *     the client's favor (firm/owner direction). Rounding each sub-period first reproduces
 *     the state worksheet's display but not its published total; see §6.2.
 *   - A payment on or after the final payment date does not reduce interim interest
 *     (treated as paid at the end); a dateless legacy payment behaves the same way.
 *
 * The pre-Phase-2 engine used simple interest on a declining principal (it did NOT
 * capitalize accrued interest before applying a payment) and therefore under-reported
 * — ≈ $555.05 vs the official $558.71 on Example 2 (FND-INTEREST).
 */
function computeInterest(
  base: number,
  paymentDeadline: string,
  paymentDate: string,
  priorPayments: PriorPayment[],
): number {
  // Undated payments (coerced from a legacy scalar) carry no timing information and
  // are treated as paid at the end of the window — they never reduce interim interest.
  const dated = priorPayments.filter(
    (p): p is PriorPayment & { paidOn: string } => p.paidOn !== undefined,
  );

  // Payments made by the deadline reduce the balance before interest starts.
  let balance = base;
  for (const p of dated) {
    if (p.paidOn <= paymentDeadline) balance = Math.max(0, balance - p.amount);
  }

  // Payments strictly within the late window, applied in chronological order.
  const interim = dated
    .filter((p) => p.paidOn > paymentDeadline && p.paidOn < paymentDate)
    .sort((a, b) => (a.paidOn < b.paidOn ? -1 : a.paidOn > b.paidOn ? 1 : 0));

  let interest = 0;
  let cursor = paymentDeadline;
  for (const p of interim) {
    const accrued = balance * 0.10 * daysBetween(cursor, p.paidOn) / 365;
    interest += accrued;
    // NJ method: capitalize the accrued interest into the balance, THEN apply the
    // payment. Later periods therefore accrue interest on any unpaid interest too.
    balance = Math.max(0, balance + accrued - p.amount);
    cursor = p.paidOn;
  }
  interest += balance * 0.10 * daysBetween(cursor, paymentDate) / 365;
  // Round the final cent DOWN — in the client's favor (interest is a charge against the
  // estate, so flooring never overstates what the client owes). Per firm/owner direction.
  // On the official Example 2 the floored total still equals the published $558.71; on
  // Example 1 it is $191.43 (one cent under the state worksheet's $191.44, by policy).
  return Math.floor(interest * 100) / 100;
}

/**
 * Returns the effective beneficiary list with disclaimed bequests reallocated to
 * their alternate takers (N.J.A.C. 18:26-2.11). The original Matter is not mutated.
 * Tax computation uses these effective beneficiaries so the correct class distribution
 * is reflected on Lines 10-14 of the IT-R.
 */
function applyDisclaimers(matter: Matter): Matter['beneficiaries'] {
  if (!matter.disclaimers?.length) return matter.beneficiaries;

  const effectiveBequests = new Map<string, Bequest[]>();
  for (const b of matter.beneficiaries) {
    effectiveBequests.set(b.id, [...b.bequests]);
  }

  for (const d of matter.disclaimers) {
    const disclaimantBequests = effectiveBequests.get(d.disclaimantBeneficiaryId) ?? [];
    const disclaimedSet = new Set(d.bequestIds);
    effectiveBequests.set(
      d.disclaimantBeneficiaryId,
      disclaimantBequests.filter((b) => !disclaimedSet.has(b.id)),
    );
    const altBequests = effectiveBequests.get(d.alternativeTakerId) ?? [];
    effectiveBequests.set(
      d.alternativeTakerId,
      [...altBequests, ...disclaimantBequests.filter((b) => disclaimedSet.has(b.id))],
    );
  }

  return matter.beneficiaries.map((b) => ({
    ...b,
    bequests: effectiveBequests.get(b.id) ?? [],
  }));
}

const SCHEDULE_TYPES = {
  A: ['nj_real_property'],
  B: ['closely_held_business'],
  B1: ['bank_account', 'retirement_account'],
  B2: ['securities'],
  B3: ['bonds'],
  B4: ['virtual_currency', 'other_personal_property'],
  C: ['transfer'],
} as const satisfies Record<string, ReadonlyArray<BequestType>>;

function collectScheduleItems(
  matter: Matter,
  types: ReadonlyArray<BequestType>,
): ScheduleItem[] {
  const typeSet = new Set<string>(types);
  const items: ScheduleItem[] = [];
  for (const b of matter.beneficiaries) {
    const name = `${b.firstName} ${b.lastName}`;
    for (const bequest of b.bequests) {
      if (typeSet.has(bequest.type)) {
        items.push({
          id: bequest.id,
          beneficiaryName: name,
          description: bequest.description,
          fairMarketValue: bequest.fairMarketValue,
        });
      }
    }
  }
  return items;
}

/**
 * Builds the frozen, form-facing view of the Matter (FND-IMMUT — see
 * docs/IT-R-SPECIFICATION.md §10). Captured at compute time so an approved IT-R renders
 * only from this snapshot and never re-reads the mutable Matter.
 *
 * Exported so the IT-R builder can reconstruct an equivalent view for LEGACY approved
 * snapshots that predate enrichment (those lack `formSnapshot`), preserving their render.
 */
export function buildFormSnapshot(matter: Matter): ITRFormSnapshot {
  const beneficiaryNameById = new Map<string, string>();
  const bequestDescriptionById = new Map<string, string>();
  for (const b of matter.beneficiaries) {
    beneficiaryNameById.set(b.id, `${b.firstName} ${b.lastName}`);
    for (const beq of b.bequests) bequestDescriptionById.set(beq.id, beq.description);
  }

  const disclaimerSchedule: DisclaimerScheduleItem[] = (matter.disclaimers ?? []).map((d) => ({
    id: d.id,
    disclaimantName: beneficiaryNameById.get(d.disclaimantBeneficiaryId) ?? d.disclaimantBeneficiaryId,
    bequestDescriptions: d.bequestIds.map((bId) => bequestDescriptionById.get(bId) ?? bId),
    dateDisclaimed: d.dateDisclaimed,
    notes: d.notes,
  }));

  const scheduleD: ScheduleDeductionItem[] = matter.deductions.map((d) => ({
    id: d.id,
    type: d.type,
    description: d.description,
    amount: d.amount,
    // Conditional so a deduction without a payee stores no key at all — Firestore rejects an
    // explicit undefined.
    ...(d.payeeName !== undefined ? { payeeName: d.payeeName } : {}),
    ...(d.executorCommissionEligibility !== undefined
      ? { executorCommissionEligibility: d.executorCommissionEligibility }
      : {}),
    ...(d.transferTaxEligibility !== undefined
      ? { transferTaxEligibility: d.transferTaxEligibility }
      : {}),
  }));

  return {
    decedent: {
      lastName: matter.decedent.lastName,
      firstName: matter.decedent.firstName,
      ...(matter.decedent.middleName !== undefined ? { middleName: matter.decedent.middleName } : {}),
      ...(matter.decedent.aka !== undefined ? { aka: matter.decedent.aka } : {}),
      ssn: matter.decedent.ssn,
      dateOfDeath: matter.decedent.dateOfDeath,
      countyOfResidence: matter.decedent.countyOfResidence,
      isNJResident: matter.decedent.isNJResident ?? true,
    },
    willExists: matter.willExists,
    trustExists: matter.trustExists,
    federalReturnFiled: matter.federalReturnFiled,
    virtualCurrencyExists: matter.virtualCurrencyExists,
    disclaimersExist: matter.disclaimersExist,
    representative: matter.personalRepresentative,
    beneficiaries: matter.beneficiaries.map((b) => ({
      id: b.id,
      firstName: b.firstName,
      lastName: b.lastName,
      address: b.address,
      // Conditional so a beneficiary without structured parts stores no key at all —
      // Firestore rejects an explicit undefined.
      ...(b.addressParts !== undefined ? { addressParts: b.addressParts } : {}),
      relationship: b.relationship,
      isSpouseOrCU: b.relationship === 'spouse' || b.relationship === 'civil_union_partner',
    })),
    scheduleA: collectScheduleItems(matter, SCHEDULE_TYPES.A),
    scheduleB: collectScheduleItems(matter, SCHEDULE_TYPES.B),
    scheduleB1: collectScheduleItems(matter, SCHEDULE_TYPES.B1),
    scheduleB2: collectScheduleItems(matter, SCHEDULE_TYPES.B2),
    scheduleB3: collectScheduleItems(matter, SCHEDULE_TYPES.B3),
    scheduleB4: collectScheduleItems(matter, SCHEDULE_TYPES.B4),
    scheduleC: collectScheduleItems(matter, SCHEDULE_TYPES.C),
    scheduleD,
    disclaimerSchedule,
  };
}

export function computeEstate(
  matter: Matter,
  ruleSet: RuleSet,
): Omit<EstateComputation, 'computedAt'> {
  // Phase 0 guardrail: a nonresident decedent is out of scope, and the refusal belongs HERE
  // rather than only at form generation. NJ taxes a nonresident's estate on NJ-situs real and
  // tangible property alone (N.J.A.C. 18:26-2.15), while this engine values every bequest in the
  // matter. Computing anyway produces a resident-basis figure that is simply wrong for a
  // nonresident — and putting a confident wrong number in front of an attorney is the failure
  // this engine exists to avoid. Refuse, exactly as for deductions exceeding the estate.
  if (matter.decedent.isNJResident === false) {
    throw new UnsupportedMatterError(
      `Matter '${matter.matterId}': the decedent was a nonresident of New Jersey. ` +
      'NJ taxes a nonresident estate only on NJ-situs real and tangible personal property ' +
      '(N.J.A.C. 18:26-2.15) and requires Form IT-NR, neither of which this engine models. ' +
      'No figure is produced rather than a resident-basis one that would be wrong.',
    );
  }

  // Disclaimed bequests are reallocated to alternate takers before any computation
  // so Lines 10-14 reflect the correct post-disclaimer class distribution (N.J.A.C. 18:26-2.11).
  const effectiveBeneficiaries = applyDisclaimers(matter);

  // FND-MONEY: estate totals are aggregated in integer cents so summing FMVs and
  // subtracting deductions never drifts. Dollar values are derived at the end.
  const grossEstateCents = effectiveBeneficiaries
    .flatMap((b) => b.bequests)
    .reduce((sum, b) => sum + toCents(b.fairMarketValue), 0);
  const totalDeductionsCents = matter.deductions.reduce((sum, d) => sum + toCents(d.amount), 0);
  // FND-VALIDATION / FND-DISTRIB (docs/IT-R-SPECIFICATION.md §5): a net estate cannot
  // be negative. Silently clamping to 0 when deductions exceed the gross estate hides a
  // data or apportionment error and would produce a self-consistent but wrong return.
  // Refuse instead — this matter needs attorney attention, not a fabricated $0 net estate.
  if (totalDeductionsCents > grossEstateCents) {
    throw new UnsupportedMatterError(
      `Matter '${matter.matterId}': total deductions ($${fromCents(totalDeductionsCents).toLocaleString('en-US')}) ` +
      `exceed the gross estate ($${fromCents(grossEstateCents).toLocaleString('en-US')}). The engine will not ` +
      'silently clamp the net estate to $0; resolve the deductions or apportionment before ' +
      'computing (docs/IT-R-SPECIFICATION.md §5).',
    );
  }
  const netEstateCents = Math.max(0, grossEstateCents - totalDeductionsCents);
  const grossEstate = fromCents(grossEstateCents);
  const totalDeductions = fromCents(totalDeductionsCents);
  const netEstate = fromCents(netEstateCents);

  // Capture attorney-provided inputs now so contingentAmounts feeds into the scale.
  const contingentAmounts = matter.contingentAmounts ?? 0;
  // Line 9 balance. Held in cents only — the per-beneficiary scale is a cents ratio, so the
  // dollars conversion had no consumer.
  const balanceOfEstateCents = Math.max(0, netEstateCents - toCents(contingentAmounts));

  // Per N.J.A.C. 18:26-1.1 and the IT-R (12-24) Summary Page:
  // deductions are applied at the estate level; the resulting balance (Line 9) is
  // distributed proportionally across all classes. Tax brackets are applied to each
  // beneficiary's proportional share of the balance, not their gross FMV. The scale is a
  // cents ratio; per-beneficiary scaling is done in cents (see computeBeneficiaryTax).
  const deductionScale = grossEstateCents > 0 ? balanceOfEstateCents / grossEstateCents : 0;

  const beneficiaryResults = effectiveBeneficiaries.map((b) =>
    computeBeneficiaryTax(b, ruleSet, deductionScale),
  );

  // Sum tax in cents (each result's taxDue is already cent-exact) to avoid float drift.
  const totalTaxDue = fromCents(beneficiaryResults.reduce((sum, r) => sum + toCents(r.taxDue), 0));
  const filingDeadline = computeFilingDeadline(
    matter.decedent.dateOfDeath,
    ruleSet.filingDeadlineMonths,
  );
  const extMonths = itExtensionMonths(matter.itExtension);
  const extendedFilingDeadline = extMonths > 0
    ? computeFilingDeadline(matter.decedent.dateOfDeath, ruleSet.filingDeadlineMonths + extMonths)
    : null;

  // Interest auto-computation (N.J.S.A. 54:35-3: 10% per annum from payment deadline).
  // FND-CONTINGENT (docs/IT-R-SPECIFICATION.md §6.4): the Line-18 base is the DIRECT tax
  // only (totalTaxDue). Contingent tax (Line 16) is EXCLUDED — per the IT-R instructions
  // no interest accrues on contingent tax until eight months after death, and it carries
  // its own award-triggered due date the engine cannot know; the attorney computes that
  // interest separately. Compromise tax (Line 15) is likewise excluded (no interest on it).
  // Prior payments reduce the unpaid balance per period (see computeInterest). If
  // paymentDate is absent, use attorney-provided interestDue.
  const paymentDate = matter.paymentDate ?? null;
  const contingentTax = matter.contingentTax ?? 0;
  const priorPayments = matter.priorPayments ?? [];
  // Interest accrues from the RAW statutory 8-month date, not the business-day-shifted
  // filing deadline (docs/IT-R-SPECIFICATION.md §6.1; addMonthsNoShift). When the 8-month
  // date is a business day these coincide.
  const interestStart = addMonthsNoShift(matter.decedent.dateOfDeath, ruleSet.filingDeadlineMonths);
  let interestDue: number;
  if (paymentDate !== null) {
    interestDue = computeInterest(totalTaxDue, interestStart, paymentDate, priorPayments);
  } else {
    interestDue = matter.interestDue ?? 0;
  }

  return {
    matterId: matter.matterId,
    ruleSetId: ruleSet.id,
    grossEstate,
    totalDeductions,
    netEstate,
    beneficiaryResults,
    totalTaxDue,
    matterInputs: {
      contingentAmounts,
      compromiseTax: matter.compromiseTax ?? 0,
      contingentTax,
      interestDue,
      priorPayments,
      paymentDate,
      itExtension: matter.itExtension ?? null,
    },
    filingDeadline,
    extendedFilingDeadline,
    njEstateTax: computeNJEstateTax(matter, ruleSet),
    // FND-IMMUT: freeze the form-facing Matter view so the approved IT-R renders only from here.
    formSnapshot: buildFormSnapshot(matter),
  };
}
