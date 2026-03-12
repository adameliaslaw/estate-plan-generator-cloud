/**
 * Application-wide constants for the NJ Estate Plan Generator
 * Elias Counsel, LLC
 */

// ---------------------------------------------------------------------------
// Firm defaults
// ---------------------------------------------------------------------------
export const FIRM_DEFAULTS = {
  firmName: 'Elias Counsel, LLC',
  firmAddress: '168 Prospect Plains Road, Monroe Township, NJ 08831',
  firmPhone: '(609) 655-3200',
  firmEmail: 'info@adameliaslaw.com',
  firmWebsite: 'https://www.eliascounsel.com',
  barNumber: '050422014',
  primaryColor: '#1a365d',
  accentColor: '#2b6cb0',
  defaultState: 'New Jersey',
} as const;

// ---------------------------------------------------------------------------
// New Jersey — all 21 counties (alphabetical)
// ---------------------------------------------------------------------------
export const NJ_COUNTIES = [
  'Atlantic',
  'Bergen',
  'Burlington',
  'Camden',
  'Cape May',
  'Cumberland',
  'Essex',
  'Gloucester',
  'Hudson',
  'Hunterdon',
  'Mercer',
  'Middlesex',
  'Monmouth',
  'Morris',
  'Ocean',
  'Passaic',
  'Salem',
  'Somerset',
  'Sussex',
  'Union',
  'Warren',
] as const;

// ---------------------------------------------------------------------------
// Session timeout — 30 minutes
// ---------------------------------------------------------------------------
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/** 2 minutes before expiry — show warning toast */
export const SESSION_WARNING_MS = SESSION_TIMEOUT_MS - 2 * 60 * 1000;

// ---------------------------------------------------------------------------
// User roles
// ---------------------------------------------------------------------------
export const ROLES = {
  ADMIN: 'admin',
  ATTORNEY: 'attorney',
  PARALEGAL: 'paralegal',
  CLIENT: 'client',
} as const;

// ---------------------------------------------------------------------------
// Estate plan packages
// ---------------------------------------------------------------------------
export const PACKAGES = {
  FOUNDATION: 'foundation',
  GUARDIAN: 'guardian',
  FORTRESS: 'fortress',
} as const;

// ---------------------------------------------------------------------------
// Document types
// ---------------------------------------------------------------------------
export const DOC_TYPES = {
  WILL: 'will',
  POA: 'poa',
  LIVING_WILL: 'livingWill',
  TRUST: 'trust',
  POUR_OVER_WILL: 'pourOverWill',
  DEED: 'deed',
  AFFIDAVIT_OF_CONSIDERATION: 'affidavitOfConsideration',
  GIT_REP_3: 'gitRep3',
  COVER_LETTER: 'coverLetter',
  ENGAGEMENT_LETTER: 'engagementLetter',
  INVOICE: 'invoice',
  ESTATE_PLAN_SUMMARY: 'estatePlanSummary',
  ACTION_STEPS: 'actionSteps',
  CUSTOM: 'custom',
} as const;

// ---------------------------------------------------------------------------
// Document statuses
// ---------------------------------------------------------------------------
export const DOC_STATUSES = {
  DRAFT: 'draft',
  REVIEW: 'review',
  FINAL: 'final',
} as const;

// ---------------------------------------------------------------------------
// Questionnaire statuses
// ---------------------------------------------------------------------------
export const QUESTIONNAIRE_STATUSES = {
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
} as const;

// ---------------------------------------------------------------------------
// Trust types — all 21 from spec
// ---------------------------------------------------------------------------
export const TRUST_TYPES = [
  'Revocable Living Trust',
  'Irrevocable Life Insurance Trust (ILIT)',
  'Special Needs Trust',
  'Supplemental Needs Trust',
  'Testamentary Trust',
  'Charitable Remainder Trust (CRT)',
  'Charitable Lead Trust (CLT)',
  'Qualified Personal Residence Trust (QPRT)',
  'Grantor Retained Annuity Trust (GRAT)',
  'Spousal Lifetime Access Trust (SLAT)',
  'Dynasty Trust',
  'Asset Protection Trust',
  'Medicaid Asset Protection Trust (MAPT)',
  'Blind Trust',
  'Spendthrift Trust',
  'Land Trust',
  'Qualified Terminable Interest Property Trust (QTIP)',
  'Credit Shelter Trust (Bypass Trust)',
  'Gun Trust',
  'Pet Trust',
  "Minor's Trust (Section 2503(c) Trust)",
] as const;

