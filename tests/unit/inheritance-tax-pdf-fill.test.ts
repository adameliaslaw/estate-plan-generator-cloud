/**
 * The IT-R PDF mapping, checked by filling the State's own booklet and reading the values back
 * out of the produced file.
 *
 * Reading back matters: the field names in NJ's PDF are auto-generated ("undefined_13"), so the
 * only way to know a figure landed in the right box is to open the result and look. These
 * assertions ride on the FND-INTEREST Example 2 gold case — the State's own worked example, tax
 * $68,389.70 and interest $558.71 — so a passing run means the official figures reached the
 * official form.
 *
 * `fillITRPdf` throws if any mapped field name is absent from the blank, so a successful fill is
 * itself the proof that all ~70 constants still match the booklet. If NJ reissues the form, this
 * test fails loudly rather than producing a return with silently empty boxes.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, test } from 'vitest';
import { computeEstate } from '../../functions/src/inheritance-tax/engine';
import { buildITRFormData } from '../../functions/src/inheritance-tax/forms';
import { fillITRPdf } from '../../functions/src/inheritance-tax/forms/it-r-pdf';
import { getRuleSet } from '../../functions/src/inheritance-tax/rules';
import type { EstateComputation, Matter, ReviewCheckpoint } from '../../functions/src/inheritance-tax/types';

const BLANK = readFileSync(resolve(__dirname, '../../functions/assets/itr-blank.pdf'));

/**
 * FND-INTEREST Example 2 from it-rinst.pdf: a single Class D bequest of $455,931.33.
 * 15% → $68,389.70 tax, and $558.71 interest on the late balance.
 */
const MATTER: Matter = {
  matterId: 'pdf-fill-matter',
  createdAt: '2024-01-01T00:00:00.000Z',
  decedent: {
    lastName: 'Gold', firstName: 'Ada', ssn: '999-00-1234',
    dateOfDeath: '2023-09-18', countyOfResidence: 'Mercer',
  },
  willExists: true,
  trustExists: false,
  federalReturnFiled: true,
  virtualCurrencyExists: false,
  disclaimersExist: false,
  personalRepresentative: {
    name: 'Executor Gold', title: 'Executor',
    address: '1 Main St, Trenton, NJ 08600', phone: '609-555-0000',
  },
  beneficiaries: [{
    id: 'b1', lastName: 'Friend', firstName: 'Fran', address: '2 Elm St, NJ',
    relationship: 'friend',
    bequests: [{ id: 'q1', type: 'other_personal_property', description: 'Cash', fairMarketValue: 455_931.33 }],
  }],
  deductions: [],
  paymentDate: '2024-07-20',
  priorPayments: [
    { id: 'p1', amount: 16_974.56, paidOn: '2024-05-12' },
    { id: 'p2', amount: 31_927.02, paidOn: '2024-06-12' },
  ],
};

function approved(computation: EstateComputation): ReviewCheckpoint {
  return {
    checkpointId: 'cp-pdf', matterId: MATTER.matterId,
    requestedAt: '2024-08-01T00:00:00.000Z', requestedBy: 'NJ-BAR-1',
    computationSnapshot: computation, status: 'approved',
    reviewedAt: '2024-08-02T00:00:00.000Z', reviewedBy: 'NJ-BAR-2', notes: 'approved',
  };
}

async function fillAndRead(): Promise<(name: string) => string | undefined> {
  const computation = computeEstate(MATTER, getRuleSet('2023-09-18'));
  const formData = buildITRFormData(MATTER, approved(computation));
  const filled = await fillITRPdf(formData, new Uint8Array(BLANK));
  const form = (await PDFDocument.load(filled)).getForm();
  return (name: string) => form.getTextField(name).getText();
}

