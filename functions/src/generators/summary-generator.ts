/**
 * functions/src/generators/summary-generator.ts
 *
 * Generates a plain-English Estate Plan Summary document for the client.
 * This is a non-legal, client-friendly overview of their complete estate plan
 * — what they have, who does what, and what happens at death or incapacity.
 *
 * Not a legal document; does not require execution. Used as a client take-home.
 */

import { callAI, sanitizeForPrompt, sanitizeObject, parseAIJson } from '../ai-client';
import { GeneratedDoc } from '../generate-documents';
import { DOCUMENT_SCHEMA } from '../document-schemas';
import { buildStandardTitle } from '../unified-generator';
import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SUMMARY_SYSTEM_PROMPT = `
You are an expert New Jersey estate planning attorney creating a clear, comprehensive, plain-English Estate Plan Summary for a client.

PURPOSE: This document is a CLIENT-FRIENDLY overview of their complete estate plan. It is NOT a legal document and does not require signatures. It should help the client understand:
1. What documents they have signed and what each one does
2. Who they have named for each role (executor, trustee, agents, etc.)
3. What happens to their assets at death
4. What happens if they become incapacitated
5. What they still need to do (funding, beneficiary designations, etc.)

TONE AND STYLE:
• Write in warm, clear plain English — imagine explaining this to a smart non-lawyer.
• Avoid legal jargon; when you must use a legal term, define it immediately.
• Use numbered lists and bullet points for easy scanning.
• Use bold headings for each section.
• Keep sentences short and direct.
• Be specific — use actual names and actual provisions from the client data.

DOCUMENT STRUCTURE:

SECTION 1 — YOUR ESTATE PLAN AT A GLANCE
  • Brief 2-paragraph intro: what an estate plan is, why it matters
  • Summary table listing each document in the package, its purpose, and execution status

SECTION 2 — YOUR DOCUMENTS AND WHAT THEY DO
  For each document in the client's package, provide:
  • Document name (bolded)
  • 2-3 sentence plain-English description of what it does
  • Who is named in what role
  • When it takes effect

SECTION 3 — WHO YOU NAMED AND WHY IT MATTERS
  Table format listing:
  • Role | Person Named | Alternate | What They Can Do
  (Include: Executor, Trustee if applicable, Power of Attorney Agent, Healthcare Representative, Guardian if applicable)

SECTION 4 — WHAT HAPPENS TO YOUR ASSETS
  • At death: who inherits what, in plain terms
  • If trust: what goes into the trust, what passes through the will/probate
  • Beneficiary designations note (retirement accounts, life insurance, POD accounts pass outside the estate)
  • Specific bequests if any

SECTION 5 — IF YOU BECOME INCAPACITATED
  • Who manages your finances (POA agent)
  • Who makes healthcare decisions (healthcare representative)
  • What your specific healthcare preferences are (life support, nutrition, organ donation)
  • When does the POA take effect (immediate or springing)

SECTION 6 — YOUR NEXT STEPS (FUNDING AND IMPLEMENTATION)
  • List specific action items:
    - For each real estate property: deed needs to be recorded (county clerk, filing fee)
    - For trust: open trust bank account, re-title accounts to trust
    - Update beneficiary designations on retirement accounts and life insurance to coordinate with trust plan
    - Store documents safely; give copies to agents
    - Schedule annual review

SECTION 7 — YOUR IMPORTANT CONTACTS
  Table: Attorney name/firm/phone, Key fiduciaries and their contact info

FORMATTING:
• Full HTML (no <html>/<body>/<head>).
• <h1> for title, <h2> for sections, <h3> for subsections, <p> for paragraphs.
• Use <table> for tables, <ul>/<li> for lists.
• Style to look like a professional client summary — not a legal document.

CONSISTENCY RULE: You will receive a standardized CLIENT DATA BLOCK.
Use EXACTLY the names, addresses, and relationships as provided —
do not rephrase, abbreviate, or reformat any proper nouns.

OUTPUT FORMAT — JSON only:
{
  "title": "Your Estate Plan Summary — [Client Name]",
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

export async function generateEstatePlanSummary(
  clientData: admin.firestore.DocumentData,
  firmData: admin.firestore.DocumentData,
  packageType: string,
  _trustTypes?: string[],
): Promise<GeneratedDoc> {
  const safe = sanitizeObject(clientData);
  const safeFirm = sanitizeObject(firmData);

  // Use canonical serialized data from unified-generator (Phase 1)
  const serializedData = (safe as Record<string, unknown>)._serializedClientData as string | undefined;
  const clientFullName = ((safe as Record<string, unknown>)._clientFullName as string) ??
    [safe.personalInfo?.firstName, safe.personalInfo?.middleName, safe.personalInfo?.lastName, safe.personalInfo?.suffix]
      .filter(Boolean)
      .join(' ');

  const _pi = safe.personalInfo ?? {};
  const distribution = safe.distribution ?? {};
  const trusts: admin.firestore.DocumentData[] = safe.trusts ?? [];
  const assets = safe.assets ?? {};
  const healthPrefs = safe.healthcarePreferences ?? {};
  const specialConsiderations = safe.specialConsiderations ?? {};
  const fiduciaries = safe.fiduciaries ?? {};
  const poa = fiduciaries.powerOfAttorney ?? {};

  const hasTrust = ['guardian', 'fortress'].includes(packageType);
  const primaryTrust = trusts[0];
  const trustName = sanitizeForPrompt(
    primaryTrust?.trustName ?? distribution.trustName ?? (hasTrust ? `The ${clientFullName} Revocable Living Trust` : ''),
  );

  const realEstate: admin.firestore.DocumentData[] = assets.realEstate ?? [];
  const propertiesForTrust = realEstate.filter((r: admin.firestore.DocumentData) => r.transferToTrust);

  const packageDisplayNames: Record<string, string> = {
    foundation: 'Basic Estate Plan',
    guardian: 'Revocable Trust',
    fortress: 'Irrevocable Trust',
  };

  const packageDocs = hasTrust
    ? ['Revocable Living Trust', 'Pour-Over Will', 'Durable Power of Attorney', 'Advance Directive for Health Care', 'Deeds (one per property)', 'Affidavit of Consideration (one per property)', 'GIT/REP-3 (one per property)', 'Estate Plan Summary', 'Action Steps Checklist']
    : ['Last Will and Testament', 'Durable Power of Attorney', 'Advance Directive for Health Care', 'Estate Plan Summary', 'Action Steps Checklist'];

  const userPrompt = `
