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
import type {
  AddressParts, DeductionType, ITRFormData, ScheduleDeductionItem, ScheduleEBeneficiaryRow,
  ScheduleItem, TaxClassLine,
} from '../types';

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
 * Form IT-PMT (page 3) — the payment voucher that travels with the return.
 *
 * It carries its own copy of the decedent and representative blocks, with its own field names,
 * and one figure. The form answers for itself which figure that is: printed above the box is
 * "Amount paid with return (From IT-R Summary Page, line 21)" — the balance due, not line 19's
 * total, because payments already made are not remitted again.
 *
 * Two differences from the cover page worth noting, both the State's own:
 *   - the SSN boxes are named out of order (`undefined_31` is the middle pair, `undefined_30` the
 *     last four) — resolved by x-position, 127 / 171 / 215, never by the name;
 *   - the date of death is printed "(mm/dd/yy)" and the field is named `Date of Death mmddyy`,
 *     against the cover's `…mmddyyyy`. The two-digit year is what this voucher asks for.
 *
 * The eleven "list each check individually" boxes and their total are deliberately left blank:
 * how the attorney splits the remittance across checks is not something the estate record knows,
 * and the form only asks for the list when there is more than one check.
 */
const IT_PMT = {
  decedentName: 'Decedents Name_3',                     // "Decedent's Name — Last First Middle"
  ssn3: 'Decedents SS No_3',                            // "Decedent's S.S. No." — first 3 digits
  ssn2: 'undefined_31',                                 //   … middle 2
  ssn4: 'undefined_30',                                 //   … last 4
  dodMonth: 'Date of Death mmddyy',                     // "Date of Death (mm/dd/yy)"
  dodDay: 'undefined_32',
  dodYear: 'undefined_33',
  county: 'County of Residence',
  repName: 'Name_2',
  repPhoneArea: 'Daytime Phone_3',                      // "Daytime Phone ( ___ )"
  repPhoneRest: 'undefined_34',
  repStreet: 'Street',
  repCity: 'City_2',
  repState: 'State_2',
  repZip: 'ZIP Code_2',
  repEmail: 'Email Address',
  amount: 'undefined_35',                               // "1. Inheritance Tax (Total of checks remitted with this form)"
} as const;

/**
 * Schedules B1–B4 Recap (page 10) — "Enter totals from each of the following schedules", whose
 * line 5 is the figure the Summary Page prints on line 3.
 *
 * Line 5 is written from `line3_allOtherPersonalProperty` rather than re-added here, so the recap
 * and the Summary Page cannot disagree: one figure, printed twice.
 *
 * ⚠️ Rows 1 and 2 carry near-identical names — `2 Schedule B2 Sto111ckCoops_2` is the
 * **B-1 accounts** row at y642, and `2 Schedule B2 StockCoops_2` the B-2 stocks row at y615.
 * They are resolved by y-position against the printed labels at y646 and y619. Reading the names
 * gets this backwards.
 *
 * The page's own note — "If there are no assets reported on any of these schedules … enter zero on
 * the line corresponding to that schedule" — is why all five boxes are written unconditionally.
 */
const RECAP = {
  scheduleB1: '2 Schedule B2 Sto111ckCoops_2',                    // "1. Schedule B-1: Financial Institution Accounts"
  scheduleB2: '2 Schedule B2 StockCoops_2',                       // "2. Schedule B-2: Stock/Co-ops"
  scheduleB3: '3 Schedule B3 Municipal and Corporate Bonds_2',    // "3. Schedule B-3: Municipal and Corporate Bonds"
  scheduleB4: '4 Schedule B4 All Other Property_2',               // "4. Schedule B-4: All Other Property"
  total: '5 Total Lines 14 Enter here and on Form ITR Summary Page line 3',
} as const;

