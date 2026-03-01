/**
 * tests/helpers/mock-data.ts
 *
 * NJ-specific mock data for all four questionnaire scenarios:
 *   1. Single person, no children (Foundation)
 *   2. Single person, 2 minor children (Guardian)
 *   3. Married couple, no children, 1 property (Foundation)
 *   4. Married couple, 3 children (1 minor), 2 properties, trust (Fortress)
 *
 * Also exports mock documents, payments, notes, and calendar events.
 */

import type { QuestionnaireData } from '@/types/questionnaire';

// ============================================================================
// Date helpers — produce deterministic DOBs relative to "today"
// ============================================================================

function dateYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().split('T')[0];
}

function dateYearsAgoMonthsAgo(years: number, months: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().split('T')[0];
}

// ============================================================================
// Scenario 1: Single person, no children, no real estate → Foundation
// ============================================================================
export const SCENARIO_SINGLE_NO_CHILDREN: Partial<QuestionnaireData> = {
  personalInfo: {
    firstName: 'Margaret',
    middleName: 'Ann',
    lastName: 'Sullivan',
    dob: dateYearsAgo(42),
    ssnLast4: '4321',
    email: 'margaret.sullivan@gmail.com',
    phone: '(732) 555-0101',
    address: '45 Oak Tree Road',
    city: 'Marlboro',
    state: 'NJ',
    zip: '07746',
    county: 'Monmouth',
    maritalStatus: 'Single',
    citizenship: 'US Citizen',
    occupation: 'Software Engineer',
    employer: 'Accenture',
  },
  hasChildren: false,
  numberOfChildren: 0,
  children: [],
  hasOtherDependents: false,
  otherDependents: [],
  assets: {
    hasRealEstate: false,
    realEstate: [],
    hasBankAccounts: true,
    bankAccounts: [
      {
        institution: 'Wells Fargo',
        accountType: 'Checking',
        estimatedBalance: 15000,
        titling: 'Sole ownership',
      },
      {
        institution: 'Vanguard',
        accountType: 'Brokerage',
        estimatedBalance: 95000,
        titling: 'Sole ownership',
      },
    ],
    retirementAccounts: [
      {
        institution: 'Fidelity',
        accountType: '401(k)',
        estimatedValue: 180000,
        primaryBeneficiary: 'James Sullivan',
      },
    ],
    lifeInsurance: [],
    businessInterests: [],
  },
  fiduciaries: {
    executor: {
      primary: { name: 'James Sullivan', relationship: 'Brother', phone: '(732) 555-0202' },
      alternate: { name: 'Linda Sullivan', relationship: 'Mother', phone: '(732) 555-0303' },
    },
  },
  distributionPlan: 'specific',
  distribution: {
    specificBequests: [],
    residualDistributions: [
      { recipientName: 'James Sullivan', recipientRelationship: 'brother', percentage: 50 },
      { recipientName: 'Linda Sullivan', recipientRelationship: 'mother', percentage: 50 },
    ],
    pourOverToTrust: false,
    noContestClause: false,
    spendthriftProvision: false,
  },
};

