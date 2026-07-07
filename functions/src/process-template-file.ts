/**
 * functions/src/process-template-file.ts
 *
 * Cloud Function to process uploaded .docx and .pdf template files.
 * Downloads the file from Firebase Storage, extracts text/HTML,
 * and uses AI to smart-detect template variables and map them to
 * questionnaire fields.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { loadFirmSecrets } from './firm-secrets';
import mammoth from 'mammoth';
 
const globalWithDom = global as typeof global & { DOMMatrix?: unknown };
if (typeof global !== 'undefined' && !globalWithDom.DOMMatrix) {
  globalWithDom.DOMMatrix = class DOMMatrix {};
}
// require (not import) is deliberate: ES imports hoist above the DOMMatrix
// polyfill, and pdf-parse needs the polyfill at load time.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PDFParse } = require('pdf-parse');
import { callAI, parseAIJson } from './ai-client';
import { getLearningContext, formatLearningPrompt, recordCorrection, recordConfirmedVariables } from './template-learning';
import { applyTemplateFormattingStyles, extractTemplateVariables } from './template-engine';
import { compareHtmlStructure, buildFidelityRetryInstruction } from './template-fidelity-validator';

// ---------------------------------------------------------------------------
// Helper: truncate text at a word boundary
// ---------------------------------------------------------------------------
function truncateAtWordBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > maxLen * 0.8 ? truncated.slice(0, lastSpace) + '…' : truncated + '…';
}

// ---------------------------------------------------------------------------
// Available questionnaire fields (for AI context)
// ---------------------------------------------------------------------------

const AVAILABLE_FIELDS = `
AVAILABLE QUESTIONNAIRE FIELDS (dot-path notation):

personalInfo.firstName, personalInfo.middleName, personalInfo.lastName, personalInfo.suffix
personalInfo.dob, personalInfo.ssnLast4, personalInfo.address, personalInfo.city
personalInfo.state, personalInfo.zip, personalInfo.county, personalInfo.email
personalInfo.phone, personalInfo.maritalStatus, personalInfo.citizenship
personalInfo.occupation, personalInfo.employer

spouseInfo.firstName, spouseInfo.middleName, spouseInfo.lastName, spouseInfo.suffix
spouseInfo.dob, spouseInfo.email, spouseInfo.phone
spouseInfo.address, spouseInfo.city, spouseInfo.state, spouseInfo.zip

children[] — array of: { firstName, middleName, lastName, suffix, name (legacy joined), dob, isMinor, relationship, specialNeeds, guardian, alternateGuardian }
grandchildren[] — array of: { firstName, middleName, lastName, suffix, name, dob, parentName, gender, specialNeeds, specialNeedsDetails }
otherDependents[] — array of: { firstName, middleName, lastName, suffix, name, relationship, notes }

Every fiduciary slot AND every repeater item carries firstName / middleName / lastName / suffix as the canonical split-name fields. The legacy joined .name is derived from those parts at generation time (client-context-aggregator.deriveName) and written back so old {{...name}} bindings keep rendering. Prefer the split parts when you need formal address ("Mr. Polo") or surname-only references; use {{...name}} when you want the full joined string.

fiduciaries.executor.primary.firstName / .middleName / .lastName / .suffix / .name
fiduciaries.executor.primary.relationship, fiduciaries.executor.primary.address
fiduciaries.executor.alternate.firstName / .middleName / .lastName / .suffix / .name
fiduciaries.executor.alternate.relationship, fiduciaries.executor.alternate.address
fiduciaries.executor.successor.firstName / .middleName / .lastName / .suffix / .name
fiduciaries.executor.successor.relationship, fiduciaries.executor.successor.address
fiduciaries.executor.secondSuccessor.firstName / .middleName / .lastName / .suffix / .name
fiduciaries.executor.secondSuccessor.relationship, fiduciaries.executor.secondSuccessor.address
fiduciaries.executor.thirdSuccessor.firstName / .middleName / .lastName / .suffix / .name
fiduciaries.executor.thirdSuccessor.relationship, fiduciaries.executor.thirdSuccessor.address
fiduciaries.executor.bondRequired, fiduciaries.executor.compensation

fiduciaries.trustee.primary.firstName / .middleName / .lastName / .suffix / .name
fiduciaries.trustee.primary.relationship, fiduciaries.trustee.primary.address
fiduciaries.trustee.alternate.firstName / .middleName / .lastName / .suffix / .name
fiduciaries.trustee.alternate.relationship, fiduciaries.trustee.alternate.address
fiduciaries.trustee.successor.firstName / .middleName / .lastName / .suffix / .name
fiduciaries.trustee.successor.relationship, fiduciaries.trustee.successor.address

fiduciaries.powerOfAttorney.agent.firstName / .middleName / .lastName / .suffix / .name
fiduciaries.powerOfAttorney.agent.relationship, fiduciaries.powerOfAttorney.agent.address
fiduciaries.powerOfAttorney.agent.city, fiduciaries.powerOfAttorney.agent.state, fiduciaries.powerOfAttorney.agent.zip
fiduciaries.powerOfAttorney.alternateAgent.firstName / .middleName / .lastName / .suffix / .name
fiduciaries.powerOfAttorney.alternateAgent.relationship
fiduciaries.powerOfAttorney.effectiveDate, fiduciaries.powerOfAttorney.giftingAuthority
fiduciaries.powerOfAttorney.powers[]

fiduciaries.healthcareProxy.agent.firstName / .middleName / .lastName / .suffix / .name
fiduciaries.healthcareProxy.agent.relationship, fiduciaries.healthcareProxy.agent.address
fiduciaries.healthcareProxy.agent.city, fiduciaries.healthcareProxy.agent.state, fiduciaries.healthcareProxy.agent.zip
fiduciaries.healthcareProxy.alternateAgent.firstName / .middleName / .lastName / .suffix / .name
fiduciaries.healthcareProxy.alternateAgent.relationship, fiduciaries.healthcareProxy.alternateAgent.address
fiduciaries.healthcareProxy.alternateAgent.city, fiduciaries.healthcareProxy.alternateAgent.state, fiduciaries.healthcareProxy.alternateAgent.zip
fiduciaries.healthcareProxy.lifeSupport, fiduciaries.healthcareProxy.nutrition
fiduciaries.healthcareProxy.painManagement, fiduciaries.healthcareProxy.organDonation

fiduciaries.guardian.primary.firstName / .middleName / .lastName / .suffix / .name
fiduciaries.guardian.primary.relationship, fiduciaries.guardian.primary.address
fiduciaries.guardian.alternate.firstName / .middleName / .lastName / .suffix / .name
fiduciaries.guardian.alternate.relationship, fiduciaries.guardian.alternate.address
fiduciaries.guardian.successor.firstName / .middleName / .lastName / .suffix / .name
fiduciaries.guardian.successor.relationship, fiduciaries.guardian.successor.address

distribution.residualDistributions[] — { recipient, recipientRelationship, percentage, perStirpes, alternateRecipient }
distribution.specificBequests[] — { description, recipient, condition, alternateRecipient }
distribution.charitableBequests[] — { organizationName, ein, amount, percentage, purpose }
distribution.trustName, distribution.pourOverToTrust, distribution.noContestClause
distribution.spendthriftProvision, distribution.survivorshipPeriod

assets.realEstate[] — { address, type, currentValue, ownershipType, mortgageBalance }
assets.investments[] — { institution, accountType, estimatedValue }
assets.insurance[] — { company, policyType, deathBenefit, beneficiary }
assets.digitalAssets[] — { name, type }

specialConsiderations.hasSpecialNeedsChild, specialConsiderations.specialNeedsDetails
specialConsiderations.hasPetProvision, specialConsiderations.petDetails, specialConsiderations.petCaretaker
specialConsiderations.funeralWishes, specialConsiderations.funeralRepresentative

FIRM DATA FIELDS (from firm settings, NOT client-specific):
firm.name, firm.address, firm.city, firm.state, firm.zip, firm.phone
firm.attorneyName, firm.attorneyId
firm.witness1Name, firm.witness1Address
firm.witness2Name, firm.witness2Address
firm.notaryName, firm.notaryCounty, firm.notaryCommission

COMPUTED FIELDS (generated by system, not from questionnaire):
clientFullName, spouseFullName, hasSpouse, hasMinorChildren, hasSpecialNeedsChild
childCount, minorChildren[], adultChildren[], propertyCount
propertiesForTrust[], estimatedTotalAssets, primaryTrustName
todayFormatted, todayISO, packageType, packageLabel

RELATIONSHIP TITLE FIELDS (auto-derived from questionnaire data):
spouseTitle — "husband", "wife", or "partner" (derived from client gender + marital status)
clientTitle — the client's own relationship descriptor (reverse of spouseTitle)
executorTitle — relationship descriptor for executor (from fiduciaries.executor.primary.relationship)
alternateExecutorTitle — relationship descriptor for alternate executor
trusteeTitle — relationship descriptor for trustee
poaAgentTitle — relationship descriptor for POA agent
healthcareRepTitle — relationship descriptor for healthcare rep
guardianTitle — relationship descriptor for guardian
clientPronouns.subject / .object / .possessive — he/him/his or she/her/her (PRINCIPAL only)
spousePronouns.subject / .object / .possessive — pronouns for the principal's spouse
poaAgentPronouns / poaAlternateAgentPronouns — pronouns for the POA Attorney-in-Fact and alternate. USE THESE for any sentence whose subject is the AIF (e.g. "to satisfy {{poaAgentPronouns.possessive}} obligation of support") — clientPronouns is the PRINCIPAL's gender and is wrong here when AIF is a different person.
healthcareRepPronouns / healthcareRepAlternatePronouns — pronouns for the Healthcare Representative and alternate. USE THESE for sentences whose subject is the HCR.
executorPronouns / executorAlternatePronouns / trusteePronouns / trusteeAlternatePronouns — pronouns for those fiduciary slots. USE THESE for sentences whose subject is that fiduciary.
spousePronouns.subject / .object / .possessive — he/him/his or she/her/her
childrenWithTitles[] — same as children[] but each child also has a "childTitle" field = "son"/"daughter"/"stepson"/"stepdaughter"

CRITICAL MAPPING RULES — RELATIONSHIP WORDS vs NAMES:
- "my husband", "my wife", "my partner" → map to spouseTitle (NOT spouseFullName)
- "my son", "my daughter", "my stepson", "my stepdaughter" → map to the child's childTitle (NOT to a name field)
- "my children" (collective reference) → do NOT map; leave as literal text
- "he", "him", "his", "she", "her" referring to the client → map to clientPronouns.subject / .object / .possessive
- "he", "him", "his", "she", "her" referring to the spouse → map to spousePronouns.subject / .object / .possessive
- Only actual NAMES (e.g., "John Smith", "Jane Doe") should map to name fields like clientFullName, spouseFullName, children[0].name
- Phrases like "my husband, Sean Byrnes" contain TWO variables: "my husband" → spouseTitle, "Sean Byrnes" → spouseFullName

CRITICAL MAPPING RULES — COMPOUND RELATIONSHIP TITLES:
- Relationship titles like "sister-in-law", "brother-in-law", "mother-in-law", "father-in-law", "daughter-in-law", "son-in-law" are SINGLE relationship values.
- NEVER split a compound title into a variable + literal suffix (e.g., WRONG: {{relationship}}-in-law). The ENTIRE compound title is ONE variable: {{relationship}} = "sister-in-law".
- The .relationship field stores the FULL relationship descriptor from the client's perspective, including "-in-law" when applicable.
- "my sister-in-law, Olivia Esernio" → TWO variables: "my sister-in-law" → the relationship title, "Olivia Esernio" → the name field.

CRITICAL — EVERY PROPER NAME MUST BE DETECTED:
- Every capitalized proper name (person's full name) in the document MUST be detected as a variable. No hardcoded names allowed.
- If a name appears that you cannot match to an existing field, use the CLOSEST available field path.
- Scan the ENTIRE document for proper names — do not skip any section.

CRITICAL MAPPING RULES — SUCCESSOR FIDUCIARIES:
- Estate planning documents often appoint MULTIPLE levels of successor executors/trustees. Each level MUST use a DIFFERENT variable path.
- "First Successor Executor" → fiduciaries.executor.alternate.name (+ .relationship, .address)
- "Second Successor Executor" → fiduciaries.executor.successor.name (+ .relationship, .address)
- "Third Successor Executor" → fiduciaries.executor.secondSuccessor.name (+ .relationship, .address)
- If the same person's name AND the same address appear for multiple appointments, they are still SEPARATE variables because different clients may want different people at each level.
- The same rule applies to trustees, guardians, POA agents, etc.
- Hardcoded addresses (street addresses like "315 East 72nd Street, Apt. PH, New York, New York") next to fiduciary names are client data — ALWAYS detect them as variables using the .address field.

CRITICAL MAPPING RULES — GUARDIANS:
- Guardian appointments are a SEPARATE fiduciary role from executors AND trustees. They MUST use fiduciaries.guardian.* paths — NEVER fiduciaries.executor.* or fiduciaries.trustee.* paths.
- Even if the SAME PERSON serves as both executor/trustee AND guardian, the guardian appointment MUST use guardian field paths. Different clients may appoint different people to each role.
- CORRECT guardian variable paths:
  - Primary guardian: fiduciaries.guardian.primary.name / .relationship / .address
  - Alternate/co-guardian: fiduciaries.guardian.alternate.name / .relationship / .address
  - Successor guardian: fiduciaries.guardian.successor.name / .relationship / .address
- NEVER use fiduciaries.executor.* or fiduciaries.trustee.* paths for any person named in a guardian appointment — even if that person appears elsewhere as executor or trustee.
- RELATIONSHIP WORDS IN GUARDIAN SECTIONS: Every relationship descriptor before a guardian's name MUST be templatized:
  - WRONG: "my parents, {{fiduciaries.guardian.primary.name}}" — "my parents" is hardcoded
  - CORRECT: "my {{fiduciaries.guardian.primary.relationship}}, {{fiduciaries.guardian.primary.name}}"
  - WRONG: "my brother, {{fiduciaries.trustee.primary.name}}" — wrong path AND hardcoded relationship
  - CORRECT: "my {{fiduciaries.guardian.successor.relationship}}, {{fiduciaries.guardian.successor.name}}"
  - WRONG: "my sister-in-law, {{name}}" — hardcoded relationship
  - CORRECT: "my {{fiduciaries.guardian.alternate.relationship}}, {{fiduciaries.guardian.alternate.name}}"
- Scan the ENTIRE guardian article for relationship words (parent, brother, sister, uncle, aunt, cousin, friend, etc.) followed by a name — ALL must be templatized.

CRITICAL MAPPING RULES — WITNESSES AND FIRM DATA:
- Witness names in execution/attestation/self-proving affidavit sections are NOT the client — they are firm staff.
- Witness names → firm.witness1Name, firm.witness2Name
- Witness addresses → firm.witness1Address, firm.witness2Address
- The attorney's name (e.g., "Adam J. Elias, Esq.") → firm.attorneyName
- The attorney's ID number (e.g., "#050452014") → firm.attorneyId
- The firm's name (e.g., "Elias Counsel, LLC") → firm.name
- The firm's office address (street, city, state, zip in signature blocks or letterhead) → firm.address, firm.city, firm.state, firm.zip
- The firm's phone number → firm.phone

CRITICAL MAPPING RULES — FUNERAL/SPECIAL PROVISIONS:
- Funeral wishes, burial preferences, or cremation instructions (e.g., "To be cremated") → specialConsiderations.funeralWishes (NOT petDetails)
- Pet care instructions only → specialConsiderations.petDetails
`;

const AVAILABLE_TAGS = `
AVAILABLE TEMPLATE TAGS — select ALL that apply based on document content:

Document Type tags:
- "standard-will" — a standard last will and testament
- "pour-over-will" — a pour-over will directing assets into a trust
- "simple-will" — a simple/basic will
- "revocable-trust" — a revocable living trust
- "irrevocable-trust" — an irrevocable trust
- "special-needs-trust" — a special needs trust
- "financial-poa" — a financial/durable power of attorney
- "healthcare-poa" — a healthcare power of attorney / healthcare proxy
- "living-will" — a living will or advance directive
- "guardianship" — a guardianship designation

Client tags:
- "male-client" — the primary client/testator/grantor is male
- "female-client" — the primary client/testator/grantor is female
- "husband" — the client is a husband
- "wife" — the client is a wife
- "married" — the client is married (spouse referenced)
- "single" — the client is single/unmarried
- "has-children" — children are referenced in the document
- "has-minor-children" — minor children or guardianship provisions are present

Role tags:
- "male-executor" — the named executor is male
- "female-executor" — the named executor is female
- "male-trustee" — the named trustee is male
- "female-trustee" — the named trustee is female
- "corporate-trustee" — a corporate/institutional trustee is named

Jurisdiction tags:
- "nj" — New Jersey law referenced or NJ-specific provisions
- "ny" — New York law referenced or NY-specific provisions
- "pa" — Pennsylvania law referenced or PA-specific provisions
`;

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const processTemplateFile = onCall(
  { region: 'us-east1', memory: '2GiB', timeoutSeconds: 540 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');

    const { firmId, storagePath, fileName } = request.data as {
      firmId: string;
      storagePath: string;
      fileName: string;
    };

    if (!firmId || !storagePath || !fileName) {
      throw new HttpsError('invalid-argument', 'firmId, storagePath, and fileName are required.');
    }

    // Validate role and firm access
    const role = request.auth.token.role as string | undefined;
    if (!role || !['admin', 'attorney', 'paralegal'].includes(role)) {
      throw new HttpsError('permission-denied', 'Only staff members can process templates.');
    }
    if ((request.auth.token.firmId as string | undefined) !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot process templates for a different firm.');
    }

    const ext = fileName.toLowerCase().split('.').pop();
    if (!ext || !['docx', 'pdf'].includes(ext)) {
      throw new HttpsError('invalid-argument', 'Only .docx and .pdf files are supported.');
    }

    // Prevent path traversal — storagePath must be scoped to this firm
    const expectedPrefix = `firms/${firmId}/`;
    if (!storagePath.startsWith(expectedPrefix) || storagePath.includes('..')) {
      throw new HttpsError('permission-denied', 'Storage path is not within the expected firm directory.');
    }

    // Download file from Firebase Storage
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);

    const [exists] = await file.exists();
    if (!exists) {
      throw new HttpsError('not-found', 'File not found in storage.');
    }

    const [buffer] = await file.download();
    console.log(`[processTemplateFile] Downloaded ${fileName} (${buffer.length} bytes)`);

    // Extract text/HTML based on file type
    let extractedHtml = '';
    let extractedText = '';

    if (ext === 'docx') {
      try {
        // Style map: convert Word paragraph styles to CSS classes.
        // InteractiveLegal DOCX files use underscore-separated paragraph styles
        // like "TR_Title", "TR_Art1", "TR_Body1" etc. Discovered by inspecting
        // mammoth warnings on actual DOCX files. Map to our tr-* CSS classes.
        const styleMap = [
          // Paragraph styles (from actual DOCX inspection)
          "p[style-name='TR_Title'] => p.tr-title:fresh",
          "p[style-name='TR_CoverTitle'] => p.tr-cover-title:fresh",
          "p[style-name='TR_Cover'] => p.tr-cover:fresh",
          "p[style-name='TR_Body1'] => p.tr-body1:fresh",
          "p[style-name='TR_Body'] => p.tr-body1:fresh",
          "p[style-name='TR_Body3'] => p.tr-body3:fresh",
          "p[style-name='TR_Art1'] => p.tr-art1:fresh",
          "p[style-name='TR_Art2'] => p.tr-art2:fresh",
          "p[style-name='TR_Art3'] => p.tr-art3b:fresh",
          "p[style-name='TR_Art3B'] => p.tr-art3b:fresh",
          "p[style-name='TR_Art4B'] => p.tr-art4b:fresh",
          "p[style-name='TR_SigLine'] => p.tr-sig-line:fresh",
          "p[style-name='TR_SigName'] => p.tr-sig-name:fresh",
          "p[style-name='TR_Affid'] => p.tr-affid:fresh",
          "p[style-name='TR_Base'] => p.tr-base:fresh",
          "p[style-name='TR_MemHeader1'] => p.tr-mem-header1:fresh",
          // Run (character) styles
          "r[style-name='TR_ParaHdr'] => strong",
          "r[style-name='Object'] => ",
        ];
        const result = await mammoth.convertToHtml({ buffer }, { styleMap });
        extractedHtml = applyTemplateFormattingStyles(postProcessTemplateHtml(result.value));
        // Log any mammoth conversion warnings (e.g., unmapped styles)
        if (result.messages.length > 0) {
          const styleWarnings = result.messages
            .filter((m: { type: string }) => m.type === 'warning')
            .map((m: { message: string }) => m.message);
          if (styleWarnings.length > 0) {
            console.log(
              `[processTemplateFile] Mammoth warnings (${styleWarnings.length}): ` +
              styleWarnings.slice(0, 5).join(' | '),
            );
          }
        }
        // Also get raw text for AI analysis
        const textResult = await mammoth.extractRawText({ buffer });
        extractedText = textResult.value;
        console.log(`[processTemplateFile] DOCX extracted: ${extractedHtml.length} chars HTML, ${extractedText.length} chars text`);
      } catch (err) {
        console.error('[processTemplateFile] DOCX extraction error:', err);
        throw new HttpsError('internal', 'Failed to extract text from DOCX file.');
      }
    } else if (ext === 'pdf') {
      try {
        // pdf-parse v2 API: constructor takes { data: buffer }, getText() returns { text, total }
        const parser = new PDFParse({ data: buffer });
        const result = await parser.getText();
        extractedText = result.text || '';
        await parser.destroy();
        // Convert plain text to basic HTML
        extractedHtml = extractedText
          .split('\n\n')
          .map((para: string) => `<p>${para.replace(/\n/g, '<br/>')}</p>`)
          .join('\n');
        console.log(`[processTemplateFile] PDF extracted: ${extractedText.length} chars text`);
      } catch (err) {
        console.error('[processTemplateFile] PDF extraction error:', err);
        throw new HttpsError('internal', 'Failed to extract text from PDF file.');
      }
    }

    // Fetch firm data for LLM-agnostic routing
    const firmSnap = await admin.firestore().collection('firms').doc(firmId).get();
    const firmData = { ...(firmSnap.data() ?? {}), ...(await loadFirmSecrets(firmId)) };

    // Fetch learning context (corrections, dictionary, few-shot examples)
    const learningCtx = await getLearningContext(firmId);
    const learningPrompt = formatLearningPrompt(learningCtx);

    // -----------------------------------------------------------------------
    // PHASE 1: Direct HTML Templatization — send extracted HTML to AI, get
    // templatized HTML back with all client-specific data replaced by
    // {{handlebarsVariables}}. No JSON intermediary, no regex replacement.
    // -----------------------------------------------------------------------
    // PHASE 3 (metadata) runs IN PARALLEL with Phase 1 for speed.
    // -----------------------------------------------------------------------

    const templatizeSystemPrompt = `You are an expert legal document analyst specializing in estate planning templates.

You will receive HTML extracted from a ${ext.toUpperCase()} file. This is a FILLED-IN legal document containing real client data (names, addresses, dates, etc.).

YOUR TASK: Replace ALL client-specific data in the HTML with Handlebars {{variables}} using the field paths listed below. Return ONLY the modified HTML — no JSON, no explanation, no markdown fences.

REPLACEMENT RULES:
1. Replace every person's proper name with the appropriate variable (e.g., "Jessica A. Byrnes" → {{clientFullName}}, "Sean M. Byrnes" → {{spouseFullName}}).
2. Replace client addresses, cities, counties, states, ZIP codes with the corresponding field variables.
3. Replace relationship words ("my husband", "my wife", "my son", "my daughter") with title variables (e.g., {{spouseTitle}}, {{childrenWithTitles.[0].childTitle}}).
4. Replace gendered pronouns referring to the client with {{clientPronouns.subject}}, {{clientPronouns.object}}, {{clientPronouns.possessive}}.
5. Replace gendered pronouns referring to the spouse with {{spousePronouns.subject}}, {{spousePronouns.object}}, {{spousePronouns.possessive}}.
6. Replace names of fiduciaries (executors, trustees, guardians, POA agents, healthcare proxies) with the appropriate fiduciary field path.
7. Replace fiduciary addresses with the corresponding .address field.
8. Replace witness names with {{firm.witness1Name}} / {{firm.witness2Name}} and their addresses with {{firm.witness1Address}} / {{firm.witness2Address}}.
9. Replace the attorney name with {{firm.attorneyName}} and bar ID with {{firm.attorneyId}}.
10. The firm's name, office address, and phone number (in signature blocks, letterhead, cover pages) should be replaced with {{firm.name}}, {{firm.address}}, {{firm.city}}, {{firm.state}}, {{firm.zip}}, and {{firm.phone}}.
11. Replace specific dates in headers, execution clauses, and signature blocks with {{todayFormatted}}.
12. Replace funeral/cremation/burial instructions with {{specialConsiderations.funeralWishes}}.
13. FOR CHILDREN: If multiple children are listed by index (child 1, child 2, child 3), use indexed variables with the dotted-bracket Handlebars syntax: {{children.[0].name}}, {{children.[1].name}}, etc. Use {{childrenWithTitles.[0].childTitle}} for "son"/"daughter". The dot before the bracket is REQUIRED — Handlebars silently renders empty for {{children[0].name}} (no dot).
14. Compound relationship titles like "sister-in-law", "father-in-law" are SINGLE values. NEVER split them (WRONG: {{relationship}}-in-law). The FULL compound title IS the variable value.
15. NEVER use pipe syntax — Handlebars has no Liquid/Vue-style pipes. WRONG: {{path | helper}}. CORRECT: {{helper path}} (subexpression). When unsure, just emit the bare path: {{path}}. childTitle is a FIELD on childrenWithTitles[i], NOT a helper — never write a pipe before it.
16. ADDRESSES are composite. Whenever you replace a person's street address with {{...address}}, you MUST also append the city and state in the same expression: {{x.address}}, {{x.city}}, {{x.state}}. The {{...address}} field holds ONLY the street line — it does NOT include city/state. This applies to personalInfo, spouseInfo, AND every fiduciary tier (executor.primary, powerOfAttorney.agent, healthcareProxy.agent, etc.). Failing to include city/state produces output like "of 93 Old Church Road, to be my attorney" instead of "of 93 Old Church Road, Monroe Township, NJ, to be my attorney".

CRITICAL: Replace EVERY instance of client-specific data. Do not leave any proper names (other than firm/attorney names in the signature block). Scan the ENTIRE document.

PRESERVE: All HTML tags, all structural formatting, all statutory references (e.g., N.J.S.A. citations), all section headings, all legal boilerplate text that is NOT client-specific.

${AVAILABLE_FIELDS}

${learningPrompt}

Return ONLY the templatized HTML. Do not wrap in markdown fences or JSON.`;

    const metadataSystemPrompt = `You are an expert legal document analyst. Analyze the following document text and provide metadata about it.

${AVAILABLE_TAGS}

Respond with a valid JSON object (no markdown fences):
{
  "suggestedDocType": "one of: will, pourOverWill, trust, poa, livingWill, deed, affidavitOfConsideration, gitRep3, estatePlanSummary",
  "suggestedTags": ["array of tag values from the AVAILABLE TEMPLATE TAGS list above"],
  "documentSummary": "one paragraph summary of what this template is for"
}`;

    let detectedVariables: {
      originalText: string;
      suggestedVariable: string;
      fieldLabel: string;
      confidence: string;
      context: string;
    }[] = [];
    let suggestedDocType = '';
    let suggestedTags: string[] = [];
    let documentSummary = '';
    let templatizedHtml = extractedHtml;
    // Truthful signal to the reviewing attorney when the returned HTML still
    // contains un-templatized original content (real prior-client names /
    // addresses) — the structure-only fidelity score can't detect that. (R5-040)
    const warnings: string[] = [];

    try {
      // For large HTML documents (>30K chars), split at paragraph boundaries
      const HTML_SINGLE_PASS_LIMIT = 60000; // HTML is more compact per semantic unit

      // Run Phase 1 (templatization) and Phase 3 (metadata) in parallel
      const metadataPromise = callAI(
        metadataSystemPrompt,
        `Analyze this document and provide metadata:\n\n${truncateAtWordBoundary(extractedText, 10000)}`,
        firmData,
        { temperature: 0, maxTokens: 1024, jsonMode: true },
      );

      let templatizeResult: string;

      if (extractedHtml.length <= HTML_SINGLE_PASS_LIMIT) {
        // Single pass — send entire HTML
        console.log(`[processTemplateFile] Phase 1: Single-pass HTML templatization (${extractedHtml.length} chars)`);
        templatizeResult = await callAI(
          templatizeSystemPrompt,
          extractedHtml,
          firmData,
          { temperature: 0, maxTokens: 16384 },
        );
      } else {
        // Multi-pass — split HTML at paragraph boundaries (<p>, </p>)
        console.log(`[processTemplateFile] Phase 1: Multi-pass HTML templatization (${extractedHtml.length} chars)`);
        const CHUNK_TARGET = 25000;
        const htmlChunks: string[] = [];
        const paragraphs = extractedHtml.split(/(?=<p[ >])/i);
        let currentChunk = '';

        for (const para of paragraphs) {
          if (currentChunk.length + para.length > CHUNK_TARGET && currentChunk.length > 0) {
            htmlChunks.push(currentChunk);
            currentChunk = para;
          } else {
            currentChunk += para;
          }
        }
        if (currentChunk) htmlChunks.push(currentChunk);

        console.log(`[processTemplateFile] Split into ${htmlChunks.length} HTML chunks`);

        // Process chunks in PARALLEL to avoid timeout on large documents
        let chunkFailures = 0;
        const chunkPromises = htmlChunks.map((chunk, ci) => {
          const chunkPrompt = `This is part ${ci + 1} of ${htmlChunks.length} of a legal document. Apply the same templatization rules to this section:\n\n${chunk}`;
          return callAI(
            templatizeSystemPrompt,
            chunkPrompt,
            firmData,
            { temperature: 0, maxTokens: 16384 },
          ).then((result) => {
            console.log(`[processTemplateFile] Phase 1: Chunk ${ci + 1}/${htmlChunks.length} processed`);
            return result;
          }).catch((err) => {
            console.error(`[processTemplateFile] Phase 1: Chunk ${ci + 1}/${htmlChunks.length} failed:`, err);
            chunkFailures++;
            return chunk; // Fallback to original HTML — but flag it below (R5-040)
          });
        });
        const processedChunks = await Promise.all(chunkPromises);
        templatizeResult = processedChunks.join('');

        // A failed chunk's original HTML still holds the source document's real
        // names/addresses. Warn the attorney so they don't save PII-leaking,
        // un-templatized sections as a reusable template. (R5-040)
        if (chunkFailures > 0) {
          warnings.push(
            `${chunkFailures} of ${htmlChunks.length} sections could not be auto-templatized and still contain the original document's names/addresses. Review and templatize those sections manually before saving.`,
          );
        }
      }

      // Clean up AI output — strip any markdown fences the model may add
      templatizeResult = templatizeResult.trim();
      if (templatizeResult.startsWith('```html')) {
        templatizeResult = templatizeResult.replace(/^```html\s*\n?/i, '');
      }
      if (templatizeResult.startsWith('```')) {
        templatizeResult = templatizeResult.replace(/^```\s*\n?/, '');
      }
      if (templatizeResult.endsWith('```')) {
        templatizeResult = templatizeResult.replace(/\n?```\s*$/, '');
      }

      // Validate the AI output contains handlebars variables and looks like HTML
      const hasVariables = /\{\{[^}]+\}\}/.test(templatizeResult);
      const looksLikeHtml = /<[a-z][\s\S]*>/i.test(templatizeResult);

      if (hasVariables && looksLikeHtml) {
        templatizedHtml = applyTemplateFormattingStyles(templatizeResult);
        console.log(`[processTemplateFile] Phase 1: AI templatization successful (${templatizedHtml.length} chars output)`);

        // Strip legacy [OBJ:...] / [OBJ ...] object codes from source drafting software
        const beforeStrip = templatizedHtml.length;
        templatizedHtml = templatizedHtml.replace(/\s*\[OBJ[:\s][^\]]*\]\s*/gi, ' ').replace(/  +/g, ' ');
        const stripped = beforeStrip - templatizedHtml.length;
        if (stripped > 0) {
          console.log(`[processTemplateFile] Stripped legacy OBJ codes (${stripped} chars removed)`);
        }

        // -------------------------------------------------------------------
        // Phase 1b: Structural fidelity validation
        // Compare tag structure of original vs templatized to ensure the AI
        // didn't alter document formatting during templatization.
        // -------------------------------------------------------------------
        const fidelity = compareHtmlStructure(extractedHtml, templatizedHtml);
        console.log(
          `[processTemplateFile] Structural fidelity = ${(fidelity.score * 100).toFixed(1)}% ` +
          `(tags: ${fidelity.originalTagCount} → ${fidelity.modifiedTagCount})`,
        );

        if (!fidelity.passes) {
          console.warn(
            `[processTemplateFile] Fidelity too low (${(fidelity.score * 100).toFixed(1)}%). ` +
            `Retrying with structural feedback...`,
          );

          const retryInstruction = buildFidelityRetryInstruction(fidelity);
          const retryPrompt = `${retryInstruction}\n\nOriginal HTML to templatize (preserve ALL tags exactly):\n\n${extractedHtml}`;

          let retryResult = await callAI(
            templatizeSystemPrompt,
            retryPrompt,
            firmData,
            { temperature: 0, maxTokens: 16384 },
          );

          // Clean markdown fences from retry
          retryResult = retryResult.trim();
          if (retryResult.startsWith('```html')) retryResult = retryResult.replace(/^```html\s*\n?/i, '');
          if (retryResult.startsWith('```')) retryResult = retryResult.replace(/^```\s*\n?/, '');
          if (retryResult.endsWith('```')) retryResult = retryResult.replace(/\n?```\s*$/, '');

          const retryHasVars = /\{\{[^}]+\}\}/.test(retryResult);
          const retryHasHtml = /<[a-z][\s\S]*>/i.test(retryResult);

          if (retryHasVars && retryHasHtml) {
            const retryFidelity = compareHtmlStructure(extractedHtml, retryResult);
            console.log(
              `[processTemplateFile] Retry fidelity = ${(retryFidelity.score * 100).toFixed(1)}% ` +
              `(was ${(fidelity.score * 100).toFixed(1)}%)`,
            );
            if (retryFidelity.score > fidelity.score) {
              templatizedHtml = applyTemplateFormattingStyles(retryResult);
              console.info('[processTemplateFile] Retry improved fidelity, using retry output.');
            } else {
              console.info('[processTemplateFile] Retry did not improve, keeping original output.');
            }
          }
        }

        // -------------------------------------------------------------------
        // POST-PROCESSING: Fiduciary Path Enforcement
        // When the same person serves in multiple fiduciary roles, the AI
        // often reuses the first path it assigned. This step ensures each
        // fiduciary section uses ONLY its own field paths.
        // -------------------------------------------------------------------
        const fiduciaryRoles = [
          {
            role: 'executor',
            prefix: 'fiduciaries.executor.',
            contextPatterns: [/\bexecutor\b/i, /\bexecutrix\b/i, /\bpersonal\s+representative\b/i, /\bappointment\s+of\s+.*executor/i],
          },
          {
            role: 'trustee',
            prefix: 'fiduciaries.trustee.',
            contextPatterns: [/\btrustee\b/i, /\bco-trustee\b/i, /\bsuccessor\s+trustee\b/i],
          },
          {
            role: 'guardian',
            prefix: 'fiduciaries.guardian.',
            contextPatterns: [/\bguardian\b/i, /\bguardians\b/i, /\bguardianship\b/i, /\bappointment\s+of\s+guardian/i],
          },
          {
            role: 'powerOfAttorney',
            prefix: 'fiduciaries.powerOfAttorney.',
            contextPatterns: [/\bpower\s+of\s+attorney\b/i, /\battorney[\s-]+in[\s-]+fact\b/i, /\bagent\b.*\bpoa\b/i],
          },
          {
            role: 'healthcareProxy',
            prefix: 'fiduciaries.healthcareProxy.',
            contextPatterns: [/\bhealthcare\s+proxy\b/i, /\bhealthcare\s+representative\b/i, /\bhealth\s+care\s+proxy\b/i, /\badvance\s+directive\b/i],
          },
        ];

        // Split HTML into paragraphs/sections for context detection
        const paragraphs = templatizedHtml.split(/(?=<p[\s>]|<h[1-6][\s>]|<div[\s>]|<li[\s>])/i);
        let fixCount = 0;

        const correctedParagraphs = paragraphs.map((para) => {
          // Strip out handlebars variables before checking context so we don't accidentally match
          // the word "executor" inside a leaked {{fiduciaries.executor.foo}} variable.
          const textOnly = para.replace(/\{\{[^}]+\}\}/g, '');

          // Determine what fiduciary role(s) this paragraph is about. Only rewrite
          // when it unambiguously concerns EXACTLY ONE role. A paragraph that
          // legitimately references two roles (e.g. "the Executor shall consult
          // the Trustee") must be left alone — rewriting ALL of its
          // {{fiduciaries.*}} variables to the first-matched role would corrupt
          // the other role's references. (R5-041)
          const hasFiduciaryVar = /\{\{fiduciaries\./.test(para);
          const matchedRoles = hasFiduciaryVar
            ? fiduciaryRoles.filter((role) => role.contextPatterns.some((p) => p.test(textOnly)))
            : [];

          if (matchedRoles.length !== 1) return para; // ambiguous or no context — leave as-is
          const detectedRole = matchedRoles[0];

          // In this paragraph, replace any fiduciary path that doesn't match the detected role
          // Swap ONLY the role prefix — preserve the exact level (primary/alternate/successor/etc.) and field
          return para.replace(/\{\{fiduciaries\.(\w+)\.((?:primary|alternate|successor|secondSuccessor|thirdSuccessor)\.\w+)\}\}/g,
            (match, actualRole, levelAndField) => {
              if (actualRole === detectedRole.role) return match; // Already correct

              const corrected = `{{fiduciaries.${detectedRole.role}.${levelAndField}}}`;
              console.log(`[processTemplateFile] Fiduciary path fix: ${match} → ${corrected} (context: ${detectedRole.role})`);
              fixCount++;
              return corrected;
            },
          );
        });

        if (fixCount > 0) {
          templatizedHtml = applyTemplateFormattingStyles(correctedParagraphs.join(''));
          console.log(`[processTemplateFile] Fiduciary path enforcement: ${fixCount} corrections applied`);
        }
      } else {
        console.warn(`[processTemplateFile] Phase 1: AI output doesn't look right (hasVars=${hasVariables}, hasHtml=${looksLikeHtml}). Keeping original HTML.`);
        warnings.push(
          'Automatic templatization did not produce a valid template. The original document is shown for manual templatization — it still contains the original names/addresses.',
        );
      }

      // -----------------------------------------------------------------------
      // PHASE 2: Programmatic Variable Extraction — scan templatized HTML for
      // {{...}} patterns using the existing extractTemplateVariables function.
      // No AI needed — this is instant and deterministic.
      // -----------------------------------------------------------------------
      const extractedVarPaths = extractTemplateVariables(templatizedHtml);
      detectedVariables = extractedVarPaths.map((varPath) => ({
        originalText: `{{${varPath}}}`,
        suggestedVariable: varPath,
        fieldLabel: varPath.split('.').pop() ?? varPath,
        confidence: 'high',
        context: 'Extracted from AI-templatized HTML',
      }));

      console.log(`[processTemplateFile] Phase 2: Extracted ${detectedVariables.length} unique variables from templatized HTML`);

      // -----------------------------------------------------------------------
      // PHASE 3: Await metadata result (was running in parallel with Phase 1)
      // -----------------------------------------------------------------------
      try {
        const metadataRaw = await metadataPromise;
        const metadata = parseAIJson<{
          suggestedDocType: string;
          suggestedTags: string[];
          documentSummary: string;
        }>(metadataRaw);
        suggestedDocType = metadata.suggestedDocType ?? '';
        suggestedTags = metadata.suggestedTags ?? [];
        documentSummary = metadata.documentSummary ?? '';
        console.log(`[processTemplateFile] Phase 3: Metadata extracted — docType="${suggestedDocType}", ${suggestedTags.length} tags`);
      } catch (metaErr) {
        console.error('[processTemplateFile] Phase 3 metadata error (non-fatal):', metaErr);
      }
    } catch (err) {
      console.error('[processTemplateFile] AI templatization error:', err);
      // Continue with original HTML — still return content for manual editing —
      // but tell the attorney it was NOT templatized and still holds real PII. (R5-040)
      warnings.push(
        'Automatic templatization failed. The original document is shown for manual templatization — it still contains the original names/addresses.',
      );
    }

    // -----------------------------------------------------------------------
    // Step 3: AI loop detection — detect repeating child-reference patterns
    // and convert indexed children (children[0], children[1], ...) into
    // {{#each childrenWithTitles}} loops
    // -----------------------------------------------------------------------
    const hasIndexedChildren = detectedVariables.some(
      (v) => /children(?:WithTitles)?\.?\[\d+\]/.test(v.suggestedVariable),
    );

    if (hasIndexedChildren) {
      try {
        // Find character positions of all indexed children references.
        // HTML from DOCX extraction is typically a single line, so line-based
        // splitting doesn't work — use character positions instead.
        const allRefs = [...templatizedHtml.matchAll(/children(?:WithTitles)?\.?\[\d+\]/g)];

        if (allRefs.length > 0) {
          const firstPos = allRefs[0].index!;
          const lastMatch = allRefs[allRefs.length - 1];
          const lastPos = lastMatch.index! + lastMatch[0].length;

          // Extract a window: 500 chars before first ref, 500 chars after last ref
          const contextChars = 500;
          const sectionStart = Math.max(0, firstPos - contextChars);
          const sectionEnd = Math.min(templatizedHtml.length, lastPos + contextChars);
          const childSection = templatizedHtml.slice(sectionStart, sectionEnd);

          console.log(`[processTemplateFile] Loop detection: processing chars ${sectionStart}-${sectionEnd} (${childSection.length} chars) out of ${templatizedHtml.length} total`);

          const loopPrompt = `You are a Handlebars template expert. The following HTML snippet contains indexed child references like {{children.[0].name}}, {{children.[1].name}}, {{childrenWithTitles.[0].childTitle}}, etc. (Older drafts may use the no-dot form {{children[0].name}} — treat both as equivalent inputs.)

Your job: convert the indexed child references into {{#each childrenWithTitles}} loop blocks.

RULES:
1. Identify repeating clauses that reference individual children by index and consolidate into a single {{#each childrenWithTitles}} block.
2. Inside the block, use {{this.childTitle}} for "son"/"daughter", {{this.name}} for the child's name.
3. For comma-separated lists of children, use: {{#each childrenWithTitles}}{{this.name}}{{#unless @last}}, {{/unless}}{{#if @last}} and {{/if}}{{/each}}
4. Do NOT modify any text that does not contain indexed child references.
5. Preserve all HTML structure.

CRITICAL — ONLY USE STANDARD HANDLEBARS SYNTAX:
- Allowed: {{#each}}, {{/each}}, {{#if}}, {{/if}}, {{#unless}}, {{/unless}}, {{@index}}, {{@first}}, {{@last}}, {{this.fieldName}}
- FORBIDDEN: Custom helpers like (eq ...), (plus ...), (lookup ...), (array ...), (gt ...), (subtract ...). Do NOT use any parenthetical helper expressions.

Return ONLY the modified HTML snippet (no JSON wrapper, no markdown fences, no explanation).`;

          const loopResult = await callAI(loopPrompt, childSection, firmData, {
            temperature: 0.05,
            maxTokens: 4000,
          });

          if (loopResult && loopResult.includes('{{#each')) {
            // Splice the processed section back into the full document
            const before = templatizedHtml.slice(0, sectionStart);
            const after = templatizedHtml.slice(sectionEnd);
            templatizedHtml = applyTemplateFormattingStyles(before + loopResult.trim() + after);
            console.log('[processTemplateFile] AI loop detection: converted indexed children to {{#each}} block');
          } else {
            console.log('[processTemplateFile] AI loop detection: no {{#each}} in response, keeping original');
          }
        }
      } catch (err) {
        console.error('[processTemplateFile] AI loop detection error (non-fatal):', err);
        // Continue with the templatized content without loop conversion
      }
    }

    // Final fidelity score
    const finalFidelity = compareHtmlStructure(extractedHtml, templatizedHtml);

    return {
      success: true,
      extractedHtml: applyTemplateFormattingStyles(templatizedHtml),
      rawContent: extractedHtml, // Original pre-templatization HTML for future re-runs
      extractedText: truncateAtWordBoundary(extractedText, 5000),
      rawExtractedText: truncateAtWordBoundary(extractedText, 20000),
      detectedVariables,
      suggestedDocType,
      suggestedTags,
      documentSummary,
      fileName,
      fileType: ext,
      learningStats: learningCtx.stats,
      fidelityScore: finalFidelity.score,
      warnings,
    };
  },
);