describe('IT-R official-form fill', () => {
  test('every mapped field still exists in the State booklet', async () => {
    // fillITRPdf collects missing names and throws with the list, so this is the mapping check.
    await expect(fillAndRead()).resolves.toBeTypeOf('function');
  });

  test('the decedent block lands in the right boxes on both pages', async () => {
    const read = await fillAndRead();
    expect(read('Decedents Name')).toBe('Gold, Ada');
    expect(read('Decedents Name_2')).toBe('Gold, Ada');
    // SSN is three boxes: 3 / 2 / 4.
    expect([read('Decedents SS No'), read('undefined'), read('undefined_2')]).toEqual(['999', '00', '1234']);
    // Date of death is mm / dd / yyyy.
    expect([read('Date of Death mmddyyyy'), read('undefined_3'), read('undefined_4')]).toEqual(['09', '18', '2023']);
    expect(read('NJ County of Residence')).toBe('Mercer');
  });

  test("line 17 carries the State's $68,389.70, dollars and cents in their own boxes", async () => {
    const read = await fillAndRead();
    expect(read('17')).toBe('68,389');
    expect(read('016aa46tefg16aa46tefg0_22aa2aau65t')).toBe('70');
  });

  test('line 18 carries the official $558.71 interest', async () => {
    const read = await fillAndRead();
    expect(read('18')).toBe('558');
    expect(read('0_20_22aa2aau65t0_2216aa46tefgaa2aau65t')).toBe('71');
  });

  test('the Class D row reports one beneficiary and the taxed distribution', async () => {
    const read = await fillAndRead();
    expect(read('4_2')).toBe('1');                       // 13. D — Total Beneficiaries
    expect(read('undefined_20')).toBe('455,931.33');     //          Total Distribution
    expect(read('013')).toBe('68,389');                  //          Tax Calculation, dollars
  });

  test('an exempt class that received nothing still reads zero rather than blank', async () => {
    const read = await fillAndRead();
    expect(read('1')).toBe('0');                         // 10. A - Spouse — no spouse in this estate
    expect(read('undefined_13')).toBe('0.00');
  });

  test('the representative address splits into street/city/state/zip', async () => {
    const read = await fillAndRead();
    expect(read('Street 1')).toBe('1 Main St');
    expect(read('City')).toBe('Trenton');
    expect(read('State')).toBe('NJ');
    expect(read('ZIP Code')).toBe('08600');
    expect(read('Daytime Phone')).toBe('609');
    expect(read('undefined_5')).toBe('555-0000');
  });

  test('an address that does not parse cleanly goes in Street 1 whole, never guessed apart', async () => {
    // The representative is read from the FROZEN snapshot (FND-IMMUT, IT-R-SPECIFICATION §10),
    // so the odd address has to be present at compute time — editing the matter afterwards is
    // exactly what that rule refuses to honour.
    const oddMatter: Matter = {
      ...MATTER,
      personalRepresentative: { ...MATTER.personalRepresentative, address: 'c/o The Firm — no fixed address' },
    };
    const computation = computeEstate(oddMatter, getRuleSet('2023-09-18'));
    const formData = buildITRFormData(oddMatter, approved(computation));
    const filled = await fillITRPdf(formData, new Uint8Array(BLANK));
    const form = (await PDFDocument.load(filled)).getForm();
    expect(form.getTextField('Street 1').getText()).toBe('c/o The Firm — no fixed address');
    // pdf-lib reports an empty text field as undefined rather than ''.
    expect(form.getTextField('City').getText()).toBeFalsy();
    expect(form.getTextField('State').getText()).toBeFalsy();
  });

  test('the schedule-page header fills all twelve pages from one write', async () => {
    const read = await fillAndRead();
    expect(read('Decedents Name_4')).toBe('Gold, Ada');
    expect(read('Date of Death')).toBe('09/18/2023');
  });
});

describe('Schedule E — beneficiaries', () => {
  test('lists the beneficiary with their relationship, class and dollar amount', async () => {
    const read = await fillAndRead();
    expect(read('Name_4')).toBe('Fran Friend');
    expect(read('B Relationship to DecedentName Address')).toBe('friend');
    expect(read('C Tax ClassName Address@@$#@@@$#@')).toBe('455,931.33');
  });

  test('the tax-class dropdown is set to the engine’s class, not typed as free text', async () => {
    const computation = computeEstate(MATTER, getRuleSet('2023-09-18'));
    const formData = buildITRFormData(MATTER, approved(computation));
    const filled = await fillITRPdf(formData, new Uint8Array(BLANK));
    const form = (await PDFDocument.load(filled)).getForm();
    // A friend is Class D under N.J.S.A. 54:34-2; the form offers only " ", A, C, D, E.
    expect(form.getDropdown('Select 1').getSelected()).toEqual(['D']);
  });

  test('splits the address across the two printed lines', async () => {
    const read = await fillAndRead();
    // The fixture's beneficiary address is free text, so it lands on line 1 whole.
    expect(read('Address 1_2')).toBe('2 Elm St, NJ');
  });

  test('uses structured parts for the address when intake captured them', async () => {
    const withParts: Matter = {
      ...MATTER,
      beneficiaries: [{
        ...MATTER.beneficiaries[0]!,
        address: '2 Elm St, Newark, NJ 07102',
        addressParts: { street1: '2 Elm St', street2: 'Apt 5', city: 'Newark', state: 'NJ', zip: '07102' },
      }],
    };
    const computation = computeEstate(withParts, getRuleSet('2023-09-18'));
    const formData = buildITRFormData(withParts, approved(computation));
    const filled = await fillITRPdf(formData, new Uint8Array(BLANK));
    const form = (await PDFDocument.load(filled)).getForm();
    expect(form.getTextField('Address 1_2').getText()).toBe('2 Elm St, Apt 5');
    expect(form.getTextField('Address 2_2').getText()).toBe('Newark, NJ 07102');
  });

  test('more beneficiaries than the page holds sets "additional copies attached"', async () => {
    // Ten beneficiaries against nine rows: the tenth must not vanish silently.
    const many: Matter = {
      ...MATTER,
      beneficiaries: Array.from({ length: 10 }, (_, i) => ({
        id: `b${i}`, lastName: `Friend${i}`, firstName: 'Fran', address: '2 Elm St, NJ',
        relationship: 'friend' as const,
        bequests: [{ id: `q${i}`, type: 'other_personal_property' as const, description: 'Cash', fairMarketValue: 10_000 }],
      })),
    };
    const computation = computeEstate(many, getRuleSet('2023-09-18'));
    const formData = buildITRFormData(many, approved(computation));
    const filled = await fillITRPdf(formData, new Uint8Array(BLANK));
    const form = (await PDFDocument.load(filled)).getForm();
    expect(form.getCheckBox('Check if additional copies of the schedule are attached_11').isChecked()).toBe(true);
    expect(form.getTextField('Name_12').getText()).toBe('Fran Friend8'); // the ninth row is the last
  });

  test('nine or fewer beneficiaries leaves the overflow box alone', async () => {
    const computation = computeEstate(MATTER, getRuleSet('2023-09-18'));
    const formData = buildITRFormData(MATTER, approved(computation));
    const filled = await fillITRPdf(formData, new Uint8Array(BLANK));
    const form = (await PDFDocument.load(filled)).getForm();
    expect(form.getCheckBox('Check if additional copies of the schedule are attached_11').isChecked()).toBe(false);
  });
});

