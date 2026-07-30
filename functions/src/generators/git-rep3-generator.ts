/**
 * functions/src/generators/git-rep3-generator.ts
 *
 * Generates a GIT/REP-3 Seller's Residency Certification/Exemption form for
 * each real estate property being transferred to the trust.
 *
 * The GIT/REP-3 certifies that the grantor is a NJ resident OR claims an
 * applicable exemption from NJ Gross Income Tax withholding on real property sales.
 *
 * Statutory basis:
 *  - N.J.S.A. 54A:8-9: Gross Income Tax withholding on real property sales
 *  - N.J.A.C. 18:18-11.1 et seq.: GIT withholding requirements for non-residents
 *  - GIT/REP-1: Non-Resident Seller's Tax Declaration
 *  - GIT/REP-2: Seller's Residency Certification (NJ resident — exemption from withholding)
 *  - GIT/REP-3: Seller's Residency Certification / Exemption form — used when claiming exemption
 *    Exemption Code 5 applies to trust transfers: "Transfer to a revocable living trust in which
 *    the transferor is and remains a beneficiary"
 *  - N.J.S.A. 54A:8-9(b): Exemptions from withholding — including trust transfers
 */

import { callAI, sanitizeForPrompt, sanitizeObject, parseAIJson } from '../ai-client';
import { GeneratedDoc } from '../generate-documents';
import { DOCUMENT_SCHEMA } from '../document-schemas';
import { buildStandardTitle } from '../unified-generator';
import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const GIT_REP3_SYSTEM_PROMPT = `
You are an expert New Jersey real estate and estate planning attorney generating a GIT/REP-3 Seller's Residency Certification/Exemption form.

PURPOSE: The GIT/REP-3 is required by the NJ Division of Taxation at the time of recording a deed. It either certifies that the seller is a NJ resident (and therefore subject to NJ income tax filing, not withholding), or claims a specific statutory exemption from the GIT withholding requirement.

For trust funding deeds (transferring property from an individual to their own revocable living trust), the applicable exemption is:

EXEMPTION CODE 5: "The deed or transfer involves a transfer to a revocable living trust in which the transferor is and remains a beneficiary."

GOVERNING LAW:
• N.J.S.A. 54A:8-9: NJ Gross Income Tax — withholding on sales of NJ real property by non-residents; exemptions listed in subsection (b).
• N.J.A.C. 18:18-11.1 et seq.: GIT withholding rules for sales of NJ real property.
• GIT/REP-3 form: Seller's Residency Certification/Exemption — used for (a) NJ resident certification, or (b) exemption claims (Codes 1-7).

EXEMPTION CODES (for reference — Code 5 applies here):
  Code 1: Seller is a NJ resident who has or will file NJ income tax return reporting the gain
  Code 2: Total consideration does not exceed $1,000
  Code 3: Property is acquired under threat of condemnation
  Code 4: Transfer is between spouses or domestic partners
  Code 5: Transfer to a revocable living trust in which the transferor is and remains a beneficiary
  Code 6: Transfer is a gift (no consideration)
  Code 7: Other (specify reason)

DOCUMENT CONTENT:
  1. TITLE: GIT/REP-3 — Seller's Residency Certification/Exemption (New Jersey)
  2. PROPERTY IDENTIFICATION:
     • Property address (street, city, municipality, county)
     • Block and Lot per Tax Map
  3. SELLER/TRANSFEROR IDENTIFICATION:
     • Full name, SSN (redact last 5 digits — show last 4 only or use XXXX-XX-####), address
  4. BUYER/TRANSFEREE IDENTIFICATION:
     • Trustee name and capacity: "[Name], as Trustee of [Trust Name] dated [Date]"
  5. CONSIDERATION: "$1.00 and other good and valuable consideration"
  6. EXEMPTION CLAIM:
     • Check/indicate Exemption Code 5
     • Full text: "This transfer qualifies for exemption from the New Jersey Gross Income Tax withholding requirement pursuant to N.J.S.A. 54A:8-9(b) because this deed involves a transfer to a revocable living trust in which the transferor is and remains a beneficiary."
  7. CERTIFICATION: 
     "Under penalties of perjury, I certify that the information provided above is true, correct, and complete to the best of my knowledge and belief, and that this transaction qualifies for the claimed exemption."
  8. SELLER SIGNATURE BLOCK: Signature, printed name, date, SSN (last 4 only)
  9. PREPARER INFORMATION: Attorney name, firm, address, phone, NJ Bar number

FORMATTING:
• Full HTML (no <html>/<body>/<head>).
• Format to look like an official form with labeled fields.
• Include a check box area clearly marking "EXEMPTION CODE 5" as selected.
• Keep it concise — one page.
• Note at bottom: "This form must be filed with the County Clerk/Register of Deeds at the time of recording."

CONSISTENCY RULE: You will receive a standardized CLIENT DATA BLOCK.
Use EXACTLY the names, addresses, and relationships as provided —
do not rephrase, abbreviate, or reformat any proper nouns.

OUTPUT FORMAT — JSON only:
{
  "title": "GIT/REP-3 Seller's Residency Certification/Exemption — [Property Address]",
  "content": "<complete HTML>",
  "metadata": {
    "wordCount": <number>,
    "estimatedPages": 1,
    "executionRequirements": ["Seller signature", "File with deed at recording"],
    "witnessRequired": false,
    "notarizationRequired": false
  }
}
`.trim();

