/**
 * functions/src/generators/action-steps-generator.ts
 *
 * Generates a personalized Action Steps Checklist for the client.
 * Lists every post-signing task they and the attorney need to complete,
 * organized by category, with specific county clerk filing information
 * for each real property deed.
 */

import { callAI, sanitizeForPrompt, sanitizeObject, parseAIJson } from '../ai-client';
import { GeneratedDoc } from '../generate-documents';
import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// NJ County Clerk / Register of Deeds reference data
// ---------------------------------------------------------------------------

const NJ_COUNTY_RECORDING_INFO: Record<string, {
  office: string;
  address: string;
  phone: string;
  website: string;
  approxFee: string;
}> = {
  atlantic: {
    office: 'Atlantic County Clerk',
    address: '1333 Atlantic Avenue, Atlantic City, NJ 08401',
    phone: '(609) 343-2192',
    website: 'https://www.atlantic-county.org/clerk/',
    approxFee: '$40 for first page + $10 per additional page',
  },
  bergen: {
    office: 'Bergen County Clerk',
    address: '1 Bergen County Plaza, Room 120, Hackensack, NJ 07601',
    phone: '(201) 336-7020',
    website: 'https://www.co.bergen.nj.us/county-clerk',
    approxFee: '$40 for first page + $10 per additional page',
  },
  burlington: {
    office: 'Burlington County Clerk',
    address: '49 Rancocas Road, Mount Holly, NJ 08060',
    phone: '(609) 265-5020',
    website: 'https://www.co.burlington.nj.us/254/County-Clerk',
    approxFee: '$40 for first page + $10 per additional page',
  },
  camden: {
    office: 'Camden County Clerk',
    address: '520 Market Street, Camden, NJ 08102',
    phone: '(856) 225-7200',
    website: 'https://www.camdencounty.com/service/county-clerk/',
    approxFee: '$40 for first page + $10 per additional page',
  },
  cape_may: {
    office: 'Cape May County Clerk',
    address: '4 Moore Road, DN 106, Cape May Court House, NJ 08210',
    phone: '(609) 465-1010',
    website: 'https://www.capemaycountynj.gov/259/County-Clerk',
    approxFee: '$40 for first page + $10 per additional page',
  },
  cumberland: {
    office: 'Cumberland County Clerk',
    address: '60 West Broad Street, Bridgeton, NJ 08302',
    phone: '(856) 453-4860',
    website: 'https://www.cumberlandcountynj.gov/government/county-offices/county-clerk',
    approxFee: '$40 for first page + $10 per additional page',
  },
  essex: {
    office: 'Essex County Register of Deeds and Mortgages',
    address: '465 Dr. Martin Luther King Jr. Blvd., Newark, NJ 07102',
    phone: '(973) 621-4960',
    website: 'https://www.essexcountynj.org/register/',
    approxFee: '$40 for first page + $10 per additional page',
  },
  gloucester: {
    office: 'Gloucester County Clerk',
    address: '2 South Broad Street, Woodbury, NJ 08096',
    phone: '(856) 853-3237',
    website: 'https://www.gloucestercountynj.gov/237/County-Clerk',
    approxFee: '$40 for first page + $10 per additional page',
  },
  hudson: {
    office: 'Hudson County Register of Deeds',
    address: '257 Cornelison Avenue, Jersey City, NJ 07302',
    phone: '(201) 395-3898',
    website: 'https://www.hudsoncountynj.org/register-of-deeds/',
    approxFee: '$40 for first page + $10 per additional page',
  },
  hunterdon: {
    office: 'Hunterdon County Clerk',
    address: '71 Main Street, Flemington, NJ 08822',
    phone: '(908) 788-1214',
    website: 'https://www.co.hunterdon.nj.us/clerk.htm',
    approxFee: '$40 for first page + $10 per additional page',
  },
  mercer: {
    office: 'Mercer County Clerk',
    address: '209 South Broad Street, P.O. Box 8068, Trenton, NJ 08650',
    phone: '(609) 989-6465',
    website: 'https://www.mercercounty.org/government/county-clerk',
    approxFee: '$40 for first page + $10 per additional page',
  },
  middlesex: {
    office: 'Middlesex County Clerk',
    address: '75 Bayard Street, New Brunswick, NJ 08901',
    phone: '(732) 745-3003',
    website: 'https://www.middlesexcountynj.gov/government/offices/county-clerk',
    approxFee: '$40 for first page + $10 per additional page',
  },
  monmouth: {
    office: 'Monmouth County Clerk',
    address: '33 Mechanic Street, Freehold, NJ 07728',
    phone: '(732) 431-7324',
    website: 'https://www.monmouthcountyclerk.com',
    approxFee: '$40 for first page + $10 per additional page',
  },
  morris: {
    office: 'Morris County Clerk',
    address: '10 Court Street, Morristown, NJ 07960',
    phone: '(973) 285-6120',
    website: 'https://morriscountyclerk.org',
    approxFee: '$40 for first page + $10 per additional page',
  },
  ocean: {
    office: 'Ocean County Clerk',
    address: '118 Washington Street, P.O. Box 2191, Toms River, NJ 08754',
    phone: '(732) 929-2018',
    website: 'https://www.oceancounty.org/county-clerk',
    approxFee: '$40 for first page + $10 per additional page',
  },
  passaic: {
    office: 'Passaic County Clerk',
    address: '401 Grand Street, Paterson, NJ 07505',
    phone: '(973) 881-4760',
    website: 'https://www.passaiccountynj.org/government/offices/county-clerk',
    approxFee: '$40 for first page + $10 per additional page',
  },
  salem: {
    office: 'Salem County Clerk',
    address: '92 Market Street, Salem, NJ 08079',
    phone: '(856) 935-7510',
    website: 'https://www.salemcountynj.gov/county-clerk/',
    approxFee: '$40 for first page + $10 per additional page',
  },
  somerset: {
    office: 'Somerset County Clerk',
    address: '20 Grove Street, P.O. Box 3000, Somerville, NJ 08876',
    phone: '(908) 231-7006',
    website: 'https://www.co.somerset.nj.us/government/county-clerk',
    approxFee: '$40 for first page + $10 per additional page',
  },
  sussex: {
    office: 'Sussex County Clerk',
    address: '83 Spring Street, Suite 304, Newton, NJ 07860',
    phone: '(973) 579-0900',
    website: 'https://www.sussexcountyclerk.com',
    approxFee: '$40 for first page + $10 per additional page',
  },
  union: {
    office: 'Union County Clerk',
    address: '10 Elizabethtown Plaza, Elizabeth, NJ 07207',
    phone: '(908) 527-4100',
    website: 'https://www.ucnj.org/county-clerk/',
    approxFee: '$40 for first page + $10 per additional page',
  },
  warren: {
    office: 'Warren County Clerk',
    address: '413 Second Street, Belvidere, NJ 07823',
    phone: '(908) 475-6211',
    website: 'https://warrencountynj.gov/county-clerk.html',
    approxFee: '$40 for first page + $10 per additional page',
  },
};

