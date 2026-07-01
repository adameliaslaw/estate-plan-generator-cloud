/**
 * esign-service.ts
 *
 * Dropbox Sign (formerly HelloSign) e-signature integration.
 *
 *   1. sendForSignature  — v1 callable. Renders the document to PDF, sends a
 *                          real signature request via the Dropbox Sign API, and
 *                          records the request id + status on the document.
 *   2. dropboxSignWebhook — v2 onRequest (public). Receives status callbacks
 *                          (sent/viewed/signed/declined/canceled), verifies the
 *                          HMAC, and updates the document's eSignature.status.
 *
 * The per-firm API key lives in the Functions-only secrets doc
 * (firms/{firmId}/secrets/apiKeys.dropboxSignApiKey) and is used both as the
 * send credential (HTTP Basic username) and the webhook HMAC secret.
 *
 * Auth: HTTP Basic, API key as username + empty password.
 * Send:  POST https://api.hellosign.com/v3/signature_request/send (multipart).
 * Webhook payload: multipart/form-data with a `json` field; must respond 200 with
 * the literal body "Hello API Event Received" or Dropbox Sign retries.
 */

import * as functions from 'firebase-functions/v1';
import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { buildLegalDocumentHtml } from './export-pdf';
import { loadFirmSecrets } from './firm-secrets';
import { verifyDropboxSignEventHash } from './esign-hmac';

const DROPBOX_SIGN_SEND_URL = 'https://api.hellosign.com/v3/signature_request/send';
const WEBHOOK_ACK = 'Hello API Event Received';

// ---------------------------------------------------------------------------
// PDF rendering (mirrors export-pdf.ts's Puppeteer launch)
// ---------------------------------------------------------------------------

async function renderDocumentPdf(
  displayName: string,
  htmlContent: string,
  status: string,
): Promise<Buffer> {
  const html = buildLegalDocumentHtml(displayName, htmlContent, status);
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: await chromium.executablePath(),
      args: chromium.args,
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
    const pdfBuffer = await page.pdf({
      format: 'Letter',
      margin: { top: '1in', bottom: '1in', left: '1in', right: '1in' },
      printBackground: true,
    });
    return Buffer.from(pdfBuffer);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        console.error('[esign] Non-fatal: browser close failed:', closeErr);
      }
    }
  }
}

/**
 * Download the executed PDF from Dropbox Sign and store it in the vault's
 * Storage path (readable by staff + the client per storage.rules), then record
 * the reference on the document. Idempotent — skips if already stored.
 */
async function storeSignedPdf(
  apiKey: string,
  signatureRequestId: string,
  firmId: string,
  clientId: string,
  documentId: string,
  title: string,
  docRef: admin.firestore.DocumentReference,
): Promise<void> {
  if (!signatureRequestId) return;

  const snap = await docRef.get();
  const existing = (snap.data()?.eSignature ?? {}) as { signedStoragePath?: string };
  if (existing.signedStoragePath) return; // already pulled in

  const authHeader = 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');
  const resp = await fetch(
    `https://api.hellosign.com/v3/signature_request/files/${encodeURIComponent(signatureRequestId)}?file_type=pdf`,
    { headers: { Authorization: authHeader } },
  );
  if (!resp.ok) {
    throw new Error(`Dropbox Sign files download returned ${resp.status}`);
  }
  const pdfBuffer = Buffer.from(await resp.arrayBuffer());

  // Flat filename under documents/ so it matches the single-segment storage rule.
  const storagePath = `firms/${firmId}/clients/${clientId}/documents/signed_${documentId}_${signatureRequestId}.pdf`;
  await admin.storage().bucket().file(storagePath).save(pdfBuffer, {
    contentType: 'application/pdf',
  });

  const now = admin.firestore.FieldValue.serverTimestamp();
  const safeTitle = title.replace(/[^a-zA-Z0-9-_ ]/g, '').trim().slice(0, 80) || 'Document';
  await docRef.set(
    {
      eSignature: {
        status: 'signed',
        signedStoragePath: storagePath,
        signedFileName: `${safeTitle} (signed).pdf`,
        signedAt: now,
      },
      updatedAt: now,
    },
    { merge: true },
  );

  await admin
    .firestore()
    .collection('firms').doc(firmId)
    .collection('clients').doc(clientId)
    .collection('activityLogs')
    .add({
      type: 'esignature_signed_file',
      title: 'Signed Document Received',
      description: `The executed "${title}" was returned and saved to the Document Vault.`,
      relatedDocumentId: documentId,
      createdBy: 'dropbox-sign',
      timestamp: now,
    });
}