// ============================================================================
// Scenario 2: Single person, 2 minor children → Guardian
// ============================================================================
export const SCENARIO_SINGLE_WITH_MINORS: Partial<QuestionnaireData> = {
  personalInfo: {
    firstName: 'Denise',
    middleName: 'Marie',
    lastName: 'Rodriguez',
    dob: dateYearsAgo(34),
    ssnLast4: '7890',
    email: 'denise.rodriguez@yahoo.com',
    phone: '(856) 555-0104',
    address: '112 Laurel Avenue',
    city: 'Cherry Hill',
    state: 'NJ',
    zip: '08002',
    county: 'Camden',
    maritalStatus: 'Single',
    citizenship: 'US Citizen',
    occupation: 'Registered Nurse',
    employer: 'Cooper University Health Care',
  },
  hasChildren: true,
  numberOfChildren: 2,
  children: [
    {
      name: 'Isabella Rodriguez',
      dob: dateYearsAgo(8),
      relationship: 'biological',
      specialNeeds: false,
    },
    {
      name: 'Lucas Rodriguez',
      dob: dateYearsAgo(5),
      relationship: 'biological',
      specialNeeds: false,
    },
  ],
  hasOtherDependents: false,
  otherDependents: [],
  guardianPrimary: {
    name: 'Carmen Rodriguez',
    relationship: 'Sister',
    phone: '(856) 555-0205',
    email: 'carmen.r@gmail.com',
  },
  guardianAlternate: {
    name: 'Roberto Rodriguez',
    relationship: 'Brother',
    phone: '(856) 555-0206',
  },
  assets: {
    hasRealEstate: true,
    realEstate: [
      {
        address: '112 Laurel Avenue',
        city: 'Cherry Hill',
        county: 'Camden',
        state: 'NJ',
        zip: '08002',
        isPrimaryResidence: true,
        blockLot: 'Block 204, Lot 12',
        estimatedValue: 625000,
        mortgageBalance: 210000,
        mortgageLender: 'PNC Bank',
        titling: 'Sole ownership',
      },
    ],
    bankAccounts: [
      {
        institution: 'TD Bank',
        accountType: 'Checking',
        estimatedBalance: 8500,
        titling: 'Sole ownership',
      },
    ],
    retirementAccounts: [
      {
        institution: 'Vanguard',
        accountType: 'Roth IRA',
        estimatedValue: 45000,
        primaryBeneficiary: 'Carmen Rodriguez',
      },
    ],
    lifeInsurance: [
      {
        company: 'MetLife',
        insuranceType: 'Term Life',
        faceValue: 500000,
        cashValue: 0,
        primaryBeneficiary: 'Children equally',
      },
    ],
  },
  fiduciaries: {
    executor: {
      primary: { name: 'Carmen Rodriguez', relationship: 'Sister', phone: '(856) 555-0205' },
      alternate: { name: 'Roberto Rodriguez', relationship: 'Brother', phone: '(856) 555-0206' },
    },
  },
  distributionPlan: 'equalToChildren',
  distribution: {
    specificBequests: [],
    residualDistributions: [
      { recipientName: 'Isabella Rodriguez', recipientRelationship: 'daughter', percentage: 50 },
      { recipientName: 'Lucas Rodriguez', recipientRelationship: 'son', percentage: 50 },
    ],
    pourOverToTrust: false,
    noContestClause: false,
    spendthriftProvision: false,
  },
};

