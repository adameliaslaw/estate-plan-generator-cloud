/**
 * tests/unit/template-variable-extraction.test.ts
 *
 * Unit tests for template variable extraction, questionnaire mapping, and
 * pre-render validation from functions/src/template-engine.ts
 *
 * Tests:
 *  - Simple variable extraction ({{var}})
 *  - Helper argument extraction ({{fullName person}})
 *  - Block helper variables ({{#if var}}, {{#each arr}})
 *  - Nested sub-expressions ({{#if (eq a 'b')}})
 *  - Comment and string literal ignoring
 *  - Closing tag ignoring ({{/if}})
 *  - Variable → questionnaire mapping completeness
 *  - Validation with complete/incomplete mock client context
 *  - Real template extraction (poa-simple.hbs, poa-comprehensive.hbs)
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Mock firebase-admin before importing template-engine
// ---------------------------------------------------------------------------
vi.mock('firebase-admin', () => ({
  firestore: () => ({}),
  initializeApp: vi.fn(),
}));

vi.mock('../../functions/src/ai-client', () => ({
  callAI: vi.fn(),
  sanitizeObject: vi.fn((o: any) => o),
  parseAIJson: vi.fn(),
}));

vi.mock('../../functions/src/generate-documents', () => ({}));

// Now import the functions under test
import {
  extractTemplateVariables,
  VARIABLE_TO_QUESTIONNAIRE_MAP,
  validateTemplateData,
  buildTemplateData,
} from '../../functions/src/template-engine';
import type { ClientContext } from '../../functions/src/client-context-aggregator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal but complete mock ClientContext for testing.
 */
function mockCompleteContext(): ClientContext {
  return {
    client: {
      personalInfo: {
        firstName: 'John',
        middleName: 'M',
        lastName: 'Smith',
        suffix: '',
        dob: '1970-05-15',
        ssnLast4: '1234',
        address: '123 Main St',
        city: 'Princeton',
        state: 'NJ',
        zip: '08540',
        county: 'Mercer',
        email: 'john@example.com',
        phone: '609-555-1234',
        maritalStatus: 'Married',
        citizenship: 'US Citizen',
        occupation: 'Attorney',
        employer: 'Smith Law LLC',
      },
      spouseInfo: {
        firstName: 'Jane',
        middleName: 'A',
        lastName: 'Smith',
        dob: '1972-08-20',
        email: 'jane@example.com',
        phone: '609-555-5678',
      },
      children: [
        { name: 'Tom Smith', dob: '2010-01-01', isMinor: true, specialNeeds: false },
        { name: 'Sarah Smith', dob: '2005-06-15', isMinor: true, specialNeeds: false },
      ],
      hasChildren: true,
      hasOtherDependents: false,
      otherDependents: [],
      guardianPrimary: { name: 'Robert Smith', relationship: 'Brother', address: '456 Oak Ave' },
      guardianAlternate: { name: 'Mary Jones', relationship: 'Sister', address: '789 Elm St' },
      distributionPlan: 'Equal distribution to all children',
      burialPreference: 'Cremation',
      burialDetails: 'Scatter at sea',
      isFemale: false,
      assets: {
        realEstate: [
          { address: '123 Main St', estimatedValue: 500000, transferToTrust: true },
        ],
        bankAccounts: [{ accountName: 'Checking', estimatedBalance: 50000 }],
        investmentAccounts: [],
        retirementAccounts: [{ accountName: '401k', estimatedValue: 200000 }],
        lifeInsurance: [{ policyName: 'Term', faceValue: 500000 }],
        businessInterests: [],
        personalProperty: [],
      },
      liabilities: {},
      fiduciaries: {
        powerOfAttorney: {
          agent: {
            firstName: 'Jane',
            lastName: 'Smith',
            address: '123 Main St',
            city: 'Princeton',
            state: 'NJ',
            zip: '08540',
            relationship: 'Spouse',
          },
          alternateAgent: {
            firstName: 'Robert',
            lastName: 'Smith',
            relationship: 'Brother',
          },
          successorAgent: {
            firstName: 'Mary',
            lastName: 'Jones',
            relationship: 'Sister',
          },
          effectiveDate: 'immediate',
          giftingPower: true,
          selfDealingPower: false,
          limitations: '',
        },
        executor: {
          primary: { firstName: 'Jane', lastName: 'Smith' },
          alternate: { firstName: 'Robert', lastName: 'Smith' },
        },
        trustee: {
          primary: { firstName: 'Jane', lastName: 'Smith' },
          alternate: { firstName: 'Robert', lastName: 'Smith' },
        },
        guardian: {
          primary: { name: 'Robert Smith' },
          alternate: { name: 'Mary Jones' },
        },
        healthcareProxy: {
          primary: { firstName: 'Jane', lastName: 'Smith' },
          alternate: { firstName: 'Robert', lastName: 'Smith' },
        },
      },
      distribution: { trustName: 'The Smith Family Trust' },
      healthcarePreferences: { lifeSustaining: 'No', artificialNutrition: 'No' },
      trusts: [{ trustName: 'The Smith Family Trust', trustType: 'Revocable' }],
      specialConsiderations: {},
      packageDetails: { packageType: 'fortress' },
      firmId: 'firm-001',
    },
    firm: {
      id: 'firm-001',
      firmName: 'Elias Counsel LLC',
      firmAddress: '100 Legal Dr, Newark, NJ 07102',
      firmPhone: '973-555-0000',
      firmEmail: 'info@eliascounsel.com',
      firmWebsite: 'https://eliascounsel.com',
      barNumber: '012345',
    },
    computed: {
      clientFullName: 'John M Smith',
      spouseFullName: 'Jane A Smith',
      hasSpouse: true,
      hasMinorChildren: true,
      hasSpecialNeedsChild: false,
      childCount: 2,
      minorChildren: [
        { name: 'Tom Smith', dob: '2010-01-01', isMinor: true },
        { name: 'Sarah Smith', dob: '2005-06-15', isMinor: true },
      ],
      adultChildren: [],
      propertyCount: 1,
      propertiesForTrust: [{ address: '123 Main St', estimatedValue: 500000, transferToTrust: true }],
      estimatedTotalAssets: 1250000,
      primaryTrustName: 'The Smith Family Trust',
      todayFormatted: 'March 11, 2026',
      todayISO: '2026-03-11',
      packageType: 'fortress',
      packageLabel: 'Fortress',
    },
    notes: [],
    existingDocuments: [],
    knowledgeResources: [],
  };
}