describe('Schedule B-4 — all other property', () => {
  test('each item lands as description, date-of-death value and equity', async () => {
    const read = await fillAndRead();
    expect(read('1113424 Date of Death ValueRow1_2')).toBe('Cash');
    expect(read('B Date of Death ValueRow1_2')).toBe('455,931.33');
    expect(read('C Decedents EquityRow1')).toBe('455,931.33');
  });
});

describe('Schedules B1–B4 Recap', () => {
  test('the B-4 total reaches the recap and the empty schedules read zero, not blank', async () => {
    const read = await fillAndRead();
    // Rows 1 and 2 have near-identical names; row 1 is the B-1 accounts line despite its name.
    expect(read('2 Schedule B2 Sto111ckCoops_2')).toBe('0.00');                    // 1. B-1 accounts
    expect(read('2 Schedule B2 StockCoops_2')).toBe('0.00');                       // 2. B-2 stock
    expect(read('3 Schedule B3 Municipal and Corporate Bonds_2')).toBe('0.00');    // 3. B-3 bonds
    expect(read('4 Schedule B4 All Other Property_2')).toBe('455,931.33');         // 4. B-4 other
  });

  test('an account goes on row 1 and stock on row 2, despite the names saying otherwise', async () => {
    // `2 Schedule B2 Sto111ckCoops_2` is the B-1 row. Distinct amounts, so a swap cannot pass.
    const mixed: Matter = {
      ...MATTER,
      beneficiaries: [{
        ...MATTER.beneficiaries[0]!,
        bequests: [
          { id: 'q1', type: 'bank_account', description: 'Checking', fairMarketValue: 11_000 },
          { id: 'q2', type: 'securities', description: 'Shares', fairMarketValue: 22_000 },
          { id: 'q3', type: 'bonds', description: 'Municipal bonds', fairMarketValue: 33_000 },
        ],
      }],
    };
    const computation = computeEstate(mixed, getRuleSet('2023-09-18'));
    const formData = buildITRFormData(mixed, approved(computation));
    const filled = await fillITRPdf(formData, new Uint8Array(BLANK));
    const form = (await PDFDocument.load(filled)).getForm();
    expect(form.getTextField('2 Schedule B2 Sto111ckCoops_2').getText()).toBe('11,000.00');
    expect(form.getTextField('2 Schedule B2 StockCoops_2').getText()).toBe('22,000.00');
    expect(form.getTextField('3 Schedule B3 Municipal and Corporate Bonds_2').getText()).toBe('33,000.00');
    expect(form.getTextField('4 Schedule B4 All Other Property_2').getText()).toBe('0.00');
    expect(
      form.getTextField('5 Total Lines 14 Enter here and on Form ITR Summary Page line 3').getText(),
    ).toBe('66,000.00');
  });

  test('line 5 of the recap is the same figure the Summary Page prints on line 3', async () => {
    const read = await fillAndRead();
    expect(read('5 Total Lines 14 Enter here and on Form ITR Summary Page line 3')).toBe('455,931.33');
    // Summary Page line 3, dollars and cents in their own boxes.
    expect(read('3')).toBe('455,931');
    expect(read('00_22aa2aau65t!!@')).toBe('33');
  });
});