// ============================================================================
// Scenario 3: Married couple, no children, 1 property → Foundation
// ============================================================================
export const SCENARIO_MARRIED_NO_CHILDREN: Partial<QuestionnaireData> = {
  personalInfo: {
    firstName: 'Thomas',
    middleName: 'Edward',
    lastName: 'Kowalski',
    dob: dateYearsAgo(51),
    ssnLast4: '1122',
    email: 'thomas.kowalski@comcast.net',
    phone: '(609) 555-0107',
    address: '27 Meadow Brook Lane',
    city: 'Princeton Junction',
    state: 'NJ',
    zip: '08550',
    county: 'Mercer',
    maritalStatus: 'Married',
    citizenship: 'US Citizen',
    occupation: 'CPA',
    employer: 'Deloitte',
  },
  spouseInfo: {
    firstName: 'Susan',
    middleName: 'Lynn',
    lastName: 'Kowalski',
    dob: dateYearsAgo(49),
    ssnLast4: '3344',
    email: 'susan.kowalski@comcast.net',
    phone: '(609) 555-0108',
    address: '27 Meadow Brook Lane',
    city: 'Princeton Junction',
    state: 'NJ',
    zip: '08550',
    county: 'Mercer',
    citizenship: 'US Citizen',
  },
  hasChildren: false,
  numberOfChildren: 0,
  children: [],
  hasOtherDependents: false,
  otherDependents: [],
  assets: {
    hasRealEstate: true,
    realEstate: [
      {
        address: '27 Meadow Brook Lane',
        city: 'Princeton Junction',
        county: 'Mercer',
        state: 'NJ',
        zip: '08550',
        isPrimaryResidence: true,
        blockLot: 'Block 77, Lot 3.04',
        estimatedValue: 620000,
        mortgageBalance: 180000,
        mortgageLender: 'Chase',
        titling: 'Tenants by the entirety',
      },
    ],
    bankAccounts: [
      {
        institution: 'Bank of America',
        accountType: 'Checking',
        estimatedBalance: 35000,
        titling: 'Joint tenants',
      },
      {
        institution: 'Vanguard',
        accountType: 'Brokerage',
        estimatedBalance: 240000,
        titling: 'Joint tenants',
      },
    ],
    retirementAccounts: [
      {
        institution: 'Fidelity',
        accountType: '401(k)',
        estimatedValue: 450000,
        primaryBeneficiary: 'Susan Kowalski',
      },
      {
        institution: 'Schwab',
        accountType: 'Traditional IRA',
        estimatedValue: 120000,
        primaryBeneficiary: 'Thomas Kowalski',
      },
    ],
    lifeInsurance: [],
  },
  fiduciaries: {
    executor: {
      primary: { name: 'Susan Kowalski', relationship: 'Spouse', phone: '(609) 555-0108' },
      alternate: { name: 'Robert Kowalski', relationship: 'Brother', phone: '(609) 555-0109' },
    },
    healthcareProxy: {
      primary: { name: 'Susan Kowalski', relationship: 'Spouse', phone: '(609) 555-0108' },
      alternate: { name: 'Robert Kowalski', relationship: 'Brother', phone: '(609) 555-0109' },
    },
  },
  distributionPlan: 'allToSpouse',
  distribution: {
    specificBequests: [],
    residualDistributions: [
      { recipientName: 'Susan Kowalski', recipientRelationship: 'spouse', percentage: 100 },
    ],
    pourOverToTrust: false,
    noContestClause: false,
    spendthriftProvision: false,
  },
};

