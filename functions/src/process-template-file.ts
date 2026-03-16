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
import mammoth from 'mammoth';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PDFParse } = require('pdf-parse');
import { callAI, parseAIJson } from './ai-client';
import { getLearningContext, formatLearningPrompt, recordCorrection, recordConfirmedVariables } from './template-learning';

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

spouseInfo.firstName, spouseInfo.middleName, spouseInfo.lastName
spouseInfo.dob, spouseInfo.email, spouseInfo.phone
spouseInfo.address, spouseInfo.city, spouseInfo.state, spouseInfo.zip

children[] — array of: { name, dob, isMinor, relationship, specialNeeds, guardian, alternateGuardian }

fiduciaries.executor.primary.name, fiduciaries.executor.primary.relationship, fiduciaries.executor.primary.address
fiduciaries.executor.alternate.name, fiduciaries.executor.alternate.relationship, fiduciaries.executor.alternate.address
fiduciaries.executor.successor.name, fiduciaries.executor.successor.relationship, fiduciaries.executor.successor.address
fiduciaries.executor.secondSuccessor.name, fiduciaries.executor.secondSuccessor.relationship, fiduciaries.executor.secondSuccessor.address
fiduciaries.executor.thirdSuccessor.name, fiduciaries.executor.thirdSuccessor.relationship, fiduciaries.executor.thirdSuccessor.address
fiduciaries.executor.bondRequired, fiduciaries.executor.compensation

fiduciaries.trustee.primary.name, fiduciaries.trustee.primary.relationship, fiduciaries.trustee.primary.address
fiduciaries.trustee.alternate.name, fiduciaries.trustee.alternate.relationship, fiduciaries.trustee.alternate.address
fiduciaries.trustee.successor.name, fiduciaries.trustee.successor.relationship, fiduciaries.trustee.successor.address

fiduciaries.powerOfAttorney.agent.name, fiduciaries.powerOfAttorney.agent.relationship
fiduciaries.powerOfAttorney.agent.address, fiduciaries.powerOfAttorney.agent.city, fiduciaries.powerOfAttorney.agent.state, fiduciaries.powerOfAttorney.agent.zip
fiduciaries.powerOfAttorney.alternateAgent.name, fiduciaries.powerOfAttorney.alternateAgent.relationship
fiduciaries.powerOfAttorney.effectiveDate, fiduciaries.powerOfAttorney.giftingAuthority
fiduciaries.powerOfAttorney.powers[]

fiduciaries.healthcareProxy.primary.name, fiduciaries.healthcareProxy.primary.relationship
fiduciaries.healthcareProxy.alternate.name
fiduciaries.healthcareProxy.lifeSupport, fiduciaries.healthcareProxy.nutrition
fiduciaries.healthcareProxy.painManagement, fiduciaries.healthcareProxy.organDonation

fiduciaries.guardian.primary.name, fiduciaries.guardian.alternate.name

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
clientPronouns.subject / .object / .possessive — he/him/his or she/her/her
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
- Guardian appointments MUST use fiduciaries.guardian.primary.name / .alternate.name — NOT executor paths.
- Even if the same person serves as both executor and guardian, the variables must be distinct because different clients may appoint different people.
- "I appoint X as guardian" → fiduciaries.guardian.primary.name
- "I appoint Y as successor guardian" → fiduciaries.guardian.alternate.name

