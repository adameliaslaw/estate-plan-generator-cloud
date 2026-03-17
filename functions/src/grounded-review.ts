/**
 * functions/src/grounded-review.ts
 *
 * Post-generation review pass using Gemini with Google Search grounding.
 *
 * After a document is generated, this module sends the drafted content
 * through Gemini with Search grounding enabled to:
 *   1. Verify statutory citations (N.J.S.A. references, etc.)
 *   2. Flag any outdated or repealed statutes
 *   3. Identify missing required citations
 *   4. Provide grounding metadata (search sources) for transparency
 *
 * This is NOT part of the primary generation pipeline — it runs as a
 * secondary quality pass that attorneys can trigger on demand.
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { callAI, FirmData } from './ai-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GroundedReviewResult {
  /** Overall assessment: 'pass' | 'warnings' | 'errors' */
  status: 'pass' | 'warnings' | 'errors';
  /** List of citation issues found */
  issues: CitationIssue[];
  /** Summary paragraph */
  summary: string;
  /** Timestamp of the review */
  reviewedAt: string;
}

export interface CitationIssue {
  /** The citation text found in the document */
  citation: string;
  /** What the issue is */
  issue: string;
  /** Severity: 'info' | 'warning' | 'error' */
  severity: 'info' | 'warning' | 'error';
  /** Suggested correction if applicable */
  suggestion?: string;
  /** Search source that identified the issue */
  source?: string;
}

// ---------------------------------------------------------------------------
// Review prompts
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a legal citation verification specialist for New Jersey estate planning documents. Your job is to review a drafted legal document and verify all statutory citations, legal references, and procedural requirements.

You MUST use Google Search to verify each citation found in the document. For each citation:
1. Check if the statute number is valid and current (not repealed or renumbered)
2. Verify the statute text matches what is cited
3. Flag any outdated references to old statutory numbering
4. Identify any missing citations that should be included

Focus on:
- N.J.S.A. (New Jersey Statutes Annotated) references
- N.J.A.C. (New Jersey Administrative Code) references  
- References to specific probate rules or court rules
- Any federal law references (e.g., estate tax thresholds)
- Date-sensitive thresholds (estate tax exemption amounts, etc.)

Output your findings as a valid JSON object with this structure:
{
  "status": "pass" | "warnings" | "errors",
  "issues": [
    {
      "citation": "the citation text from the document",
      "issue": "description of the problem",
      "severity": "info" | "warning" | "error",
      "suggestion": "optional suggested fix",
      "source": "optional search source"
    }
  ],
  "summary": "A brief summary paragraph of the review findings"
}

If no issues are found, return status "pass" with an empty issues array and a positive summary.`;

function buildUserPrompt(docTitle: string, content: string): string {
  // Truncate very long documents to avoid token limits
  const maxChars = 30000;
  const truncatedContent = content.length > maxChars
    ? content.substring(0, maxChars) + '\n\n[... document truncated for review ...]'
    : content;

  return `Please review the following legal document for citation accuracy. Use Google Search to verify all statutory references.

Document Title: ${docTitle}

---
${truncatedContent}
---

Verify all N.J.S.A., N.J.A.C., and other legal citations in this document. Report any issues found.`;
}

// ---------------------------------------------------------------------------
// Core review function
// ---------------------------------------------------------------------------

/**
 * Run a grounded review on a document's content.
 * Uses Gemini with Google Search grounding to verify citations.
 */
export async function runGroundedReview(
  docTitle: string,
  content: string,
  firmData: FirmData,
): Promise<GroundedReviewResult> {
  if (!content || content.trim().length < 100) {
    return {
      status: 'pass',
      issues: [],
      summary: 'Document too short for citation review.',
      reviewedAt: new Date().toISOString(),
    };
  }

  const userPrompt = buildUserPrompt(docTitle, content);

  // Force Gemini with grounding enabled
  const response = await callAI(
    SYSTEM_PROMPT,
    userPrompt,
    firmData,
    {
      model: 'gemini-2.5-flash',
      temperature: 0.1,
      maxTokens: 4096,
      jsonMode: true,
      groundingEnabled: true,
    },
  );

  // Parse the response
  try {
    const parsed = JSON.parse(response) as GroundedReviewResult;
    return {
      status: parsed.status ?? 'pass',
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      summary: parsed.summary ?? 'Review completed.',
      reviewedAt: new Date().toISOString(),
    };
  } catch (parseErr) {
    console.error('[groundedReview] Failed to parse Gemini response:', parseErr);
    return {
      status: 'warnings',
      issues: [{
        citation: 'N/A',
        issue: 'Unable to parse grounded review response. Manual review recommended.',
        severity: 'warning',
      }],
      summary: 'Grounded review completed but response could not be parsed.',
      reviewedAt: new Date().toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const groundedReviewDocument = onCall(
  {
    region: 'us-east1',
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in.');
    }

    const { firmId, clientId, documentId } = request.data as {
      firmId?: string;
      clientId?: string;
      documentId?: string;
    };

    if (!firmId || !clientId || !documentId) {
      throw new HttpsError(
        'invalid-argument',
        'Missing required fields: firmId, clientId, documentId.'
      );
    }

    const db = admin.firestore();

    // Fetch firm data for AI config
    const firmSnap = await db.doc(`firms/${firmId}`).get();
    if (!firmSnap.exists) {
      throw new HttpsError('not-found', `Firm ${firmId} not found.`);
    }
    const firmData = firmSnap.data() as FirmData;

    // Check for Gemini API key
    if (!firmData.geminiApiKey && !firmData.settings?.geminiApiKey) {
      throw new HttpsError(
        'failed-precondition',
        'Gemini API key not configured. Grounded review requires Gemini with Google Search. ' +
        'Configure it in Firm Settings → AI Configuration.'
      );
    }

    // Fetch the document
    const docSnap = await db
      .doc(`firms/${firmId}/clients/${clientId}/documents/${documentId}`)
      .get();

    if (!docSnap.exists) {
      throw new HttpsError('not-found', 'Document not found.');
    }

    const docData = docSnap.data()!;
    const content = (docData.content as string) ?? '';
    const title = (docData.title as string) ?? 'Untitled Document';

    if (!content || content.trim().length < 50) {
      throw new HttpsError(
        'failed-precondition',
        'Document has insufficient content for review.'
      );
    }

    console.log(`[groundedReview] Reviewing: ${title} (${content.length} chars)`);

    // Run the grounded review
    const result = await runGroundedReview(title, content, firmData);

    // Save the review result to the document
    await docSnap.ref.update({
      groundedReview: result,
      lastGroundedReviewAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(
      `[groundedReview] Complete: ${result.status}, ${result.issues.length} issues found`
    );

    return result;
  }
);