describe('Schedules A and B — real property and closely held businesses', () => {
  const PROPERTY: Matter = {
    ...MATTER,
    beneficiaries: [{
      ...MATTER.beneficiaries[0]!,
      bequests: [
        {
          id: 'q1', type: 'nj_real_property', description: 'The house', fairMarketValue: 300_000,
          realPropertyDetails: {
            county: 'Mercer', fractionalInterest: '50%', streetAddress: '12 Oak St, Unit 2',
            lots: '14', block: '3.02', municipality: 'Hamilton',
            ownersAndTitle: 'Ada Gold and Fran Friend, joint tenants',
            hasMortgageLien: true, taxAssessedValue: 480_000, fullMarketValue: 600_000,
          },
        },
        {
          id: 'q2', type: 'closely_held_business', description: 'The shop', fairMarketValue: 120_000,
          businessDetails: {
            businessName: 'Gold Hardware LLC', federalEIN: '22-3456789',
            businessType: 'Retail hardware', isFamilyLimitedPartnership: false,
            ownershipPercentage: '40%', numberOfShares: 400, entireBusinessValue: 300_000,
          },
        },
      ],
    }],
  };

  async function fillProperty() {
    const computation = computeEstate(PROPERTY, getRuleSet('2023-09-18'));
    const formData = buildITRFormData(PROPERTY, approved(computation));
    const filled = await fillITRPdf(formData, new Uint8Array(BLANK));
    return (await PDFDocument.load(filled)).getForm();
  }

  test('every line of the Schedule A block is filled, lot and block included', async () => {
    const form = await fillProperty();
    const read = (n: string) => form.getTextField(n).getText();
    expect(read('New Jersey County')).toBe('Mercer');
    expect(read('Street address with number unit')).toBe('12 Oak St, Unit 2');
    expect(read('Lots')).toBe('14');
    expect(read('Block')).toBe('3.02');
    expect(read('Municipality')).toBe('Hamilton');
    expect(read('Fractional or percent interest')).toBe('50%');
    expect(read('Owners namesProperty Title')).toBe('Ada Gold and Fran Friend, joint tenants');
    expect(form.getCheckBox('Check if there is a mortgage lien against this').isChecked()).toBe(true);
  });

  test('a sole owner prints "100%", not a bare 100 — the instruction is about the notation', async () => {
    // "If decedent was sole owner, enter 100%" (IT-R Instructions, Schedule A column A). A bare
    // number on the schedule that generates the tax waiver leaves the reader to supply the unit.
    const sole: Matter = {
      ...PROPERTY,
      beneficiaries: [{
        ...PROPERTY.beneficiaries[0]!,
        bequests: [{
          ...PROPERTY.beneficiaries[0]!.bequests[0]!,
          realPropertyDetails: {
            ...PROPERTY.beneficiaries[0]!.bequests[0]!.realPropertyDetails!,
            fractionalInterest: '100',
          },
        }],
      }],
    };
    const computation = computeEstate(sole, getRuleSet('2023-09-18'));
    const formData = buildITRFormData(sole, approved(computation));
    const filled = await fillITRPdf(formData, new Uint8Array(BLANK));
    const form = (await PDFDocument.load(filled)).getForm();
    expect(form.getTextField('Fractional or percent interest').getText()).toBe('100%');
  });

  test("a fraction the attorney wrote is passed through untouched", async () => {
    // The instruction offers "one-half, one-third" and "50%, 33%" as equally correct. Only a
    // bare number is ambiguous, so only a bare number is changed.
    const half: Matter = {
      ...PROPERTY,
      beneficiaries: [{
        ...PROPERTY.beneficiaries[0]!,
        bequests: [{
          ...PROPERTY.beneficiaries[0]!.bequests[0]!,
          realPropertyDetails: {
            ...PROPERTY.beneficiaries[0]!.bequests[0]!.realPropertyDetails!,
            fractionalInterest: '1/2',
          },
        }],
      }],
    };
    const computation = computeEstate(half, getRuleSet('2023-09-18'));
    const formData = buildITRFormData(half, approved(computation));
    const filled = await fillITRPdf(formData, new Uint8Array(BLANK));
    const form = (await PDFDocument.load(filled)).getForm();
    expect(form.getTextField('Fractional or percent interest').getText()).toBe('1/2');
  });

  test("column (D) is the decedent's interest and feeds Summary Page line 1", async () => {
    const form = await fillProperty();
    const read = (n: string) => form.getTextField(n).getText();
    // (B) and (C) describe the whole property; (D) is what the estate reported.
    expect(read('B Tax Assessed Value for year of death for entire property1 New Jersey County Fractional or percent interest Street address with number unit Lots Block Municipality Owners namesProperty Title Check if there is a mortgage lien against this property reported on Schedule D')).toBe('480,000.00');
    expect(read('D Value of Decedents Interest Not including mortgage balances1 New Jersey County Fractional or percent interest Street address with number unit Lots Block Municipality Owners namesProperty Title Check if there is a mortgage lien against this property reported on Schedule D')).toBe('300,000.00');
    // Summary Page line 1 — its dollars box is named '2aa', not '1' (that is a row count).
    expect(read('2aa')).toBe('300,000');
  });

  test('Schedule B carries the business block and answers the FLP question', async () => {
    const form = await fillProperty();
    expect(form.getTextField('Business name').getText()).toBe('Gold Hardware LLC');
    expect(form.getTextField('Federal EIN').getText()).toBe('22-3456789');
    expect(form.getTextField('Decedents percentage of ownership').getText()).toBe('40%');
    expect(form.getTextField('Number of shares held if applicable').getText()).toBe('400');
    expect(form.getTextField(
      'Total of all closely held businesses Enter here and on Form ITR Summary Page line 2',
    ).getText()).toBe('120,000.00');
    // The first block's No option is the State's own `Choice234`, not `2`.
    expect(form.getRadioGroup(
      '4222qdIf Yes submit a copy of the stamped disclaimer that was filed with the Surrogates Court or as approved by',
    ).getSelected()).toBe('Choice234');
  });

  test('an unanswered FLP question leaves both boxes alone', async () => {
    const unstated: Matter = {
      ...MATTER,
      beneficiaries: [{
        ...MATTER.beneficiaries[0]!,
        bequests: [{
          id: 'q1', type: 'closely_held_business', description: 'The shop', fairMarketValue: 1_000,
          businessDetails: { businessName: 'Gold Hardware LLC' },
        }],
      }],
    };
    const computation = computeEstate(unstated, getRuleSet('2023-09-18'));
    const formData = buildITRFormData(unstated, approved(computation));
    const filled = await fillITRPdf(formData, new Uint8Array(BLANK));
    const form = (await PDFDocument.load(filled)).getForm();
    expect(form.getRadioGroup(
      '4222qdIf Yes submit a copy of the stamped disclaimer that was filed with the Surrogates Court or as approved by',
    ).getSelected()).toBeUndefined();
  });

  test('a property with no captured detail still prints its description and its value', async () => {
    const legacy: Matter = {
      ...MATTER,
      beneficiaries: [{
        ...MATTER.beneficiaries[0]!,
        bequests: [{ id: 'q1', type: 'nj_real_property', description: '12 Oak St', fairMarketValue: 250_000 }],
      }],
    };
    const computation = computeEstate(legacy, getRuleSet('2023-09-18'));
    const formData = buildITRFormData(legacy, approved(computation));
    const filled = await fillITRPdf(formData, new Uint8Array(BLANK));
    const form = (await PDFDocument.load(filled)).getForm();
    expect(form.getTextField('Street address with number unit').getText()).toBe('12 Oak St');
    expect(form.getTextField('New Jersey County').getText()).toBeFalsy();
    expect(form.getTextField('2aa').getText()).toBe('250,000');
  });

  test('a fourth property overflows to the additional-schedules total, never dropped', async () => {
    const many: Matter = {
      ...MATTER,
      beneficiaries: [{
        ...MATTER.beneficiaries[0]!,
        bequests: Array.from({ length: 4 }, (_, i) => ({
          id: `p${i}`, type: 'nj_real_property' as const,
          description: `Property ${i}`, fairMarketValue: 100_000,
        })),
      }],
    };
    const computation = computeEstate(many, getRuleSet('2023-09-18'));
    const formData = buildITRFormData(many, approved(computation));
    const filled = await fillITRPdf(formData, new Uint8Array(BLANK));
    const form = (await PDFDocument.load(filled)).getForm();
    expect(form.getTextField(
      'D Value of Decedents Interest Not including mortgage balancesTotal of all additional schedules if none enter zero',
    ).getText()).toBe('100,000.00');
    expect(form.getCheckBox('Check if additional copies of the schedule are attached').isChecked()).toBe(true);
    expect(form.getTextField('2aa').getText()).toBe('400,000');
  });
});

