/**
 * Complete TypeScript type definitions for the NJ Estate Plan Generator
 * Mirrors the Firestore data architecture exactly.
 *
 * All timestamp fields use Firestore Timestamp objects.
 */

import type { Timestamp } from 'firebase/firestore';

// ============================================================================
// Primitive / union types
// ============================================================================

export type UserRole = 'admin' | 'attorney' | 'paralegal' | 'client';

export type UserCapability =
  | 'manage_firm_settings'
  | 'manage_users'
  | 'manage_clients'
  | 'manage_documents'
  | 'manage_billing';

export type PackageType = 'foundation' | 'guardian' | 'fortress';

export type DocType =
  // Standard generators
  | 'will'
  | 'pourOverWill'
  | 'poa'
  | 'livingWill'
  | 'trust'
  | 'deed'
  | 'affidavitOfConsideration'
  | 'gitRep3'
  | 'estatePlanSummary'
  // Flex generators
  | 'engagementLetter'
  | 'coverLetter'
  | 'invoice'
  | 'certificationOfTrust'
  | 'beneficiaryDesignation'
  | 'trustAmendment'
  | 'trustRestatement'
  | 'petTrust'
  | 'letterOfInstruction'
  | 'memorandumOfPersonalProp'
  | 'codicil'
  | 'hipaaRelease'
  // Auto-filled questionnaire document (functions/src/generators/questionnaire-generator.ts)
  | 'questionnaire'
  | 'custom';

// 'error' is written by the generation pipeline (functions/src/unified-generator.ts)
// when a document fails to generate. Keep in sync with hasValidDocumentStatus()
// in firestore.rules.
export type DocStatus = 'draft' | 'review' | 'final' | 'incomplete' | 'needs_review' | 'error';

export type QuestionnaireStatus = 'not_started' | 'in_progress' | 'completed';

export type MaritalStatus =
  | 'Single'
  | 'Married'
  | 'Divorced'
  | 'Widowed'
  | 'Domestic Partnership'
  | 'Separated';

export type CitizenshipStatus =
  | 'US Citizen'
  | 'Permanent Resident (Green Card)'
  | 'Non-Resident Alien'
  | 'Other';

export type PropertyTitling =
  | 'Sole ownership'
  | 'Joint tenants'
  | 'Tenants in common'
  | 'Tenants by the entirety'
  | 'Trust'
  | 'LLC'
  | 'Other';

export type AccountType =
  | 'Checking'
  | 'Savings'
  | 'Money Market'
  | 'Certificate of Deposit'
  | 'Brokerage'
  | 'Mutual Fund'
  | '529 College Savings'
  | 'HSA'
  | 'Other';

export type RetirementAccountType =
  | '401(k)'
  | '403(b)'
  | '457(b)'
  | 'Traditional IRA'
  | 'Roth IRA'
  | 'SEP IRA'
  | 'SIMPLE IRA'
  | 'Pension'
  | 'Annuity'
  | 'Other';

export type InsuranceType =
  | 'Term Life'
  | 'Whole Life'
  | 'Universal Life'
  | 'Variable Life'
  | 'Variable Universal Life'
  | 'Indexed Universal Life'
  | 'Group Life'
  | 'Other';

export type BusinessEntityType =
  | 'Sole Proprietorship'
  | 'General Partnership'
  | 'Limited Partnership (LP)'
  | 'Limited Liability Partnership (LLP)'
  | 'Limited Liability Company (LLC)'
  | 'S Corporation'
  | 'C Corporation'
  | 'Professional Corporation (PC)'
  | 'Professional LLC (PLLC)'
  | 'Non-Profit Corporation'
  | 'Other';

export type PaymentMethod =
  | 'Credit Card'
  | 'Debit Card'
  | 'ACH / Bank Transfer'
  | 'Check'
  | 'Cash'
  | 'Wire Transfer'
  | 'Other';

export type PaymentStatus =
  | 'pending'
  | 'paid'
  | 'partial'
  | 'overdue'
  | 'refunded'
  | 'voided'
  // Written by lawpay-integration when a direct charge fails.
  | 'failed';

export type EventType =
  | 'consultation'
  | 'signing'
  | 'follow_up'
  | 'deadline'
  | 'other';

export type NoteType =
  | 'general'
  | 'call'
  | 'email'
  | 'meeting'
  | 'task'
  | 'system'
  | 'transcript';

export type NoteSource = 'manual' | 'ai' | 'system';

export type ChildRelationship = 'biological' | 'adopted' | 'stepchild';

export type TrustType =
  | 'Revocable Living Trust'
  | 'Irrevocable Life Insurance Trust (ILIT)'
  | 'Special Needs Trust'
  | 'Supplemental Needs Trust'
  | 'Testamentary Trust'
  | 'Charitable Remainder Trust (CRT)'
  | 'Charitable Lead Trust (CLT)'
  | 'Qualified Personal Residence Trust (QPRT)'
  | 'Grantor Retained Annuity Trust (GRAT)'
  | 'Spousal Lifetime Access Trust (SLAT)'
  | 'Dynasty Trust'
  | 'Asset Protection Trust'
  | 'Medicaid Asset Protection Trust (MAPT)'
  | 'Blind Trust'
  | 'Spendthrift Trust'
  | 'Land Trust'
  | 'Qualified Terminable Interest Property Trust (QTIP)'
  | 'Credit Shelter Trust (Bypass Trust)'
  | 'Gun Trust'
  | 'Pet Trust'
  | "Minor's Trust (Section 2503(c) Trust)";