// ============================================================================
// Scenario 4: Married, 3 children (1 minor), 2 properties, trust → Fortress
// ============================================================================
export const SCENARIO_MARRIED_COMPLEX: Partial<QuestionnaireData> = {
  personalInfo: {
    firstName: 'Robert',
    middleName: 'James',
    lastName: 'Nguyen',
    dob: dateYearsAgo(58),
    ssnLast4: '5566',
    email: 'robert.nguyen@nguyenlaw.com',
    phone: '(973) 555-0110',
    address: '14 Highland Terrace',
    city: 'Montclair',
    state: 'NJ',
    zip: '07042',
    county: 'Essex',
    maritalStatus: 'Married',
    citizenship: 'US Citizen',
    occupation: 'Attorney',
    employer: 'Nguyen & Associates, LLC',
  },
  spouseInfo: {
    firstName: 'Patricia',
    middleName: 'Chen',
    lastName: 'Nguyen',
    dob: dateYearsAgo(55),
    ssnLast4: '7788',
    email: 'patricia.nguyen@gmail.com',
    phone: '(973) 555-0111',
    address: '14 Highland Terrace',
    city: 'Montclair',
    state: 'NJ',
    zip: '07042',
    county: 'Essex',
    citizenship: 'US Citizen',
  },
  hasChildren: true,
  numberOfChildren: 3,
  children: [
    {
      name: 'Andrew James Nguyen',
      dob: dateYearsAgo(28),
      relationship: 'biological',
      specialNeeds: false,
    },
    {
      name: 'Michelle Patricia Nguyen',
      dob: dateYearsAgo(24),
      relationship: 'biological',
      specialNeeds: false,
    },
    {
      name: 'Ethan Robert Nguyen',
      dob: dateYearsAgoMonthsAgo(14, 3), // 14 years old — minor
      relationship: 'biological',
      specialNeeds: false,
    },
  ],
  hasOtherDependents: false,
  otherDependents: [],
  guardianPrimary: {
    name: 'David Nguyen',
    relationship: 'Brother',
    phone: '(973) 555-0212',
    email: 'david.nguyen@gmail.com',
  },
  guardianAlternate: {
    name: 'Grace Chen',
    relationship: 'Sister-in-law',
    phone: '(973) 555-0213',
  },
  assets: {
    hasRealEstate: true,
    realEstate: [
      {
        address: '14 Highland Terrace',
        city: 'Montclair',
        county: 'Essex',
        state: 'NJ',
        zip: '07042',
        isPrimaryResidence: true,
        blockLot: 'Block 501, Lot 8',
        estimatedValue: 1100000,
        mortgageBalance: 350000,
        mortgageLender: 'First National Bank',
        titling: 'Tenants by the entirety',
        transferToTrust: true,
      },
      {
        address: '88 Ocean Drive',
        city: 'Spring Lake',
        county: 'Monmouth',
        state: 'NJ',
        zip: '07762',
        isPrimaryResidence: false,
        blockLot: 'Block 1002, Lot 17',
        estimatedValue: 850000,
        mortgageBalance: 0,
        titling: 'Sole ownership',
        transferToTrust: true,
      },
    ],
    bankAccounts: [
      {
        institution: 'TD Bank',
        accountType: 'Checking',
        estimatedBalance: 85000,
        titling: 'Joint tenants',
      },
    ],
    retirementAccounts: [
      {
        institution: 'Schwab',
        accountType: '401(k)',
        estimatedValue: 850000,
        primaryBeneficiary: 'Patricia Nguyen',
      },
    ],
    lifeInsurance: [
      {
        company: 'Prudential',
        insuranceType: 'Whole Life',
        faceValue: 1000000,
        cashValue: 220000,
        primaryBeneficiary: 'Patricia Nguyen',
      },
    ],
    businessInterests: [
      {
        businessName: 'Nguyen & Associates, LLC',
        entityType: 'Limited Liability Company (LLC)',
        ownershipPercentage: 100,
        estimatedValue: 500000,
      },
    ],
  },
  fiduciaries: {
    executor: {
      primary: { name: 'Patricia Nguyen', relationship: 'Spouse', phone: '(973) 555-0111' },
      alternate: { name: 'Andrew Nguyen', relationship: 'Son', phone: '(973) 555-0220' },
    },
    trustee: {
      primary: { name: 'Patricia Nguyen', relationship: 'Spouse', phone: '(973) 555-0111' },
      alternate: { name: 'Andrew Nguyen', relationship: 'Son', phone: '(973) 555-0220' },
    },
    healthcareProxy: {
      primary: { name: 'Patricia Nguyen', relationship: 'Spouse', phone: '(973) 555-0111' },
      alternate: { name: 'David Nguyen', relationship: 'Brother', phone: '(973) 555-0212' },
    },
  },
  distributionPlan: 'allToSpouse',
  distribution: {
    specificBequests: [
      {
        item: 'My law library and professional materials',
        recipientName: 'Andrew James Nguyen',
        recipientRelationship: 'son',
      },
    ],
    residualDistributions: [
      { recipientName: 'Patricia Nguyen', recipientRelationship: 'spouse', percentage: 100 },
    ],
    pourOverToTrust: true,
    noContestClause: true,
    spendthriftProvision: true,
    charitableBequests: [],
  },
};

// ============================================================================
// Mock Client objects (for dashboard / integration tests)
// ============================================================================

export interface MockClient {
  id: string;
  firmId: string;
  personalInfo: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    county: string;
    maritalStatus: string;
  };
  packageType: 'foundation' | 'guardian' | 'fortress';
  status: 'prospect' | 'active' | 'pending_review' | 'completed' | 'archived';
  questionnaireStatus: 'not_started' | 'in_progress' | 'completed';
  linkedUserId?: string;
  createdAt: string;
  updatedAt: string;
}

