/**
 * functions/src/google-drive-sync.ts
 *
 * One-way sync from the document vault to Google Drive.
 *
 * Two Cloud Functions:
 *
 * 1. connectGoogleDrive (onCall)
 *    Exchanges an OAuth authorization code for tokens, then stores them
 *    at firms/{firmId}.googleDrive.  Requests the `drive.file` scope so
 *    the app can only access files it creates.
 *
 * 2. onDocumentWrittenSyncToDrive (Firestore onWrite trigger)
 *    Fires whenever a document in the vault is created or updated.
 *    Generates a PDF via Puppeteer and uploads/updates it in the firm's
 *    Google Drive under an "Estate Plans / [Client Name]" folder.
 *
 * Firestore paths:
 *   Firm Drive tokens:  firms/{firmId}.googleDrive
 *     ├─ connected        (boolean)
 *     ├─ accessToken       (string)
 *     ├─ refreshToken      (string)
 *     ├─ tokenExpiry       (epoch ms)
 *     └─ rootFolderId?     (string — cached Drive folder ID)
 *
 *   Document sync fields (set after upload):
 *     ├─ googleDriveFileId    (string)
 *     └─ googleDriveSyncedAt  (Timestamp)
 */

import * as functions from 'firebase-functions';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { buildLegalDocumentHtml, sanitizeFileName } from './export-pdf';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GoogleDriveTokens {
  connected: boolean;
  accessToken: string;
  refreshToken: string;
  tokenExpiry?: number;
  rootFolderId?: string;
}

// ---------------------------------------------------------------------------
// Token helpers (mirror calendar-sync.ts patterns)
// ---------------------------------------------------------------------------

/**
 * Read the Google Drive OAuth tokens stored on a firm document.
 */
async function getDriveTokens(
  db: admin.firestore.Firestore,
  firmId: string,
): Promise<GoogleDriveTokens> {
  const firmSnap = await db.doc(`firms/${firmId}`).get();
  if (!firmSnap.exists) {
    throw new functions.https.HttpsError('not-found', `Firm ${firmId} not found.`);
  }

  const data = firmSnap.data()!;
  const tokens = data.googleDrive as GoogleDriveTokens | undefined;

  if (!tokens?.accessToken || !tokens?.refreshToken) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Google Drive not connected. Configure OAuth in Settings → Integrations.',
    );
  }

  return tokens;
}

/**
 * Refresh an expired Drive access token using the stored refresh token.
 */
async function refreshDriveTokenIfNeeded(
  db: admin.firestore.Firestore,
  firmId: string,
  tokens: GoogleDriveTokens,
): Promise<string> {
  // Still valid (with 60s safety buffer)?
  if (tokens.tokenExpiry && Date.now() < tokens.tokenExpiry - 60_000) {
    return tokens.accessToken;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';

  if (!clientId || !clientSecret) {
    throw new functions.https.HttpsError(
      'internal',
      'OAuth refresh not configured. Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.',
    );
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refreshToken,
    }),
  });

  if (!response.ok) {
    const err = (await response.json()) as Record<string, string>;
    console.error('[refreshDriveToken] Google error:', JSON.stringify(err));
    if (err.error === 'invalid_grant') {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Google Drive authorization revoked. Please reconnect in Settings → Integrations.',
      );
    }
    throw new functions.https.HttpsError(
      'internal',
      `Token refresh failed: ${err.error} - ${err.error_description || ''}`,
    );
  }

  const { access_token, expires_in } = (await response.json()) as Record<string, unknown>;
  const newExpiry = Date.now() + (expires_in as number) * 1000;

  await db.doc(`firms/${firmId}`).update({
    'googleDrive.accessToken': access_token,
    'googleDrive.tokenExpiry': newExpiry,
  });

  return access_token as string;
}

// ---------------------------------------------------------------------------
// Google Drive API helpers
// ---------------------------------------------------------------------------

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

/**
 * Find or create a folder in Google Drive. Returns the folder ID.
 */
async function findOrCreateFolder(
  accessToken: string,
  folderName: string,
  parentFolderId?: string,
): Promise<string> {
  // 1. Search for an existing folder with this name under the parent
  const q = parentFolderId
    ? `name='${folderName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    : `name='${folderName}' and 'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const searchUrl = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`;
  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (searchRes.ok) {
    const data = (await searchRes.json()) as { files?: Array<{ id: string }> };
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }
  }

  // 2. Create the folder
  const metadata: Record<string, unknown> = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentFolderId) {
    metadata.parents = [parentFolderId];
  }

  const createRes = await fetch(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  });

  if (!createRes.ok) {
    const errBody = await createRes.text();
    console.error(`[findOrCreateFolder] Failed to create folder "${folderName}":`, errBody);
    throw new Error(`Failed to create Drive folder: ${createRes.status}`);
  }

  const created = (await createRes.json()) as { id: string };
  return created.id;
}

/**
 * Ensure the full folder hierarchy exists:
 *   root → "Estate Plans" → "[Client Name]"
 *
 * Caches the root folder ID on the firm doc for reuse.
 */
