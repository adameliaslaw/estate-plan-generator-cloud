import type { ITEstateFormData } from '../types';
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

function field(label: string, value: string): string {
  return `<div class="field"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div></div>`;
}

function row(label: string, value: string): string {
  return `<tr><td>${esc(label)}</td><td class="num">${esc(value)}</td></tr>`;
}

/**
 * Renders Form IT-Estate (NJ Resident Decedent Estate Tax Return) as print-ready HTML.
 * Statutory basis: N.J.S.A. 54:38-1. Shows the Simplified Method computation for
 * 2002-2016 deaths; for 2017 deaths it directs the attorney to NJ's official calculator.
 */
export function renderITEstateHtml(data: ITEstateFormData): string {
  const is2017 = data.regime === '2017';

  const computationRows = is2017
    ? `${row('Taxable Estate (IT-R Net Estate)', money(data.taxableEstate))}
       ${row('Filing Threshold', money(data.exemptionThreshold))}
       <tr class="total"><td>Tentative NJ Estate Tax</td><td class="num">Requires NJ 2017 Calculator</td></tr>`
    : `${row('Line 1 — Taxable Estate (IT-R Net Estate)', money(data.taxableEstate))}
       ${row('Worksheet Line 2 — Exemption Reduction', money(data.exemptionAmount ?? 0))}
       ${row('Worksheet Line 3 — Adjusted Taxable Estate', money(data.adjustedTaxableEstate ?? 0))}
       ${row('Line 10(a) — Tentative NJ Estate Tax', data.tentativeTax !== null ? money(data.tentativeTax) : '—')}
       ${row('Line 11(a) — Credit for NJ Inheritance Tax Paid', money(data.inheritanceTaxCredit))}
       <tr class="total"><td>Line 13(a) — Net NJ Estate Tax Due</td><td class="num">${esc(data.netEstateTaxDue !== null ? money(data.netEstateTaxDue) : '—')}</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NJ IT-Estate Tax Return — ${esc(data.decedentLastName)}, ${esc(data.decedentFirstName)}</title>
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
    .calc-notice {
      border: 3px solid #c00; background: #fff8f8; padding: 10pt 12pt;
      margin-bottom: 16pt; font-size: 10pt; line-height: 1.5;
    }
    .method-note {
      border: 1px solid #999; background: #fcfcfc; padding: 8pt 10pt;
      margin: 8pt 0 16pt; font-size: 9pt; line-height: 1.5;
    }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8pt; }
    td, th { padding: 3pt 6pt; border: 1px solid #ccc; vertical-align: top; }
    td.num { text-align: right; white-space: nowrap; }
    tr.total td { font-weight: bold; border-top: 2px solid #000; }
    .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-bottom: 8pt; }
    .field { border: 1px solid #ccc; padding: 3pt 6pt; }
    .field .label { font-size: 8pt; color: #555; }
    .field .value { font-size: 11pt; }
    .sig-line { margin-top: 28pt; border-top: 1px solid #000; width: 60%; padding-top: 2pt; font-size: 9pt; }
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

  <h1>State of New Jersey<br>Resident Decedent Estate Tax Return (IT-Estate)</h1>
  <p style="text-align:center;font-size:9pt;margin-bottom:12pt">
    Pursuant to N.J.S.A. 54:38-1 &nbsp;|&nbsp; ${esc(data.regime === '2017' ? 'Form IT-Estate 2017' : 'Form IT-Estate (Simplified Method, Column A)')} &nbsp;|&nbsp; Regime: ${esc(data.regime)}
  </p>

  <div class="disclaimer">${esc(data.disclaimer)}</div>

  <div class="checkpoint-banner">
    <strong>Attorney-Approved Computation</strong> &nbsp;|&nbsp;
    Checkpoint ID: <code>${esc(data.approvedCheckpointId)}</code> &nbsp;|&nbsp;
    Generated: ${esc(data.generatedAt)}
  </div>

  ${is2017 ? `
  <div class="calc-notice">
    <strong>&#9888; 2017 ESTATE TAX — USE NJ'S OFFICIAL CALCULATOR</strong><br>
    For 2017 deaths the NJ Estate Tax is a circular computation applying the IRC §2058
    State Death Tax Deduction to the taxable estate. New Jersey requires its official
    2017 Estate Tax Calculator to determine the tentative tax; this tool does
    <strong>not</strong> fabricate a rate schedule for 2017. The attorney must compute the
    tax on Form IT-Estate 2017.
  </div>` : ''}

  <!-- ── Decedent ── -->
  <h2>Decedent</h2>
  <div class="field-grid">
    ${field('Last Name', data.decedentLastName)}
    ${field('First Name', data.decedentFirstName)}
    ${data.decedentMiddleName !== undefined ? field('Middle Name', data.decedentMiddleName) : ''}
    ${field('SSN', data.decedentSSN)}
    ${field('Date of Death', data.dateOfDeath)}
    ${field('County of Residence', data.countyOfResidence)}
    ${field('Domicile', data.isNJResident ? 'NJ Resident' : 'Nonresident')}
    ${field('Estate Tax Return Required', data.filingRequired ? 'Yes' : 'No')}
  </div>

  <!-- ── Computation ── -->
  <h2>NJ Estate Tax Computation</h2>
  <table>${computationRows}</table>
  <p style="font-size:9pt;margin-bottom:8pt">Estate Tax filing &amp; payment deadline (9 months from date of death): <strong>${esc(data.estateTaxDeadline)}</strong></p>

  <div class="method-note">
    <strong>Basis:</strong> ${esc(data.citation)}<br>
    ${esc(data.note)}
  </div>

  <h2>Estate Representative</h2>
  <div class="field-grid">
    ${field('Name', data.representative.name)}
    ${field('Title', data.representative.title)}
    ${field('Address', data.representative.address)}
    ${field('Phone', data.representative.phone)}
  </div>

  <div class="sig-line">Signature of estate representative — ${esc(data.representative.name)}, ${esc(data.representative.title)}</div>

  <div class="generated">
    Generated ${esc(data.generatedAt)} &nbsp;|&nbsp; Checkpoint ${esc(data.approvedCheckpointId)}
  </div>

</div>
</body>
</html>`;
}