/**
 * Schedule E Part I — "Beneficiary and address of each person who has an interest (vested,
 * contingent, or otherwise) in this Estate". Nine rows on the page.
 *
 * Columns identified from the printed headers: (A) beneficiary and address at x57/x64 · (B)
 * Relationship to Decedent at x215 · (C) Tax Class at x300, a dropdown offering exactly
 * " ", A, C, D, E · (E) Dollar Amount at x453. Columns (D) fractional share and (F) age are
 * left blank — the engine models neither, and inventing them is not on.
 *
 * Generated from the field inventory rather than transcribed: the names carry the State's own
 * typos ("Deceaaaas1dent") and copying them by hand is how a row silently stops filling.
 */
const SCHEDULE_E_ROWS: ReadonlyArray<{
  name: string; address1: string; address2: string; relationship: string; taxClass: string; amount: string;
}> = [
  { name: 'Name_4', address1: 'Address 1_2', address2: 'Address 2_2', relationship: 'B Relationship to DecedentName Address', taxClass: 'Select 1', amount: 'C Tax ClassName Address@@$#@@@$#@' },
  { name: 'Name_5', address1: 'Address 1_3', address2: 'Address 2_3', relationship: 'B Relationship to DecedentName Address_2', taxClass: 'Select 2', amount: 'C Tax ClassName Address_2@@$#@@@$#@' },
  { name: 'Name_6', address1: 'Address 1_4', address2: 'Address 2_4', relationship: 'B Relationship to DecedentName Address_3', taxClass: 'Select 3', amount: 'C Tax ClassName@@$#@ Address_3' },
  { name: 'Name_7', address1: 'Address 1_5', address2: 'Address 2_5', relationship: 'B Relationship to DecedentName Address_4', taxClass: 'Select 4', amount: 'C @@$#@Tax ClassName Address_4' },
  { name: 'Name_8', address1: 'Address 1_6', address2: 'Address 2_6', relationship: 'B Relationship to DecedentName Address_5', taxClass: 'Select 5', amount: 'C Tax ClassName Address@@$#@_5' },
  { name: 'Name_9', address1: 'Address 1_7', address2: 'Address 2_7', relationship: 'B Relationship to DecedentName Address_6', taxClass: 'Select 6', amount: 'C Tax ClassName Ad@@$#@dress_6' },
  { name: 'Name_10', address1: 'Address 1_8', address2: 'Address 2_8', relationship: 'B Relationship to DecedentName Address_7', taxClass: 'Select 7', amount: 'C Tax ClassName Address_7@@$#@' },
  { name: 'Name_11', address1: 'Address 1_9', address2: 'Address 2_9', relationship: 'B Relationship to DecedentName Address_8', taxClass: 'Select 8', amount: 'C Tax ClassName Address_8@@$#@@@$#@' },
  { name: 'Name_12', address1: 'Address 1_10', address2: 'Address 2_10', relationship: 'B Relationship to Deceaaaas1dentName Address_9', taxClass: 'Select 9', amount: 'C Tax ClassName Address_9@@$#@' },
];

/**
 * Schedule B-4 — "All Other Property". Eighteen flat rows of description · (B) Date of Death
 * Value · (C) Decedent's Equity.
 *
 * B-4 is the one asset schedule whose columns the engine can answer in full: the model holds a
 * description and a fair market value per item, which is exactly what this schedule asks for.
 * Decedent's Equity is the same figure — the model has no partial-interest concept, and the
 * whole value is what the estate reported.
 */