// ============================================================================
// Firm — /firms/{firmId}
// ============================================================================

export interface Notary {
  id: string;
  name: string;
  commission?: string;
  expiration?: string;
  type: 'attorney' | 'notaryPublic';
  county?: string;
  attorneyId?: string;
}


export interface FirmBranding {
  primaryColor: string;
  accentColor: string;
  logoUrl?: string;
  faviconUrl?: string;
}

export interface FirmSettings {
  defaultState: string;
  defaultCounty?: string;
  sessionTimeoutMs: number;
  emailNotifications: boolean;
  smsNotifications: boolean;
  autoSaveIntervalMs: number;
  // Multi-LLM Settings
  openAiApiKey?: string;
  anthropicApiKey?: string;
  geminiApiKey?: string;
  perplexityApiKey?: string;
  activeAiProvider?: 'openai' | 'anthropic' | 'gemini' | 'perplexity'; // Deprecated, keep for backward compatibility
  chatbotAiProvider?: 'openai' | 'anthropic' | 'gemini' | 'perplexity';
  documentDraftingAiProvider?: 'openai' | 'anthropic' | 'gemini' | 'perplexity';
  notaries?: Notary[];
  // Levitate Contacts
  levitateApiKey?: string;
  levitateWebhookUrl?: string;
  // Google Maps
  googleMapsApiKey?: string;
  // Other integrations
  lawPayApiKey?: string;
  lawPayPublicKey?: string;
  sendGridApiKey?: string;
  lawPayMerchantId?: string;
}

