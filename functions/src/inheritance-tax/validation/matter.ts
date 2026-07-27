import { z } from 'zod';
import type { ISODate, Matter, Relationship } from '../types';

// ─── Primitives ───────────────────────────────────────────────────────────────

const ISODateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format')
  // Two-step calendar check: isNaN guard (rejects non-parseable strings) +
  // round-trip (JS rolls Feb 30 → Mar 1 without NaN, so we re-format and compare).
  // Zod v3 runs all refinements even if earlier ones fail, so the guard is required.
  .refine((s) => {
    const d = new Date(s + 'T12:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Must be a valid calendar date');

// Reusable non-blank string — rejects empty strings and whitespace-only input.
// Used for fields that must carry meaningful content for audit integrity.
const NonBlankString = z
  .string()
  .refine((s) => s.trim().length > 0, 'Must not be blank or whitespace only');

/**
 * Adds `months` calendar months to a YYYY-MM-DD date (UTC), returning YYYY-MM-DD.
 * Uses JS month overflow, consistent with the engine's deadline arithmetic.
 * Used for the 9-month qualified-disclaimer deadline (I.R.C. §2518; N.J.A.C. 18:26-2.11).
 */
function addMonthsISO(date: ISODate, months: number): ISODate {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

// SSN format check only — value is not exposed in error messages
const SSNSchema = z
  .string()
  .regex(/^\d{3}-\d{2}-\d{4}$/, 'SSN must be in NNN-NN-NNNN format');

const NJCountySchema = z.enum([
  'Atlantic', 'Bergen', 'Burlington', 'Camden', 'Cape May',
  'Cumberland', 'Essex', 'Gloucester', 'Hudson', 'Hunterdon',
  'Mercer', 'Middlesex', 'Monmouth', 'Morris', 'Ocean',
  'Passaic', 'Salem', 'Somerset', 'Sussex', 'Union', 'Warren',
]);

const RelationshipSchema = z.enum([
  // Class A
  'spouse', 'civil_union_partner', 'domestic_partner',
  'child', 'stepchild', 'grandchild', 'great_grandchild',
  'parent', 'grandparent', 'mutually_acknowledged_child',
  // Class C
  'sibling', 'child_in_law', 'child_civil_union_partner',
  // Class D
  'niece_nephew', 'aunt_uncle', 'cousin',
  'step_grandchild', 'stepbrother_stepsister', 'stepparent',
  'stepchild_in_law', 'mutually_acknowledged_child_in_law',
  'ex_spouse', 'friend',
  'non_certified_domestic_partner', 'corporation_non_charitable',
  'other_individual',
  // Class E
  'charity', 'religious_organization', 'educational_organization',
  'medical_institution', 'governmental_entity',
]);

const BequestTypeSchema = z.enum([
  'nj_real_property', 'closely_held_business', 'bank_account',
  'securities', 'bonds', 'retirement_account', 'virtual_currency',
  'other_personal_property', 'transfer',
]);

const DeductionTypeSchema = z.enum([
  'funeral_expenses', 'last_illness_expenses',
  'administration_expenses', 'debt_of_decedent',
  'mortgage', 'executor_commission', 'attorney_fee', 'accounting_fee',
  'accrued_property_taxes', 'transfer_taxes_other_states',
  'other',
]);

const TaxClassSchema = z.enum(['A', 'C', 'D', 'E']);

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

// FND-STRICT: every object schema is `.strict()` so a misspelled legal field (e.g.
// "fairMarketVaule", "dateOfDeth") is REJECTED at the boundary instead of being silently
// stripped and replaced by a default/undefined. Unknown keys are a data-entry error on a
// legal form, never something to swallow.
const DecedentSchema = z.object({
  lastName: z.string().min(1),
  firstName: z.string().min(1),
  middleName: z.string().optional(),
  aka: z.string().optional(),
  ssn: SSNSchema,
  dateOfDeath: ISODateSchema.refine(
    (d) => d >= '2002-01-01',
    'Dates of death before 2002-01-01 are not supported — earliest rule set is 2002-01-01',
  ),
  countyOfResidence: NJCountySchema,
  isNJResident: z.boolean().optional(),
}).strict();

const BequestSchema = z.object({
  id: z.string().min(1),
  type: BequestTypeSchema,
  description: z.string().min(1),
  fairMarketValue: z.number().finite().nonnegative('Fair market value must be ≥ 0'),
}).strict();

const TaxClassOverrideSchema = z.object({
  taxClass: TaxClassSchema,
  // NonBlankString rejects whitespace-only values that would bypass audit requirements
  reason: NonBlankString,
  overriddenBy: NonBlankString,
  overriddenAt: z.string().datetime({ offset: true }),
}).strict();

// Entity (non-natural-person) beneficiaries carry their full name in `lastName` and have
// no first name (e.g. a charity or corporation). Individuals must have a first name — see
// the FND-VALIDATION superRefine below.
const ENTITY_RELATIONSHIPS: ReadonlySet<Relationship> = new Set<Relationship>([
  'charity', 'religious_organization', 'educational_organization',
  'medical_institution', 'governmental_entity', 'corporation_non_charitable',
]);

/**
 * Structured address, as the official forms want it. Optional wherever it appears: a matter
 * created before intake captured the parts carries only the free-text `address`, and must keep
 * validating. When present the parts are authoritative, so each is required to be non-blank —
 * a half-filled parts object would put an empty box on a filed return, which is worse than
 * falling back to the string.
 *
 * `state` is the two-letter USPS abbreviation; `zip` is 5 or 5+4.
 */
const AddressPartsSchema = z.object({
  street1: z.string().min(1),
  street2: z.string().min(1).optional(),
  city: z.string().min(1),
  state: z.string().regex(/^[A-Z]{2}$/, 'State must be a two-letter abbreviation'),
  zip: z.string().regex(/^\d{5}(-\d{4})?$/, 'ZIP must be 5 digits, or 5+4'),
}).strict();

const BeneficiarySchema = z.object({
  id: z.string().min(1),
  lastName: z.string().min(1),
  // Non-empty enforced for INDIVIDUALS in the superRefine (entities legitimately have none).
  firstName: z.string(),
  address: z.string().min(1),
  addressParts: AddressPartsSchema.optional(),
  relationship: RelationshipSchema,
  taxClassOverride: TaxClassOverrideSchema.optional(),
  bequests: z.array(BequestSchema).min(1, 'A beneficiary must have at least one bequest'),
}).strict();

const ExecutorCommissionEligibilitySchema = z.object({
  propertyWasResidueNotSpecificallyDevised: z.boolean(),
  propertyWasSoldByExecutor: z.boolean(),
  notes: NonBlankString,
}).strict();

const TransferTaxEligibilitySchema = z.object({
  taxedPropertyIsAlsoNJTaxable: z.boolean(),
  taxingJurisdiction: NonBlankString,
  notes: NonBlankString,
}).strict();

const DeductionSchema = z.object({
  id: z.string().min(1),
  type: DeductionTypeSchema,
  description: z.string().min(1),
  amount: z.number().finite().positive('Deduction amount must be > 0'),
  // Schedule D column (B). Optional — a matter entered before this field existed has no payee,
  // and a blank column is honest where a guessed name would not be.
  payeeName: z.string().min(1).optional(),
  executorCommissionEligibility: ExecutorCommissionEligibilitySchema.optional(),
  transferTaxEligibility: TransferTaxEligibilitySchema.optional(),
}).strict();

const DisclaimerSchema = z.object({
  id: z.string().min(1),
  disclaimantBeneficiaryId: z.string().min(1),
  alternativeTakerId: z.string().min(1),
  bequestIds: z.array(z.string().min(1)).min(1, 'A disclaimer must reference at least one bequest'),
  dateDisclaimed: ISODateSchema,
  notes: NonBlankString,
}).strict();

const PersonalRepresentativeSchema = z.object({
  name: z.string().min(1),
  title: z.enum(['Executor', 'Administrator', 'Heir-at-law']),
  address: z.string().min(1),
  addressParts: AddressPartsSchema.optional(),
  phone: z.string().min(1),
  email: z.string().email().optional(),
}).strict();

// ─── Matter schema (top-level boundary validator) ─────────────────────────────

// A single dated prior payment (IT-R Line 20). Amount must be strictly positive —
// a zero-amount payment is meaningless and rejected. Use an empty array (or omit
// the field) to represent "no prior payments."
const PriorPaymentSchema = z.object({
  id: NonBlankString,
  amount: z.number().finite().positive('Prior payment amount must be > 0'),
  paidOn: ISODateSchema,
}).strict();

// Synthetic id assigned when coercing a legacy scalar priorPayments into the array form.
const LEGACY_PRIOR_PAYMENT_ID = 'legacy-prior-payment';

// Relationship types created by NJ civil-union / domestic-partnership law. These
// statuses did not legally exist before the governing act took effect, so applying
// them to an earlier death would silently grant an incorrect class treatment (a
// Class A exemption for the partner relationships, Class C for a child's CU partner).
// Verified effective dates:
//   NJ Domestic Partnership Act, P.L. 2003, c. 246 (N.J.S.A. 26:8A-1 et seq.) — 2004-07-10.
//   NJ Civil Union Act, P.L. 2006, c. 103 (N.J.S.A. 37:1-28 et seq.) — 2007-02-19.
const RELATIONSHIP_EFFECTIVE_DATES: Partial<
  Record<Relationship, { date: ISODate; citation: string }>
> = {
  domestic_partner: { date: '2004-07-10', citation: 'N.J.S.A. 26:8A-1 et seq.' },
  civil_union_partner: { date: '2007-02-19', citation: 'N.J.S.A. 37:1-28 et seq.' },
  child_civil_union_partner: { date: '2007-02-19', citation: 'N.J.S.A. 37:1-28 et seq.' },
};

export const MatterSchema = z.object({
  matterId: z.string().min(1),
  // Object-level authorization (audit #43): stamped by the API from the authenticated
  // identity on POST /matters — a client-supplied value is overwritten server-side.
  // Optional so pre-fix matters and store-injected fixtures keep validating.
  ownerBarId: NonBlankString.optional(),
  // FND-AUTHZ: stamped by the API from the creating attorney's firm (token-derived);
  // a client-supplied value is overwritten server-side. Optional for legacy/fixtures.
  firmId: NonBlankString.optional(),
  createdAt: z.string().datetime({ offset: true }),
  decedent: DecedentSchema,
  willExists: z.boolean(),
  trustExists: z.boolean(),
  federalReturnFiled: z.boolean(),
  virtualCurrencyExists: z.boolean(),
  disclaimersExist: z.boolean(),
  personalRepresentative: PersonalRepresentativeSchema,
  beneficiaries: z.array(BeneficiarySchema),
  deductions: z.array(DeductionSchema),
  disclaimers: z.array(DisclaimerSchema).optional(),
  contingentAmounts: z.number().finite().nonnegative('Contingent amounts must be ≥ 0').optional(),
  compromiseTax: z.number().finite().nonnegative('Compromise tax must be ≥ 0').optional(),
  contingentTax: z.number().finite().nonnegative('Contingent tax must be ≥ 0').optional(),
  interestDue: z.number().finite().nonnegative('Interest due must be ≥ 0').optional(),
  paymentDate: ISODateSchema.optional(),
  // Accepts the new dated array OR a legacy scalar total (coerced to a single
  // dateless payment by the transform below). The scalar permits 0 (= no payments).
  priorPayments: z.union([
    z.number().finite().nonnegative('Prior payments must be ≥ 0'),
    z.array(PriorPaymentSchema),
  ]).optional(),
  notes: z.string().optional(),
  itExtension: z.object({
    firstExtension: z.boolean(),
    secondExtension: z.boolean().optional(),
    reason: NonBlankString.optional(),
  }).strict().refine(
    (v) => !v.secondExtension || v.firstExtension,
    { message: 'secondExtension requires firstExtension to be true (N.J.A.C. 18:26-9.1(b))' },
  ).optional(),
}).strict().superRefine((m, ctx) => {
  // FND-DUPIDS: duplicate identifiers are rejected. A duplicate beneficiary/deduction/
  // bequest/disclaimer id would make downstream joins (result-by-id, disclaimer
  // reallocation, schedule/worksheet rows) ambiguous and silently drop or double-count a
  // party — a correctness hazard on a legal form, not a cosmetic issue.
  const seenBeneficiaryIds = new Set<string>();
  const seenBequestIds = new Set<string>();
  for (const [i, b] of m.beneficiaries.entries()) {
    if (seenBeneficiaryIds.has(b.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate beneficiary id '${b.id}'`, path: ['beneficiaries', i, 'id'] });
    }
    seenBeneficiaryIds.add(b.id);
    for (const [j, beq] of b.bequests.entries()) {
      // Bequest ids must be unique across the WHOLE matter — disclaimers and schedules
      // reference them by id without qualifying which beneficiary they belong to.
      if (seenBequestIds.has(beq.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate bequest id '${beq.id}' (bequest ids must be unique across the matter)`, path: ['beneficiaries', i, 'bequests', j, 'id'] });
      }
      seenBequestIds.add(beq.id);
    }
  }
  const seenDeductionIds = new Set<string>();
  for (const [i, d] of m.deductions.entries()) {
    if (seenDeductionIds.has(d.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate deduction id '${d.id}'`, path: ['deductions', i, 'id'] });
    }
    seenDeductionIds.add(d.id);
  }
  const seenDisclaimerIds = new Set<string>();
  for (const [i, d] of (m.disclaimers ?? []).entries()) {
    if (seenDisclaimerIds.has(d.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate disclaimer id '${d.id}'`, path: ['disclaimers', i, 'id'] });
    }
    seenDisclaimerIds.add(d.id);
  }

  // Civil-union / domestic-partner relationships are invalid for a death before the
  // governing statute's effective date — using one on an earlier death would otherwise
  // produce an incorrect tax class silently.
  for (const [i, b] of m.beneficiaries.entries()) {
    const gate = RELATIONSHIP_EFFECTIVE_DATES[b.relationship];
    if (gate !== undefined && m.decedent.dateOfDeath < gate.date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `Relationship '${b.relationship}' is not valid for a date of death before ` +
          `${gate.date} (${gate.citation}, eff. ${gate.date})`,
        path: ['beneficiaries', i, 'relationship'],
      });
    }
    // FND-VALIDATION: an individual beneficiary must have a non-blank first name; a blank
    // one otherwise flows straight onto the IT-R cover page, schedules, and worksheets.
    // Entities (charity, corporation, governmental body, …) carry their name in lastName
    // and are exempt from this check.
    if (!ENTITY_RELATIONSHIPS.has(b.relationship) && b.firstName.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'An individual beneficiary must have a non-blank firstName',
        path: ['beneficiaries', i, 'firstName'],
      });
    }
  }

  // R.2025 d.152 (eff. 2025-12-15) restricted executor commission eligibility.
  // Only enforce the attestation requirement for matters within that rule set's scope.
  if (m.decedent.dateOfDeath >= '2025-12-15') {
    for (const [i, d] of m.deductions.entries()) {
      if (d.type !== 'executor_commission') continue;
      if (!d.executorCommissionEligibility) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'executor_commission deductions require an executorCommissionEligibility attestation (N.J.A.C. 18:26-7.10(d), R.2025 d.152)',
          path: ['deductions', i, 'executorCommissionEligibility'],
        });
        continue;
      }
      if (!d.executorCommissionEligibility.propertyWasResidueNotSpecificallyDevised) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Executor commission is not allowable for specifically devised real estate (N.J.A.C. 18:26-7.10(d), R.2025 d.152)',
          path: ['deductions', i, 'executorCommissionEligibility', 'propertyWasResidueNotSpecificallyDevised'],
        });
      }
      if (!d.executorCommissionEligibility.propertyWasSoldByExecutor) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Executor commission requires the executor/representative to have made the sale on behalf of the estate (N.J.A.C. 18:26-7.10(d), R.2025 d.152)',
          path: ['deductions', i, 'executorCommissionEligibility', 'propertyWasSoldByExecutor'],
        });
      }
    }
  }

  // N.J.A.C. 18:26-7.16 — transfer/inheritance taxes paid to other jurisdictions
  // are deductible ONLY when the property they were assessed on is ALSO subject to
  // NJ Transfer Inheritance Tax. This rule applies to all dates.
  for (const [i, d] of m.deductions.entries()) {
    if (d.type !== 'transfer_taxes_other_states') continue;
    if (!d.transferTaxEligibility) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'transfer_taxes_other_states deductions require a transferTaxEligibility attestation (N.J.A.C. 18:26-7.16)',
        path: ['deductions', i, 'transferTaxEligibility'],
      });
      continue;
    }
    if (!d.transferTaxEligibility.taxedPropertyIsAlsoNJTaxable) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Transfer/inheritance taxes paid to another jurisdiction are deductible ONLY when the taxed property is also subject to NJ Transfer Inheritance Tax (N.J.A.C. 18:26-7.16)',
        path: ['deductions', i, 'transferTaxEligibility', 'taxedPropertyIsAlsoNJTaxable'],
      });
    }
  }

  // Prior payment schedule checks (array form only; the legacy scalar is coerced later).
  if (Array.isArray(m.priorPayments)) {
    const today = new Date().toISOString().slice(0, 10);
    const seen = new Set<string>();
    for (const [i, p] of m.priorPayments.entries()) {
      if (seen.has(p.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate prior payment id '${p.id}'`,
          path: ['priorPayments', i, 'id'],
        });
      }
      seen.add(p.id);
      if (p.paidOn < m.decedent.dateOfDeath) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Prior payment paidOn cannot be before the decedent date of death',
          path: ['priorPayments', i, 'paidOn'],
        });
      }
      if (p.paidOn > today) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Prior payment paidOn cannot be a future date',
          path: ['priorPayments', i, 'paidOn'],
        });
      }
      if (m.paymentDate !== undefined && p.paidOn > m.paymentDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Prior payment paidOn cannot be after the final paymentDate',
          path: ['priorPayments', i, 'paidOn'],
        });
      }
    }
  }

  // Disclaimer cross-validation (N.J.A.C. 18:26-2.11)
  if (m.disclaimers !== undefined && m.disclaimers.length > 0) {
    if (!m.disclaimersExist) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'disclaimersExist must be true when structured disclaimers are present',
        path: ['disclaimersExist'],
      });
    }
    const beneficiaryBequestIds = new Map<string, Set<string>>();
    for (const b of m.beneficiaries) {
      beneficiaryBequestIds.set(b.id, new Set(b.bequests.map((beq) => beq.id)));
    }
    for (const [i, d] of m.disclaimers.entries()) {
      if (!beneficiaryBequestIds.has(d.disclaimantBeneficiaryId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `disclaimantBeneficiaryId '${d.disclaimantBeneficiaryId}' does not reference a beneficiary in this matter`,
          path: ['disclaimers', i, 'disclaimantBeneficiaryId'],
        });
        continue;
      }
      if (!beneficiaryBequestIds.has(d.alternativeTakerId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `alternativeTakerId '${d.alternativeTakerId}' does not reference a beneficiary in this matter`,
          path: ['disclaimers', i, 'alternativeTakerId'],
        });
      }
      if (d.alternativeTakerId === d.disclaimantBeneficiaryId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'alternativeTakerId must differ from disclaimantBeneficiaryId',
          path: ['disclaimers', i, 'alternativeTakerId'],
        });
      }
      const bequestSet = beneficiaryBequestIds.get(d.disclaimantBeneficiaryId) ?? new Set<string>();
      for (const [j, bId] of d.bequestIds.entries()) {
        if (!bequestSet.has(bId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `bequestId '${bId}' does not reference a bequest on beneficiary '${d.disclaimantBeneficiaryId}'`,
            path: ['disclaimers', i, 'bequestIds', j],
          });
        }
      }
      if (d.dateDisclaimed < m.decedent.dateOfDeath) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'dateDisclaimed cannot be before decedent.dateOfDeath',
          path: ['disclaimers', i, 'dateDisclaimed'],
        });
      }
      // FND-VALIDATION (docs/IT-R-SPECIFICATION.md §7): a disclaimer is honored as a
      // qualified disclaimer only if executed within 9 months of death (I.R.C. §2518;
      // N.J.A.C. 18:26-2.11). A later disclaimer is a taxable transfer from the
      // disclaimant — a structure this engine does not model — so it is rejected rather
      // than silently reallocated to the alternate taker's tax class.
      const qualifiedBy = addMonthsISO(m.decedent.dateOfDeath, 9);
      if (d.dateDisclaimed > qualifiedBy) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            `dateDisclaimed '${d.dateDisclaimed}' is past the 9-month qualified-disclaimer ` +
            `deadline (${qualifiedBy}) measured from the date of death ` +
            `(I.R.C. §2518; N.J.A.C. 18:26-2.11)`,
          path: ['disclaimers', i, 'dateDisclaimed'],
        });
      }
    }
  }
}).transform((m) => {
  // Normalize the legacy scalar priorPayments into the canonical array. A scalar
  // carries no payment date, so the coerced payment is left dateless rather than
  // fabricating one — an undated payment does not reduce interim Line 18 interest,
  // matching the historical scalar behavior. A scalar of 0 means "no payments."
  if (typeof m.priorPayments !== 'number') return m;
  const coerced = m.priorPayments > 0
    ? [{ id: LEGACY_PRIOR_PAYMENT_ID, amount: m.priorPayments }]
    : [];
  return { ...m, priorPayments: coerced };
});

export type ValidatedMatter = z.infer<typeof MatterSchema>;

/**
 * Validates a raw input object as a Matter at the system boundary.
 * Throws a ZodError with structured field-level errors on failure.
 * Call this before passing data to the computation engine.
 *
 * Returns Matter rather than ValidatedMatter: Zod v3 infers optional fields as
 * `T | undefined`, which is incompatible with exactOptionalPropertyTypes. The
 * runtime values are identical — the cast is safe.
 */
export function validateMatter(input: unknown): Matter {
  return MatterSchema.parse(input) as unknown as Matter;
}