function getCountyRecordingInfo(county: string) {
  const key = county.toLowerCase().replace(/\s+county$/i, '').trim().replace(/\s+/g, '_');
  return NJ_COUNTY_RECORDING_INFO[key] ?? {
    office: `${county} County Clerk`,
    address: 'Contact county clerk for address',
    phone: 'Contact county clerk',
    website: 'Contact county clerk',
    approxFee: 'Approximately $40 for first page + $10 per additional page',
  };
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const ACTION_STEPS_SYSTEM_PROMPT = `
You are an expert New Jersey estate planning attorney generating a personalized Action Steps Checklist for a client who has just completed their estate plan.

PURPOSE: This checklist tells the client and their attorney exactly what needs to happen after document signing — organized clearly, with specific deadlines, responsible parties, and filing information.

TONE: Professional but warm. Clear numbered steps. Use checkboxes (HTML checkbox inputs styled as ☐) for each item.

DOCUMENT STRUCTURE:

SECTION 1 — IMMEDIATE STEPS (Do within 30 days of signing)
  • Sign all documents in front of witnesses/notary as indicated
  • Store originals safely (fireproof safe or safe deposit box)
  • Give copies to: agents named in POA, healthcare representative, executor/trustee

SECTION 2 — TRUST FUNDING — REAL ESTATE (if applicable)
  For each property being transferred to the trust:
  • Record the Deed with the appropriate County Clerk
    - Include: Deed + Affidavit of Consideration + GIT/REP-3 + filing fee
    - Specific county clerk information: address, phone, fee, website
  • Notify mortgage lender of trust transfer (due-on-sale clause advisory)
  • Update homeowner's insurance to name trustee as additional insured
  • Notify HOA if applicable

SECTION 3 — TRUST FUNDING — FINANCIAL ACCOUNTS
  • Open a trust bank account in the trust's name
  • Re-title existing bank/investment accounts to trust (contact each institution)
  • Transfer non-retirement brokerage accounts to trust
  • NOTE: Do NOT transfer IRAs/401(k)s/403(b)s into the trust (tax consequences)

SECTION 4 — BENEFICIARY DESIGNATION UPDATES
  • Update IRA beneficiary designations (coordinate with trust plan)
  • Update 401(k)/403(b) beneficiary designations
  • Update life insurance beneficiary designations
  • Update POD (payable on death) designations on bank accounts
  • Update TOD (transfer on death) designations on investment accounts

SECTION 5 — ADDITIONAL TASKS
  • Update vehicle registrations if applicable
  • Review and update employer HR records (emergency contacts, beneficiaries)
  • Register organ donation preference with NJ Motor Vehicle Commission (if desired)
  • Store digital credentials per digital asset plan

SECTION 6 — ANNUAL REVIEW REMINDER
  • Schedule annual review with attorney
  • Events triggering immediate review: birth/adoption, death of beneficiary/fiduciary, divorce/remarriage, major asset acquisition, move to another state, change in tax law

FORMATTING:
• Full HTML (no <html>/<body>/<head>).
• <h1> for title, <h2> for sections.
• Each action item: <div class="action-item"><span class="checkbox">☐</span> <strong>[action]</strong> — [detail]</div>
• Include a table of key contacts at the end.
• Include county clerk tables for each property.

OUTPUT FORMAT — JSON only:
{
  "title": "Action Steps Checklist — [Client Name]",
  "content": "<complete HTML>",
  "metadata": {
    "wordCount": <number>,
    "estimatedPages": <number>,
    "executionRequirements": [],
    "witnessRequired": false,
    "notarizationRequired": false
  }
}
`.trim();

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export async function generateActionSteps(
  clientData: admin.firestore.DocumentData,
  firmData: admin.firestore.DocumentData,
  packageType: string,
  trustTypes?: string[],
): Promise<GeneratedDoc> {
  const safe = sanitizeObject(clientData);
  const safeFirm = sanitizeObject(firmData);

  const pi = safe.personalInfo ?? {};
  const fiduciaries = safe.fiduciaries ?? {};
  const trusts: admin.firestore.DocumentData[] = safe.trusts ?? [];
  const assets = safe.assets ?? {};
  const distribution = safe.distribution ?? {};

  const clientFullName = [pi.firstName, pi.middleName, pi.lastName, pi.suffix]
    .filter(Boolean)
    .join(' ');

  const hasTrust = ['guardian', 'fortress'].includes(packageType);
  const primaryTrust = trusts[0];
  const trustName = sanitizeForPrompt(
    primaryTrust?.trustName ??
    distribution.trustName ??
    (hasTrust ? `The ${clientFullName} Revocable Living Trust` : ''),
  );

  const realEstate: admin.firestore.DocumentData[] = assets.realEstate ?? [];
  const propertiesForTrust = realEstate.filter(
    (r: admin.firestore.DocumentData) => r.transferToTrust,
  );

  // Build county recording info for each property
  const countyRecordingDetails = propertiesForTrust.map(
    (r: admin.firestore.DocumentData) => {
      const county = sanitizeForPrompt(r.county ?? pi.county ?? '');
      const info = getCountyRecordingInfo(county);
      return {
        address: sanitizeForPrompt(r.address ?? ''),
        city: sanitizeForPrompt(r.city ?? ''),
        county,
        recordingOffice: info.office,
        recordingAddress: info.address,
        phone: info.phone,
        website: info.website,
        fee: info.approxFee,
        mortgage: r.mortgageBalance ? `${sanitizeForPrompt(r.mortgageLender ?? 'lender')} ($${r.mortgageBalance.toLocaleString()})` : 'None',
      };
    },
  );

  const bankAccounts: admin.firestore.DocumentData[] = (assets.bankAccounts ?? []).filter(
    (b: admin.firestore.DocumentData) => b.transferToTrust,
  );
  const investmentAccounts: admin.firestore.DocumentData[] = (assets.investmentAccounts ?? []).filter(
    (i: admin.firestore.DocumentData) => i.transferToTrust,
  );
  const retirementAccounts: admin.firestore.DocumentData[] = assets.retirementAccounts ?? [];
  const lifeInsurance: admin.firestore.DocumentData[] = assets.lifeInsurance ?? [];

  const executor = fiduciaries.executor ?? {};
  const poa = fiduciaries.powerOfAttorney ?? {};
  const proxy = fiduciaries.healthcareProxy ?? {};

  const userPrompt = `
Generate a complete personalized Action Steps Checklist using this client data:

CLIENT: ${clientFullName}
Package: ${packageType} (${hasTrust ? 'includes trust' : 'no trust'})
Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}

${hasTrust ? `TRUST: ${trustName}` : ''}

PROPERTIES TO DEED INTO TRUST (${propertiesForTrust.length}):
${propertiesForTrust.length === 0 ? 'None.' : countyRecordingDetails.map((r, i) => `
  Property ${i + 1}: ${r.address}, ${r.city}, NJ
  County: ${r.county}
  Recording Office: ${r.recordingOffice}
  Address: ${r.recordingAddress}
  Phone: ${r.phone}
  Website: ${r.website}
  Approximate Recording Fee: ${r.fee}
  Mortgage: ${r.mortgage}
  Documents to file: Deed + Affidavit of Consideration + GIT/REP-3 + filing fee
`).join('\n')}

BANK/INVESTMENT ACCOUNTS TO RE-TITLE TO TRUST (${bankAccounts.length + investmentAccounts.length}):
${[...bankAccounts, ...investmentAccounts].map((a: admin.firestore.DocumentData) =>
    `• ${sanitizeForPrompt(a.institution ?? '')} — ${a.accountType}`
  ).join('\n') || 'None specified.'}

RETIREMENT ACCOUNTS (update beneficiary designations only — do NOT transfer to trust):
${retirementAccounts.map((r: admin.firestore.DocumentData) =>
    `• ${sanitizeForPrompt(r.institution ?? '')} ${r.accountType} — current beneficiary: ${sanitizeForPrompt(r.primaryBeneficiary ?? 'unknown')}`
  ).join('\n') || 'None.'}

LIFE INSURANCE (update beneficiary designations):
${lifeInsurance.map((l: admin.firestore.DocumentData) =>
    `• ${sanitizeForPrompt(l.company ?? '')} — current beneficiary: ${sanitizeForPrompt(l.primaryBeneficiary ?? 'unknown')} — transfer to trust: ${l.transferToTrust ? 'Yes (ILIT consideration)' : 'No'}`
  ).join('\n') || 'None.'}

KEY CONTACTS TO GIVE COPIES OF DOCUMENTS:
  Executor: ${sanitizeForPrompt(executor.primary?.name ?? 'TBD')} — ${sanitizeForPrompt(executor.primary?.phone ?? '')} — ${sanitizeForPrompt(executor.primary?.email ?? '')}
  Alternate Executor: ${sanitizeForPrompt(executor.alternate?.name ?? 'None')}
  POA Agent: ${sanitizeForPrompt(poa.agent?.name ?? 'TBD')} — ${sanitizeForPrompt(poa.agent?.phone ?? '')}
  Healthcare Rep: ${sanitizeForPrompt(proxy.agent?.name ?? 'TBD')} — ${sanitizeForPrompt(proxy.agent?.phone ?? '')}

FIRM: ${sanitizeForPrompt(safeFirm.firmName ?? '')}
  Phone: ${safeFirm.firmPhone ?? ''}
  Email: ${safeFirm.firmEmail ?? ''}

Generate the complete action steps checklist. For each real property, include the specific county clerk's name, address, phone, website, and approximate recording fee. Include all sections: immediate steps, trust funding (real estate with specific county info), financial account re-titling, beneficiary designation updates, and annual review reminder.
`.trim();

  const raw = await callAI(ACTION_STEPS_SYSTEM_PROMPT, userPrompt, safeFirm, {
    model: 'gpt-4.1',
    temperature: 0.25,
    maxTokens: 8192,
    jsonMode: true,
  });

  const parsed = parseAIJson<{ title: string; content: string }>(raw);

  return {
    docType: 'actionSteps',
    title: parsed.title ?? `Action Steps Checklist — ${clientFullName}`,
    content: parsed.content ?? '',
    status: 'draft',
  };
}
