/**
 * Frontend types for the NJ Transfer Inheritance Tax (IT-R) workflow.
 *
 * These mirror the engine's input shape (`functions/src/inheritance-tax/types.ts`) rather than
 * importing it: the frontend and functions build separately, and the engine's module is not part
 * of the frontend bundle. The server re-validates everything with the real Zod schema, so this
 * file is an editing convenience — **it is not the source of truth**. If the two ever disagree,
 * the server wins and the save is rejected with the schema's own message.
 *
 * The enums below are the load-bearing part. `relationship` in particular determines the
 * beneficiary's tax class under N.J.S.A. 54:34-2 — get it wrong and the figures are wrong without
 * anything erroring, which is why the picker offers the classes explicitly rather than free text.
 */

export type NJCounty =
  | 'Atlantic' | 'Bergen' | 'Burlington' | 'Camden' | 'Cape May'
  | 'Cumberland' | 'Essex' | 'Gloucester' | 'Hudson' | 'Hunterdon'
  | 'Mercer' | 'Middlesex' | 'Monmouth' | 'Morris' | 'Ocean'
  | 'Passaic' | 'Salem' | 'Somerset' | 'Sussex' | 'Union' | 'Warren';

export const NJ_COUNTIES: readonly NJCounty[] = [
  'Atlantic', 'Bergen', 'Burlington', 'Camden', 'Cape May',
  'Cumberland', 'Essex', 'Gloucester', 'Hudson', 'Hunterdon',
  'Mercer', 'Middlesex', 'Monmouth', 'Morris', 'Ocean',
  'Passaic', 'Salem', 'Somerset', 'Sussex', 'Union', 'Warren',
] as const;

export type Relationship =
  | 'spouse' | 'civil_union_partner' | 'domestic_partner' | 'child' | 'stepchild'
  | 'grandchild' | 'great_grandchild' | 'parent' | 'grandparent' | 'mutually_acknowledged_child'
  | 'sibling' | 'child_in_law' | 'child_civil_union_partner'
  | 'niece_nephew' | 'aunt_uncle' | 'cousin' | 'step_grandchild' | 'stepbrother_stepsister'
  | 'stepparent' | 'stepchild_in_law' | 'mutually_acknowledged_child_in_law' | 'ex_spouse'
  | 'friend' | 'non_certified_domestic_partner' | 'corporation_non_charitable' | 'other_individual'
  | 'charity' | 'religious_organization' | 'educational_organization' | 'medical_institution'
  | 'governmental_entity';

/** Grouped for the picker, because the group IS the tax consequence. */
export const RELATIONSHIP_GROUPS: ReadonlyArray<{
  label: string;
  options: ReadonlyArray<{ value: Relationship; label: string }>;
}> = [
  {
    label: 'Class A — exempt',
    options: [
      { value: 'spouse', label: 'Spouse' },
      { value: 'civil_union_partner', label: 'Civil union partner' },
      { value: 'domestic_partner', label: 'Domestic partner (certified)' },
      { value: 'child', label: 'Child' },
      { value: 'stepchild', label: 'Stepchild' },
      { value: 'grandchild', label: 'Grandchild' },
      { value: 'great_grandchild', label: 'Great-grandchild' },
      { value: 'parent', label: 'Parent' },
      { value: 'grandparent', label: 'Grandparent' },
      { value: 'mutually_acknowledged_child', label: 'Mutually acknowledged child' },
    ],
  },
  {
    label: 'Class C — $25,000 exemption, then 11%–16%',
    options: [
      { value: 'sibling', label: 'Sibling (incl. half-sibling)' },
      { value: 'child_in_law', label: 'Child-in-law (son/daughter-in-law)' },
      { value: 'child_civil_union_partner', label: "Child's civil union partner" },
    ],
  },
  {
    label: 'Class D — 15%–16%, no exemption',
    options: [
      { value: 'niece_nephew', label: 'Niece / nephew' },
      { value: 'aunt_uncle', label: 'Aunt / uncle' },
      { value: 'cousin', label: 'Cousin' },
      { value: 'step_grandchild', label: 'Step-grandchild' },
      { value: 'stepbrother_stepsister', label: 'Stepbrother / stepsister' },
      { value: 'stepparent', label: 'Stepparent' },
      { value: 'stepchild_in_law', label: "Stepchild's spouse" },
      { value: 'mutually_acknowledged_child_in_law', label: "Mutually acknowledged child's spouse" },
      { value: 'ex_spouse', label: 'Ex-spouse' },
      { value: 'friend', label: 'Friend' },
      { value: 'non_certified_domestic_partner', label: 'Partner (not certified)' },
      { value: 'corporation_non_charitable', label: 'Corporation (non-charitable)' },
      { value: 'other_individual', label: 'Other individual' },
    ],
  },
  {
    label: 'Class E — exempt',
    options: [
      { value: 'charity', label: 'Charity' },
      { value: 'religious_organization', label: 'Religious organization' },
      { value: 'educational_organization', label: 'Educational organization' },
      { value: 'medical_institution', label: 'Medical institution' },
      { value: 'governmental_entity', label: 'Governmental entity' },
    ],
  },
];

