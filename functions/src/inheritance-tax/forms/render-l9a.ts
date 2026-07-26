import type { L9AFormData } from '../types';
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

/**
 * Renders the NJ Affidavit Requesting Real Property Tax Waiver (Form L-9 / L-9(A)) as
 * print-ready HTML. Releases the Inheritance/Estate Tax lien on NJ real property.
 */
export function renderL9AHtml(data: L9AFormData): string {
  const beneficiaryRows = data.beneficiaries.map((b) => `
    <tr>
      <td>${esc(b.fullName)}</td>
      <td>${esc(b.relationship)}</td>
      <td style="text-align:center">${esc(b.taxClass)}</td>
      <td class="num">${money(b.interestValue)}</td>
    </tr>`).join('');

  const parcelBlocks = data.realProperties.map((p, i) => `
    <table class="parcel">
      <tr><td class="plabel">Parcel ${i + 1}</td><td>${esc(p.description)}</td></tr>
      <tr><td class="plabel">Passing to</td><td>${esc(p.beneficiaryName)}</td></tr>
      <tr><td class="plabel">Fair Market Value</td><td>${esc(money(p.fairMarketValue))}</td></tr>
      <tr><td class="plabel">County (of this parcel)</td><td>&nbsp;</td></tr>
      <tr><td class="plabel">Street &amp; Number</td><td>&nbsp;</td></tr>
      <tr><td class="plabel">Municipality</td><td>&nbsp;</td></tr>
      <tr><td class="plabel">Lot / Block</td><td>&nbsp;</td></tr>
      <tr><td class="plabel">Owner(s) of Record</td><td>&nbsp;</td></tr>
    </table>`).join('');

  const attachmentItems = data.requiredAttachments.map((a) => `<li>${esc(a)}</li>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NJ ${esc(data.formDesignation)} Real Property Tax Waiver — ${esc(data.decedentLastName)}, ${esc(data.decedentFirstName)}</title>
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
    .eligibility-note {
      border: 1px solid #999; background: #fcfcfc; padding: 8pt 10pt;
      margin: 8pt 0 16pt; font-size: 9pt; line-height: 1.5;
    }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8pt; }
    td, th { padding: 3pt 6pt; border: 1px solid #ccc; vertical-align: top; }
    th { background: #eee; font-weight: bold; text-align: left; }
    td.num { text-align: right; white-space: nowrap; }
    table.parcel { margin-bottom: 10pt; }
    table.parcel .plabel { width: 14em; font-size: 8pt; color: #555; }
    .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-bottom: 8pt; }
    .field { border: 1px solid #ccc; padding: 3pt 6pt; }
    .field .label { font-size: 8pt; color: #555; }
    .field .value { font-size: 11pt; }
    ul { margin: 4pt 0 8pt 1.4em; font-size: 9.5pt; }
    .sig-line { margin-top: 28pt; border-top: 1px solid #000; width: 70%; padding-top: 2pt; font-size: 9pt; }
    .notary { margin-top: 18pt; font-size: 9pt; }
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

  <h1>State of New Jersey<br>Affidavit Requesting Real Property Tax Waiver (${esc(data.formDesignation)})</h1>
  <p style="text-align:center;font-size:9pt;margin-bottom:12pt">
    ${esc(data.citation)}
  </p>

  <div class="disclaimer">${esc(data.disclaimer)}</div>

  <div class="checkpoint-banner">
    <strong>Attorney-Approved Computation</strong> &nbsp;|&nbsp;
    Checkpoint ID: <code>${esc(data.approvedCheckpointId)}</code> &nbsp;|&nbsp;
    Generated: ${esc(data.generatedAt)}
  </div>

  <div class="eligibility-note">
    <strong>Eligibility confirmed:</strong> all beneficiaries are Class A and no NJ Inheritance
    or Estate Tax is due, so this affidavit may be used in lieu of a full return.
    ${esc(data.filingNote)}
  </div>

  <h2>Decedent</h2>
  <div class="field-grid">
    ${field('Last Name', data.decedentLastName)}
    ${field('First Name', data.decedentFirstName)}
    ${data.decedentMiddleName !== undefined ? field('Middle Name', data.decedentMiddleName) : ''}
    ${field('SSN', data.decedentSSN)}
    ${field('Date of Death', data.dateOfDeath)}
    ${field('County of Residence', data.countyOfResidence)}
    ${field('Will', data.testate ? 'Testate (with will)' : 'Intestate (no will)')}
  </div>

  <h2>Estate Representative</h2>
  <div class="field-grid">
    ${field('Name', data.representative.name)}
    ${field('Title', data.representative.title)}
    ${field('Address', data.representative.address)}
    ${field('Phone', data.representative.phone)}
  </div>

  <h2>Beneficiaries</h2>
  <table>
    <thead>
      <tr><th>Full Name</th><th>Relationship</th><th style="text-align:center">Class</th><th class="num">Interest Value</th></tr>
    </thead>
    <tbody>${beneficiaryRows}</tbody>
  </table>

  <h2>New Jersey Real Property (lien to be released)</h2>
  ${parcelBlocks}

  <h2>Required Attachments</h2>
  <ul>${attachmentItems}</ul>
  <p style="font-size:9pt">Mail to: <strong>${esc(data.mailingAddress)}</strong></p>

  <div class="notary">
    Sworn and subscribed before me this ____ day of ____________, 20____.<br><br>
    ____________________________________ &nbsp;&nbsp; ____________________________________<br>
    Notary Public / Attesting Officer &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Signature of Deponent
  </div>

  <div class="sig-line">Deponent — ${esc(data.representative.name)}, ${esc(data.representative.title)}</div>

  <div class="generated">
    Generated ${esc(data.generatedAt)} &nbsp;|&nbsp; Checkpoint ${esc(data.approvedCheckpointId)}
  </div>

</div>
</body>
</html>`;
}
