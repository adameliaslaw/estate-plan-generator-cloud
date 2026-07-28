/**
 * The L-9 PDF mapping, checked by filling the State's own blank and reading the values back out
 * of the produced file.
 *
 * The L-9 releases the inheritance-tax lien on real property, so the parcel identification is
 * the part that has to be right: a waiver naming the wrong lot and block releases the wrong
 * land. Every parcel assertion here reads the box out of the produced PDF.
 *
 * The form is also date-split — the State prints an L-9(A) for deaths before 2018-01-01 — and
 * the wrong-form refusal is asserted, because filing the right figures on the wrong paper is a
 * worse failure than not producing a form at all.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, test } from 'vitest';
import { computeEstate } from '../../functions/src/inheritance-tax/engine';
import { buildL9AFormData } from '../../functions/src/inheritance-tax/forms';
import { UNFILLED_FIELDS, fillL9Pdf } from '../../functions/src/inheritance-tax/forms/l9-pdf';
import { getRuleSet } from '../../functions/src/inheritance-tax/rules';
import type {
  Bequest, EstateComputation, Matter, ReviewCheckpoint,
} from '../../functions/src/inheritance-tax/types';

const BLANK = readFileSync(resolve(__dirname, '../../functions/assets/itl9.pdf'));

/** A parcel with every Schedule A column intake can capture. */
const FULL_PARCEL: Bequest = {
  id: 'q1', type: 'nj_real_property', description: '12 Oak St', fairMarketValue: 300_000,
  realPropertyDetails: {
    county: 'Mercer', streetAddress: '12 Oak Street', lots: '4.02', block: '117',
    municipality: 'Ewing Township', ownersAndTitle: 'Ada Gold, sole owner',
  },
};

function makeMatter(overrides: Partial<Matter> = {}, bequests: Bequest[] = [FULL_PARCEL]): Matter {
  return {
    matterId: 'l9-matter',
    createdAt: '2024-01-01T00:00:00.000Z',
    decedent: {
      lastName: 'Gold', firstName: 'Ada', middleName: 'B', ssn: '999-00-1234',
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
      id: 'b1', lastName: 'Gold', firstName: 'Cass', address: '1 Main St, Trenton, NJ 08600',
      relationship: 'child', bequests,
    }],
    deductions: [],
    ...overrides,
  };
}

function approvedFor(matter: Matter): ReviewCheckpoint {
  const computation = computeEstate(matter, getRuleSet(matter.decedent.dateOfDeath));
  return {
    checkpointId: 'cp-l9', matterId: matter.matterId,
    requestedAt: '2024-08-01T00:00:00.000Z', requestedBy: 'NJ-BAR-1',
    computationSnapshot: computation as EstateComputation, status: 'approved',
    reviewedAt: '2024-08-02T00:00:00.000Z', reviewedBy: 'NJ-BAR-2', notes: 'approved',
  };
}

async function fillAndReopen(matter: Matter) {
  const data = buildL9AFormData(matter, approvedFor(matter));
  const bytes = await fillL9Pdf(data, new Uint8Array(BLANK));
  const form = (await PDFDocument.load(bytes)).getForm();
  return {
    text: (name: string) => form.getTextField(name).getText() ?? '',
    checked: (name: string) => form.getCheckBox(name).isChecked(),
  };
}