Generate a complete plain-English Estate Plan Summary for this client:

CLIENT DATA BLOCK:
${serializedData ?? '(Client data not available — use the details below)'}

SUMMARY-SPECIFIC DETAILS:
  Client: ${clientFullName}
  Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
  Package: ${packageDisplayNames[packageType] ?? packageType} Package
  ${hasTrust ? `Trust: ${trustName}` : ''}

  Documents in this package:
  ${packageDocs.map(d => `• ${d}`).join('\n  ')}

  Healthcare preferences (key):
    Life support: ${healthPrefs.lifeSupport === 'withhold' ? 'Withhold if terminal/PVS' : healthPrefs.lifeSupport === 'provide' ? 'Provide all treatment' : 'Defer to representative'}
    Organ donation: ${healthPrefs.organDonation ? 'Yes' : 'No'}

  Real estate:
  ${realEstate.length === 0 ? 'None.' : realEstate.map((r: admin.firestore.DocumentData) =>
    `• ${sanitizeForPrompt(r.address)}, ${sanitizeForPrompt(r.city)}, NJ — ${r.transferToTrust ? 'Being transferred to trust' : 'NOT being transferred'}`
  ).join('\n  ')}

  Properties to deed into trust (${propertiesForTrust.length}):
  ${propertiesForTrust.map((r: admin.firestore.DocumentData) =>
    `• ${sanitizeForPrompt(r.address)}, ${sanitizeForPrompt(r.city)}, ${sanitizeForPrompt(r.county)} County`
  ).join('\n  ') || 'None.'}

  Special notes:
    Gift-making power: ${poa.giftingPower ? 'Yes' : 'No'}
    Spendthrift: ${distribution.spendthriftProvision ? 'Yes' : 'No'}
    Special needs child: ${specialConsiderations.hasSpecialNeedsChild ? 'Yes' : 'No'}
    No-contest clause: ${distribution.noContestClause ? 'Yes' : 'No'}
    Digital assets: ${specialConsiderations.hasDigitalAssets ? 'Yes' : 'No'}

  Firm: ${sanitizeForPrompt(safeFirm.firmName ?? '')}
    Phone: ${safeFirm.firmPhone ?? ''}
    Email: ${safeFirm.firmEmail ?? ''}

Generate the complete estate plan summary. Use the client's actual names throughout. For next steps, include specific county recording information for ${propertiesForTrust.map((r: admin.firestore.DocumentData) => sanitizeForPrompt(r.county)).filter(Boolean).join(', ') || 'relevant NJ counties'}.
`.trim();

  const raw = await callAI(SUMMARY_SYSTEM_PROMPT, userPrompt, safeFirm, {
    model: safeFirm?.documentDraftingModel || 'gpt-5.4',
    temperature: 0.3, // Slightly higher — this is client-friendly prose
    maxTokens: 8192,
    jsonMode: true,
    jsonSchema: DOCUMENT_SCHEMA,
  });

  const parsed = parseAIJson<{ title: string; content: string; _truncated?: boolean }>(raw);

  return {
    docType: 'estatePlanSummary',
    title: buildStandardTitle('estatePlanSummary', clientFullName),
    content: parsed.content ?? '',
    status: 'draft',
    ...(parsed._truncated && { _truncated: true }),
  };
}