describe('Schedules B-1, B-2, B-3 and C — the itemisation behind lines 3 and 4', () => {
  const DETAILED: Matter = {
    ...MATTER,
    beneficiaries: [{
      ...MATTER.beneficiaries[0]!,
      bequests: [
        {
          id: 'q1', type: 'bank_account', description: 'Checking', fairMarketValue: 11_000,
          accountDetails: {
            institutionName: 'First Bank', accountNumberLast4: '4821',
            registeredOwners: 'Ada Gold and Fran Friend',
          },
        },
        {
          id: 'q2', type: 'securities', description: '200 shares', fairMarketValue: 22_000,
          securityDetails: {
            corporationName: 'Acme Corp', tickerSymbol: 'ACME', isNJCorporation: true,
            numberOfShares: 200, perShareValue: 110,
          },
        },
        {
          id: 'q3', type: 'securities', description: 'Co-op shares', fairMarketValue: 15_000,
          securityDetails: {
            corporationName: 'Riverside Co-op', isCoOp: true,
            registeredOwners: 'Ada Gold, 4 River Rd, Trenton NJ', numberOfShares: 50,
          },
        },
        {
          id: 'q4', type: 'bonds', description: 'Bonds', fairMarketValue: 33_000,
          bondDetails: { issuerAndTerms: 'Trenton GO 4% due 2030', registeredOwners: 'Ada Gold' },
        },
        {
          id: 'q5', type: 'transfer', description: 'Gift of car', fairMarketValue: 8_000,
          transferDetails: {
            dateOfTransfer: '2022-04-01', transfereeName: 'Nephew Ned',
            transfereeRelationship: 'nephew',
          },
        },
        {
          id: 'q6', type: 'transfer', description: 'Life estate retained', fairMarketValue: 5_000,
          transferDetails: { part: 'incomplete', transfereeName: 'Niece Nan' },
        },
        {
          id: 'q7', type: 'transfer', description: 'Annuity', fairMarketValue: 4_000,
          transferDetails: {
            part: 'pod_to_beneficiary', transfereeName: 'Fran Friend',
            issuerName: 'Prudential #55', transfereeRelationship: 'friend',
          },
        },
        {
          id: 'q8', type: 'transfer', description: 'Pension to estate', fairMarketValue: 2_000,
          transferDetails: { part: 'pod_to_estate', transfereeName: 'Estate', issuerName: 'State Pension #9' },
        },
      ],
    }],
  };

  async function fillDetailed() {
    const computation = computeEstate(DETAILED, getRuleSet('2023-09-18'));
    const formData = buildITRFormData(DETAILED, approved(computation));
    const filled = await fillITRPdf(formData, new Uint8Array(BLANK));
    return (await PDFDocument.load(filled)).getForm();
  }

  test('B-1 composes the column the State asks for, and names the account holders', async () => {
    const form = await fillDetailed();
    expect(form.getTextField('InstitutionAccount Number 2').getText()).toBe('First Bank — Acct •••• 4821');
    expect(form.getTextField('Names on account 2').getText()).toBe('Ada Gold and Fran Friend');
    expect(form.getTextField(
      'C Value of Decedents EquityTotal of all financial institution accounts Enter here and on Schedule B1B4 Recap line 1',
    ).getText()).toBe('11,000.00');
  });

  test('B-2 fills all seven stock columns and ticks the NJ box', async () => {
    const form = await fillDetailed();
    expect(form.getTextField('B Ticker SymbolRow1aaw2').getText()).toBe('Acme Corp');
    expect(form.getTextField('B Ticker SymbolRow1').getText()).toBe('ACME');
    expect(form.getCheckBox('Check if additional copies of the s11sschedule are attached_4').isChecked()).toBe(true);
    expect(form.getTextField('D Number of Shares').getText()).toBe('200');
    expect(form.getTextField('E Per Share Value on Date of Death').getText()).toBe('110.00');
    expect(form.getTextField('F Total Market Value Col D x Col E').getText()).toBe('22,000.00');
  });

  test('a co-op lists in Part II, not among the stocks', async () => {
    const form = await fillDetailed();
    expect(form.getTextField('B Ticker SymbolRow13w1aaw222454').getText()).toBe('Riverside Co-op');
    expect(form.getTextField('Name 1').getText()).toBe('Ada Gold, 4 River Rd, Trenton NJ');
    expect(form.getTextField('G Value of Decedents EquityTotal  Part I').getText()).toBe('22,000.00');
    expect(form.getTextField('E Value of Decedents EquityTotal  Part II').getText()).toBe('15,000.00');
    // Both parts still reconcile to the recap's line 2.
    expect(form.getTextField(
      'E Value of Decedents EquityTotal of all stocks Enter here and on Schedule B1B4 Recap line 2',
    ).getText()).toBe('37,000.00');
  });

  test('B-3 prints the bond and its registered owner', async () => {
    const form = await fillDetailed();
    expect(form.getTextField('B Date of Daaa22eath ValueRow1').getText())
      .toBe('Trenton GO 4% due 2030 — Ada Gold');
    expect(form.getTextField('B Date of Death ValueRow1').getText()).toBe('33,000.00');
  });

  test('Schedule C splits transfers across its three parts and answers the questions', async () => {
    const form = await fillDetailed();
    // Part I — a lifetime transfer, with the date in the form's own mm/dd/yyyy.
    expect(form.getTextField('B Describe Property Transferred See instructionsRaaa123ow1').getText()).toBe('04/01/2022');
    expect(form.getTextField('C Name of TransfereeRow1').getText()).toBe('Nephew Ned');
    expect(form.getTextField('E Market Value of Property as of Date of DeathTotal  Part I').getText()).toBe('8,000.00');
    expect(form.getTextField('E Market Value of Property as of Date of DeathTotal  Part II').getText()).toBe('5,000.00');
    // Part III — Section A names a beneficiary, Section B does not.
    expect(form.getTextField('Total  Part III Section A and Section B_2').getText()).toBe('6,000.00');
    expect(form.getTextField(
      'Total of all transfers Part I Part II Part III and totals of all additional schedules Enter here and on Form ITR Summary Page line 4',
    ).getText()).toBe('19,000.00');
    // Each printed question is answered Yes because the estate reports such a transfer.
    expect(form.getRadioGroup(
      '1 Did the decedent within 3 years of date of death transfer property valued at 500 or more without receiving full',
    ).getSelected()).toBe('Yes_9');
  });

  test('a question the estate says nothing about is left unmarked, never answered No', async () => {
    // MATTER has no transfers at all: an unmarked pair is visible on review, a wrong No is not.
    const computation = computeEstate(MATTER, getRuleSet('2023-09-18'));
    const formData = buildITRFormData(MATTER, approved(computation));
    const filled = await fillITRPdf(formData, new Uint8Array(BLANK));
    const form = (await PDFDocument.load(filled)).getForm();
    expect(form.getRadioGroup(
      '1 Did the decedent within 3 years of date of death transfer property valued at 500 or more without receiving full',
    ).getSelected()).toBeUndefined();
  });

  test('the four schedules reconcile to the Summary Page lines they feed', async () => {
    const form = await fillDetailed();
    const read = (n: string) => form.getTextField(n).getText();
    // Recap line 3 = B-1 11,000 + B-2 37,000 + B-3 33,000 + B-4 0.
    expect(read('5 Total Lines 14 Enter here and on Form ITR Summary Page line 3')).toBe('81,000.00');
    expect(read('3')).toBe('81,000');
    // Summary Page line 4 = Schedule C's total.
    expect(read('4')).toBe('19,000');
  });

  test('an item entered before the detail fields existed still prints its description', async () => {
    const legacy: Matter = {
      ...MATTER,
      beneficiaries: [{
        ...MATTER.beneficiaries[0]!,
        bequests: [{ id: 'q1', type: 'bank_account', description: 'Old checking account', fairMarketValue: 1_000 }],
      }],
    };
    const computation = computeEstate(legacy, getRuleSet('2023-09-18'));
    const formData = buildITRFormData(legacy, approved(computation));
    const filled = await fillITRPdf(formData, new Uint8Array(BLANK));
    const form = (await PDFDocument.load(filled)).getForm();
    expect(form.getTextField('InstitutionAccount Number 2').getText()).toBe('Old checking account');
    expect(form.getTextField('Names on account 2').getText()).toBeFalsy();
  });
});

