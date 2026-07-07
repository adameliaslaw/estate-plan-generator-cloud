/**
 * functions/src/generators/questionnaire-generator.ts
 *
 * Generator for the Questionnaire Summary — a readable, vaulted version
 * of the client's intake data at a specific point in time.
 *
 * Covers ALL fields from QuestionnaireData, PersonalInfo, SpouseInfo,
 * Child, Assets (all sub-types), Liabilities, Fiduciaries, Distribution,
 * HealthcarePreferences, and the Additional Information section.
 */

import { GeneratedDoc } from '../generate-documents';
import { buildStandardTitle } from '../unified-generator';
import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escape a value for safe interpolation into HTML text / double-quoted
 * attributes. Every client-controlled field in this summary is inserted into
 * vaulted HTML that is later rendered in the attorney's browser, so all such
 * values MUST be escaped to prevent stored HTML/script injection (R5-042).
 */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function val(v: unknown, fallback = '—'): string {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return esc(String(v));
}

function fmtCurrency(n: unknown): string {
  const num = Number(n);
  if (isNaN(num) || n === undefined || n === null || n === '') return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num);
}

function fmtPercent(n: unknown): string {
  if (n === undefined || n === null || n === '') return '—';
  return `${n}%`;
}

function field(label: string, value: unknown, fallback = '—'): string {
  return `<div class="field"><span class="label">${label}</span><span class="value">${val(value, fallback)}</span></div>`;
}

function row(...cols: string[]): string {
  return `<div class="field-group">${cols.join('')}</div>`;
}