// ---------------------------------------------------------------------------
// Consolidate variables across multiple templates of the same type
// ---------------------------------------------------------------------------

export const consolidateTemplateVariables = onCall(
  { region: 'us-east1', memory: '512MiB', timeoutSeconds: 30 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');

    const { firmId, files, docType } = request.data as {
      firmId: string;
      docType: string;
      files: {
        fileName: string;
        extractedText: string;
      }[];
    };

    if (!firmId || !files || files.length < 2) {
      throw new HttpsError('invalid-argument', 'firmId and at least 2 files are required.');
    }

    const role = request.auth.token.role as string | undefined;
    if (!role || !['admin', 'attorney', 'paralegal'].includes(role)) {
      throw new HttpsError('permission-denied', 'Only staff members can process templates.');
    }
    if ((request.auth.token.firmId as string | undefined) !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot process templates for a different firm.');
    }

    console.log(`[consolidateTemplateVariables] Consolidating ${files.length} "${docType}" templates for firm ${firmId}`);

    // With the new direct-HTML-templatization architecture, each template's
    // extractedText may already contain {{variables}} from the AI pass.
    // Extract variables programmatically from each template and union them.
    const allVars = new Set<string>();

    for (const f of files) {
      const vars = extractTemplateVariables(f.extractedText);
      console.log(`[consolidateTemplateVariables] "${f.fileName}": ${vars.length} variables`);
      for (const v of vars) allVars.add(v);
    }

    const unionVars = Array.from(allVars).sort();
    console.log(`[consolidateTemplateVariables] Union: ${unionVars.length} unique variables across ${files.length} templates`);

    const detectedVariables = unionVars.map((varPath) => ({
      originalText: `{{${varPath}}}`,
      suggestedVariable: varPath,
      fieldLabel: varPath.split('.').pop() ?? varPath,
      confidence: 'high' as const,
    }));

    return { success: true, detectedVariables };
  },
);

