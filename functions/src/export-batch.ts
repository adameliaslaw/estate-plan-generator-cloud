/**
 * export-batch.ts
 *
 * Cloud Function: exportBatchDocuments
 *
 * Generates PDF and/or DOCX exports for every document in a client's vault,
 * bundles them into a ZIP archive using `archiver`, uploads the ZIP to Cloud
 * Storage, and returns a signed download URL valid for 1 hour.
 *
 * format param:
 *   'pdf'  → all documents exported as PDF, zipped
 *   'docx' → all documents exported as DOCX, zipped
 *   'both' → each document exported as both PDF and DOCX, zipped together
 */

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import archiver from 'archiver';
import { Readable, PassThrough } from 'stream';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { Packer } from 'docx';
import { buildLegalDocumentHtml, sanitizeFileName } from './export-pdf';
import * as path from 'path';
import { buildDocxDocument } from './export-docx';

// ── Types ─────────────────────────────────────────────────────────────────────

type ExportFormat = 'pdf' | 'docx' | 'both';

interface DocumentRecord {
  id: string;
  displayName: string;
  status: string;
  htmlContent: string;
}

// ── PDF generation (reused from export-pdf logic) ─────────────────────────────

async function generatePdfBuffer(
  browser: Awaited<ReturnType<typeof puppeteer.launch>>,
  displayName: string,
  htmlContent: string,
  status: string,
): Promise<Buffer> {
  const html = buildLegalDocumentHtml(displayName, htmlContent, status);
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });

    const isDraft = status === 'draft';
    const headerHtml = `
      <div style="
        font-size: 9px;
        width: 100%;
        padding: 0 72px;
        text-align: center;
        color: ${isDraft ? '#cc0000' : '#555'};
        font-family: 'Times New Roman', Times, serif;
        ${isDraft ? 'font-weight: bold;' : ''}
      ">
        ${escapeHtml(displayName)}${isDraft ? ' — DRAFT' : ''}
      </div>`;

    const footerHtml = `
      <div style="
        font-size: 9px;
        width: 100%;
        padding: 0 72px;
        text-align: center;
        color: #555;
        font-family: 'Times New Roman', Times, serif;
      ">
        Page <span class="pageNumber"></span> of <span class="totalPages"></span>
      </div>`;

    const pdfBuffer = await page.pdf({
      format: 'Letter',
      margin: { top: '1in', bottom: '1in', left: '1in', right: '1in' },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: headerHtml,
      footerTemplate: footerHtml,
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── DOCX generation (reused from export-docx logic) ──────────────────────────

async function generateDocxBuffer(
  displayName: string,
  htmlContent: string,
  status: string,
): Promise<Buffer> {
  const doc = buildDocxDocument(displayName, htmlContent, status);
  return Packer.toBuffer(doc);
}

// ── Stream ZIP to Cloud Storage ───────────────────────────────────────────────

async function uploadZipToStorage(
  storagePath: string,
  zipBuilder: (archive: archiver.Archiver) => Promise<void>,
  metadata: Record<string, string>,
): Promise<string> {
  const bucket = admin.storage().bucket();
  const file = bucket.file(storagePath);

  const writeStream = file.createWriteStream({
    contentType: 'application/zip',
    metadata: { metadata },
  });

  const archive = archiver.create('zip', { zlib: { level: 6 } });

  const uploadPromise = new Promise<void>((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
    archive.on('error', reject);
  });

  archive.pipe(writeStream);
  await zipBuilder(archive);
  await archive.finalize();
  await uploadPromise;

  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 60 * 60 * 1000, // 1 hour
  });

  return url;
}

// ── Cloud Function ────────────────────────────────────────────────────────────