function fiduciaryBlock(label: string, person: Record<string, unknown> | undefined | null): string {
  if (!person?.name) return `<div class="field"><span class="label">${label}</span><span class="value empty-note">Not specified</span></div>`;
  const parts: string[] = [];
  if (person.name) parts.push(`<strong>${esc(person.name)}</strong>`);
  if (person.relationship) parts.push(esc(person.relationship));
  const addr = [person.address, person.city, person.state, person.zip].filter(Boolean).join(', ');
  if (addr) parts.push(esc(addr));
  if (person.phone) parts.push(`Phone: ${esc(person.phone)}`);
  if (person.email) parts.push(`Email: ${esc(person.email)}`);
  return `<div class="field"><span class="label">${label}</span><span class="value">${parts.join('<br/>')}</span></div>`;
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

export async function generateQuestionnaire(
  clientData: admin.firestore.DocumentData,
  _firmData: admin.firestore.DocumentData,
  _packageType: string,
): Promise<GeneratedDoc> {
  const d = clientData;

  const clientFullName = [
    d.personalInfo?.firstName,
    d.personalInfo?.middleName,
    d.personalInfo?.lastName,
    d.personalInfo?.suffix,
  ].filter(Boolean).join(' ') || 'Unnamed Client';

  // ── CSS ─────────────────────────────────────────────────────────────────────
  let html = `
    <div class="questionnaire-summary">
      <style>
        .questionnaire-summary { font-family: 'Segoe UI', sans-serif; line-height: 1.6; color: #333; max-width: 850px; margin: 0 auto; padding: 0 10px; }
        .qs-header { text-align: center; margin-bottom: 40px; border-bottom: 2px solid #1a365d; padding-bottom: 20px; }
        .qs-header h1 { margin: 0 0 6px 0; color: #1a365d; font-size: 24px; }
        .qs-header p { color: #555; margin: 2px 0; }
        .section { margin-bottom: 28px; border-bottom: 1px solid #e2e8f0; padding-bottom: 20px; }
        .section:last-child { border-bottom: none; }
        .section-title { font-size: 15px; font-weight: 700; color: #fff; background: #1a365d; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 14px; border-radius: 4px; padding: 6px 12px; }
        .sub-section-title { font-size: 13px; font-weight: 700; margin: 14px 0 8px 0; color: #2b4a7a; border-bottom: 1px dashed #cbd5e0; padding-bottom: 3px; }
        .field-group { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 8px; }
        .field { margin-bottom: 6px; }
        .label { font-size: 11px; color: #666; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; display: block; }
        .value { font-size: 13px; color: #111; font-weight: 500; }
        .value.empty-note { color: #a0aec0; font-style: italic; font-weight: 400; }
        .list-item { margin-bottom: 10px; padding: 10px 12px; background: #f7fafc; border-radius: 6px; border: 1px solid #e2e8f0; }
        .list-item-title { font-weight: 700; font-size: 13px; color: #2d3748; margin-bottom: 6px; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
        th { text-align: left; font-size: 11px; color: #666; padding: 6px 8px; border-bottom: 2px solid #edf2f7; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
        td { padding: 7px 8px; border-bottom: 1px solid #edf2f7; }
        tr:last-child td { border-bottom: none; }
        .empty-section { color: #a0aec0; font-style: italic; font-size: 13px; padding: 6px 0; }
        .badge-yes { background: #c6f6d5; color: #276749; border-radius: 3px; padding: 1px 6px; font-size: 11px; font-weight: 700; }
        .badge-no  { background: #fed7d7; color: #9b2c2c; border-radius: 3px; padding: 1px 6px; font-size: 11px; font-weight: 700; }
      </style>

      <div class="qs-header">
        <h1>Questionnaire Summary</h1>
        <p>Vaulted Entry for <strong>${esc(clientFullName)}</strong></p>
        <p style="font-size:12px;color:#999;">Generated on ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })} at ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' })}</p>
      </div>
  `;

  // ── Section 1: Personal Information ────────────────────────────────────────
  const pi = d.personalInfo || {};
  html += `
    <div class="section">
      <div class="section-title">Personal Information</div>
      ${row(
    field('First Name', pi.firstName),
    field('Middle Name', pi.middleName),
    field('Last Name', pi.lastName),
    field('Suffix', pi.suffix),
  )}
      ${row(
    field('Date of Birth', pi.dob),
    field('SSN (Last 4)', pi.ssnLast4),
    field('Gender', d.isFemale ? 'Female' : (pi.gender ? String(pi.gender) : '—')),
    field('Marital Status', pi.maritalStatus),
  )}
      ${row(
    field('Email', pi.email),
    field('Phone', pi.phone),
    field('Alternate Phone', pi.alternatePhone),
  )}
      ${row(
    field('Citizenship', pi.citizenship),
    field('Occupation', pi.occupation),
    field('Employer', pi.employer),
  )}
      ${row(
    field('NJ Pregnancy Provision (isFemale)', d.isFemale),
  )}
      <div class="field">
        <span class="label">Home Address</span>
        <span class="value">${[esc(pi.address), `${esc(pi.city) || ''}, ${esc(pi.state) || ''} ${esc(pi.zip) || ''}`.trim(), pi.county ? `${esc(pi.county)} County` : ''].filter(v => v && v !== ', ').join('<br/>') || '—'}</span>
      </div>
      ${d.referralSource ? field('Referral Source', d.referralSource) : ''}
    </div>
  `;

  // ── Section 2: Spouse / Partner ─────────────────────────────────────────────
  const si = d.spouseInfo || {};
  if (si.firstName || si.lastName) {
    const spouseName = [si.firstName, si.middleName, si.lastName, si.suffix].filter(Boolean).join(' ');
    html += `
      <div class="section">
        <div class="section-title">Spouse / Partner</div>
        ${row(
      field('Full Name', spouseName),
      field('Date of Birth', si.dob),
      field('SSN (Last 4)', si.ssnLast4),
    )}
        ${row(
      field('Email', si.email),
      field('Phone', si.phone),
    )}
        ${row(
      field('Citizenship', si.citizenship),
      field('Occupation', si.occupation),
      field('Employer', si.employer),
    )}
        ${si.sameAddress ? field('Address', 'Same as client') : `
          <div class="field">
            <span class="label">Address</span>
            <span class="value">${[esc(si.address), `${esc(si.city) || ''}, ${esc(si.state) || ''} ${esc(si.zip) || ''}`.trim(), si.county ? `${esc(si.county)} County` : ''].filter(v => v && v !== ', ').join('<br/>') || '—'}</span>
          </div>
        `}
        ${row(
      field('Separate Representation', si.separateRepresentation),
      field('Separate Attorney', si.separateAttorneyName),
      field('Separate Attorney Firm', si.separateAttorneyFirm),
    )}
      </div>
    `;
  } else {
    html += `
      <div class="section">
        <div class="section-title">Spouse / Partner</div>
        <p class="empty-section">Not applicable (marital status: ${val(pi.maritalStatus)}).</p>
      </div>
    `;
  }

  // ── Section 3: Children & Dependents ───────────────────────────────────────
  const children = (d.children as Array<Record<string, unknown>>) || [];
  const grandchildren = (d.grandchildren as Array<Record<string, unknown>>) || [];
  const otherDependents = (d.otherDependents as Array<Record<string, unknown>>) || [];

  html += `
    <div class="section">
      <div class="section-title">Children &amp; Dependents</div>
      ${row(
    field('Has Children', d.hasChildren),
    field('Number of Children', d.numberOfChildren),
    field('Has Grandchildren', d.hasGrandchildren),
    field('Has Other Dependents', d.hasOtherDependents),
  )}
  `;

  if (children.length > 0) {
    html += `
      <div class="sub-section-title">Children</div>
      <table>
        <thead>
          <tr><th>Name</th><th>DOB</th><th>Relationship</th><th>Gender</th><th>Special Needs</th><th>Details</th></tr>
        </thead>
        <tbody>
          ${children.map((c) => `
            <tr>
              <td>${val(c.name)}</td>
              <td>${val(c.dob)}</td>
              <td>${val(c.relationship)}</td>
              <td>${val(c.gender)}</td>
              <td>${val(c.specialNeeds)}</td>
              <td>${val(c.specialNeedsDetails)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  if (grandchildren.length > 0) {
    html += `
      <div class="sub-section-title">Grandchildren</div>
      <table>
        <thead>
          <tr><th>Name</th><th>DOB</th><th>Parent (Your Child)</th><th>Gender</th><th>Special Needs</th></tr>
        </thead>
        <tbody>
          ${grandchildren.map((g) => `
            <tr>
              <td>${val(g.name)}</td>
              <td>${val(g.dob)}</td>
              <td>${val(g.parentName)}</td>
              <td>${val(g.gender)}</td>
              <td>${val(g.specialNeeds)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  if (otherDependents.length > 0) {
    html += `
      <div class="sub-section-title">Other Dependents</div>
      <table>
        <thead><tr><th>Name</th><th>Relationship</th><th>Notes</th></tr></thead>
        <tbody>
          ${otherDependents.map((dep) => `
            <tr>
              <td>${val(dep.name)}</td>
              <td>${val(dep.relationship)}</td>
              <td>${val(dep.notes)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // Guardians
  if (d.guardianPrimary || d.guardianAlternate) {
    html += `<div class="sub-section-title">Guardians (Minor Children)</div>`;
    html += fiduciaryBlock('Primary Guardian', d.guardianPrimary as Record<string, unknown>);
    html += fiduciaryBlock('Alternate Guardian', d.guardianAlternate as Record<string, unknown>);
  }

  html += `</div>`; // end children section

  // ── Section 4: Assets ──────────────────────────────────────────────────────
  const assets = d.assets || {};
  const realEstate: Array<Record<string, unknown>> = assets.realEstate || [];
  const bankAccounts: Array<Record<string, unknown>> = assets.bankAccounts || [];
  const investmentAccounts: Array<Record<string, unknown>> = assets.investmentAccounts || [];
  const retirementAccounts: Array<Record<string, unknown>> = assets.retirementAccounts || [];
  const lifeInsurance: Array<Record<string, unknown>> = assets.lifeInsurance || [];
  const businessInterests: Array<Record<string, unknown>> = assets.businessInterests || [];
  const personalProperty: Array<Record<string, unknown>> = assets.personalProperty || [];
  const digitalAssets: Array<Record<string, unknown>> = assets.digitalAssets || [];

  html += `<div class="section"><div class="section-title">Assets</div>`;

  if (assets.estimatedTotalEstate) {
    html += row(field('Estimated Total Estate', fmtCurrency(assets.estimatedTotalEstate)));
  }
  if (assets.notes) {
    html += field('General Asset Notes', assets.notes);
  }

  // Real Estate
  html += `<div class="sub-section-title">Real Property (${realEstate.length})</div>`;
  if (realEstate.length === 0) {
    html += `<p class="empty-section">None listed.</p>`;
  } else {
    realEstate.forEach((p, i) => {
      const addr = [p.address, p.city, p.state, p.zip].filter(Boolean).join(', ');
      html += `
        <div class="list-item">
          <div class="list-item-title">Property ${i + 1}: ${esc(addr) || 'Unknown Address'}</div>
          ${row(
        field('County', p.county),
        field('Block/Lot', p.blockLot),
        field('Deed Book/Page', p.deedBook && p.deedPage ? `${p.deedBook} / ${p.deedPage}` : undefined),
      )}
          ${row(
        field('Titling', p.titling),
        field('Estimated Value', fmtCurrency(p.estimatedValue)),
        field('Mortgage Balance', fmtCurrency(p.mortgageBalance)),
        field('Mortgage Lender', p.mortgageLender),
      )}
          ${row(
        field('Primary Residence', p.isPrimaryResidence),
        field('Transfer to Trust', p.transferToTrust),
        field('Trust Name', p.trustName),
      )}
          ${p.notes ? field('Notes', p.notes) : ''}
        </div>
      `;
    });
  }

  // Bank Accounts
  html += `<div class="sub-section-title">Bank / Savings Accounts (${bankAccounts.length})</div>`;
  if (bankAccounts.length === 0) {
    html += `<p class="empty-section">None listed.</p>`;
  } else {
    html += `<table>
      <thead><tr><th>Institution</th><th>Type</th><th>Acct # (Last 4)</th><th>Est. Balance</th><th>Titling</th><th>Beneficiary</th><th>Contingent</th><th>To Trust</th></tr></thead>
      <tbody>
        ${bankAccounts.map((a) => `
          <tr>
            <td>${val(a.institution)}</td>
            <td>${val(a.accountType)}</td>
            <td>${val(a.accountNumberLast4)}</td>
            <td>${fmtCurrency(a.estimatedBalance)}</td>
            <td>${val(a.titling)}</td>
            <td>${val(a.beneficiary)}</td>
            <td>${val(a.contingentBeneficiary)}</td>
            <td>${val(a.transferToTrust)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
  }

  // Investment Accounts
  html += `<div class="sub-section-title">Investment Accounts (${investmentAccounts.length})</div>`;
  if (investmentAccounts.length === 0) {
    html += `<p class="empty-section">None listed.</p>`;
  } else {
    html += `<table>
      <thead><tr><th>Institution</th><th>Type</th><th>Acct # (Last 4)</th><th>Est. Value</th><th>Titling</th><th>Beneficiary</th><th>Contingent</th><th>To Trust</th></tr></thead>
      <tbody>
        ${investmentAccounts.map((a) => `
          <tr>
            <td>${val(a.institution)}</td>
            <td>${val(a.accountType)}</td>
            <td>${val(a.accountNumberLast4)}</td>
            <td>${fmtCurrency(a.estimatedValue)}</td>
            <td>${val(a.titling)}</td>
            <td>${val(a.beneficiary)}</td>
            <td>${val(a.contingentBeneficiary)}</td>
            <td>${val(a.transferToTrust)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
  }

  // Retirement Accounts
  html += `<div class="sub-section-title">Retirement Accounts (${retirementAccounts.length})</div>`;
  if (retirementAccounts.length === 0) {
    html += `<p class="empty-section">None listed.</p>`;
  } else {
    html += `<table>
      <thead><tr><th>Institution</th><th>Type</th><th>Est. Value</th><th>Primary Beneficiary</th><th>%</th><th>Contingent</th><th>Inherited IRA</th></tr></thead>
      <tbody>
        ${retirementAccounts.map((a) => `
          <tr>
            <td>${val(a.institution)}</td>
            <td>${val(a.accountType)}</td>
            <td>${fmtCurrency(a.estimatedValue)}</td>
            <td>${val(a.primaryBeneficiary)}</td>
            <td>${fmtPercent(a.primaryBeneficiaryPercentage)}</td>
            <td>${val(a.contingentBeneficiary)}</td>
            <td>${val(a.isInheritedIra)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
  }

  // Life Insurance
  html += `<div class="sub-section-title">Life Insurance Policies (${lifeInsurance.length})</div>`;
  if (lifeInsurance.length === 0) {
    html += `<p class="empty-section">None listed.</p>`;
  } else {
    lifeInsurance.forEach((pol, i) => {
      html += `
        <div class="list-item">
          <div class="list-item-title">Policy ${i + 1}: ${val(pol.company)} — ${val(pol.insuranceType)}</div>
          ${row(
        field('Policy Number', pol.policyNumber),
        field('Face Value', fmtCurrency(pol.faceValue)),
        field('Cash Value', fmtCurrency(pol.cashValue)),
      )}
          ${row(
        field('Owner', pol.owner),
        field('Insured', pol.insured),
        field('Premium', pol.premiumAmount ? `${fmtCurrency(pol.premiumAmount)} / ${val(pol.premiumFrequency)}` : undefined),
      )}
          ${row(
        field('Primary Beneficiary', pol.primaryBeneficiary),
        field('Primary %', fmtPercent(pol.primaryBeneficiaryPercentage)),
        field('Contingent Beneficiary', pol.contingentBeneficiary),
        field('Contingent %', fmtPercent(pol.contingentBeneficiaryPercentage)),
      )}
          ${row(field('Transfer to Trust (ILIT)', pol.transferToTrust))}
          ${pol.notes ? field('Notes', pol.notes) : ''}
        </div>
      `;
    });
  }

  // Business Interests
  html += `<div class="sub-section-title">Business Interests (${businessInterests.length})</div>`;
  if (businessInterests.length === 0) {
    html += `<p class="empty-section">None listed.</p>`;
  } else {
    businessInterests.forEach((b, i) => {
      html += `
        <div class="list-item">
          <div class="list-item-title">Business ${i + 1}: ${val(b.businessName)}</div>
          ${row(
        field('Entity Type', b.entityType),
        field('State', b.state),
        field('EIN', b.ein),
      )}
          ${row(
        field('Ownership %', fmtPercent(b.ownershipPercentage)),
        field('Estimated Value', fmtCurrency(b.estimatedValue)),
      )}
          ${row(
        field('Operating Agreement', b.hasOperatingAgreement),
        field('Buy-Sell Agreement', b.hasBuysSellAgreement),
      )}
          ${b.notes ? field('Notes', b.notes) : ''}
        </div>
      `;
    });
  }

  // Personal Property
  html += `<div class="sub-section-title">Personal Property (${personalProperty.length})</div>`;
  if (personalProperty.length === 0) {
    html += `<p class="empty-section">None listed.</p>`;
  } else {
    html += `<table>
      <thead><tr><th>Description</th><th>Estimated Value</th><th>Location</th><th>Specific Bequest</th><th>Bequest Recipient</th><th>Notes</th></tr></thead>
      <tbody>
        ${personalProperty.map((p) => `
          <tr>
            <td>${val(p.description)}</td>
            <td>${fmtCurrency(p.estimatedValue)}</td>
            <td>${val(p.location)}</td>
            <td>${val(p.specificBequest)}</td>
            <td>${val(p.bequestRecipient)}</td>
            <td>${val(p.notes)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
  }

  // Digital Assets
  html += `<div class="sub-section-title">Digital Assets (${digitalAssets.length})</div>`;
  if (digitalAssets.length === 0) {
    html += `<p class="empty-section">None listed.</p>`;
  } else {
    html += `<table>
      <thead><tr><th>Description</th><th>Platform</th><th>Username</th><th>Est. Value</th><th>Credentials Location</th><th>Transfer Instructions</th></tr></thead>
      <tbody>
        ${digitalAssets.map((da) => `
          <tr>
            <td>${val(da.description)}</td>
            <td>${val(da.platform)}</td>
            <td>${val(da.accountUsername)}</td>
            <td>${fmtCurrency(da.estimatedValue)}</td>
            <td>${val(da.locationOfCredentials)}</td>
            <td>${val(da.transferInstructions)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
  }

  html += `</div>`; // end assets section

  // ── Section 5: Liabilities ─────────────────────────────────────────────────
  const liabilities = d.liabilities || {};
  const mortgages: Array<Record<string, unknown>> = liabilities.mortgages || [];
  const otherLiabilities: Array<Record<string, unknown>> = liabilities.otherLiabilities || [];

  html += `<div class="section"><div class="section-title">Liabilities</div>`;

  if (liabilities.estimatedTotalLiabilities) {
    html += row(field('Estimated Total Liabilities', fmtCurrency(liabilities.estimatedTotalLiabilities)));
  }
  if (liabilities.notes) html += field('Notes', liabilities.notes);

  html += `<div class="sub-section-title">Mortgages (${mortgages.length})</div>`;
  if (mortgages.length === 0) {
    html += `<p class="empty-section">None listed.</p>`;
  } else {
    html += `<table>
      <thead><tr><th>Property</th><th>Lender</th><th>Balance</th><th>Monthly Payment</th><th>Interest Rate</th><th>Maturity Date</th></tr></thead>
      <tbody>
        ${mortgages.map((m) => `
          <tr>
            <td>${val(m.propertyAddress)}</td>
            <td>${val(m.lender)}</td>
            <td>${fmtCurrency(m.balance)}</td>
            <td>${fmtCurrency(m.monthlyPayment)}</td>
            <td>${m.interestRate ? `${m.interestRate}%` : '—'}</td>
            <td>${val(m.maturityDate)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
  }

  html += `<div class="sub-section-title">Other Liabilities (${otherLiabilities.length})</div>`;
  if (otherLiabilities.length === 0) {
    html += `<p class="empty-section">None listed.</p>`;
  } else {
    html += `<table>
      <thead><tr><th>Description</th><th>Creditor</th><th>Type</th><th>Balance</th><th>Monthly Payment</th></tr></thead>
      <tbody>
        ${otherLiabilities.map((l) => `
          <tr>
            <td>${val(l.description)}</td>
            <td>${val(l.creditor)}</td>
            <td>${val(l.type)}</td>
            <td>${fmtCurrency(l.balance)}</td>
            <td>${fmtCurrency(l.monthlyPayment)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
  }

  html += `</div>`; // end liabilities section

  // ── Section 6: Fiduciaries ─────────────────────────────────────────────────
  const fid = d.fiduciaries || {};
  const exec = fid.executor || {};
  const trustee = fid.trustee || {};
  const poa = fid.powerOfAttorney || {};
  const hcp = fid.healthcareProxy || {};
  const guardian = fid.guardian || {};

  html += `<div class="section"><div class="section-title">Fiduciaries</div>`;

  html += `<div class="sub-section-title">Executor</div>`;
  html += fiduciaryBlock('Primary Executor', exec.primary);
  html += fiduciaryBlock('Alternate Executor', exec.alternate);
  html += fiduciaryBlock('Successor Executor', exec.successor);
  if (exec.compensation) {
    html += row(
      field('Compensation', exec.compensation),
      field('Compensation Amount', exec.compensationAmount ? fmtCurrency(exec.compensationAmount) : undefined),
      field('Bond Required', exec.bondRequired),
    );
  }

  html += `<div class="sub-section-title">Trustee</div>`;
  if (fid.trustee) {
    html += fiduciaryBlock('Primary Trustee', trustee.primary);
    html += fiduciaryBlock('Alternate Trustee', trustee.alternate);
    html += fiduciaryBlock('Successor Trustee', trustee.successor);
    html += fiduciaryBlock('Co-Trustee', trustee.coTrustee);
    if (trustee.compensation) {
      html += row(
        field('Compensation', trustee.compensation),
        field('Bond Required', trustee.bondRequired),
      );
    }
  } else {
    html += `<p class="empty-section">Not specified.</p>`;
  }

  html += `<div class="sub-section-title">Power of Attorney</div>`;
  if (fid.powerOfAttorney) {
    html += fiduciaryBlock('Agent (Primary)', poa.agent);
    html += fiduciaryBlock('Alternate Agent', poa.alternateAgent);
    html += fiduciaryBlock('Successor Agent', poa.successorAgent);
    html += row(
      field('Effective Date', poa.effectiveDate),
      field('Durable', poa.durability),
      field('Gifting Power', poa.giftingPower),
      field('Self-Dealing Power', poa.selfDealingPower),
    );
    if (Array.isArray(poa.financialPowers) && poa.financialPowers.length > 0) {
      html += field('Financial Powers', (poa.financialPowers as string[]).join(', '));
    }
    if (poa.limitations) html += field('Limitations', poa.limitations);
    if (poa.notes) html += field('Notes', poa.notes);
  } else {
    html += `<p class="empty-section">Not specified.</p>`;
  }

  html += `<div class="sub-section-title">Healthcare Proxy</div>`;
  if (fid.healthcareProxy) {
    html += fiduciaryBlock('Agent (Primary)', hcp.agent);
    html += fiduciaryBlock('Alternate Agent', hcp.alternateAgent);
    html += fiduciaryBlock('Successor Agent', hcp.successorAgent);
    html += row(field('HIPAA Authorization', hcp.hipaaAuthorization));
    if (hcp.notes) html += field('Notes', hcp.notes);
  } else {
    html += `<p class="empty-section">Not specified.</p>`;
  }

  html += `<div class="sub-section-title">Guardian (Minor Children)</div>`;
  if (fid.guardian) {
    html += fiduciaryBlock('Primary Guardian', guardian.primary);
    html += fiduciaryBlock('Alternate Guardian', guardian.alternate);
    html += row(
      field('Guardian for Minors', guardian.guardianForMinors),
      field('Guardian for Incapacity', guardian.guardianForIncapacity),
    );
    if (guardian.notes) html += field('Notes', guardian.notes);
  } else if (d.guardianPrimary) {
    // Fallback: some questionnaires store these at the top level
    html += fiduciaryBlock('Primary Guardian', d.guardianPrimary as Record<string, unknown>);
    html += fiduciaryBlock('Alternate Guardian', d.guardianAlternate as Record<string, unknown>);
  } else {
    html += `<p class="empty-section">Not specified.</p>`;
  }

  html += `</div>`; // end fiduciaries section

  // ── Section 7: Distribution / Wishes ───────────────────────────────────────
  const dist = d.distribution || {};
  const specificBequests: Array<Record<string, unknown>> = dist.specificBequests || [];
  const residualDistributions: Array<Record<string, unknown>> = dist.residualDistributions || [];
  const charitableBequests: Array<Record<string, unknown>> = dist.charitableBequests || [];

  const DIST_LABELS: Record<string, string> = {
    allToSpouse: 'All to spouse, then to children equally',
    equalToChildren: 'Equally to all children',
    specific: 'Specific distribution (see below)',
    custom: 'Custom (see notes)',
  };

  html += `<div class="section"><div class="section-title">Distribution Plan / Wishes</div>`;
  html += row(field('Primary Distribution Plan', DIST_LABELS[d.distributionPlan] || d.distributionPlan));
  html += row(
    field('Pour-Over to Trust', dist.pourOverToTrust),
    field('Trust Name', dist.trustName),
    field('Survivorship Period', dist.survivorshipPeriod ? `${dist.survivorshipPeriod} days` : undefined),
  );
  html += row(
    field('No-Contest Clause', dist.noContestClause),
    field('Spendthrift Provision', dist.spendthriftProvision),
  );
  if (dist.notes) html += field('Distribution Notes', dist.notes);

  html += `<div class="sub-section-title">Specific Bequests (${specificBequests.length})</div>`;
  if (specificBequests.length === 0) {
    html += `<p class="empty-section">None listed.</p>`;
  } else {
    html += `<table>
      <thead><tr><th>Description</th><th>Recipient</th><th>Relationship</th><th>Condition</th><th>Alternate</th></tr></thead>
      <tbody>
        ${specificBequests.map((b) => `
          <tr>
            <td>${val(b.description)}</td>
            <td>${val(b.recipient)}</td>
            <td>${val(b.recipientRelationship)}</td>
            <td>${val(b.condition)}</td>
            <td>${val(b.alternateRecipient)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
  }

  html += `<div class="sub-section-title">Residual Distributions (${residualDistributions.length})</div>`;
  if (residualDistributions.length === 0) {
    html += `<p class="empty-section">None listed (will use primary plan above).</p>`;
  } else {
    html += `<table>
      <thead><tr><th>Recipient</th><th>Relationship</th><th>%</th><th>Alternate</th><th>Per Stirpes</th></tr></thead>
      <tbody>
        ${residualDistributions.map((r) => `
          <tr>
            <td>${val(r.recipient)}</td>
            <td>${val(r.recipientRelationship)}</td>
            <td>${fmtPercent(r.percentage)}</td>
            <td>${val(r.alternateRecipient)}</td>
            <td>${val(r.perStirpes)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
  }

  html += `<div class="sub-section-title">Charitable Bequests (${charitableBequests.length})</div>`;
  if (charitableBequests.length === 0) {
    html += `<p class="empty-section">None listed.</p>`;
  } else {
    html += `<table>
      <thead><tr><th>Organization</th><th>EIN</th><th>Amount</th><th>Percentage</th><th>Purpose</th></tr></thead>
      <tbody>
        ${charitableBequests.map((c) => `
          <tr>
            <td>${val(c.organizationName)}</td>
            <td>${val(c.ein)}</td>
            <td>${fmtCurrency(c.amount)}</td>
            <td>${fmtPercent(c.percentage)}</td>
            <td>${val(c.purpose)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
  }

  html += `</div>`; // end distribution section

  // ── Section 8: Healthcare Preferences ─────────────────────────────────────
  const hcp2 = d.healthcarePreferences || {};
  html += `
    <div class="section">
      <div class="section-title">Healthcare Preferences &amp; Advance Directive</div>
      <div class="sub-section-title">End-of-Life Directives</div>
      ${row(
    field('Life Support', hcp2.lifeSupport),
    field('Artificial Nutrition', hcp2.artificialNutrition),
    field('Artificial Hydration', hcp2.artificialHydration),
  )}
      ${row(
    field('Pain Management', hcp2.painManagement),
    field('CPR Directive', hcp2.cprDirective),
  )}

      <div class="sub-section-title">Organ &amp; Anatomical Donation</div>
      ${row(
    field('Organ Donation', hcp2.organDonation),
    field('Donation Details', hcp2.organDonationDetails),
  )}
      ${row(
    field('Anatomical Gift', hcp2.anatomicalGift),
    field('Gift Organization', hcp2.anatomicalGiftOrganization),
  )}

      <div class="sub-section-title">NJ-Specific &amp; Personal Preferences</div>
      ${row(
    field('NJ ADRD Directive', hcp2.njADRD),
    field('Burial Preference', d.burialPreference),
    field('Burial Details', d.burialDetails),
  )}
      ${hcp2.personalStatement ? field('Personal Statement', hcp2.personalStatement) : ''}
      ${hcp2.religiousBeliefs ? field('Religious Beliefs', hcp2.religiousBeliefs) : ''}
      ${hcp2.notes ? field('Notes', hcp2.notes) : ''}
    </div>
  `;

  // ── Section 9: Additional Information ─────────────────────────────────────
  html += `
    <div class="section">
      <div class="section-title">Additional Information</div>
      ${row(
    field('Has Existing Estate Documents', d.hasExistingDocuments),
    field('Existing Documents Details', d.existingDocumentsDetails),
    field('Existing Documents Date', d.existingDocumentsDate),
  )}
      ${row(
    field('Has Pending Legal Matters', d.hasPendingLegalMatters),
    field('Pending Legal Details', d.pendingLegalDetails),
  )}
      ${d.additionalNotes ? field('Additional Notes', d.additionalNotes) : ''}
      ${d.referralSource ? field('Referral Source', d.referralSource) : ''}
    </div>
  `;

  // ── Section 10: Uploaded Documents ──────────────────────────────────────
  const uploads = (d.uploads as Array<Record<string, unknown>>) || [];
  if (uploads.length > 0) {
    html += `
      <div class="section">
        <div class="section-title">Uploaded Documents (${uploads.length})</div>
        <table>
          <thead><tr><th>File Name</th><th>Type</th><th>Size</th><th>Uploaded On</th></tr></thead>
          <tbody>
            ${uploads.map((u) => {
              const kb = u.size ? `${Math.round(Number(u.size) / 1024)} KB` : '—';
              return `<tr>
                <td>${val(u.name)}</td>
                <td>${val(u.type)}</td>
                <td>${kb}</td>
                <td>${val(u.date)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  // ── Close ──────────────────────────────────────────────────────────────────
  html += `</div>`; // end .questionnaire-summary

  return {
    docType: 'questionnaire',
    title: buildStandardTitle('questionnaire', clientFullName),
    content: html,
    status: 'draft',
  };
}
