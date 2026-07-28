/**
 * The filled forms are legible, not merely populated.
 *
 * Every other PDF test in this suite reads a field's *value* back out of the produced file. That
 * proves the mapping, but not that anyone can see it: an AcroForm field carries its value in the
 * document and its rendered look in a separate appearance stream, and a filled field with no
 * appearance stream is blank on the page and blank on paper. A filed return nobody can read is
 * the same failure as a return with the wrong number in it.
 *
 * So this reads the appearance streams themselves — the drawing instructions a reader executes —
 * and asserts the text-showing operators contain the value.
 *
 * (`page.getTextContent()` will NOT do: it reads the page's own content stream, and a widget's
 * appearance is a separate stream referenced from the annotation. Filled forms look empty
 * through that lens whether or not anything is wrong.)
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { inflateSync } from 'zlib';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, test } from 'vitest';
import { computeEstate } from '../../functions/src/inheritance-tax/engine';
import { buildITEXTFormData, buildL9AFormData } from '../../functions/src/inheritance-tax/forms';
import { fillITEXTPdf } from '../../functions/src/inheritance-tax/forms/it-ext-pdf';
import { fillL9Pdf } from '../../functions/src/inheritance-tax/forms/l9-pdf';
import { getRuleSet } from '../../functions/src/inheritance-tax/rules';
import type {
  EstateComputation, Matter, ReviewCheckpoint,
} from '../../functions/src/inheritance-tax/types';

const MATTER: Matter = {
  matterId: 'visible-check',
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
    relationship: 'child',
    bequests: [{
      id: 'q1', type: 'nj_real_property', description: '12 Oak St', fairMarketValue: 300_000,
      realPropertyDetails: {
        county: 'Mercer', streetAddress: '12 Oak Street', lots: '4.02', block: '117',
        municipality: 'Ewing Township', ownersAndTitle: 'Ada Gold, sole owner',
      },
    }],
  }],
  deductions: [],
  itExtension: { firstExtension: true },
};

const APPROVED: ReviewCheckpoint = {
  checkpointId: 'cp-visible', matterId: MATTER.matterId,
  requestedAt: '2024-08-01T00:00:00.000Z', requestedBy: 'NJ-BAR-1',
  computationSnapshot: computeEstate(
    MATTER, getRuleSet(MATTER.decedent.dateOfDeath),
  ) as EstateComputation,
  status: 'approved', reviewedAt: '2024-08-02T00:00:00.000Z', reviewedBy: 'NJ-BAR-2',
  notes: 'approved',
};

const blank = (file: string) =>
  new Uint8Array(readFileSync(resolve(__dirname, '../../functions/assets', file)));

/** `<48656C6C6F> Tj` and `(Hello) Tj` — the two ways a stream can show text. */
function textShownBy(stream: string): string {
  const shown: string[] = [];
  for (const [, hex] of stream.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
    shown.push(Buffer.from(hex.replace(/\s/g, ''), 'hex').toString('latin1'));
  }
  for (const [, literal] of stream.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
    shown.push(literal.replace(/\\([()\\])/g, '$1'));
  }
  return shown.join('\n');
}

/**
 * Everything every widget in the document actually draws. A field whose value never reached an
 * appearance stream contributes nothing here — which is exactly the failure this file catches.
 */
async function drawnText(bytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(bytes);
  const drawn: string[] = [];
  for (const field of pdf.getForm().getFields()) {
    for (const widget of field.acroField.getWidgets()) {
      const normal = widget.getAppearances()?.normal;
      const contents = normal && 'getContents' in normal ? normal.getContents() : undefined;
      if (!contents) continue;
      const buffer = Buffer.from(contents);
      // Appearance streams are Flate-compressed as saved; older ones may not be.
      let decoded: string;
      try {
        decoded = inflateSync(buffer).toString('latin1');
      } catch {
        decoded = buffer.toString('latin1');
      }
      drawn.push(textShownBy(decoded));
    }
  }
  return drawn.join('\n');
}

describe('the filled companion forms are legible on the page', () => {
  test('IT-EXT draws the decedent, the representative and the months requested', async () => {
    const data = buildITEXTFormData(MATTER, APPROVED);
    const text = await drawnText(await fillITEXTPdf(data, blank('itext.pdf')));
    for (const value of ['Gold, Ada, B', '999-00-1234', 'Mercer', 'Executor Gold', '555-0000']) {
      expect(text, `"${value}" is not drawn on the page`).toContain(value);
    }
  });

  test('L-9 draws the parcel a reader has to check — lot, block and municipality', async () => {
    const data = buildL9AFormData(MATTER, APPROVED);
    const text = await drawnText(await fillL9Pdf(data, blank('itl9.pdf')));
    // The waiver releases a lien on land. If these are invisible, the wrong parcel gets released
    // by a form that looked complete on screen.
    for (const value of ['4.02', '117', 'Ewing Township', '12 Oak Street', 'Executor Gold']) {
      expect(text, `"${value}" is not drawn on the page`).toContain(value);
    }
  });
});