const SCHEDULE_B4_ROWS: ReadonlyArray<{ description: string; value: string; equity: string }> = [
  { description: '1113424 Date of Death ValueRow1_2', value: 'B Date of Death ValueRow1_2', equity: 'C Decedents EquityRow1' },
  { description: 'B Date1113424 Date of Death V of Death ValueRow2_2', value: 'B Date of Death ValueRow2_2', equity: 'C Decedents EquityRow2' },
  { description: 'B Date of Dea1113424 Date of Death Vth ValueRow3_2', value: 'B Date of Death ValueRow3_2', equity: 'C Decedents EquityRow3' },
  { description: 'B Date of Death ValueRow4_21113424 Date of Death V', value: 'B Date of Death ValueRow4_2', equity: 'C Decedents EquityRow4' },
  { description: 'B Date of 1113424 Date of Death VValueRow5_2', value: 'B Date of Death ValueRow5_2', equity: 'C Decedents EquityRow5' },
  { description: 'B Date of Death ValueRow6_21113424 Date of Death V', value: 'B Date of Death ValueRow6_2', equity: 'C Decedents EquityRow6' },
  { description: 'B Date of Dea1113424 Date of Death Vth ValueRow7_2', value: 'B Date of Death ValueRow7_2', equity: 'C Decedents EquityRow7' },
  { description: 'B Date of D1113424 Date of Death Veath ValueRow8_2', value: 'B Date of Death ValueRow8_2', equity: 'C Decedents EquityRow8' },
  { description: 'B Date 1113424 Date of Death Vof Death ValueRow9_2', value: 'B Date of Death ValueRow9_2', equity: 'C Decedents EquityRow9' },
  { description: 'B Date of Death ValueRow10_21113424 Date of Death V', value: 'B Date of Death ValueRow10_2', equity: 'C Decedents EquityRow10' },
  { description: 'B Date of Death Val1113424 Date of Death VueRow11_2', value: 'B Date of Death ValueRow11_2', equity: 'C Decedents EquityRow11' },
  { description: 'B Date of Deat1113424 Date of Death Vh ValueRow12_2', value: 'B Date of Death ValueRow12_2', equity: 'C Decedents EquityRow12' },
  { description: 'B Date of Death ValueRow131113424 Date of Death V', value: 'B Date of Death ValueRow13', equity: 'C Decedents EquityRow13' },
  { description: 'B Date of Death Value1113424 Date of Death VRow14', value: 'B Date of Death ValueRow14', equity: 'C Decedents EquityRow14' },
  { description: 'B 1113424 Date of Death VDate of Death ValueRow15', value: 'B Date of Death ValueRow15', equity: 'C Decedents EquityRow15' },
  { description: 'B Date of 1113424 Date of Death VValueRow16', value: 'B Date of Death ValueRow16', equity: 'C Decedents EquityRow16' },
  { description: 'B Date of De1113424 Date of Death Vath ValueRow17', value: 'B Date of Death ValueRow17', equity: 'C Decedents EquityRow17' },
  { description: 'B Date1113424 Date of Death V of Death ValueRow18', value: 'B Date of Death ValueRow18', equity: 'C Decedents EquityRow18' },
];

/**
 * Schedule D — "Deductions Claimed", pages 13 and 14. Three parts, and unlike the asset
 * schedules the categories are PRE-PRINTED: a row's meaning comes from the block it sits in, not
 * from anything written in it.
 *
 * Part I, "Allowable Estate Administration Expenses", has fixed slots — one Funeral line, four
 * Administration lines, one Counsel Fees, one CPA/Enrolled Agent, and two Commissions blocks.
 * Column (A) is a free-text box under the printed category, (B) is "Name of Business/Person
 * Paid", (C) the amount.
 *
 * Row tables generated from `scripts/itr-field-inventory.mjs` by y-position within each column's
 * x-band, never transcribed — page 14 alone has 24 rows whose names differ only in where the
 * State's `21#$%%$` noise was spliced into them.
 *
 * Left deliberately blank: the two SS# blocks beside the commissions (the model holds no SSN for
 * a personal representative, and inventing one on a filed return is not on) and the
 * Estimated/Agreed checkboxes beside the professional fees (nothing in the matter records which
 * a fee is).
 */