CRITICAL MAPPING RULES — WITNESSES AND FIRM DATA:
- Witness names in execution/attestation/self-proving affidavit sections are NOT the client — they are firm staff.
- Witness names → firm.witness1Name, firm.witness2Name
- Witness addresses → firm.witness1Address, firm.witness2Address
- The attorney's name (e.g., "Adam J. Elias, Esq.") → firm.attorneyName
- The attorney's ID number (e.g., "#050452014") → firm.attorneyId
- The firm's own address (office address that appears in signature blocks or letterhead) should be LEFT AS LITERAL TEXT — it is constant, not client data.

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
  { region: 'us-east1', memory: '1GiB', timeoutSeconds: 300 },
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

    // Validate role
    const role = request.auth.token.role as string | undefined;
    if (!role || !['admin', 'attorney'].includes(role)) {
      throw new HttpsError('permission-denied', 'Only attorneys and administrators can process templates.');
    }

    const ext = fileName.toLowerCase().split('.').pop();
    if (!ext || !['docx', 'pdf'].includes(ext)) {
      throw new HttpsError('invalid-argument', 'Only .docx and .pdf files are supported.');
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
        const result = await mammoth.convertToHtml({ buffer });
        extractedHtml = result.value;
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
    const firmData = firmSnap.data() ?? {};

    // Fetch learning context (corrections, dictionary, few-shot examples)
    const learningCtx = await getLearningContext(firmId);
    const learningPrompt = formatLearningPrompt(learningCtx);

    // Use AI to detect template variables and suggest mappings
    // -----------------------------------------------------------------------
    // Hybrid detection strategy:
    //   ≤ 30K chars → single AI call with full text (no truncation)
    //   > 30K chars → parallel chunked analysis (20K chunks, 4K overlap)
    // -----------------------------------------------------------------------
    const SINGLE_PASS_LIMIT = 30000;
    const CHUNK_SIZE = 20000;
    const CHUNK_OVERLAP = 4000;

    const chunks: string[] = [];
    if (extractedText.length <= SINGLE_PASS_LIMIT) {
      // Single pass — send entire document text, no truncation
      chunks.push(extractedText);
    } else {
      // Multi-pass — split into overlapping chunks for large documents (e.g., trusts)
      let offset = 0;
      while (offset < extractedText.length) {
        const end = Math.min(offset + CHUNK_SIZE, extractedText.length);
        chunks.push(extractedText.slice(offset, end));
        if (end >= extractedText.length) break;
        offset += CHUNK_SIZE - CHUNK_OVERLAP;
      }
    }

    console.log(`[processTemplateFile] Analyzing ${chunks.length} chunk(s) (text length: ${extractedText.length} chars)`);

    const systemPrompt = `You are an expert legal document analyst specializing in estate planning templates.

Analyze the following document text extracted from a ${ext.toUpperCase()} file. Your job is to identify EVERY piece of client-specific data that would need to be replaced when using this document as a template for a different client.

DETECTION STRATEGIES (use ALL of these):

1. **Explicit Placeholders** — formatted as fill-in fields:
   - Handlebars variables: {{variableName}} or {{path.to.field}}
   - Bracket placeholders: [CLIENT NAME], [DATE], [ADDRESS]
   - Underline fill-ins: _______________ (blank lines)
   - ALL-CAPS placeholders: FULL LEGAL NAME, CLIENT ADDRESS
   - Angle-bracket placeholders: <name>, <date>
   - Word merge fields: «FieldName»

2. **Contextual / Semantic Detection** (CRITICAL — most attorney templates are filled-in examples):
   - **Repeated proper names**: If a specific person's name (e.g., "John A. Smith") appears multiple times throughout the document, it is almost certainly the client's name used as sample data. Detect it.
   - **Legal preamble patterns**: Phrases like "I, [Full Name], residing at [Address], County of [County], State of [State]" — even when filled with real values like "I, Jane Doe, residing at 456 Oak Avenue" — should be detected. The name, address, county, and state are all template variables.
   - **Named roles**: People named as executor, trustee, agent, guardian, beneficiary, witness, etc. These are all client-specific data, even if written as real names like "my son, Michael Smith."
   - **Dates**: Specific dates like "March 15, 2024" or "03/15/2024" in the document header, execution lines, or signature blocks are template variables.
   - **Addresses**: Full street addresses, cities, ZIP codes that appear in the document body (not in statutory citations) are client data.
   - **Financial amounts**: Specific dollar amounts in bequests, trust funding, etc.
   - **Relationship references**: "my wife, [Name]", "my daughter, [Name]" — the names are variables.
   - **Cross-referencing**: If you see "John Smith" in the preamble AND later as "Mr. Smith" or "the Grantor," these all refer to the same template variable (clientFullName).

3. **Structural Detection**:
   - Signature blocks with names, dates, notary sections
   - Witness name fields
   - Acknowledgment/notarization sections with county, state, date blanks

For each detected variable, suggest the best matching questionnaire field from the available fields list. Set "confidence" based on:
- "high": Explicit placeholder OR clear legal context (e.g., name in "I, [Name], hereby declare")
- "medium": Likely sample data based on context (e.g., a name after "appointed [Name] as Executor")
- "low": Could be sample data but uncertain (e.g., appears only once with ambiguous context)

${AVAILABLE_FIELDS}
${AVAILABLE_TAGS}
${learningPrompt}
Respond with a valid JSON object (no markdown fences):
{
  "detectedVariables": [
    {
      "originalText": "the exact text found in the document",
      "suggestedVariable": "the Handlebars variable path to use (e.g., personalInfo.firstName)",
      "fieldLabel": "human-readable label (e.g., Client First Name)",
      "confidence": "high" | "medium" | "low",
      "context": "brief context of where this appears in the document"
    }
  ],
  "suggestedDocType": "one of: will, pourOverWill, trust, poa, livingWill, deed, affidavitOfConsideration, gitRep3, estatePlanSummary, actionSteps",
  "suggestedTags": ["array of tag values from the AVAILABLE TEMPLATE TAGS list above that match this document"],
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

    const confidenceRank: Record<string, number> = { high: 3, medium: 2, low: 1 };

    try {
      if (chunks.length === 1) {
        // Single-pass — one AI call for the full document
        const userPrompt = `Analyze this document and detect all template variables/placeholders:\n\n${chunks[0]}`;

        const raw = await callAI(systemPrompt, userPrompt, firmData, {
          temperature: 0,
          maxTokens: 4096,
          jsonMode: true,
        });

        const parsed = parseAIJson<{
          detectedVariables: typeof detectedVariables;
          suggestedDocType: string;
          suggestedTags: string[];
          documentSummary: string;
        }>(raw);

        detectedVariables = parsed.detectedVariables ?? [];
        suggestedDocType = parsed.suggestedDocType ?? '';
        suggestedTags = parsed.suggestedTags ?? [];
        documentSummary = parsed.documentSummary ?? '';
      } else {
        // Multi-pass — process chunks in PARALLEL for speed
        const chunkPromises = chunks.map((chunk, ci) => {
          const chunkLabel = ` (chunk ${ci + 1}/${chunks.length})`;
          const userPrompt = `Analyze this document${chunkLabel} and detect all template variables/placeholders:\n\n${chunk}`;

          return callAI(systemPrompt, userPrompt, firmData, {
            temperature: 0,
            maxTokens: 4096,
            jsonMode: true,
          });
        });

        const rawResults = await Promise.all(chunkPromises);

        for (let ci = 0; ci < rawResults.length; ci++) {
          const parsed = parseAIJson<{
            detectedVariables: typeof detectedVariables;
            suggestedDocType: string;
            suggestedTags: string[];
            documentSummary: string;
          }>(rawResults[ci]);

          const chunkVars = parsed.detectedVariables ?? [];

          if (ci === 0) {
            // First chunk — take docType, tags, and summary
            suggestedDocType = parsed.suggestedDocType ?? '';
            suggestedTags = parsed.suggestedTags ?? [];
            documentSummary = parsed.documentSummary ?? '';
            detectedVariables = chunkVars;
          } else {
            // Merge: deduplicate by originalText, keep higher-confidence
            for (const newVar of chunkVars) {
              const existingIdx = detectedVariables.findIndex(
                (v) => v.originalText.toLowerCase() === newVar.originalText.toLowerCase(),
              );
              if (existingIdx >= 0) {
                const existing = detectedVariables[existingIdx];
                const existingRank = confidenceRank[existing.confidence] ?? 0;
                const newRank = confidenceRank[newVar.confidence] ?? 0;
                if (newRank > existingRank) {
                  detectedVariables[existingIdx] = newVar;
                }
              } else {
                detectedVariables.push(newVar);
              }
            }
          }

          console.log(`[processTemplateFile] Chunk ${ci + 1}/${chunks.length}: detected ${chunkVars.length} variables (total unique: ${detectedVariables.length})`);
        }
      }
    } catch (err) {
      console.error('[processTemplateFile] AI analysis error:', err);
      // Continue without AI analysis — still return the extracted content
    }

    // -----------------------------------------------------------------------
    // Step 2: Templatize content — replace detected literal text with
    // Handlebars variable tags in the extracted HTML
    // -----------------------------------------------------------------------
    let templatizedHtml = extractedHtml;

    if (detectedVariables.length > 0) {
      // Log all detected variables for debugging
      console.log(`[processTemplateFile] Detected ${detectedVariables.length} variables:`);
      for (const v of detectedVariables) {
        console.log(`  - "${v.originalText}" → {{${v.suggestedVariable}}} (${v.confidence})`);
      }

      // Sort by originalText length descending so longer matches are replaced
      // first (prevents partial replacements, e.g., "Jack" inside "Jack Byrnes")
      const sorted = [...detectedVariables].sort(
        (a, b) => b.originalText.length - a.originalText.length,
      );

      let replacedCount = 0;

      for (const v of sorted) {
        if (!v.originalText || !v.suggestedVariable) continue;
        // Skip very short matches (< 3 chars) to avoid replacing "I", "he", "my" etc.
        if (v.originalText.length < 3) continue;

        const tag = `{{${v.suggestedVariable}}}`;
        // Escape special regex characters in the match text
        const escaped = v.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Build a smart word-boundary pattern:
        // - Use \b for text that starts/ends with word characters
        // - Use lookahead/lookbehind for text starting/ending with non-word chars (e.g. #)
        const startsWithWord = /^\w/.test(v.originalText);
        const endsWithWord = /\w$/.test(v.originalText);
        const prefix = startsWithWord ? '\\b' : '(?<![\\w])';
        const suffix = endsWithWord ? '\\b' : '(?![\\w])';

        // CASE-INSENSITIVE: AI may return "Sean Byrnes" but HTML has "SEAN BYRNES"
        const regex = new RegExp(`${prefix}${escaped}${suffix}`, 'gi');
        const before = templatizedHtml;
        templatizedHtml = templatizedHtml.replace(regex, tag);
        if (before === templatizedHtml) {
          // No match found — log context for debugging
          const plainIdx = templatizedHtml.toLowerCase().indexOf(v.originalText.toLowerCase());
          if (plainIdx >= 0) {
            const snippet = templatizedHtml.slice(Math.max(0, plainIdx - 40), plainIdx + v.originalText.length + 40).replace(/<[^>]*>/g, '');
            console.log(`  ✗ NO MATCH for "${v.originalText}" → {{${v.suggestedVariable}}} — HTML tags splitting? Context: "${snippet}"`);
          } else {
            console.log(`  ✗ NO MATCH for "${v.originalText}" → {{${v.suggestedVariable}}} — text not found in HTML at all`);
          }
        } else {
          replacedCount++;
        }
      }

      console.log(`[processTemplateFile] Templatized content: ${replacedCount} of ${sorted.length} variables replaced in HTML`);
    }

    // -----------------------------------------------------------------------
    // Step 2.5: Validation pass — detect remaining hardcoded proper names
    // that the AI missed in Step 1. This catches ALL-CAPS names like
    // "ANTHONY ESERNIO" and mixed-case names like "Olivia Esernio" that
    // appear outside of {{}} variable tags.
    // -----------------------------------------------------------------------
    try {
      // Strip out existing {{...}} tags to avoid false positives, then scan for proper names
      const textWithoutTags = templatizedHtml.replace(/\{\{[^}]+\}\}/g, '___VAR___');
      // Document codes and legal boilerplate to exclude
      const excludePatterns = [
        /^OBJ\b/i, /^STD\b/i, /^STDSPA\b/i, /^ARTICLE\b/i,
        /LAST WILL/i, /SELF.PROVING/i, /NEW JERSEY/i, /NEW YORK/i,
        /STATE OF/i, /WITNESS WHEREOF/i, /NO CONTEST/i, /RESIDUARY ESTATE/i,
        /PROVING AFFIDAVIT/i, /MIDDLESEX COUNTY/i, /^WILL\b/i,
        /Family Information/i, /Funeral Representative/i, /Executor Appointments/i,
        /Fiduciary (Provisions|Powers)/i, /General Provisions/i,
        /Disabled Person/i, /Regarding Changes/i, /Other Proceedings/i,
        /Additional General/i, /Provisions Regarding/i, /Reliance Upon/i,
        /Attempted Contest/i, /Does Not/i, /Last Resort/i, /First Level/i,
        /Second Level/i, /Third Level/i, /Initial Executor/i, /Successor Executor/i,
        /Wife (Survives|Does)/i, /Husband (Survives|Does)/i,
      ];
      const isExcluded = (name: string) => excludePatterns.some(p => p.test(name)) || name.length <= 4;

      // Match ALL-CAPS names (2+ words) like "ANTHONY ESERNIO" or "JEANA ESERNIO"
      const allCapsNames = [...new Set(
        (textWithoutTags.match(/\b[A-Z][A-Z]+(?:[\s.]+[A-Z][A-Z.]+)+\b/g) ?? [])
          .filter((n: string) => !isExcluded(n)),
      )];
      // Match mixed-case proper names (First Last or First M. Last patterns)
      const mixedCaseNames = [...new Set(
        (textWithoutTags.match(/\b[A-Z][a-z]+\s+(?:[A-Z]\.?\s+)?[A-Z][a-z]+\b/g) ?? [])
          .filter((n: string) => {
            const lower = n.toLowerCase();
            return !isExcluded(n) && n.length > 5
              && !lower.startsWith('if ') && !lower.startsWith('in ')
              && !lower.startsWith('my ') && !lower.startsWith('the ')
              && !lower.startsWith('no ') && !lower.startsWith('to ')
              && !lower.startsWith('an ') && !lower.startsWith('or ');
          }),
      )];

      const missedNames = [...allCapsNames, ...mixedCaseNames];

      if (missedNames.length > 0) {
        console.log(`[processTemplateFile] Step 2.5: Found ${missedNames.length} potential missed names: ${missedNames.join(', ')}`);

        // Make a focused second AI call to map these specific names
        const missedPrompt = `You are an expert at mapping names in legal estate planning documents to template variables.

The following names were found in a document that has already been partially templatized. These names were NOT converted to template variables and may need to be.

NAMES FOUND: ${missedNames.join(', ')}

CONTEXT: This is a Last Will and Testament / estate planning document. Names may correspond to:
- Executors (primary, alternate, successor, secondSuccessor)
- Trustees (primary, alternate)
- Guardians (primary, alternate)
- POA agents
- Healthcare proxies
- Children
- Beneficiaries
- Attorney / firm staff (these should use firm.* fields)

${AVAILABLE_FIELDS}

For each name, determine:
1. Is this a person's name that should be a template variable? (Yes/No)
2. If yes, what is the correct variable path?
3. If no, why not? (e.g., it's a legal term, section heading, etc.)

IMPORTANT: Relationship titles like "sister-in-law" that were split from a variable (e.g., appearing as just "-in-law" after a {{variable}}) should be noted.

Respond with JSON (no markdown fences):
{
  "missedVariables": [
    { "originalText": "EXACT NAME", "suggestedVariable": "field.path", "reason": "why this mapping" }
  ],
  "notVariables": [
    { "text": "THE TEXT", "reason": "why it's not a variable" }
  ]
}`;

        // Limit to top 20 names to avoid overwhelming the AI and causing JSON truncation
        const namesToProcess = missedNames.slice(0, 20);
        const missedUserPrompt = `Map these ${namesToProcess.length} names to template variables: ${namesToProcess.join(', ')}`;
        const missedRaw = await callAI(missedPrompt, missedUserPrompt, firmData, {
          temperature: 0,
          maxTokens: 4000,
          jsonMode: true,
        });

        const missedParsed = parseAIJson<{
          missedVariables?: { originalText: string; suggestedVariable: string; reason: string }[];
          notVariables?: { text: string; reason: string }[];
        }>(missedRaw);

        const newVars = missedParsed.missedVariables ?? [];
        if (newVars.length > 0) {
          console.log(`[processTemplateFile] Step 2.5: AI identified ${newVars.length} additional variables to replace`);

          // Sort by length descending for safe replacement
          const sortedNew = [...newVars].sort(
            (a, b) => b.originalText.length - a.originalText.length,
          );

          for (const v of sortedNew) {
            if (!v.originalText || !v.suggestedVariable) continue;
            const tag = `{{${v.suggestedVariable}}}`;
            const escaped = v.originalText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const startsWord = /^\w/.test(v.originalText);
            const endsWord = /\w$/.test(v.originalText);
            const pfx = startsWord ? '\\b' : '(?<![\\w])';
            const sfx = endsWord ? '\\b' : '(?![\\w])';
            const regex = new RegExp(`${pfx}${escaped}${sfx}`, 'gi');
            const before = templatizedHtml;
            templatizedHtml = templatizedHtml.replace(regex, tag);
            if (templatizedHtml !== before) {
              console.log(`  - Replaced "${v.originalText}" → {{${v.suggestedVariable}}}`);
              // Also add to detectedVariables for the response
              detectedVariables.push({
                originalText: v.originalText,
                suggestedVariable: v.suggestedVariable,
                fieldLabel: v.reason,
                confidence: 'high',
                context: 'Caught by validation pass',
              });
            }
          }
        }

        if (missedParsed.notVariables?.length) {
          for (const nv of missedParsed.notVariables) {
            console.log(`  - Kept literal: "${nv.text}" — ${nv.reason}`);
          }
        }
      } else {
        console.log('[processTemplateFile] Step 2.5: No missed proper names found — all names templatized');
      }
    } catch (err) {
      console.error('[processTemplateFile] Step 2.5 validation error (non-fatal):', err);
    }

    // -----------------------------------------------------------------------
    // Step 3: AI loop detection — detect repeating child-reference patterns
    // and convert indexed children (children[0], children[1], ...) into
    // {{#each childrenWithTitles}} loops
    // -----------------------------------------------------------------------
    const hasIndexedChildren = detectedVariables.some(
      (v) => /children\[\d+\]/.test(v.suggestedVariable),
    );

    if (hasIndexedChildren) {
      try {
        // Find character positions of all indexed children references.
        // HTML from DOCX extraction is typically a single line, so line-based
        // splitting doesn't work — use character positions instead.
        const allRefs = [...templatizedHtml.matchAll(/children(?:WithTitles)?\[\d+\]/g)];

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

          const loopPrompt = `You are a Handlebars template expert. The following HTML snippet contains indexed child references like {{children[0].name}}, {{children[1].name}}, {{childrenWithTitles[0].childTitle}}, etc.

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
            templatizedHtml = before + loopResult.trim() + after;
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

    return {
      success: true,
      extractedHtml: templatizedHtml,
      extractedText: truncateAtWordBoundary(extractedText, 5000),
      rawExtractedText: truncateAtWordBoundary(extractedText, 20000),
      detectedVariables,
      suggestedDocType,
      suggestedTags,
      documentSummary,
      fileName,
      fileType: ext,
      learningStats: learningCtx.stats,
    };
  },
);