export interface Firm {
  id: string;
  firmName: string;
  logoUrl?: string;
  firmAddress: string;
  firmPhone: string;
  firmEmail: string;
  firmWebsite: string;
  barNumber: string;
  branding: FirmBranding;
  settings: FirmSettings;
  /** Email addresses that receive the Monday 8am ET weekly analytics digest.
   *  Leave empty to opt a firm out of the digest. */
  weeklyDigestRecipients?: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// Email Templates — /firms/{firmId}/emailTemplates/{templateId}
// ============================================================================

export type EmailTrigger =
  | 'client_created'
  | 'questionnaire_completed'
  | 'payment_received'
  | 'appointment_scheduled'
  | 'questionnaire_invitation'
  | 'payment_request'
  | 'appointment_confirmation'
  | 'general_manual';

export interface EmailTemplate {
  id: string;
  firmId: string;
  name: string;
  trigger: EmailTrigger;
  isActive: boolean;
  subject: string;
  content: string; // HTML or Text supporting Handlebars-like variables
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy: string;
}

// ============================================================================
// User — /users/{userId}
// ============================================================================

export interface User {
  id: string;
  firmId: string;
  email: string;
  displayName: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  customCapabilities?: UserCapability[];
  phone?: string;
  photoUrl?: string;
  barNumber?: string;           // for attorneys
  recentActivityExpanded?: boolean;
  isActive: boolean;
  lastLoginAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Extended user profile — merges Firebase Auth, Firestore /firms/{firmId}/users/{uid},
 * and custom JWT claims (role, firmId). Built by AuthContext.buildProfile().
 * This is the single source of truth; fields that the /users document carries but
 * the profile builder does not populate (firstName, lastName, isActive, barNumber)
 * live on the `User` type, not here.
 */
export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  firmId: string;
  photoURL?: string;
  phone?: string;
  onboarded: boolean;
  recentActivityExpanded?: boolean;
  customCapabilities?: UserCapability[];
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
}

// ============================================================================
// Personal information
// ============================================================================

export interface PersonalInfo {
  firstName: string;
  lastName: string;
  middleName?: string;
  suffix?: string;
  dob: string;                  // ISO 8601 date string, e.g. "1970-05-15"
  ssnLast4?: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  email: string;
  phone: string;
  alternatePhone?: string;
  maritalStatus: MaritalStatus;
  gender?: 'male' | 'female';   // for pronouns, relationship titles, pregnancy provision
  citizenship: CitizenshipStatus;
  occupation?: string;
  employer?: string;
}

export interface SpouseInfo extends PersonalInfo {
  // Spouse may have different attorney or separate representation flag
  separateRepresentation: boolean;
  separateAttorneyName?: string;
  separateAttorneyFirm?: string;
  sameAddress?: boolean;  // auto-fill from client address
}

// ============================================================================
// Children
// ============================================================================

export interface Child {
  id: string;                   // client-side UUID
  // Legacy joined name — derived from firstName/middleName/lastName/suffix
  // at aggregation time and written back for template back-compat.
  name: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  suffix?: string;
  dob: string;                  // ISO 8601 date string
  gender: 'male' | 'female';   // for gendered relationship titles (son/daughter)
  sameAddress?: boolean;         // auto-fill from client address
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  relationship: ChildRelationship;
  specialNeeds: boolean;
  specialNeedsDetails?: string;
  guardian?: string;
  alternateGuardian?: string;
  isMinor: boolean;
  guardianshipNotes?: string;
  _pendingNameSplit?: {
    firstName: string;
    middleName: string;
    lastName: string;
    suffix: string;
  };
}

// ============================================================================
// Assets
// ============================================================================

export interface RealEstate {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  blockLot?: string;            // NJ tax map block & lot
  deedBook?: string;
  deedPage?: string;
  titling: PropertyTitling;
  estimatedValue: number;
  mortgageBalance?: number;
  mortgageLender?: string;
  isPrimaryResidence: boolean;
  transferToTrust: boolean;
  trustName?: string;
  notes?: string;
}

export interface BankAccount {
  id: string;
  institution: string;
  accountType: AccountType;
  accountNumberLast4?: string;
  estimatedBalance: number;
  titling: PropertyTitling;
  beneficiary?: string;
  contingentBeneficiary?: string;
  transferToTrust: boolean;
  notes?: string;
}

export interface InvestmentAccount {
  id: string;
  institution: string;
  accountType: AccountType;
  accountNumberLast4?: string;
  estimatedValue: number;
  titling: PropertyTitling;
  beneficiary?: string;
  contingentBeneficiary?: string;
  transferToTrust: boolean;
  notes?: string;
}

export interface RetirementAccount {
  id: string;
  institution: string;
  accountType: RetirementAccountType;
  accountNumberLast4?: string;
  estimatedValue: number;
  primaryBeneficiary: string;
  primaryBeneficiaryPercentage?: number;
  contingentBeneficiary?: string;
  contingentBeneficiaryPercentage?: number;
  isInheritedIra: boolean;
  notes?: string;
}

export interface LifeInsurance {
  id: string;
  company: string;
  policyNumber?: string;
  insuranceType: InsuranceType;
  faceValue: number;
  cashValue?: number;
  premiumAmount?: number;
  premiumFrequency?: 'monthly' | 'quarterly' | 'semi-annual' | 'annual';
  insured: string;
  owner: string;
  primaryBeneficiary: string;
  primaryBeneficiaryPercentage?: number;
  contingentBeneficiary?: string;
  contingentBeneficiaryPercentage?: number;
  transferToTrust: boolean;     // e.g. ILIT
  notes?: string;
}

export interface BusinessInterest {
  id: string;
  businessName: string;
  entityType: BusinessEntityType;
  ownershipPercentage: number;
  estimatedValue: number;
  ein?: string;
  state: string;
  hasOperatingAgreement: boolean;
  hasBuysSellAgreement: boolean;
  notes?: string;
}

export interface PersonalProperty {
  id: string;
  description: string;
  estimatedValue: number;
  location?: string;
  specificBequest?: boolean;
  bequestRecipient?: string;
  notes?: string;
}

export interface DigitalAsset {
  id: string;
  description: string;
  platform?: string;
  estimatedValue?: number;
  accountUsername?: string;
  locationOfCredentials?: string;  // e.g. "password manager", "safe deposit box"
  transferInstructions?: string;
  notes?: string;
}

export interface Assets {
  realEstate: RealEstate[];
  bankAccounts: BankAccount[];
  investmentAccounts: InvestmentAccount[];
  retirementAccounts: RetirementAccount[];
  lifeInsurance: LifeInsurance[];
  businessInterests: BusinessInterest[];
  personalProperty: PersonalProperty[];
  digitalAssets: DigitalAsset[];
  estimatedTotalEstate?: number;  // calculated or manually entered
  notes?: string;
}

// ============================================================================
// Liabilities
// ============================================================================

export interface Mortgage {
  id: string;
  propertyAddress: string;
  lender: string;
  balance: number;
  monthlyPayment?: number;
  interestRate?: number;
  maturityDate?: string;
  notes?: string;
}

export interface Liability {
  id: string;
  description: string;
  creditor: string;
  balance: number;
  monthlyPayment?: number;
  type: 'credit_card' | 'auto_loan' | 'student_loan' | 'personal_loan' | 'business_loan' | 'other';
  notes?: string;
}

export interface Liabilities {
  mortgages: Mortgage[];
  otherLiabilities: Liability[];
  estimatedTotalLiabilities?: number;
  notes?: string;
}

// ============================================================================
// Fiduciaries
// ============================================================================

export interface FiduciaryPerson {
  // Legacy joined name. After the 2026-05-27 name-split refactor, this is
  // derived from firstName/middleName/lastName/suffix at aggregation time
  // (client-context-aggregator.deriveName) and written back here so Firestore
  // templates that bind {{fiduciaries.X.Y.name}} keep rendering. New entries
  // captured via the questionnaire fill the split fields directly.
  name: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  suffix?: string;
  relationship: string;
  /** Optional explicit gender — used to render correct pronouns in generated
   * documents when the relationship word is ambiguous (Parent/Child/Sibling/
   * Friend/etc). For gendered relations (Mother/Father/Sister/etc) and for
   * spouse/husband/wife relations, the engine infers from the relationship
   * itself; this field is the override. Empty/undefined → neutral pronouns. */
  gender?: 'male' | 'female' | '';
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  /** Migration-time staging field — populated by split-names.cjs, cleared
   * after admin review via /admin/name-splits. Never read by the template
   * engine. */
  _pendingNameSplit?: {
    firstName: string;
    middleName: string;
    lastName: string;
    suffix: string;
  };
}

export interface Executor {
  primary: FiduciaryPerson;
  alternate?: FiduciaryPerson;
  successor?: FiduciaryPerson;
  compensation?: 'statutory' | 'waived' | 'fixed';
  compensationAmount?: number;
  bondRequired: boolean;
}

export interface Trustee {
  primary: FiduciaryPerson;
  alternate?: FiduciaryPerson;
  successor?: FiduciaryPerson;
  coTrustee?: FiduciaryPerson;
  compensation?: 'statutory' | 'waived' | 'fixed';
  compensationAmount?: number;
  bondRequired: boolean;
}

export interface PowerOfAttorney {
  agent: FiduciaryPerson;
  alternateAgent?: FiduciaryPerson;
  successorAgent?: FiduciaryPerson;
  effectiveDate: 'immediate' | 'springing';
  durability: boolean;            // durable vs non-durable
  financialPowers: string[];      // list of specific powers granted
  limitations?: string;
  giftingPower: boolean;
  selfDealingPower: boolean;
  notes?: string;
}

export interface HealthcareProxy {
  agent: FiduciaryPerson;
  alternateAgent?: FiduciaryPerson;
  successorAgent?: FiduciaryPerson;
  hipaaAuthorization: boolean;
  notes?: string;
}

export interface Guardian {
  primary: FiduciaryPerson;
  /** Second person serving alongside `primary` — a couple appointed together,
   * as in "I appoint my parents, A and B, as guardians". Optional: a single
   * guardian is equally common, and templates omit the conjunction when this
   * is unset rather than rendering "A and ". */
  coGuardian?: FiduciaryPerson;
  alternate?: FiduciaryPerson;
  /** Second person serving alongside `alternate`, same pairing as coGuardian. */
  coAlternate?: FiduciaryPerson;
  guardianForMinors: boolean;
  guardianForIncapacity: boolean;
  notes?: string;
}

/**
 * NJ funeral representative — N.J.S.A. 45:27-22.
 *
 * A statutory appointment distinct from the executor: this person controls
 * funeral arrangements and the disposition of remains, and the statute requires
 * the appointment be made in the will. Commonly the same person as the
 * executor, but not necessarily, which is why it is its own slot.
 *
 * NOTE: no questionnaire step collects this yet. Until one does it is set by
 * attorney entry, and a will template omits the article when it is unset
 * rather than appointing nobody.
 */
export interface FuneralRepresentative {
  primary: FiduciaryPerson;
  alternate?: FiduciaryPerson;
}

export interface Fiduciaries {
  executor: Executor;
  trustee?: Trustee;
  powerOfAttorney: PowerOfAttorney;
  healthcareProxy: HealthcareProxy;
  guardian?: Guardian;
  funeralRepresentative?: FuneralRepresentative;
}

// ============================================================================
// Distribution / Bequests
// ============================================================================

export interface SpecificBequest {
  id: string;
  description: string;
  recipient: string;
  recipientRelationship?: string;
  condition?: string;
  alternateRecipient?: string;
}

export interface ResidualDistribution {
  id: string;
  recipient: string;
  recipientRelationship?: string;
  percentage: number;           // 0–100; all entries should sum to 100
  alternateRecipient?: string;
  perStirpes: boolean;          // true = per stirpes; false = per capita
}

export interface CharitableBequest {
  id: string;
  organizationName: string;
  ein?: string;
  amount?: number;
  percentage?: number;
  purpose?: string;
}

export interface Distribution {
  specificBequests: SpecificBequest[];
  residualDistributions: ResidualDistribution[];
  charitableBequests: CharitableBequest[];
  pourOverToTrust: boolean;
  trustName?: string;
  survivorshipPeriod?: number;  // days
  noContestClause: boolean;
  spendthriftProvision: boolean;
  notes?: string;
}

// ============================================================================
// Healthcare preferences (Living Will / Advance Directive)
// ============================================================================

export interface HealthcarePreferences {
  // End-of-life care
  lifeSupport: 'withhold' | 'provide' | 'undecided';
  artificialNutrition: 'withhold' | 'provide' | 'undecided';
  artificialHydration: 'withhold' | 'provide' | 'undecided';
  painManagement: 'comfort_care' | 'all_measures' | 'undecided';
  cprDirective: 'dnr' | 'full_code' | 'undecided';
  // Organ donation
  organDonation: boolean;
  organDonationDetails?: string;     // specific organs/tissues
  // Anatomical gift
  anatomicalGift: boolean;
  anatomicalGiftOrganization?: string;
  // Personal statements
  personalStatement?: string;
  religiousBeliefs?: string;
  // NJ-specific
  njADRD: boolean;                   // Alzheimer's disease / related dementia directive
  notes?: string;
}

// ============================================================================
// Trust details
// ============================================================================

export interface TrustDetail {
  id: string;
  trustName: string;
  trustType: TrustType;
  trustDate?: string;            // ISO 8601
  trustees: Trustee;
  beneficiaries: Array<{
    name: string;
    relationship: string;
    percentage?: number;
    notes?: string;
  }>;
  fundingAssets: string[];       // IDs or descriptions of assets going into trust
  distributionStandard?: string; // e.g. "HEMS"
  terminationAge?: number;       // for minor's trusts, age trust terminates
  notes?: string;
}

/**
 * Drafting elections that change which articles a trust template renders.
 *
 * Distinct from TrustDetail, which describes the trust instrument itself —
 * these are attorney choices about structure, not facts about the trust.
 * Consumed by functions/src/templates/trust-joint.hbs and trust-single.hbs.
 */
export interface TrustOptions {
  /**
   * First-death subtrusts (joint trusts only). These are INDEPENDENT, not
   * mutually exclusive — a joint plan routinely divides into a Survivor's Trust
   * alongside a QTIP Marital Trust and a contingent Disclaimer Trust, and all
   * three articles render side by side.
   *
   * An earlier revision modelled this as a single `taxPlanning` enum. That was
   * wrong: it can express only one vehicle, so any plan using more than one
   * would render structurally incomplete.
   */