/** Relationships that identify an entity rather than a person (no first name required). */
export const ENTITY_RELATIONSHIPS: ReadonlySet<Relationship> = new Set<Relationship>([
  'charity', 'religious_organization', 'educational_organization',
  'medical_institution', 'governmental_entity', 'corporation_non_charitable',
]);

export type BequestType =
  | 'nj_real_property' | 'closely_held_business' | 'bank_account' | 'securities'
  | 'bonds' | 'retirement_account' | 'virtual_currency' | 'other_personal_property' | 'transfer';

/**
 * Labels name the IT-R schedule, because that is what the attorney is reconciling against.
 *
 * `note` carries a reporting rule from the State's own IT-R instructions (`it-rinst.pdf`) where
 * getting it wrong changes the tax. These are quoted, not paraphrased into advice — the engine
 * taxes whatever is entered, so a wrongly-entered asset produces a confidently wrong return and
 * nothing errors.
 */
export const BEQUEST_TYPES: ReadonlyArray<{
  value: BequestType;
  label: string;
  note?: string;
}> = [
  {
    value: 'nj_real_property', label: 'NJ real property (Schedule A)',
    // Schedule A instructions, "Exemptions (nonreporting)".
    note: 'New Jersey only. The instructions say "Do not report real property located outside '
      + 'New Jersey" — entering it here would tax property the State does not tax. Also do not '
      + 'report property held as tenants by the entirety with a surviving spouse or civil union partner.',
  },
  { value: 'closely_held_business', label: 'Closely held business (Schedule B)' },
  { value: 'bank_account', label: 'Bank / credit union account (Schedule B-1)' },
  { value: 'retirement_account', label: 'IRA / qualified plan (Schedule B-1)' },
  { value: 'securities', label: 'Stocks, co-ops (Schedule B-2)' },
  { value: 'bonds', label: 'Municipal / corporate bonds (Schedule B-3)' },
  { value: 'virtual_currency', label: 'Virtual currency (Schedule B-4)' },
  { value: 'other_personal_property', label: 'Other personal property (Schedule B-4)' },
  {
    value: 'transfer', label: 'Transfer within 3 years / POD (Schedule C)',
    // Schedule C Part III, and the "Life Insurance" note in the instructions.
    note: 'Where life insurance goes. Proceeds payable to a NAMED BENEFICIARY are exempt and '
      + '"not required to be reported" — leave them out entirely. Proceeds payable to the ESTATE '
      + 'are taxable: enter them here and set "Reported in" to Part III B.',
  },
];

/**
 * What the IT-R does NOT report, quoted from the State's instructions.
 *
 * These belong on screen rather than in a comment because they are errors of COMMISSION: the
 * engine taxes whatever it is given, so entering one of these produces a higher, confidently
 * wrong figure on a filed return and nothing anywhere errors. A note attached to a dropdown
 * option is no use here — the attorney has to know before choosing.
 */
export const NOT_REPORTED_ON_ITR: ReadonlyArray<{ what: string; why: string }> = [
  {
    what: 'Real property outside New Jersey',
    why: '"Do not report real property located outside New Jersey" (Schedule A instructions). '
      + 'A debt secured by it is not deductible either.',
  },
  {
    what: 'Life insurance payable to a named beneficiary',
    why: 'Exempt, and "not required to be reported" (Schedule C Part III). Insurance payable to '
      + 'the ESTATE is taxable — enter that as a Transfer, Part III B.',
  },
  {
    what: 'Property held as tenants by the entirety with a surviving spouse or civil union partner',
    why: 'Listed under "Exemptions (nonreporting)" in the Schedule A instructions.',
  },
];

/**
 * Mirrors the server's `DeductionTypeSchema`, which is `.strict()` — a value this list carries
 * that the server does not know is rejected at save, so the two must stay identical.
 * `transfer_taxes_other_states` is the server's name (N.J.A.C. 18:26-7.16).
 */
