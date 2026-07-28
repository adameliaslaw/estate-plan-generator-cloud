/**
 * Fill the State's own Form L-9 (9/22) — "Affidavit for Real Property Tax Waiver, Resident
 * Decedent" — from an approved computation.
 *
 * **This filler is the L-9 only, not the L-9(A).** The State prints two different forms either
 * side of 2018-01-01, and the printed L-9 says so on its own face: "Use this form for dates of
 * death on or after January 1, 2018. For dates of death before January 1, 2018, use Form
 * L-9(A)." `buildL9AFormData` already resolves which designation a matter takes; this module
 * refuses a matter that takes the other one rather than filing it on the wrong paper.
 *
 * The L-9(A) is not merely the same form with an earlier date. It carries a federal-706-style
 * estate-composition block (lines A–H, gross estate, adjusted taxable gifts) that `L9AFormData`
 * holds no figures for, and its AcroForm has two defects that need per-widget writes rather than
 * per-field ones: `undefined_16` is shared between page 1's line M and page 2's phone box, and
 * `Lot Block` is one field carrying BOTH the Lot and the Block widgets — so on that form Lot and
 * Block cannot be written independently at all. See docs/IT-R-FORMS-BUILD-PLAN.md.
 *
 * What is deliberately left blank here, each because the estate record does not hold it:
 *   - the predeceased-beneficiary schedule (the data model has no predeceased-beneficiary
 *     concept — an empty schedule is the honest answer, and "none" is not ours to assert);
 *   - the notarial block (State of, County of, the date sworn) and the deponent's SSN/FEIN;
 *   - the "Affidavit of" tick where the representative is an Heir-at-law, which is neither
 *     Executor, Administrator, nor Joint Tenant.
 *
 * Unlike the IT-EXT, the mailing-address block IS filled: the L-9's own affidavit text says
 * "Deponent authorizes the party listed above to act as the estate's representative and to
 * receive the waiver(s) requested herein", so that block is the representative, which the
 * matter does record.
 */
import { PDFDocument } from 'pdf-lib';
import { FormPreconditionError } from './errors';
import { FieldWriter, formatMoneyInline, resolveAddress, splitDate, splitPhone, splitSSN } from './pdf-fields';
import type { L9AFormData, L9ARealProperty } from '../types';

const HEADER = {
  lastName: 'Decedents Name',              // "Decedent's Name — Last"
  firstName: 'First',                      //   "First"
  middleName: 'Middle',                    //   "Middle Initial"
  ssn3: 'Decedents SSN',                   // "Decedent's SSN  ___ – __ – ____"
  ssn2: 'undefined_3',
  ssn4: 'undefined',
  dodMonth: 'Date of Death mmddyyyy',      // "Date of Death (mm/dd/yyyy)"
  dodDay: 'undefined_4',
  dodYear: 'undefined_2',
  county: 'County of Residence',           // "County of Residence"
} as const;

/** "Complete and Notarize — Testate (with will) / Intestate (no will)". Two separate checkboxes. */
const TESTATE_BOX = 'Check Box1';
const INTESTATE_BOX = 'Check Box11';

/**
 * "Mailing Address for all correspondence" — which on this form is the estate's representative,
 * per the affidavit's own authorising sentence.
 */
const REPRESENTATIVE = {
  name: 'Name',
  phoneArea: 'Phone',                      // "Phone ( ___ )"
  phoneRest: 'undefined_5',
  street: 'Street',
  city: 'City',
  state: 'State',
  zip: 'ZIP Code',
} as const;

/**
 * "Beneficiaries — State full names of all who have an interest in the estate (vested,
 * contingent, operation of law, transfer, etc.)". Seven printed rows. The field names are the
 * whole column heading with the row number appended, which is why they are generated rather
 * than transcribed.
 */
const BENEFICIARY_ROWS = Array.from({ length: 7 }, (_, i) => ({
  name: `Beneficiaries State full names of all who have an interest in the estate vested contingent operation of law transfer etcRow${i + 1}`,
  relationship: `Relationship to DecedentRow${i + 1}`,
  interest: `Interest of Beneficiary in the Estate percentage or specificRow${i + 1}`,
}));

/**
 * "Description of New Jersey Real Estate" — page 2, three parcel blocks. Block 1's field names
 * are unsuffixed; blocks 2 and 3 carry the State's own arbitrary suffixes (`ccc`, `ggg`).
 */
const PROPERTY_BLOCKS = [
  {
    county: 'County', street: 'Street and Number', lot: 'Street and Number1121',
    block: 'Street and Numberaad21', municipality: 'Municipality',
    owners: 'Owners of Record if decedent owned a fractional interest state how held and fractional value thereof',
  },
  {
    county: 'County_2', street: 'Street and Number_2', lot: 'Street and Number1121ccc',
    block: 'Street and Numberaad21ccc', municipality: 'Municipality_2',
    owners: 'Owners of Record if decedent owned a fractional interest state how held and fractional value thereof_2',
  },
  {
    county: 'County_3', street: 'Street and Number_3', lot: 'Street and Number1121ggg',
    block: 'Street and Numberaad21ggg', municipality: 'Municipality_3',
    owners: 'Owners of Record if decedent owned a fractional interest state how held and fractional value thereof_3',
  },
] as const;

/** The sworn block. `deponentName` is a printed name inside the affidavit, not a signature. */
const DEPONENT = {
  name: 'Deponents name',                  // "(Deponent's name) … being duly sworn"
  address: 'Address',                      // "Address"
  ssnOrFein: 'Deponents Social Security or Federal Identification Number',
} as const;

