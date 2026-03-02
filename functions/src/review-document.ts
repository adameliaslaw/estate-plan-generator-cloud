/**
 * functions/src/review-document.ts
 *
 * Callable Cloud Function to perform AI-powered compliance review of a
 * generated estate planning document.
 *
 * The review checks:
 *  - NJ statutory compliance (correct citations, required provisions)
 *  - Drafting quality (missing clauses, internal inconsistencies)
 *  - Completeness (placeholder tokens, blank fields)
 *  - Execution requirements (signature blocks, witness/notary)
 *  - Client-data accuracy (names, dates, fiduciaries match client record)
 *
 * Returns structured issues (severity: critical/major/minor/info),
 * suggestions, compliance notes, and an overall assessment.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { callAI, sanitizeForPrompt, sanitizeObject, parseAIJson } from './ai-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReviewRequest {
  firmId: string;
  clientId: string;
  documentId: string;
  focusAreas?: string[];
}

interface ReviewIssue {
  severity: 'critical' | 'major' | 'minor' | 'info';
  location: string;
  description: string;
  suggestion: string;
}

interface DocumentReview {
  issues: ReviewIssue[];
  suggestions: string[];
  complianceNotes: string[];
  overallAssessment: string;
  passedReview: boolean;
  criticalCount: number;
  majorCount: number;
  minorCount: number;
}

// ---------------------------------------------------------------------------
// Per-docType review system prompts
// ---------------------------------------------------------------------------

const REVIEW_SYSTEM_PROMPTS: Record<string, string> = {
  will: `
You are a senior New Jersey estate planning attorney conducting a thorough compliance review of a Last Will and Testament.

CHECK FOR THE FOLLOWING:
CRITICAL ISSUES (would invalidate the document or cause major legal problems):
• Missing testator signature block
• Missing two-witness attestation (N.J.S.A. 3B:3-2)
• Witnesses who are also beneficiaries (N.J.S.A. 3B:3-2)
• No domicile declaration
• No executor named
• Residuary clause missing or ambiguous
• Unfilled placeholder tokens (e.g., "[NAME]", "[DATE]", "____")
• References to non-existent exhibits or schedules

MAJOR ISSUES (significant legal risk):
• Self-proving affidavit missing (N.J.S.A. 3B:3-4)
• No alternate executor named
• Guardian clause missing when testator has minor children
• Per stirpes/per capita distribution unclear
• Survivorship period not stated
• Missing anti-lapse clause
• No-contest clause missing when requested

MINOR ISSUES (drafting quality):
• Executor powers list incomplete relative to N.J.S.A. 3B:14-23
• Article numbering inconsistencies
• Redundant or contradictory provisions
• Grammar or formatting issues

COMPLIANCE NOTES:
• Verify N.J.S.A. 3B:3-2 (execution), 3B:3-4 (self-proving), 3B:5-3 (anti-lapse), 3B:14-23 (executor powers)
  `.trim(),

  pourOverWill: `
You are a senior New Jersey estate planning attorney conducting a thorough compliance review of a Pour-Over Will.

CHECK FOR THE FOLLOWING:
CRITICAL ISSUES:
• Trust not identified by full legal name and exact date
• Pour-over clause missing or inadequate
• Missing trustee identification
• No fallback provision if trust fails
• Missing execution block or witness attestation
• Unfilled placeholder tokens

MAJOR ISSUES:
• "As amended" language missing from trust reference
• Savings clause absent (if trust predeceases testator / is revoked)
• No alternate executor
• Self-proving affidavit missing (N.J.S.A. 3B:3-4)

MINOR ISSUES:
• Inconsistent trust name between articles
• Executor powers incomplete

COMPLIANCE NOTES:
• N.J.S.A. 3B:9-1 (trust reference requirements), 3B:3-4 (self-proving affidavit)
  `.trim(),

  poa: `
You are a senior New Jersey estate planning attorney conducting a thorough compliance review of a Durable Power of Attorney.

CHECK FOR THE FOLLOWING:
CRITICAL ISSUES:
• Durability clause missing (N.J.S.A. 46:2B-8.2 exact language required)
• No principal signature block
• No notary acknowledgment (N.J.S.A. 46:2B-8.14)
• Agent not clearly identified
• Gift-making power granted without express authorization (N.J.S.A. 46:2B-8.13a)
• Unfilled placeholder tokens

MAJOR ISSUES:
• Enumerated powers incomplete (N.J.S.A. 46:2B-8.9)
• No third-party reliance clause (N.J.S.A. 46:2B-8.11)
• Springing trigger language unclear if springing POA
• No alternate agent named
• Digital assets / RUFADAA powers missing

MINOR ISSUES:
• Section numbering inconsistencies
• Compensation of agent not addressed

COMPLIANCE NOTES:
• N.J.S.A. 46:2B-8.1 through 8.14 (NJ Durable Power of Attorney Act)
  `.trim(),

  livingWill: `
You are a senior New Jersey estate planning attorney and healthcare law specialist reviewing an Advance Directive for Health Care.

CHECK FOR THE FOLLOWING:
CRITICAL ISSUES:
• Healthcare representative not named (N.J.S.A. 26:2H-57)
• Instruction directive (living will provisions) missing
• No declarant signature block
• Witness attestation missing or deficient — must have TWO adult witnesses who are NOT: healthcare rep, blood relative, heir, or healthcare facility employee/operator (N.J.S.A. 26:2H-56)
• Disqualification attestation by witnesses missing
• Unfilled placeholder tokens

MAJOR ISSUES:
• HIPAA authorization missing (45 C.F.R. §164.508)
• Life support choice not clearly stated
• Artificial nutrition/hydration choices absent
• CPR directive (DNR / full code) not addressed
• Organ donation preference not stated
• Alternate healthcare representative not named

MINOR ISSUES:
• NJ ADRD provision absent if requested
• Pregnancy clause absent if applicable
• Personal statement section blank but noted as desired

COMPLIANCE NOTES:
• N.J.S.A. 26:2H-53 through 78 (NJ Advance Directive Act)
• 45 C.F.R. §164.508 (HIPAA authorization)
  `.trim(),

  trust: `
You are a senior New Jersey estate planning and trust law attorney reviewing a Revocable Living Trust agreement.

CHECK FOR THE FOLLOWING:
CRITICAL ISSUES:
• Trust name and date not clearly stated
• Settlor capacity statement missing
• Trustee not named
• No successor trustee provision
• Revocation/amendment clause missing (N.J.S.A. 3B:31-27/28)
• Beneficiaries not clearly identified
• No execution block or notary acknowledgment
• Unfilled placeholder tokens

MAJOR ISSUES:
• Trustee powers clause incomplete (N.J.S.A. 3B:14-23 not fully incorporated)
• Incapacity standard for successor trustee unclear
• Distribution standard (HEMS or other) not stated
• Spendthrift provision missing if requested (N.J.S.A. 3B:9-1)
• Schedule A missing or blank
• SNT provisions absent if client has special needs beneficiary

MINOR ISSUES:
• Trust funding instructions not included
• Trustee compensation not addressed
• Termination age for minors' trust not stated

COMPLIANCE NOTES:
• N.J.S.A. 3B:31-1 et seq. (NJ Uniform Trust Code)
• N.J.S.A. 3B:14-23 (trustee powers)
  `.trim(),

  deed: `
You are a senior New Jersey real estate attorney reviewing a Bargain and Sale Deed.

CHECK FOR THE FOLLOWING:
CRITICAL ISSUES:
• Grantee not identified as "[Name], as Trustee of [Trust Name] dated [Date]"
• Property description missing or inadequate (need address AND block/lot)
• County/municipality not stated
• Grantor name does not match vesting deed
• RTF exemption statement missing (N.J.S.A. 46:15-10(a)(7))
• No notary acknowledgment block
• Spousal joinder missing if grantor is married
• Unfilled placeholder tokens

MAJOR ISSUES:
• "PREPARED BY" attorney block missing (required for recording)
• Consideration clause inadequate
• Subject to / encumbrances clause missing (existing mortgage not addressed)
• Deed Book/Page reference (prior deed) missing
• Recording instructions missing

MINOR ISSUES:
• "Together with all appurtenances" clause not included
• Return address after recording missing

COMPLIANCE NOTES:
• N.J.S.A. 46:4-6 (Bargain and Sale Deed)
• N.J.S.A. 46:15-10(a)(7) (RTF exemption)
• N.J.S.A. 46:26A-1 (recording requirements)
  `.trim(),

  default: `
You are a senior New Jersey estate planning attorney reviewing an estate planning document for compliance and quality.

CHECK FOR:
CRITICAL: Missing signatures, unfilled placeholders, legally required clauses absent
MAJOR: Incomplete powers, missing alternates, ambiguous provisions
MINOR: Grammar, formatting, minor omissions
INFO: Suggestions for improvement or best practices
  `.trim(),
};

function getReviewPrompt(docType: string): string {
  return REVIEW_SYSTEM_PROMPTS[docType] ?? REVIEW_SYSTEM_PROMPTS.default;
}

const REVIEW_OUTPUT_FORMAT = `
OUTPUT FORMAT — JSON only (no markdown):
{
  "issues": [
    {
      "severity": "critical|major|minor|info",
      "location": "<Article/Section name or general location>",
      "description": "<Description of the issue>",
      "suggestion": "<Specific fix or improvement>"
    }
  ],
  "suggestions": ["<improvement suggestion>", ...],
  "complianceNotes": ["<NJ statute reference and compliance note>", ...],
  "overallAssessment": "<2-3 sentence overall assessment of the document>",
  "passedReview": <true if no critical/major issues, otherwise false>
}
`.trim();

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const reviewDocument = onCall(
  {
    timeoutSeconds: 180,
    memory: '512MiB',
    region: 'us-east1',
  },
  async (request: any /* CallableRequest */) => {
    // ------------------------------------------------------------------
    // 1. Auth check
    // ------------------------------------------------------------------
    const auth = request.auth;
    if (!auth) {
      throw new HttpsError('unauthenticated', 'You must be logged in to review documents.');
    }

    const role = auth.token.role as string | undefined;
    if (!role || !['admin', 'attorney', 'paralegal'].includes(role)) {
      throw new HttpsError('permission-denied', 'Insufficient permissions to review documents.');
    }

    const { firmId, clientId, documentId, focusAreas } = request.data as ReviewRequest;

    if (!firmId || !clientId || !documentId) {
      throw new HttpsError('invalid-argument', 'firmId, clientId, and documentId are required.');
    }

    const db = admin.firestore();

    // ------------------------------------------------------------------
    // 2. Verify firm access
    // ------------------------------------------------------------------
    if (role !== 'admin') {
      const callerFirmId = auth.token.firmId as string | undefined;
      if (callerFirmId && callerFirmId !== firmId) {
        throw new HttpsError('permission-denied', 'Cross-firm document review is not permitted.');
      }
    }

    // ------------------------------------------------------------------
    // 3. Fetch the document
    // ------------------------------------------------------------------
    const docRef = db
      .collection('firms')
      .doc(firmId)
      .collection('clients')
      .doc(clientId)
      .collection('documents')
      .doc(documentId);

    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      throw new HttpsError('not-found', `Document ${documentId} not found.`);
    }

    const docData = docSnap.data()!;
    const docType: string = docData.docType ?? 'custom';
    const documentContent: string = docData.content ?? '';

    if (!documentContent) {
      throw new HttpsError('failed-precondition', 'Document has no content to review.');
    }

    // ------------------------------------------------------------------
    // 4. Fetch client context (for name/date verification)
    // ------------------------------------------------------------------
    const clientSnap = await db.doc(`firms/${firmId}/clients/${clientId}`).get();
    const clientData = clientSnap.exists ? sanitizeObject(clientSnap.data()!) : {};

    const pi = (clientData as admin.firestore.DocumentData).personalInfo ?? {};
    const clientFullName = [pi.firstName, pi.lastName].filter(Boolean).join(' ');

    // Fetch firm data to get settings for AI provider
    const firmSnap = await db.doc(`firms/${firmId}`).get();
    const firmData = firmSnap.exists ? sanitizeObject(firmSnap.data()!) : {};

    // ------------------------------------------------------------------
    // 5. Build prompts and call AI
    // ------------------------------------------------------------------
    const typeReviewPrompt = getReviewPrompt(docType);

    const systemPrompt = `${typeReviewPrompt}

CLIENT CONTEXT (for verifying names/dates/fiduciaries match the document):
  Client name: ${sanitizeForPrompt(clientFullName)}
  Document type: ${docType}

${REVIEW_OUTPUT_FORMAT}`;

    const focusSection = focusAreas && focusAreas.length > 0
      ? `\nFOCUS AREAS: ${focusAreas.map(f => sanitizeForPrompt(f)).join(', ')}\n`
      : '';

    // Truncate document content to avoid token limits (review the first 15,000 chars)
    const truncatedContent = sanitizeForPrompt(documentContent).slice(0, 15000);

    const userPrompt = `
Review this ${docType} document for NJ compliance and drafting quality.
${focusSection}
DOCUMENT CONTENT (HTML):
${truncatedContent}
${documentContent.length > 15000 ? '\n[... document truncated for review ...]' : ''}

Identify all issues by severity. Be specific about location (article/section name) and provide actionable suggestions.
`.trim();

    console.log(`[reviewDocument] Reviewing ${docType} (${documentId}) for client ${clientId}`);

    const raw = await callAI(systemPrompt, userPrompt, firmData, {
      model: 'gpt-4.1',
      temperature: 0.1,
      maxTokens: 4096,
      jsonMode: true,
    });

    let review: DocumentReview;
    try {
      const parsed = parseAIJson<Omit<DocumentReview, 'passedReview' | 'criticalCount' | 'majorCount' | 'minorCount'>>(raw);

      const criticalCount = parsed.issues.filter(i => i.severity === 'critical').length;
      const majorCount = parsed.issues.filter(i => i.severity === 'major').length;
      const minorCount = parsed.issues.filter(i => i.severity === 'minor').length;

      review = {
        ...parsed,
        passedReview: criticalCount === 0 && majorCount === 0,
        criticalCount,
        majorCount,
        minorCount,
      };
    } catch (err) {
      console.error('[reviewDocument] Failed to parse AI review response:', err);
      throw new HttpsError(
        'internal',
        `Failed to parse review results: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }

    // ------------------------------------------------------------------
    // 6. Save review results to the document record
    // ------------------------------------------------------------------
    await docRef.update({
      reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
      reviewedBy: auth.uid,
      reviewNotes: JSON.stringify({
        passedReview: review.passedReview,
        criticalCount: review.criticalCount,
        majorCount: review.majorCount,
        minorCount: review.minorCount,
        overallAssessment: review.overallAssessment,
        reviewedAt: new Date().toISOString(),
      }),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: auth.uid,
    });

    console.log(
      `[reviewDocument] Review complete: ${review.criticalCount} critical, ` +
      `${review.majorCount} major, ${review.minorCount} minor issues. ` +
      `passedReview=${review.passedReview}`,
    );

    return review;
  },
);