export type DeductionType =
  | 'funeral_expenses' | 'last_illness_expenses' | 'administration_expenses' | 'debt_of_decedent'
  | 'mortgage' | 'executor_commission' | 'attorney_fee' | 'accounting_fee'
  | 'accrued_property_taxes' | 'transfer_taxes_other_states' | 'other';

export const DEDUCTION_TYPES: ReadonlyArray<{
  value: DeductionType;
  label: string;
  note?: string;
}> = [
  { value: 'funeral_expenses', label: 'Funeral expenses' },
  { value: 'last_illness_expenses', label: 'Last illness expenses' },
  { value: 'administration_expenses', label: 'Administration expenses' },
  { value: 'debt_of_decedent', label: 'Debt of decedent' },
  {
    value: 'mortgage', label: 'Mortgage',
    // Schedule D instructions, the "Do not deduct" list.
    note: 'Not deductible if the debt is secured by real or tangible property located outside '
      + 'New Jersey — the instructions list those among the debts you "Do not deduct". That '
      + 'property is also excluded from the estate, so its mortgage cannot reduce the tax.',
  },
  { value: 'executor_commission', label: 'Executor commission' },
  { value: 'attorney_fee', label: 'Attorney fee' },
  { value: 'accounting_fee', label: 'Accounting fee' },
  { value: 'accrued_property_taxes', label: 'Accrued property taxes' },
  { value: 'transfer_taxes_other_states', label: 'Inheritance tax paid to another state' },
  { value: 'other', label: 'Other' },
];

export type PersonalRepresentativeTitle = 'Executor' | 'Administrator' | 'Heir-at-law';

/** Schedule A column (A) — the block the State heads "(All fields required)". */
export interface ITRRealPropertyDetails {
  county: string;
  fractionalInterest?: string;
  streetAddress?: string;
  lots?: string;
  block?: string;
  municipality?: string;
  ownersAndTitle?: string;
  hasMortgageLien?: boolean;
  taxAssessedValue?: number;
  fullMarketValue?: number;
}

/** Schedule B column (A) — "Business Information". */
export interface ITRBusinessDetails {
  businessName: string;
  federalEIN?: string;
  businessType?: string;
  isFamilyLimitedPartnership?: boolean;
  ownershipPercentage?: string;
  numberOfShares?: number;
  entireBusinessValue?: number;
}

/** Schedule B-1 column (A) — "Name of Institution, Last Four Digits of Account Number". */
export interface ITRAccountDetails {
  institutionName: string;
  accountNumberLast4?: string;
  registeredOwners?: string;
}

/** Schedule B-2 — the stock columns, or the co-op block when `isCoOp`. */
export interface ITRSecurityDetails {
  corporationName: string;
  tickerSymbol?: string;
  isNJCorporation?: boolean;
  numberOfShares?: number;
  perShareValue?: number;
  isCoOp?: boolean;
  registeredOwners?: string;
}

/** Schedule B-3 column (A) — "Name of Bond and Registered Owner". */
export interface ITRBondDetails {
  issuerAndTerms: string;
  registeredOwners?: string;
}

/** Which part of Schedule C reports the transfer. Mirrors the server's `TransferPart`. */
export type TransferPart =
  | 'lifetime_within_3_years'
  | 'incomplete'
  | 'pod_to_beneficiary'
  | 'pod_to_estate';

export const TRANSFER_PARTS: ReadonlyArray<{ value: TransferPart; label: string }> = [
  { value: 'lifetime_within_3_years', label: 'Part I — transfer within 3 years of death' },
  { value: 'incomplete', label: 'Part II — incomplete transfer (use or income retained)' },
  { value: 'pod_to_beneficiary', label: 'Part III A — payable on death to a beneficiary' },
  { value: 'pod_to_estate', label: 'Part III B — payable on death to the estate' },
];

/** Schedule C columns (A), (C) and (D), plus Part III's issuing company. */
export interface ITRTransferDetails {
  part?: TransferPart;
  dateOfTransfer?: string;
  transfereeName: string;
  issuerName?: string;
  transfereeRelationship?: string;
}

export interface ITRBequest {
  id: string;
  type: BequestType;
  description: string;
  fairMarketValue: number;
  /**
   * Columns the official schedule asks for that a description cannot answer. Each belongs to one
   * schedule and is omitted entirely when its leading field is blank — the server's schemas are
   * strict, and an object present but empty would fail validation.
   */
  realPropertyDetails?: ITRRealPropertyDetails;  // Schedule A
  businessDetails?: ITRBusinessDetails;          // Schedule B
  accountDetails?: ITRAccountDetails;      // Schedule B-1
  securityDetails?: ITRSecurityDetails;    // Schedule B-2
  bondDetails?: ITRBondDetails;            // Schedule B-3
  transferDetails?: ITRTransferDetails;    // Schedule C
}