export const MOCK_CLIENT_FOUNDATION: MockClient = {
  id: 'client-001',
  firmId: 'firm-001',
  personalInfo: {
    firstName: 'Margaret',
    lastName: 'Sullivan',
    email: 'margaret.sullivan@gmail.com',
    phone: '(732) 555-0101',
    address: '45 Oak Tree Road',
    city: 'Marlboro',
    state: 'NJ',
    zip: '07746',
    county: 'Monmouth',
    maritalStatus: 'Single',
  },
  packageType: 'foundation',
  status: 'active',
  questionnaireStatus: 'completed',
  linkedUserId: 'user-client-001',
  createdAt: '2025-10-15T10:00:00Z',
  updatedAt: '2025-11-01T14:30:00Z',
};

export const MOCK_CLIENT_GUARDIAN: MockClient = {
  id: 'client-002',
  firmId: 'firm-001',
  personalInfo: {
    firstName: 'Denise',
    lastName: 'Rodriguez',
    email: 'denise.rodriguez@yahoo.com',
    phone: '(856) 555-0104',
    address: '112 Laurel Avenue',
    city: 'Cherry Hill',
    state: 'NJ',
    zip: '08002',
    county: 'Camden',
    maritalStatus: 'Single',
  },
  packageType: 'guardian',
  status: 'pending_review',
  questionnaireStatus: 'completed',
  linkedUserId: 'user-client-002',
  createdAt: '2025-11-01T09:00:00Z',
  updatedAt: '2025-11-20T16:00:00Z',
};

export const MOCK_CLIENT_FORTRESS: MockClient = {
  id: 'client-003',
  firmId: 'firm-001',
  personalInfo: {
    firstName: 'Robert',
    lastName: 'Nguyen',
    email: 'robert.nguyen@nguyenlaw.com',
    phone: '(973) 555-0110',
    address: '14 Highland Terrace',
    city: 'Montclair',
    state: 'NJ',
    zip: '07042',
    county: 'Essex',
    maritalStatus: 'Married',
  },
  packageType: 'fortress',
  status: 'active',
  questionnaireStatus: 'completed',
  linkedUserId: 'user-client-003',
  createdAt: '2025-09-10T11:00:00Z',
  updatedAt: '2025-11-25T09:45:00Z',
};

// ============================================================================
// Mock Documents
// ============================================================================

export interface MockDocument {
  id: string;
  clientId: string;
  firmId: string;
  docType: string;
  title: string;
  status: 'draft' | 'under_review' | 'approved' | 'signed' | 'filed' | 'archived';
  content: string;
  createdAt: string;
  updatedAt: string;
  approvedBy?: string;
  approvedAt?: string;
}

export const MOCK_WILL_DOCUMENT: MockDocument = {
  id: 'doc-will-001',
  clientId: 'client-001',
  firmId: 'firm-001',
  docType: 'will',
  title: 'Last Will and Testament of Margaret Ann Sullivan',
  status: 'draft',
  content: `<h1>LAST WILL AND TESTAMENT OF MARGARET ANN SULLIVAN</h1>
<div class="draft-watermark" style="text-align:center;font-size:14pt;color:#cc0000;font-weight:bold;letter-spacing:2px;margin:12px 0;border:2px solid #cc0000;padding:6px;">
  DRAFT &mdash; NOT YET EXECUTED
</div>
<p>I, Margaret Ann Sullivan, residing at 45 Oak Tree Road, Marlboro, County of Monmouth, State of New Jersey...</p>
<h2>ARTICLE I — DEBTS, EXPENSES, AND TAXES</h2>
<p>I direct my Executor to pay all of my just debts...</p>
<h2>ARTICLE II — SPECIFIC BEQUESTS</h2>
<p>I make no specific bequests of identified personal property items at this time...</p>
<h2>ARTICLE III — RESIDUARY ESTATE</h2>
<p>In equal shares to James Sullivan (fifty percent (50%)) and Linda Sullivan (fifty percent (50%))...</p>
<h2>TESTIMONIUM</h2>
<p>IN WITNESS WHEREOF, I have hereunto subscribed my name this _____ day of ____________, 20___.</p>
<p>Witness 1:<br/>Name (Print): ________________________________<br/>
<span class="sig-line" style="display:inline-block;border-bottom:1px solid #000;min-width:300px;">&nbsp;</span></p>
<p>Witness 2:<br/>Name (Print): ________________________________<br/>
<span class="sig-line" style="display:inline-block;border-bottom:1px solid #000;min-width:300px;">&nbsp;</span></p>`,
  createdAt: '2025-11-01T14:00:00Z',
  updatedAt: '2025-11-01T14:00:00Z',
};