const SCHEDULE_D_PART_I = {
  funeral: { type: 'Funeral list additional funeral expenses', name: 'Names1121', amount: 'C AmountNames' },
  administration: [
    { type: 'Administration list additional expenses', name: 'Names4t656', amount: 'C AmountNames_2' },
    { type: 'undefined_69', name: 'Names4t656aa', amount: 'C AmountNames_2bb' },
    { type: 'undefined_68', name: 'Names4t656cc', amount: 'C AmountNames_2ff' },
    { type: 'undefined_70', name: 'Names4t656aarr', amount: 'C AmountNames_2bbgg' },
  ],
  counsel: { name: 'Names3332', amount: 'C AmountNames_3' },
  accountant: { name: 'Namesa32', amount: 'C AmountNames_4' },
  commissions: [
    { name: 'Names', amount: 'C AmountNames SS   Name SS!##' },
    { name: 'Name_3', amount: 'C AmountNames SS   Name SS' },
  ],
  total: 'C AmountTotal  Part I',
} as const;

/**
 * Part II — "Real Property Debts of the Decedent". Section A is mortgages on property reported
 * on Schedule A, at date-of-death balances only; Section B is debts tied to the sale of the
 * decedent's real property. Four rows each.
 */
const SCHEDULE_D_PART_II = {
  mortgages: [
    { type: '1_4', name: '1_42233', amount: 'C AmountTotal  Part I221@##' },
    { type: '2_4', name: '2_41_42233', amount: 'C Amrt I221@##ountTotal  Part I221' },
    { type: '3_4', name: '3_41_42233', amount: 'Crt I221@## AmountTotal  Part I221' },
    { type: '4_4', name: '4_41_42233', amount: 'C AmountTotal rt I221@## Part I221' },
  ],
  saleDebts: [
    { type: '1_5', name: '1_51_422331_42233', amount: 'C AmountTotal  Part I221#$%%$' },
    { type: '2_5', name: '2_51_422331_42233', amount: 'C AmountTotal  Pa21#$%%$rt I221' },
    { type: '3_5', name: '3_51_422331_42233', amount: 'C Am21#$%%$ountTotal  Part I221' },
    { type: '4_5', name: '4_51_422331_42233', amount: '21#$%%$C AmountTotal  Part I221' },
  ],
  total: 'Total  Part II Section21#$%%$ A and Section B_2',
} as const;

/**
 * Part III (page 14) — "Other administration/funeral expenses or debts of the decedent as of the
 * date of death". Twenty-four free rows, and the form's own home for anything Part I's fixed
 * slots cannot hold: it is where the printed page sends extra funeral and administration
 * expenses, and where every deduction type without a printed block belongs.
 */