  /** Survivor's Trust holding the surviving settlor's own share. */
  survivorsTrust?: boolean;

  /**
   * Marital deduction vehicle for the deceased settlor's share.
   *   none     — no marital trust
   *   qtip     — qualifying income interest for life, IRC §2056(b)(7) election
   *   outright — distributed outright to the surviving settlor, no trust
   */
  maritalTrust?: 'none' | 'qtip' | 'outright';

  /**
   * Credit-shelter vehicle.
   *   none                  — no bypass
   *   mandatory             — funded at first death up to the remaining exemption
   *   contingent_disclaimer — funded only if the survivor disclaims, IRC §2518
   */
  bypassTrust?: 'none' | 'mandatory' | 'contingent_disclaimer';

  /** Pooled trust for the children's shares before division (Family Pot Trust). */
  familyPotTrust?: boolean;

  /**
   * Appoint a Special Trustee for tax-sensitive powers an interested trustee
   * cannot hold. Also renders the Independent vs. Interested Trustee definition.
   */
  specialTrustee?: boolean;

  /**
   * How retirement assets payable to the trust are administered post-SECURE Act.
   *   conduit      — all RMDs pass through to the beneficiary in the year received
   *   accumulation — trustee may accumulate; identifiable-beneficiary limits apply
   *   per_share    — elected separately for each share
   * Beneficiary data itself lives on Assets.retirementAccounts (RetirementAccount).
   */
  retirementTreatment?: 'conduit' | 'accumulation' | 'per_share';

