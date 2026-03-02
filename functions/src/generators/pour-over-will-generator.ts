/**
 * functions/src/generators/pour-over-will-generator.ts
 *
 * Generates a Pour-Over Will — same structure as the Last Will and Testament
 * but with the residuary estate poured into the client's Revocable Living Trust.
 *
 * Statutory basis:
 *  - N.J.S.A. 3B:3-1 et seq. (Will formalities)
 *  - N.J.S.A. 3B:3-2 (Execution requirements)
 *  - N.J.S.A. 3B:3-4 (Self-proving affidavit)
 *  - N.J.S.A. 3B:9-1 (Pour-over trust — trust must exist at testator's death or be created concurrently)
 *  - N.J.S.A. 3B:14-23 (Executor powers)
 */

import { callAI, sanitizeForPrompt, sanitizeObject, parseAIJson } from '../ai-client';
import { GeneratedDoc } from '../generate-documents';
import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const POUR_OVER_WILL_SYSTEM_PROMPT = `
You are an expert New Jersey estate planning attorney generating a complete, execution-ready Pour-Over Will.

A Pour-Over Will is a companion document to a Revocable Living Trust. It directs that the testator's probate estate — any assets not already titled in the trust — shall be "poured over" into the trust at death. This ensures all assets pass through the trust's distribution scheme rather than through intestacy.

GOVERNING LAW:
• N.J.S.A. 3B:3-1 through 3B:3-29 (Will formalities and execution)
• N.J.S.A. 3B:3-2: Requires testator signature and two adult non-beneficiary witnesses.
• N.J.S.A. 3B:3-4: Include full statutory self-proving affidavit.
• N.J.S.A. 3B:9-1: The trust receiving the pour-over distribution must be identified by name, date, and trustee; must be in existence at (or created simultaneously with) the testator's death.
• N.J.S.A. 3B:14-23: Executor powers — include broad power clause.
• N.J.S.A. 3B:5-3: Anti-lapse (per stirpes) as backup if the trust fails.

DOCUMENT STRUCTURE (required articles):
  ARTICLE I   — Declaration of Domicile, Revocation of Prior Wills
  ARTICLE II  — Family (spouse, children — full names and DOBs; omit guardian article if no minors)
  ARTICLE III — Payment of Debts, Taxes, and Expenses
  ARTICLE IV  — Specific Bequests (omit if none; tangible personal property is commonly distributed here before the pour-over)
  ARTICLE V   — Pour-Over of Residuary Estate to Trust
                • Identify trust by EXACT name, date, and trustee
                • Language: "I give, bequeath, and devise all the rest, residue, and remainder of my estate ... to the Trustee then serving under [TRUST NAME] dated [DATE] ..."
                • State that the trust terms govern distribution, not the will
                • Include fallback: if trust fails, distribution per intestacy or alternate named beneficiaries
  ARTICLE VI  — Executor Appointment (primary, alternate; bond waiver; compensation)
  ARTICLE VII — Executor Powers (broad statutory powers per N.J.S.A. 3B:14-23)
  ARTICLE VIII— Guardianship (only if minor children; guardian + alternate)
  ARTICLE IX  — General Provisions (survivorship period, no-contest if requested, digital assets)
  EXECUTION BLOCK — Testator signature, date, city/state
  WITNESS ATTESTATION — NJ standard witness attestation, two witnesses with addresses
  SELF-PROVING AFFIDAVIT — Full N.J.S.A. 3B:3-4 statutory language with notary block

CRITICAL POUR-OVER LANGUAGE REQUIREMENTS:
1. The trust must be identified by its FULL legal name and exact date of execution.
2. Include language incorporating any amendments: "as it may be amended from time to time."
3. State that distributions shall be made as if the will assets had originally been part of the trust.
4. Include a savings clause: if the trust is not in existence or is revoked, then the residue passes to [backup beneficiaries].

FORMATTING:
• Full HTML output (no <html>/<body>/<head>).
• <h1> for title, <h2> for articles, <p> for paragraphs, <table> for signature blocks.
• Fill ALL client data — no "[NAME]" placeholder tokens.

OUTPUT FORMAT — JSON only (no markdown):
{
  "title": "Pour-Over Will of [Full Name]",
  "content": "<complete HTML body>",
  "metadata": {
    "wordCount": <number>,
    "estimatedPages": <number>,
    "executionRequirements": ["Testator signature", "Two adult non-beneficiary witnesses", "Notary for self-proving affidavit"],
    "witnessRequired": true,
    "notarizationRequired": true
  }
}
`.trim();

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export async function generatePourOverWill(
  clientData: admin.firestore.DocumentData,
  firmData: admin.firestore.DocumentData,
  packageType: string,
  trustTypes?: string[],
): Promise<GeneratedDoc> {
  const safe = sanitizeObject(clientData);
  const safeFirm = sanitizeObject(firmData);

  const pi = safe.personalInfo ?? {};
  const spouse = safe.spouseInfo;
  const children: admin.firestore.DocumentData[] = safe.children ?? [];
  const fiduciaries = safe.fiduciaries ?? {};
  const executor = fiduciaries.executor ?? {};
  const distribution = safe.distribution ?? {};
  const trusts: admin.firestore.DocumentData[] = safe.trusts ?? [];
  const specialConsiderations = safe.specialConsiderations ?? {};

  const clientFullName = [pi.firstName, pi.middleName, pi.lastName, pi.suffix]
    .filter(Boolean)
    .join(' ');

  const hasMinors = children.some((c: admin.firestore.DocumentData) => c.isMinor === true);
  const hasSpouse = pi.maritalStatus === 'Married' || pi.maritalStatus === 'Domestic Partnership';

  // Identify the primary revocable living trust
  const primaryTrust = trusts.find(
    (t: admin.firestore.DocumentData) =>
      t.trustType === 'Revocable Living Trust' || t.transferToTrust === true,
  ) ?? trusts[0];

  const trustName = sanitizeForPrompt(
    primaryTrust?.trustName ??
    distribution.trustName ??
    `The ${[pi.firstName, pi.lastName].filter(Boolean).join(' ')} Revocable Living Trust`,
  );
  const trustDate = primaryTrust?.trustDate ?? '[Trust Date]';

  const trustee = primaryTrust?.trustees?.primary;
  const trusteeName = trustee
    ? sanitizeForPrompt([trustee.name].filter(Boolean).join(' '))
    : sanitizeForPrompt([pi.firstName, pi.lastName].filter(Boolean).join(' '));

  const specificBequestsText = (distribution.specificBequests ?? [])
    .map((b: admin.firestore.DocumentData, i: number) =>
      `${i + 1}. "${sanitizeForPrompt(b.description)}" to ${sanitizeForPrompt(b.recipient)}${b.alternateRecipient ? `; if predeceased, to ${sanitizeForPrompt(b.alternateRecipient)}` : ''}.`
    )
    .join('\n');

  const userPrompt = `
Generate a complete Pour-Over Will using this client data:

TESTATOR:
  Full name: ${clientFullName}
  Date of birth: ${pi.dob ?? 'Unknown'}
  Address: ${pi.address}, ${pi.city}, ${pi.state} ${pi.zip}
  County: ${pi.county}
  Marital status: ${pi.maritalStatus}

${hasSpouse && spouse ? `SPOUSE:
  Full name: ${[spouse.firstName, spouse.middleName, spouse.lastName].filter(Boolean).join(' ')}
  Address: ${spouse.address}, ${spouse.city}, ${spouse.state} ${spouse.zip}
` : 'SPOUSE: None / not applicable'}

CHILDREN (${children.length}):
${children.length === 0 ? '  None.' : children.map((c: admin.firestore.DocumentData) =>
    `  - ${sanitizeForPrompt(c.name)}, DOB ${c.dob}, ${c.isMinor ? 'minor' : 'adult'}${c.specialNeeds ? ' [SPECIAL NEEDS]' : ''}${c.guardian ? `, guardian: ${sanitizeForPrompt(c.guardian)}` : ''}`
  ).join('\n')}

TRUST RECEIVING POUR-OVER:
  Trust name: ${trustName}
  Trust date: ${trustDate}
  Trustee: ${trusteeName}
  Trust types: ${(trustTypes ?? [trustName]).join(', ')}

EXECUTOR:
  Primary: ${sanitizeForPrompt(executor.primary?.name ?? 'TBD')}, ${sanitizeForPrompt(executor.primary?.relationship ?? '')}
  Alternate: ${sanitizeForPrompt(executor.alternate?.name ?? 'None')}
  Successor: ${sanitizeForPrompt(executor.successor?.name ?? 'None')}
  Bond required: ${executor.bondRequired ? 'Yes' : 'No'}
  Compensation: ${executor.compensation ?? 'statutory'}

${hasMinors ? `GUARDIAN FOR MINOR CHILDREN:
  Primary: ${sanitizeForPrompt(fiduciaries.guardian?.primary?.name ?? 'TBD')}
  Alternate: ${sanitizeForPrompt(fiduciaries.guardian?.alternate?.name ?? 'None')}
` : ''}

SPECIFIC BEQUESTS (before pour-over):
${specificBequestsText || '  None — all assets pour over to trust.'}

SPECIAL PROVISIONS:
  No-contest clause: ${distribution.noContestClause ? 'Yes' : 'No'}
  Special needs child: ${specialConsiderations.hasSpecialNeedsChild ? `Yes — ${sanitizeForPrompt(specialConsiderations.specialNeedsDetails ?? '')}` : 'No'}
  Survivorship period: ${distribution.survivorshipPeriod ?? 30} days

FIRM: ${sanitizeForPrompt(safeFirm.firmName ?? '')}

Generate the complete pour-over will now. The POUR-OVER ARTICLE must name the trust by its exact full name and date, include "as amended" language, and specify the trustee. Include full execution block, NJ witness attestation, and complete N.J.S.A. 3B:3-4 self-proving affidavit.
`.trim();

  const raw = await callAI(POUR_OVER_WILL_SYSTEM_PROMPT, userPrompt, safeFirm, {
    model: 'gpt-4.1',
    temperature: 0.15,
    maxTokens: 8192,
    jsonMode: true,
  });

  const parsed = parseAIJson<{ title: string; content: string }>(raw);

  return {
    docType: 'pourOverWill',
    title: parsed.title ?? `Pour-Over Will of ${clientFullName}`,
    content: parsed.content ?? '',
    status: 'draft',
  };
}