// ---------------------------------------------------------------------------
// Marital statuses
// ---------------------------------------------------------------------------
export const MARITAL_STATUSES = [
  'Single',
  'Married',
  'Divorced',
  'Widowed',
  'Domestic Partnership',
  'Separated',
] as const;

// ---------------------------------------------------------------------------
// Property titling options
// ---------------------------------------------------------------------------
export const PROPERTY_TITLING = [
  'Sole ownership',
  'Joint tenants',
  'Tenants in common',
  'Tenants by the entirety',
  'Trust',
  'LLC',
  'Other',
] as const;

// ---------------------------------------------------------------------------
// Bank / financial account types
// ---------------------------------------------------------------------------
export const ACCOUNT_TYPES = [
  'Checking',
  'Savings',
  'Money Market',
  'Certificate of Deposit',
  'Brokerage',
  'Mutual Fund',
  '529 College Savings',
  'HSA',
  'Other',
] as const;

// ---------------------------------------------------------------------------
// Retirement account types
// ---------------------------------------------------------------------------
export const RETIREMENT_ACCOUNT_TYPES = [
  '401(k)',
  '403(b)',
  '457(b)',
  'Traditional IRA',
  'Roth IRA',
  'SEP IRA',
  'SIMPLE IRA',
  'Pension',
  'Annuity',
  'Other',
] as const;

// ---------------------------------------------------------------------------
// Life insurance types
// ---------------------------------------------------------------------------
export const INSURANCE_TYPES = [
  'Term Life',
  'Whole Life',
  'Universal Life',
  'Variable Life',
  'Variable Universal Life',
  'Indexed Universal Life',
  'Group Life',
  'Other',
] as const;

// ---------------------------------------------------------------------------
// Business entity types
// ---------------------------------------------------------------------------
export const BUSINESS_ENTITY_TYPES = [
  'Sole Proprietorship',
  'General Partnership',
  'Limited Partnership (LP)',
  'Limited Liability Partnership (LLP)',
  'Limited Liability Company (LLC)',
  'S Corporation',
  'C Corporation',
  'Professional Corporation (PC)',
  'Professional LLC (PLLC)',
  'Non-Profit Corporation',
  'Other',
] as const;

// ---------------------------------------------------------------------------
// Payment methods
// ---------------------------------------------------------------------------
export const PAYMENT_METHODS = [
  'Credit Card',
  'Debit Card',
  'ACH / Bank Transfer',
  'Check',
  'Cash',
  'Wire Transfer',
  'Other',
] as const;

// ---------------------------------------------------------------------------
// Payment statuses
// ---------------------------------------------------------------------------
export const PAYMENT_STATUSES = {
  PENDING: 'pending',
  PAID: 'paid',
  PARTIAL: 'partial',
  OVERDUE: 'overdue',
  REFUNDED: 'refunded',
  VOIDED: 'voided',
} as const;

// ---------------------------------------------------------------------------
// Calendar event types
// ---------------------------------------------------------------------------
export const EVENT_TYPES = {
  CONSULTATION: 'consultation',
  SIGNING: 'signing',
  FOLLOW_UP: 'follow_up',
  DEADLINE: 'deadline',
  OTHER: 'other',
} as const;

// ---------------------------------------------------------------------------
// Note types
// ---------------------------------------------------------------------------
export const NOTE_TYPES = {
  GENERAL: 'general',
  CALL: 'call',
  EMAIL: 'email',
  MEETING: 'meeting',
  TASK: 'task',
  SYSTEM: 'system',
} as const;

// ---------------------------------------------------------------------------
// Note sources
// ---------------------------------------------------------------------------
export const NOTE_SOURCES = {
  MANUAL: 'manual',
  AI: 'ai',
  SYSTEM: 'system',
} as const;