describe('Schedule D — deductions', () => {
  /** A deduction of each kind that has its own printed block, plus two that do not. */
  const DEDUCTED: Matter = {
    ...MATTER,
    deductions: [
      { id: 'd1', type: 'funeral_expenses', description: 'Funeral service', amount: 9_000, payeeName: 'Hillside Funeral Home' },
      { id: 'd2', type: 'administration_expenses', description: 'Probate filing', amount: 1_200, payeeName: 'Mercer Surrogate' },
      { id: 'd3', type: 'attorney_fee', description: 'Estate counsel', amount: 7_500, payeeName: 'Elias Law' },
      { id: 'd4', type: 'accounting_fee', description: 'Final 1040', amount: 900, payeeName: 'Ledger CPA' },
      { id: 'd5', type: 'mortgage', description: 'Mortgage on 12 Oak St', amount: 40_000, payeeName: 'First Bank' },
      { id: 'd6', type: 'last_illness_expenses', description: 'Hospital', amount: 3_100, payeeName: 'Capital Health' },
      { id: 'd7', type: 'debt_of_decedent', description: 'Credit card', amount: 400 },
    ],
  };

  async function fillDeducted(): Promise<(name: string) => string | undefined> {
    const computation = computeEstate(DEDUCTED, getRuleSet('2023-09-18'));
    const formData = buildITRFormData(DEDUCTED, approved(computation));
    const filled = await fillITRPdf(formData, new Uint8Array(BLANK));
    const form = (await PDFDocument.load(filled)).getForm();
    return (name: string) => form.getTextField(name).getText();
  }

  test('each deduction lands in the block the State prints for it', async () => {
    const read = await fillDeducted();
    // Part I — the category is printed, so column (A) carries the description.
    expect(read('Funeral list additional funeral expenses')).toBe('Funeral service');
    expect(read('Names1121')).toBe('Hillside Funeral Home');
    expect(read('C AmountNames')).toBe('9,000.00');
    expect(read('Administration list additional expenses')).toBe('Probate filing');
    expect(read('C AmountNames_2')).toBe('1,200.00');
    expect(read('Names3332')).toBe('Elias Law');            // Counsel Fees
    expect(read('C AmountNames_3')).toBe('7,500.00');
    expect(read('Namesa32')).toBe('Ledger CPA');            // CPA/Enrolled Agent Fees
    expect(read('C AmountNames_4')).toBe('900.00');
    // Part II Section A — mortgages on Schedule A property.
    expect(read('1_4')).toBe('Mortgage on 12 Oak St');
    expect(read('C AmountTotal  Part I221@##')).toBe('40,000.00');
  });

  test('a type with no printed block goes to Part III, labelled by its type', async () => {
    const read = await fillDeducted();
    expect(read('B Name of BusinessPerson21#$%%$ Owed1')).toBe('Last illness expense — Hospital');
    expect(read('B Name of BusinessPerson Owed1')).toBe('Capital Health');
    expect(read('C Amount1')).toBe('3,100.00');
    expect(read('B Nam21#$%%$e of BusinessPerson Owed2')).toBe('Debt of decedent — Credit card');
    expect(read('C Amount2')).toBe('400.00');
  });

  test('the part totals add up to Line 6, and Line 6 comes from the computation', async () => {
    const read = await fillDeducted();
    expect(read('C AmountTotal  Part I')).toBe('18,600.00');                          // 9,000+1,200+7,500+900
    expect(read('Total  Part II Section21#$%%$ A and Section B_2')).toBe('40,000.00');
    expect(read('C AmountTotal  Part III')).toBe('3,500.00');                         // 3,100+400
    // "(if none, enter zero)" — written either way.
    expect(read('C AmountTotal of all additional schedules Part I Part II and Part III if none enter zero')).toBe('0.00');
    const total = 'C AmountTotal of all deductions claimed Part I Part II and Part III Enter here and on Form ITR Summary Page line 6';
    expect(read(total)).toBe('62,100.00');
    // The same figure the Summary Page prints on line 6, dollars and cents.
    expect(read('6')).toBe('62,100');
    expect(read('0_2t4gsdxv0_22aa2aau65t')).toBe('00');
  });

  test('a deduction with no payee prints a blank column, not a guess', async () => {
    const read = await fillDeducted();
    expect(read('B Name of BusinessPerson Owed2')).toBeFalsy();  // 'Credit card' has no payee
  });

  test('more administration expenses than the block holds fall through to Part III', async () => {
    // The page directs its own overflow: "Administration (list additional expenses in Part III)".
    const many: Matter = {
      ...MATTER,
      deductions: Array.from({ length: 6 }, (_, i) => ({
        id: `a${i}`, type: 'administration_expenses' as const,
        description: `Expense ${i}`, amount: 100 * (i + 1),
      })),
    };
    const computation = computeEstate(many, getRuleSet('2023-09-18'));
    const formData = buildITRFormData(many, approved(computation));
    const filled = await fillITRPdf(formData, new Uint8Array(BLANK));
    const form = (await PDFDocument.load(filled)).getForm();
    // Four slots filled, the fifth and sixth pushed to Part III rather than dropped.
    expect(form.getTextField('undefined_70').getText()).toBe('Expense 3');
    expect(form.getTextField('B Name of BusinessPerson21#$%%$ Owed1').getText())
      .toBe('Administration expense — Expense 4');
    expect(form.getTextField('C Amount1').getText()).toBe('500.00');
    expect(form.getTextField('C Amount2').getText()).toBe('600.00');
    // 100+200+300+400 in Part I, 500+600 in Part III — and the two still sum to Line 6.
    expect(form.getTextField('C AmountTotal  Part I').getText()).toBe('1,000.00');
    expect(form.getTextField('C AmountTotal  Part III').getText()).toBe('1,100.00');
  });

  test('past Part III’s 24 rows the remainder is totalled, not dropped', async () => {
    const overflowing: Matter = {
      ...MATTER,
      deductions: Array.from({ length: 26 }, (_, i) => ({
        id: `o${i}`, type: 'debt_of_decedent' as const, description: `Debt ${i}`, amount: 1_000,
      })),
    };
    const computation = computeEstate(overflowing, getRuleSet('2023-09-18'));
    const formData = buildITRFormData(overflowing, approved(computation));
    const filled = await fillITRPdf(formData, new Uint8Array(BLANK));
    const form = (await PDFDocument.load(filled)).getForm();
    expect(form.getTextField('C AmountTotal  Part III').getText()).toBe('24,000.00');
    expect(form.getTextField(
      'C AmountTotal of all additional schedules Part I Part II and Part III if none enter zero',
    ).getText()).toBe('2,000.00');
    expect(form.getCheckBox('Check if additional copies of the schedule are attached_9').isChecked()).toBe(true);
    expect(form.getCheckBox('Check if additional copies of the schedule are attached_10').isChecked()).toBe(true);
    expect(form.getTextField(
      'C AmountTotal of all deductions claimed Part I Part II and Part III Enter here and on Form ITR Summary Page line 6',
    ).getText()).toBe('26,000.00');
  });

  test('an estate with no deductions still reports zeros across the schedule', async () => {
    const read = await fillAndRead();
    expect(read('C AmountTotal  Part I')).toBe('0.00');
    expect(read('C AmountTotal  Part III')).toBe('0.00');
    expect(read(
      'C AmountTotal of all deductions claimed Part I Part II and Part III Enter here and on Form ITR Summary Page line 6',
    )).toBe('0.00');
  });
});

