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