  /** Include the substance-abuse examination and distribution-suspension article. */
  substanceAbuseProvisions?: boolean;
}

/**
 * Trust Protector appointment. Optional article — when `enabled` is false or
 * the field is absent, the TRUST PROTECTOR article does not render at all.
 */
export interface TrustProtector {
  enabled: boolean;
  initial?: FiduciaryPerson;
  successor?: FiduciaryPerson;
}

// ============================================================================
// Special considerations
// ============================================================================

export interface SpecialConsiderations {
  hasSpecialNeedsChild: boolean;
  specialNeedsDetails?: string;
  hasBlendedFamily: boolean;
  blendedFamilyDetails?: string;
  hasPrenupOrPostnup: boolean;
  prenupDetails?: string;
  hasInternationalAssets: boolean;
  internationalAssetsDetails?: string;
  hasBusinessSuccession: boolean;
  businessSuccessionDetails?: string;
  hasMedicaidPlanning: boolean;
  medicaidPlanningDetails?: string;
  hasCharitableGoals: boolean;
  charitableGoalsDetails?: string;
  hasPetProvision: boolean;
  petDetails?: string;
  petCaretaker?: string;
  hasDigitalAssets: boolean;
  digitalAssetsDetails?: string;
  hasPendingLitigation: boolean;
  pendingLitigationDetails?: string;
  additionalNotes?: string;
}

// ============================================================================
// Questionnaire — tracks completion section by section
// ============================================================================

export interface QuestionnaireProgress {
  status: QuestionnaireStatus;
  percentComplete: number;
  sectionsCompleted: string[];
  currentStepIndex?: number;
  currentStepTitle?: string;
  currentSectionId?: string;
  currentSectionTitle?: string;
  totalSteps?: number;
  lastUpdatedBy?: string;
  lastUpdatedAt?: Timestamp;
  startedAt?: Timestamp;
  completedAt?: Timestamp;
}

// ============================================================================
// Package / plan details
// ============================================================================

export interface PackageDetails {
  packageType: PackageType;
  engagementDate?: string;         // ISO 8601
  estimatedFee?: number;
  retainerPaid?: number;
  balanceDue?: number;
  documentsIncluded: DocType[];
  notes?: string;
}

// ============================================================================
// Client deadlines — signing ceremonies, filings, follow-ups
// Stored inline on the Client record (client.deadlines[]).
// ============================================================================

export type ClientDeadlineType =
  | 'signing_ceremony'
  | 'filing'
  | 'follow_up'
  | 'custom';

export interface ClientDeadline {
  id: string;
  label: string;
  /** ISO 8601 date (YYYY-MM-DD) */
  date: string;
  type: ClientDeadlineType;
  completed: boolean;
  notes?: string;
  createdAt: Timestamp;
  createdBy: string;
}

// ============================================================================
// Package review — cross-document findings on a generated document set
//
// Mirrors the shapes in functions/src/package-review.ts, which is the source of
// truth for the checks. Kept structurally identical so a finding can round-trip
// through Firestore without translation.
// ============================================================================

export type PackageFindingSeverity = 'high' | 'medium' | 'low';

export type PackageFindingReason =
  | 'blank-field'
  | 'unresolved-token'
  | 'missing-instrument'
  | 'enclosure-mismatch'
  | 'statutory-limit'
  | 'inoperative-provision'
  | 'name-collision'
  | 'suffix-dropped'
  | 'missing-apportionment'
  | 'toc-mismatch';

export interface PackageFinding {
  docType: string;
  title: string;
  /** Nearest section citation, or a structural label like "Body Paragraph". */
  location: string;
  severity: PackageFindingSeverity;
  reason: PackageFindingReason;
  summary: string;
  detail: string;
}

export interface PackageReview {
  findings: PackageFinding[];
  summary: { total: number; high: number; medium: number; low: number };
  /** True when `findings` was capped; `summary` still counts the full set. */
  truncated: boolean;
  packageType: PackageType;
  reviewedAt: Timestamp;
}

// ============================================================================
// Client — /firms/{firmId}/clients/{clientId}
// ============================================================================

export interface Client {
  id: string;
  firmId: string;
  assignedAttorneyId: string;
  assignedParalegalId?: string;

