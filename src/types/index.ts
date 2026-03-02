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

export type PackageType = 'foundation' | 'guardian' | 'fortress';

export type DocType =
  | 'will'
  | 'poa'
  | 'livingWill'
  | 'trust'
  | 'pourOverWill'
  | 'deed'
  | 'affidavitOfConsideration'
  | 'gitRep3'
  | 'coverLetter'
  | 'engagementLetter'
  | 'invoice'
  | 'estatePlanSummary'
  | 'actionSteps'
  | 'custom';

export type DocStatus = 'draft' | 'review' | 'final';

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
  | 'voided';

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
  | 'system';

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
  activeAiProvider?: 'openai' | 'anthropic' | 'gemini';
  // Levitate Contacts
  levitateApiKey?: string;
  levitateWebhookUrl?: string;
  // Google Maps
  googleMapsApiKey?: string;
}

export interface Firm {
  id: string;
  firmName: string;
  firmAddress: string;
  firmPhone: string;
  firmEmail: string;
  firmWebsite: string;
  barNumber: string;
  branding: FirmBranding;
  settings: FirmSettings;
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
  phone?: string;
  photoUrl?: string;
  barNumber?: string;           // for attorneys
  recentActivityExpanded?: boolean;
  isActive: boolean;
  lastLoginAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
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
  citizenship: CitizenshipStatus;
  occupation?: string;
  employer?: string;
}

export interface SpouseInfo extends PersonalInfo {
  // Spouse may have different attorney or separate representation flag
  separateRepresentation: boolean;
  separateAttorneyName?: string;
  separateAttorneyFirm?: string;
}

// ============================================================================
// Children
// ============================================================================

export interface Child {
  id: string;                   // client-side UUID
  name: string;
  dob: string;                  // ISO 8601 date string
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
  name: string;
  relationship: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
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
  alternate?: FiduciaryPerson;
  guardianForMinors: boolean;
  guardianForIncapacity: boolean;
  notes?: string;
}

export interface Fiduciaries {
  executor: Executor;
  trustee?: Trustee;
  powerOfAttorney: PowerOfAttorney;
  healthcareProxy: HealthcareProxy;
  guardian?: Guardian;
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
    relationship: string;
    dob?: string;
    specialNeeds: boolean;
    specialNeedsDetails?: string;
  }>;

  // Finances
  assets: Assets;
  liabilities: Liabilities;

  // Estate plan components
  fiduciaries: Fiduciaries;
  distribution: Distribution;
  healthcarePreferences: HealthcarePreferences;
  trusts: TrustDetail[];
  specialConsiderations: SpecialConsiderations;

  // Package / matter
  packageDetails: PackageDetails;

  // Questionnaire tracking
  questionnaireProgress: QuestionnaireProgress;

  // Documents array, fetched manually or populated by joining
  documents?: Document[];

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

  // Review
  reviewedAt?: Timestamp;
  reviewedBy?: string;
  reviewNotes?: string;

  // Metadata
  tags: string[];
  isConfidential: boolean;
  notes?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  updatedBy: string;
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
// Payment — /firms/{firmId}/clients/{clientId}/payments/{paymentId}
// ============================================================================

export type AccountDesignation = 'operating' | 'trust';  // IOLTA compliance

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
  accountDesignation: AccountDesignation; // IOLTA: trust vs. operating
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

/**
 * Extended user profile — merges Firebase Auth, Firestore /firms/{firmId}/users/{uid},
 * and custom JWT claims (role, firmId).
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
  createdAt: Date;
  updatedAt: Date;
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