const SCHEDULE_D_PART_III_ROWS: ReadonlyArray<{ type: string; name: string; amount: string }> = [
  { type: 'B Name of BusinessPerson21#$%%$ Owed1', name: 'B Name of BusinessPerson Owed1', amount: 'C Amount1' },
  { type: 'B Nam21#$%%$e of BusinessPerson Owed2', name: 'B Name of BusinessPerson Owed2', amount: 'C Amount2' },
  { type: 'B Name of BusinessPerson Owed321#$%%$', name: 'B Name of BusinessPerson Owed3', amount: 'C Amount3' },
  { type: 'B Na21#$%%$me of BusinessPerson Owed4', name: 'B Name of BusinessPerson Owed4', amount: 'C Amount4' },
  { type: 'B Name of BusinessPerson Owe!@@#!d5', name: 'B Name of BusinessPerson Owed5@@#', amount: 'C Amount5' },
  { type: 'BOwe!@@#! Name of BusinessPerson Owed6', name: 'B Name of @@#BusinessPerson Owed6', amount: 'C Amount6' },
  { type: 'B Name of BusiOwe!@@#!nessPerson Owed7', name: 'B Nam@@#e of BusinessPerson Owed7', amount: 'C Amount7' },
  { type: 'B Name of BusinessPOwe!@@#!erson Owed8', name: 'B Name of BusinessPerson Owed8', amount: 'C Amount8' },
  { type: 'B Name of BusinessPerson Owed921#$%%$', name: 'B Name of BusinessPerson Owed9', amount: 'C Amount9' },
  { type: 'B Name of Bu21#$%%$sinessPerson Owed10', name: 'B Name of BusinessPerson Owed10', amount: 'C Amount10' },
  { type: 'B Name of BusinessPerson Owed1121#$%%$', name: 'B Name of BusinessPerson Owed11', amount: 'C Amount11' },
  { type: 'B Name of21#$%%$ BusinessPerson Owed12', name: 'B Name of BusinessPerson Owed12', amount: 'C Amount12' },
  { type: 'B Name of BusinessPerson Owed1321#$%%$', name: 'B Name of BusinessPerson Owed13', amount: 'C Amount13' },
  { type: 'B Name of BusinessPerson Owed1421#$%%$', name: 'B Name of BusinessPerson Owed14', amount: 'C Amount14' },
  { type: 'B Name of BusinessPerson Owe21#$%%$d15', name: 'B Name of BusinessPerson Owed15', amount: 'C Amount15' },
  { type: 'B Name of BusinessPerson Owed1621#$%%$', name: 'B Name of BusinessPerson Owed16', amount: 'C Amount16' },
  { type: 'B Name of BusinessPerson Owed1721#$%%$', name: 'B Name of BusinessPerson Owed17', amount: 'C Amount17' },
  { type: 'B Name of BusinessPerson Owed1821#$%%$', name: 'B Name of BusinessPerson Owed18', amount: 'C Amount18' },
  { type: 'B Name of Busine21#$%%$ssPerson Owed19', name: 'B Name of BusinessPerson Owed19', amount: 'C Amount19' },
  { type: 'B Name of BusinessPerson Owed2021#$%%$', name: 'B Name of BusinessPerson Owed20', amount: 'C Amount20' },
  { type: 'B Name of BusinessPerson Owed2121#$%%$', name: 'B Name of BusinessPerson Owed21', amount: 'C Amount21' },
  { type: 'B Name of Busi21#$%%$nessPerson Owed22', name: 'B Name of BusinessPerson Owed22', amount: 'C Amount22' },
  { type: 'B Name of BusinessPerson Owed2321#$%%$', name: 'B Name of BusinessPerson Owed23', amount: 'C Amount23' },
  { type: 'B Name of Busines21#$%%$sPerson Owed24', name: 'B Name of BusinessPerson Owed24', amount: 'C Amount24' },
];

/**
 * The three totals at the foot of page 14. `allDeductions` is written from Line 6 rather than
 * re-added here, so the schedule and the Summary Page cannot disagree — the parts above it are
 * the itemisation of that one figure.
 */
const SCHEDULE_D_TOTALS = {
  partIII: 'C AmountTotal  Part III',
  additionalSchedules: 'C AmountTotal of all additional schedules Part I Part II and Part III if none enter zero',
  allDeductions: 'C AmountTotal of all deductions claimed Part I Part II and Part III Enter here and on Form ITR Summary Page line 6',
} as const;

/**
 * "Check if additional copies of the schedule are attached" — one per schedule page. Set when
 * the estate has more items than the page has rows, because the alternative is a return that
 * silently reports fewer assets or beneficiaries than the estate contains.
 */
