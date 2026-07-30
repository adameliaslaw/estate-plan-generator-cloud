/**
 * functions/src/generators/affidavit-generator.ts
 *
 * Generates an Affidavit of Consideration (also known as the RTF Affidavit) for
 * each real estate deed transfer. Required by the NJ Division of Taxation when
 * recording a deed claiming a Realty Transfer Fee (RTF) exemption.
 *
 * Statutory basis:
 *  - N.J.S.A. 46:15-1 et seq.: Realty Transfer Fee Act
 *  - N.J.S.A. 46:15-10: Exemptions from RTF — subsection (a)(7): transfer to a
 *    revocable trust in which the grantor is the settlor and a beneficiary
 *  - N.J.A.C. 18:16-6.3: Requirements for RTF exemption — must file Affidavit of
 *    Consideration (form RTF-1 or equivalent) with the deed at recording
 *  - N.J.S.A. 46:15-7: RTF calculation (for reference only — this deed is exempt)
 *  - N.J.S.A. 54:15C-1: Mansion's Tax (1%) — not applicable for trust transfers
 *  - County Clerk recording requirements
 */

import { callAI, sanitizeForPrompt, sanitizeObject, parseAIJson } from '../ai-client';
import { GeneratedDoc } from '../generate-documents';
import { DOCUMENT_SCHEMA } from '../document-schemas';
import { buildStandardTitle } from '../unified-generator';
import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const AFFIDAVIT_SYSTEM_PROMPT = `
You are an expert New Jersey real estate and estate planning attorney generating a complete, recordable Affidavit of Consideration for Use by Seller (Grantor) — also known as the RTF-1 Affidavit.

PURPOSE: This affidavit is required when recording a deed that claims a Realty Transfer Fee (RTF) exemption in New Jersey. It must be attached to the deed at the time of recording with the County Clerk.

GOVERNING LAW:
• N.J.S.A. 46:15-1 et seq.: New Jersey Realty Transfer Fee Act
• N.J.S.A. 46:15-10(a)(7): Exemption for "a deed that transfers property to a revocable living trust in which the grantor is the settlor and a beneficiary of the trust"
• N.J.A.C. 18:16-6.3: Administrative requirements — must submit Affidavit of Consideration with deed claiming exemption
• N.J.S.A. 46:15-7(b): RTF calculation rules (grantor states actual consideration or exemption basis)

DOCUMENT CONTENT:
  1. TITLE: Affidavit of Consideration for Use by Seller (Grantor) — NJ Realty Transfer Fee Exemption
  2. STATE OF NEW JERSEY, COUNTY OF [County] caption
  3. DEPONENT IDENTIFICATION: Full name and address of grantor
  4. PROPERTY IDENTIFICATION:
     • Street address, municipality, county
     • Block and Lot per Tax Map
  5. GRANTEE IDENTIFICATION: Full name of grantee (trustee in trust capacity)
  6. CONSIDERATION STATEMENT: "The consideration or the value of the interest or property conveyed is $1.00 and other good and valuable consideration. No monetary consideration was paid for this transfer."
  7. ACTUAL VALUE STATEMENT: State the estimated fair market value for county assessment purposes
  8. RTF EXEMPTION CLAIM: 
     "Deponent hereby claims an exemption from the New Jersey Realty Transfer Fee pursuant to N.J.S.A. 46:15-10(a)(7) on the ground that this deed transfers real property to a revocable inter vivos trust in which the grantor (deponent) is the settlor and a beneficiary of said trust."
  9. TRUST IDENTIFICATION: Name and date of the trust receiving the property
  10. VERIFICATION: "I certify that the foregoing statements made by me are true. I am aware that if any of the foregoing statements made by me are willfully false, I am subject to punishment."
  11. GRANTOR SIGNATURE BLOCK: Signature, printed name, date
  12. NOTARY ACKNOWLEDGMENT: Full NJ notary block — sworn to and subscribed before notary

FORMATTING:
• Full HTML (no <html>/<body>/<head>).
• Include a formal caption block at the top.
• Use <table> for the "sworn before" notary block.
• The document should be concise — typically one page.

CONSISTENCY RULE: You will receive a standardized CLIENT DATA BLOCK.
Use EXACTLY the names, addresses, and relationships as provided —
do not rephrase, abbreviate, or reformat any proper nouns.

OUTPUT FORMAT — JSON only:
{
  "title": "Affidavit of Consideration — [Property Address]",
  "content": "<complete HTML>",
  "metadata": {
    "wordCount": <number>,
    "estimatedPages": 1,
    "executionRequirements": ["Grantor signature before notary", "File with deed at recording"],
    "witnessRequired": false,
    "notarizationRequired": true
  }
}
`.trim();

