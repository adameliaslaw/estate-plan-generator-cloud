import type { ITEXTFormData } from '../types';
import { WORKPAPER_BANNER_HTML } from './disclaimer';

function esc(s: string | number | boolean | undefined | null): string {
  if (s === undefined || s === null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function field(label: string, value: string): string {
  return `<div class="field"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div></div>`;
}

/**
 * Renders Form IT-EXT (Application for Extension of Time to File) as print-ready HTML.
 * Statutory basis: N.J.A.C. 18:26-9.1(b). The output prominently states that the tax
 * PAYMENT is not extended — only the filing deadline is.
 */
export function renderITEXTHtml(data: ITEXTFormData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NJ IT-EXT Extension to File — ${esc(data.decedentLastName)}, ${esc(data.decedentFirstName)}</title>
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
    .payment-notice {
      border: 3px solid #c00; background: #fff8f8; padding: 10pt 12pt;
      margin-bottom: 16pt; font-size: 10pt; line-height: 1.5;
    }
    .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-bottom: 8pt; }
    .field { border: 1px solid #ccc; padding: 3pt 6pt; }
    .field .label { font-size: 8pt; color: #555; }
    .field .value { font-size: 11pt; }
    .reason-box { border: 1px solid #ccc; padding: 6pt 8pt; min-height: 3em; margin-bottom: 8pt; }
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

  <h1>State of New Jersey<br>Application for Extension of Time to File a Return (IT-EXT)</h1>
  <p style="text-align:center;font-size:9pt;margin-bottom:12pt">
    Pursuant to N.J.A.C. 18:26-9.1(b) &nbsp;|&nbsp; Form IT-EXT (12-24)
  </p>

  <div class="disclaimer">${esc(data.disclaimer)}</div>

  <div class="checkpoint-banner">
    <strong>Attorney-Approved Computation</strong> &nbsp;|&nbsp;
    Checkpoint ID: <code>${esc(data.approvedCheckpointId)}</code> &nbsp;|&nbsp;
    Generated: ${esc(data.generatedAt)}
  </div>

  <div class="payment-notice">
    <strong>&#9888; PAYMENT IS NOT EXTENDED — N.J.A.C. 18:26-9.1(b)</strong><br>
    This application extends the time to <strong>file</strong> the return only. The tax
    <strong>payment remains due by the original deadline</strong>
    (${esc(data.originalDeadline)}, eight months from the date of death). Interest accrues
    at 10% per annum on any unpaid balance after that date (N.J.S.A. 54:35-3), regardless
    of this extension. Remit the estimated tax with this application.
  </div>

  <h2>Decedent</h2>
  <div class="field-grid">
    ${field('Last Name', data.decedentLastName)}
    ${field('First Name', data.decedentFirstName)}
    ${data.decedentMiddleName !== undefined ? field('Middle Name', data.decedentMiddleName) : ''}
    ${field('SSN', data.decedentSSN)}
    ${field('Date of Death', data.dateOfDeath)}
    ${field('County of Residence', data.countyOfResidence)}
    ${field('Domicile', data.isNJResident ? 'NJ Resident' : 'Nonresident (N.J.A.C. 18:26-2.15)')}
  </div>

  <h2>Estate Representative</h2>
  <div class="field-grid">
    ${field('Name', data.representative.name)}
    ${field('Title', data.representative.title)}
    ${field('Address', data.representative.address)}
    ${field('Phone', data.representative.phone)}
    ${data.representative.email !== undefined ? field('Email', data.representative.email) : ''}
  </div>

  <h2>Extension Requested</h2>
  <div class="field-grid">
    ${field('Original Filing & Payment Deadline', data.originalDeadline)}
    ${field('Additional Months Requested', `${data.extensionMonths} months`)}
    ${field('Extension Type', data.secondExtension ? 'Second extension (total +6 months)' : 'First extension (+4 months)')}
    ${field('Extended Filing Deadline', data.extendedFilingDeadline)}
  </div>

  <h2>Reason for Extension</h2>
  <div class="reason-box">${data.reason !== undefined ? esc(data.reason) : '&nbsp;'}</div>

  <div class="sig-line">Signature of estate representative — ${esc(data.representative.name)}, ${esc(data.representative.title)}</div>

  <div class="generated">
    Generated ${esc(data.generatedAt)} &nbsp;|&nbsp; Checkpoint ${esc(data.approvedCheckpointId)}
  </div>

</div>
</body>
</html>`;
}