export const exportBatchDocuments = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '2GB',
  })
  .region('us-east1')
  .https.onCall(async (data: any, context: functions.https.CallableContext) => {
    // ── 1. Auth check ────────────────────────────────────────────────────────
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
    const {
      firmId,
      clientId,
      format = 'pdf',
    } = data as {
      firmId?: string;
      clientId?: string;
      format?: ExportFormat;
    };

    if (!firmId || !clientId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'firmId and clientId are required.',
      );
    }

    if ((context.auth.token.firmId as string | undefined) !== firmId) {
      throw new functions.https.HttpsError('permission-denied', 'Cannot export documents for a different firm.');
    }

    if (!['pdf', 'docx', 'both'].includes(format)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        "format must be 'pdf', 'docx', or 'both'.",
      );
    }

    // ── 3. Fetch all documents for this client ────────────────────────────────
    const db = admin.firestore();
    const docsSnap = await db
      .collection(`firms/${firmId}/clients/${clientId}/documents`)
      .get();

    if (docsSnap.empty) {
      throw new functions.https.HttpsError('not-found', 'No documents found for this client.');
    }

    const documents: DocumentRecord[] = docsSnap.docs.map((d) => ({
      id: d.id,
      displayName: d.data().displayName ?? 'Document',
      status: d.data().status ?? 'draft',
      htmlContent:
        d.data().htmlContent ?? d.data().content ?? '<p>No content available.</p>',
    }));

    console.log(
      `[exportBatchDocuments] Exporting ${documents.length} documents as '${format}' for client ${clientId}`,
    );

    // ── 4. Generate exports and ZIP ───────────────────────────────────────────
    const timestamp = Date.now();
    const zipFileName = `Client_Documents_${format.toUpperCase()}_${timestamp}.zip`;
    const storagePath = `firms/${firmId}/clients/${clientId}/exports/${zipFileName}`;

    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

    try {
      // Launch browser once for all PDF renders
      if (format === 'pdf' || format === 'both') {
        browser = await puppeteer.launch({
          headless: true,
          executablePath: await chromium.executablePath(),
          args: chromium.args,
        });
      }

      // Track used file names to avoid duplicates in the ZIP
      const usedNames = new Map<string, number>();

      const downloadUrl = await uploadZipToStorage(
        storagePath,
        async (archive) => {
          for (const doc of documents) {
            const safeName = sanitizeFileName(doc.displayName) || `document_${doc.id}`;

            // De-duplicate names within the ZIP
            const count = usedNames.get(safeName) ?? 0;
            usedNames.set(safeName, count + 1);
            const uniqueName = count === 0 ? safeName : `${safeName}_${count}`;

            // ── PDF ──────────────────────────────────────────────────────────
            if ((format === 'pdf' || format === 'both') && browser) {
              try {
                const pdfBuf = await generatePdfBuffer(
                  browser,
                  doc.displayName,
                  doc.htmlContent,
                  doc.status,
                );
                archive.append(pdfBuf as unknown as Readable, {
                  name: `${uniqueName}.pdf`,
                });
              } catch (err) {
                console.warn(
                  `[exportBatchDocuments] PDF failed for "${doc.displayName}":`,
                  err,
                );
                // Add an error placeholder so the ZIP is still complete
                archive.append(
                  `PDF generation failed for: ${doc.displayName}\n\nError: ${err instanceof Error ? err.message : String(err)}`,
                  { name: `${uniqueName}_ERROR.txt` },
                );
              }
            }

            // ── DOCX ─────────────────────────────────────────────────────────
            if (format === 'docx' || format === 'both') {
              try {
                const docxBuf = await generateDocxBuffer(
                  doc.displayName,
                  doc.htmlContent,
                  doc.status,
                );
                archive.append(docxBuf as unknown as Readable, {
                  name: `${uniqueName}.docx`,
                });
              } catch (err) {
                console.warn(
                  `[exportBatchDocuments] DOCX failed for "${doc.displayName}":`,
                  err,
                );
                archive.append(
                  `DOCX generation failed for: ${doc.displayName}\n\nError: ${err instanceof Error ? err.message : String(err)}`,
                  { name: `${uniqueName}_DOCX_ERROR.txt` },
                );
              }
            }
          }

          // Add a manifest file
          const manifest = buildManifest(documents, format, timestamp);
          archive.append(manifest, { name: 'EXPORT_MANIFEST.txt' });
        },
        {
          firmId,
          clientId,
          exportedAt: new Date().toISOString(),
          exportFormat: format,
          documentCount: String(documents.length),
        },
      );

      if (browser) {
        await browser.close();
        browser = null;
      }

      return {
        success: true,
        downloadUrl,
        fileName: zipFileName,
        storagePath,
        documentCount: documents.length,
        format,
      };
    } catch (err: unknown) {
      if (browser) {
        try {
          await browser.close();
        } catch (_) {
          // ignore
        }
      }

      const message = err instanceof Error ? err.message : 'Batch export failed.';
      console.error('[exportBatchDocuments] Error:', message, err);
      throw new functions.https.HttpsError('internal', `Batch export failed: ${message}`);
    }
  },
  );

// ── Manifest builder ──────────────────────────────────────────────────────────

function buildManifest(
  docs: DocumentRecord[],
  format: ExportFormat,
  timestamp: number,
): string {
  const date = new Date(timestamp).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const lines = [
    'ESTATE PLAN DOCUMENT EXPORT',
    '===========================',
    `Export Date : ${date}`,
    `Format      : ${format.toUpperCase()}`,
    `Total Docs  : ${docs.length}`,
    '',
    'DOCUMENTS INCLUDED',
    '------------------',
    ...docs.map(
      (d, i) =>
        `${String(i + 1).padStart(3, ' ')}. [${d.status.toUpperCase().padEnd(6)}]  ${d.displayName}`,
    ),
    '',
    'NOTE: Documents marked DRAFT have not been reviewed or executed.',
    'Do not rely on draft documents for legal purposes.',
  ];

  return lines.join('\n');
}