/**
 * An address already split into the parts the official IT-R asks for (Street / City / State /
 * ZIP each have their own box). Captured at entry — Google Places returns the components
 * pre-split — so the server never has to parse a free-text address back apart.
 *
 * Optional: a matter entered before this existed carries only the free-text `address`, and the
 * server falls back to it.
 */
export interface ITRAddressParts {
  street1: string;
  street2?: string;
  city: string;
  /** Two-letter USPS abbreviation. */
  state: string;
  zip: string;
}

export interface ITRBeneficiary {
  id: string;
  lastName: string;
  firstName: string;
  address: string;
  addressParts?: ITRAddressParts;
  relationship: Relationship;
  /**
   * Empty on a matter that carries {@link ITRMatterInput.assets} — there the beneficiary is
   * identity only, and what they take is derived from the allocations. The server rejects a
   * matter that carries both.
   */
  bequests: ITRBequest[];
}

/** One beneficiary's SPECIFIC share of an asset, stored as a fraction of it. */
export interface ITRAllocation {
  beneficiaryId: string;
  /** 0 < fraction ≤ 1. The fraction is stored so a re-appraisal keeps the split intact. */
  fraction: number;
}

/**
 * An item of estate property, entered ONCE at the decedent's interest and allocated out of.
 * Same shape as {@link ITRBequest} plus its allocations — an asset is what a bequest described,
 * minus the assumption that one person takes all of it.
 */
export interface ITRAsset extends ITRBequest {
  /** SPECIFIC gifts only. Absent or empty = the asset passes wholly into residue. */
  allocations?: ITRAllocation[];
}

/**
 * One taker's share of the residuary pool. The pool itself is computed, never entered.
 *
 * There is deliberately no `perStirpes` field, and the server's schema rejects one: the
 * substitute taker when a residuary beneficiary predeceases can be a different tax class, so the
 * attorney enters the actual takers. The screen says so.
 */
export interface ITRResiduaryShare {
  beneficiaryId: string;
  /** 0 < fraction ≤ 1. Shares sum to 1 whenever the pool is greater than zero. */
  fraction: number;
}

/**
 * N.J.A.C. 18:26-7.10(d) as amended by R.2025 d.152 — an executor's commission on a real-estate
 * sale is allowable only on residue property the representative itself sold. Both statements must
 * be attested for the deduction to be allowable; the server rejects the save otherwise.
 */
export interface ITRExecutorCommissionEligibility {
  propertyWasResidueNotSpecificallyDevised: boolean;
  propertyWasSoldByExecutor: boolean;
  /** The factual basis. The server requires it to be non-blank. */
  notes: string;
}

/**
 * N.J.A.C. 18:26-7.16 — transfer/inheritance tax paid to another jurisdiction is deductible only
 * where the property it was assessed on is also subject to NJ Transfer Inheritance Tax.
 */
export interface ITRTransferTaxEligibility {
  taxedPropertyIsAlsoNJTaxable: boolean;
  /** The other taxing jurisdiction — "New York", "Pennsylvania", "United Kingdom". */
  taxingJurisdiction: string;
  /** The factual basis. The server requires it to be non-blank. */
  notes: string;
}

export interface ITRDeduction {
  id: string;
  type: DeductionType;
  description: string;
  amount: number;
  /** Schedule D column (B), "Name of Business/Person Paid". Omitted when left blank. */
  payeeName?: string;
  /** Required by the server for `executor_commission` on a death from 2025-12-15. */
  executorCommissionEligibility?: ITRExecutorCommissionEligibility;
  /** Required by the server for `transfer_taxes_other_states`, whatever the date of death. */
  transferTaxEligibility?: ITRTransferTaxEligibility;
}

export interface ITRMatterInput {
  matterId: string;
  createdAt: string;
  decedent: {
    lastName: string;
    firstName: string;
    middleName?: string;
    ssn: string;
    dateOfDeath: string;
    countyOfResidence: NJCounty;
    isNJResident?: boolean;
  };
  willExists: boolean;
  trustExists: boolean;
  federalReturnFiled: boolean;
  virtualCurrencyExists: boolean;
  disclaimersExist: boolean;
  personalRepresentative: {
    name: string;
    title: PersonalRepresentativeTitle;
    address: string;
    addressParts?: ITRAddressParts;
    phone: string;
    email?: string;
  };
  beneficiaries: ITRBeneficiary[];
  /**
   * The estate's property, entered once and allocated to beneficiaries. Present = this matter is
   * in the allocation model and every `beneficiaries[].bequests` must be empty; absent = the
   * legacy nested model. The page normalises a legacy matter into this shape when it opens one,
   * so there is only ever one screen to maintain.
   */
  assets?: ITRAsset[];
  /** Who takes the residuary pool, and in what fractions. Only meaningful with `assets`. */
  residuary?: ITRResiduaryShare[];
  deductions: ITRDeduction[];
  notes?: string;
}