export const MOCK_POA_DOCUMENT: MockDocument = {
  id: 'doc-poa-001',
  clientId: 'client-001',
  firmId: 'firm-001',
  docType: 'poa',
  title: 'Durable Financial Power of Attorney — Margaret Ann Sullivan',
  status: 'draft',
  content: `<h1>DURABLE POWER OF ATTORNEY</h1>
<div class="draft-watermark" style="text-align:center;font-size:14pt;color:#cc0000;font-weight:bold;">
  DRAFT &mdash; NOT YET EXECUTED
</div>
<p>Pursuant to N.J.S.A. 46:2B-8.1 et seq...</p>`,
  createdAt: '2025-11-01T14:05:00Z',
  updatedAt: '2025-11-01T14:05:00Z',
};

export const MOCK_APPROVED_DOCUMENT: MockDocument = {
  id: 'doc-will-approved',
  clientId: 'client-002',
  firmId: 'firm-001',
  docType: 'will',
  title: 'Last Will and Testament of Denise Marie Rodriguez',
  status: 'approved',
  content: '<h1>LAST WILL AND TESTAMENT...</h1>',
  createdAt: '2025-11-15T10:00:00Z',
  updatedAt: '2025-11-20T14:00:00Z',
  approvedBy: 'attorney-001',
  approvedAt: '2025-11-20T14:00:00Z',
};

// ============================================================================
// Mock Payments
// ============================================================================

export interface MockPayment {
  id: string;
  clientId: string;
  firmId: string;
  amount: number;
  description: string;
  method: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'refunded';
  date: string;
  createdAt: string;
}

export const MOCK_PAYMENTS: MockPayment[] = [
  {
    id: 'pay-001',
    clientId: 'client-001',
    firmId: 'firm-001',
    amount: 1500,
    description: 'Foundation Plan — Retainer',
    method: 'Check',
    status: 'completed',
    date: '2025-10-15',
    createdAt: '2025-10-15T10:30:00Z',
  },
  {
    id: 'pay-002',
    clientId: 'client-001',
    firmId: 'firm-001',
    amount: 1000,
    description: 'Foundation Plan — Balance Due',
    method: 'ACH / Bank Transfer',
    status: 'pending',
    date: '2025-11-15',
    createdAt: '2025-11-01T14:45:00Z',
  },
];

export const MOCK_PAYMENT_SUMMARY = {
  totalCharged: 2500,
  totalPaid: 1500,
  balanceDue: 1000,
  lastPaymentDate: '2025-10-15',
  lastPaymentAmount: 1500,
};

// ============================================================================
// Mock Notes
// ============================================================================