// ---------------------------------------------------------------------------
// Record user corrections to AI-suggested variable mappings
// ---------------------------------------------------------------------------

export const recordTemplateCorrection = onCall(
  { region: 'us-east1', memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');

    const { firmId, corrections, templateName, docType } = request.data as {
      firmId: string;
      corrections: {
        originalText: string;
        aiSuggestedVariable: string;
        userCorrectedVariable: string;
      }[];
      templateName: string;
      docType: string;
    };

    if (!firmId || !corrections?.length) {
      throw new HttpsError('invalid-argument', 'firmId and corrections are required.');
    }

    const role = request.auth.token.role as string | undefined;
    if (!role || !['admin', 'attorney', 'paralegal'].includes(role)) {
      throw new HttpsError('permission-denied', 'Only staff members can record corrections.');
    }
    if ((request.auth.token.firmId as string | undefined) !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot record corrections for a different firm.');
    }

    for (const correction of corrections) {
      await recordCorrection(firmId, {
        ...correction,
        docType: docType ?? 'unknown',
        templateName: templateName ?? 'Untitled',
      });
    }

    console.log(`[recordTemplateCorrection] Recorded ${corrections.length} corrections for firm ${firmId}`);
    return { success: true, recorded: corrections.length };
  },
);

// ---------------------------------------------------------------------------
// Confirm variables after saving a template (builds the learning data)
// ---------------------------------------------------------------------------

