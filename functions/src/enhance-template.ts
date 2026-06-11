/**
 * functions/src/enhance-template.ts
 *
 * Cloud Function that uses AI to enhance a legal document template.
 * Analyzes the template content and returns an improved version with:
 *  - Updated statutory references (NJ-specific)
 *  - Missing standard provisions
 *  - Improved clause language
 *  - Better {{variable}} usage for template engine compatibility
 *
 * The original template is NOT modified — the enhanced content is returned
 * for the attorney to review and accept/reject in the template editor.
 */

import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { callAI } from './ai-client';

// ---------------------------------------------------------------------------
// System prompt for template enhancement
// ---------------------------------------------------------------------------

const ENHANCE_SYSTEM_PROMPT = `You are an expert New Jersey estate planning attorney and legal document drafter. You specialize in improving legal document templates used by NJ law firms.

Your task is to enhance a legal document template. You must:

1. **Preserve the template structure.** Keep ALL existing {{variableName}} template variables exactly as they are. Do not rename, remove, or modify any template variables.

2. **Update statutory references.** Ensure all NJ statute citations are current (NJ Revised Statutes as of 2026). Common statutes to verify:
   - Wills: N.J.S.A. 3B:3-1 et seq.
   - Trusts: N.J.S.A. 3B:31-1 et seq. (NJ Uniform Trust Code)
   - Powers of Attorney: N.J.S.A. 46:2B-8.1 et seq.
   - Health Care Directives: N.J.S.A. 26:2H-53 et seq.
   - Real Property: N.J.S.A. 46:3-13 et seq.

3. **Add missing standard provisions** that a well-drafted NJ estate planning document should include, such as:
   - Digital assets provisions (N.J.S.A. 3B:31-75 et seq.)
   - Tax election provisions where appropriate
   - Spendthrift provisions for trusts
   - No-contest clauses where appropriate
   - Fiduciary powers and limitations
   - Governing law clauses

4. **Improve legal language** for clarity and enforceability without changing the document's intent.

5. **Format properly** — maintain proper legal document formatting with articles, sections, and subsections.

6. **Add helpful template variables** where appropriate using {{variableName}} syntax (camelCase). For example, if a name is hardcoded, replace it with a variable.

CRITICAL RULES:
- Return ONLY the enhanced HTML template content. No preamble, no explanation, no markdown fences.
- Preserve all existing HTML structure and inline styles.
- Do NOT remove any existing content — only improve, add, or update.
- Keep the same document type and purpose; do not change it into a different document.`;

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const enhanceTemplate = onCall(
  {
    region: 'us-east1',
    memory: '512MiB',
    timeoutSeconds: 120,
  },
   
  async (request: CallableRequest<unknown>) => {
    // Auth check
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in.');
    }

    const { firmId, templateId, templateContent, templateName, enhancementFocus } = request.data as {
      firmId: string; templateId?: string; templateContent: string; templateName?: string; enhancementFocus?: string;
    };

    if (!firmId || !templateContent) {
      throw new HttpsError('invalid-argument', 'firmId and templateContent are required.');
    }

    if ((request.auth.token['firmId'] as string | undefined) !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot enhance templates for a different firm.');
    }

    const db = admin.firestore();

    // Get firm data for AI client
    const firmSnap = await db.doc(`firms/${firmId}`).get();
    if (!firmSnap.exists) {
      throw new HttpsError('not-found', 'Firm not found.');
    }
    const firmData = firmSnap.data()!;

    // Build the user prompt
    let userPrompt = `Please enhance the following legal document template named "${templateName || 'Untitled'}".

Here is the current template HTML content:

${templateContent}`;

    if (enhancementFocus) {
      userPrompt += `\n\nThe attorney has specifically requested focus on: ${enhancementFocus}`;
    }

    userPrompt += `\n\nReturn ONLY the enhanced HTML template. No explanation, no markdown, just the improved HTML.`;

    try {
      console.log(`[enhanceTemplate] Enhancing template "${templateName}" (${templateId}) for firm ${firmId}`);

      const enhanced = await callAI(
        ENHANCE_SYSTEM_PROMPT,
        userPrompt,
        firmData,
        {
          model: firmData.documentDraftingModel || undefined,
          temperature: 0.3,
          maxTokens: 16384,
        },
      );

      // Strip any accidental markdown code fences
      let cleanContent = enhanced.trim();
      if (cleanContent.startsWith('```html')) {
        cleanContent = cleanContent.replace(/^```html\s*/, '').replace(/\s*```\s*$/, '');
      } else if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```\s*$/, '');
      }

      console.log(`[enhanceTemplate] Enhancement complete. Original: ${templateContent.length} chars, Enhanced: ${cleanContent.length} chars`);

      return {
        enhancedContent: cleanContent,
        originalLength: templateContent.length,
        enhancedLength: cleanContent.length,
      };
    } catch (error) {
      console.error('[enhanceTemplate] AI enhancement failed:', error);
      throw new HttpsError('internal', `AI enhancement failed: ${(error as Error).message}`);
    }
  },
);