// ---------------------------------------------------------------------------
// Generator — called once per property
// ---------------------------------------------------------------------------

export async function generateAffidavitOfConsideration(
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
  const fiduciaries = safe.fiduciaries ?? {};
  const trustee = fiduciaries.trustee ?? {};
  const distribution = safe.distribution ?? {};
  const trusts: admin.firestore.DocumentData[] = safe.trusts ?? [];

  const primaryTrust = trusts[0];
  const trustName = sanitizeForPrompt(
    primaryTrust?.trustName ?? distribution.trustName ?? `The ${clientFullName} Revocable Living Trust`,
  );
  const trustDate = primaryTrust?.trustDate ?? '[Trust Date]';
  const primaryTrustee = trustee.primary ?? primaryTrust?.trustees?.primary;
  const trusteeName = primaryTrustee ? sanitizeForPrompt(primaryTrustee.name ?? clientFullName) : clientFullName;

  const propAddress = sanitizeForPrompt(safeProperty.address ?? '');
  const propCity = sanitizeForPrompt(safeProperty.city ?? '');
  const propCounty = sanitizeForPrompt(safeProperty.county ?? pi.county ?? '');
  const propState = safeProperty.state ?? 'NJ';
  const propZip = safeProperty.zip ?? '';
  const blockLot = sanitizeForPrompt(safeProperty.blockLot ?? '');
  const estimatedValue = safeProperty.estimatedValue;

  const userPrompt = `
Generate a complete Affidavit of Consideration (RTF Exemption Affidavit) for this property transfer:

CLIENT DATA BLOCK:
${serializedData ?? '(Client data not available — use the details below)'}

PROPERTY DETAILS:
  Address: ${propAddress}, ${propCity}, ${propState} ${propZip}
  County: ${propCounty}
  Block/Lot: ${blockLot || 'To be confirmed'}
  Estimated fair market value: ${estimatedValue ? `$${estimatedValue.toLocaleString()}` : 'To be determined'}

GRANTEE:
  ${trusteeName}, as Trustee of ${trustName} dated ${trustDate}

RTF EXEMPTION BASIS: N.J.S.A. 46:15-10(a)(7) — transfer to revocable trust where grantor is settlor-beneficiary
CONSIDERATION: $1.00 and other good and valuable consideration (no monetary payment)
TRUST NAME: ${trustName}
TRUST DATE: ${trustDate}

PREPARING ATTORNEY:
  Firm: ${sanitizeForPrompt(safeFirm.firmName ?? '')}
  Address: ${sanitizeForPrompt(safeFirm.firmAddress ?? '')}

Generate the complete affidavit. Include the state/county caption, deponent ID, property description, RTF exemption statement citing N.J.S.A. 46:15-10(a)(7), trust identification, certification statement, signature block, and full NJ notary acknowledgment.
`.trim();

  const raw = await callAI(AFFIDAVIT_SYSTEM_PROMPT, userPrompt, safeFirm, {
    model: safeFirm?.documentDraftingModel || 'claude-opus-5',
    temperature: 0.15,
    maxTokens: 4096,
    jsonMode: true,
    jsonSchema: DOCUMENT_SCHEMA,
  });

  const parsed = parseAIJson<{ title: string; content: string; _truncated?: boolean }>(raw);

  const shortAddress = propAddress ? `${propAddress}, ${propCity}` : 'Property';

  return {
    docType: 'affidavitOfConsideration',
    title: buildStandardTitle('affidavitOfConsideration', clientFullName, shortAddress),
    content: parsed.content ?? '',
    status: 'draft',
    ...(parsed._truncated && { _truncated: true }),
  };
}
