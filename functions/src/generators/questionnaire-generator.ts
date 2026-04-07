/**
 * functions/src/generators/questionnaire-generator.ts
 *
 * Generator for the Questionnaire Summary — a readable, vaulted version
 * of the client's intake data at a specific point in time.
 */

import { GeneratedDoc } from '../generate-documents';
import { buildStandardTitle } from '../unified-generator';
import * as admin from 'firebase-admin';

/**
 * Generates a structured HTML summary of the questionnaire data.
 * This is stored in the document vault to preserve the "state of the world"
 * that led to the generated documents.
 */
export async function generateQuestionnaire(
  clientData: admin.firestore.DocumentData,
  _firmData: admin.firestore.DocumentData,
  _packageType: string,
): Promise<GeneratedDoc> {
  const data = clientData;
  const clientFullName = [
    data.personalInfo?.firstName,
    data.personalInfo?.middleName,
    data.personalInfo?.lastName,
    data.personalInfo?.suffix
  ].filter(Boolean).join(' ') || 'Unnamed Client';

  let html = `
    <div class="questionnaire-summary">
      <style>
        .questionnaire-summary { font-family: sans-serif; line-height: 1.5; color: #333; max-width: 800px; margin: 0 auto; }
        .section { margin-bottom: 30px; border-bottom: 1px solid #eee; padding-bottom: 20px; }
        .section-title { font-size: 18px; font-weight: bold; color: #1a365d; text-transform: uppercase; margin-bottom: 15px; border-left: 4px solid #1a365d; padding-left: 10px; }
        .field-group { display: grid; grid-template-cols: 1fr 1fr; gap: 15px; margin-bottom: 10px; }
        .field { margin-bottom: 5px; }
        .label { font-size: 12px; color: #666; font-weight: 600; text-transform: uppercase; display: block; }
        .value { font-size: 14px; color: #000; font-weight: 500; }
        .sub-section-title { font-size: 14px; font-weight: bold; margin: 15px 0 10px 0; color: #4a5568; border-bottom: 1px dashed #cbd5e0; padding-bottom: 2px; }
        .list-item { margin-bottom: 10px; padding: 10px; background: #f8fafc; border-radius: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th { text-align: left; font-size: 12px; color: #666; padding: 8px; border-bottom: 2px solid #edf2f7; }
        td { padding: 8px; border-bottom: 1px solid #edf2f7; font-size: 14px; }
        .empty-note { italic; color: #a0aec0; font-size: 13px; }
      </style>

      <div style="text-align: center; margin-bottom: 40px;">
        <h1 style="margin-bottom: 5px; color: #1a365d;">Questionnaire Summary</h1>
        <p style="color: #666; margin: 0;">Vaulted Entry for <strong>${clientFullName}</strong></p>
        <p style="font-size: 12px; color: #999;">Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
      </div>
  `;

  // --- Section 1: Personal Info ---
  html += `
    <div class="section">
      <div class="section-title">About You</div>
      <div class="field-group">
        <div class="field"><span class="label">Name</span><span class="value">${clientFullName}</span></div>
        <div class="field"><span class="label">Date of Birth</span><span class="value">${data.personalInfo?.dob || '---'}</span></div>
        <div class="field"><span class="label">Citizenship</span><span class="value">${data.personalInfo?.citizenship || '---'}</span></div>
        <div class="field"><span class="label">Gender</span><span class="value">${data.isFemale ? 'Female' : 'Male'}</span></div>
      </div>
      <div class="field">
        <span class="label">Address</span>
        <span class="value">
          ${data.personalInfo?.street || ''}<br/>
          ${data.personalInfo?.city || ''}, ${data.personalInfo?.state || ''} ${data.personalInfo?.zip || ''}<br/>
          ${data.personalInfo?.county ? `${data.personalInfo.county} County` : ''}
        </span>
      </div>
    </div>
  `;

  // --- Section 2: Spouse ---
  if (data.spouseInfo?.firstName) {
    const spouseName = [data.spouseInfo.firstName, data.spouseInfo.middleName, data.spouseInfo.lastName, data.spouseInfo.suffix].filter(Boolean).join(' ');
    html += `
      <div class="section">
        <div class="section-title">Spouse / Partner</div>
        <div class="field-group">
          <div class="field"><span class="label">Name</span><span class="value">${spouseName}</span></div>
          <div class="field"><span class="label">Date of Birth</span><span class="value">${data.spouseInfo.dob || '---'}</span></div>
          <div class="field"><span class="label">Citizenship</span><span class="value">${data.spouseInfo.citizenship || '---'}</span></div>
        </div>
      </div>
    `;
  }

  // --- Section 3: Children ---
  const children = (data.children as Array<Record<string, unknown>>) || [];
  html += `
    <div class="section">
      <div class="section-title">Children & Dependents</div>
      <div class="field"><span class="label">Has Children</span><span class="value">${data.hasChildren ? 'Yes' : 'No'}</span></div>
      ${children.length > 0 ? `
        <table>
          <thead>
            <tr><th>Name</th><th>DOB</th><th>Relationship</th><th>Special Needs?</th></tr>
          </thead>
          <tbody>
            ${children.map((c: Record<string, unknown>) => `
              <tr>
                <td>${[c.firstName, c.lastName].filter(Boolean).join(' ')}</td>
                <td>${c.dob || '---'}</td>
                <td>${c.relationship || 'Child'}</td>
                <td>${c.hasSpecialNeeds ? 'Yes' : 'No'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : '<p class="empty-note">No children listed.</p>'}
    </div>
  `;

  // --- Section 4: Fiduciaries ---
  const fid = data.fiduciaries || {};
  html += `
    <div class="section">
      <div class="section-title">Fiduciaries</div>
      
      <div class="sub-section-title">Executors</div>
      <div class="field-group">
        <div class="field"><span class="label">Primary</span><span class="value">${fid.executor?.primary?.name || '---'}</span></div>
        <div class="field"><span class="label">Alternate</span><span class="value">${fid.executor?.alternate?.name || '---'}</span></div>
      </div>

      <div class="sub-section-title">Trustees</div>
      <div class="field-group">
        <div class="field"><span class="label">Primary</span><span class="value">${fid.trustee?.primary?.name || '---'}</span></div>
        <div class="field"><span class="label">Alternate</span><span class="value">${fid.trustee?.alternate?.name || '---'}</span></div>
      </div>

      <div class="sub-section-title">Power of Attorney</div>
      <div class="field-group">
        <div class="field"><span class="label">Primary</span><span class="value">${fid.powerOfAttorney?.agent?.name || '---'}</span></div>
        <div class="field"><span class="label">Alternate</span><span class="value">${fid.powerOfAttorney?.alternate?.name || '---'}</span></div>
      </div>

      <div class="sub-section-title">Healthcare Representative</div>
      <div class="field-group">
        <div class="field"><span class="label">Primary</span><span class="value">${fid.healthcareProxy?.agent?.name || '---'}</span></div>
        <div class="field"><span class="label">Alternate</span><span class="value">${fid.healthcareProxy?.alternate?.name || '---'}</span></div>
      </div>
    </div>
  `;

  // --- Section 5: Distribution ---
  html += `
    <div class="section">
      <div class="section-title">Distribution Plan</div>
      <div class="field">
        <span class="label">Primary Plan</span>
        <span class="value">${data.distributionPlan === 'allToSpouse' ? 'All to Spouse, then Children' : (data.distributionPlan || '---')}</span>
      </div>
      <div class="field">
        <span class="label">Specific Gifts</span>
        <span class="value">${data.distribution?.specificBequeaths || 'None listed'}</span>
      </div>
    </div>
  `;

  // --- Section 6: Assets (Summary) ---
  const assets = data.assets || {};
  const realEstateCount = (assets.realEstate as Array<unknown>)?.length || 0;
  const accountsCount = (assets.financialAccounts as Array<unknown>)?.length || 0;
  
  html += `
    <div class="section">
      <div class="section-title">Assets Overview</div>
      <div class="field-group">
        <div class="field"><span class="label">Real Estate</span><span class="value">${realEstateCount} Properties</span></div>
        <div class="field"><span class="label">Financial Accounts</span><span class="value">${accountsCount} Accounts</span></div>
      </div>
    </div>
  `;

  html += `</div>`;

  return {
    docType: 'questionnaire',
    title: buildStandardTitle('questionnaire', clientFullName),
    content: html,
    status: 'draft',
  };
}