/**
 * Build an incomplete mock context (missing fiduciaries and spouse).
 */
function mockIncompleteContext(): ClientContext {
  const ctx = mockCompleteContext();
  ctx.client.fiduciaries = {};
  ctx.client.spouseInfo = undefined;
  ctx.computed.spouseFullName = '';
  ctx.computed.hasSpouse = false;
  return ctx;
}

// ============================================================================
// SECTION: extractTemplateVariables — Simple variables
// ============================================================================

describe('extractTemplateVariables — simple variables', () => {
  it('extracts a simple variable', () => {
    const result = extractTemplateVariables('Hello {{clientFullName}}!');
    expect(result).toContain('clientFullName');
  });

  it('extracts multiple unique variables', () => {
    const result = extractTemplateVariables(
      '{{personalInfo.firstName}} {{personalInfo.lastName}} lives in {{personalInfo.city}}'
    );
    expect(result).toEqual(
      expect.arrayContaining(['personalInfo.firstName', 'personalInfo.lastName', 'personalInfo.city'])
    );
    expect(result).toHaveLength(3);
  });

  it('deduplicates repeated variables', () => {
    const result = extractTemplateVariables(
      '{{clientFullName}} and {{clientFullName}} again'
    );
    expect(result.filter((v) => v === 'clientFullName')).toHaveLength(1);
  });

  it('returns sorted results', () => {
    const result = extractTemplateVariables('{{z}} {{a}} {{m}}');
    expect(result).toEqual(['a', 'm', 'z']);
  });
});

// ============================================================================
// SECTION: extractTemplateVariables — Helper arguments
// ============================================================================

describe('extractTemplateVariables — helper arguments', () => {
  it('extracts argument from fullName helper', () => {
    const result = extractTemplateVariables('{{fullName fiduciaries.powerOfAttorney.agent}}');
    expect(result).toContain('fiduciaries.powerOfAttorney.agent');
    expect(result).not.toContain('fullName'); // helper, not a variable
  });

  it('extracts argument from formatDate helper', () => {
    const result = extractTemplateVariables('Born on {{formatDate personalInfo.dob}}');
    expect(result).toContain('personalInfo.dob');
    expect(result).not.toContain('formatDate');
  });

  it('extracts argument from fillOrBlank helper', () => {
    const result = extractTemplateVariables('{{fillOrBlank fiduciaries.powerOfAttorney.agent.address}}');
    expect(result).toContain('fiduciaries.powerOfAttorney.agent.address');
    expect(result).not.toContain('fillOrBlank');
  });

  it('extracts argument from upper helper', () => {
    const result = extractTemplateVariables('COUNTY OF {{upper personalInfo.county}}');
    expect(result).toContain('personalInfo.county');
    expect(result).not.toContain('upper');
  });
});