/** "Affidavit of: Executor / Administrator / Joint Tenant". */
const AFFIDAVIT_OF = { Executor: 'Ex', Administrator: 'Admi1', JointTenant: 'JYT1' } as const;

/**
 * The notarial block and the predeceased-beneficiary schedule. Named so the mapping is auditable
 * and so the test can assert they are left blank on purpose rather than by omission.
 */
export const UNFILLED_FIELDS = {
  notaryState: 'State of',
  notaryCounty: 'County of',
  notaryDay: 'This 1',
  notaryMonth: 'day of',
  notaryYear: '20',
  deponentSSN: DEPONENT.ssnOrFein,
  predeceasedName1: 'NameRow1',
  predeceasedDate1: 'Date of DeathRow1',
  predeceasedDomicile1: 'Domicile at DeathRow1',
} as const;

/** The enum reads as a legal relationship already; only the underscores are ours. */
function relationshipLabel(relationship: string): string {
  return relationship.replace(/_/g, ' ');
}

export async function fillL9Pdf(data: L9AFormData, blank: Uint8Array): Promise<Uint8Array> {
  if (data.formDesignation !== 'L-9') {
    throw new FormPreconditionError(
      `This estate takes Form ${data.formDesignation}, not Form L-9: the State prints a separate ` +
      'form for deaths before 2018-01-01, and only the L-9 can be filled here. The workpaper ' +
      'above carries the same figures for a hand-filled L-9(A).',
    );
  }
  if (data.realProperties.length > PROPERTY_BLOCKS.length) {
    throw new FormPreconditionError(
      `The L-9 prints ${PROPERTY_BLOCKS.length} parcel blocks and this estate has ` +
      `${data.realProperties.length}. Filing three and dropping the rest would understate the ` +
      'property the waiver covers — attach a continuation schedule and complete it by hand.',
    );
  }

  const pdf = await PDFDocument.load(blank);
  const w = new FieldWriter(pdf.getForm(), 'L-9');

  w.text(HEADER.lastName, data.decedentLastName);
  w.text(HEADER.firstName, data.decedentFirstName);
  w.text(HEADER.middleName, data.decedentMiddleName ?? '');
  const [ssn3, ssn2, ssn4] = splitSSN(data.decedentSSN);
  w.text(HEADER.ssn3, ssn3);
  w.text(HEADER.ssn2, ssn2);
  w.text(HEADER.ssn4, ssn4);
  // Printed "(mm/dd/yyyy)" here — a four-digit year, unlike the IT-EXT's two.
  const [month, day, year] = splitDate(data.dateOfDeath);
  w.text(HEADER.dodMonth, month);
  w.text(HEADER.dodDay, day);
  w.text(HEADER.dodYear, year);
  w.text(HEADER.county, data.countyOfResidence);

  w.check(data.testate ? TESTATE_BOX : INTESTATE_BOX);

  const rep = data.representative;
  const addr = resolveAddress(rep.address, rep.addressParts);
  const [area, rest] = splitPhone(rep.phone);
  w.text(REPRESENTATIVE.name, rep.name);
  w.text(REPRESENTATIVE.phoneArea, area);
  w.text(REPRESENTATIVE.phoneRest, rest);
  w.text(REPRESENTATIVE.street, addr.street1);
  w.text(REPRESENTATIVE.city, addr.city);
  w.text(REPRESENTATIVE.state, addr.state);
  w.text(REPRESENTATIVE.zip, addr.zip);

  // The deponent is the representative — the person swearing the affidavit.
  w.text(DEPONENT.name, rep.name);
  w.text(DEPONENT.address, rep.address);
  // 'Heir-at-law' is none of the three printed choices, so it is left unticked rather than
  // forced into the nearest one. An unticked box says nothing; a wrong tick swears something.
  if (rep.title === 'Executor') w.check(AFFIDAVIT_OF.Executor);
  else if (rep.title === 'Administrator') w.check(AFFIDAVIT_OF.Administrator);

  data.beneficiaries.slice(0, BENEFICIARY_ROWS.length).forEach((b, i) => {
    const row = BENEFICIARY_ROWS[i];
    if (!row) return;
    w.text(row.name, b.fullName);
    w.text(row.relationship, relationshipLabel(b.relationship));
    // The column asks for "percentage or specific"; the record holds a specific value.
    w.text(row.interest, formatMoneyInline(b.interestValue));
  });

  data.realProperties.forEach((property, i) => {
    const block = PROPERTY_BLOCKS[i];
    if (!block) return;
    fillParcel(w, block, property);
  });

  w.assertComplete();
  return pdf.save();
}

/**
 * One parcel block. Where intake captured Schedule A's columns they are used; where it did not,
 * the box is left blank for the attorney and only the description carries — the street line
 * falls back to it so the parcel is at least identified, but a lot and block are never invented.
 */
function fillParcel(
  w: FieldWriter,
  block: (typeof PROPERTY_BLOCKS)[number],
  property: L9ARealProperty,
): void {
  w.text(block.county, property.county ?? '');
  w.text(block.street, property.streetAddress ?? property.description);
  w.text(block.lot, property.lots ?? '');
  w.text(block.block, property.block ?? '');
  w.text(block.municipality, property.municipality ?? '');
  w.text(block.owners, property.ownersAndTitle ?? '');
}
