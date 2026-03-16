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
import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const ADVANCE_DIRECTIVE_SYSTEM_PROMPT = `
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

FORMATTING:
• Full HTML (no <html>/<body>/<head>).
• <h1> for document title, <h2> for Parts, <h3> for subsections, <p> for text.
• Use checkboxes or clearly labeled choice blocks for the instruction directive options.
• Mark the declarant's ACTUAL choices clearly (checked/selected) based on client data.
• Fill ALL client data — no "[NAME]" tokens.

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

  const pi = safe.personalInfo ?? {};
  const fiduciaries = safe.fiduciaries ?? {};
  const proxy = fiduciaries.healthcareProxy ?? {};
  const hp = safe.healthcarePreferences ?? {};

  const clientFullName = [pi.firstName, pi.middleName, pi.lastName, pi.suffix]
    .filter(Boolean)
    .join(' ');

  const primaryRep = proxy.agent ?? {};
  const alternateRep = proxy.alternateAgent;

  const userPrompt = `
Generate a complete NJ Advance Directive for Health Care using this client data:

DECLARANT:
  Full name: ${clientFullName}
  Date of birth: ${pi.dob ?? 'Unknown'}
  Address: ${pi.address}, ${pi.city}, ${pi.state} ${pi.zip}
  County: ${pi.county}

PRIMARY HEALTHCARE REPRESENTATIVE:
  Name: ${sanitizeForPrompt(primaryRep.name ?? 'TBD')}
  Relationship: ${sanitizeForPrompt(primaryRep.relationship ?? '')}
  Address: ${sanitizeForPrompt([primaryRep.address, primaryRep.city, primaryRep.state, primaryRep.zip].filter(Boolean).join(', '))}
  Phone: ${sanitizeForPrompt(primaryRep.phone ?? '')}

ALTERNATE HEALTHCARE REPRESENTATIVE:
  Name: ${alternateRep ? sanitizeForPrompt(alternateRep.name ?? 'None') : 'None'}
  Relationship: ${alternateRep ? sanitizeForPrompt(alternateRep.relationship ?? '') : ''}
  Address: ${alternateRep ? sanitizeForPrompt([alternateRep.address, alternateRep.city, alternateRep.state, alternateRep.zip].filter(Boolean).join(', ')) : ''}

HIPAA AUTHORIZATION: ${proxy.hipaaAuthorization !== false ? 'YES — include HIPAA authorization per 45 C.F.R. §164.508' : 'NO'}

LIFE-SUSTAINING TREATMENT CHOICE:
  ${hp.lifeSupport === 'withhold' ? '✓ WITHHOLD life-sustaining treatment (comfort care only)' :
      hp.lifeSupport === 'provide' ? '✓ PROVIDE all life-sustaining treatment' :
        '✓ DEFER to healthcare representative'}

ARTIFICIAL NUTRITION:
  ${hp.artificialNutrition === 'withhold' ? '✓ WITHHOLD artificial nutrition' :
      hp.artificialNutrition === 'provide' ? '✓ PROVIDE artificial nutrition' :
        '✓ DEFER to healthcare representative'}

ARTIFICIAL HYDRATION:
  ${hp.artificialHydration === 'withhold' ? '✓ WITHHOLD artificial hydration' :
      hp.artificialHydration === 'provide' ? '✓ PROVIDE artificial hydration' :
        '✓ DEFER to healthcare representative'}

PAIN MANAGEMENT:
  ${hp.painManagement === 'comfort_care' ? '✓ COMFORT CARE / palliative care only — no aggressive treatment' :
      hp.painManagement === 'all_measures' ? '✓ ALL pain management measures' :
        '✓ DEFER to healthcare representative'}

CPR DIRECTIVE:
  ${hp.cprDirective === 'dnr' ? '✓ DO NOT RESUSCITATE (DNR)' :
      hp.cprDirective === 'full_code' ? '✓ FULL CODE — attempt CPR' :
        '✓ DEFER to healthcare representative'}

NJ ALZHEIMER/DEMENTIA DIRECTIVE: ${hp.njADRD ? 'YES — include NJ ADRD provision: if I have Alzheimer\'s disease or related dementia and lack decision-making capacity, my representative\'s instructions shall govern.' : 'NO'}

ORGAN DONATION: ${hp.organDonation ? `YES — donate ${sanitizeForPrompt(hp.organDonationDetails ?? 'any and all organs and tissues')}` : 'NO — do not donate organs'}
ANATOMICAL GIFT: ${hp.anatomicalGift ? `YES — donate entire body to ${sanitizeForPrompt(hp.anatomicalGiftOrganization ?? 'medical science')}` : 'NO'}

PERSONAL STATEMENT: ${sanitizeForPrompt(hp.personalStatement ?? 'None provided.')}
RELIGIOUS BELIEFS: ${sanitizeForPrompt(hp.religiousBeliefs ?? 'None specified.')}
NOTES: ${sanitizeForPrompt(hp.notes ?? '')}

FIRM: ${sanitizeForPrompt(safeFirm.firmName ?? '')}

Generate the complete Advance Directive now. Mark the declarant's ACTUAL choices clearly. Include Part One (proxy), Part Two (instruction directive with all subsections), Part Three (general provisions), full execution block, and witness attestation with the NJ statutory disqualification language.
`.trim();

  const raw = await callAI(ADVANCE_DIRECTIVE_SYSTEM_PROMPT, userPrompt, safeFirm, {
    model: safeFirm?.documentDraftingModel || 'gpt-4o',
    temperature: 0.15,
    maxTokens: 8192,
    jsonMode: true,
  });

  const parsed = parseAIJson<{ title: string; content: string }>(raw);

  return {
    docType: 'livingWill',
    title: parsed.title ?? `Advance Directive for Health Care of ${clientFullName}`,
    content: parsed.content ?? '',
    status: 'draft',
  };
}
