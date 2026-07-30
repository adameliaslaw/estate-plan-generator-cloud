/**
 * functions/src/generators/will-generator.ts
 *
 * Generates a Last Will and Testament compliant with NJ law.
 *
 * Statutory basis:
 *  - N.J.S.A. 3B:3-1 et seq. (Will formalities)
 *  - N.J.S.A. 3B:3-2 (Signature + two adult non-beneficiary witnesses)
 *  - N.J.S.A. 3B:3-4 (Self-proving affidavit — optional but strongly recommended)
 *  - N.J.S.A. 3B:5-3 (Anti-lapse — per stirpes distribution)
 *  - N.J.S.A. 3B:5-15 (Omitted spouse)
 *  - N.J.S.A. 3B:5-16 (Omitted children / pretermitted heirs)
 *  - N.J.S.A. 3B:14-23 (Executor powers)
 *  - N.J.S.A. 3B:9-1 et seq. (Spendthrift and discretionary trusts)
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

const WILL_SYSTEM_PROMPT_BASE = `
You are an expert New Jersey estate planning attorney generating a complete, execution-ready Last Will and Testament.

GOVERNING LAW:
• N.J.S.A. 3B:3-1 through 3B:3-29 (Wills — formalities and execution)
• N.J.S.A. 3B:3-2: Will must be signed by the testator OR by another person in the testator's conscious presence and at the testator's direction; signed by at least two adult witnesses who sign within a reasonable time after witnessing the testator's signature or acknowledgment; witnesses must not be beneficiaries under the will.
• N.J.S.A. 3B:3-4: Self-proving affidavit — include the full statutory self-proving affidavit language so the will may be admitted to probate without witness testimony.
• N.J.S.A. 3B:5-3: Anti-lapse protection — use per stirpes distribution to descendants unless testator directs otherwise.
• N.J.S.A. 3B:5-15: Omitted spouse protection — acknowledge and explicitly address surviving spouse's elective share rights if applicable.
• N.J.S.A. 3B:5-16: Pretermitted heir protection — include provision acknowledging any intentionally omitted children.
• N.J.S.A. 3B:14-23: Executor powers — include broad executor power clause tracking the statutory list.
• N.J.S.A. 3B:9-1 et seq.: If spendthrift clause requested, include proper spendthrift language.

DOCUMENT STRUCTURE (required articles):
  ARTICLE I   — Declaration of Domicile, Revocation of Prior Wills
  ARTICLE II  — Family (spouse, children — include full legal names and DOBs; omit guardian provisions if no minors)
  ARTICLE III — Payment of Debts and Expenses
  ARTICLE IV  — Specific Bequests (omit article if none)
  ARTICLE V   — Charitable Bequests (omit if none)
  ARTICLE VI  — Residuary Estate — primary and alternate distributions; state per stirpes/per capita
  ARTICLE VII — Executor Appointment (primary, alternate, successor; bond waiver; statutory compensation or waiver)
  ARTICLE VIII— Executor Powers (broad powers per N.J.S.A. 3B:14-23; list key powers)
  ARTICLE IX  — Guardianship (only if testator has minor children; name guardian and alternate)
  ARTICLE X   — General Provisions (survival period, no-contest clause if requested, digital assets, spendthrift if requested)
  EXECUTION BLOCK — Testator signature line, date, city, state
  WITNESS ATTESTATION — Standard NJ witness attestation clause with two witness signature/address lines
  SELF-PROVING AFFIDAVIT — Full statutory language per N.J.S.A. 3B:3-4 with notary block

%%FORMATTING_RULES%%

CONSISTENCY RULE: You will receive a standardized CLIENT DATA BLOCK.
Use EXACTLY the names, addresses, and relationships as provided —
do not rephrase, abbreviate, or reformat any proper nouns.

OUTPUT FORMAT:
Respond with a valid JSON object only (no markdown fences):
{
  "title": "Last Will and Testament of [Full Name]",
  "content": "<complete HTML document body>",
  "metadata": {
    "wordCount": <number>,
    "estimatedPages": <number>,
    "executionRequirements": ["Testator signature", "Two adult non-beneficiary witnesses", "Notary for self-proving affidavit"],
    "witnessRequired": true,
    "notarizationRequired": true
  }
}
`.trim();

// Default formatting rules (when no preset is active)
const DEFAULT_FORMATTING_RULES = `FORMATTING RULES:
• Output the full document as well-structured HTML (no <html>/<body>/<head>).
• Use <h1> for the document title, <h2> for articles, <p> for paragraphs, <table> for signature blocks.
• Use blank lines / margin styling in signatures for physical signing.
• NEVER fabricate statutes, case citations, or legal standards.
• Fill ALL placeholders with actual client data — do not leave "[NAME]" tokens.
• If a field is unknown, use a blank line "_______________" as a fill-in.`;

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export async function generateWill(
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

  const distribution = safe.distribution ?? {};
  const specialConsiderations = safe.specialConsiderations ?? {};
  const assets = safe.assets ?? {};

  // Build will-specific supplemental details not fully covered by the canonical serializer
  const specificBequestsText = (distribution.specificBequests ?? [])
    .map((b: admin.firestore.DocumentData, i: number) =>
      `${i + 1}. "${sanitizeForPrompt(b.description)}" to ${sanitizeForPrompt(b.recipient)}${b.condition ? `, provided that ${sanitizeForPrompt(b.condition)}` : ''}${b.alternateRecipient ? `; if predeceased, to ${sanitizeForPrompt(b.alternateRecipient)}` : ''}.`
    )
    .join('\n');

  const digitalAssetsFlag = (assets.digitalAssets ?? []).length > 0;

  const userPrompt = `
Generate a complete Last Will and Testament using this client data:

CLIENT DATA BLOCK:
${serializedData ?? '(Client data not available — use the details below)'}

WILL-SPECIFIC DETAILS:
  Specific bequests: ${specificBequestsText || 'None.'}
  Pour-over to trust: ${distribution.pourOverToTrust ? `Yes — pour-over residue to ${sanitizeForPrompt(distribution.trustName ?? 'the Revocable Living Trust')}` : 'No'}
  No-contest clause: ${distribution.noContestClause ? 'Yes — include in terrorem clause' : 'No'}
  Spendthrift provision: ${distribution.spendthriftProvision ? 'Yes — include spendthrift trust language' : 'No'}
  Digital assets: ${digitalAssetsFlag ? 'Yes — include digital assets provision, reference password manager / credential documentation' : 'No'}
  Special needs child: ${specialConsiderations.hasSpecialNeedsChild ? `Yes — ${sanitizeForPrompt(specialConsiderations.specialNeedsDetails ?? '')}` : 'No'}
  Pet provision: ${specialConsiderations.hasPetProvision ? `Yes — ${sanitizeForPrompt(specialConsiderations.petDetails ?? '')}; caretaker: ${sanitizeForPrompt(specialConsiderations.petCaretaker ?? 'TBD')}` : 'No'}
  Notes: ${sanitizeForPrompt(distribution.notes ?? '')}

Generate the complete, execution-ready will now. Include all required articles, the full NJ witness attestation, and the complete N.J.S.A. 3B:3-4 self-proving affidavit with notary block.
`.trim();

  // Resolve formatting preset from firmData
  const presetKey = (safeFirm as Record<string, unknown>)?.formattingPreset as string | undefined;
  const preset = presetKey ? getFormattingPreset(presetKey) : undefined;

  // Build system prompt with appropriate formatting rules
  const formattingRules = preset?.promptBlock
    ? `${preset.promptBlock}\n\n• NEVER fabricate statutes, case citations, or legal standards.\n• Fill ALL placeholders with actual client data — do not leave "[NAME]" tokens.\n• If a field is unknown, use a blank line "_______________" as a fill-in.`
    : DEFAULT_FORMATTING_RULES;

  const systemPrompt = WILL_SYSTEM_PROMPT_BASE.replace('%%FORMATTING_RULES%%', formattingRules);

  const raw = await callAI(systemPrompt, userPrompt, safeFirm, {
    model: safeFirm?.documentDraftingModel || 'gpt-5.6',
    temperature: 0.15,
    maxTokens: 16384,
    jsonMode: true,
    jsonSchema: DOCUMENT_SCHEMA,
  });

  const parsed = parseAIJson<{ title: string; content: string; _truncated?: boolean }>(raw);

  return {
    docType: 'will',
    title: buildStandardTitle('will', clientFullName),
    content: parsed.content ?? '',
    status: 'draft',
    ...(parsed._truncated && { _truncated: true }),
  };
}