const ADDITIONAL_COPIES = {
  scheduleB4: 'Check if additional copies of the schedule are attached_6',
  scheduleD1: 'Check if additional copies of the schedule are attached_9',   // Schedule D, page 13
  scheduleD2: 'Check if additional copies of the schedule are attached_10',  // Schedule D, page 14
  scheduleE: 'Check if additional copies of the schedule are attached_11',
} as const;

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

  dropdown(name: string, option: string): void {
    try {
      this.form.getDropdown(name).select(option);
    } catch {
      this.missing.push(`dropdown ${JSON.stringify(name)} option ${JSON.stringify(option)}`);
    }
  }

  check(name: string): void {
    try {
      this.form.getCheckBox(name).check();
    } catch {
      this.missing.push(`checkbox ${JSON.stringify(name)}`);
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
 * Resolve an address to the form's separate boxes.
 *
 * Intake captures the parts directly (Google Places returns them pre-split), and when they are
 * present they are used verbatim — no parsing involved. Matters predating that carry only a
 * free-text string; for those, only the unambiguous "street, city, ST 08600" shape is split, and
 * anything else goes into Street 1 whole rather than being guessed at, because a wrong state box
 * on a filed return is worse than an inelegant one.
 */
function resolveAddress(
  address: string,
  parts: AddressParts | undefined,
): { street1: string; street2: string; city: string; state: string; zip: string } {
  if (parts) {
    return {
      street1: parts.street1,
      street2: parts.street2 ?? '',
      city: parts.city,
      state: parts.state,
      zip: parts.zip,
    };
  }
  return splitAddress(address);
}

/** Legacy path: the best that can be made of a single free-text address string. */
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
 * Schedule E Part I. The page holds nine beneficiaries; a tenth sets "additional copies of the
 * schedule are attached" rather than being dropped, so the return never reports fewer interests
 * than the estate has.
 *
 * The address is written as two lines: street (with any suite) on the first, "City, ST ZIP" on
 * the second. Where structured parts are absent the free-text address goes on line 1 whole.
 */
function fillScheduleE(w: FieldWriter, rows: ReadonlyArray<ScheduleEBeneficiaryRow>): void {
  rows.slice(0, SCHEDULE_E_ROWS.length).forEach((row, i) => {
    const f = SCHEDULE_E_ROWS[i];
    if (!f) return;
    const a = resolveAddress(row.address, row.addressParts);
    w.text(f.name, row.name);
    w.text(f.address1, [a.street1, a.street2].filter(Boolean).join(', '));
    w.text(f.address2, [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '));
    // The workpaper prints the relationship the same way, so the two documents agree.
    w.text(f.relationship, row.relationship.replace(/_/g, ' '));
    w.dropdown(f.taxClass, row.taxClass);
    w.text(f.amount, formatMoneyInline(row.dollarAmount));
  });

  if (rows.length > SCHEDULE_E_ROWS.length) w.check(ADDITIONAL_COPIES.scheduleE);
}

/**
 * Form IT-PMT, the payment voucher.
 *
 * The decedent block is written whatever the outcome — the voucher is part of the booklet and
 * identifies it. The amount and the representative's address are written only when there is a
 * balance to remit, because the form says so in as many words: "Do not include address if you are
 * not submitting a payment." An estate that owes nothing files a return, not a payment.
 */
function fillPaymentVoucher(
  w: FieldWriter,
  data: ITRFormData,
  identity: { fullName: string; ssn: [string, string, string]; dod: [string, string, string] },
): void {
  const [ssn3, ssn2, ssn4] = identity.ssn;
  const [dodMonth, dodDay, dodYear] = identity.dod;

  w.text(IT_PMT.decedentName, identity.fullName);
  w.text(IT_PMT.ssn3, ssn3);
  w.text(IT_PMT.ssn2, ssn2);
  w.text(IT_PMT.ssn4, ssn4);
  w.text(IT_PMT.dodMonth, dodMonth);
  w.text(IT_PMT.dodDay, dodDay);
  // "(mm/dd/yy)" — the voucher's own label, unlike the four-digit boxes on the cover page.
  w.text(IT_PMT.dodYear, dodYear.slice(-2));
  w.text(IT_PMT.county, data.countyOfResidence);

  if (data.line21_balanceDue <= 0) return;

  const rep = data.representative;
  const [area, rest] = splitPhone(rep.phone);
  const addr = resolveAddress(rep.address, rep.addressParts);
  w.text(IT_PMT.repName, rep.name);
  w.text(IT_PMT.repPhoneArea, area);
  w.text(IT_PMT.repPhoneRest, rest);
  // One Street box here, against the cover page's two.
  w.text(IT_PMT.repStreet, [addr.street1, addr.street2].filter(Boolean).join(', '));
  w.text(IT_PMT.repCity, addr.city);
  w.text(IT_PMT.repState, addr.state);
  w.text(IT_PMT.repZip, addr.zip);

  w.text(IT_PMT.amount, formatMoneyInline(data.line21_balanceDue));
}

/**
 * Column (A) on Part III, where — unlike every other block on Schedule D — the printed page
 * names no category. The deduction's own type has to say what the expense is.
 *
 * Deliberately shorter than the workpaper's labels in `render.ts`, which carry the N.J.A.C.
 * citation: this box is 181pt wide on a filed return, and a citation would push the attorney's
 * description out of view.
 */
const DEDUCTION_TYPE_LABELS: Record<DeductionType, string> = {
  funeral_expenses: 'Funeral expense',
  last_illness_expenses: 'Last illness expense',
  administration_expenses: 'Administration expense',
  debt_of_decedent: 'Debt of decedent',
  mortgage: 'Mortgage',
  executor_commission: "Executor's commission",
  attorney_fee: 'Counsel fee',
  accounting_fee: 'Accounting fee',
  accrued_property_taxes: 'Accrued property taxes',
  transfer_taxes_other_states: 'Transfer tax — other jurisdiction',
  other: 'Other',
};

/** One printed row of Schedule D. Blocks whose category is pre-printed have no column (A). */
interface DeductionSlot {
  readonly type?: string;
  readonly name: string;
  readonly amount: string;
}

/**
 * Schedule D — "Deductions Claimed".
 *
 * Every deduction goes to the block the State prints for it: funeral to the Funeral line,
 * administration to the four Administration lines, counsel and accountant fees to their own
 * lines, commissions to the two commission blocks, mortgages to Part II Section A. Everything
 * else — last illness, debts, accrued taxes, other-jurisdiction transfer taxes — belongs to Part
 * III, which is what that part is for.
 *
 * Anything that will not fit its block falls through to Part III rather than being dropped; the
 * page itself directs the overflow there ("list additional funeral expenses in Part III"). Past
 * Part III's 24 rows, the remainder is reported as a total on "Total of all additional schedules"
 * with both "additional copies attached" boxes set — the attorney attaches the continuation, but
 * the return's arithmetic still adds up to Line 6 rather than silently under-reporting.
 *
 * Part II Section B (debts tied to a sale of the decedent's real property) is left blank: the
 * model has no sale concept, and a mortgage balance is not a sale debt.
 */
function fillScheduleD(w: FieldWriter, data: ITRFormData): void {
  const overflow: ScheduleDeductionItem[] = [];
  let partITotal = 0;
  let partIITotal = 0;

  const ofType = (...types: DeductionType[]): ScheduleDeductionItem[] =>
    data.scheduleD.filter((d) => types.includes(d.type));

  /** Fills `slots` in order; anything left over goes to Part III. Returns what was placed. */
  const place = (slots: ReadonlyArray<DeductionSlot>, items: ScheduleDeductionItem[]): number => {
    let placed = 0;
    items.forEach((item, i) => {
      const slot = slots[i];
      if (!slot) {
        overflow.push(item);
        return;
      }
      // The category is printed beside these rows, so column (A) carries the attorney's own
      // description rather than repeating it.
      if (slot.type) w.text(slot.type, item.description);
      w.text(slot.name, item.payeeName ?? '');
      w.text(slot.amount, formatMoneyInline(item.amount));
      placed += item.amount;
    });
    return placed;
  };

  // ── Part I — allowable estate administration expenses ────────────────────
  partITotal += place([SCHEDULE_D_PART_I.funeral], ofType('funeral_expenses'));
  partITotal += place(SCHEDULE_D_PART_I.administration, ofType('administration_expenses'));
  partITotal += place([SCHEDULE_D_PART_I.counsel], ofType('attorney_fee'));
  partITotal += place([SCHEDULE_D_PART_I.accountant], ofType('accounting_fee'));
  partITotal += place(SCHEDULE_D_PART_I.commissions, ofType('executor_commission'));
  w.text(SCHEDULE_D_PART_I.total, formatMoneyInline(partITotal));

  // ── Part II — real property debts ────────────────────────────────────────
  partIITotal += place(SCHEDULE_D_PART_II.mortgages, ofType('mortgage'));
  w.text(SCHEDULE_D_PART_II.total, formatMoneyInline(partIITotal));

  // ── Part III — everything without a printed block, plus the overflow ──────
  const partIII = [
    ...ofType('last_illness_expenses', 'debt_of_decedent', 'accrued_property_taxes',
      'transfer_taxes_other_states', 'other'),
    ...overflow,
  ];

  let partIIITotal = 0;
  partIII.slice(0, SCHEDULE_D_PART_III_ROWS.length).forEach((item, i) => {
    const row = SCHEDULE_D_PART_III_ROWS[i];
    if (!row) return;
    w.text(row.type, `${DEDUCTION_TYPE_LABELS[item.type]} — ${item.description}`);
    w.text(row.name, item.payeeName ?? '');
    w.text(row.amount, formatMoneyInline(item.amount));
    partIIITotal += item.amount;
  });
  w.text(SCHEDULE_D_TOTALS.partIII, formatMoneyInline(partIIITotal));

  const attached = partIII.slice(SCHEDULE_D_PART_III_ROWS.length);
  const attachedTotal = attached.reduce((sum, item) => sum + item.amount, 0);
  // "(if none, enter zero)" — the form's instruction, so this box is written either way.
  w.text(SCHEDULE_D_TOTALS.additionalSchedules, formatMoneyInline(attachedTotal));
  if (attached.length > 0) {
    w.check(ADDITIONAL_COPIES.scheduleD1);
    w.check(ADDITIONAL_COPIES.scheduleD2);
  }

  // Line 6, printed once and taken from the computation — never re-added from the rows above.
  w.text(SCHEDULE_D_TOTALS.allDeductions, formatMoneyInline(data.line6_deductions));
}

/** Schedules B1–B4 Recap — the four schedule totals and their sum, which is Summary Page line 3. */
function fillRecap(w: FieldWriter, data: ITRFormData): void {
  w.text(RECAP.scheduleB1, formatMoneyInline(sumScheduleItems(data.scheduleB1)));
  w.text(RECAP.scheduleB2, formatMoneyInline(sumScheduleItems(data.scheduleB2)));
  w.text(RECAP.scheduleB3, formatMoneyInline(sumScheduleItems(data.scheduleB3)));
  w.text(RECAP.scheduleB4, formatMoneyInline(sumScheduleItems(data.scheduleB4)));
  w.text(RECAP.total, formatMoneyInline(data.line3_allOtherPersonalProperty));
}

function sumScheduleItems(items: ReadonlyArray<ScheduleItem>): number {
  return items.reduce((sum, item) => sum + item.fairMarketValue, 0);
}

/** Schedule B-4, "All Other Property" — eighteen rows, then the overflow checkbox. */
function fillScheduleB4(w: FieldWriter, items: ReadonlyArray<ScheduleItem>): void {
  items.slice(0, SCHEDULE_B4_ROWS.length).forEach((item, i) => {
    const f = SCHEDULE_B4_ROWS[i];
    if (!f) return;
    w.text(f.description, item.description);
    w.text(f.value, formatMoneyInline(item.fairMarketValue));
    w.text(f.equity, formatMoneyInline(item.fairMarketValue));
  });

  if (items.length > SCHEDULE_B4_ROWS.length) w.check(ADDITIONAL_COPIES.scheduleB4);
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
  const addr = resolveAddress(rep.address, rep.addressParts);
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

  // ── Form IT-PMT — the payment voucher bound into the booklet ──────────────
  fillPaymentVoucher(w, data, { fullName, ssn: [ssn3, ssn2, ssn4], dod: [dodMonth, dodDay, dodYear] });

  fillRecap(w, data);
  fillScheduleD(w, data);
  fillScheduleE(w, data.scheduleE);
  fillScheduleB4(w, data.scheduleB4);

  w.assertComplete();
  return pdf.save();
}