describe('L-9 — the real property tax waiver, filled', () => {
  test('carries the decedent block, with the four-digit year this form asks for', async () => {
    const pdf = await fillAndReopen(makeMatter());
    expect(pdf.text('Decedents Name')).toBe('Gold');
    expect(pdf.text('First')).toBe('Ada');
    expect(pdf.text('Middle')).toBe('B');
    expect(pdf.text('Decedents SSN')).toBe('999');
    expect(pdf.text('undefined_3')).toBe('00');
    expect(pdf.text('undefined')).toBe('1234');
    // Printed "(mm/dd/yyyy)" — unlike the IT-EXT, which prints "(mm/dd/yy)".
    expect(pdf.text('Date of Death mmddyyyy')).toBe('09');
    expect(pdf.text('undefined_4')).toBe('18');
    expect(pdf.text('undefined_2')).toBe('2023');
    expect(pdf.text('County of Residence')).toBe('Mercer');
  });

  test('ticks Testate or Intestate, never both', async () => {
    const testate = await fillAndReopen(makeMatter({ willExists: true }));
    expect(testate.checked('Check Box1')).toBe(true);
    expect(testate.checked('Check Box11')).toBe(false);

    const intestate = await fillAndReopen(makeMatter({ willExists: false }));
    expect(intestate.checked('Check Box1')).toBe(false);
    expect(intestate.checked('Check Box11')).toBe(true);
  });

  test('the parcel prints its own lot, block and municipality — not the description', async () => {
    const pdf = await fillAndReopen(makeMatter());
    expect(pdf.text('County')).toBe('Mercer');
    expect(pdf.text('Street and Number')).toBe('12 Oak Street');
    expect(pdf.text('Street and Number1121')).toBe('4.02');       // Lot
    expect(pdf.text('Street and Numberaad21')).toBe('117');       // Block
    expect(pdf.text('Municipality')).toBe('Ewing Township');
    expect(pdf.text('Owners of Record if decedent owned a fractional interest state how held and fractional value thereof'))
      .toBe('Ada Gold, sole owner');
  });

  test('three parcels fill three distinct blocks, in order', async () => {
    const parcels: Bequest[] = ['A', 'B', 'C'].map((tag, i) => ({
      id: `q${i}`, type: 'nj_real_property', description: `${tag} St`, fairMarketValue: 100_000,
      realPropertyDetails: { county: 'Mercer', lots: `lot-${tag}`, block: `blk-${tag}` },
    }));
    const pdf = await fillAndReopen(makeMatter({}, parcels));
    // A swap between blocks would release the lien on the wrong parcel, so each is distinct.
    expect(pdf.text('Street and Number1121')).toBe('lot-A');
    expect(pdf.text('Street and Number1121ccc')).toBe('lot-B');
    expect(pdf.text('Street and Number1121ggg')).toBe('lot-C');
    expect(pdf.text('Street and Numberaad21')).toBe('blk-A');
    expect(pdf.text('Street and Numberaad21ccc')).toBe('blk-B');
    expect(pdf.text('Street and Numberaad21ggg')).toBe('blk-C');
  });

  test('a parcel entered before the detail fields existed still identifies itself', async () => {
    const bare: Bequest = {
      id: 'q1', type: 'nj_real_property', description: '12 Oak St, Ewing', fairMarketValue: 300_000,
    };
    const pdf = await fillAndReopen(makeMatter({}, [bare]));
    // The street line falls back to the description so the parcel is named; lot and block stay
    // blank rather than being invented.
    expect(pdf.text('Street and Number')).toBe('12 Oak St, Ewing');
    expect(pdf.text('Street and Number1121')).toBe('');
    expect(pdf.text('Street and Numberaad21')).toBe('');
  });

  test('carries the beneficiaries with their relationship and interest', async () => {
    const pdf = await fillAndReopen(makeMatter());
    expect(pdf.text('Beneficiaries State full names of all who have an interest in the estate vested contingent operation of law transfer etcRow1'))
      .toBe('Cass Gold');
    expect(pdf.text('Relationship to DecedentRow1')).toBe('child');
    expect(pdf.text('Interest of Beneficiary in the Estate percentage or specificRow1')).toBe('300,000.00');
  });

  test('names the deponent and ticks the office they hold', async () => {
    const executor = await fillAndReopen(makeMatter());
    expect(executor.text('Deponents name')).toBe('Executor Gold');
    expect(executor.text('Address')).toBe('1 Main St, Trenton, NJ 08600');
    expect(executor.checked('Ex')).toBe(true);
    expect(executor.checked('Admi1')).toBe(false);

    const admin = await fillAndReopen(makeMatter({
      personalRepresentative: {
        name: 'Admin Gold', title: 'Administrator',
        address: '1 Main St, Trenton, NJ 08600', phone: '609-555-0000',
      },
    }));
    expect(admin.checked('Admi1')).toBe(true);
    expect(admin.checked('Ex')).toBe(false);
  });

  test('an heir-at-law is none of the three printed offices, so none is ticked', async () => {
    const pdf = await fillAndReopen(makeMatter({
      personalRepresentative: {
        name: 'Heir Gold', title: 'Heir-at-law',
        address: '1 Main St, Trenton, NJ 08600', phone: '609-555-0000',
      },
    }));
    // An unticked box says nothing. A wrong tick swears something untrue.
    expect(pdf.checked('Ex')).toBe(false);
    expect(pdf.checked('Admi1')).toBe(false);
    expect(pdf.checked('JYT1')).toBe(false);
  });

  test('leaves the notarial block and the predeceased schedule blank, on purpose', async () => {
    const pdf = await fillAndReopen(makeMatter());
    // Each name exists in the blank — these reads would throw otherwise — so this asserts a
    // decision, not an absence. The estate record has no predeceased-beneficiary concept, and
    // "none" is not ours to swear to.
    for (const name of Object.values(UNFILLED_FIELDS)) expect(pdf.text(name)).toBe('');
  });

  test('refuses a pre-2018 death rather than filing it on the wrong form', async () => {
    const matter = makeMatter({
      decedent: {
        lastName: 'Gold', firstName: 'Ada', ssn: '999-00-1234',
        dateOfDeath: '2016-03-04', countyOfResidence: 'Mercer',
      },
    });
    const data = buildL9AFormData(matter, approvedFor(matter));
    expect(data.formDesignation).toBe('L-9(A)');
    await expect(fillL9Pdf(data, new Uint8Array(BLANK)))
      .rejects.toThrow(/takes Form L-9\(A\), not Form L-9/);
  });

  test('refuses to drop a fourth parcel the form has no room for', async () => {
    const parcels: Bequest[] = ['A', 'B', 'C', 'D'].map((tag, i) => ({
      id: `q${i}`, type: 'nj_real_property', description: `${tag} St`, fairMarketValue: 100_000,
      realPropertyDetails: { county: 'Mercer' },
    }));
    const matter = makeMatter({}, parcels);
    await expect(fillL9Pdf(buildL9AFormData(matter, approvedFor(matter)), new Uint8Array(BLANK)))
      .rejects.toThrow(/prints 3 parcel blocks and this estate has 4/);
  });
});