// ---------------------------------------------------------------------------
// Citizenship statuses
// ---------------------------------------------------------------------------
export const CITIZENSHIP_STATUSES = [
  'US Citizen',
  'Permanent Resident (Green Card)',
  'Non-Resident Alien',
  'Other',
] as const;

// ---------------------------------------------------------------------------
// US states (NJ first, then alphabetical)
// ---------------------------------------------------------------------------
export const US_STATES = [
  { abbr: 'NJ', name: 'New Jersey' },
  { abbr: 'AL', name: 'Alabama' },
  { abbr: 'AK', name: 'Alaska' },
  { abbr: 'AZ', name: 'Arizona' },
  { abbr: 'AR', name: 'Arkansas' },
  { abbr: 'CA', name: 'California' },
  { abbr: 'CO', name: 'Colorado' },
  { abbr: 'CT', name: 'Connecticut' },
  { abbr: 'DE', name: 'Delaware' },
  { abbr: 'FL', name: 'Florida' },
  { abbr: 'GA', name: 'Georgia' },
  { abbr: 'HI', name: 'Hawaii' },
  { abbr: 'ID', name: 'Idaho' },
  { abbr: 'IL', name: 'Illinois' },
  { abbr: 'IN', name: 'Indiana' },
  { abbr: 'IA', name: 'Iowa' },
  { abbr: 'KS', name: 'Kansas' },
  { abbr: 'KY', name: 'Kentucky' },
  { abbr: 'LA', name: 'Louisiana' },
  { abbr: 'ME', name: 'Maine' },
  { abbr: 'MD', name: 'Maryland' },
  { abbr: 'MA', name: 'Massachusetts' },
  { abbr: 'MI', name: 'Michigan' },
  { abbr: 'MN', name: 'Minnesota' },
  { abbr: 'MS', name: 'Mississippi' },
  { abbr: 'MO', name: 'Missouri' },
  { abbr: 'MT', name: 'Montana' },
  { abbr: 'NE', name: 'Nebraska' },
  { abbr: 'NV', name: 'Nevada' },
  { abbr: 'NH', name: 'New Hampshire' },
  { abbr: 'NM', name: 'New Mexico' },
  { abbr: 'NY', name: 'New York' },
  { abbr: 'NC', name: 'North Carolina' },
  { abbr: 'ND', name: 'North Dakota' },
  { abbr: 'OH', name: 'Ohio' },
  { abbr: 'OK', name: 'Oklahoma' },
  { abbr: 'OR', name: 'Oregon' },
  { abbr: 'PA', name: 'Pennsylvania' },
  { abbr: 'RI', name: 'Rhode Island' },
  { abbr: 'SC', name: 'South Carolina' },
  { abbr: 'SD', name: 'South Dakota' },
  { abbr: 'TN', name: 'Tennessee' },
  { abbr: 'TX', name: 'Texas' },
  { abbr: 'UT', name: 'Utah' },
  { abbr: 'VT', name: 'Vermont' },
  { abbr: 'VA', name: 'Virginia' },
  { abbr: 'WA', name: 'Washington' },
  { abbr: 'WV', name: 'West Virginia' },
  { abbr: 'WI', name: 'Wisconsin' },
  { abbr: 'WY', name: 'Wyoming' },
  { abbr: 'DC', name: 'District of Columbia' },
] as const;

// ---------------------------------------------------------------------------
// Max file upload size — 25 MB
// ---------------------------------------------------------------------------
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Allowed document MIME types for uploads
// ---------------------------------------------------------------------------
export const ALLOWED_DOC_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
] as const;

