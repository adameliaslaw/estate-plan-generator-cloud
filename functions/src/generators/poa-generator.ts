/**
 * functions/src/generators/poa-generator.ts
 *
 * Generates a Durable Power of Attorney compliant with New Jersey law.
 *
 * Statutory basis:
 *  - N.J.S.A. 46:2B-8.1 et seq. (New Jersey Durable Power of Attorney Act)
 *  - N.J.S.A. 46:2B-8.2: Durability clause ("This power of attorney shall not be
 *    affected by subsequent incapacity or mental incompetence of the principal.")
 *  - N.J.S.A. 46:2B-8.9: Statutory short form — full enumerated powers
 *  - N.J.S.A. 46:2B-8.13a: Gift-making authority (requires explicit grant)
 *  - N.J.S.A. 46:2B-8.10: Agent may not make gifts to self unless expressly authorized
 *  - N.J.S.A. 46:2B-8.11: Reliance by third parties — must include indemnification language
 *  - N.J.S.A. 46:2B-8.14: Notarization — POA must be signed before a notary public
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

const POA_SYSTEM_PROMPT_BASE = `
You are an expert New Jersey estate planning attorney generating a complete, execution-ready Durable Power of Attorney (POA).

GOVERNING LAW:
• N.J.S.A. 46:2B-8.1: Definitions — "durable power of attorney" means a power of attorney that by its terms states that it shall not be affected by the subsequent disability or incapacity of the principal or that it shall become effective upon the disability or incapacity of the principal.
• N.J.S.A. 46:2B-8.2: Durability — include the EXACT statutory durability clause.
• N.J.S.A. 46:2B-8.9: Statutory short form — the document should grant all standard powers enumerated in the statute (real property, personal property, trust/estate, banking, investments, taxes, benefits, health care billing, legal proceedings, business operations, insurance, gifts if authorized).
• N.J.S.A. 46:2B-8.13a: Gift-making power — ONLY include if the principal expressly authorizes; describe annual exclusion gifts and beneficiary gifts.
• N.J.S.A. 46:2B-8.10: Self-dealing restriction — agent may not benefit themselves unless the principal expressly authorizes.
• N.J.S.A. 46:2B-8.11: Third-party reliance — include indemnification/reliance clause.
• N.J.S.A. 46:2B-8.14: Execution — must be signed by the principal before a notary public; the agent does not sign the document itself.

DOCUMENT STRUCTURE:
  SECTION 1 — Designation of Agent (primary agent, alternate agent, successor agent)
  SECTION 2 — Effective Date ("immediate" or "springing upon incapacity" — include springing trigger language if requested)
  SECTION 3 — Durability Clause (exact N.J.S.A. 46:2B-8.2 statutory language)
  SECTION 4 — Enumerated Powers (comprehensive list per N.J.S.A. 46:2B-8.9):
               Real property transactions; Personal property; Stocks/bonds/investments;
               Banking/financial institutions; Business operations; Insurance/annuities;
               Retirement plans and benefits; Tax matters; Legal proceedings; 
               Government benefits (Social Security, Medicare/Medicaid, VA);
               Digital assets and electronic communications (include RUFADAA reference);
               All other lawful acts
  SECTION 5 — Gift-Making Authority (only if giftingPower=true; include annual exclusion cap, beneficiary restrictions per §46:2B-8.13a)
  SECTION 6 — Limitations and Restrictions (any specific limitations the principal imposes)
  SECTION 7 — Compensation of Agent (state "without compensation" or compensation terms)
  SECTION 8 — Successor Agents and Multiple Agents
  SECTION 9 — Governing Law (New Jersey)
  SECTION 10 — Reliance by Third Parties
  SECTION 11 — Revocation (document is revocable; prior POAs revoked)
  EXECUTION BLOCK — Principal signature, date
  NOTARY ACKNOWLEDGMENT — Full NJ notary acknowledgment block

SPRINGING POA TRIGGER LANGUAGE:
  If effective date = "springing": 
  "This power of attorney shall become effective upon my incapacity. 'Incapacity' means I am unable to manage my property and affairs effectively, as determined in writing by two licensed physicians."

%%FORMATTING_RULES%%

CONSISTENCY RULE: You will receive a standardized CLIENT DATA BLOCK.
Use EXACTLY the names, addresses, and relationships as provided —
do not rephrase, abbreviate, or reformat any proper nouns.

OUTPUT FORMAT — JSON only:
{
  "title": "Durable Power of Attorney of [Full Name]",
  "content": "<complete HTML>",
  "metadata": {
    "wordCount": <number>,
    "estimatedPages": <number>,
    "executionRequirements": ["Principal signature before notary"],
    "witnessRequired": false,
    "notarizationRequired": true
  }
}
`.trim();

const DEFAULT_POA_FORMATTING = `FORMATTING:
• Full HTML (no <html>/<body>/<head>).
• <h1> for title, <h2> for sections, <p> for text, <table> for signature block.
• Include all agent name/address lines as fill-in fields.
• Do NOT leave any "[NAME]" tokens — use actual client data.`;

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export async function generatePOA(
  clientData: admin.firestore.DocumentData,
  firmData: admin.firestore.DocumentData,
  _packageType: string,
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

  const fiduciaries = safe.fiduciaries ?? {};
  const poa = fiduciaries.powerOfAttorney ?? {};

  const financialPowers: string[] = poa.financialPowers ?? [
    'Real property transactions',
    'Personal property transactions',
    'Banking and financial institutions',
    'Investment and securities',
    'Business operations',
    'Insurance and annuities',
    'Retirement plan transactions',
    'Tax matters',
    'Government benefits',
    'Legal proceedings',
    'Digital assets (RUFADAA)',
  ];

  const userPrompt = `
Generate a complete Durable Power of Attorney using this client data:

CLIENT DATA BLOCK:
${serializedData ?? '(Client data not available — use the details below)'}

POA-SPECIFIC DETAILS:
  Effective date: ${poa.effectiveDate === 'springing' ? 'SPRINGING — effective upon incapacity (two-physician certification required)' : 'IMMEDIATE — effective upon signing'}
  Durability: ${poa.durability !== false ? 'Yes — durable (survives incapacity)' : 'No — non-durable (terminates on incapacity)'}
  Financial powers granted:
${financialPowers.map((p: string) => `    • ${sanitizeForPrompt(p)}`).join('\n')}
  Gift-making power: ${poa.giftingPower ? 'YES — include N.J.S.A. 46:2B-8.13a gift-making authority (annual exclusion gifts to beneficiaries)' : 'NO — do not include gift-making authority'}
  Self-dealing: ${poa.selfDealingPower ? 'YES — agent may engage in self-dealing as expressly authorized' : 'NO — standard restriction applies'}
  Limitations: ${sanitizeForPrompt(poa.limitations ?? 'None specified.')}
  Notes: ${sanitizeForPrompt(poa.notes ?? '')}

Generate the complete Durable POA now. Include all enumerated powers, the exact N.J.S.A. 46:2B-8.2 durability clause, ${poa.giftingPower ? 'gift-making authority,' : ''} third-party reliance clause, and full NJ notary acknowledgment block.
`.trim();

  // Resolve formatting preset from firmData
  const presetKey = (safeFirm as Record<string, unknown>)?.formattingPreset as string | undefined;
  const preset = presetKey ? getFormattingPreset(presetKey) : undefined;
  const formattingRules = preset?.promptBlock
    ? `${preset.promptBlock}\n\n• Do NOT leave any "[NAME]" tokens — use actual client data.`
    : DEFAULT_POA_FORMATTING;
  const systemPrompt = POA_SYSTEM_PROMPT_BASE.replace('%%FORMATTING_RULES%%', formattingRules);

  const raw = await callAI(systemPrompt, userPrompt, safeFirm, {
    model: safeFirm?.documentDraftingModel || 'gpt-5.4',
    temperature: 0.15,
    maxTokens: 16384,
    jsonMode: true,
    jsonSchema: DOCUMENT_SCHEMA,
  });

  const parsed = parseAIJson<{ title: string; content: string; _truncated?: boolean }>(raw);

  // Guard: content must be non-trivially populated
  if (!parsed.content || parsed.content.trim().length < 200) {
    throw new Error(
      `[generatePOA] AI returned empty or near-empty content (${parsed.content?.length ?? 0} chars). ` +
      `Title was: "${parsed.title}". Raw response (first 300): ${raw.slice(0, 300)}`,
    );
  }

  return {
    docType: 'poa',
    title: buildStandardTitle('poa', clientFullName),
    content: parsed.content ?? '',
    status: 'draft',
    ...(parsed._truncated && { _truncated: true }),
  };
}
