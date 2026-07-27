/**
 * Fill the State's own Form IT-R (12-24) PDF from an approved computation.
 *
 * This is the fileable return, as distinct from `render.ts`, which produces the
 * "WORKPAPER — NOT FOR FILING" HTML. Both read the same `ITRFormData`, so the figures are
 * identical; only the carrier differs.
 *
 * The blank booklet in `functions/assets/itr-blank.pdf` is the State's published `itrbk.pdf`,
 * downloaded from nj.gov. It carries 808 AcroForm fields whose names are auto-generated and
 * meaningless ("undefined_13", "0_2t4gsdxv0_22aa2aau65t"), so every constant below was
 * identified by its position on the page and the printed label beside it — never by its name.
 * The comment on each line is that printed label, verbatim, so a human can audit the mapping
 * against the paper form without running anything.
 *
 * Two consequences of that naming worth knowing before you edit this file:
 *   - each money box on the Summary Page is a PAIR of fields, dollars and cents, and the cents
 *     box is the narrow one to its right;
 *   - the decedent header fields on the schedule pages share one name across all 12 pages, so
 *     writing them once fills every schedule page.
 *
 * A field name that does not exist in the PDF is a mapping bug, not a runtime condition: this
 * module collects every such failure and throws with the full list rather than quietly
 * producing a return with empty boxes.
 */
import { PDFDocument, PDFForm } from 'pdf-lib';
import type { ITRFormData, TaxClassLine } from '../types';

/** Cover page — "Estate Information" block and the five yes/no questions. */
const COVER = {
  decedentName: 'Decedents Name',                       // "Decedent's Name — Last, First, Middle"
  ssn3: 'Decedents SS No',                              // "Decedent's S.S. No." — first 3 digits
  ssn2: 'undefined',                                    //   … middle 2
  ssn4: 'undefined_2',                                  //   … last 4
  aka: 'Also Known As AKA',                             // "Also Known As (AKA)"
  akaDetail: 'account will trust tax return etc enter names here',
  dodMonth: 'Date of Death mmddyyyy',                   // "Date of Death (mm/dd/yyyy)"
  dodDay: 'undefined_3',
  dodYear: 'undefined_4',
  county: 'NJ County of Residence',                     // "NJ County of Residence"
  repName: 'Name',                                      // representative block — "Name"
  repPhoneArea: 'Daytime Phone',                        // "Daytime Phone ( ___ )"
  repPhoneRest: 'undefined_5',
  repStreet1: 'Street 1',
  repStreet2: 'Street 2',
  repCity: 'City',
  repState: 'State',
  repZip: 'ZIP Code',
  repEmail: 'Email optional',                           // "Email (optional)"
  netEstateFromLine7: 'Enter Total from ITR Summary PageNet Estate from Line 7 Summary Page',
  totalTaxFromLine17: 'Enter Total from ITR Summary PageTotal Tax Due from Line 17 Summary Page',
} as const;

/**
 * The five cover-page questions. Each is a radio group whose two widgets sit side by side;
 * the option values are as irregular as the names ("Yes_2a"/"No_2a"), so they are recorded
 * literally rather than derived.
 */
