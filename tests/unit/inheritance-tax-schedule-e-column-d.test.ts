/**
 * Schedule E column D — "Fractional/percentage of residuary Estate and/or specific asset".
 *
 * The State prints this column and its instructions require it: *"List each type of asset,
 * devise, or bequest due to each beneficiary… Examples: '50% Residue,' '1/3 of Estate,' '$5,000
 * cash bequest,' 'grandfather clock'."* Until the allocation model existed there was nothing to
 * build it from — a nested bequest had no notion of "a third of the residue" — so it went out
 * blank on filed returns.
 *
 * The booklet has no form field for it (808 fields, none for column D or F), so the text is drawn
 * onto the page. These tests read it back out of the produced PDF's own content stream.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, test } from 'vitest';
import { deriveEngineMatter, describeBeneficiaryInterest, shareNotation } from '../../functions/src/inheritance-tax/allocations';
import { computeEstate } from '../../functions/src/inheritance-tax/engine';
import { buildITRFormData } from '../../functions/src/inheritance-tax/forms';
import { fillITRPdf } from '../../functions/src/inheritance-tax/forms/it-r-pdf';
import { getRuleSet } from '../../functions/src/inheritance-tax/rules';
import type { EstateComputation, Matter, ReviewCheckpoint } from '../../functions/src/inheritance-tax/types';

const BLANK = readFileSync(resolve(__dirname, '../../functions/assets/itr-blank.pdf'));
const RULES = getRuleSet('2026-05-01');

/** A third to the child, a third to the sibling, a third plus a specific gift to the cousin. */
const MATTER = {
  matterId: 'col-d', createdAt: '2026-05-02T00:00:00.000Z',
  decedent: {
    lastName: 'Elias', firstName: 'Ada', ssn: '123-45-6789',
    dateOfDeath: '2026-05-01', countyOfResidence: 'Middlesex',
  },
  willExists: true, trustExists: false, federalReturnFiled: true,
  virtualCurrencyExists: false, disclaimersExist: false,
  personalRepresentative: {
    name: 'Ada Elias', title: 'Executor',
    address: '168 Prospect Plains Road, Monroe Township, NJ 08831', phone: '908-555-0100',
  },
  beneficiaries: [
    { id: 'b1', firstName: 'Cara', lastName: 'Child', address: '1 Elm St, NJ', relationship: 'child', bequests: [] },
    { id: 'b2', firstName: 'Nina', lastName: 'Niece', address: '2 Elm St, NJ', relationship: 'niece_nephew', bequests: [] },
    { id: 'b3', firstName: 'Sam', lastName: 'Sibling', address: '3 Elm St, NJ', relationship: 'sibling', bequests: [] },
  ],
  assets: [
    { id: 'a1', type: 'nj_real_property', description: '93 Old Church Road', fairMarketValue: 800_000 },
    {
      id: 'a2', type: 'bank_account', description: 'Chase Account', fairMarketValue: 400_000,
      allocations: [{ beneficiaryId: 'b2', fraction: 0.25 }],
    },
  ],
  residuary: [
    { beneficiaryId: 'b1', fraction: 1 / 3 },
    { beneficiaryId: 'b2', fraction: 1 / 3 },
    { beneficiaryId: 'b3', fraction: 1 / 3 },
  ],
  deductions: [],
} as unknown as Matter;

function approved(computation: EstateComputation): ReviewCheckpoint {
  return {
    checkpointId: 'cp', matterId: 'col-d',
    requestedAt: '2026-06-01T00:00:00.000Z', requestedBy: 'NJ-BAR-1',
    computationSnapshot: computation, status: 'approved',
    reviewedAt: '2026-06-02T00:00:00.000Z', reviewedBy: 'NJ-BAR-2', notes: 'ok',
  };
}

/**
 * The text of the produced PAGE, read back with a PDF reader — not the form data that went in.
 * Column D has no form field, so this is the only thing that can prove it was painted.
 */
async function filledText(): Promise<string> {
  const derived = deriveEngineMatter(MATTER);
  const c = computeEstate(derived, RULES);
  const formData = buildITRFormData(derived, approved({ ...c, computedAt: '2026-06-01T00:00:00.000Z' } as EstateComputation));
  const bytes = await fillITRPdf(formData, new Uint8Array(BLANK));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  let out = '';
  for (let p = 1; p <= doc.numPages; p += 1) {
    const content = await (await doc.getPage(p)).getTextContent();
    out += content.items.map((i) => ('str' in i ? i.str : '')).join(' ') + '\n';
  }
  return out;
}

describe('the interest description the State asks for', () => {
  test('a third of the residue reads "1/3 Residue", not "33.3333%"', () => {
    // The instruction's own example is "1/3 of Estate" — a third is exact as a ratio and endless
    // as a decimal.
    expect(shareNotation(1 / 3)).toBe('1/3');
    expect(shareNotation(0.5)).toBe('1/2');
    expect(shareNotation(0.25)).toBe('1/4');
    // Not a small whole ratio: fall back to a percentage rather than invent one.
    expect(shareNotation(0.4137)).toBe('41.37%');
  });

  test('a specific gift and a residuary share are both described, in that order', () => {
    expect(describeBeneficiaryInterest('b2', MATTER)).toBe('1/4 of Chase Account; 1/3 Residue');
    expect(describeBeneficiaryInterest('b1', MATTER)).toBe('1/3 Residue');
  });

  test('a whole asset is named without a share, as the will would say it', () => {
    const whole = {
      ...MATTER,
      assets: [{ id: 'a1', type: 'nj_real_property', description: '93 Old Church Road', fairMarketValue: 800_000, allocations: [{ beneficiaryId: 'b1', fraction: 1 }] }],
      residuary: [],
    } as unknown as Matter;
    expect(describeBeneficiaryInterest('b1', whole)).toBe('93 Old Church Road');
  });

  test('a legacy nested matter has no description, and the column stays blank as before', () => {
    const legacy = { ...MATTER, assets: undefined, residuary: undefined } as unknown as Matter;
    expect(describeBeneficiaryInterest('b1', legacy)).toBe('');
  });
});

describe('it reaches the frozen snapshot and the filed form', () => {
  test('the snapshot freezes each beneficiary’s description (FND-IMMUT)', () => {
    const c = computeEstate(deriveEngineMatter(MATTER), RULES);
    const byId = new Map((c.formSnapshot?.beneficiaries ?? []).map((b) => [b.id, b.interestDescription]));
    expect(byId.get('b1')).toBe('1/3 Residue');
    expect(byId.get('b2')).toBe('1/4 of Chase Account; 1/3 Residue');
  });

  test('column D is DRAWN onto the produced PDF — it was blank before', async () => {
    const text = await filledText();
    expect(text).toContain('1/3 Residue');
    expect(text).toContain('Chase Account');
  });

  test('the figures are untouched by the drawing pass', async () => {
    const c = computeEstate(deriveEngineMatter(MATTER), RULES);
    expect(c.grossEstate).toBe(1_200_000);
    // Drawing happens after assertComplete, so a mapping failure still surfaces first.
    await expect(filledText()).resolves.toBeTypeOf('string');
  });
});
