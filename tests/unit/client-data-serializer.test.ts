/**
 * tests/unit/client-data-serializer.test.ts
 *
 * Unit tests for the canonical client data serializer.
 * Verifies consistent formatting of client data across all doc types.
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock firebase-admin before importing the module under test
// ---------------------------------------------------------------------------
vi.mock('firebase-admin', () => ({
  firestore: Object.assign(() => ({}), {
    DocumentData: {},
  }),
  initializeApp: vi.fn(),
}));

vi.mock('../../functions/src/generate-documents', () => ({}));

import {
  serializeClientData,
  formatFullName,
} from '../../functions/src/client-data-serializer';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function fullClient() {
  return {
    personalInfo: {
      firstName: 'John',
      middleName: 'Michael',
      lastName: 'Smith',
      suffix: 'Jr.',
      dob: '1975-06-15',
      address: '123 Main Street',
      city: 'Princeton',
      state: 'NJ',
      zip: '08540',
      county: 'Mercer',
      maritalStatus: 'Married',
      citizenship: 'US Citizen',
      occupation: 'Software Engineer',
      employer: 'Acme Corp',
      phone: '609-555-1234',
      email: 'john@example.com',
    },
    spouseInfo: {
      firstName: 'Jane',
      middleName: 'Ann',
      lastName: 'Smith',
      dob: '1978-03-20',
      phone: '609-555-5678',
      email: 'jane@example.com',
    },
    children: [
      { name: 'Tom Smith', dob: '2010-01-01', isMinor: true, specialNeeds: false },
      { name: 'Sarah Smith', dob: '2005-06-15', isMinor: true, specialNeeds: false },
      { name: 'Mike Smith', dob: '1998-04-10', isMinor: false, specialNeeds: false },
    ],
    fiduciaries: {
      executor: {
        primary: { firstName: 'Jane', lastName: 'Smith', relationship: 'Spouse' },
        alternate: { firstName: 'Robert', lastName: 'Smith', relationship: 'Brother' },
      },
      trustee: {
        primary: { firstName: 'Jane', lastName: 'Smith', relationship: 'Spouse' },
        alternate: { firstName: 'Robert', lastName: 'Smith', relationship: 'Brother' },
      },
      powerOfAttorney: {
        agent: { firstName: 'Jane', lastName: 'Smith', relationship: 'Spouse', address: '123 Main Street', city: 'Princeton', state: 'NJ', zip: '08540' },
        alternateAgent: { firstName: 'Robert', lastName: 'Smith', relationship: 'Brother' },
        effectiveDate: 'immediate',
        giftingPower: true,
        selfDealingPower: false,
      },
      healthcareProxy: {
        primary: { firstName: 'Jane', lastName: 'Smith', relationship: 'Spouse' },
        alternate: { firstName: 'Robert', lastName: 'Smith', relationship: 'Brother' },
      },
      guardian: {
        primary: { name: 'Robert Smith', relationship: 'Brother' },
        alternate: { name: 'Mary Jones', relationship: 'Sister' },
      },
    },
    assets: {
      realEstate: [
        { address: '123 Main Street', city: 'Princeton', estimatedValue: 500000, transferToTrust: true },
      ],
      bankAccounts: [
        { accountName: 'Checking', institution: 'Chase', estimatedBalance: 50000 },
      ],
      retirementAccounts: [
        { accountName: '401k', estimatedValue: 200000 },
      ],
      lifeInsurance: [
        { policyName: 'Term Life', faceValue: 500000 },
      ],
      investmentAccounts: [],
      businessInterests: [],
      personalProperty: [],
    },
    distribution: {
      trustName: 'The Smith Family Trust',
      pourOverToTrust: true,
      noContestClause: true,
      spendthriftProvision: true,
      survivorshipPeriod: 30,
    },
    trusts: [
      { trustName: 'The Smith Family Trust', trustType: 'Revocable Living Trust' },
    ],
    healthcarePreferences: {
      lifeSustaining: 'No',
      artificialNutrition: 'No',
      organDonation: 'Yes',
    },
    burialPreference: 'Cremation',
    burialDetails: 'Scatter at sea',
    specialConsiderations: {},
    packageDetails: { packageType: 'fortress' },
    hasChildren: true,
    isFemale: false,
  };
}

function singleClient() {
  const c = fullClient();
  c.personalInfo.maritalStatus = 'Single';
  c.spouseInfo = undefined;
  c.children = [];
  c.hasChildren = false;
  return c;
}

function firmData() {
  return {
    firmName: 'Elias Counsel LLC',
    firmAddress: '100 Legal Dr, Newark, NJ 07102',
    firmPhone: '973-555-0000',
    firmEmail: 'info@eliascounsel.com',
    firmWebsite: 'https://eliascounsel.com',
    barNumber: '012345',
  };
}

// ===========================================================================
// formatFullName
// ===========================================================================

describe('formatFullName', () => {
  it('builds full name from parts', () => {
    expect(formatFullName({ firstName: 'John', middleName: 'M', lastName: 'Smith' })).toBe('John M Smith');
  });

  it('includes suffix when present', () => {
    expect(formatFullName({ firstName: 'John', lastName: 'Smith', suffix: 'Jr.' })).toBe('John Smith Jr.');
  });

  it('handles missing middle name', () => {
    expect(formatFullName({ firstName: 'John', lastName: 'Smith' })).toBe('John Smith');
  });

  it('handles {name: "..."} format', () => {
    expect(formatFullName({ name: 'Robert Smith' })).toBe('Robert Smith');
  });

  it('returns empty string for null', () => {
    expect(formatFullName(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatFullName(undefined)).toBe('');
  });
});

// ===========================================================================
// serializeClientData — determinism
// ===========================================================================

describe('serializeClientData — determinism', () => {
  it('produces identical output for same input', () => {
    const client = fullClient();
    const firm = firmData();

    const result1 = serializeClientData(client, firm, 'will');
    const result2 = serializeClientData(client, firm, 'will');

    expect(result1.text).toBe(result2.text);
    expect(result1.clientFullName).toBe(result2.clientFullName);
  });

  it('produces identical output across different doc types for shared sections', () => {
    const client = fullClient();
    const firm = firmData();

    const willResult = serializeClientData(client, firm, 'will');
    const poaResult = serializeClientData(client, firm, 'poa');

    // Client section should be identical in both
    const willClientBlock = willResult.text.split('\n\n')[0];
    const poaClientBlock = poaResult.text.split('\n\n')[0];
    expect(willClientBlock).toBe(poaClientBlock);
  });
});

// ===========================================================================
// serializeClientData — content correctness
// ===========================================================================

describe('serializeClientData — content correctness', () => {
  it('includes canonical client full name', () => {
    const result = serializeClientData(fullClient(), firmData(), 'will');
    expect(result.clientFullName).toBe('John Michael Smith Jr.');
    expect(result.text).toContain('John Michael Smith Jr.');
  });

  it('includes spouse name when married', () => {
    const result = serializeClientData(fullClient(), firmData(), 'will');
    expect(result.spouseFullName).toBe('Jane Ann Smith');
    expect(result.hasSpouse).toBe(true);
    expect(result.text).toContain('SPOUSE:');
    expect(result.text).toContain('Jane Ann Smith');
  });

  it('shows no spouse for single client', () => {
    const result = serializeClientData(singleClient(), firmData(), 'will');
    expect(result.hasSpouse).toBe(false);
    expect(result.spouseFullName).toBe('');
    expect(result.text).toContain('SPOUSE: None');
  });

  it('lists children with minor/adult flags', () => {
    const result = serializeClientData(fullClient(), firmData(), 'will');
    expect(result.childCount).toBe(3);
    expect(result.hasMinorChildren).toBe(true);
    expect(result.text).toContain('Tom Smith');
    expect(result.text).toContain('minor');
    expect(result.text).toContain('Mike Smith');
    expect(result.text).toMatch(/Mike Smith.*adult/);
  });

  it('includes fiduciaries section', () => {
    const result = serializeClientData(fullClient(), firmData(), 'will');
    expect(result.text).toContain('FIDUCIARIES:');
    expect(result.text).toContain('Executor (Primary): Jane Smith');
    expect(result.text).toContain('POA Agent (Primary): Jane Smith');
    expect(result.text).toContain('Healthcare Proxy (Primary): Jane Smith');
  });

  it('includes assets for asset-relevant doc types', () => {
    const willResult = serializeClientData(fullClient(), firmData(), 'will');
    expect(willResult.text).toContain('ASSETS:');
    expect(willResult.text).toContain('123 Main Street');
    expect(willResult.text).toContain('500,000');
  });

  it('excludes assets for non-asset doc types (poa)', () => {
    const poaResult = serializeClientData(fullClient(), firmData(), 'poa');
    expect(poaResult.text).not.toContain('ASSETS:');
  });

  it('includes distribution plan for relevant doc types', () => {
    const result = serializeClientData(fullClient(), firmData(), 'will');
    expect(result.text).toContain('DISTRIBUTION PLAN:');
    expect(result.text).toContain('No-contest clause: Yes');
    expect(result.text).toContain('Spendthrift provision: Yes');
  });

  it('includes trust info for trust-related doc types', () => {
    const result = serializeClientData(fullClient(), firmData(), 'trust');
    expect(result.text).toContain('TRUST INFORMATION:');
    expect(result.text).toContain('The Smith Family Trust');
  });

  it('includes healthcare preferences for living will', () => {
    const result = serializeClientData(fullClient(), firmData(), 'livingWill');
    expect(result.text).toContain('HEALTHCARE PREFERENCES:');
    expect(result.text).toContain('Life-sustaining treatment: No');
    expect(result.text).toContain('Cremation');
  });

  it('includes firm data', () => {
    const result = serializeClientData(fullClient(), firmData(), 'will');
    expect(result.text).toContain('FIRM:');
    expect(result.text).toContain('Elias Counsel LLC');
    expect(result.text).toContain('012345');
  });

  it('includes special provisions section', () => {
    const result = serializeClientData(fullClient(), firmData(), 'will');
    expect(result.text).toContain('SPECIAL PROVISIONS:');
  });

  it('flags special needs children', () => {
    const c = fullClient();
    c.children[0].specialNeeds = true;
    const result = serializeClientData(c, firmData(), 'will');
    expect(result.hasSpecialNeedsChild).toBe(true);
    expect(result.text).toContain('[SPECIAL NEEDS]');
  });
});

// ===========================================================================
// serializeClientData — edge cases
// ===========================================================================

describe('serializeClientData — edge cases', () => {
  it('handles missing fiduciaries gracefully', () => {
    const c = fullClient();
    c.fiduciaries = {};
    const result = serializeClientData(c, firmData(), 'will');
    expect(result.text).toContain('FIDUCIARIES:');
    expect(result.text).toContain('Not designated');
  });

  it('handles empty assets gracefully', () => {
    const c = fullClient();
    c.assets = {};
    const result = serializeClientData(c, firmData(), 'will');
    expect(result.text).toContain('ASSETS:');
    expect(result.text).toContain('None specified');
  });

  it('handles null personalInfo fields', () => {
    const c = fullClient();
    c.personalInfo.county = null;
    c.personalInfo.dob = null;
    const result = serializeClientData(c, firmData(), 'will');
    expect(result.text).toContain('County: Not provided');
    expect(result.text).toContain('Date of birth: Not provided');
  });

  it('handles completely minimal client data', () => {
    const minimal = {
      personalInfo: { firstName: 'Test', lastName: 'User' },
    };
    // Should not throw
    const result = serializeClientData(minimal, firmData(), 'will');
    expect(result.clientFullName).toBe('Test User');
    expect(result.text).toContain('Test User');
    expect(result.childCount).toBe(0);
  });
});