// ---------------------------------------------------------------------------
// Consolidate variables across multiple templates of the same type
// ---------------------------------------------------------------------------

export const consolidateTemplateVariables = onCall(
  { region: 'us-east1', memory: '1GiB', timeoutSeconds: 120 },
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
    if (!role || !['admin', 'attorney'].includes(role)) {
      throw new HttpsError('permission-denied', 'Only attorneys and administrators can process templates.');
    }

    // Fetch firm data and learning context
    const firmSnap = await admin.firestore().collection('firms').doc(firmId).get();
    const firmData = firmSnap.data() ?? {};
    const learningCtx = await getLearningContext(firmId);
    const learningPrompt = formatLearningPrompt(learningCtx);

    console.log(`[consolidateTemplateVariables] Consolidating ${files.length} "${docType}" templates for firm ${firmId}`);

    // Build the consolidated prompt
    const systemPrompt = `You are an expert legal document analyst specializing in estate planning templates.

Your job is to identify EVERY piece of client-specific data that would need to be replaced when using these documents as templates.
You are being provided with text from MULTIPLE templates of the same document type (e.g., paired wills for spouses).
They are separated by "--- DOCUMENT [N] ---".

CRITICAL: Because these are paired templates, you must identify a single, unified list of DO NOT duplicate variables that mean the same thing. Return ONE canonical list of unique variables found across ALL the provided documents.

DETECTION STRATEGIES (use ALL of these):
1. **Explicit Placeholders** (Handlebars, bracket placeholders, underlines, etc.)
2. **Contextual / Semantic Detection** (Repeated proper names, specific addresses, relationship references, etc.)
3. **Structural Detection** (Signature blocks, notary sections, etc.)

For each detected variable, suggest the best matching questionnaire field from the available fields list. Set "confidence" based on:
- "high": Explicit placeholder OR clear legal context
- "medium": Likely sample data based on context
- "low": Could be sample data but uncertain

${AVAILABLE_FIELDS}
${learningPrompt}
Respond with a valid JSON object (no markdown fences):
{
  "detectedVariables": [
    {
      "originalText": "the exact text found in the document(s)",
      "suggestedVariable": "the Handlebars variable path to use (e.g., personalInfo.firstName)",
      "fieldLabel": "human-readable label (e.g., Client First Name)",
      "confidence": "high" | "medium" | "low"
    }
  ]
}`;

    // Concatenate all document texts, truncated to avoid blowing up the context window
    const MAX_CHARS_PER_DOC = 15000;
    const combinedText = files
      .map((f, i) => `--- DOCUMENT ${i + 1}: ${f.fileName} ---\n${truncateAtWordBoundary(f.extractedText, MAX_CHARS_PER_DOC)}`)
      .join('\n\n');

    const userPrompt = `Identify the unified list of template variables across these ${files.length} documents:\n\n${combinedText}`;

    try {
      const raw = await callAI(systemPrompt, userPrompt, firmData, {
        temperature: 0,
        maxTokens: 4096,
        jsonMode: true,
      });

      const parsed = parseAIJson<{
        detectedVariables: {
          originalText: string;
          suggestedVariable: string;
          fieldLabel: string;
          confidence: string;
        }[];
      }>(raw);

      const vars = parsed.detectedVariables ?? [];
      console.log(`[consolidateTemplateVariables] Success: AI identified ${vars.length} unified variables`);
      return { success: true, detectedVariables: vars };
    } catch (err) {
      console.error('[consolidateTemplateVariables] AI analysis error:', err);
      throw new HttpsError('internal', 'AI consolidation failed.');
    }
  },
);

// ---------------------------------------------------------------------------
// Record user corrections to AI-suggested variable mappings
// ---------------------------------------------------------------------------

export const recordTemplateCorrection = onCall(
  { region: 'us-east1', memory: '256MiB' },
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
    if (!role || !['admin', 'attorney'].includes(role)) {
      throw new HttpsError('permission-denied', 'Only attorneys and administrators can record corrections.');
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
  { region: 'us-east1', memory: '256MiB' },
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
    if (!role || !['admin', 'attorney'].includes(role)) {
      throw new HttpsError('permission-denied', 'Only attorneys and administrators can confirm variables.');
    }

    await recordConfirmedVariables(firmId, templateName, docType, variables);

    console.log(`[confirmTemplateVariables] Confirmed ${variables.length} variables for "${templateName}"`);
    return { success: true, confirmed: variables.length };
  },
);