  // Personal info
  personalInfo: PersonalInfo;
  spouseInfo?: SpouseInfo;

  // Family
  children: Child[];
  otherDependents?: Array<{
    name: string;
    firstName?: string;
    middleName?: string;
    lastName?: string;
    suffix?: string;
    relationship: string;
    dob?: string;
    specialNeeds: boolean;
    specialNeedsDetails?: string;
    _pendingNameSplit?: {
      firstName: string;
      middleName: string;
      lastName: string;
      suffix: string;
    };
  }>;

  // Finances
  assets: Assets;
  liabilities: Liabilities;

  // Estate plan components
  fiduciaries: Fiduciaries;
  distribution: Distribution;
  healthcarePreferences: HealthcarePreferences;
  trusts: TrustDetail[];
  /** Drafting elections for the trust templates. Absent → all optional articles omitted. */
  trustOptions?: TrustOptions;
  /** Trust Protector appointment. Absent → the TRUST PROTECTOR article is omitted. */
  trustProtector?: TrustProtector;
  specialConsiderations: SpecialConsiderations;

  /**
   * Jurisdiction whose law governs the estate plan, spelled out ("New Jersey").
   * Drives statutory citations and execution formalities in the templates.
   * Absent → generators default to 'New Jersey'.
   */
  governingState?: string;
  /** Scheduled execution/signing date, ISO 8601. Absent → renders as a fill-in blank. */
  executionDate?: string;

  // Package / matter
  packageDetails: PackageDetails;

  // Questionnaire tracking
  questionnaireProgress: QuestionnaireProgress;

  // Documents array, fetched manually or populated by joining
  documents?: Document[];
  /** Set true by the generation pipeline once documents have been generated. */
  documentsGenerated?: boolean;
  /**
   * Cross-document review of the last generated package. Written by
   * generateDocuments; see functions/src/package-review.ts for the checks.
   * Absent on clients whose documents predate the review pass.
   */
  packageReview?: PackageReview;

  // Matter deadlines (signing ceremonies, filings, follow-ups)
  deadlines?: ClientDeadline[];

  // Status
  isActive: boolean;
  isArchived: boolean;
  archivedAt?: Timestamp;
  archivedBy?: string;

  // Metadata
  tags: string[];
  referralSource?: string;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy: string;

  // Account linking & intake provenance (written by the backend; see
  // functions/src/register-client.ts and link-client.ts). linkedUserId is the
  // Firebase Auth UID granted access to this record by the Firestore
  // "linked session" rules — set only via the admin SDK.
  linkedUserId?: string;
  /** Pipeline/intake status validated by firestore.rules hasValidClientStatus(). */
  status?: 'prospect' | 'active' | 'pending_review' | 'completed' | 'archived';
  createdVia?: string;
  /** Set when a questionnaire registration collided with an already-linked record. */
  emailCollision?: boolean;
  collidesWithClientId?: string;
}

// ============================================================================
// Document — /firms/{firmId}/clients/{clientId}/documents/{docId}
// ============================================================================

export interface DocumentVersion {
  versionNumber: number;
  storagePath: string;
  downloadUrl?: string;
  createdAt: Timestamp;
  createdBy: string;
  changeNotes?: string;
}

export interface Document {
  id: string;
  firmId: string;
  clientId: string;
  docType: DocType;
  displayName: string;           // human-readable, e.g. "Last Will and Testament"
  status: DocStatus;

