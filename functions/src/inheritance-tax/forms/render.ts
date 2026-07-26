import type {
  BeneficiaryWorksheetRow,
  DisclaimerScheduleItem,
  ITRFormData,
  ScheduleDeductionItem,
  ScheduleItem,
  TaxClassLine,
} from '../types';
import { WORKPAPER_BANNER_HTML } from './disclaimer';

function esc(s: string | number | boolean | undefined | null): string {
  if (s === undefined || s === null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function yesNo(b: boolean): string {
  return b ? 'Yes' : 'No';
}

function row(label: string, value: string, indent = false): string {
  const indentStyle = indent ? ' style="padding-left:2em"' : '';
  return `<tr><td${indentStyle}>${esc(label)}</td><td class="num">${esc(value)}</td></tr>`;
}

function taxClassRow(lineNum: number, label: string, line: TaxClassLine): string {
  const taxStr = lineNum <= 11 || lineNum === 14 ? 'Exempt' : money(line.taxDue);
  return `
    <tr>
      <td>Line ${lineNum} — ${esc(label)}</td>
      <td class="num">${line.totalBeneficiaries}</td>
      <td class="num">${money(line.totalDistribution)}</td>
      <td class="num">${line.totalExemption > 0 ? money(line.totalExemption) : '—'}</td>
      <td class="num">${money(line.totalTaxableAmount)}</td>
      <td class="num">${taxStr}</td>
    </tr>`;
}

const DEDUCTION_TYPE_LABELS: Record<string, string> = {
  funeral_expenses: 'Funeral expenses (N.J.A.C. 18:26-7.8)',
  last_illness_expenses: 'Last illness expenses (N.J.A.C. 18:26-7.8)',
  administration_expenses: 'Administration expenses (N.J.A.C. 18:26-7.1)',
  debt_of_decedent: 'Debts of decedent (N.J.A.C. 18:26-7.1)',
  mortgage: 'Mortgage on secured property (N.J.A.C. 18:26-7.4)',
  executor_commission: 'Executor commission (N.J.A.C. 18:26-7.10(d), R.2025 d.152)',
  attorney_fee: 'Attorney fee (N.J.A.C. 18:26-7.11)',
  accounting_fee: 'Accounting fee (N.J.A.C. 18:26-7.1)',
  accrued_property_taxes: 'Accrued property taxes on NJ realty (N.J.A.C. 18:26-7.15)',
  transfer_taxes_other_states: 'Transfer/inheritance taxes — other jurisdictions (N.J.A.C. 18:26-7.16)',
  other: 'Other',
};

function renderScheduleAssets(
  title: string,
  carryLabel: string,
  items: ScheduleItem[],
): string {
  if (items.length === 0) {
    return `<h2>${esc(title)}</h2><p style="font-size:9.5pt;margin-bottom:12pt">None.</p>`;
  }
  const itemRows = items.map((item, i) => `
    <tr>
      <td style="text-align:center;white-space:nowrap">${i + 1}</td>
      <td>${esc(item.beneficiaryName)}</td>
      <td>${esc(item.description)}</td>
      <td class="num">${money(item.fairMarketValue)}</td>
    </tr>`).join('');
  const total = items.reduce((s, i) => s + i.fairMarketValue, 0);
  return `
  <h2>${esc(title)}</h2>
  <table>
    <thead>
      <tr>
        <th style="width:3em;text-align:center">Item #</th>
        <th>Beneficiary / Transferee</th>
        <th>Description</th>
        <th class="num">Fair Market Value at Date of Death</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
    <tfoot>
      <tr class="total">
        <td colspan="3">${esc(carryLabel)}</td>
        <td class="num">${money(total)}</td>
      </tr>
    </tfoot>
  </table>`;
}

function renderScheduleD(items: ScheduleDeductionItem[]): string {
  if (items.length === 0) {
    return `<h2>Schedule D — Deductions (N.J.A.C. 18:26-7)</h2><p style="font-size:9.5pt;margin-bottom:12pt">None.</p>`;
  }
  const itemRows = items.map((item, i) => {
    const execElig = item.executorCommissionEligibility;
    const execNote = execElig !== undefined
      ? `<br><small style="color:#555">Eligibility attested (N.J.A.C. 18:26-7.10(d)): ` +
        `Residue property: ${yesNo(execElig.propertyWasResidueNotSpecificallyDevised)}; ` +
        `Sold by executor: ${yesNo(execElig.propertyWasSoldByExecutor)}. ` +
        `Notes: ${esc(execElig.notes)}</small>`
      : '';
    const xferElig = item.transferTaxEligibility;
    const xferNote = xferElig !== undefined
      ? `<br><small style="color:#555">Eligibility attested (N.J.A.C. 18:26-7.16): ` +
        `Jurisdiction: ${esc(xferElig.taxingJurisdiction)}; ` +
        `Property also NJ-taxable: ${yesNo(xferElig.taxedPropertyIsAlsoNJTaxable)}. ` +
        `Notes: ${esc(xferElig.notes)}</small>`
      : '';
    return `
    <tr>
      <td style="text-align:center;white-space:nowrap">${i + 1}</td>
      <td>${esc(DEDUCTION_TYPE_LABELS[item.type] ?? item.type)}${execNote}${xferNote}</td>
      <td>${esc(item.description)}</td>
      <td class="num">${money(item.amount)}</td>
    </tr>`;
  }).join('');
  const total = items.reduce((s, i) => s + i.amount, 0);
  return `
  <h2>Schedule D — Deductions (N.J.A.C. 18:26-7)</h2>
  <table>
    <thead>
      <tr>
        <th style="width:3em;text-align:center">Item #</th>
        <th>Deduction Type</th>
        <th>Description</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
    <tfoot>
      <tr class="total">
        <td colspan="3">Total Deductions (carries to Line 6)</td>
        <td class="num">${money(total)}</td>
      </tr>
    </tfoot>
  </table>`;
}

function renderDisclaimerSchedule(items: DisclaimerScheduleItem[]): string {
  if (items.length === 0) return '';
  const itemRows = items.map((item, i) => `
    <tr>
      <td style="text-align:center;white-space:nowrap">${i + 1}</td>
      <td>${esc(item.disclaimantName)}</td>
      <td>${esc(item.dateDisclaimed)}</td>
      <td>${item.bequestDescriptions.map((d) => esc(d)).join('<br>')}</td>
      <td>${esc(item.notes)}</td>
    </tr>`).join('');
  return `
  <h2>Disclaimer Log (N.J.A.C. 18:26-2.11)</h2>
  <table>
    <thead>
      <tr>
        <th style="width:3em;text-align:center">Item #</th>
        <th>Disclaimant</th>
        <th>Date Disclaimed</th>
        <th>Bequests Disclaimed</th>
        <th>Attorney Notes</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>`;
}

function renderBeneficiaryWorksheet(
  taxClass: 'C' | 'D',
  rows: BeneficiaryWorksheetRow[],
): string {
  const classLabel = taxClass === 'C'
    ? 'Class C Beneficiary Worksheet (N.J.A.C. 18:26-2.6 — Siblings, children-in-law)'
    : 'Class D Beneficiary Worksheet (N.J.A.C. 18:26-2.7 — All others not in Class A, C, or E)';

  if (rows.length === 0) {
    return `<h2>${esc(classLabel)}</h2><p style="font-size:9.5pt;margin-bottom:12pt">No Class ${taxClass} beneficiaries.</p>`;
  }

  const dataRows = rows.map((row) => {
    const r = row.result;
    const bracketSummary = r.brackets.length > 0
      ? r.brackets
          .map((b) => `${(b.bracket.rate * 100).toFixed(0)}% on ${money(b.amountInBracket)} = ${money(b.tax)}`)
          .join('; ')
      : (r.taxDue === 0 ? 'Exempt / below de minimis' : '—');
    return `
    <tr>
      <td>${esc(row.lastName)}, ${esc(row.firstName)}<br><small style="color:#555">${esc(row.address)}</small></td>
      <td>${esc(row.relationship.replace(/_/g, ' '))}</td>
      <td class="num">${money(r.scaledBequeathed)}</td>
      <td class="num">${r.exemption > 0 ? money(r.exemption) : '—'}</td>
      <td class="num">${money(r.taxableAmount)}</td>
      <td style="font-size:9pt">${esc(bracketSummary)}</td>
      <td class="num">${money(r.taxDue)}</td>
    </tr>`;
  }).join('');

  const totalTax = rows.reduce((s, r) => s + r.result.taxDue, 0);

  return `
  <h2>${esc(classLabel)}</h2>
  <table class="breakdown-table">
    <thead>
      <tr>
        <th>Beneficiary / Address</th>
        <th>Relationship</th>
        <th class="num">Line 9 Allocation</th>
        <th class="num">Exemption</th>
        <th class="num">Taxable Amount</th>
        <th>Bracket Detail</th>
        <th class="num">Tax Due</th>
      </tr>
    </thead>
    <tbody>${dataRows}</tbody>
    <tfoot>
      <tr class="total">
        <td colspan="6">Total Class ${taxClass} Tax Due (carries to Line 1${taxClass})</td>
        <td class="num">${money(totalTax)}</td>
      </tr>
    </tfoot>
  </table>`;
}

/**
 * Renders an approved IT-R computation as a self-contained HTML document.
 *
 * The output is print-ready from any browser. Every page includes the
 * required disclaimer. Includes all supporting schedules (A, B, B-1 through
 * B-4, C, D) and per-beneficiary Class C/D worksheets.
 * Line numbers refer to IT-R (12-24).
 * Verified against itrbk.pdf and it-rinst.pdf (nj.gov, retrieved Jun 2026).
 */
export function renderITRHtml(data: ITRFormData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NJ IT-R Transfer Inheritance Tax Return — ${esc(data.decedentLastName)}, ${esc(data.decedentFirstName)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Times New Roman', Times, serif; font-size: 11pt; color: #000; background: #fff; }
    .page { max-width: 8.5in; margin: 0 auto; padding: 0.75in; }
    h1 { font-size: 14pt; text-align: center; margin-bottom: 4pt; }
    h2 { font-size: 12pt; margin: 16pt 0 6pt; border-bottom: 1px solid #000; padding-bottom: 2pt; }
    .disclaimer {
      border: 2px solid #000; padding: 8pt; margin-bottom: 16pt;
      font-size: 9pt; font-weight: bold; text-align: center; line-height: 1.4;
    }
    .checkpoint-banner {
      border: 1px solid #555; background: #f8f8f8; padding: 6pt 8pt;
      margin-bottom: 12pt; font-size: 9pt;
    }
    .estate-tax-notice {
      border: 3px solid #c00; background: #fff8f8; padding: 10pt 12pt;
      margin-bottom: 16pt; font-size: 10pt; line-height: 1.5;
    }
    .nonresident-notice {
      border: 3px solid #c60; background: #fffbf0; padding: 10pt 12pt;
      margin-bottom: 16pt; font-size: 10pt; line-height: 1.5;
    }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8pt; }
    td, th { padding: 3pt 6pt; border: 1px solid #ccc; vertical-align: top; }
    th { background: #eee; font-weight: bold; text-align: left; }
    td.num { text-align: right; white-space: nowrap; }
    tr.section-header td { background: #e8e8e8; font-weight: bold; }
    tr.total td { font-weight: bold; border-top: 2px solid #000; }
    .breakdown-table th, .breakdown-table td { font-size: 9.5pt; }
    .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
    .field-grid .field { border: 1px solid #ccc; padding: 3pt 6pt; }
    .field .label { font-size: 8pt; color: #555; }
    .field .value { font-size: 11pt; }
    .generated { margin-top: 24pt; font-size: 8.5pt; color: #555; text-align: right; }
    @media print {
      body { font-size: 10pt; }
      .page { padding: 0.5in; }
      @page { margin: 0.5in; }
    }
  </style>
</head>
<body>
<div class="page">
  ${WORKPAPER_BANNER_HTML}

  <h1>State of New Jersey<br>Transfer Inheritance Tax Return (IT-R)</h1>
  <p style="text-align:center;font-size:9pt;margin-bottom:12pt">
    Pursuant to N.J.S.A. 54:33-1 et seq. &nbsp;|&nbsp; Form IT-R (12-24) &nbsp;|&nbsp; Rule set: ${esc(data.ruleSetId)}
  </p>

  <div class="disclaimer">${esc(data.disclaimer)}</div>

  <div class="checkpoint-banner">
    <strong>Attorney-Approved Computation</strong> &nbsp;|&nbsp;
    Checkpoint ID: <code>${esc(data.approvedCheckpointId)}</code> &nbsp;|&nbsp;
    Generated: ${esc(data.generatedAt)}
  </div>

  ${!data.isNJResident ? `
  <div class="nonresident-notice">
    <strong>&#9888; NONRESIDENT DECEDENT — N.J.A.C. 18:26-2.15</strong><br>
    NJ Transfer Inheritance Tax applies <strong>only</strong> to (1) NJ real property
    and (2) tangible personal property located in New Jersey (N.J.S.A. 54:34-2).
    Intangible property (bank accounts, securities, bonds, retirement accounts,
    virtual currency) is generally <strong>NOT</strong> subject to NJ inheritance tax
    for nonresident decedents. Attorney must verify that all schedules on this return
    contain only NJ-situs property and must consult N.J.A.C. 18:26-2.15 to confirm
    whether the nonresident ratio tax formula applies to this matter.
  </div>` : ''}

  ${data.njEstateTaxApplies ? `
  <div class="estate-tax-notice">
    <strong>&#9888; NJ ESTATE TAX NOTICE</strong><br>
    The NJ Estate Tax (N.J.S.A. 54:38-1) applied to this date of death
    (${esc(data.dateOfDeath)}).${data.njEstateTaxExemption !== undefined ? ` The applicable exemption was $${data.njEstateTaxExemption.toLocaleString('en-US')}.` : ''}
    The NJ Estate Tax is a <strong>separate tax</strong> from the Transfer Inheritance Tax shown on this form.
    Generate it with the <strong>form-estate</strong> command (Form IT-Estate). For 2002–2016
    deaths the tool computes the Simplified Method tax (verified rate table); for 2017 deaths
    the attorney must use New Jersey's official §2058 estate tax calculator.
  </div>` : ''}

  <!-- ── Cover Page ── -->
  <h2>Cover Page</h2>
  <div class="field-grid">
    <div class="field"><div class="label">Decedent Last Name</div><div class="value">${esc(data.decedentLastName)}</div></div>
    <div class="field"><div class="label">Decedent First Name</div><div class="value">${esc(data.decedentFirstName)}</div></div>
    ${data.decedentMiddleName ? `<div class="field"><div class="label">Middle Name</div><div class="value">${esc(data.decedentMiddleName)}</div></div>` : ''}
    ${data.decedentAka ? `<div class="field"><div class="label">Also Known As</div><div class="value">${esc(data.decedentAka)}</div></div>` : ''}
    <div class="field"><div class="label">SSN</div><div class="value">${esc(data.decedentSSN)}</div></div>
    <div class="field"><div class="label">Date of Death</div><div class="value">${esc(data.dateOfDeath)}</div></div>
    <div class="field"><div class="label">County of Residence</div><div class="value">${esc(data.countyOfResidence)}</div></div>
    <div class="field"><div class="label">Decedent Domicile</div><div class="value">${data.isNJResident ? 'NJ Resident' : 'Nonresident (N.J.A.C. 18:26-2.15)'}</div></div>
    <div class="field"><div class="label">Will Exists</div><div class="value">${yesNo(data.willExists)}</div></div>
    <div class="field"><div class="label">Trust Exists</div><div class="value">${yesNo(data.trustExists)}</div></div>
    <div class="field"><div class="label">Federal Return Filed</div><div class="value">${yesNo(data.federalReturnFiled)}</div></div>
    <div class="field"><div class="label">Virtual Currency (Schedule B-4)</div><div class="value">${yesNo(data.virtualCurrencyExists)}</div></div>
    <div class="field"><div class="label">Disclaimers Exist</div><div class="value">${yesNo(data.disclaimersExist)}</div></div>
  </div>

  <h2>Personal Representative</h2>
  <div class="field-grid">
    <div class="field"><div class="label">Name</div><div class="value">${esc(data.representative.name)}</div></div>
    <div class="field"><div class="label">Title</div><div class="value">${esc(data.representative.title)}</div></div>
    <div class="field"><div class="label">Address</div><div class="value">${esc(data.representative.address)}</div></div>
    <div class="field"><div class="label">Phone</div><div class="value">${esc(data.representative.phone)}</div></div>
    ${data.representative.email ? `<div class="field"><div class="label">Email</div><div class="value">${esc(data.representative.email)}</div></div>` : ''}
  </div>

  <!-- ── Schedule A ── -->
  ${renderScheduleAssets(
    'Schedule A — New Jersey Real Property (N.J.S.A. 54:34-1(a))',
    'Total Schedule A (carries to Line 1)',
    data.scheduleA,
  )}

  <!-- ── Schedule B ── -->
  ${renderScheduleAssets(
    'Schedule B — Closely Held Businesses (IT-R (12-24) Line 2)',
    'Total Schedule B (carries to Line 2)',
    data.scheduleB,
  )}

  <!-- ── Schedule B-1 ── -->
  ${renderScheduleAssets(
    'Schedule B-1 — Financial Institution Accounts (savings, checking, CDs, IRAs, money market)',
    'Total Schedule B-1',
    data.scheduleB1,
  )}

  <!-- ── Schedule B-2 ── -->
  ${renderScheduleAssets(
    'Schedule B-2 — Stocks and Co-ops',
    'Total Schedule B-2',
    data.scheduleB2,
  )}

  <!-- ── Schedule B-3 ── -->
  ${renderScheduleAssets(
    'Schedule B-3 — Municipal and Corporate Bonds (NOT US Savings Bonds — those are B-4)',
    'Total Schedule B-3',
    data.scheduleB3,
  )}

  <!-- ── Schedule B-4 ── -->
  ${renderScheduleAssets(
    'Schedule B-4 — All Other Personal Property (virtual currency, US Savings Bonds, autos, tangible personal property, cash)',
    'Total Schedule B-4',
    data.scheduleB4,
  )}

  <!-- ── Schedule B-1 through B-4 Recap ── -->
  <h2>Schedule B-1 through B-4 Recap (carries to Line 3)</h2>
  <table>
    <thead>
      <tr><th>Schedule</th><th>Description</th><th class="num">Total</th></tr>
    </thead>
    <tbody>
      <tr><td>B-1</td><td>Financial institution accounts</td><td class="num">${money(data.scheduleB1.reduce((s, i) => s + i.fairMarketValue, 0))}</td></tr>
      <tr><td>B-2</td><td>Stocks and co-ops</td><td class="num">${money(data.scheduleB2.reduce((s, i) => s + i.fairMarketValue, 0))}</td></tr>
      <tr><td>B-3</td><td>Municipal and corporate bonds</td><td class="num">${money(data.scheduleB3.reduce((s, i) => s + i.fairMarketValue, 0))}</td></tr>
      <tr><td>B-4</td><td>All other personal property</td><td class="num">${money(data.scheduleB4.reduce((s, i) => s + i.fairMarketValue, 0))}</td></tr>
    </tbody>
    <tfoot>
      <tr class="total"><td colspan="2">Total B-1 through B-4 (carries to Line 3)</td><td class="num">${money(data.line3_allOtherPersonalProperty)}</td></tr>
    </tfoot>
  </table>

  <!-- ── Schedule C ── -->
  ${renderScheduleAssets(
    'Schedule C — Transfers (lifetime transfers within 3 years of death, incomplete transfers, payable-on-death)',
    'Total Schedule C (carries to Line 4)',
    data.scheduleC,
  )}

  <!-- ── Schedule D ── -->
  ${renderScheduleD(data.scheduleD)}

  <!-- ── Estate Summary (Lines 1-9) ── -->
  <h2>Estate Summary</h2>
  <table>
    ${row('Line 1 — New Jersey Real Property (Schedule A)', money(data.line1_njRealProperty))}
    ${row('Line 2 — Closely Held Businesses (Schedule B)', money(data.line2_closelyHeldBusiness))}
    ${row('Line 3 — All Other Personal Property (Schedules B-1 through B-4 Recap)', money(data.line3_allOtherPersonalProperty))}
    ${row('Line 4 — Transfers (Schedule C)', money(data.line4_transfers))}
    ${row('Line 5 — Gross Estate (Total Lines 1 through 4)', money(data.line5_grossEstate))}
    ${row('Line 6 — Deductions (Schedule D)', money(data.line6_deductions))}
    ${row('Line 7 — Net Estate (Line 5 minus Line 6)', money(data.line7_netEstate))}
    ${row('Line 8 — Contingent Amount included on Line 7', money(data.line8_contingentAmount))}
    ${row('Line 9 — Balance of Estate (Line 7 minus Line 8)', money(data.line9_balanceOfEstate))}
  </table>

  <!-- ── Tax Class Distribution Table (Lines 10-14) ── -->
  <h2>Tax Class Distribution (Lines 10–14)</h2>
  <table class="breakdown-table">
    <thead>
      <tr>
        <th>Line / Class</th>
        <th class="num"># Beneficiaries</th>
        <th class="num">Total Distribution</th>
        <th class="num">Total Exemption</th>
        <th class="num">Total Taxable Amount</th>
        <th class="num">Tax Due</th>
      </tr>
    </thead>
    <tbody>
      ${taxClassRow(10, 'A – Spouse / Civil Union Partner (Exempt)', data.line10_classA_spouse)}
      ${taxClassRow(11, 'A – Other (Exempt)', data.line11_classA_other)}
      ${taxClassRow(12, 'C — 11%–16% after $25,000 exemption per beneficiary', data.line12_classC)}
      ${taxClassRow(13, 'D — 15%–16%; no per-beneficiary exemption', data.line13_classD)}
      ${taxClassRow(14, 'E (Exempt)', data.line14_classE)}
    </tbody>
  </table>

  <!-- ── Class C Beneficiary Worksheet ── -->
  ${renderBeneficiaryWorksheet('C', data.classCWorksheet)}

  <!-- ── Class D Beneficiary Worksheet ── -->
  ${renderBeneficiaryWorksheet('D', data.classDWorksheet)}

  <!-- ── Tax Computation Summary (Lines 15-22) ── -->
  <h2>Tax Computation Summary</h2>
  <table>
    ${row('Line 15 — Compromise Tax Due on Line 8 Amount', money(data.line15_compromiseTax))}
    ${row('Line 16 — Contingent Tax', money(data.line16_contingentTax))}
    ${row('Line 17 — Total Tax Due (Total Lines 10 through 16)', money(data.line17_totalTax))}
    ${row('Line 18 — Interest Due (if applicable; 10% per annum on unpaid tax)', money(data.line18_interestDue))}
    ${row('Line 19 — Total Amount Due (Line 17 plus Line 18)', money(data.line19_totalAmountDue))}
    ${row('Line 20 — Payments Made Prior to Filing', money(data.line20_priorPayments))}
    ${data.line20_priorPaymentSchedule
      .map((p) => row(
        p.paidOn !== undefined ? `Payment made ${p.paidOn}` : 'Payment made (date not recorded)',
        money(p.amount),
        true,
      ))
      .join('\n    ')}
    <tr class="total">
      <td>Line 21 — Balance Due (if Line 20 &lt; Line 19)</td>
      <td class="num">${esc(money(data.line21_balanceDue))}</td>
    </tr>
    ${row('Line 22 — Refund (if Line 20 > Line 19)', money(data.line22_refund))}
    ${data.extendedFilingDeadline
      ? `${row('Payment Deadline (8 months from date of death — N.J.S.A. 54:35-3; N.J.A.C. 18:26-9.1). Adjusted past weekends and NJ holidays. TAX PAYMENT IS NOT EXTENDED BY IT-EXT.', data.filingDeadline)}
    ${row('Extended Filing Deadline (IT-EXT filed — N.J.A.C. 18:26-9.1(b)). Filing only — payment still due above. Adjusted past weekends and NJ holidays.', data.extendedFilingDeadline)}`
      : row('Filing and Payment Deadline (8 months from date of death — N.J.S.A. 54:35-3; N.J.A.C. 18:26-9.1). Automatically adjusted past weekends and NJ public holidays per N.J.S.A. 36:1-1 and N.J.A.C. 18:2-4.12.', data.filingDeadline)
    }
  </table>

  <!-- ── Disclaimer Log (supplemental) ── -->
  ${data.disclaimerSchedule !== undefined ? renderDisclaimerSchedule(data.disclaimerSchedule) : ''}

  <div class="generated">
    Generated ${esc(data.generatedAt)} &nbsp;|&nbsp; Checkpoint ${esc(data.approvedCheckpointId)}
  </div>

</div>
</body>
</html>`;
}