const COVER_QUESTIONS: ReadonlyArray<{
  field: string;
  yes: string;
  no: string;
  source: keyof Pick<ITRFormData, 'willExists' | 'trustExists' | 'federalReturnFiled' | 'disclaimersExist' | 'virtualCurrencyExists'>;
}> = [
  // 1. "Last Will and Testament: Did the decedent have a Last Will and Testament?"
  { field: 'If Yes submit a copy of the stamped disclaimer that was filed with the Surrogates Court or as approved by', yes: 'Yes', no: 'No', source: 'willExists' },
  // 2. "Trusts: Did the decedent have any Trust documents separate from the Will?"
  { field: '2nIf Yes submit a copy of the stamped disclaimer that was filed with the Surrogates Court or as approved by', yes: 'Yes_2a', no: 'No_2a', source: 'trustExists' },
  // 3. "Income Tax Return: Did the decedent file a federal Form 1040 for the full year?"
  { field: '3cIf Yes submit a copy of the stamped disclaimer that was filed with the Surrogates Court or as approved by', yes: 'Yes_3', no: 'No_3', source: 'federalReturnFiled' },
  // 4. "Disclaimers: Were there, or will there be, any disclaimers filed?"
  { field: '4dIf Yes submit a copy of the stamped disclaimer that was filed with the Surrogates Court or as approved by', yes: 'Yes_4', no: 'No_4', source: 'disclaimersExist' },
  // 5. "Virtual Currency: Did the decedent own any convertible virtual currency at death?"
  { field: '5If Yes submit a copy of the stamped disclaimer that was filed with the Surrogates Court or as approved by', yes: 'Yes_5', no: 'No_5', source: 'virtualCurrencyExists' },
];

/** Summary Page header — a second copy of the decedent block, with its own field names. */
const SUMMARY_HEADER = {
  decedentName: 'Decedents Name_2',
  ssn3: 'Decedents SS No_2',
  ssn2: 'undefined_9',
  ssn4: 'undefined_10',
  dodMonth: 'Date of Death mmddyyyy_2',
  dodDay: 'undefined_11',
  dodYear: 'undefined_12',
  county: 'NJ County of Residence_2',
  /**
   * "Will / No Will" radio. Choice1 is the left widget (Will), Choice2 the right (No Will) —
   * the option order follows widget order in the PDF's Kids array.
   */
  willGroup: { field: 'Group1', will: 'Choice1', noWill: 'Choice2' },
} as const;

/** Summary Page lines 1–9, each a [dollars, cents] pair. Labels verbatim from the form. */
const SUMMARY_LINES_1_TO_9: ReadonlyArray<{ dollars: string; cents: string; key: keyof ITRFormData; label: string }> = [
  { dollars: '2aa', cents: '02aa2aa', key: 'line1_njRealProperty', label: '1. New Jersey Real Property — Total from Schedule A' },
  { dollars: '2', cents: '0_22aa2aau65t', key: 'line2_closelyHeldBusiness', label: '2. Closely Held Businesses — Total from Schedule B' },
  { dollars: '3', cents: '00_22aa2aau65t!!@', key: 'line3_allOtherPersonalProperty', label: '3. All Other Personal Property — Total from Schedule B1–B4 Recap' },
  { dollars: '4', cents: '0_20_22aa2aau65t0_22aa2aau65tu65t!!@', key: 'line4_transfers', label: '4. Transfers — Total from Schedule C' },
  { dollars: '5', cents: '00_22aa2aau65t0_22aa2aau65t', key: 'line5_grossEstate', label: '5. Gross Estate — Total lines 1 through 4' },
  { dollars: '6', cents: '0_2t4gsdxv0_22aa2aau65t', key: 'line6_deductions', label: '6. Deductions — Total from Schedule D' },
  { dollars: '7', cents: '00_22aa2aau65t', key: 'line7_netEstate', label: '7. Net Estate — Subtract line 6 from line 5' },
  { dollars: '8', cents: '0_20_22aa2aau65t0_22aa2aau65t', key: 'line8_contingentAmount', label: '8. Contingent Amount included on line 7' },
  { dollars: '9', cents: '0_20_22aa2aau65t0_22aa2aau65t6rt123', key: 'line9_balanceOfEstate', label: '9. Balance of Estate — Subtract line 8 from line 7' },
];

/**
 * Lines 10–14, the tax-class distribution table. Columns were identified from the printed
 * headers at their x-positions: Total Beneficiaries (x112) · Total Distribution (x189) ·
 * Total Exemption (x276) · Total Taxable Amount (x374) · Tax Calculation (x476).
 *
 * Rows 10, 11 and 14 are the exempt classes and have no Taxable Amount or Tax column on the
 * paper form — hence the nulls. That asymmetry is the form's, not ours.
 */
