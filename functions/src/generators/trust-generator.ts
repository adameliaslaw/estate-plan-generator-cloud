/**
 * functions/src/generators/trust-generator.ts
 *
 * Generates a Revocable Living Trust (or other trust type per package).
 *
 * Statutory basis:
 *  - N.J.S.A. 3B:31-1 et seq. (New Jersey Uniform Trust Code)
 *  - N.J.S.A. 3B:31-18: Capacity to create trust — age 18+, mental capacity
 *  - N.J.S.A. 3B:31-19: Creation of trust — written instrument, trustee, purpose, beneficiary
 *  - N.J.S.A. 3B:31-20: Oral trusts — excluded; this is written
 *  - N.J.S.A. 3B:31-27: Revocable trust — settlor may revoke or amend unless expressly made irrevocable
 *  - N.J.S.A. 3B:31-28: Amendment / revocation methods
 *  - N.J.S.A. 3B:14-23: Trustee powers (adopted by reference)
 *  - N.J.S.A. 3B:31-64 et seq.: Trustee duties
 *  - N.J.S.A. 3B:9-1 et seq.: Spendthrift provisions
 *  - 26 U.S.C. §2056: Marital deduction (for married couples — QTIP / outright)
 *  - 26 U.S.C. §2631: GST exemption (for dynasty / generation-skipping provisions)
 */

import { callAI, sanitizeForPrompt, sanitizeObject, parseAIJson } from '../ai-client';
import { GeneratedDoc } from '../generate-documents';
import { DOCUMENT_SCHEMA } from '../document-schemas';
import { buildStandardTitle } from '../unified-generator';
import { getFormattingPreset } from '../config/formatting-presets';
import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const TRUST_SYSTEM_PROMPT_BASE = `
You are an expert New Jersey estate planning attorney generating a complete, execution-ready Revocable Living Trust (or the specified trust type).

GOVERNING LAW:
• N.J.S.A. 3B:31-1 et seq. (NJ Uniform Trust Code — effective July 17, 2016)
• N.J.S.A. 3B:31-18/19: Creation requirements — written, signed, settlor has capacity, lawful purpose, definite beneficiary
• N.J.S.A. 3B:31-27/28: Revocability — settlor may revoke or amend during lifetime; revocation by written instrument delivered to trustee
• N.J.S.A. 3B:14-23: Trustee powers — include comprehensive trustee powers clause
• N.J.S.A. 3B:31-64 through 3B:31-79: Trustee duties — duty of loyalty, prudent investor, impartiality, confidentiality
• N.J.S.A. 3B:9-1: Spendthrift provision — restrict beneficiary from alienating interest
• For married settlors: 26 U.S.C. §2056 marital deduction; include optional A-B trust structure (Credit Shelter Trust + Marital Trust) if estate may exceed federal exemption

TRUST TYPES HANDLED:
  Revocable Living Trust: Standard inter vivos revocable trust. Settlor is also initial trustee and beneficiary.
  Irrevocable Life Insurance Trust (ILIT): Settlor is not trustee; used to hold life insurance outside the taxable estate.
  Special Needs / Supplemental Needs Trust: Include 42 U.S.C. §1396p(d)(4)(A) first-party SNT language or third-party SNT — must not interfere with government benefits.
  Medicaid Asset Protection Trust (MAPT): Irrevocable, settlor cannot be beneficiary of principal; 5-year look-back; comply with N.J.A.C. 10:71-4.
  Testamentary Trust: Created by will, comes into existence at death.
  Other types: follow general NJ trust law with appropriate modifications.

DOCUMENT STRUCTURE (Revocable Living Trust):
  ARTICLE I   — Trust Name and Date
  ARTICLE II  — Trust Property (funding — corpus/principal; list assets or use general description)
  ARTICLE III — Settlor's Rights During Lifetime (revocation/amendment right; retain income and principal; trustee powers during settlor's life)
  ARTICLE IV  — Successor Trustee (trigger for succession: incapacity / death; incapacity defined; acceptance of trusteeship)
  ARTICLE V   — Trustee Powers (comprehensive list per N.J.S.A. 3B:14-23: invest, sell, lease, borrow, insure, maintain real property, make distributions, hire advisors, pay taxes, etc.)
  ARTICLE VI  — Distributions During Settlor's Lifetime
  ARTICLE VII — Distribution After Death of Settlor (specific bequests; residue to beneficiaries; outright or in further trust for minors)
  ARTICLE VIII— Subtrusts for Minor / Contingent Beneficiaries (if applicable; distribution standard; termination age; trustee discretion)
  ARTICLE IX  — Special Needs Provisions (if hasSpecialNeedsChild; SNT language preserving government benefits eligibility)
  ARTICLE X   — Spendthrift Provision (if requested)
  ARTICLE XI  — Trustee Compensation and Accounting
  ARTICLE XII — Trustee Liability and Indemnification
  ARTICLE XIII— No-Contest Clause (if requested)
  ARTICLE XIV — Governing Law (New Jersey)
  ARTICLE XV  — Amendment and Revocation (method: written instrument signed by settlor and delivered to trustee)
  ARTICLE XVI — Execution and Notarization
  SCHEDULE A  — Trust Property (list of assets transferred to trust or refer to funding schedule)

EXECUTION BLOCK:
  Settlor signature, date
  Trustee acceptance and signature (if different from settlor)
  Notary acknowledgment (notarization recommended but not required for validity in NJ)
  Witness attestation (recommended for real estate transfers)

%%FORMATTING_RULES%%

CONSISTENCY RULE: You will receive a standardized CLIENT DATA BLOCK.
Use EXACTLY the names, addresses, and relationships as provided —
do not rephrase, abbreviate, or reformat any proper nouns.

OUTPUT FORMAT — JSON only:
{
  "title": "The [Settlor Name] Revocable Living Trust",
  "content": "<complete HTML>",
  "metadata": {
    "wordCount": <number>,
    "estimatedPages": <number>,
    "executionRequirements": ["Settlor signature before notary", "Trustee acceptance signature"],
    "witnessRequired": false,
    "notarizationRequired": true
  }
}
`.trim();