export const confirmTemplateVariables = onCall(
  { region: 'us-east1', memory: '512MiB' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');

    const { firmId, templateName, docType, variables } = request.data as {
      firmId: string;
      templateName: string;
      docType: string;
      variables: {
        originalText: string;
        confirmedVariable: string;
        fieldLabel: string;
      }[];
    };

    if (!firmId || !variables?.length) {
      throw new HttpsError('invalid-argument', 'firmId and variables are required.');
    }

    const role = request.auth.token.role as string | undefined;
    if (!role || !['admin', 'attorney', 'paralegal'].includes(role)) {
      throw new HttpsError('permission-denied', 'Only staff members can confirm variables.');
    }
    if ((request.auth.token.firmId as string | undefined) !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot confirm variables for a different firm.');
    }

    await recordConfirmedVariables(firmId, templateName, docType, variables);

    console.log(`[confirmTemplateVariables] Confirmed ${variables.length} variables for "${templateName}"`);
    return { success: true, confirmed: variables.length };
  },
);
/**
 * Post-processes converted HTML from mammoth to restore professional formatting
 * that mammoth typically strips (like Word auto-numbering).
 */
function postProcessTemplateHtml(html: string): string {
  if (!html) return html;

  // 1. Identify section headers (tr-art1) and add missing ARTICLE numbering.
  // We use Roman numerals (I, II, III...) for InteractiveLegal standards.
  const romanNumerals = [
    'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
    'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'
  ];
  
  let articleIndex = 0;
  
  // Use a regex to find <p class="tr-art1">...</p> blocks.
  // We only number headers that don't already have "ARTICLE" in them.
  return html.replace(/<p class="tr-art1">(.*?)<\/p>/gi, (match, content) => {
    const plainText = content.replace(/<[^>]*>/g, '').trim();
    
    // Skip if it already contains "ARTICLE"
    if (plainText.toUpperCase().includes('ARTICLE')) {
      // If it has 'ARTICLE', we still want to keep track of the index if it follows our sequence
      const numMatch = plainText.match(/ARTICLE\s+([IVXLCDM]+)/i);
      if (numMatch) {
         const foundRoman = numMatch[1].toUpperCase();
         const foundIdx = romanNumerals.indexOf(foundRoman);
         if (foundIdx !== -1) {
           articleIndex = foundIdx + 1;
         }
      }
      return match;
    }

    // Skip short fragments or specific sub-heading patterns that shouldn't be Articles
    // (though TR_Art2 mapping fix above should handle most of these).
    const skipPatterns = [
      /^if\s+my/i,
      /^appointment\s+of/i,
      /^distribution\s+to/i,
      /^power\s+to/i,
      /^reliance\s+upon/i,
      /^executor\s+as/i,
      /^effect\s+of/i
    ];
    
    if (skipPatterns.some(pattern => pattern.test(plainText))) {
      return `<p class="tr-art2">${content}</p>`; // Convert mis-mapped sub-headings to tr-art2
    }

    // It's a section header! Prepend numbering.
    const roman = romanNumerals[articleIndex] || (articleIndex + 1).toString();
    articleIndex++;
    
    return `<p class="tr-art1"><strong>ARTICLE ${roman} — </strong>${content}</p>`;
  });
}
