/**
 * Questionnaire data model and step definitions for the NJ Estate Plan Generator.
 * Each "step" is one screen in the multi-step questionnaire flow.
 */

import type {
  PersonalInfo,
  SpouseInfo,
  Child,
  Assets,
  Liabilities,
  Fiduciaries,
  Distribution,
  HealthcarePreferences,
  FiduciaryPerson,
} from './index';

// ============================================================================
// Section types
// ============================================================================

export type QuestionnaireSection =
  | 'aboutYou'
  | 'spouse'
  | 'children'
  | 'assets'
  | 'liabilities'
  | 'fiduciaries'
  | 'wishes'
  | 'healthcare'
  | 'additional';

export interface SectionMeta {
  id: QuestionnaireSection;
  title: string;
  description: string;
  icon: string; // lucide icon name
  estimatedMinutes: number;
}

// ============================================================================
// Field types
// ============================================================================

export type FieldType =
  | 'text'
  | 'email'
  | 'phone'
  | 'textarea'
  | 'number'
  | 'currency'
  | 'date'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'multiselect'
  | 'combobox'    // searchable typeahead select
  | 'yesno'       // Yes/No toggle buttons
  | 'ssn4'        // last 4 of SSN (masked)
  | 'address'     // composite address fields
  | 'repeater'    // dynamic add/remove sections
  | 'heading'     // section heading (non-input)
  | 'info';       // informational text block

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
}

export interface ValidationRule {
  pattern?: string;
  patternMessage?: string;   // human-readable error when pattern fails
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  message?: string;
}

// ============================================================================
// Conditions (skip logic)
// ============================================================================

export interface StepCondition {
  field: string; // dot-path to check in QuestionnaireData
  operator: 'equals' | 'notEquals' | 'includes' | 'gt' | 'lt' | 'exists' | 'notExists' | 'hasMinorChild';
  value?: unknown;
}

export type FieldCondition = StepCondition;

// ============================================================================
// Field configuration
// ============================================================================

export interface FieldConfig {
  name: string;                  // dot-path in form data, e.g. "personalInfo.firstName"
  label: string;
  type: FieldType;
  placeholder?: string;
  required?: boolean;
  validation?: ValidationRule;
  options?: SelectOption[];      // for select, radio, checkbox, multiselect
  defaultValue?: unknown;
  helpText?: string;
  mask?: string;                 // for phone, SSN, currency
  min?: number;
  max?: number;
  rows?: number;                 // for textarea
  condition?: FieldCondition;    // show/hide within a step
  width?: 'full' | 'half' | 'third'; // grid width hint
  // Dynamic options — pull options from top-level data (e.g. 'children' → children[].name)
  optionsFrom?: {
    source: string;              // dot-path to the array in QuestionnaireData (e.g. 'children')
    labelField: string;          // field in each item to use as the label (e.g. 'name')
    valueField: string;          // field in each item to use as the value (e.g. 'name')
  };
  // For repeater fields
  itemLabel?: string;            // e.g. "Child", "Property"
  innerFields?: FieldConfig[];   // fields inside each repeater item
  repeaterConfig?: {
    itemLabel?: string;
    addLabel?: string;
    minItems?: number;
    maxItems?: number;
    fields?: FieldConfig[];
  };
}

// ============================================================================
// Step definition
// ============================================================================

export interface QuestionnaireStep {
  id: string;                      // unique step ID e.g. "personal_name"
  section: QuestionnaireSection;   // which section this step belongs to
  title: string;                   // displayed step title
  subtitle?: string;               // optional explanation/help text
  fields: FieldConfig[];           // fields to render on this step
  condition?: StepCondition;       // skip logic — when to show this step
  estimatedMinutes?: number;       // contributes to time estimate
}

// ============================================================================
// Questionnaire data shape (stored in Firestore as part of client document)
// ============================================================================

export interface QuestionnaireData {
  // Section 1: About You
  personalInfo: Partial<PersonalInfo>;

  // Section 2: Spouse / Partner
  spouseInfo?: Partial<SpouseInfo>;

  // Section 3: Children & Dependents
  hasChildren: boolean;
  numberOfChildren?: number;
  children: Partial<Child>[];
  hasGrandchildren?: boolean;
  grandchildren?: Array<{ name: string; dob?: string; parentName?: string; gender?: string; specialNeeds?: boolean; specialNeedsDetails?: string }>;
  hasOtherDependents: boolean;
  otherDependents: Array<{ name: string; relationship: string; notes?: string }>;
  guardianPrimary?: Partial<FiduciaryPerson>;
  guardianAlternate?: Partial<FiduciaryPerson>;

  // Section 4: Assets
  assets: Partial<Assets>;

  // Section 5: Liabilities
  liabilities: Partial<Liabilities>;

  // Section 6: Fiduciaries
  fiduciaries: Partial<Fiduciaries>;

  // Section 7: Wishes / Distribution
  distributionPlan: string; // 'allToSpouse' | 'equalToChildren' | 'specific' | 'custom'
  distribution: Partial<Distribution>;

  // Section 8: Healthcare
  healthcarePreferences: Partial<HealthcarePreferences>;
  isFemale?: boolean;        // for pregnancy provision in NJ advance directive
  burialPreference?: string; // 'burial' | 'cremation' | 'undecided'
  burialDetails?: string;

  // Section 9: Additional
  hasExistingDocuments: boolean;
  existingDocumentsDetails?: string;
  existingDocumentsDate?: string;
  hasPendingLegalMatters: boolean;
  pendingLegalDetails?: string;
  additionalNotes?: string;
  referralSource?: string;

  // File Uploads
  uploads: Array<{
    name: string;
    url: string;
    date: string;
    size: number;
    path: string;
    type: string;
  }>;

  // Meta — progress tracking
  currentStepIndex: number;
  completedSteps: string[];
  sectionProgress: Record<QuestionnaireSection, number>; // 0–100
}

// ============================================================================
// Default/empty QuestionnaireData
// ============================================================================

export function createEmptyQuestionnaireData(): QuestionnaireData {
  return {
    personalInfo: {},
    hasChildren: false,
    children: [],
    hasGrandchildren: false,
    grandchildren: [],
    hasOtherDependents: false,
    otherDependents: [],
    assets: {
      realEstate: [],
      bankAccounts: [],
      investmentAccounts: [],
      retirementAccounts: [],
      lifeInsurance: [],
      businessInterests: [],
      personalProperty: [],
      digitalAssets: [],
    },
    liabilities: {
      mortgages: [],
      otherLiabilities: [],
    },
    fiduciaries: {},
    distributionPlan: '',
    distribution: {
      specificBequests: [],
      residualDistributions: [],
      charitableBequests: [],
      pourOverToTrust: false,
      noContestClause: false,
      spendthriftProvision: false,
    },
    healthcarePreferences: {},
    hasExistingDocuments: false,
    hasPendingLegalMatters: false,
    uploads: [],
    currentStepIndex: 0,
    completedSteps: [],
    sectionProgress: {
      aboutYou: 0,
      spouse: 0,
      children: 0,
      assets: 0,
      liabilities: 0,
      fiduciaries: 0,
      wishes: 0,
      healthcare: 0,
      additional: 0,
    },
  };
}

// ============================================================================
// Section metadata
// ============================================================================

export const SECTION_META: SectionMeta[] = [
  {
    id: 'aboutYou',
    title: 'About You',
    description: 'Your personal information',
    icon: 'User',
    estimatedMinutes: 3,
  },
  {
    id: 'spouse',
    title: 'Your Spouse / Partner',
    description: 'Information about your spouse or domestic partner',
    icon: 'Heart',
    estimatedMinutes: 3,
  },
  {
    id: 'children',
    title: 'Children & Dependents',
    description: 'Your children and other dependents',
    icon: 'Users',
    estimatedMinutes: 4,
  },
  {
    id: 'assets',
    title: 'Your Assets',
    description: 'Real estate, accounts, insurance, and other assets',
    icon: 'Building',
    estimatedMinutes: 8,
  },
  {
    id: 'liabilities',
    title: 'Your Liabilities',
    description: 'Mortgages, loans, and other debts',
    icon: 'CreditCard',
    estimatedMinutes: 3,
  },
  {
    id: 'fiduciaries',
    title: 'Your Fiduciaries',
    description: 'People you trust to carry out your wishes',
    icon: 'Shield',
    estimatedMinutes: 5,
  },
  {
    id: 'wishes',
    title: 'Your Wishes',
    description: 'How you want your estate distributed',
    icon: 'Gift',
    estimatedMinutes: 5,
  },
  {
    id: 'healthcare',
    title: 'Healthcare Preferences',
    description: 'Advance directive and living will preferences',
    icon: 'HeartPulse',
    estimatedMinutes: 4,
  },
  {
    id: 'additional',
    title: 'Additional Information',
    description: 'Any other information we should know',
    icon: 'Info',
    estimatedMinutes: 2,
  },
];

// ============================================================================
// Full questionnaire step definitions
// ============================================================================