// ---------------------------------------------------------------------------
// Function 1 — sendForSignature (v1 callable)
// ---------------------------------------------------------------------------

export const sendForSignature = functions
  .runWith({ timeoutSeconds: 120, memory: '2GB' }) // Puppeteer/Chromium needs headroom
  .region('us-east1')
  .https.onCall(async (data, context) => {
    // 1. Auth + staff role
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
    }
    const role = context.auth.token.role as string | undefined;
    if (!role || !['admin', 'attorney', 'paralegal'].includes(role)) {
      throw new functions.https.HttpsError('permission-denied', 'Staff access is required for this operation.');
    }

    const { firmId, clientId, documentId, signerName, signerEmail } = data ?? {};
    if (!firmId || !clientId || !documentId || !signerName || !signerEmail) {
      throw new functions.https.HttpsError('invalid-argument', 'Missing required parameters.');
    }
    if ((context.auth.token.firmId as string | undefined) !== firmId) {
      throw new functions.https.HttpsError('permission-denied', 'Cannot send for signature on behalf of a different firm.');
    }

    const db = admin.firestore();

    // 2. Load firm data + secrets (Dropbox Sign key lives in the secrets doc).
    const firmSnap = await db.collection('firms').doc(firmId).get();
    if (!firmSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Firm not found.');
    }
    const firmData = { ...(firmSnap.data() ?? {}), ...(await loadFirmSecrets(firmId)) };
    const apiKey = firmData.dropboxSignApiKey as string | undefined;
    if (!apiKey) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Dropbox Sign is not configured. Add your API key in Settings → Integrations.',
      );
    }
    // Default to test mode (watermarked, non-binding, no paid plan required)
    // unless the firm has explicitly opted into live/binding sends.
    const testMode = firmData.dropboxSignTestMode !== false;

    // 3. Fetch the document.
    const docRef = db
      .collection('firms').doc(firmId)
      .collection('clients').doc(clientId)
      .collection('documents').doc(documentId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Document not found.');
    }
    const docData = docSnap.data() ?? {};
    const displayName = (docData.displayName as string) ?? 'Document';
    const htmlContent =
      (docData.htmlContent as string) ?? (docData.content as string) ?? '<p>No content available.</p>';
    const docStatus = (docData.status as string) ?? 'draft';

    // 4. Render the document to PDF.
    const pdfBuffer = await renderDocumentPdf(displayName, htmlContent, docStatus);

    // 5. Send the signature request (multipart/form-data).
    const form = new FormData();
    // Dropbox Sign uses 0-indexed file params (file[0], file[1], …).
    form.append(
      'file[0]',
      new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' }),
      `${displayName}.pdf`,
    );
    form.append('title', displayName);
    form.append('subject', `Signature requested: ${displayName}`);
    form.append(
      'message',
      `Please review and sign ${displayName}. Contact our office with any questions.`,
    );
    form.append('signers[0][name]', String(signerName));
    form.append('signers[0][email_address]', String(signerEmail));
    form.append('test_mode', testMode ? '1' : '0');
    // Correlation keys echoed back on every webhook event.
    form.append('metadata[firmId]', firmId);
    form.append('metadata[clientId]', clientId);
    form.append('metadata[documentId]', documentId);

    const authHeader = 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');
    const resp = await fetch(DROPBOX_SIGN_SEND_URL, {
      method: 'POST',
      headers: { Authorization: authHeader },
      body: form,
    });
    const respBody = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
    if (!resp.ok) {
      const err = (respBody?.error as { error_msg?: string } | undefined)?.error_msg;
      console.error(`[esign] Dropbox Sign send failed (${resp.status}):`, JSON.stringify(respBody).slice(0, 500));
      throw new functions.https.HttpsError(
        resp.status === 401 || resp.status === 403 ? 'failed-precondition' : 'internal',
        err
          ? `Dropbox Sign: ${err}`
          : `Dropbox Sign returned ${resp.status}. Verify the API key and plan (API access required).`,
      );
    }
    const signatureRequestId = (
      respBody?.signature_request as { signature_request_id?: string } | undefined
    )?.signature_request_id;
    if (!signatureRequestId) {
      throw new functions.https.HttpsError('internal', 'Dropbox Sign did not return a signature_request_id.');
    }

    // 6. Record the request on the document.
    await docRef.set(
      {
        eSignature: {
          provider: 'dropbox-sign',
          signatureRequestId,
          status: 'sent',
          testMode,
          signerName: String(signerName),
          signerEmail: String(signerEmail),
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        requiresSignature: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // 7. Activity log.
    await db
      .collection('firms').doc(firmId)
      .collection('clients').doc(clientId)
      .collection('activityLogs')
      .add({
        type: 'document_sent_for_signature',
        title: 'Document Sent for E-Signature',
        description: `Sent "${displayName}" to ${signerName} (${signerEmail}) for electronic signature${testMode ? ' (test mode)' : ''}.`,
        relatedDocumentId: documentId,
        createdBy: context.auth.uid,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

    return { success: true, signatureRequestId, testMode };
  });

// ---------------------------------------------------------------------------
// Function 2 — dropboxSignWebhook (v2 onRequest, public)
// ---------------------------------------------------------------------------

/** Extract the `json` field from a Dropbox Sign multipart/form-data callback. */
function extractJsonField(rawBody: Buffer, contentType: string): string | null {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) return null;
  const boundary = '--' + (m[1] ?? m[2] ?? '').trim();
  const parts = rawBody.toString('utf8').split(boundary);
  for (const part of parts) {
    if (/name="json"/i.test(part)) {
      const sep = part.indexOf('\r\n\r\n');
      if (sep === -1) continue;
      return part.slice(sep + 4).replace(/\r\n$/, '').trim();
    }
  }
  return null;
}

// event_type → the status we persist. signature_request_signed fires per-signer;
// for our single-signer requests it (and all_signed) means done.
const EVENT_STATUS: Record<string, 'sent' | 'viewed' | 'signed' | 'declined' | 'canceled'> = {
  signature_request_sent: 'sent',
  signature_request_viewed: 'viewed',
  signature_request_signed: 'signed',
  signature_request_all_signed: 'signed',
  signature_request_declined: 'declined',
  signature_request_canceled: 'canceled',
};

// Never move backwards (e.g. a late 'viewed' after 'signed').
const STATUS_RANK: Record<string, number> = {
  sent: 0, viewed: 1, signed: 2, declined: 2, canceled: 2,
};

export const dropboxSignWebhook = onRequest(
  { region: 'us-east1', invoker: 'public', timeoutSeconds: 60, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    // 1. Extract + parse the `json` field.
    const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(String(req.rawBody ?? ''));
    const jsonField = extractJsonField(rawBody, req.headers['content-type'] ?? '');
    if (!jsonField) {
      console.error('[dropboxSignWebhook] No json field in payload');
      res.status(400).send('Bad Request');
      return;
    }
    let payload: {
      event?: { event_time?: string; event_type?: string; event_hash?: string };
      signature_request?: {
        signature_request_id?: string;
        title?: string;
        metadata?: Record<string, string>;
      };
    };
    try {
      payload = JSON.parse(jsonField);
    } catch (err) {
      console.error('[dropboxSignWebhook] Failed to parse json field:', err);
      res.status(400).send('Bad Request');
      return;
    }

    const event = payload.event;
    const eventType = event?.event_type ?? '';
    // The dashboard "Test" button sends callback_test with no signature_request /
    // metadata — we can't resolve a firm/key, so just acknowledge so the test passes.
    if (eventType === 'callback_test') {
      res.status(200).send(WEBHOOK_ACK);
      return;
    }

    // 2. Resolve firm from metadata (untrusted until HMAC verifies).
    const metadata = payload.signature_request?.metadata ?? {};
    const { firmId, clientId, documentId } = metadata;
    if (!firmId || !clientId || !documentId) {
      console.warn('[dropboxSignWebhook] Missing metadata; acknowledging to stop retries.');
      res.status(200).send(WEBHOOK_ACK);
      return;
    }

    // 3. Verify HMAC using the firm's API key.
    const secrets = await loadFirmSecrets(firmId);
    const apiKey = secrets.dropboxSignApiKey as string | undefined;
    if (!apiKey) {
      console.error(`[dropboxSignWebhook] No Dropbox Sign key for firm ${firmId}`);
      res.status(401).send('Unauthorized');
      return;
    }
    const verified = verifyDropboxSignEventHash(
      apiKey,
      event?.event_time ?? '',
      eventType,
      event?.event_hash ?? '',
    );
    if (!verified) {
      console.error('[dropboxSignWebhook] HMAC verification failed');
      res.status(401).send('Unauthorized');
      return;
    }

    const db = admin.firestore();
    const docRef = db
      .collection('firms').doc(firmId)
      .collection('clients').doc(clientId)
      .collection('documents').doc(documentId);
    const now = admin.firestore.FieldValue.serverTimestamp();

    // 4a. Files are ready → pull the executed PDF back into the vault.
    if (eventType === 'signature_request_downloadable') {
      try {
        await storeSignedPdf(
          apiKey,
          payload.signature_request?.signature_request_id ?? '',
          firmId, clientId, documentId,
          payload.signature_request?.title ?? 'Document',
          docRef,
        );
      } catch (err) {
        console.error('[dropboxSignWebhook] Failed to store signed PDF:', err);
        // Ack so Dropbox Sign stops retrying; logged for manual follow-up.
      }
      res.status(200).send(WEBHOOK_ACK);
      return;
    }

    // 4b. Map the event → status and apply (idempotent, monotonic).
    const newStatus = EVENT_STATUS[eventType];
    if (!newStatus) {
      // Authentic but not a status we track (e.g. remind) — ack.
      res.status(200).send(WEBHOOK_ACK);
      return;
    }


    const tsField: Record<string, string> = {
      viewed: 'viewedAt', signed: 'signedAt', declined: 'declinedAt',
    };

    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap.exists) return;
        const current = (snap.data()?.eSignature ?? {}) as { status?: string };
        const curRank = STATUS_RANK[current.status ?? ''] ?? -1;
        if ((STATUS_RANK[newStatus] ?? 0) < curRank) return; // don't regress
        const update: Record<string, unknown> = {
          'eSignature.status': newStatus,
          updatedAt: now,
        };
        if (tsField[newStatus]) update[`eSignature.${tsField[newStatus]}`] = now;
        tx.update(docRef, update);
      });

      await db
        .collection('firms').doc(firmId)
        .collection('clients').doc(clientId)
        .collection('activityLogs')
        .add({
          type: 'esignature_status',
          title: `E-Signature ${newStatus}`,
          description: `Signature request for the document is now "${newStatus}".`,
          relatedDocumentId: documentId,
          createdBy: 'dropbox-sign',
          timestamp: now,
        });
    } catch (err) {
      console.error('[dropboxSignWebhook] Failed to apply status update:', err);
      // Ack anyway — a retry would hit the same error; we've logged it.
    }

    res.status(200).send(WEBHOOK_ACK);
  },
);