// ---------------------------------------------------------------------------
// Generator — called once per property
// ---------------------------------------------------------------------------

export async function generateGitRep3(
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
  const ssnLast4 = pi.ssnLast4 ?? '####';

  const userPrompt = `
Generate a complete GIT/REP-3 Seller's Residency Certification/Exemption for this property transfer:

CLIENT DATA BLOCK:
${serializedData ?? '(Client data not available — use the details below)'}

PROPERTY DETAILS:
  Address: ${propAddress}, ${propCity}, ${propState} ${propZip}
  County: ${propCounty}
  Block/Lot: ${blockLot || 'TBD'}
  SSN (last 4 only): ${ssnLast4}

BUYER/TRANSFEREE:
  ${trusteeName}, as Trustee of ${trustName} dated ${trustDate}

EXEMPTION: Code 5 — Transfer to a revocable living trust in which the transferor is and remains a beneficiary (N.J.S.A. 54A:8-9(b))
CONSIDERATION: $1.00 and other good and valuable consideration

PREPARER:
  Firm: ${sanitizeForPrompt(safeFirm.firmName ?? '')}
  Address: ${sanitizeForPrompt(safeFirm.firmAddress ?? '')}
  Phone: ${safeFirm.firmPhone ?? ''}
  Bar: ${safeFirm.barNumber ?? ''}

Generate the complete GIT/REP-3 form styled as an official NJ tax form. Clearly mark Exemption Code 5 as selected. Include full certification text citing N.J.S.A. 54A:8-9(b), seller signature block, and preparer information.
`.trim();

  const raw = await callAI(GIT_REP3_SYSTEM_PROMPT, userPrompt, safeFirm, {
    model: safeFirm?.documentDraftingModel || 'claude-opus-5',
    temperature: 0.15,
    maxTokens: 3072,
    jsonMode: true,
    jsonSchema: DOCUMENT_SCHEMA,
  });

  const parsed = parseAIJson<{ title: string; content: string; _truncated?: boolean }>(raw);

  const shortAddress = propAddress ? `${propAddress}, ${propCity}` : 'Property';

  return {
    docType: 'gitRep3',
    title: buildStandardTitle('gitRep3', clientFullName, shortAddress),
    content: parsed.content ?? '',
    status: 'draft',
    ...(parsed._truncated && { _truncated: true }),
  };
}