// ============================================================================
// SECTION: extractTemplateVariables — Block helpers
// ============================================================================

describe('extractTemplateVariables — block helpers', () => {
  it('extracts variable from {{#if var}}', () => {
    const result = extractTemplateVariables(
      '{{#if fiduciaries.powerOfAttorney.giftingPower}}Section content{{/if}}'
    );
    expect(result).toContain('fiduciaries.powerOfAttorney.giftingPower');
  });

  it('extracts variable from {{#each arr}}', () => {
    const result = extractTemplateVariables('{{#each children}}{{this.name}}{{/each}}');
    expect(result).toContain('children');
  });

  it('ignores closing tags ({{/if}}, {{/each}})', () => {
    const result = extractTemplateVariables('{{#if hasSpouse}}content{{/if}}');
    expect(result).not.toContain('if');
    expect(result).toContain('hasSpouse');
  });
});

// ============================================================================
// SECTION: extractTemplateVariables — Nested sub-expressions
// ============================================================================

describe('extractTemplateVariables — nested sub-expressions', () => {
  it('extracts variables from (eq a \'literal\')', () => {
    const result = extractTemplateVariables(
      "{{#if (eq fiduciaries.powerOfAttorney.effectiveDate 'immediate')}}immediate{{/if}}"
    );
    expect(result).toContain('fiduciaries.powerOfAttorney.effectiveDate');
    expect(result).not.toContain("'immediate'");
  });

  it('does not extract string literals', () => {
    const result = extractTemplateVariables("{{#if (eq status 'active')}}yes{{/if}}");
    expect(result).toContain('status');
    expect(result).not.toContain("'active'");
  });
});

// ============================================================================
// SECTION: extractTemplateVariables — Comments and edge cases
// ============================================================================

describe('extractTemplateVariables — comments and edge cases', () => {
  it('ignores block comments {{!-- ... --}}', () => {
    const result = extractTemplateVariables('{{!-- This is a comment --}}{{clientFullName}}');
    expect(result).toEqual(['clientFullName']);
  });

  it('ignores line comments {{! ... }}', () => {
    const result = extractTemplateVariables('{{! comment }}{{personalInfo.firstName}}');
    expect(result).toEqual(['personalInfo.firstName']);
  });

  it('returns empty array for template with no variables', () => {
    const result = extractTemplateVariables('<h1>Static Content</h1>');
    expect(result).toEqual([]);
  });

  it('handles template with only comments', () => {
    const result = extractTemplateVariables('{{!-- comment --}}{{! another comment }}');
    expect(result).toEqual([]);
  });
});

// ============================================================================
// SECTION: Real template extraction (poa-simple.hbs)
// ============================================================================

describe('extractTemplateVariables — poa-simple.hbs', () => {
  let poaSimpleVars: string[];

  beforeAll(() => {
    const templatePath = path.resolve(__dirname, '../../functions/src/templates/poa-simple.hbs');
    const content = fs.readFileSync(templatePath, 'utf-8');
    poaSimpleVars = extractTemplateVariables(content);
  });

  it('extracts clientFullName', () => {
    expect(poaSimpleVars).toContain('clientFullName');
  });

  it('extracts personalInfo address fields', () => {
    expect(poaSimpleVars).toContain('personalInfo.address');
    expect(poaSimpleVars).toContain('personalInfo.city');
    expect(poaSimpleVars).toContain('personalInfo.county');
    expect(poaSimpleVars).toContain('personalInfo.zip');
  });

  it('extracts POA agent variable (passed to fullName helper)', () => {
    expect(poaSimpleVars).toContain('fiduciaries.powerOfAttorney.agent');
  });

  it('extracts POA alternate agent variable', () => {
    expect(poaSimpleVars).toContain('fiduciaries.powerOfAttorney.alternateAgent');
  });

  it('extracts gifting power variable', () => {
    expect(poaSimpleVars).toContain('fiduciaries.powerOfAttorney.giftingPower');
  });

  it('extracts effective date variable', () => {
    expect(poaSimpleVars).toContain('fiduciaries.powerOfAttorney.effectiveDate');
  });

  it('extracts limitations variable', () => {
    expect(poaSimpleVars).toContain('fiduciaries.powerOfAttorney.limitations');
  });

  it('does not extract known helpers as variables', () => {
    expect(poaSimpleVars).not.toContain('fullName');
    expect(poaSimpleVars).not.toContain('upper');
    expect(poaSimpleVars).not.toContain('if');
    expect(poaSimpleVars).not.toContain('eq');
  });
});