export const QUESTIONNAIRE_STEPS: QuestionnaireStep[] = [
  // ── Section 1: About You ──────────────────────────────────────────────────

  {
    id: 'personal_name',
    section: 'aboutYou',
    title: 'What is your full legal name?',
    subtitle: 'Please enter your name exactly as it appears on your government-issued ID.',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'personalInfo.firstName',
        label: 'First Name',
        type: 'text',
        placeholder: 'First name',
        required: true,
        width: 'half',
      },
      {
        name: 'personalInfo.middleName',
        label: 'Middle Name',
        type: 'text',
        placeholder: 'Middle name (optional)',
        width: 'half',
      },
      {
        name: 'personalInfo.lastName',
        label: 'Last Name',
        type: 'text',
        placeholder: 'Last name',
        required: true,
        width: 'half',
      },
      {
        name: 'personalInfo.suffix',
        label: 'Suffix',
        type: 'select',
        placeholder: 'Jr., Sr., III…',
        width: 'third',
        options: [
          { label: 'Jr.', value: 'Jr.' },
          { label: 'Sr.', value: 'Sr.' },
          { label: 'II', value: 'II' },
          { label: 'III', value: 'III' },
          { label: 'IV', value: 'IV' },
          { label: 'Esq.', value: 'Esq.' },
        ],
      },
    ],
  },

  {
    id: 'personal_contact',
    section: 'aboutYou',
    title: 'How can we reach you?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'personalInfo.email',
        label: 'Email Address',
        type: 'email',
        placeholder: 'your@email.com',
        required: true,
        width: 'full',
      },
      {
        name: 'personalInfo.phone',
        label: 'Primary Phone',
        type: 'phone',
        placeholder: '(609) 555-0100',
        required: true,
        width: 'half',
      },
      {
        name: 'personalInfo.alternatePhone',
        label: 'Alternate Phone',
        type: 'phone',
        placeholder: '(609) 555-0200',
        width: 'half',
      },
    ],
  },

  {
    id: 'personal_dob',
    section: 'aboutYou',
    title: 'What is your date of birth?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'personalInfo.dob',
        label: 'Date of Birth',
        type: 'date',
        required: true,
        width: 'half',
      },
      {
        name: 'personalInfo.ssnLast4',
        label: 'Last 4 digits of Social Security Number',
        type: 'ssn4',
        placeholder: '••••',
        helpText: 'Used only for document preparation purposes.',
        width: 'half',
      },
    ],
  },

  {
    id: 'personal_address',
    section: 'aboutYou',
    title: 'What is your home address?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'personalInfo',
        label: 'Home Address',
        type: 'address',
        required: true,
        width: 'full',
      },
    ],
  },

  {
    id: 'personal_marital',
    section: 'aboutYou',
    title: 'What is your marital status?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'personalInfo.maritalStatus',
        label: 'Marital Status',
        type: 'radio',
        required: true,
        width: 'full',
        options: [
          { label: 'Single', value: 'Single' },
          { label: 'Married', value: 'Married' },
          { label: 'Domestic Partnership', value: 'Domestic Partnership' },
          { label: 'Divorced', value: 'Divorced' },
          { label: 'Widowed', value: 'Widowed' },
          { label: 'Separated', value: 'Separated' },
        ],
      },
    ],
  },

  {
    id: 'personal_citizenship',
    section: 'aboutYou',
    title: 'What is your citizenship status?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'personalInfo.citizenship',
        label: 'Citizenship Status',
        type: 'radio',
        width: 'full',
        options: [
          { label: 'US Citizen', value: 'US Citizen' },
          { label: 'Permanent Resident (Green Card)', value: 'Permanent Resident (Green Card)' },
          { label: 'Non-Resident Alien', value: 'Non-Resident Alien' },
          { label: 'Other', value: 'Other' },
        ],
      },
      {
        name: 'personalInfo.occupation',
        label: 'Occupation',
        type: 'text',
        placeholder: 'e.g. Engineer, Teacher, Retired',
        width: 'half',
      },
      {
        name: 'personalInfo.employer',
        label: 'Employer',
        type: 'text',
        placeholder: 'Employer name (optional)',
        width: 'half',
      },
    ],
  },

  // ── Section 2: Spouse ─────────────────────────────────────────────────────

  {
    id: 'spouse_name',
    section: 'spouse',
    title: "What is your spouse's or partner's full legal name?",
    condition: {
      field: 'personalInfo.maritalStatus',
      operator: 'includes',
      value: ['Married', 'Domestic Partnership'],
    },
    estimatedMinutes: 1,
    fields: [
      {
        name: 'spouseInfo.firstName',
        label: 'First Name',
        type: 'text',
        placeholder: 'First name',
        required: true,
        width: 'half',
      },
      {
        name: 'spouseInfo.middleName',
        label: 'Middle Name',
        type: 'text',
        placeholder: 'Middle name (optional)',
        width: 'half',
      },
      {
        name: 'spouseInfo.lastName',
        label: 'Last Name',
        type: 'text',
        placeholder: 'Last name',
        required: true,
        width: 'half',
      },
      {
        name: 'spouseInfo.suffix',
        label: 'Suffix',
        type: 'select',
        placeholder: 'Jr., Sr., III…',
        width: 'third',
        options: [
          { label: 'Jr.', value: 'Jr.' },
          { label: 'Sr.', value: 'Sr.' },
          { label: 'II', value: 'II' },
          { label: 'III', value: 'III' },
          { label: 'IV', value: 'IV' },
          { label: 'Esq.', value: 'Esq.' },
        ],
      },
    ],
  },

  {
    id: 'spouse_contact',
    section: 'spouse',
    title: "Your spouse's contact information",
    condition: {
      field: 'personalInfo.maritalStatus',
      operator: 'includes',
      value: ['Married', 'Domestic Partnership'],
    },
    estimatedMinutes: 1,
    fields: [
      {
        name: 'spouseInfo.dob',
        label: 'Date of Birth',
        type: 'date',
        required: true,
        width: 'half',
      },
      {
        name: 'spouseInfo.ssnLast4',
        label: 'Last 4 SSN',
        type: 'ssn4',
        placeholder: '••••',
        width: 'half',
      },
      {
        name: 'spouseInfo.email',
        label: 'Email Address',
        type: 'email',
        placeholder: 'spouse@email.com',
        width: 'half',
      },
      {
        name: 'spouseInfo.phone',
        label: 'Phone',
        type: 'phone',
        placeholder: '(609) 555-0100',
        width: 'half',
      },
      {
        name: 'spouseInfo.citizenship',
        label: 'Citizenship Status',
        type: 'select',
        width: 'half',
        options: [
          { label: 'US Citizen', value: 'US Citizen' },
          { label: 'Permanent Resident (Green Card)', value: 'Permanent Resident (Green Card)' },
          { label: 'Non-Resident Alien', value: 'Non-Resident Alien' },
          { label: 'Other', value: 'Other' },
        ],
      },
    ],
  },

  // ── Section 3: Children & Dependents ──────────────────────────────────────

  {
    id: 'children_hasChildren',
    section: 'children',
    title: 'Do you have any children?',
    subtitle: 'Include biological, adopted, and stepchildren.',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'hasChildren',
        label: 'Do you have children?',
        type: 'yesno',
        required: true,
        width: 'full',
      },
    ],
  },

  {
    id: 'children_list',
    section: 'children',
    title: 'Tell us about your children',
    condition: { field: 'hasChildren', operator: 'equals', value: true },
    estimatedMinutes: 2,
    fields: [
      {
        name: 'children',
        label: 'Children',
        type: 'repeater',
        itemLabel: 'Child',
        required: true,
        width: 'full',
        innerFields: [
          {
            name: 'name',
            label: 'Full Name',
            type: 'text',
            placeholder: "Child's full legal name",
            required: true,
            width: 'half',
          },
          {
            name: 'dob',
            label: 'Date of Birth',
            type: 'date',
            required: true,
            width: 'half',
          },
          {
            name: 'relationship',
            label: 'Relationship',
            type: 'select',
            required: true,
            width: 'third',
            options: [
              { label: 'Biological', value: 'biological' },
              { label: 'Adopted', value: 'adopted' },
              { label: 'Stepchild', value: 'stepchild' },
            ],
          },
          {
            name: 'gender',
            label: 'Gender',
            type: 'radio',
            required: true,
            width: 'third',
            options: [
              { label: 'Male', value: 'male' },
              { label: 'Female', value: 'female' },
            ],
          },
          {
            name: 'specialNeeds',
            label: 'Special Needs?',
            type: 'yesno',
            defaultValue: false,
            width: 'third',
          },
          {
            name: 'specialNeedsDetails',
            label: 'Special Needs Details',
            type: 'textarea',
            placeholder: 'Describe special needs or disability…',
            rows: 2,
            width: 'full',
            condition: { field: 'specialNeeds', operator: 'equals', value: true },
          },
        ],
      },
    ],
  },

  {
    id: 'children_grandchildren_ask',
    section: 'children',
    title: 'Do you have any grandchildren?',
    condition: { field: 'hasChildren', operator: 'equals', value: true },
    estimatedMinutes: 1,
    fields: [
      {
        name: 'hasGrandchildren',
        label: 'Do you have grandchildren?',
        type: 'yesno',
        width: 'full',
      },
    ],
  },

  {
    id: 'children_grandchildren_list',
    section: 'children',
    title: 'Tell us about your grandchildren',
    condition: { field: 'hasGrandchildren', operator: 'equals', value: true },
    estimatedMinutes: 2,
    fields: [
      {
        name: 'grandchildren',
        label: 'Grandchildren',
        type: 'repeater',
        itemLabel: 'Grandchild',
        width: 'full',
        innerFields: [
          {
            name: 'name',
            label: 'Full Name',
            type: 'text',
            placeholder: "Grandchild's full legal name",
            required: true,
            width: 'half',
          },
          {
            name: 'dob',
            label: 'Date of Birth',
            type: 'date',
            required: true,
            width: 'half',
          },
          {
            name: 'parentName',
            label: "Parent's Name (your child)",
            type: 'select',
            placeholder: 'Select the parent…',
            width: 'half',
            optionsFrom: {
              source: 'children',
              labelField: 'name',
              valueField: 'name',
            },
          },
          {
            name: 'gender',
            label: 'Gender',
            type: 'radio',
            width: 'half',
            options: [
              { label: 'Male', value: 'male' },
              { label: 'Female', value: 'female' },
            ],
          },
          {
            name: 'specialNeeds',
            label: 'Special Needs?',
            type: 'yesno',
            defaultValue: false,
            width: 'third',
          },
          {
            name: 'specialNeedsDetails',
            label: 'Special Needs Details',
            type: 'textarea',
            placeholder: 'Describe special needs or disability…',
            rows: 2,
            width: 'full',
            condition: { field: 'specialNeeds', operator: 'equals', value: true },
          },
        ],
      },
    ],
  },

  {
    id: 'children_guardian',
    section: 'children',
    title: 'Who should be guardian of your minor children?',
    subtitle:
      'If you and your spouse both pass away, who would you like to care for your minor children? If you are not sure who should be your guardian, you can skip this step and discuss it during your consultation.',
    condition: { field: 'children', operator: 'hasMinorChild', value: true },
    estimatedMinutes: 1,
    fields: [
      {
        name: 'heading_guardian_primary',
        label: 'Primary Guardian',
        type: 'heading',
        width: 'full',
      },
      {
        name: 'guardianPrimary.name',
        label: 'Full Name',
        type: 'text',
        placeholder: "Guardian's full name",
        width: 'half',
      },
      {
        name: 'guardianPrimary.relationship',
        label: 'Relationship to You',
        type: 'combobox',
        placeholder: 'Type to search…',
        width: 'half',
        options: [
          { label: 'Spouse', value: 'Spouse' },
          { label: 'Parent', value: 'Parent' },
          { label: 'Mother', value: 'Mother' },
          { label: 'Father', value: 'Father' },
          { label: 'Son', value: 'Son' },
          { label: 'Daughter', value: 'Daughter' },
          { label: 'Child', value: 'Child' },
          { label: 'Sibling', value: 'Sibling' },
          { label: 'Brother', value: 'Brother' },
          { label: 'Sister', value: 'Sister' },
          { label: 'Grandparent', value: 'Grandparent' },
          { label: 'Grandmother', value: 'Grandmother' },
          { label: 'Grandfather', value: 'Grandfather' },
          { label: 'Grandchild', value: 'Grandchild' },
          { label: 'Uncle', value: 'Uncle' },
          { label: 'Aunt', value: 'Aunt' },
          { label: 'Nephew', value: 'Nephew' },
          { label: 'Niece', value: 'Niece' },
          { label: 'First Cousin', value: 'First Cousin' },
          { label: 'Mother-in-Law', value: 'Mother-in-Law' },
          { label: 'Father-in-Law', value: 'Father-in-Law' },
          { label: 'Brother-in-Law', value: 'Brother-in-Law' },
          { label: 'Sister-in-Law', value: 'Sister-in-Law' },
          { label: 'Stepparent', value: 'Stepparent' },
          { label: 'Domestic Partner', value: 'Domestic Partner' },
          { label: 'Friend', value: 'Friend' },
          { label: 'Other', value: 'Other' },
        ],
      },
      {
        name: 'guardianPrimary.phone',
        label: 'Phone',
        type: 'phone',
        width: 'half',
      },
      {
        name: 'guardianPrimary.email',
        label: 'Email',
        type: 'email',
        width: 'half',
      },
      {
        name: 'guardianPrimary',
        label: 'Address',
        type: 'address',
        width: 'full',
      },
      {
        name: 'heading_guardian_alternate',
        label: 'Alternate Guardian',
        type: 'heading',
        helpText: 'In case the primary guardian is unable to serve.',
        width: 'full',
      },
      {
        name: 'guardianAlternate.name',
        label: 'Full Name',
        type: 'text',
        placeholder: "Alternate guardian's full name",
        width: 'half',
      },
      {
        name: 'guardianAlternate.relationship',
        label: 'Relationship to You',
        type: 'combobox',
        placeholder: 'Type to search…',
        width: 'half',
        options: [
          { label: 'Spouse', value: 'Spouse' },
          { label: 'Parent', value: 'Parent' },
          { label: 'Mother', value: 'Mother' },
          { label: 'Father', value: 'Father' },
          { label: 'Son', value: 'Son' },
          { label: 'Daughter', value: 'Daughter' },
          { label: 'Child', value: 'Child' },
          { label: 'Sibling', value: 'Sibling' },
          { label: 'Brother', value: 'Brother' },
          { label: 'Sister', value: 'Sister' },
          { label: 'Grandparent', value: 'Grandparent' },
          { label: 'Grandmother', value: 'Grandmother' },
          { label: 'Grandfather', value: 'Grandfather' },
          { label: 'Grandchild', value: 'Grandchild' },
          { label: 'Uncle', value: 'Uncle' },
          { label: 'Aunt', value: 'Aunt' },
          { label: 'Nephew', value: 'Nephew' },
          { label: 'Niece', value: 'Niece' },
          { label: 'First Cousin', value: 'First Cousin' },
          { label: 'Mother-in-Law', value: 'Mother-in-Law' },
          { label: 'Father-in-Law', value: 'Father-in-Law' },
          { label: 'Brother-in-Law', value: 'Brother-in-Law' },
          { label: 'Sister-in-Law', value: 'Sister-in-Law' },
          { label: 'Stepparent', value: 'Stepparent' },
          { label: 'Domestic Partner', value: 'Domestic Partner' },
          { label: 'Friend', value: 'Friend' },
          { label: 'Other', value: 'Other' },
        ],
      },
      {
        name: 'guardianAlternate',
        label: 'Address',
        type: 'address',
        width: 'full',
      },
    ],
  },

  {
    id: 'children_dependents',
    section: 'children',
    title: 'Do you have any other dependents?',
    subtitle: 'For example, elderly parents, siblings with disabilities, or others who depend on you financially.',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'hasOtherDependents',
        label: 'Do you have other dependents?',
        type: 'yesno',
        required: true,
        width: 'full',
      },
      {
        name: 'otherDependents',
        label: 'Other Dependents',
        type: 'repeater',
        itemLabel: 'Dependent',
        width: 'full',
        condition: { field: 'hasOtherDependents', operator: 'equals', value: true },
        innerFields: [
          {
            name: 'name',
            label: 'Full Name',
            type: 'text',
            required: true,
            width: 'half',
          },
          {
            name: 'relationship',
            label: 'Relationship',
            type: 'text',
            placeholder: 'e.g. Mother, Brother',
            required: true,
            width: 'half',
          },
          {
            name: 'notes',
            label: 'Notes',
            type: 'textarea',
            placeholder: 'Any relevant details…',
            rows: 2,
            width: 'full',
          },
        ],
      },
    ],
  },

  // ── Section 4: Assets ─────────────────────────────────────────────────────

  {
    id: 'assets_realestate',
    section: 'assets',
    title: 'Do you own any real estate?',
    subtitle: 'Include your primary residence, vacation homes, rental properties, and land.',
    estimatedMinutes: 2,
    fields: [
      {
        name: 'assets.realEstate',
        label: 'Real Estate Properties',
        type: 'repeater',
        itemLabel: 'Property',
        width: 'full',
        innerFields: [
          {
            name: 'isPrimaryResidence',
            label: 'Primary Residence?',
            type: 'yesno',
            defaultValue: false,
            width: 'half',
          },
          {
            name: 'address',
            label: 'Street Address',
            type: 'text',
            required: true,
            width: 'full',
          },
          {
            name: 'city',
            label: 'City',
            type: 'text',
            required: true,
            width: 'third',
          },
          {
            name: 'state',
            label: 'State',
            type: 'text',
            defaultValue: 'NJ',
            width: 'third',
          },
          {
            name: 'zip',
            label: 'ZIP',
            type: 'text',
            width: 'third',
          },
          {
            name: 'county',
            label: 'County',
            type: 'text',
            width: 'half',
          },
          {
            name: 'estimatedValue',
            label: 'Estimated Value',
            type: 'currency',
            width: 'half',
          },
          {
            name: 'titling',
            label: 'How is the property titled?',
            type: 'select',
            width: 'half',
            options: [
              { label: 'Sole ownership', value: 'Sole ownership' },
              { label: 'Joint tenants', value: 'Joint tenants' },
              { label: 'Tenants in common', value: 'Tenants in common' },
              { label: 'Tenants by the entirety', value: 'Tenants by the entirety' },
              { label: 'Trust', value: 'Trust' },
              { label: 'LLC', value: 'LLC' },
              { label: 'Other', value: 'Other' },
              { label: "I don't know", value: "I don't know" },
            ],
          },
          {
            name: 'transferToTrust',
            label: 'Transfer to Trust?',
            type: 'yesno',
            defaultValue: false,
            width: 'half',
          },
          {
            name: 'blockLot',
            label: 'Block & Lot (NJ Tax Map)',
            type: 'text',
            placeholder: 'e.g. Block 1.01 / Lot 5',
            width: 'half',
          },
          {
            name: 'notes',
            label: 'Notes',
            type: 'textarea',
            rows: 2,
            width: 'full',
          },
        ],
      },
    ],
  },

  {
    id: 'assets_bank',
    section: 'assets',
    title: 'Do you have bank or investment accounts?',
    subtitle: 'Include checking, savings, money market, brokerage, and 529 accounts.',
    estimatedMinutes: 2,
    fields: [
      {
        name: 'assets.bankAccounts',
        label: 'Bank Accounts',
        type: 'repeater',
        itemLabel: 'Account',
        width: 'full',
        innerFields: [
          {
            name: 'institution',
            label: 'Bank / Institution',
            type: 'text',
            placeholder: 'e.g. Chase, Wells Fargo',
            width: 'half',
          },
          {
            name: 'accountType',
            label: 'Account Type',
            type: 'select',
            width: 'half',
            options: [
              { label: 'Checking', value: 'Checking' },
              { label: 'Savings', value: 'Savings' },
              { label: 'Money Market', value: 'Money Market' },
              { label: 'Certificate of Deposit', value: 'Certificate of Deposit' },
              { label: 'Brokerage', value: 'Brokerage' },
              { label: 'Mutual Fund', value: 'Mutual Fund' },
              { label: '529 College Savings', value: '529 College Savings' },
              { label: 'HSA', value: 'HSA' },
              { label: 'Other', value: 'Other' },
            ],
          },
          {
            name: 'estimatedBalance',
            label: 'Estimated Balance',
            type: 'currency',
            width: 'half',
          },
          {
            name: 'titling',
            label: 'Titling',
            type: 'select',
            width: 'half',
            options: [
              { label: 'Sole ownership', value: 'Sole ownership' },
              { label: 'Joint tenants', value: 'Joint tenants' },
              { label: 'Tenants in common', value: 'Tenants in common' },
              { label: 'Trust', value: 'Trust' },
              { label: 'Other', value: 'Other' },
            ],
          },
          {
            name: 'beneficiary',
            label: 'Beneficiary (if any)',
            type: 'text',
            placeholder: 'Name of beneficiary',
            width: 'half',
          },
          {
            name: 'transferToTrust',
            label: 'Transfer to Trust?',
            type: 'yesno',
            defaultValue: false,
            width: 'half',
          },
        ],
      },
    ],
  },

  {
    id: 'assets_retirement',
    section: 'assets',
    title: 'Do you have retirement accounts?',
    subtitle: 'Include 401(k), IRA, pension, and annuity accounts.',
    estimatedMinutes: 2,
    fields: [
      {
        name: 'assets.retirementAccounts',
        label: 'Retirement Accounts',
        type: 'repeater',
        itemLabel: 'Retirement Account',
        width: 'full',
        innerFields: [
          {
            name: 'institution',
            label: 'Institution',
            type: 'text',
            placeholder: 'e.g. Fidelity, Vanguard',
            width: 'half',
          },
          {
            name: 'accountType',
            label: 'Account Type',
            type: 'select',
            width: 'half',
            options: [
              { label: '401(k)', value: '401(k)' },
              { label: '403(b)', value: '403(b)' },
              { label: '457(b)', value: '457(b)' },
              { label: 'Traditional IRA', value: 'Traditional IRA' },
              { label: 'Roth IRA', value: 'Roth IRA' },
              { label: 'SEP IRA', value: 'SEP IRA' },
              { label: 'SIMPLE IRA', value: 'SIMPLE IRA' },
              { label: 'Pension', value: 'Pension' },
              { label: 'Annuity', value: 'Annuity' },
              { label: 'Other', value: 'Other' },
            ],
          },
          {
            name: 'estimatedValue',
            label: 'Estimated Value',
            type: 'currency',
            width: 'half',
          },
          {
            name: 'primaryBeneficiary',
            label: 'Primary Beneficiary',
            type: 'text',
            placeholder: 'Name of beneficiary',
            width: 'half',
          },
          {
            name: 'contingentBeneficiary',
            label: 'Contingent Beneficiary',
            type: 'text',
            placeholder: 'Name of contingent beneficiary',
            width: 'half',
          },
        ],
      },
    ],
  },

  {
    id: 'assets_insurance',
    section: 'assets',
    title: 'Do you have life insurance policies?',
    estimatedMinutes: 2,
    fields: [
      {
        name: 'assets.lifeInsurance',
        label: 'Life Insurance Policies',
        type: 'repeater',
        itemLabel: 'Policy',
        width: 'full',
        innerFields: [
          {
            name: 'company',
            label: 'Insurance Company',
            type: 'text',
            placeholder: 'e.g. MetLife, Prudential',
            width: 'half',
          },
          {
            name: 'insuranceType',
            label: 'Policy Type',
            type: 'select',
            width: 'half',
            options: [
              { label: 'Term Life', value: 'Term Life' },
              { label: 'Whole Life', value: 'Whole Life' },
              { label: 'Universal Life', value: 'Universal Life' },
              { label: 'Variable Life', value: 'Variable Life' },
              { label: 'Group Life', value: 'Group Life' },
              { label: 'Other', value: 'Other' },
            ],
          },
          {
            name: 'faceValue',
            label: 'Face Value / Death Benefit',
            type: 'currency',
            width: 'half',
          },
          {
            name: 'primaryBeneficiary',
            label: 'Primary Beneficiary',
            type: 'text',
            placeholder: 'Name of beneficiary',
            width: 'half',
          },
          {
            name: 'contingentBeneficiary',
            label: 'Contingent Beneficiary',
            type: 'text',
            width: 'half',
          },
          {
            name: 'transferToTrust',
            label: 'Transfer to ILIT?',
            type: 'yesno',
            defaultValue: false,
            helpText: 'An Irrevocable Life Insurance Trust (ILIT) removes the policy from your taxable estate. The death benefit passes to beneficiaries free of estate tax.',
            width: 'half',
          },
        ],
      },
    ],
  },

  // ── Section 5: Liabilities ────────────────────────────────────────────────

  {
    id: 'liabilities_mortgages',
    section: 'liabilities',
    title: 'Do you have any mortgages?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'liabilities.mortgages',
        label: 'Mortgages',
        type: 'repeater',
        itemLabel: 'Mortgage',
        width: 'full',
        innerFields: [
          {
            name: 'propertyAddress',
            label: 'Property Address',
            type: 'text',
            width: 'full',
          },
          {
            name: 'lender',
            label: 'Lender',
            type: 'text',
            placeholder: 'e.g. Wells Fargo',
            width: 'half',
          },
          {
            name: 'balance',
            label: 'Current Balance',
            type: 'currency',
            width: 'half',
          },
          {
            name: 'monthlyPayment',
            label: 'Monthly Payment',
            type: 'currency',
            width: 'half',
          },
        ],
      },
    ],
  },

  {
    id: 'liabilities_other',
    section: 'liabilities',
    title: 'Do you have other significant debts or loans?',
    subtitle: 'Include auto loans, student loans, personal loans, credit card debt, and business loans.',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'liabilities.otherLiabilities',
        label: 'Other Liabilities',
        type: 'repeater',
        itemLabel: 'Liability',
        width: 'full',
        innerFields: [
          {
            name: 'description',
            label: 'Description',
            type: 'text',
            placeholder: 'e.g. Car loan, Student loan',
            width: 'half',
          },
          {
            name: 'creditor',
            label: 'Creditor / Lender',
            type: 'text',
            width: 'half',
          },
          {
            name: 'type',
            label: 'Type',
            type: 'select',
            width: 'half',
            options: [
              { label: 'Credit Card', value: 'credit_card' },
              { label: 'Auto Loan', value: 'auto_loan' },
              { label: 'Student Loan', value: 'student_loan' },
              { label: 'Personal Loan', value: 'personal_loan' },
              { label: 'Business Loan', value: 'business_loan' },
              { label: 'Other', value: 'other' },
            ],
          },
          {
            name: 'balance',
            label: 'Current Balance',
            type: 'currency',
            width: 'half',
          },
        ],
      },
    ],
  },

  // ── RELATIONSHIP_OPTIONS (up to 4th degree) ──────────────────────────────────

  {
    id: 'fiduciaries_executor',
    section: 'fiduciaries',
    title: 'Who should be the Executor of your estate?',
    subtitle:
      'Your Executor (called a "Personal Representative" in NJ) will administer your estate after you pass. Choose someone you trust, such as a spouse, sibling, or adult child. If you are not sure who should be your executor, you can skip this step and discuss it during your consultation.',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'heading_executor_primary',
        label: 'Primary Executor',
        type: 'heading',
        width: 'full',
      },
      {
        name: 'fiduciaries.executor.primary.name',
        label: 'Full Name',
        type: 'text',
        placeholder: "Executor's full legal name",
        width: 'half',
      },
      {
        name: 'fiduciaries.executor.primary.relationship',
        label: 'Relationship to You',
        type: 'combobox',
        placeholder: 'Type to search…',
        width: 'half',
        options: [
          // 1st degree
          { label: 'Spouse', value: 'Spouse' },
          { label: 'Parent', value: 'Parent' },
          { label: 'Mother', value: 'Mother' },
          { label: 'Father', value: 'Father' },
          { label: 'Son', value: 'Son' },
          { label: 'Daughter', value: 'Daughter' },
          { label: 'Child', value: 'Child' },
          // 2nd degree
          { label: 'Sibling', value: 'Sibling' },
          { label: 'Brother', value: 'Brother' },
          { label: 'Sister', value: 'Sister' },
          { label: 'Grandparent', value: 'Grandparent' },
          { label: 'Grandmother', value: 'Grandmother' },
          { label: 'Grandfather', value: 'Grandfather' },
          { label: 'Grandchild', value: 'Grandchild' },
          { label: 'Grandson', value: 'Grandson' },
          { label: 'Granddaughter', value: 'Granddaughter' },
          // 3rd degree
          { label: 'Uncle', value: 'Uncle' },
          { label: 'Aunt', value: 'Aunt' },
          { label: 'Nephew', value: 'Nephew' },
          { label: 'Niece', value: 'Niece' },
          { label: 'Great-Grandparent', value: 'Great-Grandparent' },
          { label: 'Great-Grandchild', value: 'Great-Grandchild' },
          // 4th degree
          { label: 'First Cousin', value: 'First Cousin' },
          { label: 'Great-Uncle', value: 'Great-Uncle' },
          { label: 'Great-Aunt', value: 'Great-Aunt' },
          { label: 'Great-Nephew', value: 'Great-Nephew' },
          { label: 'Great-Niece', value: 'Great-Niece' },
          { label: 'Great-Great-Grandparent', value: 'Great-Great-Grandparent' },
          { label: 'Great-Great-Grandchild', value: 'Great-Great-Grandchild' },
          // In-laws & other
          { label: 'Mother-in-Law', value: 'Mother-in-Law' },
          { label: 'Father-in-Law', value: 'Father-in-Law' },
          { label: 'Son-in-Law', value: 'Son-in-Law' },
          { label: 'Daughter-in-Law', value: 'Daughter-in-Law' },
          { label: 'Brother-in-Law', value: 'Brother-in-Law' },
          { label: 'Sister-in-Law', value: 'Sister-in-Law' },
          { label: 'Stepparent', value: 'Stepparent' },
          { label: 'Stepchild', value: 'Stepchild' },
          { label: 'Stepsibling', value: 'Stepsibling' },
          { label: 'Domestic Partner', value: 'Domestic Partner' },
          { label: 'Friend', value: 'Friend' },
          { label: 'Professional Advisor', value: 'Professional Advisor' },
          { label: 'Other', value: 'Other' },
        ],
      },
      {
        name: 'fiduciaries.executor.primary.phone',
        label: 'Phone',
        type: 'phone',
        width: 'half',
      },
      {
        name: 'fiduciaries.executor.primary.email',
        label: 'Email',
        type: 'email',
        width: 'half',
      },
      {
        name: 'fiduciaries.executor.primary',
        label: 'Address',
        type: 'address',
        width: 'full',
      },
      {
        name: 'heading_executor_alternate',
        label: 'Alternate Executor',
        type: 'heading',
        helpText: 'In case the primary executor is unable or unwilling to serve.',
        width: 'full',
      },
      {
        name: 'fiduciaries.executor.alternate.name',
        label: 'Full Name',
        type: 'text',
        placeholder: "Alternate executor's full name",
        width: 'half',
      },
      {
        name: 'fiduciaries.executor.alternate.relationship',
        label: 'Relationship to You',
        type: 'combobox',
        placeholder: 'Type to search…',
        width: 'half',
        options: [
          { label: 'Spouse', value: 'Spouse' },
          { label: 'Parent', value: 'Parent' },
          { label: 'Mother', value: 'Mother' },
          { label: 'Father', value: 'Father' },
          { label: 'Son', value: 'Son' },
          { label: 'Daughter', value: 'Daughter' },
          { label: 'Child', value: 'Child' },
          { label: 'Sibling', value: 'Sibling' },
          { label: 'Brother', value: 'Brother' },
          { label: 'Sister', value: 'Sister' },
          { label: 'Grandparent', value: 'Grandparent' },
          { label: 'Grandmother', value: 'Grandmother' },
          { label: 'Grandfather', value: 'Grandfather' },
          { label: 'Grandchild', value: 'Grandchild' },
          { label: 'Grandson', value: 'Grandson' },
          { label: 'Granddaughter', value: 'Granddaughter' },
          { label: 'Uncle', value: 'Uncle' },
          { label: 'Aunt', value: 'Aunt' },
          { label: 'Nephew', value: 'Nephew' },
          { label: 'Niece', value: 'Niece' },
          { label: 'Great-Grandparent', value: 'Great-Grandparent' },
          { label: 'Great-Grandchild', value: 'Great-Grandchild' },
          { label: 'First Cousin', value: 'First Cousin' },
          { label: 'Great-Uncle', value: 'Great-Uncle' },
          { label: 'Great-Aunt', value: 'Great-Aunt' },
          { label: 'Great-Nephew', value: 'Great-Nephew' },
          { label: 'Great-Niece', value: 'Great-Niece' },
          { label: 'Great-Great-Grandparent', value: 'Great-Great-Grandparent' },
          { label: 'Great-Great-Grandchild', value: 'Great-Great-Grandchild' },
          { label: 'Mother-in-Law', value: 'Mother-in-Law' },
          { label: 'Father-in-Law', value: 'Father-in-Law' },
          { label: 'Son-in-Law', value: 'Son-in-Law' },
          { label: 'Daughter-in-Law', value: 'Daughter-in-Law' },
          { label: 'Brother-in-Law', value: 'Brother-in-Law' },
          { label: 'Sister-in-Law', value: 'Sister-in-Law' },
          { label: 'Stepparent', value: 'Stepparent' },
          { label: 'Stepchild', value: 'Stepchild' },
          { label: 'Stepsibling', value: 'Stepsibling' },
          { label: 'Domestic Partner', value: 'Domestic Partner' },
          { label: 'Friend', value: 'Friend' },
          { label: 'Professional Advisor', value: 'Professional Advisor' },
          { label: 'Other', value: 'Other' },
        ],
      },
      {
        name: 'fiduciaries.executor.alternate',
        label: 'Address',
        type: 'address',
        width: 'full',
      },
    ],
  },

  {
    id: 'fiduciaries_trustee',
    section: 'fiduciaries',
    title: 'Who should be the Trustee of your trust?',
    subtitle:
      'A trustee manages assets held in a trust. If you create a trust, you are typically the initial trustee and name a successor to take over. If you are not sure whether you need a trust, you can skip this step and discuss it during your consultation.',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'heading_trustee_primary',
        label: 'Primary Successor Trustee',
        type: 'heading',
        helpText: 'The person who will manage the trust if you become incapacitated or pass away.',
        width: 'full',
      },
      {
        name: 'fiduciaries.trustee.primary.name',
        label: 'Full Name',
        type: 'text',
        placeholder: "Trustee's full legal name",
        width: 'half',
      },
      {
        name: 'fiduciaries.trustee.primary.relationship',
        label: 'Relationship to You',
        type: 'combobox',
        placeholder: 'Type to search…',
        width: 'half',
        options: [
          { label: 'Spouse', value: 'Spouse' },
          { label: 'Parent', value: 'Parent' },
          { label: 'Mother', value: 'Mother' },
          { label: 'Father', value: 'Father' },
          { label: 'Son', value: 'Son' },
          { label: 'Daughter', value: 'Daughter' },
          { label: 'Child', value: 'Child' },
          { label: 'Sibling', value: 'Sibling' },
          { label: 'Brother', value: 'Brother' },
          { label: 'Sister', value: 'Sister' },
          { label: 'Grandparent', value: 'Grandparent' },
          { label: 'Grandmother', value: 'Grandmother' },
          { label: 'Grandfather', value: 'Grandfather' },
          { label: 'Grandchild', value: 'Grandchild' },
          { label: 'Grandson', value: 'Grandson' },
          { label: 'Granddaughter', value: 'Granddaughter' },
          { label: 'Uncle', value: 'Uncle' },
          { label: 'Aunt', value: 'Aunt' },
          { label: 'Nephew', value: 'Nephew' },
          { label: 'Niece', value: 'Niece' },
          { label: 'Great-Grandparent', value: 'Great-Grandparent' },
          { label: 'Great-Grandchild', value: 'Great-Grandchild' },
          { label: 'First Cousin', value: 'First Cousin' },
          { label: 'Great-Uncle', value: 'Great-Uncle' },
          { label: 'Great-Aunt', value: 'Great-Aunt' },
          { label: 'Great-Nephew', value: 'Great-Nephew' },
          { label: 'Great-Niece', value: 'Great-Niece' },
          { label: 'Great-Great-Grandparent', value: 'Great-Great-Grandparent' },
          { label: 'Great-Great-Grandchild', value: 'Great-Great-Grandchild' },
          { label: 'Mother-in-Law', value: 'Mother-in-Law' },
          { label: 'Father-in-Law', value: 'Father-in-Law' },
          { label: 'Son-in-Law', value: 'Son-in-Law' },
          { label: 'Daughter-in-Law', value: 'Daughter-in-Law' },
          { label: 'Brother-in-Law', value: 'Brother-in-Law' },
          { label: 'Sister-in-Law', value: 'Sister-in-Law' },
          { label: 'Stepparent', value: 'Stepparent' },
          { label: 'Stepchild', value: 'Stepchild' },
          { label: 'Stepsibling', value: 'Stepsibling' },
          { label: 'Domestic Partner', value: 'Domestic Partner' },
          { label: 'Friend', value: 'Friend' },
          { label: 'Professional Advisor', value: 'Professional Advisor' },
          { label: 'Other', value: 'Other' },
        ],
      },
      {
        name: 'fiduciaries.trustee.primary.phone',
        label: 'Phone',
        type: 'phone',
        width: 'half',
      },
      {
        name: 'fiduciaries.trustee.primary.email',
        label: 'Email',
        type: 'email',
        width: 'half',
      },
      {
        name: 'fiduciaries.trustee.primary',
        label: 'Address',
        type: 'address',
        width: 'full',
      },
      {
        name: 'heading_trustee_alternate',
        label: 'Alternate Successor Trustee',
        type: 'heading',
        helpText: 'In case the primary successor trustee is unable or unwilling to serve.',
        width: 'full',
      },
      {
        name: 'fiduciaries.trustee.alternate.name',
        label: 'Full Name',
        type: 'text',
        placeholder: "Alternate trustee's full name",
        width: 'half',
      },
      {
        name: 'fiduciaries.trustee.alternate.relationship',
        label: 'Relationship to You',
        type: 'combobox',
        placeholder: 'Type to search…',
        width: 'half',
        options: [
          { label: 'Spouse', value: 'Spouse' },
          { label: 'Parent', value: 'Parent' },
          { label: 'Mother', value: 'Mother' },
          { label: 'Father', value: 'Father' },
          { label: 'Son', value: 'Son' },
          { label: 'Daughter', value: 'Daughter' },
          { label: 'Child', value: 'Child' },
          { label: 'Sibling', value: 'Sibling' },
          { label: 'Brother', value: 'Brother' },
          { label: 'Sister', value: 'Sister' },
          { label: 'Grandparent', value: 'Grandparent' },
          { label: 'Grandmother', value: 'Grandmother' },
          { label: 'Grandfather', value: 'Grandfather' },
          { label: 'Grandchild', value: 'Grandchild' },
          { label: 'Grandson', value: 'Grandson' },
          { label: 'Granddaughter', value: 'Granddaughter' },
          { label: 'Uncle', value: 'Uncle' },
          { label: 'Aunt', value: 'Aunt' },
          { label: 'Nephew', value: 'Nephew' },
          { label: 'Niece', value: 'Niece' },
          { label: 'Great-Grandparent', value: 'Great-Grandparent' },
          { label: 'Great-Grandchild', value: 'Great-Grandchild' },
          { label: 'First Cousin', value: 'First Cousin' },
          { label: 'Great-Uncle', value: 'Great-Uncle' },
          { label: 'Great-Aunt', value: 'Great-Aunt' },
          { label: 'Great-Nephew', value: 'Great-Nephew' },
          { label: 'Great-Niece', value: 'Great-Niece' },
          { label: 'Great-Great-Grandparent', value: 'Great-Great-Grandparent' },
          { label: 'Great-Great-Grandchild', value: 'Great-Great-Grandchild' },
          { label: 'Mother-in-Law', value: 'Mother-in-Law' },
          { label: 'Father-in-Law', value: 'Father-in-Law' },
          { label: 'Son-in-Law', value: 'Son-in-Law' },
          { label: 'Daughter-in-Law', value: 'Daughter-in-Law' },
          { label: 'Brother-in-Law', value: 'Brother-in-Law' },
          { label: 'Sister-in-Law', value: 'Sister-in-Law' },
          { label: 'Stepparent', value: 'Stepparent' },
          { label: 'Stepchild', value: 'Stepchild' },
          { label: 'Stepsibling', value: 'Stepsibling' },
          { label: 'Domestic Partner', value: 'Domestic Partner' },
          { label: 'Friend', value: 'Friend' },
          { label: 'Professional Advisor', value: 'Professional Advisor' },
          { label: 'Other', value: 'Other' },
        ],
      },
      {
        name: 'fiduciaries.trustee.alternate',
        label: 'Address',
        type: 'address',
        width: 'full',
      },
    ],
  },

  {
    id: 'fiduciaries_poa',
    section: 'fiduciaries',
    title: 'Who should be your Power of Attorney agent?',
    subtitle:
      'Your POA agent will manage your finances and legal affairs if you become incapacitated. If you are not sure who should be your POA agent, you can skip this step and discuss it during your consultation.',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'heading_poa_primary',
        label: 'Primary POA Agent',
        type: 'heading',
        width: 'full',
      },
      {
        name: 'fiduciaries.powerOfAttorney.agent.name',
        label: 'Full Name',
        type: 'text',
        placeholder: "Agent's full legal name",
        width: 'half',
      },
      {
        name: 'fiduciaries.powerOfAttorney.agent.relationship',
        label: 'Relationship to You',
        type: 'combobox',
        placeholder: 'Type to search…',
        width: 'half',
        options: [
          { label: 'Spouse', value: 'Spouse' },
          { label: 'Parent', value: 'Parent' },
          { label: 'Mother', value: 'Mother' },
          { label: 'Father', value: 'Father' },
          { label: 'Son', value: 'Son' },
          { label: 'Daughter', value: 'Daughter' },
          { label: 'Child', value: 'Child' },
          { label: 'Sibling', value: 'Sibling' },
          { label: 'Brother', value: 'Brother' },
          { label: 'Sister', value: 'Sister' },
          { label: 'Grandparent', value: 'Grandparent' },
          { label: 'Grandmother', value: 'Grandmother' },
          { label: 'Grandfather', value: 'Grandfather' },
          { label: 'Grandchild', value: 'Grandchild' },
          { label: 'Grandson', value: 'Grandson' },
          { label: 'Granddaughter', value: 'Granddaughter' },
          { label: 'Uncle', value: 'Uncle' },
          { label: 'Aunt', value: 'Aunt' },
          { label: 'Nephew', value: 'Nephew' },
          { label: 'Niece', value: 'Niece' },
          { label: 'Great-Grandparent', value: 'Great-Grandparent' },
          { label: 'Great-Grandchild', value: 'Great-Grandchild' },
          { label: 'First Cousin', value: 'First Cousin' },
          { label: 'Great-Uncle', value: 'Great-Uncle' },
          { label: 'Great-Aunt', value: 'Great-Aunt' },
          { label: 'Great-Nephew', value: 'Great-Nephew' },
          { label: 'Great-Niece', value: 'Great-Niece' },
          { label: 'Great-Great-Grandparent', value: 'Great-Great-Grandparent' },
          { label: 'Great-Great-Grandchild', value: 'Great-Great-Grandchild' },
          { label: 'Mother-in-Law', value: 'Mother-in-Law' },
          { label: 'Father-in-Law', value: 'Father-in-Law' },
          { label: 'Son-in-Law', value: 'Son-in-Law' },
          { label: 'Daughter-in-Law', value: 'Daughter-in-Law' },
          { label: 'Brother-in-Law', value: 'Brother-in-Law' },
          { label: 'Sister-in-Law', value: 'Sister-in-Law' },
          { label: 'Stepparent', value: 'Stepparent' },
          { label: 'Stepchild', value: 'Stepchild' },
          { label: 'Stepsibling', value: 'Stepsibling' },
          { label: 'Domestic Partner', value: 'Domestic Partner' },
          { label: 'Friend', value: 'Friend' },
          { label: 'Professional Advisor', value: 'Professional Advisor' },
          { label: 'Other', value: 'Other' },
        ],
      },
      {
        name: 'fiduciaries.powerOfAttorney.agent.phone',
        label: 'Phone',
        type: 'phone',
        width: 'half',
      },
      {
        name: 'fiduciaries.powerOfAttorney.agent.email',
        label: 'Email',
        type: 'email',
        width: 'half',
      },
      {
        name: 'fiduciaries.powerOfAttorney.agent',
        label: 'Address',
        type: 'address',
        width: 'full',
      },
      {
        name: 'heading_poa_alternate',
        label: 'Alternate POA Agent',
        type: 'heading',
        width: 'full',
      },
      {
        name: 'fiduciaries.powerOfAttorney.alternateAgent.name',
        label: 'Full Name',
        type: 'text',
        placeholder: "Alternate agent's full name",
        width: 'half',
      },
      {
        name: 'fiduciaries.powerOfAttorney.alternateAgent.relationship',
        label: 'Relationship to You',
        type: 'combobox',
        placeholder: 'Type to search…',
        width: 'half',
        options: [
          { label: 'Spouse', value: 'Spouse' },
          { label: 'Parent', value: 'Parent' },
          { label: 'Mother', value: 'Mother' },
          { label: 'Father', value: 'Father' },
          { label: 'Son', value: 'Son' },
          { label: 'Daughter', value: 'Daughter' },
          { label: 'Child', value: 'Child' },
          { label: 'Sibling', value: 'Sibling' },
          { label: 'Brother', value: 'Brother' },
          { label: 'Sister', value: 'Sister' },
          { label: 'Grandparent', value: 'Grandparent' },
          { label: 'Grandmother', value: 'Grandmother' },
          { label: 'Grandfather', value: 'Grandfather' },
          { label: 'Grandchild', value: 'Grandchild' },
          { label: 'Grandson', value: 'Grandson' },
          { label: 'Granddaughter', value: 'Granddaughter' },
          { label: 'Uncle', value: 'Uncle' },
          { label: 'Aunt', value: 'Aunt' },
          { label: 'Nephew', value: 'Nephew' },
          { label: 'Niece', value: 'Niece' },
          { label: 'Great-Grandparent', value: 'Great-Grandparent' },
          { label: 'Great-Grandchild', value: 'Great-Grandchild' },
          { label: 'First Cousin', value: 'First Cousin' },
          { label: 'Great-Uncle', value: 'Great-Uncle' },
          { label: 'Great-Aunt', value: 'Great-Aunt' },
          { label: 'Great-Nephew', value: 'Great-Nephew' },
          { label: 'Great-Niece', value: 'Great-Niece' },
          { label: 'Great-Great-Grandparent', value: 'Great-Great-Grandparent' },
          { label: 'Great-Great-Grandchild', value: 'Great-Great-Grandchild' },
          { label: 'Mother-in-Law', value: 'Mother-in-Law' },
          { label: 'Father-in-Law', value: 'Father-in-Law' },
          { label: 'Son-in-Law', value: 'Son-in-Law' },
          { label: 'Daughter-in-Law', value: 'Daughter-in-Law' },
          { label: 'Brother-in-Law', value: 'Brother-in-Law' },
          { label: 'Sister-in-Law', value: 'Sister-in-Law' },
          { label: 'Stepparent', value: 'Stepparent' },
          { label: 'Stepchild', value: 'Stepchild' },
          { label: 'Stepsibling', value: 'Stepsibling' },
          { label: 'Domestic Partner', value: 'Domestic Partner' },
          { label: 'Friend', value: 'Friend' },
          { label: 'Professional Advisor', value: 'Professional Advisor' },
          { label: 'Other', value: 'Other' },
        ],
      },
      {
        name: 'fiduciaries.powerOfAttorney.alternateAgent',
        label: 'Address',
        type: 'address',
        width: 'full',
      },
      {
        name: 'fiduciaries.powerOfAttorney.effectiveDate',
        label: 'When is the POA effective?',
        type: 'radio',
        width: 'full',
        options: [
          {
            label: 'Immediately upon signing',
            value: 'immediate',
            description: 'Your agent can act at any time.',
          },
          {
            label: 'Springing — only upon incapacity',
            value: 'springing',
            description: 'Requires a physician certification of incapacity.',
          },
          {
            label: 'Not sure',
            value: 'not_sure',
            description: 'I need this explained during our consultation.',
          },
        ],
      },
    ],
  },

  {
    id: 'fiduciaries_healthcare',
    section: 'fiduciaries',
    title: 'Who should be your Healthcare Representative?',
    subtitle:
      'Your healthcare representative will make medical decisions for you if you are unable to communicate. If you are not sure who should be your healthcare representative, you can skip this step and discuss it during your consultation.',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'heading_hcp_primary',
        label: 'Primary Healthcare Representative',
        type: 'heading',
        width: 'full',
      },
      {
        name: 'fiduciaries.healthcareProxy.agent.name',
        label: 'Full Name',
        type: 'text',
        placeholder: "Healthcare representative's full legal name",
        width: 'half',
      },
      {
        name: 'fiduciaries.healthcareProxy.agent.relationship',
        label: 'Relationship to You',
        type: 'combobox',
        placeholder: 'Type to search…',
        width: 'half',
        options: [
          { label: 'Spouse', value: 'Spouse' },
          { label: 'Parent', value: 'Parent' },
          { label: 'Mother', value: 'Mother' },
          { label: 'Father', value: 'Father' },
          { label: 'Son', value: 'Son' },
          { label: 'Daughter', value: 'Daughter' },
          { label: 'Child', value: 'Child' },
          { label: 'Sibling', value: 'Sibling' },
          { label: 'Brother', value: 'Brother' },
          { label: 'Sister', value: 'Sister' },
          { label: 'Grandparent', value: 'Grandparent' },
          { label: 'Grandmother', value: 'Grandmother' },
          { label: 'Grandfather', value: 'Grandfather' },
          { label: 'Grandchild', value: 'Grandchild' },
          { label: 'Grandson', value: 'Grandson' },
          { label: 'Granddaughter', value: 'Granddaughter' },
          { label: 'Uncle', value: 'Uncle' },
          { label: 'Aunt', value: 'Aunt' },
          { label: 'Nephew', value: 'Nephew' },
          { label: 'Niece', value: 'Niece' },
          { label: 'Great-Grandparent', value: 'Great-Grandparent' },
          { label: 'Great-Grandchild', value: 'Great-Grandchild' },
          { label: 'First Cousin', value: 'First Cousin' },
          { label: 'Great-Uncle', value: 'Great-Uncle' },
          { label: 'Great-Aunt', value: 'Great-Aunt' },
          { label: 'Great-Nephew', value: 'Great-Nephew' },
          { label: 'Great-Niece', value: 'Great-Niece' },
          { label: 'Great-Great-Grandparent', value: 'Great-Great-Grandparent' },
          { label: 'Great-Great-Grandchild', value: 'Great-Great-Grandchild' },
          { label: 'Mother-in-Law', value: 'Mother-in-Law' },
          { label: 'Father-in-Law', value: 'Father-in-Law' },
          { label: 'Son-in-Law', value: 'Son-in-Law' },
          { label: 'Daughter-in-Law', value: 'Daughter-in-Law' },
          { label: 'Brother-in-Law', value: 'Brother-in-Law' },
          { label: 'Sister-in-Law', value: 'Sister-in-Law' },
          { label: 'Stepparent', value: 'Stepparent' },
          { label: 'Stepchild', value: 'Stepchild' },
          { label: 'Stepsibling', value: 'Stepsibling' },
          { label: 'Domestic Partner', value: 'Domestic Partner' },
          { label: 'Friend', value: 'Friend' },
          { label: 'Professional Advisor', value: 'Professional Advisor' },
          { label: 'Other', value: 'Other' },
        ],
      },
      {
        name: 'fiduciaries.healthcareProxy.agent.phone',
        label: 'Phone',
        type: 'phone',
        width: 'half',
      },
      {
        name: 'fiduciaries.healthcareProxy.agent.email',
        label: 'Email',
        type: 'email',
        width: 'half',
      },
      {
        name: 'fiduciaries.healthcareProxy.agent',
        label: 'Address',
        type: 'address',
        width: 'full',
      },
      {
        name: 'heading_hcp_alternate',
        label: 'Alternate Healthcare Representative',
        type: 'heading',
        width: 'full',
      },
      {
        name: 'fiduciaries.healthcareProxy.alternateAgent.name',
        label: 'Full Name',
        type: 'text',
        placeholder: "Alternate healthcare representative's full name",
        width: 'half',
      },
      {
        name: 'fiduciaries.healthcareProxy.alternateAgent.relationship',
        label: 'Relationship to You',
        type: 'combobox',
        placeholder: 'Type to search…',
        width: 'half',
        options: [
          { label: 'Spouse', value: 'Spouse' },
          { label: 'Parent', value: 'Parent' },
          { label: 'Mother', value: 'Mother' },
          { label: 'Father', value: 'Father' },
          { label: 'Son', value: 'Son' },
          { label: 'Daughter', value: 'Daughter' },
          { label: 'Child', value: 'Child' },
          { label: 'Sibling', value: 'Sibling' },
          { label: 'Brother', value: 'Brother' },
          { label: 'Sister', value: 'Sister' },
          { label: 'Grandparent', value: 'Grandparent' },
          { label: 'Grandmother', value: 'Grandmother' },
          { label: 'Grandfather', value: 'Grandfather' },
          { label: 'Grandchild', value: 'Grandchild' },
          { label: 'Grandson', value: 'Grandson' },
          { label: 'Granddaughter', value: 'Granddaughter' },
          { label: 'Uncle', value: 'Uncle' },
          { label: 'Aunt', value: 'Aunt' },
          { label: 'Nephew', value: 'Nephew' },
          { label: 'Niece', value: 'Niece' },
          { label: 'Great-Grandparent', value: 'Great-Grandparent' },
          { label: 'Great-Grandchild', value: 'Great-Grandchild' },
          { label: 'First Cousin', value: 'First Cousin' },
          { label: 'Great-Uncle', value: 'Great-Uncle' },
          { label: 'Great-Aunt', value: 'Great-Aunt' },
          { label: 'Great-Nephew', value: 'Great-Nephew' },
          { label: 'Great-Niece', value: 'Great-Niece' },
          { label: 'Great-Great-Grandparent', value: 'Great-Great-Grandparent' },
          { label: 'Great-Great-Grandchild', value: 'Great-Great-Grandchild' },
          { label: 'Mother-in-Law', value: 'Mother-in-Law' },
          { label: 'Father-in-Law', value: 'Father-in-Law' },
          { label: 'Son-in-Law', value: 'Son-in-Law' },
          { label: 'Daughter-in-Law', value: 'Daughter-in-Law' },
          { label: 'Brother-in-Law', value: 'Brother-in-Law' },
          { label: 'Sister-in-Law', value: 'Sister-in-Law' },
          { label: 'Stepparent', value: 'Stepparent' },
          { label: 'Stepchild', value: 'Stepchild' },
          { label: 'Stepsibling', value: 'Stepsibling' },
          { label: 'Domestic Partner', value: 'Domestic Partner' },
          { label: 'Friend', value: 'Friend' },
          { label: 'Professional Advisor', value: 'Professional Advisor' },
          { label: 'Other', value: 'Other' },
        ],
      },
      {
        name: 'fiduciaries.healthcareProxy.alternateAgent',
        label: 'Address',
        type: 'address',
        width: 'full',
      },
      {
        name: 'fiduciaries.healthcareProxy.hipaaAuthorization',
        label: 'Authorize healthcare representative to receive medical records (HIPAA)?',
        type: 'yesno',
        defaultValue: true,
        width: 'full',
      },
    ],
  },

  // ── Section 7: Wishes ─────────────────────────────────────────────────────

  {
    id: 'wishes_plan',
    section: 'wishes',
    title: 'How would you like your estate distributed?',
    subtitle: 'Select the option that best describes your wishes. We can customize further in the next step.',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'distributionPlan',
        label: 'Distribution Plan',
        type: 'radio',
        required: true,
        width: 'full',
        options: [
          {
            label: 'Everything to spouse / partner, then equally to children',
            value: 'allToSpouse',
            description: 'Most common option for married couples.',
          },
          {
            label: 'Equally to my children',
            value: 'equalToChildren',
            description: 'Split your estate equally among all children.',
          },
          {
            label: 'Specific percentages or bequests',
            value: 'specific',
            description: "I'll specify percentages or individual gifts.",
          },
          {
            label: 'Custom / complex distribution',
            value: 'custom',
            description: 'Trusts, charitable giving, or other specific arrangements.',
          },
          {
            label: 'Not sure',
            value: 'not_sure',
            description: 'I need this explained during our consultation.',
          },
        ],
      },
    ],
  },

  {
    id: 'wishes_specific',
    section: 'wishes',
    title: 'Specific bequests and residual distribution',
    subtitle: 'List any specific gifts, then specify how the remainder should be split.',
    condition: {
      field: 'distributionPlan',
      operator: 'includes',
      value: ['specific', 'custom'],
    },
    estimatedMinutes: 2,
    fields: [
      {
        name: 'distribution.specificBequests',
        label: 'Specific Bequests',
        type: 'repeater',
        itemLabel: 'Bequest',
        helpText: 'Specific gifts of money or property to named individuals.',
        width: 'full',
        innerFields: [
          {
            name: 'description',
            label: 'Description',
            type: 'text',
            required: true,
            placeholder: 'e.g. $10,000 cash, my jewelry, my car',
            width: 'full',
          },
          {
            name: 'recipient',
            label: 'Recipient',
            type: 'text',
            required: true,
            placeholder: "Recipient's full name",
            width: 'half',
          },
          {
            name: 'recipientRelationship',
            label: 'Relationship',
            type: 'text',
            placeholder: 'e.g. Daughter, Friend',
            width: 'half',
          },
          {
            name: 'alternateRecipient',
            label: 'Alternate Recipient',
            type: 'text',
            placeholder: 'If recipient predeceases you',
            width: 'half',
          },
        ],
      },
    ],
  },

  {
    id: 'wishes_trust',
    section: 'wishes',
    title: 'Trust and other distribution preferences',
    condition: {
      field: 'distributionPlan',
      operator: 'includes',
      value: ['specific', 'custom'],
    },
    estimatedMinutes: 1,
    fields: [
      {
        name: 'distribution.pourOverToTrust',
        label: 'Pour residual estate into a trust?',
        type: 'yesno',
        helpText: 'Used with a Revocable Living Trust (Revocable Trust or Irrevocable Trust Package).',
        width: 'full',
      },
      {
        name: 'distribution.noContestClause',
        label: 'Include a no-contest clause?',
        type: 'yesno',
        helpText: 'Anyone who contests the will forfeits their inheritance.',
        width: 'full',
      },
      {
        name: 'distribution.spendthriftProvision',
        label: 'Include a spendthrift provision?',
        type: 'yesno',
        helpText: 'Protects trust assets from a beneficiary\'s creditors.',
        width: 'full',
      },
      {
        name: 'distribution.notes',
        label: 'Additional wishes or instructions',
        type: 'textarea',
        rows: 3,
        placeholder: 'Any special instructions or notes for your attorney…',
        width: 'full',
      },
    ],
  },

  // ── Section 8: Healthcare ─────────────────────────────────────────────────

  {
    id: 'healthcare_endoflife',
    section: 'healthcare',
    title: 'End-of-life care preferences',
    subtitle:
      'These preferences will be documented in your NJ Advance Directive (Living Will). There are no right or wrong answers — this reflects your personal values.',
    estimatedMinutes: 2,
    fields: [
      {
        name: 'healthcarePreferences.lifeSupport',
        label: 'Life-sustaining treatment if terminally ill or in a persistent vegetative state',
        type: 'radio',
        required: true,
        width: 'full',
        options: [
          {
            label: 'Withhold or withdraw life support',
            value: 'withhold',
            description: 'Allow natural death; focus on comfort care.',
          },
          {
            label: 'Provide all available life-sustaining treatment',
            value: 'provide',
            description: 'Use all measures to extend life.',
          },
          {
            label: 'Undecided — let my representative decide',
            value: 'undecided',
          },
        ],
      },
      {
        name: 'healthcarePreferences.cprDirective',
        label: 'Resuscitation (CPR)',
        type: 'radio',
        required: true,
        width: 'full',
        options: [
          {
            label: 'Do Not Resuscitate (DNR)',
            value: 'dnr',
          },
          {
            label: 'Full code — attempt resuscitation',
            value: 'full_code',
          },
          {
            label: 'Undecided — let my representative decide',
            value: 'undecided',
          },
        ],
      },
      {
        name: 'healthcarePreferences.painManagement',
        label: 'Pain management',
        type: 'radio',
        required: true,
        width: 'full',
        options: [
          {
            label: 'Comfort care — relieve pain even if it hastens death',
            value: 'comfort_care',
          },
          {
            label: 'All measures to extend life',
            value: 'all_measures',
          },
          {
            label: 'Undecided',
            value: 'undecided',
          },
        ],
      },
    ],
  },

  {
    id: 'healthcare_organ',
    section: 'healthcare',
    title: 'Organ donation and anatomical gifts',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'healthcarePreferences.organDonation',
        label: 'Would you like to be an organ donor?',
        type: 'yesno',
        width: 'full',
      },
      {
        name: 'healthcarePreferences.organDonationDetails',
        label: 'Specific organs or tissues (optional)',
        type: 'text',
        placeholder: 'e.g. All organs, Corneas only',
        width: 'full',
        condition: {
          field: 'healthcarePreferences.organDonation',
          operator: 'equals',
          value: true,
        },
      },
      {
        name: 'healthcarePreferences.anatomicalGift',
        label: 'Would you like to donate your body to science?',
        type: 'yesno',
        helpText: 'An anatomical gift donates your body to a medical school or research institution.',
        width: 'full',
      },
      {
        name: 'healthcarePreferences.njADRD',
        label: 'Include an Alzheimer\'s/Dementia-specific directive? (NJ ADRD)',
        type: 'yesno',
        helpText:
          'New Jersey allows a specific directive for decisions in the event of advanced dementia.',
        width: 'full',
      },
    ],
  },

  {
    id: 'healthcare_burial',
    section: 'healthcare',
    title: 'Burial and final arrangements',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'burialPreference',
        label: 'Burial preference',
        type: 'radio',
        width: 'full',
        options: [
          { label: 'Burial', value: 'burial' },
          { label: 'Cremation', value: 'cremation' },
          { label: 'No preference / let family decide', value: 'undecided' },
        ],
      },
      {
        name: 'burialDetails',
        label: 'Additional burial / memorial wishes',
        type: 'textarea',
        rows: 3,
        placeholder:
          'e.g. Religious service, specific cemetery, scatter ashes at…',
        width: 'full',
      },
      {
        name: 'healthcarePreferences.personalStatement',
        label: 'Personal statement or values',
        type: 'textarea',
        rows: 3,
        placeholder:
          'Any personal values or beliefs you want included in your advance directive…',
        width: 'full',
      },
    ],
  },

  // ── Section 9: Additional ─────────────────────────────────────────────────

  {
    id: 'additional_existing',
    section: 'additional',
    title: 'Do you have any existing estate planning documents?',
    subtitle: 'Examples: prior Will, Trust, Power of Attorney, or Advance Directive.',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'hasExistingDocuments',
        label: 'Do you have existing documents?',
        type: 'yesno',
        width: 'full',
      },
      {
        name: 'existingDocumentsDetails',
        label: 'What documents do you have?',
        type: 'textarea',
        rows: 2,
        placeholder: 'e.g. Will from 2015, Durable POA from 2010…',
        width: 'full',
        condition: { field: 'hasExistingDocuments', operator: 'equals', value: true },
      },
      {
        name: 'existingDocumentsDate',
        label: 'Approximate date of most recent document',
        type: 'text',
        placeholder: 'e.g. 2015 or January 2018',
        width: 'half',
        condition: { field: 'hasExistingDocuments', operator: 'equals', value: true },
      },
    ],
  },

  {
    id: 'additional_legal',
    section: 'additional',
    title: 'Are there any pending legal matters we should know about?',
    subtitle: 'Examples: pending divorce, litigation, bankruptcy, or other legal proceedings.',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'hasPendingLegalMatters',
        label: 'Any pending legal matters?',
        type: 'yesno',
        width: 'full',
      },
      {
        name: 'pendingLegalDetails',
        label: 'Please describe',
        type: 'textarea',
        rows: 3,
        placeholder: 'Describe any pending legal matters…',
        width: 'full',
        condition: { field: 'hasPendingLegalMatters', operator: 'equals', value: true },
      },
    ],
  },

  {
    id: 'additional_notes',
    section: 'additional',
    title: 'Is there anything else you would like us to know?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'additionalNotes',
        label: 'Additional notes or instructions',
        type: 'textarea',
        rows: 4,
        placeholder:
          'Any additional information, special circumstances, or instructions for your attorney…',
        width: 'full',
      },
      {
        name: 'referralSource',
        label: 'How did you hear about us?',
        type: 'select',
        width: 'half',
        options: [
          { label: 'Google / Web search', value: 'google' },
          { label: 'Referral from a friend or family', value: 'referral' },
          { label: 'Current or past client', value: 'past_client' },
          { label: 'Social media', value: 'social_media' },
          { label: 'LinkedIn', value: 'linkedin' },
          { label: 'Attorney referral', value: 'attorney_referral' },
          { label: 'Other', value: 'other' },
        ],
      },
    ],
  },
];