async function ensureDriveFolders(
  db: admin.firestore.Firestore,
  firmId: string,
  clientName: string,
  accessToken: string,
  cachedRootFolderId?: string,
): Promise<{ rootFolderId: string; clientFolderId: string }> {
  // Root folder: "Estate Plans"
  let rootFolderId = cachedRootFolderId;
  if (!rootFolderId) {
    rootFolderId = await findOrCreateFolder(accessToken, 'Estate Plans');
    // Cache on firm doc
    await db.doc(`firms/${firmId}`).update({
      'googleDrive.rootFolderId': rootFolderId,
    });
  }

  // Client folder: "[Client Name]"
  const clientFolderId = await findOrCreateFolder(accessToken, clientName, rootFolderId);

  return { rootFolderId, clientFolderId };
}

/**
 * Upload or update a PDF file in Google Drive.
 */
async function uploadOrUpdatePdf(
  accessToken: string,
  pdfBuffer: Buffer,
  fileName: string,
  folderId: string,
  existingFileId?: string,
): Promise<string> {
  const boundary = '----DriveUploadBoundary' + Date.now();
  const mimeType = 'application/pdf';

  if (existingFileId) {
    // Update existing file content (PATCH with upload)
    const updateUrl = `${DRIVE_UPLOAD_API}/files/${existingFileId}?uploadType=multipart&fields=id`;

    const metadata = JSON.stringify({ name: fileName });
    const body = buildMultipartBody(boundary, metadata, pdfBuffer, mimeType);

    const res = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[uploadOrUpdatePdf] Update failed:', errText);
      // If update fails (e.g. file deleted from Drive), fall through to create
      if (res.status !== 404) {
        throw new Error(`Drive update failed: ${res.status}`);
      }
    } else {
      const result = (await res.json()) as { id: string };
      return result.id;
    }
  }

  // Create new file
  const createUrl = `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id`;
  const metadata = JSON.stringify({
    name: fileName,
    parents: [folderId],
    mimeType,
  });

  const body = buildMultipartBody(boundary, metadata, pdfBuffer, mimeType);

  const res = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[uploadOrUpdatePdf] Create failed:', errText);
    throw new Error(`Drive upload failed: ${res.status}`);
  }

  const result = (await res.json()) as { id: string };
  return result.id;
}

/**
 * Build a multipart/related body for Drive API upload.
 */
function buildMultipartBody(
  boundary: string,
  metadataJson: string,
  fileBuffer: Buffer,
  mimeType: string,
): Buffer {
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadataPart =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    metadataJson;

  const filePart =
    delimiter +
    `Content-Type: ${mimeType}\r\n` +
    'Content-Transfer-Encoding: base64\r\n\r\n';

  const metaBuffer = Buffer.from(metadataPart, 'utf8');
  const filePartBuffer = Buffer.from(filePart, 'utf8');
  const fileBase64Buffer = Buffer.from(fileBuffer.toString('base64'), 'utf8');
  const closeBuffer = Buffer.from(closeDelimiter, 'utf8');

  return Buffer.concat([metaBuffer, filePartBuffer, fileBase64Buffer, closeBuffer]);
}

// ---------------------------------------------------------------------------
// PDF generation helper (reuses export-pdf.ts utilities)
// ---------------------------------------------------------------------------