// ============================================================================
// SECTION: Real template extraction (poa-comprehensive.hbs)
// ============================================================================

describe('extractTemplateVariables — poa-comprehensive.hbs', () => {
  let poaCompVars: string[];

  beforeAll(() => {
    const templatePath = path.resolve(__dirname, '../../functions/src/templates/poa-comprehensive.hbs');
    const content = fs.readFileSync(templatePath, 'utf-8');
    poaCompVars = extractTemplateVariables(content);
  });

  it('extracts all variables that poa-simple has plus more', () => {
    expect(poaCompVars).toContain('clientFullName');
    expect(poaCompVars).toContain('personalInfo.dob');
    expect(poaCompVars).toContain('fiduciaries.powerOfAttorney.agent.relationship');
    expect(poaCompVars).toContain('fiduciaries.powerOfAttorney.selfDealingPower');
  });

  it('extracts fillOrBlank helper arguments (agent address fields)', () => {
    expect(poaCompVars).toContain('fiduciaries.powerOfAttorney.agent.address');
    expect(poaCompVars).toContain('fiduciaries.powerOfAttorney.agent.city');
    expect(poaCompVars).toContain('fiduciaries.powerOfAttorney.agent.state');
    expect(poaCompVars).toContain('fiduciaries.powerOfAttorney.agent.zip');
  });

  it('extracts alternate agent relationship', () => {
    expect(poaCompVars).toContain('fiduciaries.powerOfAttorney.alternateAgent.relationship');
  });

  it('extracts successor agent and its relationship', () => {
    expect(poaCompVars).toContain('fiduciaries.powerOfAttorney.successorAgent');
    expect(poaCompVars).toContain('fiduciaries.powerOfAttorney.successorAgent.relationship');
  });
});

// ============================================================================
// SECTION: VARIABLE_TO_QUESTIONNAIRE_MAP
// ============================================================================

describe('VARIABLE_TO_QUESTIONNAIRE_MAP', () => {
  it('is a non-empty record', () => {
    expect(Object.keys(VARIABLE_TO_QUESTIONNAIRE_MAP).length).toBeGreaterThan(50);
  });

  it('maps clientFullName to computed section', () => {
    const mapping = VARIABLE_TO_QUESTIONNAIRE_MAP['clientFullName'];
    expect(mapping).toBeDefined();
    expect(mapping.section).toBe('computed');
    expect(mapping.label).toContain('Client Full Name');
  });

  it('maps personalInfo.firstName to About You section', () => {
    const mapping = VARIABLE_TO_QUESTIONNAIRE_MAP['personalInfo.firstName'];
    expect(mapping).toBeDefined();
    expect(mapping.section).toBe('About You');
    expect(mapping.label).toBe('First Name');
  });

  it('maps fiduciaries.powerOfAttorney.agent to Fiduciaries section', () => {
    const mapping = VARIABLE_TO_QUESTIONNAIRE_MAP['fiduciaries.powerOfAttorney.agent'];
    expect(mapping).toBeDefined();
    expect(mapping.section).toBe('Fiduciaries');
  });

  it('every mapping has required fields', () => {
    for (const [key, mapping] of Object.entries(VARIABLE_TO_QUESTIONNAIRE_MAP)) {
      expect(mapping.variable).toBe(key);
      expect(mapping.section).toBeDefined();
      expect(mapping.label).toBeDefined();
      expect(mapping.fieldPath).toBeDefined();
    }
  });

  it('covers all variables from poa-simple.hbs', () => {
    const templatePath = path.resolve(__dirname, '../../functions/src/templates/poa-simple.hbs');
    const content = fs.readFileSync(templatePath, 'utf-8');
    const vars = extractTemplateVariables(content);

    for (const v of vars) {
      // Walk up the path hierarchy to find any parent mapping
      const parts = v.split('.');
      let hasMapping = VARIABLE_TO_QUESTIONNAIRE_MAP[v] !== undefined;
      for (let i = parts.length - 1; i >= 1 && !hasMapping; i--) {
        const parentPath = parts.slice(0, i).join('.');
        hasMapping = VARIABLE_TO_QUESTIONNAIRE_MAP[parentPath] !== undefined;
      }
      expect(hasMapping).toBe(true);
    }
  });
});

