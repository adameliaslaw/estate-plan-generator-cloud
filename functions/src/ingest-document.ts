/**
 * functions/src/ingest-document.ts
 *
 * Callable Cloud Function — uploads a PDF to PageIndex, receives a doc_id,
 * and registers the document in Firestore under pageindex_docs/{namespace}/files.
 *
 * The Firestore entry is what ragChat and pageIndexClientFilesChat read to
 * discover which documents belong to each namespace.
 *
 * Called from the browser upload modal in ChatPage.
 * Auth: staff only (admin | attorney | paralegal).
 *
 * Note: Only PDF is supported. PageIndex's retrieval API requires a doc_id
 * which is only returned by the /doc/ PDF upload endpoint.
 */

import * as functions from 'firebase-functions/v1';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------
const PAGEINDEX_API_KEY = defineSecret('PAGEINDEX_API_KEY');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const VALID_NAMESPACES = new Set(['reference', 'work-product', 'client-files']);
const STAFF_ROLES      = new Set(['admin', 'attorney', 'paralegal']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface IngestRequest {
  fileBase64: string;
  mimeType: 'application/pdf';
  fileName: string;
  namespace: string;
}

interface IngestResponse {
  docId: string;
  fileName: string;
}

interface PageIndexDocResponse {
  doc_id: string;
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------
export const ingestDocument = functions
  .region('us-east1')
  .runWith({ secrets: ['PAGEINDEX_API_KEY'], timeoutSeconds: 120, memory: '512MB' })
  .https.onCall(async (data: IngestRequest, context) => {
    // ── Auth & role ─────────────────────────────────────────────────────────
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
    }
    const role = context.auth.token['role'] as string | undefined;
    if (!role || !STAFF_ROLES.has(role)) {
      throw new functions.https.HttpsError('permission-denied', 'Staff access only');
    }
    const callerFirmId = context.auth.token['firmId'] as string | undefined;
    if (!callerFirmId) {
      throw new functions.https.HttpsError('permission-denied', 'No firm association found');
    }

    // ── Input validation ────────────────────────────────────────────────────
    const { fileBase64, mimeType, fileName, namespace } = data;

    if (!fileBase64 || !mimeType || !fileName || !namespace) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'fileBase64, mimeType, fileName, and namespace are required',
      );
    }
    if (!VALID_NAMESPACES.has(namespace)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `namespace must be one of: ${[...VALID_NAMESPACES].join(', ')}`,
      );
    }
    if (mimeType !== 'application/pdf') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Only PDF files are supported. Please convert your document to PDF before uploading.',
      );
    }

    // ── Decode file ─────────────────────────────────────────────────────────
    const buffer = Buffer.from(fileBase64, 'base64');
    if (buffer.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'File is empty');
    }

    // ── Upload to PageIndex ─────────────────────────────────────────────────
    const formData = new FormData();
    formData.append('file', new Blob([buffer], { type: 'application/pdf' }), fileName);

    let uploadResponse: Response;
    try {
      uploadResponse = await fetch('https://api.pageindex.ai/doc/', {
        method: 'POST',
        headers: { api_key: PAGEINDEX_API_KEY.value() },
        body: formData,
      });
    } catch (err) {
      throw new functions.https.HttpsError(
        'internal',
        `PageIndex request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!uploadResponse.ok) {
      const errText = await uploadResponse.text();
      throw new functions.https.HttpsError(
        'internal',
        `PageIndex upload error ${uploadResponse.status}: ${errText}`,
      );
    }

    const { doc_id } = (await uploadResponse.json()) as PageIndexDocResponse;

    if (!doc_id) {
      throw new functions.https.HttpsError('internal', 'PageIndex returned no doc_id');
    }

    // ── Register in Firestore ───────────────────────────────────────────────
    const db = admin.firestore();
    await db.collection(`pageindex_docs/${namespace}/files`).doc(doc_id).set({
      doc_id,
      fileName,
      namespace,
      firmId: callerFirmId,
      uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { docId: doc_id, fileName } satisfies IngestResponse;
  });
