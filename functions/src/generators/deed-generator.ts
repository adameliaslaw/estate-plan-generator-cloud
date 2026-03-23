/**
 * functions/src/generators/deed-generator.ts
 *
 * Generates ONE Bargain and Sale Deed with Covenants Against Grantor's Acts
 * per real estate property being transferred into the client's Revocable Living Trust.
 *
 * This generator is called once per property (the orchestrator loops).
 *
 * Statutory basis:
 *  - N.J.S.A. 46:4-6: Bargain and Sale Deed with covenants against grantor's acts
 *  - N.J.S.A. 46:15-1 et seq.: Realty Transfer Fee (RTF) — exemptions for trust transfers
 *  - N.J.S.A. 46:15-10(a)(7): RTF exemption for transfer to a revocable trust where grantor/settlor is beneficiary
 *  - N.J.S.A. 46:26A-1 et seq.: Recording requirements — County Clerk / Register of Deeds
 *  - N.J.S.A. 54:15C-1: Mansions Tax (1% on sales over $1M) — not applicable for trust transfers
 *  - N.J.S.A. 46:3-17.2: Words "as Trustee" — identification of trustee's capacity
 *  - Deed must include: full legal description OR block/lot reference by NJ Tax Map
 *  - Include Consideration ($1.00 and other good and valuable consideration for RTF exemption)
 */

import { callAI, sanitizeForPrompt, sanitizeObject, parseAIJson } from '../ai-client';
import { GeneratedDoc } from '../generate-documents';
import { DOCUMENT_SCHEMA } from '../document-schemas';
import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const DEED_SYSTEM_PROMPT = `
You are an expert New Jersey real estate and estate planning attorney generating a complete, recordable Bargain and Sale Deed with Covenants Against Grantor's Acts.

PURPOSE: This deed transfers a specific real estate property from the individual grantor (property owner) to themselves as Trustee of their Revocable Living Trust. This is the standard mechanism for funding real estate into a living trust in New Jersey.

GOVERNING LAW:
• N.J.S.A. 46:4-6: "Bargain and Sale Deed" — covenants against grantor's acts (grantor covenants they have not done any act to encumber the property except as stated).
• N.J.S.A. 46:15-1 through 46:15-10: Realty Transfer Fee. N.J.S.A. 46:15-10(a)(7) exempts transfers to a revocable inter vivos trust where the grantor is the settlor-beneficiary. Include the RTF exemption statement.
• N.J.S.A. 46:26A-1 et seq.: Recording — deed must be acknowledged before a notary and recorded with the County Clerk/Register of Deeds in the county where the property is located.
• N.J.S.A. 46:3-17.2: Trustee capacity — grantee must be identified as "[Name], as Trustee of the [Trust Name] dated [Date]".
• N.J.A.C. 18:16-6.3: For RTF exemption, attach RTF Affidavit of Consideration (form RTF-1 or cover letter) indicating the exemption under N.J.S.A. 46:15-10(a)(7).
• Include a statement that this deed is made for estate planning purposes with no monetary consideration other than "$1.00 and other good and valuable consideration."

DEED STRUCTURE:
  1. PREPARED BY — attorney name, firm, address (NJ requirement for recording)
  2. RETURN TO — attorney / client address after recording
  3. TAX MAP REFERENCE — Block ___, Lot ___, Municipality, County
  4. DEED TYPE — Bargain and Sale Deed with Covenants Against Grantor's Acts
  5. GRANTOR — Full legal name, marital status, address
  6. GRANTEE — "[Same name], as Trustee of the [Trust Name] dated [Date], and any successor trustee thereof"
  7. CONSIDERATION — "$1.00 and other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged"
  8. RTF EXEMPTION STATEMENT — "This deed is exempt from the Realty Transfer Fee pursuant to N.J.S.A. 46:15-10(a)(7) as this is a transfer to a revocable trust where the grantor is the settlor and primary beneficiary."
  9. PROPERTY DESCRIPTION — 
     • Street address, Municipality, County, State, Zip
     • Tax Map Block ___, Lot ___ as shown on the Official Tax Map of [Municipality], [County], New Jersey
     • Deed Book/Page reference if available: "Being the same premises conveyed to Grantor by deed recorded in Deed Book ___, Page ___, of the [County] County records."
  10. TITLE COVENANTS — "Grantor covenants with Grantee that Grantor has not done or suffered to be done anything whereby the said premises have been in any manner charged, incumbered, or encumbered in any way whatsoever, except as herein recited."
  11. TOGETHER WITH — all appurtenances, easements, rights, and hereditaments
  12. SUBJECT TO — existing mortgages (state lender name and approximate balance), utility easements of record, and all other encumbrances and restrictions of record, if any
  13. GRANTOR SIGNATURE BLOCK — line for signature, printed name, date
  14. SPOUSAL JOINDER — if married, spouse must join to release Dower/Curtesy rights under N.J.S.A. 3B:28-1; include spousal signature block
  15. ACKNOWLEDGMENT / NOTARY BLOCK — full NJ notary acknowledgment (for each signatory)
  16. RECORDING BLOCK — "For County Recorder Use Only" section

IMPORTANT NOTES:
• Grantee must ALWAYS be "[Full Name], as Trustee of [Trust Name], dated [Date], and any successor trustee thereof" — NOT just the individual name.
• If the property has a mortgage, state it clearly in the "subject to" clause and recommend notifying the lender.
• Include a due-on-sale clause advisory note as a comment.
• The deed does NOT need witnesses (only notarization) in New Jersey.

FORMATTING:
• Full HTML (no <html>/<body>/<head>).
• Include a "PREPARED BY" block at the top (attorney info).
• Use <table> for the formal deed layout where appropriate.
• Use <p class="deed-clause"> for the legal clauses.
• Include blank signature/date lines.

CONSISTENCY RULE: You will receive a standardized CLIENT DATA BLOCK.
Use EXACTLY the names, addresses, and relationships as provided —
do not rephrase, abbreviate, or reformat any proper nouns.

OUTPUT FORMAT — JSON only:
{
  "title": "Bargain and Sale Deed — [Property Address] to [Trust Name]",
  "content": "<complete HTML>",
  "metadata": {
    "wordCount": <number>,
    "estimatedPages": <number>,
    "executionRequirements": ["Grantor notarized signature", "Spousal joinder if married", "Recording with County Clerk"],
    "witnessRequired": false,
    "notarizationRequired": true
  }
}
`.trim();