// ============================================================================
// SECTION: validateTemplateData
// ============================================================================

describe('validateTemplateData', () => {
  it('returns valid=true for complete context matching variables', () => {
    const ctx = mockCompleteContext();
    const vars = ['clientFullName', 'personalInfo.firstName', 'personalInfo.city'];
    const result = validateTemplateData(vars, ctx);

    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.available).toHaveLength(3);
  });

  it('reports missing variables when context lacks data', () => {
    const ctx = mockIncompleteContext();
    const vars = [
      'clientFullName',
      'fiduciaries.powerOfAttorney.agent',
      'spouseInfo.firstName',
    ];
    const result = validateTemplateData(vars, ctx);

    expect(result.valid).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
    // fiduciaries.powerOfAttorney.agent should be missing
    expect(result.missing.some((m) => m.variable === 'fiduciaries.powerOfAttorney.agent')).toBe(true);
  });

  it('reports available with correct values', () => {
    const ctx = mockCompleteContext();
    const vars = ['personalInfo.firstName'];
    const result = validateTemplateData(vars, ctx);

    expect(result.available).toHaveLength(1);
    expect(result.available[0].value).toBe('John');
  });

  it('treats empty strings as missing', () => {
    const ctx = mockCompleteContext();
    ctx.client.personalInfo.firstName = '';
    const vars = ['personalInfo.firstName'];
    const result = validateTemplateData(vars, ctx);

    expect(result.valid).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].variable).toBe('personalInfo.firstName');
  });

  it('treats null as missing', () => {
    const ctx = mockCompleteContext();
    ctx.client.personalInfo.firstName = null;
    const vars = ['personalInfo.firstName'];
    const result = validateTemplateData(vars, ctx);

    expect(result.valid).toBe(false);
    expect(result.missing).toHaveLength(1);
  });

  it('handles unknown variables gracefully', () => {
    const ctx = mockCompleteContext();
    const vars = ['nonExistent.field'];
    const result = validateTemplateData(vars, ctx);

    expect(result.valid).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0].section).toBe('unknown');
  });

  it('validates poa-simple.hbs variables against complete context', () => {
    const templatePath = path.resolve(__dirname, '../../functions/src/templates/poa-simple.hbs');
    const content = fs.readFileSync(templatePath, 'utf-8');
    const vars = extractTemplateVariables(content);
    const ctx = mockCompleteContext();

    const result = validateTemplateData(vars, ctx);
    // Complete context should satisfy most or all POA variables
    // Some may be missing due to empty limitations, etc.
    expect(result.available.length).toBeGreaterThan(result.missing.length);
  });
});

// ============================================================================
// SECTION: buildTemplateData
// ============================================================================

describe('buildTemplateData', () => {
  it('flattens all key questionnaire sections', () => {
    const ctx = mockCompleteContext();
    const data = buildTemplateData(ctx);

    expect(data.personalInfo).toBeDefined();
    expect(data.personalInfo.firstName).toBe('John');
    expect(data.spouseInfo).toBeDefined();
    expect(data.children).toHaveLength(2);
    expect(data.assets).toBeDefined();
    expect(data.fiduciaries).toBeDefined();
    expect(data.distribution).toBeDefined();
    expect(data.healthcarePreferences).toBeDefined();
  });

  it('includes computed fields', () => {
    const ctx = mockCompleteContext();
    const data = buildTemplateData(ctx);

    expect(data.clientFullName).toBe('John M Smith');
    expect(data.hasSpouse).toBe(true);
    expect(data.hasMinorChildren).toBe(true);
    expect(data.childCount).toBe(2);
    expect(data.todayFormatted).toBeDefined();
  });

  it('includes questionnaire-only fields', () => {
    const ctx = mockCompleteContext();
    const data = buildTemplateData(ctx);

    expect(data.hasChildren).toBe(true);
    expect(data.guardianPrimary).toBeDefined();
    expect(data.guardianAlternate).toBeDefined();
    expect(data.distributionPlan).toBe('Equal distribution to all children');
    expect(data.burialPreference).toBe('Cremation');
  });

  it('includes firm data fields', () => {
    const ctx = mockCompleteContext();
    const data = buildTemplateData(ctx);

    expect(data.firmName).toBe('Elias Counsel LLC');
    expect(data.firmAddress).toBeDefined();
    expect(data.firmPhone).toBeDefined();
    expect(data.barNumber).toBe('012345');
  });
});