async function generatePdfBuffer(
  title: string,
  htmlContent: string,
  status: string,
): Promise<Buffer> {
  const html = buildLegalDocumentHtml(title, htmlContent, status);

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

    await browser.close();
    browser = null;

    return Buffer.from(pdfBuffer);
  } catch (err) {
    if (browser) {
      try { await browser.close(); } catch (_) { /* ignore */ }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Cloud Function 1: connectGoogleDrive (onCall)
// ---------------------------------------------------------------------------

export const connectGoogleDrive = onCall(
  {
    region: 'us-east1',
    timeoutSeconds: 60,
    memory: '256MiB',
    secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in to connect Google Drive.');
    }

    const { code, redirectUri, firmId } = request.data as {
      code: string;
      redirectUri: string;
      firmId: string;
    };

    if (!code || !firmId) {
      throw new HttpsError('invalid-argument', 'Authorization code and firmId are required.');
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      console.error('[connectGoogleDrive] Missing OAuth credentials in Secret Manager.');
      throw new HttpsError('internal', 'Google OAuth credentials missing on the server.');
    }

    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[connectGoogleDrive] Google API Error:', errorText);
        throw new Error(`Google API responded with ${response.status}`);
      }

      const tokenData = (await response.json()) as Record<string, unknown>;

      if (!tokenData.refresh_token) {
        throw new HttpsError(
          'permission-denied',
          'No refresh token received. You may need to disconnect the app from your Google Account permissions and try again.',
        );
      }

      const db = admin.firestore();
      const newExpiry = Date.now() + (tokenData.expires_in as number) * 1000;

      await db.doc(`firms/${firmId}`).update({
        'googleDrive.connected': true,
        'googleDrive.accessToken': tokenData.access_token,
        'googleDrive.refreshToken': tokenData.refresh_token,
        'googleDrive.tokenExpiry': newExpiry,
        updatedBy: request.auth.uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { success: true };
    } catch (error: unknown) {
      console.error('[connectGoogleDrive] Error:', error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError(
        'internal',
        `Failed to connect Google Drive: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Cloud Function 2: onDocumentWrittenSyncToDrive (Firestore trigger)
// ---------------------------------------------------------------------------

export const onDocumentWrittenSyncToDrive = onDocumentWritten(
  {
    document: 'firms/{firmId}/clients/{clientId}/documents/{documentId}',
    region: 'us-east1',
    timeoutSeconds: 120,
    memory: '2GiB',
    secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  },
  async (event) => {
    const { firmId, clientId, documentId } = event.params;

    // Skip deletes
    if (!event.data?.after?.exists) {
      console.log(`[driveSyncTrigger] Document ${documentId} deleted, skipping.`);
      return;
    }

    const docData = event.data.after.data();
    if (!docData) return;

    // Skip if content is empty (error docs, etc.)
    const content: string = docData.content ?? docData.htmlContent ?? '';
    if (!content.trim()) {
      console.log(`[driveSyncTrigger] Document ${documentId} has no content, skipping.`);
      return;
    }

    // Prevent infinite trigger loops — skip if this write was just the Drive sync
    // updating the googleDriveFileId / googleDriveSyncedAt fields
    const beforeData = event.data.before?.exists ? event.data.before.data() : null;
    if (beforeData) {
      const contentChanged = (beforeData.content ?? beforeData.htmlContent ?? '') !== content;
      const nameChanged = (beforeData.displayName ?? '') !== (docData.displayName ?? '');
      const statusChanged = (beforeData.status ?? '') !== (docData.status ?? '');

      if (!contentChanged && !nameChanged && !statusChanged) {
        console.log(`[driveSyncTrigger] No content/name/status change for ${documentId}, skipping.`);
        return;
      }
    }

    // ── Check if firm has Drive connected ──────────────────────────────────
    const db = admin.firestore();
    let tokens: GoogleDriveTokens;
    try {
      tokens = await getDriveTokens(db, firmId);
    } catch (_) {
      // Drive not connected — silently skip
      return;
    }

    if (!tokens.connected) return;

    console.log(`[driveSyncTrigger] Syncing ${documentId} to Drive for firm ${firmId}`);

    // ── Refresh token if needed ────────────────────────────────────────────
    let accessToken: string;
    try {
      accessToken = await refreshDriveTokenIfNeeded(db, firmId, tokens);
    } catch (err) {
      console.error('[driveSyncTrigger] Token refresh failed:', err);
      return;
    }

    // ── Get client name for folder ────────────────────────────────────────
    const clientSnap = await db.doc(`firms/${firmId}/clients/${clientId}`).get();
    const clientData = clientSnap.exists ? clientSnap.data() : null;
    const clientName = clientData
      ? `${clientData.firstName ?? ''} ${clientData.lastName ?? ''}`.trim() || 'Unknown Client'
      : 'Unknown Client';

    // ── Generate PDF ──────────────────────────────────────────────────────
    const displayName: string = docData.displayName ?? 'Document';
    const status: string = docData.status ?? 'draft';

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await generatePdfBuffer(displayName, content, status);
    } catch (err) {
      console.error(`[driveSyncTrigger] PDF generation failed for ${documentId}:`, err);
      return;
    }

    // ── Ensure folder structure ───────────────────────────────────────────
    let clientFolderId: string;
    try {
      const folders = await ensureDriveFolders(
        db,
        firmId,
        clientName,
        accessToken,
        tokens.rootFolderId,
      );
      clientFolderId = folders.clientFolderId;
    } catch (err) {
      console.error(`[driveSyncTrigger] Folder creation failed:`, err);
      return;
    }

    // ── Upload or update in Drive ─────────────────────────────────────────
    const pdfFileName = `${sanitizeFileName(displayName)}.pdf`;
    const existingFileId: string | undefined = docData.googleDriveFileId;

    let driveFileId: string;
    try {
      driveFileId = await uploadOrUpdatePdf(
        accessToken,
        pdfBuffer,
        pdfFileName,
        clientFolderId,
        existingFileId,
      );
    } catch (err) {
      console.error(`[driveSyncTrigger] Drive upload failed for ${documentId}:`, err);
      return;
    }

    // ── Update Firestore with Drive file ID ───────────────────────────────
    try {
      await event.data.after.ref.update({
        googleDriveFileId: driveFileId,
        googleDriveSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`[driveSyncTrigger] ✓ Synced ${documentId} → Drive file ${driveFileId}`);
    } catch (err) {
      console.error(`[driveSyncTrigger] Failed to update Firestore with Drive file ID:`, err);
    }
  },
);
