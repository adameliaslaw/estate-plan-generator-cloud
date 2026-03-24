/**
 * functions/src/retemplatize-templates.ts
 *
 * One-time Cloud Function to re-templatize existing raw uploaded templates.
 * These templates were bulk-imported from DOCX files and stored as raw HTML
 * with literal sample client data (no {{handlebars}} variables). This function
 * runs the same AI templatization pipeline as processTemplateFile to convert
 * the literal data into {{variables}} for fast Handlebars rendering.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { callAI } from './ai-client';
import { extractTemplateVariables } from './template-engine';

// ---------------------------------------------------------------------------
// Templatization prompt — same as processTemplateFile Phase 1
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

fiduciaries.trustee.primary.name, fiduciaries.trustee.primary.relationship, fiduciaries.trustee.primary.address
fiduciaries.trustee.alternate.name, fiduciaries.trustee.alternate.relationship, fiduciaries.trustee.alternate.address
fiduciaries.trustee.successor.name, fiduciaries.trustee.successor.relationship, fiduciaries.trustee.successor.address

fiduciaries.powerOfAttorney.agent.name, fiduciaries.powerOfAttorney.agent.relationship
fiduciaries.powerOfAttorney.agent.address, fiduciaries.powerOfAttorney.agent.city, fiduciaries.powerOfAttorney.agent.state, fiduciaries.powerOfAttorney.agent.zip
fiduciaries.powerOfAttorney.alternateAgent.name, fiduciaries.powerOfAttorney.alternateAgent.relationship

fiduciaries.healthcareProxy.primary.name, fiduciaries.healthcareProxy.primary.relationship
fiduciaries.healthcareProxy.alternate.name

fiduciaries.guardian.primary.name, fiduciaries.guardian.primary.relationship, fiduciaries.guardian.primary.address
fiduciaries.guardian.alternate.name, fiduciaries.guardian.alternate.relationship, fiduciaries.guardian.alternate.address

distribution.residualDistributions[] — { recipient, recipientRelationship, percentage, perStirpes, alternateRecipient }
distribution.specificBequests[] — { description, recipient, condition, alternateRecipient }

assets.realEstate[] — { address, type, currentValue, ownershipType, mortgageBalance }

specialConsiderations.funeralWishes, specialConsiderations.funeralRepresentative
specialConsiderations.petDetails, specialConsiderations.petCaretaker

FIRM DATA FIELDS:
firm.name, firm.address, firm.city, firm.state, firm.zip, firm.phone
firm.attorneyName, firm.attorneyId
firm.witness1Name, firm.witness1Address
firm.witness2Name, firm.witness2Address

COMPUTED FIELDS:
clientFullName, spouseFullName, hasSpouse, hasMinorChildren
childCount, minorChildren[], adultChildren[], propertyCount
todayFormatted, todayISO, packageType, packageLabel
spouseTitle, clientTitle, executorTitle, trusteeTitle
clientPronouns.subject / .object / .possessive
spousePronouns.subject / .object / .possessive
childrenWithTitles[] — same as children[] but each child also has childTitle
`;

const TEMPLATIZE_SYSTEM_PROMPT = `You are an expert legal document analyst specializing in estate planning templates.

You will receive HTML from a legal document. This is a FILLED-IN document containing real client data (names, addresses, dates, etc.).

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
10. Firm name, office address, and phone → {{firm.name}}, {{firm.address}}, {{firm.city}}, {{firm.state}}, {{firm.zip}}, {{firm.phone}}.
11. Replace specific dates in headers, execution clauses, and signature blocks with {{todayFormatted}}.
12. Replace funeral/cremation/burial instructions with {{specialConsiderations.funeralWishes}}.
13. FOR CHILDREN: If multiple children are listed, use indexed variables: {{children[0].name}}, {{children[1].name}}, etc.
14. Compound relationship titles like "sister-in-law" are SINGLE values. NEVER split them.

CRITICAL: Replace EVERY instance of client-specific data. Do not leave any proper names.
PRESERVE: All HTML tags, structural formatting, statutory references, section headings, legal boilerplate.

${AVAILABLE_FIELDS}

Return ONLY the templatized HTML. Do not wrap in markdown fences or JSON.`;

// ---------------------------------------------------------------------------
// Strip markdown fences
// ---------------------------------------------------------------------------
function stripFences(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:html)?\s*\n?/i, '');
  cleaned = cleaned.replace(/\n?\s*```\s*$/i, '');
  return cleaned.trim();
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const retemplatizeTemplates = onCall(
  { region: 'us-east1', memory: '2GiB', timeoutSeconds: 540 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');

    const role = request.auth.token.role as string | undefined;
    if (!role || !['admin', 'attorney'].includes(role)) {
      throw new HttpsError('permission-denied', 'Only admin or attorney can retemplatize.');
    }

    const { firmId, dryRun = false } = request.data as {
      firmId: string;
      dryRun?: boolean;
    };

    if (!firmId) throw new HttpsError('invalid-argument', 'firmId is required.');

    const db = admin.firestore();
    const col = db.collection(`firms/${firmId}/documentTemplates`);

    // Find all templates that have a softwareSource but no variables
    const snapshot = await col.where('softwareSource', '!=', '').get();

    const rawTemplates = snapshot.docs.filter((doc) => {
      const data = doc.data();
      const vars = data.variables ?? [];
      return vars.length === 0 && data.content && data.content.length > 100;
    });

    console.log(
      `[retemplatize] Found ${rawTemplates.length} raw templates out of ${snapshot.size} ` +
      `with softwareSource (firmId=${firmId}, dryRun=${dryRun})`,
    );

    if (rawTemplates.length === 0) {
      return { processed: 0, total: 0, results: [], message: 'No raw templates to process.' };
    }

    // Fetch firm data for AI routing
    const firmSnap = await db.collection('firms').doc(firmId).get();
    const firmData = firmSnap.data() ?? {};

    const results: {
      templateId: string;
      docType: string;
      name: string;
      variablesFound: number;
      status: 'success' | 'skipped' | 'error';
      error?: string;
    }[] = [];

    // Process templates sequentially to avoid AI rate limits
    for (const doc of rawTemplates) {
      const data = doc.data();
      const templateId = doc.id;
      const docType = data.docType ?? 'unknown';
      const name = data.name ?? templateId;

      console.log(`[retemplatize] Processing: ${name} (${docType}, ${data.content.length} chars)`);

      try {
        // Single-pass AI templatization
        let templatized = await callAI(
          TEMPLATIZE_SYSTEM_PROMPT,
          data.content,
          firmData,
          { temperature: 0, maxTokens: 16384 },
        );

        // Strip markdown fences
        templatized = stripFences(templatized);

        // Validate
        const hasVariables = /\{\{[^}]+\}\}/.test(templatized);
        const looksLikeHtml = /<[a-z][\s\S]*>/i.test(templatized);

        if (!hasVariables || !looksLikeHtml) {
          console.warn(`[retemplatize] ${name}: AI output invalid (vars=${hasVariables}, html=${looksLikeHtml}). Skipping.`);
          results.push({ templateId, docType, name, variablesFound: 0, status: 'skipped', error: 'AI output invalid' });
          continue;
        }

        // Extract variables programmatically
        const variables = extractTemplateVariables(templatized);
        console.log(`[retemplatize] ${name}: ${variables.length} variables found`);

        if (!dryRun) {
          // Update template in Firestore
          await col.doc(templateId).update({
            content: templatized,
            variables,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`[retemplatize] ${name}: Updated in Firestore`);
        }

        results.push({ templateId, docType, name, variablesFound: variables.length, status: 'success' });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[retemplatize] ${name}: Error — ${errMsg}`);
        results.push({ templateId, docType, name, variablesFound: 0, status: 'error', error: errMsg });
      }
    }

    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    console.log(
      `[retemplatize] Complete. ${successCount} succeeded, ${errorCount} errors, ` +
      `${results.length - successCount - errorCount} skipped. dryRun=${dryRun}`,
    );

    return {
      processed: successCount,
      total: rawTemplates.length,
      dryRun,
      results,
    };
  },
);
