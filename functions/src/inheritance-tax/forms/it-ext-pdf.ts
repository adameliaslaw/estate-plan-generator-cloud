/**
 * Fill the State's own Form IT-EXT (3-07) from an approved computation.
 *
 * This is the fileable application, as distinct from `render-it-ext.ts`, which produces the
 * "WORKPAPER — NOT FOR FILING" HTML. Both read the same `ITEXTFormData`.
 *
 * The blank in `functions/assets/itext.pdf` is the State's published `itext.pdf`, one page and
 * 21 AcroForm fields. Unusually for these forms, its field names are mostly meaningful
 * (`DecName_1`, `CountyofRes`) — but they are still recorded here with the printed label beside
 * them, because "mostly" is not a property you can rely on and `Text1` is in there too.
 *
 * Two boxes the State asks for and this form deliberately leaves blank, each because the estate
 * record does not contain the answer:
 *
 *   - **The representative's Social Security Number.** No SSN is held for a personal
 *     representative anywhere in the data model. (Same gap as the IT-R's Schedule D commission
 *     rows.)
 *   - **The whole "Mailing Address to send all correspondence" block.** This is a *choice* about
 *     where the Division should write, not a fact about the estate — in practice usually the
 *     preparing attorney's office, which the matter does not record. Defaulting it to the
 *     executor's address would silently redirect the State's notices, so the block is left for
 *     the attorney. The delivered PDF keeps its fields interactive precisely so it can be
 *     completed before signing.
 *
 * The certification line and its date are a signature. They stay blank.
 */
import { PDFDocument } from 'pdf-lib';
import { FieldWriter, splitDate, splitPhone } from './pdf-fields';
import type { ITEXTFormData } from '../types';

const FIELDS = {
  decedentName: 'DecName_1',      // "Decedent's Name ____ (Last) (First) (Middle)"
  decedentSSN: 'DecSS_No',        // "Decedent's S.S. No."
  dodMonth: 'DOD1',               // "Date of Death (mm/dd/yy) ___/___/___"
  dodDay: 'DOD2',
  dodYear: 'DOD3',
  county: 'CountyofRes',          // "County of Residence"
  repName: 'Name',                // "Name of Executor/Administrator/Heir-at-Law"
  repSSN: 'SSNo_3',               // "Social Security Number:" — deliberately not written
  repAddress: 'Street',           // "Address"
  repPhoneArea: 'Text1',          // "Daytime Phone ( ___ )"
  repPhoneRest: 'DaytimePhone',
  extensionMonths: 'ExtReq',      // "Extension Requested for ____ months"
} as const;

/**
 * "Testate ( ) Intestate ( )". One radio group whose two widgets BOTH export "Yes" — an `/Opt`
 * array of `["Yes","Yes"]` — so `select()` can only ever reach the first. Selected by widget
 * position instead; see `FieldWriter.radioByIndex`. Widget 0 is Testate (x504), widget 1 is
 * Intestate (x565), ordered left to right as printed.
 */
const TESTATE_GROUP = 'TestateNo';
const TESTATE_WIDGET = 0;
const INTESTATE_WIDGET = 1;

/**
 * The correspondence block, recorded so the mapping is auditable and so a future change that
 * decides to fill it does not have to re-derive the names. Not written today — see the header.
 */
export const CORRESPONDENCE_FIELDS = {
  name: 'NameofExe_1',            // "Mailing Address to send all correspondence: Name"
  phone: 'ExeDayTimePhone',       // "Daytime Phone ( )"
  street: 'AddressofExe_1',       // "Street"
  city: 'City',                   // "City"
  state: 'State_1',               // "State"
  zip: 'Zip Code',                // "Zip Code"
} as const;

/** The certification signature line and its date. Never written — a signature is the attorney's. */
export const SIGNATURE_FIELDS = {
  signature: 'NameofExe_2',       // over "Executor / Administrator / Heir-at-Law / Estate Representative"
  date: 'dateofName',             // "Date"
} as const;

export async function fillITEXTPdf(data: ITEXTFormData, blank: Uint8Array): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(blank);
  const w = new FieldWriter(pdf.getForm(), 'IT-EXT');

  const fullName = [data.decedentLastName, data.decedentFirstName, data.decedentMiddleName]
    .filter(Boolean)
    .join(', ');
  w.text(FIELDS.decedentName, fullName);
  w.text(FIELDS.decedentSSN, data.decedentSSN);

  const [month, day, year] = splitDate(data.dateOfDeath);
  w.text(FIELDS.dodMonth, month);
  w.text(FIELDS.dodDay, day);
  // The box is printed "(mm/dd/yy)", so the year goes in two digits, as on the IT-PMT voucher.
  w.text(FIELDS.dodYear, year.slice(-2));
  w.text(FIELDS.county, data.countyOfResidence);

  w.radioByIndex(TESTATE_GROUP, data.willExists ? TESTATE_WIDGET : INTESTATE_WIDGET);

  const rep = data.representative;
  w.text(FIELDS.repName, rep.name);
  w.text(FIELDS.repAddress, rep.address);
  const [area, rest] = splitPhone(rep.phone);
  w.text(FIELDS.repPhoneArea, area);
  w.text(FIELDS.repPhoneRest, rest);

  // N.J.A.C. 18:26-9.1(b): 4 months on the first application, 6 in total once the second
  // (+2 month) extension is elected. The builder has already resolved which.
  w.text(FIELDS.extensionMonths, String(data.extensionMonths));

  w.assertComplete();
  return pdf.save();
}