// ---------------------------------------------------------------------------
// Firestore collection names / path helpers
// ---------------------------------------------------------------------------
export const COLLECTIONS = {
  FIRMS: 'firms',
  USERS: (firmId: string) => `firms/${firmId}/users`,
  CLIENTS: (firmId: string) => `firms/${firmId}/clients`,
  DOCUMENTS: (firmId: string, clientId: string) =>
    `firms/${firmId}/clients/${clientId}/documents`,
  NOTES: (firmId: string, clientId: string) =>
    `firms/${firmId}/clients/${clientId}/notes`,
  PAYMENTS: (firmId: string, clientId: string) =>
    `firms/${firmId}/clients/${clientId}/payments`,
  CALENDAR_EVENTS: (firmId: string) => `firms/${firmId}/calendarEvents`,
  TASKS: (firmId: string) => `firms/${firmId}/tasks`,
  KNOWLEDGE_BASE: (firmId: string) => `firms/${firmId}/knowledgeBase`,
  DOCUMENT_TEMPLATES: (firmId: string) => `firms/${firmId}/documentTemplates`,
} as const;

// ---------------------------------------------------------------------------
// Package → included document types map
// ---------------------------------------------------------------------------
export const PACKAGE_DOCUMENTS: Record<string, readonly string[]> = {
  foundation: ['will', 'poa', 'livingWill', 'coverLetter', 'engagementLetter'],
  guardian: [
    'will',
    'poa',
    'livingWill',
    'coverLetter',
    'engagementLetter',
    'estatePlanSummary',
    'actionSteps',
  ],
  fortress: [
    'trust',
    'pourOverWill',
    'poa',
    'livingWill',
    'deed',
    'affidavitOfConsideration',
    'gitRep3',
    'coverLetter',
    'engagementLetter',
    'invoice',
    'estatePlanSummary',
    'actionSteps',
  ],
} as const;

// ---------------------------------------------------------------------------
// Auth error messages
// ---------------------------------------------------------------------------
export const AUTH_ERRORS: Record<string, string> = {
  'auth/user-not-found': 'No account found with this email address.',
  'auth/wrong-password': 'Incorrect password. Please try again.',
  'auth/invalid-credential': 'Invalid credentials. Please check your email and password.',
  'auth/email-already-in-use': 'An account already exists with this email address.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/too-many-requests': 'Too many failed attempts. Please try again later.',
  'auth/network-request-failed': 'Network error. Please check your connection.',
  'auth/popup-closed-by-user': 'Sign-in cancelled.',
  'auth/cancelled-popup-request': 'Sign-in cancelled.',
  'auth/account-exists-with-different-credential':
    'An account already exists with this email using a different sign-in method.',
  'auth/invalid-email': 'Invalid email address.',
  'auth/user-disabled': 'This account has been disabled. Please contact support.',
  'auth/requires-recent-login': 'Please sign out and sign back in to complete this action.',
  'auth/invalid-action-code': 'The sign-in link has expired or already been used.',
};

// ---------------------------------------------------------------------------
// App routes
// ---------------------------------------------------------------------------
export const ROUTES = {
  LOGIN: '/login',
  UNAUTHORIZED: '/unauthorized',
  DASHBOARD: '/dashboard',
  CLIENTS: '/clients',
  CLIENT_NEW: '/clients/new',
  CLIENT_DETAIL: (id: string) => `/clients/${id}`,
  CLIENT_QUESTIONNAIRE: (id: string) => `/clients/${id}/questionnaire`,
  CLIENT_DOCUMENTS: (id: string) => `/clients/${id}/documents`,
  CLIENT_DOCUMENT_EDIT: (clientId: string, documentId: string) =>
    `/clients/${clientId}/documents/${documentId}/edit`,
  CALENDAR: '/calendar',
  PAYMENTS: '/payments',
  KNOWLEDGE_BASE: '/knowledge-base',
  SETTINGS: '/settings',
  SETTINGS_FIRM: '/settings/firm',
  SETTINGS_USERS: '/settings/users',
  SETTINGS_BILLING: '/settings/billing',
  CLIENT_PORTAL: (firmId: string, clientId: string) =>
    `/portal/${firmId}/${clientId}`,
} as const;

// ---------------------------------------------------------------------------
// AI / OpenAI
// ---------------------------------------------------------------------------
export const DEFAULT_AI_MODEL = 'gpt-4.1';
export const AI_PROMPT_MAX_FIELD_LENGTH = 2000;
export const AI_MAX_CONTEXT_TOKENS = 128_000;