const TAX_CLASS_ROWS: ReadonlyArray<{
  key: keyof Pick<ITRFormData, 'line10_classA_spouse' | 'line11_classA_other' | 'line12_classC' | 'line13_classD' | 'line14_classE'>;
  label: string;
  count: string;
  distribution: string;
  exemption: string;
  taxable: string | null;
  tax: { dollars: string; cents: string } | null;
}> = [
  { key: 'line10_classA_spouse', label: '10. A - Spouse', count: '1', distribution: 'undefined_13', exemption: 'undefined_14', taxable: null, tax: null },
  { key: 'line11_classA_other', label: '11. A - Other', count: '2_2', distribution: 'undefined_15', exemption: 'undefined_16', taxable: null, tax: null },
  { key: 'line12_classC', label: '12. C', count: '3_2', distribution: 'undefined_17', exemption: 'undefined_18', taxable: 'undefined_19', tax: { dollars: '012', cents: '11340_22aa2aau65t' } },
  { key: 'line13_classD', label: '13. D', count: '4_2', distribution: 'undefined_20', exemption: 'undefined_21', taxable: 'undefined_22', tax: { dollars: '013', cents: '0_20_22aa2aau65t5yd' } },
  { key: 'line14_classE', label: '14. E', count: '5_2', distribution: 'undefined_23', exemption: 'undefined_24', taxable: null, tax: null },
];

/** "Total Distribution: $" — the column total beneath the tax-class table. */
const TOTAL_DISTRIBUTION_FIELD = 'undefined_25';

/** Summary Page lines 15–22. */
const SUMMARY_LINES_15_TO_22: ReadonlyArray<{ dollars: string; cents: string; key: keyof ITRFormData; label: string }> = [
  { dollars: '16aa46tefg', cents: '0216aa46tefgaa2aa', key: 'line15_compromiseTax', label: '15. Compromise Tax Due on Line 8 Amount' },
  { dollars: '16', cents: '0_22aa2aau65t16aa46tefg', key: 'line16_contingentTax', label: '16. Contingent Tax' },
  { dollars: '17', cents: '016aa46tefg16aa46tefg0_22aa2aau65t', key: 'line17_totalTax', label: '17. Total Tax Due (Total lines 10 through 16)' },
  { dollars: '18', cents: '0_20_22aa2aau65t0_2216aa46tefgaa2aau65t', key: 'line18_interestDue', label: '18. Interest Due (if applicable)' },
  { dollars: '19', cents: '00_22aa2aau16aa46tefg65t0_22aa2aau65t', key: 'line19_totalAmountDue', label: '19. Total Amount Due (Add line 17 and line 18)' },
  { dollars: '20', cents: '0_2t4gsdxv0_22aa2aau65t16aa46tefg', key: 'line20_priorPayments', label: '20. Payments made prior to filing return' },
  { dollars: '21', cents: '016aa46tefg0_22aa2aau65t', key: 'line21_balanceDue', label: '21. Balance due — pay this amount with Form IT-R' },
  { dollars: '22', cents: '0_20_22aa2aau616aa46tefg16aa46tefg555t0_22aa2aau65t', key: 'line22_refund', label: '22. Refund amount' },
];

/**
 * Decedent header repeated on every schedule page (A through E). One field name serves all 12
 * pages, so a single write fills them all.
 */
const SCHEDULE_HEADER = {
  decedentName: 'Decedents Name_4',
  ssn: 'Decedents Social Security Number',
  dateOfDeath: 'Date of Death',
} as const;

/** Collects mapping failures so one bad constant reports itself instead of vanishing. */
class FieldWriter {
  private readonly missing: string[] = [];

  constructor(private readonly form: PDFForm) {}

