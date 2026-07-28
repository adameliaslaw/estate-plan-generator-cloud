/**
 * The IT-EXT PDF mapping, checked by filling the State's own blank and reading the values back
 * out of the produced file.
 *
 * Reading back is the whole point: `fillITEXTPdf` throws if a mapped name is absent, so a
 * successful fill proves the constants still match the blank — but only reading the boxes proves
 * a value reached the *right* one. Both matter here, because the Testate/Intestate pair is a
 * radio group the State built with duplicate export values, and the only way to know which
 * widget came on is to look.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, test } from 'vitest';
import { computeEstate } from '../../functions/src/inheritance-tax/engine';
import { buildITEXTFormData } from '../../functions/src/inheritance-tax/forms';
import {
  CORRESPONDENCE_FIELDS, SIGNATURE_FIELDS, fillITEXTPdf,
} from '../../functions/src/inheritance-tax/forms/it-ext-pdf';
import { getRuleSet } from '../../functions/src/inheritance-tax/rules';
import type {
  EstateComputation, ITExtension, Matter, ReviewCheckpoint,
} from '../../functions/src/inheritance-tax/types';

const BLANK = readFileSync(resolve(__dirname, '../../functions/assets/itext.pdf'));

function makeMatter(overrides: Partial<Matter> = {}): Matter {
  return {
    matterId: 'itext-matter',
    createdAt: '2024-01-01T00:00:00.000Z',
    decedent: {
      lastName: 'Gold', firstName: 'Ada', middleName: 'Beatrice', ssn: '999-00-1234',
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
      relationship: 'child',
      bequests: [{ id: 'q1', type: 'bank_account', description: 'Checking', fairMarketValue: 300_000 }],
    }],
    deductions: [],
    itExtension: { firstExtension: true },
    ...overrides,
  };
}

function approvedFor(matter: Matter): ReviewCheckpoint {
  const computation = computeEstate(matter, getRuleSet(matter.decedent.dateOfDeath));
  return {
    checkpointId: 'cp-itext', matterId: matter.matterId,
    requestedAt: '2024-08-01T00:00:00.000Z', requestedBy: 'NJ-BAR-1',
    computationSnapshot: computation as EstateComputation, status: 'approved',
    reviewedAt: '2024-08-02T00:00:00.000Z', reviewedBy: 'NJ-BAR-2', notes: 'approved',
  };
}

/** Fill and reopen, so every assertion reads the produced file rather than our own intent. */
async function fillAndReopen(matter: Matter) {
  const data = buildITEXTFormData(matter, approvedFor(matter));
  const bytes = await fillITEXTPdf(data, new Uint8Array(BLANK));
  const form = (await PDFDocument.load(bytes)).getForm();
  return {
    text: (name: string) => form.getTextField(name).getText() ?? '',
    /** Which widget of the Testate/Intestate pair is on — the export values cannot tell us. */
    radioOn: (name: string) => form.getRadioGroup(name).acroField.getWidgets()
      .findIndex((widget) => String(widget.dict.get(PDFName.of('AS'))) !== '/Off'),
  };
}

describe('IT-EXT — the State\'s own extension application, filled', () => {
  test('carries the decedent block, with the two-digit year the box asks for', async () => {
    const pdf = await fillAndReopen(makeMatter());
    expect(pdf.text('DecName_1')).toBe('Gold, Ada, Beatrice');
    expect(pdf.text('DecSS_No')).toBe('999-00-1234');
    // Printed "(mm/dd/yy)" — a four-digit year overflows the box on the paper form.
    expect(pdf.text('DOD1')).toBe('09');
    expect(pdf.text('DOD2')).toBe('18');
    expect(pdf.text('DOD3')).toBe('23');
    expect(pdf.text('CountyofRes')).toBe('Mercer');
  });

  test('carries the representative, with the area code in its own box', async () => {
    const pdf = await fillAndReopen(makeMatter());
    expect(pdf.text('Name')).toBe('Executor Gold');
    expect(pdf.text('Street')).toBe('1 Main St, Trenton, NJ 08600');
    expect(pdf.text('Text1')).toBe('609');
    expect(pdf.text('DaytimePhone')).toBe('555-0000');
  });

  test('marks Testate when there is a will, and Intestate when there is not', async () => {
    // Both widgets export "Yes", so this asserts WHICH widget came on, not the field's value.
    expect((await fillAndReopen(makeMatter({ willExists: true }))).radioOn('TestateNo')).toBe(0);
    expect((await fillAndReopen(makeMatter({ willExists: false }))).radioOn('TestateNo')).toBe(1);
  });

  test('requests 4 months on the first extension and 6 once the second is elected', async () => {
    const first = await fillAndReopen(makeMatter());
    expect(first.text('ExtReq')).toBe('4');

    const both: ITExtension = { firstExtension: true, secondExtension: true };
    const second = await fillAndReopen(makeMatter({ itExtension: both }));
    // N.J.A.C. 18:26-9.1(b): the second extension is +2, so 6 in total — not another 4.
    expect(second.text('ExtReq')).toBe('6');
  });

  test('leaves the correspondence block and the signature blank, on purpose', async () => {
    const pdf = await fillAndReopen(makeMatter());
    // Where the State's notices should go is a choice the estate record does not contain, and
    // a signature is the attorney's. Every one of these names exists in the blank — the reads
    // below would throw otherwise — so this asserts a decision, not an absence.
    for (const name of Object.values(CORRESPONDENCE_FIELDS)) expect(pdf.text(name)).toBe('');
    for (const name of Object.values(SIGNATURE_FIELDS)) expect(pdf.text(name)).toBe('');
    // Likewise the representative's SSN: the data model holds none for a personal representative.
    expect(pdf.text('SSNo_3')).toBe('');
  });

  test('refuses a matter with no recorded extension, rather than filing a blank application', async () => {
    const matter = makeMatter({ itExtension: undefined });
    await expect(fillAndReopen(matter)).rejects.toThrow(/no filing extension is recorded/);
  });

  test('a mapping that drifts from the blank throws with the field named', async () => {
    // The guarantee the whole file rests on: if NJ reissues IT-EXT, this fails loudly instead
    // of producing an application with empty boxes.
    const stripped = await PDFDocument.load(new Uint8Array(BLANK));
    stripped.getForm().getTextField('CountyofRes').acroField.dict.delete(PDFName.of('T'));
    const data = buildITEXTFormData(makeMatter(), approvedFor(makeMatter()));
    await expect(fillITEXTPdf(data, await stripped.save()))
      .rejects.toThrow(/IT-EXT PDF mapping is out of step/);
  });
});