/** Server response shapes — deliberately loose where the engine's type is large. */
export interface EstateComputationResult {
  computedAt: string;
  ruleSetId?: string;
  filingDeadline: string;
  grossEstate?: number;
  totalDeductions?: number;
  netEstate?: number;
  totalTaxDue: number;
  [key: string]: unknown;
}

export interface InheritanceMatterSummary {
  matterId: string;
  decedentName: string;
  dateOfDeath: string;
  updatedAt: string;
}

export interface CheckpointResult {
  checkpointId: string;
  status: string;
  finalizationKind?: 'two-attorney' | 'solo';
}

/**
 * The forms that travel with an IT-R. Each has its own precondition, enforced server-side:
 * an IT-EXT needs a recorded filing extension; an L-9 an all-Class-A estate with NJ real
 * property and no tax due; an IT-Estate a death before 2018, when the NJ Estate Tax still
 * existed. A matter that fails one comes back as a `failed-precondition` with the reason.
 */
export type CompanionForm = 'it-ext' | 'it-estate' | 'l9';

export const COMPANION_FORMS: ReadonlyArray<{
  value: CompanionForm;
  label: string;
  hint: string;
  /** Whether the State's own blank is mapped, so a filled PDF can be offered. */
  hasPdf: boolean;
}> = [
  {
    value: 'it-ext', label: 'IT-EXT (extension)',
    hint: 'Needs a filing extension recorded on the matter before compute.',
    hasPdf: true,
  },
  {
    value: 'l9', label: 'L-9 / L-9(A) (real property waiver)',
    hint: 'Only for an all-Class-A estate with NJ real property and no tax due. The official PDF is the L-9; a death before 2018-01-01 takes the L-9(A), which is hand-filled from the workpaper.',
    hasPdf: true,
  },
  {
    value: 'it-estate', label: 'IT-Estate (estate tax)',
    hint: 'Only for a death before 2018-01-01 — the NJ Estate Tax was repealed from that date. Workpaper only; hand-fill the State\'s form.',
    hasPdf: false,
  },
];

export interface CompanionFormResult {
  form: CompanionForm;
  formData: unknown;
  html: string;
  /**
   * The State's own blank for this form, filled and base64-encoded. Present only when the caller
   * asks for it AND the form has a mapping: today IT-EXT and the L-9 do, the L-9(A) and the two
   * IT-Estate returns do not (each is a separate pre-2018 State form). Absent means "hand-fill
   * from the workpaper", not "failed".
   */
  pdfBase64?: string;
  workpaper: true;
}

/**
 * A matter reopened from the server.
 *
 * `matter` is typed as the input shape, but at runtime it is the FULL stored record — it can
 * carry fields this editor does not model (`itExtension`, `priorPayments`, `disclaimers`, …).
 * That is deliberate and load-bearing: the page keeps the object whole, edits only the keys it
 * knows, and sends it back intact, so reopening and re-saving a matter cannot silently drop a
 * field the server's strict schema accepted. Do not rebuild this object field by field.
 */
export interface LoadedMatter {
  matter: ITRMatterInput;
  computation?: EstateComputationResult;
  checkpoint?: CheckpointResult;
  /** True when the matter was edited after its last computation, so the figures were withheld. */
  computationStale: boolean;
}

export interface ITRFormResult {
  formData: Record<string, unknown>;
  html?: string;
  /**
   * The State's own Form IT-R booklet, filled from the approved snapshot and base64-encoded.
   * Present only when the caller asks for it. Unlike `html` — which is the "NOT FOR FILING"
   * workpaper — this is the official form, with its fields left interactive so the attorney
   * can correct a box before signing.
   */
  pdfBase64?: string;
  finalizationKind: 'two-attorney' | 'solo';
  workpaper: true;
}

export interface AuditTrailEntry {
  entryId: string;
  timestamp: string;
  actor: string;
  action: string;
  payload: Record<string, unknown>;
  hash: string;
  previousHash: string;
}

export interface AuditTrailResult {
  entries: AuditTrailEntry[];
  chainValid: boolean;
  chainLength: number;
}