  text(name: string, value: string): void {
    try {
      this.form.getTextField(name).setText(value);
    } catch {
      this.missing.push(`text field ${JSON.stringify(name)}`);
    }
  }

  /** Money boxes are split: dollars in the wide box, cents in the narrow one beside it. */
  money(dollarsField: string, centsField: string, amount: number): void {
    const cents = Math.round(Math.abs(amount) * 100);
    const whole = Math.trunc(cents / 100) * Math.sign(amount || 1);
    this.text(dollarsField, whole.toLocaleString('en-US', { maximumFractionDigits: 0 }));
    this.text(centsField, String(cents % 100).padStart(2, '0'));
  }

  radio(name: string, option: string): void {
    try {
      this.form.getRadioGroup(name).select(option);
    } catch {
      this.missing.push(`radio ${JSON.stringify(name)} option ${JSON.stringify(option)}`);
    }
  }

  /** Throws once, listing everything that failed, so a broken mapping is impossible to miss. */
  assertComplete(): void {
    if (this.missing.length > 0) {
      throw new Error(
        `IT-R PDF mapping is out of step with the blank form — ${this.missing.length} field(s) not found: ` +
        this.missing.join('; '),
      );
    }
  }
}

/** "2023-09-18" → ["09", "18", "2023"], matching the form's three date boxes. */
function splitDate(iso: string): [string, string, string] {
  const [year, month, day] = iso.split('-');
  return [month ?? '', day ?? '', year ?? ''];
}

/** "999-00-1234" → ["999", "00", "1234"]. Digits only; the form has three boxes. */
function splitSSN(ssn: string): [string, string, string] {
  const digits = ssn.replace(/\D/g, '');
  return [digits.slice(0, 3), digits.slice(3, 5), digits.slice(5, 9)];
}

/** "609-555-0000" → ["609", "555-0000"]. The area code has its own box. */
function splitPhone(phone: string): [string, string] {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return ['', phone];
  return [digits.slice(0, 3), `${digits.slice(3, 6)}-${digits.slice(6, 10)}`];
}

/**
 * The matter model holds the representative's address as one free-text string, while the form
 * wants Street / City / State / ZIP in separate boxes. Only the unambiguous
 * "street, city, ST 08600" shape is split; anything else goes into Street 1 whole rather than
 * being guessed at, because a wrong county/state box on a filed return is worse than an
 * inelegant one.
 */
function splitAddress(address: string): { street1: string; street2: string; city: string; state: string; zip: string } {
  const empty = { street1: address, street2: '', city: '', state: '', zip: '' };
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return empty;

  const tail = parts[parts.length - 1] ?? '';
  const m = /^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/.exec(tail);
  if (!m) return empty;

  return {
    street1: parts[0] ?? '',
    street2: parts.length > 3 ? parts.slice(1, -2).join(', ') : '',
    city: parts[parts.length - 2] ?? '',
    state: m[1] ?? '',
    zip: m[2] ?? '',
  };
}

function fillTaxClassRow(w: FieldWriter, row: (typeof TAX_CLASS_ROWS)[number], line: TaxClassLine): void {
  w.text(row.count, String(line.totalBeneficiaries));
  w.text(row.distribution, formatMoneyInline(line.totalDistribution));
  w.text(row.exemption, formatMoneyInline(line.totalExemption));
  if (row.taxable) w.text(row.taxable, formatMoneyInline(line.totalTaxableAmount));
  if (row.tax) w.money(row.tax.dollars, row.tax.cents, line.taxDue);
}

