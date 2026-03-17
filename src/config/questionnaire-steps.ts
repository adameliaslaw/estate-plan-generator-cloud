/**
 * All questionnaire step definitions for the NJ Estate Plan Generator.
 * Sections 1–9, covering all questions in the intake questionnaire.
 *
 * Each step maps directly to a screen in the multi-step questionnaire UI.
 * Field names use dot-path notation matching the QuestionnaireData shape.
 */

import type { QuestionnaireStep } from '@/types/questionnaire';
import { NJ_COUNTIES } from '@/config/constants';

// ---------------------------------------------------------------------------
// Shared option helpers
// ---------------------------------------------------------------------------

const NJ_COUNTY_OPTIONS = NJ_COUNTIES.map((c) => ({ label: c, value: c }));

const US_STATE_OPTIONS = [
  { label: 'New Jersey', value: 'NJ' },
  { label: 'Alabama', value: 'AL' },
  { label: 'Alaska', value: 'AK' },
  { label: 'Arizona', value: 'AZ' },
  { label: 'Arkansas', value: 'AR' },
  { label: 'California', value: 'CA' },
  { label: 'Colorado', value: 'CO' },
  { label: 'Connecticut', value: 'CT' },
  { label: 'Delaware', value: 'DE' },
  { label: 'Florida', value: 'FL' },
  { label: 'Georgia', value: 'GA' },
  { label: 'Hawaii', value: 'HI' },
  { label: 'Idaho', value: 'ID' },
  { label: 'Illinois', value: 'IL' },
  { label: 'Indiana', value: 'IN' },
  { label: 'Iowa', value: 'IA' },
  { label: 'Kansas', value: 'KS' },
  { label: 'Kentucky', value: 'KY' },
  { label: 'Louisiana', value: 'LA' },
  { label: 'Maine', value: 'ME' },
  { label: 'Maryland', value: 'MD' },
  { label: 'Massachusetts', value: 'MA' },
  { label: 'Michigan', value: 'MI' },
  { label: 'Minnesota', value: 'MN' },
  { label: 'Mississippi', value: 'MS' },
  { label: 'Missouri', value: 'MO' },
  { label: 'Montana', value: 'MT' },
  { label: 'Nebraska', value: 'NE' },
  { label: 'Nevada', value: 'NV' },
  { label: 'New Hampshire', value: 'NH' },
  { label: 'New Mexico', value: 'NM' },
  { label: 'New York', value: 'NY' },
  { label: 'North Carolina', value: 'NC' },
  { label: 'North Dakota', value: 'ND' },
  { label: 'Ohio', value: 'OH' },
  { label: 'Oklahoma', value: 'OK' },
  { label: 'Oregon', value: 'OR' },
  { label: 'Pennsylvania', value: 'PA' },
  { label: 'Rhode Island', value: 'RI' },
  { label: 'South Carolina', value: 'SC' },
  { label: 'South Dakota', value: 'SD' },
  { label: 'Tennessee', value: 'TN' },
  { label: 'Texas', value: 'TX' },
  { label: 'Utah', value: 'UT' },
  { label: 'Vermont', value: 'VT' },
  { label: 'Virginia', value: 'VA' },
  { label: 'Washington', value: 'WA' },
  { label: 'West Virginia', value: 'WV' },
  { label: 'Wisconsin', value: 'WI' },
  { label: 'Wyoming', value: 'WY' },
  { label: 'District of Columbia', value: 'DC' },
];

const TITLING_OPTIONS = [
  { label: 'Sole ownership', value: 'Sole ownership' },
  { label: 'Joint tenants', value: 'Joint tenants' },
  { label: 'Tenants in common', value: 'Tenants in common' },
  { label: 'Tenants by the entirety', value: 'Tenants by the entirety' },
  { label: 'Trust', value: 'Trust' },
  { label: 'LLC', value: 'LLC' },
  { label: 'Other', value: 'Other' },
];

const ACCOUNT_TYPE_OPTIONS = [
  { label: 'Checking', value: 'Checking' },
  { label: 'Savings', value: 'Savings' },
  { label: 'Money Market', value: 'Money Market' },
  { label: 'Certificate of Deposit', value: 'Certificate of Deposit' },
  { label: 'Brokerage', value: 'Brokerage' },
  { label: 'Mutual Fund', value: 'Mutual Fund' },
  { label: '529 College Savings', value: '529 College Savings' },
  { label: 'HSA', value: 'HSA' },
  { label: 'Other', value: 'Other' },
];

const RETIREMENT_ACCOUNT_TYPE_OPTIONS = [
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
];

const INSURANCE_TYPE_OPTIONS = [
  { label: 'Term Life', value: 'Term Life' },
  { label: 'Whole Life', value: 'Whole Life' },
  { label: 'Universal Life', value: 'Universal Life' },
  { label: 'Variable Life', value: 'Variable Life' },
  { label: 'Variable Universal Life', value: 'Variable Universal Life' },
  { label: 'Indexed Universal Life', value: 'Indexed Universal Life' },
  { label: 'Group Life', value: 'Group Life' },
  { label: 'Other', value: 'Other' },
];

const BUSINESS_ENTITY_OPTIONS = [
  { label: 'Sole Proprietorship', value: 'Sole Proprietorship' },
  { label: 'General Partnership', value: 'General Partnership' },
  { label: 'Limited Partnership (LP)', value: 'Limited Partnership (LP)' },
  { label: 'Limited Liability Partnership (LLP)', value: 'Limited Liability Partnership (LLP)' },
  { label: 'Limited Liability Company (LLC)', value: 'Limited Liability Company (LLC)' },
  { label: 'S Corporation', value: 'S Corporation' },
  { label: 'C Corporation', value: 'C Corporation' },
  { label: 'Professional Corporation (PC)', value: 'Professional Corporation (PC)' },
  { label: 'Professional LLC (PLLC)', value: 'Professional LLC (PLLC)' },
  { label: 'Non-Profit Corporation', value: 'Non-Profit Corporation' },
  { label: 'Other', value: 'Other' },
];

const RELATIONSHIP_OPTIONS = [
  { label: 'Spouse', value: 'Spouse' },
  { label: 'Son', value: 'Son' },
  { label: 'Daughter', value: 'Daughter' },
  { label: 'Father', value: 'Father' },
  { label: 'Mother', value: 'Mother' },
  { label: 'Brother', value: 'Brother' },
  { label: 'Sister', value: 'Sister' },
  { label: 'Friend', value: 'Friend' },
  { label: 'Attorney', value: 'Attorney' },
  { label: 'Accountant', value: 'Accountant' },
  { label: 'Other', value: 'Other' },
];

// ---------------------------------------------------------------------------
// SECTION 1: ABOUT YOU (Personal Information)
// ---------------------------------------------------------------------------