  // Storage
  storagePath: string;           // current version in Firebase Storage
  downloadUrl?: string;
  fileName: string;
  fileSizeBytes?: number;
  mimeType: string;

  // Versioning
  versions: DocumentVersion[];
  currentVersion: number;

  // Template / generation
  generatedByAI: boolean;
  templateId?: string;
  generationPrompt?: string;
  aiModel?: string;

  // Signing
  requiresSignature: boolean;
  signedAt?: Timestamp;
  signedBy?: string;
  witnessedBy?: string[];
  notarized: boolean;
  notarizedAt?: Timestamp;
  notaryName?: string;

  // Electronic signature (Dropbox Sign). Status is driven by the provider
  // webhook; distinct from the wet-signature fields above.
  eSignature?: {
    provider: 'dropbox-sign';
    signatureRequestId: string;
    status: 'sent' | 'viewed' | 'signed' | 'declined' | 'canceled';
    testMode?: boolean;
    signerName?: string;
    signerEmail?: string;
    sentAt?: Timestamp;
    viewedAt?: Timestamp;
    signedAt?: Timestamp;
    declinedAt?: Timestamp;
    // The executed PDF (signed document + audit page) pulled back into Storage
    // once Dropbox Sign reports it downloadable.
    signedStoragePath?: string;
    signedFileName?: string;
  };

  // Review
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  reviewNotes?: string;

  // Google Drive sync
  googleDriveFileId?: string;
  googleDriveSyncedAt?: Timestamp;

  // Metadata
  tags: string[];
  isConfidential: boolean;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy: string;

  // Quality signals (set by generation pipeline)
  /** Completeness warnings — which required data fields are missing */
  warnings?: string[];
  /** Structural validation findings from post-generation checks */
  validationFindings?: Array<{ name: string; severity: 'error' | 'warning' }>;

  // Content (loaded via Firestore listener)
  content?: string;
  /** Editor copy of content; DocumentEditor prefers this over `content`. */
  editorContent?: string;
  changeNotes?: string;
  generationMode?: 'batch' | 'chat-draft';
  /** Pre-enhancement template HTML for side-by-side comparison (hybrid mode only) */
  templateBaseline?: string;
  /** Short hash identifying the prompt version used for generation */
  promptVersion?: string;