/** The tax-class columns are single boxes with a printed "$" and ".", so cents go inline. */
function formatMoneyInline(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Fill the official IT-R from an approved snapshot's form data.
 *
 * @param data   built by `buildITRFormData`, which refuses anything but an approved checkpoint
 * @param blank  the State's unmodified booklet
 * @returns the filled PDF. Form fields are left interactive so the attorney can correct a box
 *          before signing; nothing here flattens the document.
 */
export async function fillITRPdf(data: ITRFormData, blank: Uint8Array): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(blank);
  const form = pdf.getForm();
  const w = new FieldWriter(form);

  const fullName = [data.decedentLastName, data.decedentFirstName, data.decedentMiddleName]
    .filter(Boolean)
    .join(', ');
  const [ssn3, ssn2, ssn4] = splitSSN(data.decedentSSN);
  const [dodMonth, dodDay, dodYear] = splitDate(data.dateOfDeath);

  // ── Cover page ────────────────────────────────────────────────────────────
  w.text(COVER.decedentName, fullName);
  w.text(COVER.ssn3, ssn3);
  w.text(COVER.ssn2, ssn2);
  w.text(COVER.ssn4, ssn4);
  if (data.decedentAka) w.text(COVER.aka, data.decedentAka);
  w.text(COVER.dodMonth, dodMonth);
  w.text(COVER.dodDay, dodDay);
  w.text(COVER.dodYear, dodYear);
  w.text(COVER.county, data.countyOfResidence);

  const rep = data.representative;
  const [area, rest] = splitPhone(rep.phone);
  const addr = splitAddress(rep.address);
  w.text(COVER.repName, rep.name);
  w.text(COVER.repPhoneArea, area);
  w.text(COVER.repPhoneRest, rest);
  w.text(COVER.repStreet1, addr.street1);
  w.text(COVER.repStreet2, addr.street2);
  w.text(COVER.repCity, addr.city);
  w.text(COVER.repState, addr.state);
  w.text(COVER.repZip, addr.zip);

  for (const q of COVER_QUESTIONS) {
    w.radio(q.field, data[q.source] ? q.yes : q.no);
  }

  // The cover page restates two Summary Page figures.
  w.text(COVER.netEstateFromLine7, formatMoneyInline(data.line7_netEstate));
  w.text(COVER.totalTaxFromLine17, formatMoneyInline(data.line17_totalTax));

  // ── Summary Page ──────────────────────────────────────────────────────────
  w.text(SUMMARY_HEADER.decedentName, fullName);
  w.text(SUMMARY_HEADER.ssn3, ssn3);
  w.text(SUMMARY_HEADER.ssn2, ssn2);
  w.text(SUMMARY_HEADER.ssn4, ssn4);
  w.text(SUMMARY_HEADER.dodMonth, dodMonth);
  w.text(SUMMARY_HEADER.dodDay, dodDay);
  w.text(SUMMARY_HEADER.dodYear, dodYear);
  w.text(SUMMARY_HEADER.county, data.countyOfResidence);
  w.radio(
    SUMMARY_HEADER.willGroup.field,
    data.willExists ? SUMMARY_HEADER.willGroup.will : SUMMARY_HEADER.willGroup.noWill,
  );

  for (const line of SUMMARY_LINES_1_TO_9) {
    w.money(line.dollars, line.cents, data[line.key] as number);
  }

  let totalDistribution = 0;
  for (const row of TAX_CLASS_ROWS) {
    const line = data[row.key];
    fillTaxClassRow(w, row, line);
    totalDistribution += line.totalDistribution;
  }
  w.text(TOTAL_DISTRIBUTION_FIELD, formatMoneyInline(totalDistribution));

  for (const line of SUMMARY_LINES_15_TO_22) {
    w.money(line.dollars, line.cents, data[line.key] as number);
  }

  // ── Schedule pages: one write fills the header on all twelve ──────────────
  w.text(SCHEDULE_HEADER.decedentName, fullName);
  w.text(SCHEDULE_HEADER.ssn, data.decedentSSN);
  w.text(SCHEDULE_HEADER.dateOfDeath, `${dodMonth}/${dodDay}/${dodYear}`);

  w.assertComplete();
  return pdf.save();
}
