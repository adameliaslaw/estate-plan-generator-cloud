/**
 * functions/src/ai-compliance-check.ts
 *
 * checkDocumentCompliance (onCall v2) — Reviews a generated legal document
 * against NJ statutory requirements and returns structured compliance findings.
 *
 * Input:  { firmId, clientId, documentId }
 * Output: { success, findings, overallStatus, reviewedAt }
 *
 * The function:
 *  1. Fetches the document from Firestore
 *  2. Sends the document content to GPT-4.1 with an NJ statutory checklist
 *  3. Parses the JSON response
 *  4. Saves findings to the document's `complianceReview` field
 *  5. Returns the structured findings to the caller
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { callAI, sanitizeForPrompt, parseAIJson } from './ai-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FindingStatus = 'pass' | 'warning' | 'fail';
type OverallStatus = 'pass' | 'needs_review' | 'fail';

interface ComplianceFinding {
  item: string;
  status: FindingStatus;
  statute?: string;
  detail: string;
}

interface ComplianceResult {
  findings: ComplianceFinding[];
  overallStatus: OverallStatus;
}

interface CheckComplianceRequest {
  firmId: string;
  clientId: string;
  documentId: string;
}

// ---------------------------------------------------------------------------
// NJ Statutory system prompt
// ---------------------------------------------------------------------------

const COMPLIANCE_SYSTEM_PROMPT = `You are an expert New Jersey estate planning attorney performing a 
compliance review of a legal document. Review the document against New Jersey statutory requirements 
and return a structured JSON compliance report.

NJ STATUTORY CHECKLIST BY DOCUMENT TYPE:

WILL (N.J.S.A. Title 3B):
- N.J.S.A. 3B:3-2: Testator must be 18+ years old and of sound mind
- N.J.S.A. 3B:3-2: Will must be in writing and signed at the end by the testator
- N.J.S.A. 3B:3-4: Will must be signed by at least two witnesses in testator's presence
- N.J.S.A. 3B:3-5: Self-proving affidavit recommended (requires testator + two witnesses before notary)
- Will must name an executor / personal representative
- Will must clearly identify beneficiaries
- Residuary clause should be included
- Will must be dated

POWER OF ATTORNEY (N.J.S.A. 46:2B-8.1 et seq.):
- N.J.S.A. 46:2B-8.9: Must be signed by the principal and dated
- N.J.S.A. 46:2B-8.9: Must be signed by two witnesses (neither may be the agent)
- N.J.S.A. 46:2B-8.9: Must be notarized
- N.J.S.A. 46:2B-8.9: Should state whether durable or springing
- POA should clearly identify the agent and any successor agents
- Scope of authority should be clearly defined

TRUST (N.J.S.A. 3B:31-1 et seq. — NJ Trust Act):
- Settlor must have capacity to create a trust
- Trust must have a definite beneficiary or be a charitable trust
- Trustee must be identified and capable of taking title to property
- Trust must be signed by the settlor (and trustee if different)
- Trust should be notarized for recording purposes
- Successor trustee should be named
- Distribution standards should be specified
- Amendment / revocation provisions should be present (for revocable trust)

ADVANCE DIRECTIVE FOR HEALTH CARE (N.J.S.A. 26:2H-55 et seq.):
- N.J.S.A. 26:2H-56: Principal must be 18+ years and of sound mind
- N.J.S.A. 26:2H-56: Must be in writing, signed, and dated
- N.J.S.A. 26:2H-56: Must be witnessed by two adults (neither can be the healthcare representative, a healthcare provider, or employed by a healthcare facility caring for the principal)
- N.J.S.A. 26:2H-56: Notarization is optional but recommended
- N.J.S.A. 26:2H-57: Healthcare representative must be clearly identified
- Life-sustaining treatment instructions should be included
- Artificial nutrition/hydration instructions should be included

DEED (N.J.S.A. 46:15-1.1 et seq.):
- Must contain grantor and grantee identification
- Must contain a legal description (metes and bounds OR block/lot with municipality)
- N.J.S.A. 46:15-7: Must state consideration (even if nominal, e.g., "One Dollar and other consideration")
- Must be signed by the grantor
- Must be notarized / acknowledged
- Affidavit of Consideration (RTF-1) required unless exempt
- GIT/REP-3 required unless exempt

POUR-OVER WILL:
- Same requirements as a standard will (N.J.S.A. 3B:3-2, 3B:3-4, 3B:3-5)
- Must reference the trust by name and date
- Residuary estate must pour over to the named trust

GENERAL REQUIREMENTS FOR ALL DOCUMENTS:
- Document must not be blank or contain placeholder text (e.g., "[INSERT NAME]")
- Party names must be consistent throughout
- Dates must be present where required
- Signature blocks must be properly formatted
- Notarization blocks must be properly formatted where required

You must respond with a JSON object in EXACTLY this format:
{
  "findings": [
    {
      "item": "Testator Signature at End",
      "status": "pass",
      "statute": "N.J.S.A. 3B:3-2",
      "detail": "Document contains proper signature block at the end for testator."
    }
  ],
  "overallStatus": "pass"
}

Rules for overallStatus:
- "pass": All findings are "pass"
- "needs_review": At least one "warning" finding, no "fail" findings
- "fail": At least one "fail" finding

Rules for finding status:
- "pass": Requirement is clearly satisfied in the document
- "warning": Requirement appears to be addressed but could be clearer or is missing a recommended (not required) element
- "fail": Required element is missing, incomplete, or contains placeholder text

Be thorough but concise. Return 8-15 findings for most documents. Focus on the most important statutory requirements.
Respond ONLY with the JSON object — no other text.`;

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const checkDocumentCompliance = onCall(
  {
    region: 'us-east1',
    timeoutSeconds: 120,
    memory: '512MiB',
  },
  async (request: any /* CallableRequest */) => {
    // ── Auth guard ────────────────────────────────────────────────────────
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const { firmId, clientId, documentId } = request.data as CheckComplianceRequest;

    // ── Input validation ──────────────────────────────────────────────────
    if (!firmId || !clientId || !documentId) {
      throw new HttpsError(
        'invalid-argument',
        'firmId, clientId, and documentId are required.',
      );
    }

    const db = admin.firestore();

    // ── Fetch the document ────────────────────────────────────────────────
    const docPath = `firms/${firmId}/clients/${clientId}/documents/${documentId}`;
    const docSnap = await db.doc(docPath).get();

    if (!docSnap.exists) {
      throw new HttpsError('not-found', `Document not found: ${docPath}`);
    }

    const docData = docSnap.data()!;
    const docType: string = docData.docType ?? 'unknown';
    const docTitle: string = docData.title ?? 'Untitled Document';
    const docContent: string = docData.content ?? '';

    if (!docContent.trim()) {
      throw new HttpsError(
        'failed-precondition',
        'Document content is empty. Generate the document before running a compliance check.',
      );
    }

    // Sanitize content to prevent prompt injection
    const sanitizedContent = sanitizeForPrompt(docContent);

    // ── Build user prompt ─────────────────────────────────────────────────
    const userPrompt = `Please perform a compliance review of the following New Jersey estate planning document.

Document Type: ${sanitizeForPrompt(docType)}
Document Title: ${sanitizeForPrompt(docTitle)}

--- DOCUMENT CONTENT (start) ---
${sanitizedContent}
--- DOCUMENT CONTENT (end) ---

Check this document against all applicable NJ statutory requirements as described in your instructions. Return the JSON compliance report.`;

    // ── Call GPT-4.1 ──────────────────────────────────────────────────────
    let rawResponse: string;
    try {
      rawResponse = await callAI(COMPLIANCE_SYSTEM_PROMPT, userPrompt, {
        model: 'gpt-4.1',
        temperature: 0.1, // Maximum accuracy for legal compliance
        maxTokens: 3000,
        jsonMode: true,
      });
    } catch (err) {
      console.error('[checkDocumentCompliance] AI call failed:', err);
      throw new HttpsError(
        'internal',
        'AI compliance check failed. Please try again.',
      );
    }

    // ── Parse AI response ─────────────────────────────────────────────────
    let result: ComplianceResult;
    try {
      result = parseAIJson<ComplianceResult>(rawResponse);
    } catch (err) {
      console.error('[checkDocumentCompliance] JSON parse failed:', err);
      throw new HttpsError(
        'internal',
        'Failed to parse AI compliance response. Please try again.',
      );
    }

    // ── Validate result shape ─────────────────────────────────────────────
    if (!Array.isArray(result.findings) || !result.overallStatus) {
      throw new HttpsError(
        'internal',
        'AI returned an unexpected response format.',
      );
    }

    // Clamp overall status to valid values
    const validOverallStatuses: OverallStatus[] = ['pass', 'needs_review', 'fail'];
    if (!validOverallStatuses.includes(result.overallStatus)) {
      result.overallStatus = 'needs_review';
    }

    // Clamp each finding status
    const validFindingStatuses: FindingStatus[] = ['pass', 'warning', 'fail'];
    result.findings = result.findings.map((f) => ({
      ...f,
      status: validFindingStatuses.includes(f.status) ? f.status : 'warning',
    }));

    const reviewedAt = new Date().toISOString();

    // ── Persist findings to Firestore ─────────────────────────────────────
    try {
      await db.doc(docPath).update({
        complianceReview: {
          findings: result.findings,
          overallStatus: result.overallStatus,
          reviewedAt,
          reviewedBy: 'ai',
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      // Non-fatal: log but continue — still return results to caller
      console.error('[checkDocumentCompliance] Failed to persist review:', err);
    }

    // ── Return results ────────────────────────────────────────────────────
    return {
      success: true,
      findings: result.findings,
      overallStatus: result.overallStatus,
      reviewedAt,
    };
  },
);
