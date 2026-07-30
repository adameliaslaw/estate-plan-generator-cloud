/**
 * functions/src/generators/advance-directive-generator.ts
 *
 * Generates a combined New Jersey Advance Directive for Health Care, which
 * incorporates both the Healthcare Proxy (Part One) and the Instruction Directive
 * / Living Will (Part Two) in a single document.
 *
 * Statutory basis:
 *  - N.J.S.A. 26:2H-53 through 26:2H-78 (New Jersey Advance Directive for Health Care Act)
 *  - N.J.S.A. 26:2H-56: Requirements for a valid advance directive
 *  - N.J.S.A. 26:2H-57: Designation of healthcare representative
 *  - N.J.S.A. 26:2H-58: Instruction directive (living will provisions)
 *  - N.J.S.A. 26:2H-60: Disqualifications (treating healthcare professional, operator/employee
 *    of residential facility cannot serve as healthcare representative)
 *  - N.J.S.A. 26:2H-65: Revocation
 *  - HIPAA Privacy Rule, 45 C.F.R. §164.508: HIPAA authorization for healthcare representative
 *    to access protected health information
 *  - N.J.S.A. 26:2H-68: Immunity for healthcare providers following the directive
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

const ADVANCE_DIRECTIVE_SYSTEM_PROMPT_BASE = `
You are an expert New Jersey estate planning and healthcare law attorney generating a complete, execution-ready New Jersey Advance Directive for Health Care.

GOVERNING LAW:
• N.J.S.A. 26:2H-53 et seq. (NJ Advance Directive for Health Care Act)
• N.J.S.A. 26:2H-56: A valid advance directive must be: (a) in writing; (b) signed by the declarant; (c) witnessed by two adult individuals who are not: the healthcare representative named in the directive, a blood relative, a spouse/domestic partner, an heir, or the attending physician/administrator of any healthcare facility where the declarant is a patient.
• N.J.S.A. 26:2H-57: Healthcare representative designation — the proxy designation.
• N.J.S.A. 26:2H-58: Instruction directive — specific life-sustaining treatment instructions.
• N.J.S.A. 26:2H-60: Disqualification — an operator or employee of a residential healthcare facility cannot be a representative unless related to the patient.
• N.J.S.A. 26:2H-65: Right to revoke at any time.
• HIPAA 45 C.F.R. §164.508: Include HIPAA authorization authorizing the healthcare representative to obtain all medical records and information.

DOCUMENT STRUCTURE (three-part structure):

PART ONE — HEALTHCARE REPRESENTATIVE DESIGNATION (Proxy)
  • Name, address of primary healthcare representative
  • Name, address of alternate healthcare representative
  • Scope of authority: ALL healthcare decisions including life-sustaining treatment
  • HIPAA authorization (45 C.F.R. §164.508): Representative may access all PHI
  • Statement that representative's authority becomes effective upon declarant's incapacity

PART TWO — INSTRUCTION DIRECTIVE (Living Will)
  A. Life-Sustaining Treatment
     • Choice A: Withhold life-sustaining treatment (comfort care only)
     • Choice B: Provide all life-sustaining treatment
     • Choice C: Undecided / defer to representative
  B. Artificial Nutrition and Hydration
     • Withhold / Provide / Defer
  C. Artificially Administered Hydration Only
     • Withhold / Provide / Defer
  D. Pain Management and Comfort Care
     • Comfort care (palliative) only / All measures / Defer
  E. CPR Directive (DNR or full code)
  F. Alzheimer's/Related Dementia (NJ-specific ADRD provision): if njADRD=true, include specific dementia directive
  G. Pregnancy: if the declarant is of childbearing age, include the NJ required pregnancy provision
  H. Organ and Tissue Donation
     • Donate any/all organs; specific organs only; no donation
  I. Anatomical Gift (whole body)
  J. Burial/Disposition Preferences (cremation/burial)
  K. Personal Statement / Religious Beliefs (if provided)

PART THREE — GENERAL PROVISIONS
  • Right to revoke
  • Conflict between Parts One and Two (representative instruction overrides if conflict)
  • Immunity for healthcare providers
  • Governing law: New Jersey
  • Severability

EXECUTION BLOCK:
  • Declarant signature and date
  • WITNESS ATTESTATION: Two witnesses (neither is: healthcare representative, blood relative, heir, or healthcare facility employee/operator) — include full statutory disqualification attestation
  • Notarization: Notary is NOT required for a valid NJ advance directive, but include optional notary block for added weight

%%FORMATTING_RULES%%

CONSISTENCY RULE: You will receive a standardized CLIENT DATA BLOCK.
Use EXACTLY the names, addresses, and relationships as provided —
do not rephrase, abbreviate, or reformat any proper nouns.

OUTPUT FORMAT — JSON only:
{
  "title": "Advance Directive for Health Care of [Full Name]",
  "content": "<complete HTML>",
  "metadata": {
    "wordCount": <number>,
    "estimatedPages": <number>,
    "executionRequirements": ["Declarant signature", "Two non-interested adult witnesses"],
    "witnessRequired": true,
    "notarizationRequired": false
  }
}
`.trim();

const DEFAULT_AD_FORMATTING = `FORMATTING:
• Full HTML (no <html>/<body>/<head>).
• <h1> for document title, <h2> for Parts, <h3> for subsections, <p> for text.
• Use checkboxes or clearly labeled choice blocks for the instruction directive options.
• Mark the declarant's ACTUAL choices clearly (checked/selected) based on client data.
• Fill ALL client data — no "[NAME]" tokens.`;

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export async function generateAdvanceDirective(
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
  const proxy = fiduciaries.healthcareProxy ?? {};
  const hp = safe.healthcarePreferences ?? {};

  const userPrompt = `
Generate a complete NJ Advance Directive for Health Care using this client data:

CLIENT DATA BLOCK:
${serializedData ?? '(Client data not available — use the details below)'}

HEALTHCARE DIRECTIVE CHOICES:
  HIPAA authorization: ${proxy.hipaaAuthorization !== false ? 'YES — include HIPAA authorization per 45 C.F.R. §164.508' : 'NO'}
  Life-sustaining treatment: ${hp.lifeSupport === 'withhold' ? '✓ WITHHOLD (comfort care only)' : hp.lifeSupport === 'provide' ? '✓ PROVIDE all treatment' : '✓ DEFER to representative'}
  Artificial nutrition: ${hp.artificialNutrition === 'withhold' ? '✓ WITHHOLD' : hp.artificialNutrition === 'provide' ? '✓ PROVIDE' : '✓ DEFER to representative'}
  Artificial hydration: ${hp.artificialHydration === 'withhold' ? '✓ WITHHOLD' : hp.artificialHydration === 'provide' ? '✓ PROVIDE' : '✓ DEFER to representative'}
  Pain management: ${hp.painManagement === 'comfort_care' ? '✓ COMFORT CARE only' : hp.painManagement === 'all_measures' ? '✓ ALL measures' : '✓ DEFER to representative'}
  CPR directive: ${hp.cprDirective === 'dnr' ? '✓ DO NOT RESUSCITATE (DNR)' : hp.cprDirective === 'full_code' ? '✓ FULL CODE — attempt CPR' : '✓ DEFER to representative'}
  NJ Alzheimer/dementia directive: ${hp.njADRD ? 'YES — include NJ ADRD provision' : 'NO'}
  Organ donation: ${hp.organDonation ? `YES — donate ${sanitizeForPrompt(hp.organDonationDetails ?? 'any and all organs and tissues')}` : 'NO'}
  Anatomical gift: ${hp.anatomicalGift ? `YES — donate body to ${sanitizeForPrompt(hp.anatomicalGiftOrganization ?? 'medical science')}` : 'NO'}
  Personal statement: ${sanitizeForPrompt(hp.personalStatement ?? 'None provided.')}
  Religious beliefs: ${sanitizeForPrompt(hp.religiousBeliefs ?? 'None specified.')}
  Notes: ${sanitizeForPrompt(hp.notes ?? '')}

Generate the complete Advance Directive now. Mark the declarant's ACTUAL choices clearly. Include Part One (proxy), Part Two (instruction directive with all subsections), Part Three (general provisions), full execution block, and witness attestation with the NJ statutory disqualification language.
`.trim();

  // Resolve formatting preset from firmData
  const presetKey = (safeFirm as Record<string, unknown>)?.formattingPreset as string | undefined;
  const preset = presetKey ? getFormattingPreset(presetKey) : undefined;
  const formattingRules = preset?.promptBlock
    ? `${preset.promptBlock}\n\n• Mark the declarant's ACTUAL choices clearly (checked/selected) based on client data.\n• Fill ALL client data — no "[NAME]" tokens.`
    : DEFAULT_AD_FORMATTING;
  const systemPrompt = ADVANCE_DIRECTIVE_SYSTEM_PROMPT_BASE.replace('%%FORMATTING_RULES%%', formattingRules);

  const raw = await callAI(systemPrompt, userPrompt, safeFirm, {
    model: safeFirm?.documentDraftingModel || 'claude-opus-5',
    temperature: 0.15,
    maxTokens: 16384,
    jsonMode: true,
    jsonSchema: DOCUMENT_SCHEMA,
  });

  const parsed = parseAIJson<{ title: string; content: string; _truncated?: boolean }>(raw);

  return {
    docType: 'livingWill',
    title: buildStandardTitle('livingWill', clientFullName),
    content: parsed.content ?? '',
    status: 'draft',
    ...(parsed._truncated && { _truncated: true }),
  };
}