const SECTION_ABOUT_YOU: QuestionnaireStep[] = [
  // Step 1: Full Legal Name
  {
    id: 'personal_name',
    section: 'aboutYou',
    title: 'What is your full legal name?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'personalInfo.firstName',
        label: 'First Name',
        type: 'text',
        required: true,
        placeholder: 'First name',
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
        required: true,
        placeholder: 'Last name',
        width: 'half',
      },
      {
        name: 'personalInfo.suffix',
        label: 'Suffix',
        type: 'select',
        placeholder: 'Select suffix (optional)',
        width: 'half',
        options: [
          { label: 'Jr.', value: 'Jr.' },
          { label: 'Sr.', value: 'Sr.' },
          { label: 'II', value: 'II' },
          { label: 'III', value: 'III' },
          { label: 'IV', value: 'IV' },
          { label: 'Esq.', value: 'Esq.' },
          { label: 'MD', value: 'MD' },
          { label: 'PhD', value: 'PhD' },
        ],
      },
    ],
  },

  // Step 2: Date of Birth
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
    ],
  },

  // Step 3: SSN Last 4
  {
    id: 'personal_ssn',
    section: 'aboutYou',
    title: 'What are the last four digits of your Social Security Number?',
    subtitle: 'This is used for document preparation only and is stored securely.',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'personalInfo.ssnLast4',
        label: 'Last 4 Digits of SSN',
        type: 'ssn4',
        required: true,
        placeholder: 'XXXX',
        width: 'half',
      },
    ],
  },

  // Step 4: Home Address
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

  // Step 5: Email
  {
    id: 'personal_email',
    section: 'aboutYou',
    title: 'What is your email address?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'personalInfo.email',
        label: 'Email Address',
        type: 'email',
        required: true,
        placeholder: 'you@example.com',
        width: 'half',
      },
    ],
  },

  // Step 6: Phone
  {
    id: 'personal_phone',
    section: 'aboutYou',
    title: 'What is your phone number?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'personalInfo.phone',
        label: 'Phone Number',
        type: 'phone',
        required: true,
        placeholder: '(609) 555-1234',
        width: 'half',
      },
    ],
  },

  // Step 7: Marital Status
  {
    id: 'personal_marital',
    section: 'aboutYou',
    title: 'What is your current marital status?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'personalInfo.maritalStatus',
        label: 'Marital Status',
        type: 'radio',
        required: true,
        options: [
          { label: 'Single', value: 'Single' },
          { label: 'Married', value: 'Married' },
          { label: 'Divorced', value: 'Divorced' },
          { label: 'Widowed', value: 'Widowed' },
          { label: 'Domestic Partnership', value: 'Domestic Partnership' },
          { label: 'Separated', value: 'Separated' },
        ],
      },
    ],
  },

  // Step 7b: Gender
  {
    id: 'personal_gender',
    section: 'aboutYou',
    title: 'What is your gender?',
    subtitle: 'Used for document language (e.g., "he/she", "husband/wife").',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'personalInfo.gender',
        label: 'Gender',
        type: 'radio',
        required: true,
        options: [
          { label: 'Male', value: 'male' },
          { label: 'Female', value: 'female' },
        ],
      },
    ],
  },

  // Step 8: Citizenship
  {
    id: 'personal_citizenship',
    section: 'aboutYou',
    title: 'Are you a United States citizen?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'personalInfo.citizenship',
        label: 'Citizenship Status',
        type: 'radio',
        required: true,
        options: [
          { label: 'Yes — U.S. Citizen', value: 'US Citizen' },
          { label: 'No', value: 'Non-Resident Alien' },
          { label: 'Permanent Resident (Green Card)', value: 'Permanent Resident (Green Card)' },
          { label: 'Other', value: 'Other' },
        ],
      },
    ],
  },

  // Step 9: Occupation
  {
    id: 'personal_occupation',
    section: 'aboutYou',
    title: 'What is your occupation?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'personalInfo.occupation',
        label: 'Occupation',
        type: 'text',
        placeholder: 'e.g., Attorney, Teacher, Engineer',
        helpText: 'Enter your current occupation, or select a common status below.',
        width: 'half',
      },
      {
        name: 'personalInfo.employer',
        label: 'Employer / Employment Status',
        type: 'text',
        placeholder: 'Employer name, or Retired / Self-Employed / Unemployed',
        width: 'half',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// SECTION 2: YOUR SPOUSE / PARTNER
// Condition: personalInfo.maritalStatus equals 'Married' or 'Domestic Partnership'
// ---------------------------------------------------------------------------

const SECTION_SPOUSE: QuestionnaireStep[] = [
  // Spouse Name
  {
    id: 'spouse_name',
    section: 'spouse',
    title: "What is your spouse's / partner's full legal name?",
    estimatedMinutes: 1,
    condition: {
      field: 'personalInfo.maritalStatus',
      operator: 'includes',
      value: ['Married', 'Domestic Partnership'],
    },
    fields: [
      {
        name: 'spouseInfo.firstName',
        label: 'First Name',
        type: 'text',
        required: true,
        placeholder: 'First name',
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
        required: true,
        placeholder: 'Last name',
        width: 'half',
      },
      {
        name: 'spouseInfo.suffix',
        label: 'Suffix',
        type: 'select',
        placeholder: 'Select suffix (optional)',
        width: 'half',
        options: [
          { label: 'Jr.', value: 'Jr.' },
          { label: 'Sr.', value: 'Sr.' },
          { label: 'II', value: 'II' },
          { label: 'III', value: 'III' },
          { label: 'IV', value: 'IV' },
          { label: 'Esq.', value: 'Esq.' },
          { label: 'MD', value: 'MD' },
          { label: 'PhD', value: 'PhD' },
        ],
      },
    ],
  },

  // Spouse Date of Birth
  {
    id: 'spouse_dob',
    section: 'spouse',
    title: "What is your spouse's / partner's date of birth?",
    estimatedMinutes: 1,
    condition: {
      field: 'personalInfo.maritalStatus',
      operator: 'includes',
      value: ['Married', 'Domestic Partnership'],
    },
    fields: [
      {
        name: 'spouseInfo.dob',
        label: 'Date of Birth',
        type: 'date',
        required: true,
        width: 'half',
      },
    ],
  },

  // Spouse SSN Last 4
  {
    id: 'spouse_ssn',
    section: 'spouse',
    title: "What are the last four digits of your spouse's / partner's Social Security Number?",
    subtitle: 'This is used for document preparation only and is stored securely.',
    estimatedMinutes: 1,
    condition: {
      field: 'personalInfo.maritalStatus',
      operator: 'includes',
      value: ['Married', 'Domestic Partnership'],
    },
    fields: [
      {
        name: 'spouseInfo.ssnLast4',
        label: 'Last 4 Digits of SSN',
        type: 'ssn4',
        required: true,
        placeholder: 'XXXX',
        width: 'half',
      },
    ],
  },

  // Spouse Address
  {
    id: 'spouse_address',
    section: 'spouse',
    title: "What is your spouse's / partner's home address?",
    estimatedMinutes: 1,
    condition: {
      field: 'personalInfo.maritalStatus',
      operator: 'includes',
      value: ['Married', 'Domestic Partnership'],
    },
    fields: [
      {
        name: 'spouseInfo.sameAddress',
        label: 'Same address as mine',
        type: 'yesno',
        helpText: 'If yes, your address will be used for your spouse.',
      },
      {
        name: 'spouseInfo',
        label: 'Spouse Address',
        type: 'address',
        required: true,
        width: 'full',
        condition: { field: 'spouseInfo.sameAddress', operator: 'equals', value: false },
      },
    ],
  },

  // Spouse Email
  {
    id: 'spouse_email',
    section: 'spouse',
    title: "What is your spouse's / partner's email address?",
    estimatedMinutes: 1,
    condition: {
      field: 'personalInfo.maritalStatus',
      operator: 'includes',
      value: ['Married', 'Domestic Partnership'],
    },
    fields: [
      {
        name: 'spouseInfo.email',
        label: 'Email Address',
        type: 'email',
        required: true,
        placeholder: 'spouse@example.com',
        width: 'half',
      },
    ],
  },

  // Spouse Phone
  {
    id: 'spouse_phone',
    section: 'spouse',
    title: "What is your spouse's / partner's phone number?",
    estimatedMinutes: 1,
    condition: {
      field: 'personalInfo.maritalStatus',
      operator: 'includes',
      value: ['Married', 'Domestic Partnership'],
    },
    fields: [
      {
        name: 'spouseInfo.phone',
        label: 'Phone Number',
        type: 'phone',
        required: true,
        placeholder: '(609) 555-1234',
        width: 'half',
      },
    ],
  },

  // Spouse Citizenship
  {
    id: 'spouse_citizenship',
    section: 'spouse',
    title: "Is your spouse / partner a United States citizen?",
    estimatedMinutes: 1,
    condition: {
      field: 'personalInfo.maritalStatus',
      operator: 'includes',
      value: ['Married', 'Domestic Partnership'],
    },
    fields: [
      {
        name: 'spouseInfo.citizenship',
        label: 'Citizenship Status',
        type: 'radio',
        required: true,
        options: [
          { label: 'Yes — U.S. Citizen', value: 'US Citizen' },
          { label: 'No', value: 'Non-Resident Alien' },
          { label: 'Permanent Resident (Green Card)', value: 'Permanent Resident (Green Card)' },
          { label: 'Other', value: 'Other' },
        ],
      },
    ],
  },

  // Spouse Occupation
  {
    id: 'spouse_occupation',
    section: 'spouse',
    title: "What is your spouse's / partner's occupation?",
    estimatedMinutes: 1,
    condition: {
      field: 'personalInfo.maritalStatus',
      operator: 'includes',
      value: ['Married', 'Domestic Partnership'],
    },
    fields: [
      {
        name: 'spouseInfo.occupation',
        label: 'Occupation',
        type: 'text',
        placeholder: 'e.g., Attorney, Teacher, Engineer',
        width: 'half',
      },
      {
        name: 'spouseInfo.employer',
        label: 'Employer / Employment Status',
        type: 'text',
        placeholder: 'Employer name, or Retired / Self-Employed / Unemployed',
        width: 'half',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// SECTION 3: YOUR CHILDREN & DEPENDENTS
// ---------------------------------------------------------------------------

const SECTION_CHILDREN: QuestionnaireStep[] = [
  // Has Children?
  {
    id: 'has_children',
    section: 'children',
    title: 'Do you have any children?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'hasChildren',
        label: 'Do you have any children?',
        type: 'yesno',
        required: true,
      },
    ],
  },

  // Number of Children
  {
    id: 'number_children',
    section: 'children',
    title: 'How many children do you have?',
    estimatedMinutes: 1,
    condition: { field: 'hasChildren', operator: 'equals', value: true },
    fields: [
      {
        name: 'numberOfChildren',
        label: 'Number of Children',
        type: 'number',
        required: true,
        min: 1,
        max: 20,
        width: 'third',
      },
    ],
  },

  // Children Details
  {
    id: 'children_details',
    section: 'children',
    title: 'Please provide information about each child',
    subtitle: "We'll use this information to customize your estate plan.",
    estimatedMinutes: 3,
    condition: { field: 'hasChildren', operator: 'equals', value: true },
    fields: [
      {
        name: 'children',
        label: 'Children',
        type: 'repeater',
        repeaterConfig: {
          itemLabel: 'Child',
          addLabel: 'Add Another Child',
          minItems: 1,
          maxItems: 20,
          fields: [
            {
              name: 'name',
              label: 'Full Name',
              type: 'text',
              required: true,
              placeholder: "Child's full legal name",
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
              type: 'radio',
              required: true,
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
              options: [
                { label: 'Male', value: 'male' },
                { label: 'Female', value: 'female' },
              ],
            },
            {
              name: 'sameAddress',
              label: 'Same address as mine',
              type: 'yesno',
              helpText: 'If yes, your address will be used for this child.',
            },
            {
              name: 'address',
              label: 'Address',
              type: 'text',
              placeholder: 'Street address',
              width: 'full',
              condition: { field: 'sameAddress', operator: 'equals', value: false },
            },
            {
              name: 'specialNeeds',
              label: 'Does this child have special needs?',
              type: 'yesno',
            },
            {
              name: 'specialNeedsDetails',
              label: 'Please describe the special needs',
              type: 'textarea',
              placeholder: 'Describe any disabilities, conditions, or special circumstances...',
              rows: 3,
              condition: { field: 'specialNeeds', operator: 'equals', value: true },
            },
          ],
        },
      },
    ],
  },

  // Guardian Nomination
  {
    id: 'guardian_nomination',
    section: 'children',
    title: 'Who would you like to serve as guardian for your minor children?',
    subtitle: 'Fiduciaries are the people you trust to carry out your wishes.',
    estimatedMinutes: 2,
    condition: { field: 'hasChildren', operator: 'equals', value: true },
    fields: [
      {
        name: '_heading_primary_guardian',
        label: 'Primary Guardian',
        type: 'heading',
      },
      {
        name: 'guardianPrimary.name',
        label: 'Full Name',
        type: 'text',
        required: true,
        placeholder: "Guardian's full legal name",
        width: 'half',
      },
      {
        name: 'guardianPrimary.relationship',
        label: 'Relationship to You',
        type: 'select',
        options: RELATIONSHIP_OPTIONS,
        placeholder: 'Select relationship',
        width: 'half',
      },
      {
        name: 'guardianPrimary.address',
        label: 'Address',
        type: 'text',
        placeholder: 'Street address, city, state, ZIP',
        width: 'half',
      },
      {
        name: 'guardianPrimary.phone',
        label: 'Phone Number',
        type: 'phone',
        placeholder: '(609) 555-1234',
        width: 'half',
      },
      {
        name: '_heading_alternate_guardian',
        label: 'Alternate Guardian',
        type: 'heading',
      },
      {
        name: 'guardianAlternate.name',
        label: 'Full Name',
        type: 'text',
        placeholder: "Alternate guardian's full legal name",
        width: 'half',
      },
      {
        name: 'guardianAlternate.relationship',
        label: 'Relationship to You',
        type: 'select',
        options: RELATIONSHIP_OPTIONS,
        placeholder: 'Select relationship',
        width: 'half',
      },
      {
        name: 'guardianAlternate.address',
        label: 'Address',
        type: 'text',
        placeholder: 'Street address, city, state, ZIP',
        width: 'half',
      },
      {
        name: 'guardianAlternate.phone',
        label: 'Phone Number',
        type: 'phone',
        placeholder: '(609) 555-1234',
        width: 'half',
      },
    ],
  },

  // Other Dependents?
  {
    id: 'other_dependents',
    section: 'children',
    title: 'Do you have any other dependents?',
    subtitle: 'e.g., aging parents, disabled relatives',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'hasOtherDependents',
        label: 'Do you have other dependents?',
        type: 'yesno',
        required: true,
      },
    ],
  },

  // Other Dependents Details
  {
    id: 'other_dependents_details',
    section: 'children',
    title: 'Please list your other dependents',
    estimatedMinutes: 2,
    condition: { field: 'hasOtherDependents', operator: 'equals', value: true },
    fields: [
      {
        name: 'otherDependents',
        label: 'Other Dependents',
        type: 'repeater',
        repeaterConfig: {
          itemLabel: 'Dependent',
          addLabel: 'Add Another Dependent',
          minItems: 1,
          maxItems: 10,
          fields: [
            {
              name: 'name',
              label: 'Full Name',
              type: 'text',
              required: true,
              placeholder: "Dependent's full name",
              width: 'half',
            },
            {
              name: 'relationship',
              label: 'Relationship to You',
              type: 'text',
              required: true,
              placeholder: 'e.g., Parent, Sibling',
              width: 'half',
            },
            {
              name: 'notes',
              label: 'Notes',
              type: 'textarea',
              placeholder: 'Any additional details about this dependent...',
              rows: 2,
            },
          ],
        },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// SECTION 4: YOUR ASSETS
// ---------------------------------------------------------------------------

const SECTION_ASSETS: QuestionnaireStep[] = [
  // Real Estate
  {
    id: 'has_real_estate',
    section: 'assets',
    title: 'Do you own any real estate?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'assets.hasRealEstate',
        label: 'Do you own real estate?',
        type: 'yesno',
        required: true,
      },
    ],
  },
  {
    id: 'real_estate_details',
    section: 'assets',
    title: 'Please provide details about your real estate',
    estimatedMinutes: 3,
    condition: { field: 'assets.hasRealEstate', operator: 'equals', value: true },
    fields: [
      {
        name: 'assets.realEstate',
        label: 'Real Estate Properties',
        type: 'repeater',
        repeaterConfig: {
          itemLabel: 'Property',
          addLabel: 'Add Another Property',
          minItems: 1,
          maxItems: 10,
          fields: [
            {
              name: 'address',
              label: 'Street Address',
              type: 'text',
              required: true,
              placeholder: '123 Main Street',
              width: 'full',
            },
            {
              name: 'city',
              label: 'City',
              type: 'text',
              required: true,
              placeholder: 'City',
              width: 'third',
            },
            {
              name: 'county',
              label: 'County',
              type: 'select',
              options: NJ_COUNTY_OPTIONS,
              placeholder: 'Select county',
              width: 'third',
            },
            {
              name: 'state',
              label: 'State',
              type: 'select',
              required: true,
              defaultValue: 'NJ',
              options: US_STATE_OPTIONS,
              width: 'third',
            },
            {
              name: 'zip',
              label: 'ZIP Code',
              type: 'text',
              placeholder: '08831',
              width: 'third',
            },
            {
              name: 'isPrimaryResidence',
              label: 'Is this your primary residence?',
              type: 'yesno',
            },
            {
              name: 'blockLot',
              label: 'Block & Lot Number',
              type: 'text',
              placeholder: 'e.g., Block 1234, Lot 5',
              helpText: 'Found on your property tax bill',
              width: 'half',
            },
            {
              name: 'estimatedValue',
              label: 'Estimated Value',
              type: 'currency',
              placeholder: '$0',
              width: 'half',
            },
            {
              name: 'mortgageBalance',
              label: 'Mortgage Balance (if any)',
              type: 'currency',
              placeholder: '$0',
              width: 'half',
            },
            {
              name: 'mortgageLender',
              label: 'Mortgage Lender',
              type: 'text',
              placeholder: 'Lender name',
              width: 'half',
            },
            {
              name: 'titling',
              label: 'How is this property titled?',
              type: 'select',
              required: true,
              options: TITLING_OPTIONS,
              placeholder: 'Select titling',
            },
          ],
        },
      },
    ],
  },

  // Bank Accounts
  {
    id: 'has_bank_accounts',
    section: 'assets',
    title: 'Do you have bank accounts?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'assets.hasBankAccounts',
        label: 'Do you have bank accounts?',
        type: 'yesno',
        required: true,
      },
    ],
  },
  {
    id: 'bank_accounts_details',
    section: 'assets',
    title: 'Please provide details about your bank accounts',
    estimatedMinutes: 3,
    condition: { field: 'assets.hasBankAccounts', operator: 'equals', value: true },
    fields: [
      {
        name: 'assets.bankAccounts',
        label: 'Bank Accounts',
        type: 'repeater',
        repeaterConfig: {
          itemLabel: 'Account',
          addLabel: 'Add Another Account',
          minItems: 1,
          maxItems: 20,
          fields: [
            {
              name: 'institution',
              label: 'Financial Institution',
              type: 'text',
              required: true,
              placeholder: 'e.g., Chase, Wells Fargo, TD Bank',
              width: 'half',
            },
            {
              name: 'accountType',
              label: 'Account Type',
              type: 'select',
              required: true,
              options: ACCOUNT_TYPE_OPTIONS,
              placeholder: 'Select account type',
              width: 'half',
            },
            {
              name: 'estimatedBalance',
              label: 'Estimated Balance',
              type: 'currency',
              placeholder: '$0',
              width: 'half',
            },
            {
              name: 'titling',
              label: 'How is this account titled?',
              type: 'select',
              required: true,
              options: TITLING_OPTIONS,
              placeholder: 'Select titling',
              width: 'half',
            },
            {
              name: 'beneficiary',
              label: 'Beneficiary Designation (if any)',
              type: 'text',
              placeholder: 'Name of designated beneficiary',
              width: 'full',
            },
          ],
        },
      },
    ],
  },

  // Investment Accounts
  {
    id: 'has_investment_accounts',
    section: 'assets',
    title: 'Do you have investment or brokerage accounts?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'assets.hasInvestmentAccounts',
        label: 'Do you have investment or brokerage accounts?',
        type: 'yesno',
        required: true,
      },
    ],
  },
  {
    id: 'investment_accounts_details',
    section: 'assets',
    title: 'Please provide details about your investment accounts',
    estimatedMinutes: 3,
    condition: { field: 'assets.hasInvestmentAccounts', operator: 'equals', value: true },
    fields: [
      {
        name: 'assets.investmentAccounts',
        label: 'Investment / Brokerage Accounts',
        type: 'repeater',
        repeaterConfig: {
          itemLabel: 'Account',
          addLabel: 'Add Another Account',
          minItems: 1,
          maxItems: 20,
          fields: [
            {
              name: 'institution',
              label: 'Financial Institution / Brokerage',
              type: 'text',
              required: true,
              placeholder: 'e.g., Fidelity, Vanguard, Schwab',
              width: 'half',
            },
            {
              name: 'accountType',
              label: 'Account Type',
              type: 'select',
              required: true,
              options: ACCOUNT_TYPE_OPTIONS,
              placeholder: 'Select account type',
              width: 'half',
            },
            {
              name: 'estimatedValue',
              label: 'Estimated Value',
              type: 'currency',
              placeholder: '$0',
              width: 'half',
            },
            {
              name: 'titling',
              label: 'How is this account titled?',
              type: 'select',
              required: true,
              options: TITLING_OPTIONS,
              placeholder: 'Select titling',
              width: 'half',
            },
            {
              name: 'beneficiary',
              label: 'Primary Beneficiary (if any)',
              type: 'text',
              placeholder: 'Name of primary beneficiary',
              width: 'half',
            },
            {
              name: 'contingentBeneficiary',
              label: 'Contingent Beneficiary (if any)',
              type: 'text',
              placeholder: 'Name of contingent beneficiary',
              width: 'half',
            },
          ],
        },
      },
    ],
  },

  // Retirement Accounts
  {
    id: 'has_retirement_accounts',
    section: 'assets',
    title: 'Do you have retirement accounts?',
    subtitle: '401(k), IRA, 403(b), pension, etc.',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'assets.hasRetirementAccounts',
        label: 'Do you have retirement accounts?',
        type: 'yesno',
        required: true,
      },
    ],
  },
  {
    id: 'retirement_accounts_details',
    section: 'assets',
    title: 'Please provide details about your retirement accounts',
    estimatedMinutes: 3,
    condition: { field: 'assets.hasRetirementAccounts', operator: 'equals', value: true },
    fields: [
      {
        name: 'assets.retirementAccounts',
        label: 'Retirement Accounts',
        type: 'repeater',
        repeaterConfig: {
          itemLabel: 'Account',
          addLabel: 'Add Another Account',
          minItems: 1,
          maxItems: 20,
          fields: [
            {
              name: 'institution',
              label: 'Financial Institution',
              type: 'text',
              required: true,
              placeholder: 'e.g., Fidelity, Vanguard, TIAA',
              width: 'half',
            },
            {
              name: 'accountType',
              label: 'Account Type',
              type: 'select',
              required: true,
              options: RETIREMENT_ACCOUNT_TYPE_OPTIONS,
              placeholder: 'Select account type',
              width: 'half',
            },
            {
              name: 'estimatedValue',
              label: 'Estimated Value',
              type: 'currency',
              placeholder: '$0',
              width: 'full',
            },
            {
              name: 'primaryBeneficiary',
              label: 'Primary Beneficiary',
              type: 'text',
              placeholder: 'Name of primary beneficiary',
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
      },
    ],
  },

  // Life Insurance
  {
    id: 'has_life_insurance',
    section: 'assets',
    title: 'Do you have life insurance policies?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'assets.hasLifeInsurance',
        label: 'Do you have life insurance?',
        type: 'yesno',
        required: true,
      },
    ],
  },
  {
    id: 'life_insurance_details',
    section: 'assets',
    title: 'Please provide details about your life insurance policies',
    estimatedMinutes: 3,
    condition: { field: 'assets.hasLifeInsurance', operator: 'equals', value: true },
    fields: [
      {
        name: 'assets.lifeInsurance',
        label: 'Life Insurance Policies',
        type: 'repeater',
        repeaterConfig: {
          itemLabel: 'Policy',
          addLabel: 'Add Another Policy',
          minItems: 1,
          maxItems: 10,
          fields: [
            {
              name: 'company',
              label: 'Insurance Company',
              type: 'text',
              required: true,
              placeholder: 'e.g., MetLife, Prudential, Northwestern Mutual',
              width: 'half',
            },
            {
              name: 'insuranceType',
              label: 'Policy Type',
              type: 'select',
              required: true,
              options: INSURANCE_TYPE_OPTIONS,
              placeholder: 'Select policy type',
              width: 'half',
            },
            {
              name: 'faceValue',
              label: 'Face Value / Death Benefit',
              type: 'currency',
              placeholder: '$0',
              width: 'half',
            },
            {
              name: 'cashValue',
              label: 'Cash Value (if applicable)',
              type: 'currency',
              placeholder: '$0',
              width: 'half',
            },
            {
              name: 'owner',
              label: 'Policy Owner',
              type: 'text',
              placeholder: 'Who owns the policy?',
              width: 'half',
            },
            {
              name: 'primaryBeneficiary',
              label: 'Primary Beneficiary',
              type: 'text',
              placeholder: 'Name of primary beneficiary',
              width: 'half',
            },
          ],
        },
      },
    ],
  },

  // Business Interests
  {
    id: 'has_business',
    section: 'assets',
    title: 'Do you own any business interests?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'assets.hasBusinessInterests',
        label: 'Do you own any business interests?',
        type: 'yesno',
        required: true,
      },
    ],
  },
  {
    id: 'business_details',
    section: 'assets',
    title: 'Please provide details about your business interests',
    estimatedMinutes: 3,
    condition: { field: 'assets.hasBusinessInterests', operator: 'equals', value: true },
    fields: [
      {
        name: 'assets.businessInterests',
        label: 'Business Interests',
        type: 'repeater',
        repeaterConfig: {
          itemLabel: 'Business',
          addLabel: 'Add Another Business',
          minItems: 1,
          maxItems: 10,
          fields: [
            {
              name: 'businessName',
              label: 'Business Name',
              type: 'text',
              required: true,
              placeholder: 'Legal name of the business',
              width: 'half',
            },
            {
              name: 'entityType',
              label: 'Entity Type',
              type: 'select',
              required: true,
              options: BUSINESS_ENTITY_OPTIONS,
              placeholder: 'Select entity type',
              width: 'half',
            },
            {
              name: 'ownershipPercentage',
              label: 'Your Ownership Percentage',
              type: 'number',
              placeholder: '100',
              min: 0,
              max: 100,
              helpText: 'Enter a number between 0 and 100',
              width: 'half',
            },
            {
              name: 'estimatedValue',
              label: 'Estimated Value of Your Interest',
              type: 'currency',
              placeholder: '$0',
              width: 'half',
            },
          ],
        },
      },
    ],
  },

  // Personal Property
  {
    id: 'has_personal_property',
    section: 'assets',
    title: 'Do you have significant personal property to specifically bequeath?',
    subtitle: 'Jewelry, vehicles, art, collections, firearms, etc.',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'assets.hasPersonalProperty',
        label: 'Do you have specific personal property to bequeath?',
        type: 'yesno',
        required: true,
      },
    ],
  },
  {
    id: 'personal_property_details',
    section: 'assets',
    title: 'Please describe the personal property you wish to bequeath',
    estimatedMinutes: 2,
    condition: { field: 'assets.hasPersonalProperty', operator: 'equals', value: true },
    fields: [
      {
        name: 'assets.personalProperty',
        label: 'Personal Property Items',
        type: 'repeater',
        repeaterConfig: {
          itemLabel: 'Item',
          addLabel: 'Add Another Item',
          minItems: 1,
          maxItems: 30,
          fields: [
            {
              name: 'description',
              label: 'Description',
              type: 'text',
              required: true,
              placeholder: 'e.g., Diamond engagement ring, 2020 Toyota Camry, Oil painting...',
              width: 'full',
            },
            {
              name: 'estimatedValue',
              label: 'Estimated Value',
              type: 'currency',
              placeholder: '$0',
              width: 'half',
            },
          ],
        },
      },
    ],
  },

  // Digital Assets
  {
    id: 'has_digital_assets',
    section: 'assets',
    title: 'Do you have digital assets?',
    subtitle: 'Cryptocurrency, online accounts with value, NFTs, domain names',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'assets.hasDigitalAssets',
        label: 'Do you have digital assets?',
        type: 'yesno',
        required: true,
      },
    ],
  },
  {
    id: 'digital_assets_details',
    section: 'assets',
    title: 'Please provide details about your digital assets',
    estimatedMinutes: 2,
    condition: { field: 'assets.hasDigitalAssets', operator: 'equals', value: true },
    fields: [
      {
        name: 'assets.digitalAssets',
        label: 'Digital Assets',
        type: 'repeater',
        repeaterConfig: {
          itemLabel: 'Digital Asset',
          addLabel: 'Add Another Digital Asset',
          minItems: 1,
          maxItems: 20,
          fields: [
            {
              name: 'description',
              label: 'Description',
              type: 'text',
              required: true,
              placeholder: 'e.g., Bitcoin wallet, Ethereum, GoDaddy domain, NFT collection',
              width: 'half',
            },
            {
              name: 'platform',
              label: 'Platform / Exchange',
              type: 'text',
              placeholder: 'e.g., Coinbase, Metamask, GoDaddy',
              width: 'half',
            },
            {
              name: 'estimatedValue',
              label: 'Estimated Value',
              type: 'currency',
              placeholder: '$0',
              width: 'half',
            },
          ],
        },
      },
    ],
  },

  // Other Assets (Notes)
  {
    id: 'other_assets',
    section: 'assets',
    title: 'Any other assets not listed above?',
    subtitle: 'Notes receivable, interests in estates, intellectual property, etc.',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'assets.notes',
        label: 'Other Assets',
        type: 'textarea',
        placeholder: 'Describe any other assets...',
        rows: 4,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// SECTION 5: YOUR LIABILITIES
// ---------------------------------------------------------------------------

const SECTION_LIABILITIES: QuestionnaireStep[] = [
  // Loans
  {
    id: 'has_loans',
    section: 'liabilities',
    title: 'Do you have any outstanding loans?',
    subtitle: 'Student loans, auto loans, personal loans, business loans',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'liabilities.hasLoans',
        label: 'Do you have outstanding loans?',
        type: 'yesno',
        required: true,
      },
    ],
  },
  {
    id: 'loans_details',
    section: 'liabilities',
    title: 'Please provide details about your loans',
    estimatedMinutes: 3,
    condition: { field: 'liabilities.hasLoans', operator: 'equals', value: true },
    fields: [
      {
        name: 'liabilities.loans',
        label: 'Loans',
        type: 'repeater',
        repeaterConfig: {
          itemLabel: 'Loan',
          addLabel: 'Add Another Loan',
          minItems: 1,
          maxItems: 20,
          fields: [
            {
              name: 'type',
              label: 'Loan Type',
              type: 'select',
              required: true,
              options: [
                { label: 'Student Loan', value: 'student' },
                { label: 'Auto Loan', value: 'auto' },
                { label: 'Personal Loan', value: 'personal' },
                { label: 'Business Loan', value: 'business' },
                { label: 'Other', value: 'other' },
              ],
              placeholder: 'Select loan type',
              width: 'half',
            },
            {
              name: 'creditor',
              label: 'Creditor / Lender',
              type: 'text',
              required: true,
              placeholder: 'Name of lender',
              width: 'half',
            },
            {
              name: 'balance',
              label: 'Outstanding Balance',
              type: 'currency',
              placeholder: '$0',
              width: 'half',
            },
            {
              name: 'monthlyPayment',
              label: 'Monthly Payment',
              type: 'currency',
              placeholder: '$0',
              width: 'half',
            },
          ],
        },
      },
    ],
  },

  // Credit Cards
  {
    id: 'has_credit_cards',
    section: 'liabilities',
    title: 'Do you have significant credit card debt?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'liabilities.hasCreditCards',
        label: 'Do you have significant credit card debt?',
        type: 'yesno',
        required: true,
      },
    ],
  },
  {
    id: 'credit_card_details',
    section: 'liabilities',
    title: 'Please provide details about your credit card debt',
    estimatedMinutes: 2,
    condition: { field: 'liabilities.hasCreditCards', operator: 'equals', value: true },
    fields: [
      {
        name: 'liabilities.creditCards',
        label: 'Credit Cards',
        type: 'repeater',
        repeaterConfig: {
          itemLabel: 'Credit Card',
          addLabel: 'Add Another Card',
          minItems: 1,
          maxItems: 20,
          fields: [
            {
              name: 'creditor',
              label: 'Creditor / Card Issuer',
              type: 'text',
              required: true,
              placeholder: 'e.g., Chase, Amex, Citi',
              width: 'half',
            },
            {
              name: 'balance',
              label: 'Outstanding Balance',
              type: 'currency',
              placeholder: '$0',
              width: 'half',
            },
          ],
        },
      },
    ],
  },

  // Other Debts
  {
    id: 'other_debts',
    section: 'liabilities',
    title: 'Any other debts or financial obligations?',
    subtitle: 'Judgments, tax liabilities, personal obligations, guarantees, etc.',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'liabilities.notes',
        label: 'Other Debts & Obligations',
        type: 'textarea',
        placeholder: 'Describe any other debts or financial obligations...',
        rows: 4,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// SECTION 6: YOUR FIDUCIARIES
// ---------------------------------------------------------------------------

const SECTION_FIDUCIARIES: QuestionnaireStep[] = [
  // Intro
  {
    id: 'fiduciaries_intro',
    section: 'fiduciaries',
    title: 'Your Fiduciaries',
    subtitle: 'We will now ask you to name the people who will carry out your wishes.',
    estimatedMinutes: 1,
    fields: [
      {
        name: '_info_fiduciaries',
        label: '',
        type: 'info',
        defaultValue:
          'Fiduciaries are the people you trust to carry out your wishes. We\'ll ask you to name primary and alternate individuals for each role. Choose people who are responsible, organized, and willing to serve. You should speak with these individuals before naming them.',
      },
    ],
  },

  // Executor
  {
    id: 'executor',
    section: 'fiduciaries',
    title: 'Who should manage your estate after you pass away?',
    subtitle: 'This person is called your Executor or Personal Representative.',
    estimatedMinutes: 2,
    fields: [
      {
        name: '_heading_primary_executor',
        label: 'Primary Executor',
        type: 'heading',
      },
      {
        name: 'fiduciaries.executor.primary.name',
        label: 'Full Name',
        type: 'text',
        required: true,
        placeholder: "Executor's full legal name",
        width: 'half',
      },
      {
        name: 'fiduciaries.executor.primary.relationship',
        label: 'Relationship to You',
        type: 'select',
        options: RELATIONSHIP_OPTIONS,
        placeholder: 'Select relationship',
        width: 'half',
      },
      {
        name: 'fiduciaries.executor.primary.address',
        label: 'Address',
        type: 'text',
        placeholder: 'Street address, city, state, ZIP',
        width: 'half',
      },
      {
        name: 'fiduciaries.executor.primary.phone',
        label: 'Phone Number',
        type: 'phone',
        placeholder: '(609) 555-1234',
        width: 'half',
      },
      {
        name: '_heading_alternate_executor',
        label: 'Alternate Executor',
        type: 'heading',
      },
      {
        name: 'fiduciaries.executor.alternate.name',
        label: 'Full Name',
        type: 'text',
        placeholder: "Alternate executor's full legal name",
        width: 'half',
      },
      {
        name: 'fiduciaries.executor.alternate.relationship',
        label: 'Relationship to You',
        type: 'select',
        options: RELATIONSHIP_OPTIONS,
        placeholder: 'Select relationship',
        width: 'half',
      },
      {
        name: 'fiduciaries.executor.alternate.address',
        label: 'Address',
        type: 'text',
        placeholder: 'Street address, city, state, ZIP',
        width: 'half',
      },
      {
        name: 'fiduciaries.executor.alternate.phone',
        label: 'Phone Number',
        type: 'phone',
        placeholder: '(609) 555-1234',
        width: 'half',
      },
    ],
  },

  // Trustee
  {
    id: 'trustee',
    section: 'fiduciaries',
    title: 'Who should manage your trust?',
    subtitle:
      'The Trustee manages assets held in trust for your beneficiaries. You may serve as your own initial Trustee.',
    estimatedMinutes: 2,
    fields: [
      {
        name: '_heading_primary_trustee',
        label: 'Primary / Initial Trustee',
        type: 'heading',
      },
      {
        name: 'fiduciaries.trustee.primary.name',
        label: 'Full Name',
        type: 'text',
        required: true,
        placeholder: "Trustee's full legal name",
        width: 'half',
      },
      {
        name: 'fiduciaries.trustee.primary.relationship',
        label: 'Relationship to You',
        type: 'select',
        options: [...RELATIONSHIP_OPTIONS.slice(0, 0), { label: 'Self', value: 'Self' }, ...RELATIONSHIP_OPTIONS],
        placeholder: 'Select relationship',
        width: 'half',
      },
      {
        name: 'fiduciaries.trustee.primary.address',
        label: 'Address',
        type: 'text',
        placeholder: 'Street address, city, state, ZIP',
        width: 'half',
      },
      {
        name: 'fiduciaries.trustee.primary.phone',
        label: 'Phone Number',
        type: 'phone',
        placeholder: '(609) 555-1234',
        width: 'half',
      },
      {
        name: '_heading_successor_trustee',
        label: 'Successor Trustee',
        type: 'heading',
      },
      {
        name: 'fiduciaries.trustee.successor.name',
        label: 'Full Name',
        type: 'text',
        placeholder: "Successor trustee's full legal name",
        width: 'half',
      },
      {
        name: 'fiduciaries.trustee.successor.relationship',
        label: 'Relationship to You',
        type: 'select',
        options: RELATIONSHIP_OPTIONS,
        placeholder: 'Select relationship',
        width: 'half',
      },
      {
        name: 'fiduciaries.trustee.successor.address',
        label: 'Address',
        type: 'text',
        placeholder: 'Street address, city, state, ZIP',
        width: 'half',
      },
      {
        name: 'fiduciaries.trustee.successor.phone',
        label: 'Phone Number',
        type: 'phone',
        placeholder: '(609) 555-1234',
        width: 'half',
      },
      {
        name: '_heading_second_successor_trustee',
        label: 'Second Successor Trustee',
        type: 'heading',
      },
      {
        name: 'fiduciaries.trustee.secondSuccessor.name',
        label: 'Full Name',
        type: 'text',
        placeholder: "Second successor's full legal name",
        width: 'half',
      },
      {
        name: 'fiduciaries.trustee.secondSuccessor.relationship',
        label: 'Relationship to You',
        type: 'select',
        options: RELATIONSHIP_OPTIONS,
        placeholder: 'Select relationship',
        width: 'half',
      },
      {
        name: 'fiduciaries.trustee.secondSuccessor.address',
        label: 'Address',
        type: 'text',
        placeholder: 'Street address, city, state, ZIP',
        width: 'half',
      },
      {
        name: 'fiduciaries.trustee.secondSuccessor.phone',
        label: 'Phone Number',
        type: 'phone',
        placeholder: '(609) 555-1234',
        width: 'half',
      },
    ],
  },

  // Power of Attorney Agent
  {
    id: 'poa_agent',
    section: 'fiduciaries',
    title: 'Who should handle your financial affairs if you become incapacitated?',
    subtitle: 'This person is your Power of Attorney Agent.',
    estimatedMinutes: 2,
    fields: [
      {
        name: '_heading_primary_poa',
        label: 'Primary POA Agent',
        type: 'heading',
      },
      {
        name: 'fiduciaries.poaAgent.primary.name',
        label: 'Full Name',
        type: 'text',
        required: true,
        placeholder: "Agent's full legal name",
        width: 'half',
      },
      {
        name: 'fiduciaries.poaAgent.primary.relationship',
        label: 'Relationship to You',
        type: 'select',
        options: RELATIONSHIP_OPTIONS,
        placeholder: 'Select relationship',
        width: 'half',
      },
      {
        name: 'fiduciaries.poaAgent.primary.address',
        label: 'Address',
        type: 'text',
        placeholder: 'Street address, city, state, ZIP',
        width: 'half',
      },
      {
        name: 'fiduciaries.poaAgent.primary.phone',
        label: 'Phone Number',
        type: 'phone',
        placeholder: '(609) 555-1234',
        width: 'half',
      },
      {
        name: '_heading_alternate_poa',
        label: 'Alternate POA Agent',
        type: 'heading',
      },
      {
        name: 'fiduciaries.poaAgent.alternate.name',
        label: 'Full Name',
        type: 'text',
        placeholder: "Alternate agent's full legal name",
        width: 'half',
      },
      {
        name: 'fiduciaries.poaAgent.alternate.relationship',
        label: 'Relationship to You',
        type: 'select',
        options: RELATIONSHIP_OPTIONS,
        placeholder: 'Select relationship',
        width: 'half',
      },
      {
        name: 'fiduciaries.poaAgent.alternate.address',
        label: 'Address',
        type: 'text',
        placeholder: 'Street address, city, state, ZIP',
        width: 'half',
      },
      {
        name: 'fiduciaries.poaAgent.alternate.phone',
        label: 'Phone Number',
        type: 'phone',
        placeholder: '(609) 555-1234',
        width: 'half',
      },
    ],
  },

  // Healthcare Representative
  {
    id: 'healthcare_rep',
    section: 'fiduciaries',
    title: 'Who should make medical decisions for you if you cannot?',
    subtitle: 'This person is your Healthcare Representative.',
    estimatedMinutes: 2,
    fields: [
      {
        name: '_heading_primary_hcr',
        label: 'Primary Healthcare Representative',
        type: 'heading',
      },
      {
        name: 'fiduciaries.healthcareRep.primary.name',
        label: 'Full Name',
        type: 'text',
        required: true,
        placeholder: "Representative's full legal name",
        width: 'half',
      },
      {
        name: 'fiduciaries.healthcareRep.primary.relationship',
        label: 'Relationship to You',
        type: 'select',
        options: RELATIONSHIP_OPTIONS,
        placeholder: 'Select relationship',
        width: 'half',
      },
      {
        name: 'fiduciaries.healthcareRep.primary.address',
        label: 'Address',
        type: 'text',
        placeholder: 'Street address, city, state, ZIP',
        width: 'half',
      },
      {
        name: 'fiduciaries.healthcareRep.primary.phone',
        label: 'Phone Number',
        type: 'phone',
        placeholder: '(609) 555-1234',
        width: 'half',
      },
      {
        name: '_heading_alternate_hcr',
        label: 'Alternate Healthcare Representative',
        type: 'heading',
      },
      {
        name: 'fiduciaries.healthcareRep.alternate.name',
        label: 'Full Name',
        type: 'text',
        placeholder: "Alternate representative's full legal name",
        width: 'half',
      },
      {
        name: 'fiduciaries.healthcareRep.alternate.relationship',
        label: 'Relationship to You',
        type: 'select',
        options: RELATIONSHIP_OPTIONS,
        placeholder: 'Select relationship',
        width: 'half',
      },
      {
        name: 'fiduciaries.healthcareRep.alternate.address',
        label: 'Address',
        type: 'text',
        placeholder: 'Street address, city, state, ZIP',
        width: 'half',
      },
      {
        name: 'fiduciaries.healthcareRep.alternate.phone',
        label: 'Phone Number',
        type: 'phone',
        placeholder: '(609) 555-1234',
        width: 'half',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// SECTION 7: YOUR WISHES
// ---------------------------------------------------------------------------

const SECTION_WISHES: QuestionnaireStep[] = [
  // Distribution Plan
  {
    id: 'distribution_plan',
    section: 'wishes',
    title: 'How would you like your estate distributed?',
    estimatedMinutes: 2,
    fields: [
      {
        name: 'distributionPlan',
        label: 'Distribution Plan',
        type: 'radio',
        required: true,
        options: [
          {
            label: 'Everything to my spouse, then equally to children',
            value: 'allToSpouse',
            description: 'Most common — your entire estate goes to your spouse first, and if your spouse has predeceased you, equally among your children.',
          },
          {
            label: 'Everything equally to children',
            value: 'equalToChildren',
            description: 'Your estate is divided equally among all of your children.',
          },
          {
            label: 'Specific percentages to named beneficiaries',
            value: 'specificPercentages',
            description: 'You designate specific percentages to named individuals or organizations.',
          },
          {
            label: 'Custom distribution plan',
            value: 'custom',
            description: 'Describe a custom distribution plan. Our attorney will work with you to document your wishes.',
          },
        ],
      },
    ],
  },

  // Per Stirpes Election
  {
    id: 'distribution_per_stirpes',
    section: 'wishes',
    title: 'If a beneficiary predeceases you, should their share pass to their children?',
    subtitle: 'This is called distribution "per stirpes" — it keeps the share within that family branch.',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'distribution.perStirpes',
        label: 'Per Stirpes Distribution',
        type: 'radio',
        required: true,
        options: [
          {
            label: 'Yes — their share passes to their children',
            value: 'yes',
            description: 'Per stirpes: if your son predeceases you, his children inherit his share.',
          },
          {
            label: 'No — redistribute among surviving beneficiaries',
            value: 'no',
            description: 'Per capita: only surviving beneficiaries inherit.',
          },
        ],
      },
    ],
  },

  // Specific Beneficiaries
  {
    id: 'specific_beneficiaries',
    section: 'wishes',
    title: 'Please specify your beneficiaries and their shares',
    subtitle: 'All percentages must total 100%.',
    estimatedMinutes: 3,
    condition: {
      field: 'distributionPlan',
      operator: 'includes',
      value: ['specificPercentages', 'custom'],
    },
    fields: [
      {
        name: 'specificBeneficiaries',
        label: 'Beneficiaries',
        type: 'repeater',
        repeaterConfig: {
          itemLabel: 'Beneficiary',
          addLabel: 'Add Another Beneficiary',
          minItems: 1,
          maxItems: 20,
          fields: [
            {
              name: 'name',
              label: 'Full Name',
              type: 'text',
              required: true,
              placeholder: "Beneficiary's full legal name",
              width: 'half',
            },
            {
              name: 'relationship',
              label: 'Relationship to You',
              type: 'text',
              placeholder: 'e.g., Son, Daughter, Sibling',
              width: 'half',
            },
            {
              name: 'percentage',
              label: 'Percentage Share',
              type: 'number',
              placeholder: '0',
              min: 0,
              max: 100,
              helpText: 'Must total 100% across all beneficiaries',
              width: 'third',
            },
          ],
        },
      },
    ],
  },

  // Specific Bequests
  {
    id: 'specific_bequests',
    section: 'wishes',
    title: 'Do you wish to make any specific gifts?',
    subtitle: 'e.g., "My wedding ring to my daughter Sarah"',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'hasSpecificBequests',
        label: 'Do you have specific gifts to make?',
        type: 'yesno',
        required: true,
      },
    ],
  },
  {
    id: 'specific_bequests_details',
    section: 'wishes',
    title: 'Please describe your specific gifts',
    estimatedMinutes: 2,
    condition: { field: 'hasSpecificBequests', operator: 'equals', value: true },
    fields: [
      {
        name: 'specificBequests',
        label: 'Specific Gifts',
        type: 'repeater',
        repeaterConfig: {
          itemLabel: 'Gift',
          addLabel: 'Add Another Gift',
          minItems: 1,
          maxItems: 30,
          fields: [
            {
              name: 'description',
              label: 'Item or Property',
              type: 'text',
              required: true,
              placeholder: 'e.g., Diamond engagement ring, Beach house at 123 Shore Rd',
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
              label: 'Relationship to You',
              type: 'select',
              options: RELATIONSHIP_OPTIONS,
              placeholder: 'Select relationship',
              width: 'half',
            },
          ],
        },
      },
    ],
  },

  // Charitable Gifts
  {
    id: 'charitable_gifts',
    section: 'wishes',
    title: 'Do you wish to leave anything to charity?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'hasCharitableGifts',
        label: 'Do you wish to make charitable gifts?',
        type: 'yesno',
        required: true,
      },
    ],
  },
  {
    id: 'charitable_gifts_details',
    section: 'wishes',
    title: 'Please describe your charitable gifts',
    estimatedMinutes: 2,
    condition: { field: 'hasCharitableGifts', operator: 'equals', value: true },
    fields: [
      {
        name: 'charitableGifts',
        label: 'Charitable Organizations',
        type: 'repeater',
        repeaterConfig: {
          itemLabel: 'Organization',
          addLabel: 'Add Another Organization',
          minItems: 1,
          maxItems: 20,
          fields: [
            {
              name: 'organizationName',
              label: 'Organization Name',
              type: 'text',
              required: true,
              placeholder: 'Name of charitable organization',
              width: 'full',
            },
            {
              name: 'amount',
              label: 'Specific Dollar Amount (if applicable)',
              type: 'currency',
              placeholder: '$0',
              width: 'half',
            },
            {
              name: 'percentage',
              label: 'Percentage of Estate (if applicable)',
              type: 'number',
              placeholder: '0',
              min: 0,
              max: 100,
              helpText: 'Enter either a dollar amount or a percentage, not both',
              width: 'half',
            },
          ],
        },
      },
    ],
  },

  // Ultimate Distribution
  {
    id: 'ultimate_distribution',
    section: 'wishes',
    title: 'If none of your named beneficiaries survive you, what should happen?',
    subtitle: 'This is sometimes called the "last resort" or "ultimate" distribution.',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'ultimateDistribution',
        label: 'Ultimate Distribution',
        type: 'radio',
        required: true,
        options: [
          {
            label: 'To my heirs under NJ intestacy law',
            value: 'intestacy',
            description: 'Your estate passes as if you had no will, according to New Jersey law.',
          },
          {
            label: 'To a specific charity',
            value: 'charity',
            description: 'Name a charitable organization to receive your estate.',
          },
          {
            label: 'Other',
            value: 'other',
            description: 'Describe another arrangement.',
          },
        ],
      },
      {
        name: 'ultimateDistributionDetails',
        label: 'Please provide details',
        type: 'text',
        placeholder: 'Name of charity or description of arrangement',
        condition: { field: 'ultimateDistribution', operator: 'includes', value: ['charity', 'other'] },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// SECTION 8: HEALTHCARE PREFERENCES
// ---------------------------------------------------------------------------

const SECTION_HEALTHCARE: QuestionnaireStep[] = [
  // Life Sustaining Treatment
  {
    id: 'life_sustaining',
    section: 'healthcare',
    title: 'If terminally ill or permanently unconscious, do you want life-sustaining treatment?',
    subtitle:
      'This instruction will be included in your New Jersey Advance Directive for Health Care.',
    estimatedMinutes: 2,
    fields: [
      {
        name: 'healthcarePreferences.lifeSupport',
        label: 'Life-Sustaining Treatment',
        type: 'radio',
        required: true,
        options: [
          {
            label: 'Yes — I want all possible measures taken',
            value: 'provide',
            description:
              'All available life-sustaining treatments should be provided, regardless of my prognosis.',
          },
          {
            label: 'No — I do not want life-sustaining treatment',
            value: 'withhold',
            description:
              'If I am terminally ill or permanently unconscious, I do not want my life prolonged by life-sustaining treatment.',
          },
          {
            label: 'Trial period — attempt treatment, then withdraw if no improvement',
            value: 'trial',
            description:
              'I want treatment attempted for a reasonable period. If there is no reasonable expectation of recovery, treatment should be withdrawn.',
          },
          {
            label: 'I want my healthcare representative to decide',
            value: 'undecided',
            description:
              'I trust my healthcare representative to make this decision based on my values and circumstances at the time.',
          },
        ],
      },
    ],
  },

  // Artificial Nutrition
  {
    id: 'artificial_nutrition',
    section: 'healthcare',
    title: 'What are your wishes regarding artificial nutrition and hydration?',
    subtitle: 'Feeding tubes, IV fluids, and other artificial means of providing nutrition.',
    estimatedMinutes: 2,
    fields: [
      {
        name: 'healthcarePreferences.artificialNutrition',
        label: 'Artificial Nutrition and Hydration',
        type: 'radio',
        required: true,
        options: [
          {
            label: 'I want nutrition and hydration continued',
            value: 'provide',
            description:
              'Provide artificial nutrition and hydration in all circumstances.',
          },
          {
            label: 'I do not want artificial nutrition and hydration',
            value: 'withhold',
            description:
              'If I am terminally ill or permanently unconscious, I do not want artificial nutrition or hydration.',
          },
          {
            label: 'I want my healthcare representative to decide',
            value: 'undecided',
            description:
              'I trust my healthcare representative to make this decision.',
          },
        ],
      },
    ],
  },

  // Pain Management
  {
    id: 'pain_management',
    section: 'healthcare',
    title: 'What are your wishes regarding pain management?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'healthcarePreferences.painManagement',
        label: 'Pain Management',
        type: 'radio',
        required: true,
        options: [
          {
            label: 'Maximum pain relief, even if it may hasten death',
            value: 'comfort_care',
            description:
              'I want to receive all available pain relief measures, even if doing so may shorten my life.',
          },
          {
            label: 'Pain management that does not risk hastening death',
            value: 'all_measures',
            description:
              'I want pain management that does not carry a risk of hastening my death.',
          },
          {
            label: 'I want my healthcare representative to decide',
            value: 'undecided',
            description:
              'I trust my healthcare representative to make pain management decisions.',
          },
        ],
      },
    ],
  },

  // Organ Donation
  {
    id: 'organ_donation',
    section: 'healthcare',
    title: 'Do you wish to be an organ donor?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'healthcarePreferences.organDonation',
        label: 'Organ Donation',
        type: 'radio',
        required: true,
        options: [
          {
            label: 'Yes — all organs and tissues',
            value: 'all',
            description: 'I donate all organs, tissues, and body parts.',
          },
          {
            label: 'Yes — specific organs only',
            value: 'specific',
            description: 'I wish to donate specific organs or tissues only.',
          },
          {
            label: 'No',
            value: 'no',
            description: 'I do not wish to donate any organs or tissues.',
          },
          {
            label: 'Already registered as a donor',
            value: 'registered',
            description: 'I am already registered with the NJ Motor Vehicle Commission or DonateLife.',
          },
        ],
      },
      {
        name: 'healthcarePreferences.organDonationDetails',
        label: 'Which organs or tissues?',
        type: 'textarea',
        placeholder:
          'Specify which organs or tissues you wish to donate (e.g., kidneys, heart, corneas)...',
        rows: 3,
        condition: { field: 'healthcarePreferences.organDonation', operator: 'equals', value: 'specific' },
      },
    ],
  },

  // Burial / Funeral Preferences
  {
    id: 'burial_preference',
    section: 'healthcare',
    title: 'Do you have preferences for funeral or burial arrangements?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'healthcarePreferences.burialPreference',
        label: 'Funeral / Burial Preference',
        type: 'radio',
        required: true,
        options: [
          { label: 'Burial', value: 'burial', description: 'Traditional burial.' },
          { label: 'Cremation', value: 'cremation', description: 'Cremation.' },
          { label: 'No preference', value: 'none', description: 'I have no preference; I leave this to my family.' },
          { label: 'Other', value: 'other', description: 'Other arrangement (describe below).' },
        ],
      },
      {
        name: 'healthcarePreferences.burialDetails',
        label: 'Please describe your preferences',
        type: 'text',
        placeholder: 'Describe funeral or burial preferences...',
        condition: { field: 'healthcarePreferences.burialPreference', operator: 'equals', value: 'other' },
      },
    ],
  },

  // Pregnancy Provision
  {
    id: 'pregnancy_provision',
    section: 'healthcare',
    title: 'If you are pregnant, should your advance directive still be followed?',
    subtitle:
      'New Jersey law allows you to specify whether your advance directive applies during pregnancy.',
    estimatedMinutes: 1,
    condition: { field: 'personalInfo.gender', operator: 'equals', value: 'female' },
    fields: [
      {
        name: 'healthcarePreferences.pregnancyDirective',
        label: 'Pregnancy Provision',
        type: 'radio',
        required: true,
        options: [
          {
            label: 'Yes — follow my advance directive even if I am pregnant',
            value: 'yes',
          },
          {
            label: 'No — do not follow my advance directive if I am pregnant',
            value: 'no',
          },
          {
            label: 'I want my healthcare representative to decide',
            value: 'representative_decides',
          },
        ],
      },
    ],
  },

  // Additional Healthcare Instructions
  {
    id: 'healthcare_additional',
    section: 'healthcare',
    title: 'Any additional healthcare instructions?',
    subtitle:
      'You may include religious beliefs, personal values, or other instructions for your healthcare representative.',
    estimatedMinutes: 2,
    fields: [
      {
        name: 'healthcarePreferences.personalStatement',
        label: 'Personal Statement / Additional Instructions',
        type: 'textarea',
        placeholder:
          'Share any personal values, religious beliefs, or additional healthcare instructions you would like your healthcare representative and medical providers to know...',
        rows: 4,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// SECTION 9: ADDITIONAL INFORMATION
// ---------------------------------------------------------------------------

const SECTION_ADDITIONAL: QuestionnaireStep[] = [
  // Existing Documents
  {
    id: 'existing_documents',
    section: 'additional',
    title: 'Do you have any existing estate planning documents?',
    subtitle: 'Will, trust, power of attorney, living will, or other estate planning documents.',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'hasExistingDocuments',
        label: 'Do you have existing estate planning documents?',
        type: 'yesno',
        required: true,
      },
    ],
  },
  {
    id: 'existing_documents_details',
    section: 'additional',
    title: 'Please describe your existing estate planning documents',
    estimatedMinutes: 2,
    condition: { field: 'hasExistingDocuments', operator: 'equals', value: true },
    fields: [
      {
        name: 'existingDocumentsDetails',
        label: 'Description of Existing Documents',
        type: 'textarea',
        placeholder:
          'e.g., I have a Will dated 2015, a Durable Power of Attorney, and a Living Will. The Will leaves everything to my spouse.',
        rows: 4,
        width: 'full',
      },
      {
        name: 'existingDocumentsDate',
        label: 'Approximate Date Executed',
        type: 'date',
        helpText: 'Approximate date is fine — enter the year if you are unsure of the exact date.',
        width: 'half',
      },
    ],
  },

  // Pending Legal Matters
  {
    id: 'pending_legal',
    section: 'additional',
    title: 'Are there any pending legal matters we should know about?',
    subtitle: 'Divorce proceedings, pending litigation, bankruptcy, or other legal matters.',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'hasPendingLegalMatters',
        label: 'Are there pending legal matters?',
        type: 'yesno',
        required: true,
      },
    ],
  },
  {
    id: 'pending_legal_details',
    section: 'additional',
    title: 'Please describe the pending legal matters',
    estimatedMinutes: 2,
    condition: { field: 'hasPendingLegalMatters', operator: 'equals', value: true },
    fields: [
      {
        name: 'pendingLegalDetails',
        label: 'Pending Legal Matters',
        type: 'textarea',
        placeholder: 'Please describe the pending legal matters...',
        rows: 4,
      },
    ],
  },

  // Additional Notes
  {
    id: 'additional_notes',
    section: 'additional',
    title: 'Is there anything else you would like us to consider?',
    subtitle:
      'Any special circumstances, family dynamics, or preferences our attorneys should know.',
    estimatedMinutes: 2,
    fields: [
      {
        name: 'additionalNotes',
        label: 'Additional Notes',
        type: 'textarea',
        placeholder:
          'Share anything else that may be relevant to your estate plan. For example: blended family circumstances, pets you want to provide for, property in other states, concerns about a specific beneficiary, etc.',
        rows: 6,
      },
    ],
  },

  // Referral Source
  {
    id: 'referral',
    section: 'additional',
    title: 'How did you hear about our firm?',
    estimatedMinutes: 1,
    fields: [
      {
        name: 'referralSource',
        label: 'How did you hear about Elias Counsel, LLC?',
        type: 'radio',
        required: false,
        options: [
          { label: 'Referral from a friend or family member', value: 'referral' },
          { label: 'Google Search', value: 'google' },
          { label: 'Social Media', value: 'social_media' },
          { label: 'Attorney Referral', value: 'attorney_referral' },
          { label: 'Other', value: 'other' },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// EXPORT: All steps assembled in order
// ---------------------------------------------------------------------------

export const QUESTIONNAIRE_STEPS: QuestionnaireStep[] = [
  ...SECTION_ABOUT_YOU,
  ...SECTION_SPOUSE,
  ...SECTION_CHILDREN,
  ...SECTION_ASSETS,
  ...SECTION_LIABILITIES,
  ...SECTION_FIDUCIARIES,
  ...SECTION_WISHES,
  ...SECTION_HEALTHCARE,
  ...SECTION_ADDITIONAL,
];

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/** All steps for a given section */
export function getStepsBySection(section: QuestionnaireStep['section']): QuestionnaireStep[] {
  return QUESTIONNAIRE_STEPS.filter((s) => s.section === section);
}

/** Look up a single step by its ID */
export function getStepById(id: string): QuestionnaireStep | undefined {
  return QUESTIONNAIRE_STEPS.find((s) => s.id === id);
}

/** Total number of steps */
export const TOTAL_STEPS = QUESTIONNAIRE_STEPS.length;

/** Map of section → step IDs for progress tracking */
export const SECTION_STEP_MAP: Record<QuestionnaireStep['section'], string[]> = {
  aboutYou: SECTION_ABOUT_YOU.map((s) => s.id),
  spouse: SECTION_SPOUSE.map((s) => s.id),
  children: SECTION_CHILDREN.map((s) => s.id),
  assets: SECTION_ASSETS.map((s) => s.id),
  liabilities: SECTION_LIABILITIES.map((s) => s.id),
  fiduciaries: SECTION_FIDUCIARIES.map((s) => s.id),
  wishes: SECTION_WISHES.map((s) => s.id),
  healthcare: SECTION_HEALTHCARE.map((s) => s.id),
  additional: SECTION_ADDITIONAL.map((s) => s.id),
};