export interface MockNote {
  id: string;
  clientId: string;
  firmId: string;
  title: string;
  content: string;
  type: 'general' | 'call' | 'email' | 'meeting' | 'task' | 'system';
  source: 'manual' | 'ai' | 'system';
  isPinned: boolean;
  tags: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export const MOCK_NOTES: MockNote[] = [
  {
    id: 'note-001',
    clientId: 'client-001',
    firmId: 'firm-001',
    title: 'Initial Consultation Call',
    content: 'Client called to discuss options. Single, no children. Primary concern is naming executor. Prefers Foundation plan. Will schedule signing appointment after documents are reviewed.',
    type: 'call',
    source: 'manual',
    isPinned: true,
    tags: ['consultation', 'foundation'],
    createdBy: 'attorney-001',
    createdAt: '2025-10-15T11:00:00Z',
    updatedAt: '2025-10-15T11:00:00Z',
  },
  {
    id: 'note-002',
    clientId: 'client-001',
    firmId: 'firm-001',
    title: 'Questionnaire Completed',
    content: 'Client completed the online questionnaire. All sections filled. SSN last 4 confirmed. Ready for document generation.',
    type: 'system',
    source: 'system',
    isPinned: false,
    tags: ['questionnaire'],
    createdBy: 'system',
    createdAt: '2025-10-20T14:30:00Z',
    updatedAt: '2025-10-20T14:30:00Z',
  },
  {
    id: 'note-003',
    clientId: 'client-001',
    firmId: 'firm-001',
    title: 'Follow-up Email Sent',
    content: 'Sent email confirming receipt of questionnaire. Advised 5-7 business days for draft documents.',
    type: 'email',
    source: 'manual',
    isPinned: false,
    tags: ['email', 'follow-up'],
    createdBy: 'attorney-001',
    createdAt: '2025-10-21T09:00:00Z',
    updatedAt: '2025-10-21T09:00:00Z',
  },
];

// ============================================================================
// Mock Calendar Events
// ============================================================================

export interface MockCalendarEvent {
  id: string;
  firmId: string;
  clientId?: string;
  title: string;
  description?: string;
  eventType: 'consultation' | 'signing' | 'follow_up' | 'deadline' | 'other';
  start: string;
  end: string;
  location?: string;
  status: 'scheduled' | 'confirmed' | 'cancelled' | 'completed' | 'rescheduled';
  createdBy: string;
  attendees: string[];
  createdAt: string;
}

export const MOCK_CALENDAR_EVENTS: MockCalendarEvent[] = [
  {
    id: 'event-001',
    firmId: 'firm-001',
    clientId: 'client-001',
    title: 'Signing Appointment — Margaret Sullivan',
    description: 'Execution of Foundation Plan documents. Bring two witnesses.',
    eventType: 'signing',
    start: '2025-12-10T10:00:00Z',
    end: '2025-12-10T11:30:00Z',
    location: '168 Prospect Plains Road, Monroe Township, NJ 08831',
    status: 'scheduled',
    createdBy: 'attorney-001',
    attendees: ['attorney-001', 'user-client-001'],
    createdAt: '2025-11-25T09:00:00Z',
  },
  {
    id: 'event-002',
    firmId: 'firm-001',
    clientId: 'client-002',
    title: 'Review Call — Denise Rodriguez',
    description: 'Review Will and Trust Provisions. Confirm guardian designations.',
    eventType: 'consultation',
    start: '2025-12-05T14:00:00Z',
    end: '2025-12-05T15:00:00Z',
    status: 'confirmed',
    createdBy: 'attorney-001',
    attendees: ['attorney-001', 'user-client-002'],
    createdAt: '2025-11-28T11:00:00Z',
  },
];

// ============================================================================
// Mock User (auth / roles)
// ============================================================================

export interface MockUser {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'attorney' | 'paralegal' | 'client';
  firmId: string;
  linkedClientId?: string;
}

export const MOCK_ADMIN_USER: MockUser = {
  uid: 'admin-uid-001',
  email: 'admin@eliascounsel.com',
  displayName: 'System Admin',
  role: 'admin',
  firmId: 'firm-001',
};

export const MOCK_ATTORNEY_USER: MockUser = {
  uid: 'attorney-uid-001',
  email: 'adam@adameliaslaw.com',
  displayName: 'Adam Elias, Esq.',
  role: 'attorney',
  firmId: 'firm-001',
};

export const MOCK_PARALEGAL_USER: MockUser = {
  uid: 'paralegal-uid-001',
  email: 'paralegal@eliascounsel.com',
  displayName: 'Jane Doe',
  role: 'paralegal',
  firmId: 'firm-001',
};

export const MOCK_CLIENT_USER: MockUser = {
  uid: 'user-client-001',
  email: 'margaret.sullivan@gmail.com',
  displayName: 'Margaret Sullivan',
  role: 'client',
  firmId: 'firm-001',
  linkedClientId: 'client-001',
};

export const MOCK_OTHER_CLIENT_USER: MockUser = {
  uid: 'user-client-999',
  email: 'other.client@example.com',
  displayName: 'Other Client',
  role: 'client',
  firmId: 'firm-001',
  linkedClientId: 'client-999',
};