// ---------------------------------------------------------------------------
// Generator — called once per property
// ---------------------------------------------------------------------------

export async function generateDeed(
  clientData: admin.firestore.DocumentData,
  firmData: admin.firestore.DocumentData,
  _packageType: string,
  _trustTypes?: string[],
  property?: admin.firestore.DocumentData,
): Promise<GeneratedDoc> {
  const safe = sanitizeObject(clientData);
  const safeFirm = sanitizeObject(firmData);
  const safeProperty = sanitizeObject(property ?? {});

  // Use canonical serialized data from unified-generator (Phase 1)
  const serializedData = (safe as Record<string, unknown>)._serializedClientData as string | undefined;
  const clientFullName = ((safe as Record<string, unknown>)._clientFullName as string) ??
    [safe.personalInfo?.firstName, safe.personalInfo?.middleName, safe.personalInfo?.lastName, safe.personalInfo?.suffix]
      .filter(Boolean)
      .join(' ');

  const pi = safe.personalInfo ?? {};
  const spouse = safe.spouseInfo;
  const fiduciaries = safe.fiduciaries ?? {};
  const trustee = fiduciaries.trustee ?? {};
  const distribution = safe.distribution ?? {};
  const trusts: admin.firestore.DocumentData[] = safe.trusts ?? [];

  const isMarried = pi.maritalStatus === 'Married' || pi.maritalStatus === 'Domestic Partnership';

  // Trust info for grantee line
  const primaryTrust = trusts[0];
  const trustName = sanitizeForPrompt(
    primaryTrust?.trustName ?? distribution.trustName ?? `The ${clientFullName} Revocable Living Trust`,
  );
  const trustDate = primaryTrust?.trustDate ?? '[Trust Date — to be filled in upon trust execution]';
  const primaryTrustee = trustee.primary ?? primaryTrust?.trustees?.primary;
  const trusteeName = primaryTrustee ? sanitizeForPrompt(primaryTrustee.name ?? clientFullName) : clientFullName;

  // Property details
  const propAddress = sanitizeForPrompt(safeProperty.address ?? '');
  const propCity = sanitizeForPrompt(safeProperty.city ?? '');
  const propCounty = sanitizeForPrompt(safeProperty.county ?? pi.county ?? '');
  const propState = safeProperty.state ?? 'NJ';
  const propZip = safeProperty.zip ?? '';
  const blockLot = sanitizeForPrompt(safeProperty.blockLot ?? '');
  const deedBook = safeProperty.deedBook ?? '';
  const deedPage = safeProperty.deedPage ?? '';
  const mortgageBalance = safeProperty.mortgageBalance;
  const mortgageLender = sanitizeForPrompt(safeProperty.mortgageLender ?? '');
  const estimatedValue = safeProperty.estimatedValue;

  const userPrompt = `
Generate a complete Bargain and Sale Deed with Covenants Against Grantor's Acts for this property:

CLIENT DATA BLOCK:
${serializedData ?? '(Client data not available — use the details below)'}

PROPERTY DETAILS:
  Address: ${propAddress}, ${propCity}, ${propState} ${propZip}
  County: ${propCounty}
  Block/Lot: ${blockLot || 'To be confirmed with tax map'}
  Prior deed reference: ${deedBook ? `Book ${deedBook}, Page ${deedPage}` : 'Not provided — include blank'}
  Estimated value: ${estimatedValue ? `$${estimatedValue.toLocaleString()}` : 'Not specified'}
  Mortgage: ${mortgageBalance ? `Yes — ${mortgageLender}, approx. balance $${mortgageBalance.toLocaleString()}` : 'None / not specified'}
  Primary residence: ${safeProperty.isPrimaryResidence ? 'Yes' : 'No'}
  Current titling: ${sanitizeForPrompt(safeProperty.titling ?? 'Sole ownership')}

GRANTEE (trustee of trust):
  Grantee: ${trusteeName}, as Trustee of ${trustName} dated ${trustDate}, and any successor trustee thereof

${isMarried && spouse ? `SPOUSAL JOINDER:
  Spouse: ${[spouse.firstName, spouse.middleName, spouse.lastName].filter(Boolean).join(' ')}
  Note: Include spousal joinder / release of marital interest per N.J.S.A. 3B:28-1
` : ''}

RTF EXEMPTION: N.J.S.A. 46:15-10(a)(7) — transfer from individual to revocable trust where grantor is settlor-beneficiary

PREPARING ATTORNEY:
  Firm: ${sanitizeForPrompt(safeFirm.firmName ?? '')}
  Address: ${sanitizeForPrompt(safeFirm.firmAddress ?? '')}
  Phone: ${safeFirm.firmPhone ?? ''}
  Bar number: ${safeFirm.barNumber ?? ''}

Generate the complete deed. Include the RTF exemption clause, full property description with block/lot, grantor covenants, "together with" clause, "subject to" clause (existing mortgage${mortgageBalance ? ' — state lender and approximate balance' : ''}), full grantor execution block${isMarried ? ', spousal joinder block' : ''}, and full NJ notary acknowledgment block for each signatory. Also include recording instructions footer.
`.trim();

  const raw = await callAI(DEED_SYSTEM_PROMPT, userPrompt, safeFirm, {
    model: safeFirm?.documentDraftingModel || 'gpt-5.4',
    temperature: 0.15,
    maxTokens: 6144,
    jsonMode: true,
    jsonSchema: DOCUMENT_SCHEMA,
  });

  const parsed = parseAIJson<{ title: string; content: string }>(raw);

  const shortAddress = propAddress ? `${propAddress}, ${propCity}` : 'Property';

  return {
    docType: 'deed',
    title: parsed.title ?? `Bargain and Sale Deed — ${shortAddress}`,
    content: parsed.content ?? '',
    status: 'draft',
  };
}