describe('Form IT-PMT — payment voucher', () => {
  test('carries the decedent block, with the two-digit year this page asks for', async () => {
    const read = await fillAndRead();
    expect(read('Decedents Name_3')).toBe('Gold, Ada');
    expect([read('Decedents SS No_3'), read('undefined_31'), read('undefined_30')]).toEqual(['999', '00', '1234']);
    // "(mm/dd/yy)" here, against "(mm/dd/yyyy)" on the cover page.
    expect([read('Date of Death mmddyy'), read('undefined_32'), read('undefined_33')]).toEqual(['09', '18', '23']);
    expect(read('County of Residence')).toBe('Mercer');
  });

  test('the amount remitted is line 21, the balance due — not line 19', async () => {
    const read = await fillAndRead();
    // $68,389.70 tax + $558.71 interest − $48,901.58 already paid.
    expect(read('19')).toBe('68,948');       // line 19, total amount due
    expect(read('21')).toBe('20,046');       // line 21, balance due
    expect(read('016aa46tefg0_22aa2aau65t')).toBe('83');
    expect(read('undefined_35')).toBe('20,046.83');
    expect(read('Street')).toBe('1 Main St');
  });

  test('an estate with nothing left to remit leaves the amount and address blank', async () => {
    // The voucher's own instruction: "Do not include address if you are not submitting a payment."
    const overpaid: Matter = {
      ...MATTER,
      priorPayments: [{ id: 'p1', amount: 100_000, paidOn: '2024-05-12' }],
    };
    const computation = computeEstate(overpaid, getRuleSet('2023-09-18'));
    const formData = buildITRFormData(overpaid, approved(computation));
    const filled = await fillITRPdf(formData, new Uint8Array(BLANK));
    const form = (await PDFDocument.load(filled)).getForm();
    // pdf-lib reports an empty text field as undefined rather than ''.
    expect(form.getTextField('undefined_35').getText()).toBeFalsy();
    expect(form.getTextField('Street').getText()).toBeFalsy();
    // The decedent block is still filled — the voucher is part of the booklet either way.
    expect(form.getTextField('Decedents Name_3').getText()).toBe('Gold, Ada');
  });
});
