/**
 * functions/src/export-batch.ts
 *
 * Cloud Function: exportBatchPdf
 *
 * Accepts an array of document IDs, renders each one to PDF via Puppeteer,
 * packages them into a single ZIP archive, uploads to Cloud Storage, and
 * returns a signed download URL valid for 1 hour.
 */

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import archiver from 'archiver';
import { PassThrough } from 'stream';
import { buildLegalDocumentHtml, sanitizeFileName, blockExternalRequests } from './export-pdf';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_DOCUMENTS = 50;
const SIGNED_URL_TTL_MS = 60 * 60 * 1000; // 1 hour
const BUCKET_EXPORT_PREFIX = 'exports/batch';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render a single HTML page to a PDF buffer using an existing browser page.
 */
async function renderPageToPdf(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>['newPage']>>,
  html: string,
): Promise<Buffer> {
  await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60_000 });
  const uint8 = await page.pdf({
    format: 'Letter',
    margin: { top: '1in', bottom: '1in', left: '1in', right: '1in' },
    printBackground: true,
  });
  return Buffer.from(uint8);
}

/**
 * Zip an array of { name, data } entries and return the archive as a Buffer.
 */
async function createZipBuffer(
  entries: Array<{ name: string; data: Buffer }>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const passthrough = new PassThrough();

    passthrough.on('data', (chunk: Buffer) => chunks.push(chunk));
    passthrough.on('end', () => resolve(Buffer.concat(chunks)));
    passthrough.on('error', reject);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', reject);
    archive.pipe(passthrough);

    for (const entry of entries) {
      archive.append(entry.data, { name: entry.name });
    }

    archive.finalize();
  });
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const exportBatchPdf = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '2GB',
  })
  .region('us-east1')
  .https.onCall(async (data: unknown, context: functions.https.CallableContext) => {
    // ── 1. Auth ─────────────────────────────────────────────────────────────
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
    }

    const { role } = context.auth.token as { role?: string };
    if (!role || !['attorney', 'paralegal', 'admin'].includes(role)) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Only attorneys, paralegals, and admins may export documents.',
      );
    }

    // ── 2. Validate input ────────────────────────────────────────────────────
    const { firmId, clientId, documentIds } = data as {
      firmId?: string;
      clientId?: string;
      documentIds?: string[];
    };

    if (!firmId || !clientId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'firmId and clientId are required.',
      );
    }

    if (!Array.isArray(documentIds) || documentIds.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'documentIds must be a non-empty array of document ID strings.',
      );
    }

    if (documentIds.length > MAX_DOCUMENTS) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `Cannot export more than ${MAX_DOCUMENTS} documents in a single batch.`,
      );
    }

    if ((context.auth.token.firmId as string | undefined) !== firmId) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Cannot export documents for a different firm.',
      );
    }

    console.log(
      `[exportBatchPdf] START firmId=${firmId} clientId=${clientId} count=${documentIds.length}`,
    );

    const db = admin.firestore();

    // ── 3. Fetch all requested documents ────────────────────────────────────
    interface DocEntry {
      id: string;
      displayName: string;
      htmlContent: string;
      status: string;
    }

    const fetched: DocEntry[] = [];
    const missing: string[] = [];

    // Firestore `in` queries support up to 30 items; chunk if needed
    const CHUNK = 30;
    for (let i = 0; i < documentIds.length; i += CHUNK) {
      const chunk = documentIds.slice(i, i + CHUNK);
      const snaps = await Promise.all(
        chunk.map((docId) =>
          db
            .doc(`firms/${firmId}/clients/${clientId}/documents/${docId}`)
            .get(),
        ),
      );

      snaps.forEach((snap, idx) => {
        const docId = chunk[idx];
        if (!snap.exists) {
          missing.push(docId);
          return;
        }
        const d = snap.data()!;
        fetched.push({
          id: docId,
          displayName: (d.displayName as string) ?? docId,
          htmlContent: (d.htmlContent ?? d.content ?? '') as string,
          status: (d.status as string) ?? 'draft',
        });
      });
    }

    if (fetched.length === 0) {
      throw new functions.https.HttpsError(
        'not-found',
        `None of the ${documentIds.length} requested documents were found.`,
      );
    }

    if (missing.length > 0) {
      console.warn(
        `[exportBatchPdf] ${missing.length} document(s) not found and skipped: ${missing.join(', ')}`,
      );
    }

    // ── 4. Render PDFs ───────────────────────────────────────────────────────
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
    const pdfEntries: Array<{ name: string; data: Buffer }> = [];

    try {
      browser = await puppeteer.launch({
        headless: true,
        executablePath: await chromium.executablePath(),
        args: chromium.args,
      });

      const page = await browser.newPage();
      // #167: the rendered HTML is client-influenced — deny all network access
      // before setContent so injected markup cannot trigger server-side fetches.
      await blockExternalRequests(page);

      for (const entry of fetched) {
        console.log(`[exportBatchPdf] Rendering "${entry.displayName}" (${entry.id})`);
        // buildLegalDocumentHtml sanitizes the stored HTML before render (#167).
        const html = buildLegalDocumentHtml(entry.displayName, entry.htmlContent, entry.status);
        const pdfBuf = await renderPageToPdf(page, html);
        const safeName = sanitizeFileName(entry.displayName) || entry.id;
        pdfEntries.push({ name: `${safeName}.pdf`, data: pdfBuf });
      }
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch (_) {
          browser.process()?.kill('SIGKILL');
        }
        browser = null;
      }
    }

    // ── 5. Create ZIP archive ────────────────────────────────────────────────
    console.log(`[exportBatchPdf] Creating ZIP with ${pdfEntries.length} PDFs`);
    const zipBuffer = await createZipBuffer(pdfEntries);

    // ── 6. Upload to Cloud Storage ───────────────────────────────────────────
    const timestamp = Date.now();
    const zipFileName = `${BUCKET_EXPORT_PREFIX}/firms/${firmId}/clients/${clientId}/batch_${timestamp}.zip`;

    const bucket = admin.storage().bucket();
    const file = bucket.file(zipFileName);

    await file.save(zipBuffer, {
      contentType: 'application/zip',
      metadata: {
        firmId,
        clientId,
        documentCount: String(pdfEntries.length),
        exportedAt: new Date().toISOString(),
        exportFormat: 'batch-pdf-zip',
      },
    });

    // ── 7. Signed URL ────────────────────────────────────────────────────────
    const [downloadUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + SIGNED_URL_TTL_MS,
    });

    console.log(
      `[exportBatchPdf] DONE — ${pdfEntries.length} PDFs zipped, url=${downloadUrl.slice(0, 80)}…`,
    );

    return {
      success: true,
      downloadUrl,
      zipFileName: `batch_export_${timestamp}.zip`,
      storagePath: zipFileName,
      exportedCount: pdfEntries.length,
      skippedCount: missing.length,
      skippedIds: missing,
    };
  },
  );
