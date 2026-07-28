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

/** Labels name the IT-R schedule, because that is what the attorney is reconciling against. */
export const BEQUEST_TYPES: ReadonlyArray<{ value: BequestType; label: string }> = [
  { value: 'nj_real_property', label: 'NJ real property (Schedule A)' },
  { value: 'closely_held_business', label: 'Closely held business (Schedule B)' },
  { value: 'bank_account', label: 'Bank / credit union account (Schedule B-1)' },
  { value: 'retirement_account', label: 'IRA / qualified plan (Schedule B-1)' },
  { value: 'securities', label: 'Stocks, co-ops (Schedule B-2)' },
  { value: 'bonds', label: 'Municipal / corporate bonds (Schedule B-3)' },
  { value: 'virtual_currency', label: 'Virtual currency (Schedule B-4)' },
  { value: 'other_personal_property', label: 'Other personal property (Schedule B-4)' },
  { value: 'transfer', label: 'Transfer within 3 years / POD (Schedule C)' },
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

export const DEDUCTION_TYPES: ReadonlyArray<{ value: DeductionType; label: string }> = [
  { value: 'funeral_expenses', label: 'Funeral expenses' },
  { value: 'last_illness_expenses', label: 'Last illness expenses' },
  { value: 'administration_expenses', label: 'Administration expenses' },
  { value: 'debt_of_decedent', label: 'Debt of decedent' },
  { value: 'mortgage', label: 'Mortgage' },
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
  bequests: ITRBequest[];
}

export interface ITRDeduction {
  id: string;
  type: DeductionType;
  description: string;
  amount: number;
  /** Schedule D column (B), "Name of Business/Person Paid". Omitted when left blank. */
  payeeName?: string;
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