  // Generation provenance (written by document-save-helper)
  triggerSource?: 'batch' | 'single' | 'chat-draft' | 'flex' | 'retemplatize';
  templateSourceCollection?: 'documentTemplates' | 'knowledgeBase' | 'legacyTemplates' | 'bundled' | null;
  softwareSource?: string | null;
  /** True when the canonical artifact is a binary (DOCX) in Storage. */
  hasBinary?: boolean;
  /** Structured data extracted from an uploaded/source document. */
  extractedData?: Record<string, unknown>;
}

// ============================================================================
// Note — /firms/{firmId}/clients/{clientId}/notes/{noteId}
// ============================================================================

export interface Note {
  id: string;
  firmId: string;
  clientId: string;
  noteType: NoteType;
  source: NoteSource;
  title?: string;
  content: string;
  isPinned: boolean;
  isPrivate: boolean;            // visible only to author
  relatedDocumentId?: string;
  relatedEventId?: string;
  attachments?: Array<{
    fileName: string;
    storagePath: string;
    downloadUrl?: string;
    fileSizeBytes?: number;
    mimeType: string;
    uploadedAt: Timestamp;
  }>;
  // Audio transcription fields (Whisper API)
  audioUrl?: string | null;      // Cloud Storage download URL
  audioStoragePath?: string | null; // Absolute Cloud Storage path used by Cloud Functions
  audioFileName?: string;        // original filename for display
  audioDurationSeconds?: number;
  transcription?: string | null; // Whisper transcription result
  transcriptionStatus?: 'pending' | 'processing' | 'completed' | 'failed';
  aiSummary?: string | null;     // GPT summarization of transcription
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy: string;
}

// ============================================================================
// PendingTranscript — /firms/{firmId}/pendingTranscripts/{transcriptId}
//
// Written only by the external transcription pipeline (Admin SDK, service
// account). The app never receives, stores, or plays audio — only the
// finished text transcript. Staff review each pending transcript and file it
// into a client matter (as a Note) via the fileTranscriptToMatter callable.
// ============================================================================

export interface TranscriptSegment {
  speaker: string;
  start: number;
  end: number;
  text: string;
}

// AI triage summary generated by the summarizePendingTranscript Cloud Function
// (Admin SDK) the moment a transcript lands in the queue. Additive metadata —
// it never moves or re-statuses the transcript.
export interface TranscriptSummary {
  overview: string;
  keyPoints: string[];
  actionItems: string[];
  matterTypeHint: string;
}

export type TranscriptSummaryStatus = 'pending' | 'processing' | 'complete' | 'error';

export interface PendingTranscript {
  id: string;
  firmId: string;
  sourceFilename: string;
  transcriptText: string;
  segments: TranscriptSegment[];
  speakerCount: number;
  durationSeconds: number;
  language: string;
  recordedAt: Timestamp | null;
  createdAt: Timestamp;
  createdBy: string;
  status: 'pending' | 'filed';
  filedToMatterId: string | null;
  filedAt: Timestamp | null;
  filedBy: string | null;
  // AI summary (written by the summarizePendingTranscript trigger). Absent
  // until the trigger runs; treat an absent status as 'pending'/loading.
  summary?: TranscriptSummary | null;
  summaryStatus?: TranscriptSummaryStatus;
  summaryGeneratedAt?: Timestamp | null;
  summaryError?: string | null;
}

// ============================================================================
// Payment — /firms/{firmId}/clients/{clientId}/payments/{paymentId}
// ============================================================================

// Defaults to 'operating'; the createPaymentRequest callable also accepts and
// persists 'trust', so the persisted type must allow both.
export type AccountDesignation = 'operating' | 'trust';

export interface Payment {
  id: string;
  firmId: string;
  clientId: string;
  invoiceNumber?: string;
  description: string;
  amount: number;                // in cents to avoid float issues
  amountPaid: number;
  balanceDue: number;
  paymentMethod?: PaymentMethod;
  status: PaymentStatus;
  paidAt?: Timestamp;
  dueDate?: string;              // ISO 8601
  receiptUrl?: string;
  accountDesignation: AccountDesignation; // Always 'operating'
  checkNumber?: string;          // for check payments
  // LawPay / AffiniPay integration
  lawPayTransactionId?: string;
  lawPayPaymentUrl?: string;     // payment link sent to client
  lawPayChargeId?: string;
  // Legacy Stripe fields (kept for backwards compatibility)
  stripePaymentIntentId?: string;
  stripeInvoiceId?: string;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy: string;
}

// ============================================================================
// Calendar Event — /firms/{firmId}/calendarEvents/{eventId}
// ============================================================================

export interface CalendarEvent {
  id: string;
  firmId: string;
  clientId?: string;
  clientName?: string;
  assignedTo: string[];          // user IDs
  eventType: EventType;
  title: string;
  description?: string;
  location?: string;
  isVirtual: boolean;
  meetingUrl?: string;
  startAt: Timestamp;
  endAt: Timestamp;
  allDay: boolean;
  reminderMinutes?: number;      // minutes before event to send reminder
  isCompleted: boolean;
  completedAt?: Timestamp;
  cancelledAt?: Timestamp;
  cancelledBy?: string;
  cancellationReason?: string;
  // Google Calendar sync
  googleCalendarEventId?: string | null;
  googleCalendarSyncedAt?: Timestamp;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy: string;
}

// ============================================================================
// Task — /firms/{firmId}/tasks/{taskId}
// ============================================================================

export interface AppTask {
  id: string;
  firmId: string;
  title: string;
  description?: string;
  status: 'todo' | 'in_progress' | 'completed';
  assignedTo?: string;           // Optional user ID
  relatedClientId?: string;      // If task belongs to a specific matter
  relatedClientName?: string;    // Name of the specific client for display
  dueDate?: Timestamp;
  completedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy: string;
}

// ============================================================================
// Utility / form state types
// ============================================================================

/** Partial client used during questionnaire data entry */
export type ClientDraft = Partial<
  Omit<Client, 'id' | 'firmId' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>
>;

/** Minimal client record for list views */
export interface ClientListItem {
  id: string;
  firmId: string;
  displayName: string;          // e.g. "Smith, John"
  email: string;
  phone: string;
  packageType: PackageType;
  questionnaireStatus: QuestionnaireStatus;
  assignedAttorneyId: string;
  assignedParalegalId?: string;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Generic async operation state */
export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Firebase auth context shape */
export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role?: UserRole;
  firmId?: string;
}

/** App-level error */
export interface AppError {
  code: string;
  message: string;
  details?: unknown;
  timestamp: Date;
}

// ============================================================================
// AI service — simplified client and firm shapes used by the prompt layer
// ============================================================================

/** Simplified person record used inside ClientData for AI prompts. */
export interface AiPerson {
  firstName: string;
  lastName: string;
  middleName?: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  relationship: string;
  dob?: string;
}

/**
 * Flattened client data structure consumed by the AI document generation service.
 * Distinct from the full Client record to avoid exposing the entire Firestore schema.
 */
export interface ClientData {
  personalInfo: PersonalInfo & { married?: boolean };
  spouseInfo?: AiPerson & { married?: boolean };
  beneficiaries: AiPerson[];
  executors: AiPerson[];
  healthcareProxies: AiPerson[];
  specialInstructions?: string;
  [key: string]: unknown;
}

/** Firm contact information passed to AI prompts. */
export interface FirmInfo {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  primaryAttorney?: string;
  barNumber?: string;
}