const DEFAULT_TRUST_FORMATTING = `FORMATTING:
• Full HTML (no <html>/<body>/<head>).
• <h1> for title, <h2> for articles, <h3> for subsections, <p> for text.
• Schedule A as a formatted table.
• Do NOT leave any "[NAME]" tokens — use actual data.`;

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export async function generateTrust(
  clientData: admin.firestore.DocumentData,
  firmData: admin.firestore.DocumentData,
  packageType: string,
  trustTypes?: string[],
): Promise<GeneratedDoc> {
  const safe = sanitizeObject(clientData);
  const safeFirm = sanitizeObject(firmData);

  // Use canonical serialized data from unified-generator (Phase 1)
  const serializedData = (safe as Record<string, unknown>)._serializedClientData as string | undefined;
  const clientFullName = ((safe as Record<string, unknown>)._clientFullName as string) ??
    [safe.personalInfo?.firstName, safe.personalInfo?.middleName, safe.personalInfo?.lastName, safe.personalInfo?.suffix]
      .filter(Boolean)
      .join(' ');

  const fiduciaries = safe.fiduciaries ?? {};
  const trustee = fiduciaries.trustee ?? {};
  const distribution = safe.distribution ?? {};
  const trusts: admin.firestore.DocumentData[] = safe.trusts ?? [];
  const assets = safe.assets ?? {};
  const specialConsiderations = safe.specialConsiderations ?? {};

  // Trust-specific data
  const primaryTrustDef = trusts[0];
  const trustName = sanitizeForPrompt(
    primaryTrustDef?.trustName ??
    distribution.trustName ??
    `The ${clientFullName} Revocable Living Trust`,
  );
  const trustType = sanitizeForPrompt(
    (trustTypes ?? [])[0] ??
    primaryTrustDef?.trustType ??
    'Revocable Living Trust',
  );

  const coTrustee = trustee.coTrustee;
  const beneficiaries = primaryTrustDef?.beneficiaries ?? [];

  // Funded assets
  const fundingAssets: admin.firestore.DocumentData[] = (assets.realEstate ?? [])
    .filter((r: admin.firestore.DocumentData) => r.transferToTrust);
  const fundingBankAccounts: admin.firestore.DocumentData[] = (assets.bankAccounts ?? [])
    .filter((b: admin.firestore.DocumentData) => b.transferToTrust);
  const fundingInvestments: admin.firestore.DocumentData[] = (assets.investmentAccounts ?? [])
    .filter((i: admin.firestore.DocumentData) => i.transferToTrust);

  const distributionStandard = sanitizeForPrompt(
    primaryTrustDef?.distributionStandard ?? 'HEMS (health, education, maintenance, and support)',
  );

  const residualText = (distribution.residualDistributions ?? [])
    .map((r: admin.firestore.DocumentData) =>
      `${sanitizeForPrompt(r.recipient)} (${sanitizeForPrompt(r.recipientRelationship ?? '')}) — ${r.percentage}%${r.perStirpes ? ', per stirpes' : ', per capita'}`
    )
    .join('\n');

  const userPrompt = `
Generate a complete ${trustType} using this client data:

CLIENT DATA BLOCK:
${serializedData ?? '(Client data not available — use the details below)'}

TRUST-SPECIFIC DETAILS:
  Trust name: ${trustName}
  Trust type: ${trustType}
  ${packageType === 'fortress' ? 'Note: Generate as a JOINT IRREVOCABLE trust with co-settlor provisions — the co-settlors retain NO power to revoke, amend, or reclaim principal. The fortress package is the irrevocable Medicaid asset-protection instrument; do NOT make it revocable.' : ''}
  ${coTrustee ? `Co-trustee: ${sanitizeForPrompt(coTrustee.name ?? '')} (${sanitizeForPrompt(coTrustee.relationship ?? '')})` : ''}

  Trust beneficiaries:
  ${beneficiaries.length > 0
    ? beneficiaries.map((b: admin.firestore.DocumentData) =>
        `  - ${sanitizeForPrompt(b.name)} (${sanitizeForPrompt(b.relationship)}) — ${b.percentage ?? ''}%${b.notes ? `: ${sanitizeForPrompt(b.notes)}` : ''}`
      ).join('\n')
    : residualText || '  Settlor during lifetime; then equal shares to children, per stirpes.'}

  Distribution standard: ${distributionStandard}
  Termination age for minor trusts: ${primaryTrustDef?.terminationAge ?? 25}

  Funded assets:
    Real estate: ${fundingAssets.map((r: admin.firestore.DocumentData) =>
      `${sanitizeForPrompt(r.address)}, ${sanitizeForPrompt(r.city)}, NJ ${r.zip} (Block ${r.blockLot ?? 'TBD'})`
    ).join('; ') || 'None specified — add to Schedule A at funding'}
    Bank accounts: ${fundingBankAccounts.map((b: admin.firestore.DocumentData) =>
      `${sanitizeForPrompt(b.institution)} ${b.accountType}`
    ).join('; ') || 'None specified'}
    Investment accounts: ${fundingInvestments.map((i: admin.firestore.DocumentData) =>
      `${sanitizeForPrompt(i.institution)} ${i.accountType}`
    ).join('; ') || 'None specified'}

  Special provisions:
    Spendthrift: ${distribution.spendthriftProvision ? 'YES' : 'No'}
    Special needs child: ${specialConsiderations.hasSpecialNeedsChild ? `YES — ${sanitizeForPrompt(specialConsiderations.specialNeedsDetails ?? '')} — include SNT sub-trust` : 'No'}
    Medicaid planning: ${specialConsiderations.hasMedicaidPlanning ? `YES — ${sanitizeForPrompt(specialConsiderations.medicaidPlanningDetails ?? '')}` : 'No'}
    Pet provision: ${specialConsiderations.hasPetProvision ? `YES — ${sanitizeForPrompt(specialConsiderations.petDetails ?? '')}` : 'No'}
    Charitable goals: ${specialConsiderations.hasCharitableGoals ? `YES — ${sanitizeForPrompt(specialConsiderations.charitableGoalsDetails ?? '')}` : 'No'}
    No-contest clause: ${distribution.noContestClause ? 'Yes' : 'No'}
    Additional notes: ${sanitizeForPrompt(primaryTrustDef?.notes ?? '')}

Generate the complete ${trustType} now. Include all standard articles, comprehensive trustee powers per N.J.S.A. 3B:14-23, successor trustee provisions, distribution plan, Schedule A, execution block, and notary acknowledgment.
`.trim();

  // Resolve formatting preset from firmData
  const presetKey = (safeFirm as Record<string, unknown>)?.formattingPreset as string | undefined;
  const preset = presetKey ? getFormattingPreset(presetKey) : undefined;
  const formattingRules = preset?.promptBlock
    ? `${preset.promptBlock}\n\n• Schedule A as a formatted table.\n• Do NOT leave any "[NAME]" tokens — use actual data.`
    : DEFAULT_TRUST_FORMATTING;
  const systemPrompt = TRUST_SYSTEM_PROMPT_BASE.replace('%%FORMATTING_RULES%%', formattingRules);

  const raw = await callAI(systemPrompt, userPrompt, safeFirm, {
    model: safeFirm?.documentDraftingModel || 'gpt-5.6',
    temperature: 0.15,
    maxTokens: 32768,
    jsonMode: true,
    jsonSchema: DOCUMENT_SCHEMA,
  });

  const parsed = parseAIJson<{ title: string; content: string; _truncated?: boolean }>(raw);

  return {
    docType: 'trust',
    title: buildStandardTitle('trust', clientFullName),
    content: parsed.content ?? '',
    status: 'draft',
    ...(parsed._truncated && { _truncated: true }),
  };
}
