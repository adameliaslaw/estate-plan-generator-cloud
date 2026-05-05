/**
 * export-pdf.ts
 *
 * Cloud Function: exportDocumentPdf
 *
 * Fetches a document from Firestore, renders its HTML content through
 * Puppeteer, and uploads the resulting PDF to Cloud Storage.
 * Returns a signed download URL valid for 1 hour.
 */

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import * as path from 'path';

// ── Helper: sanitize a display name for use in a file name ───────────────────

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s\-_]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 100)
    .replace(/^_+|_+$/g, '');
}

// ── Helper: build a full, self-contained HTML document ───────────────────────

export function buildLegalDocumentHtml(
  title: string,
  content: string,
  status: string,
): string {
  const isDraft = status === 'draft';

  const watermarkCss = isDraft
    ? `
      body::before {
        content: "DRAFT — NOT YET EXECUTED";
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) rotate(-35deg);
        font-size: 72px;
        font-weight: 900;
        color: rgba(200, 0, 0, 0.12);
        white-space: nowrap;
        pointer-events: none;
        z-index: 0;
        font-family: 'Times New Roman', Times, serif;
        letter-spacing: 4px;
      }
    `
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="author" content="Elias Counsel, LLC" />
  <meta name="creator" content="Elias Counsel, LLC" />
  <meta name="producer" content="NJ Estate Plan Generator — Elias Counsel, LLC" />
  <title>${escapeHtml(title)}</title>
  <style>
    /* ── Reset ────────────────────────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── Page / body ──────────────────────────────────────────────────────── */
    html, body {
      width: 100%;
      height: 100%;
    }

    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 12pt;
      line-height: 1.6;
      color: #000;
      background: #fff;
      position: relative;
    }

    /* ── Watermark ────────────────────────────────────────────────────────── */
    ${watermarkCss}

    /* ── Content wrapper ──────────────────────────────────────────────────── */
    .document-body {
      position: relative;
      z-index: 1;
    }

    /* ── Draft banner (visible in content, not just watermark) ───────────── */
    ${isDraft
      ? `
      .draft-banner {
        display: block;
        text-align: center;
        font-size: 10pt;
        font-weight: bold;
        color: #cc0000;
        border: 1.5px solid #cc0000;
        padding: 4px 12px;
        margin-bottom: 24px;
        letter-spacing: 1px;
      }
    `
      : '.draft-banner { display: none; }'
    }

    /* ── Typography ───────────────────────────────────────────────────────── */
    h1 {
      font-size: 14pt;
      font-weight: bold;
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin: 0 0 18pt 0;
      page-break-after: avoid;
    }

    h2 {
      font-size: 12pt;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin: 18pt 0 10pt 0;
      page-break-after: avoid;
    }

    h3 {
      font-size: 12pt;
      font-weight: bold;
      margin: 14pt 0 8pt 0;
      page-break-after: avoid;
    }

    p {
      margin: 0 0 10pt 0;
      text-align: justify;
      orphans: 3;
      widows: 3;
    }

    /* ── Lists ────────────────────────────────────────────────────────────── */
    ul, ol {
      margin: 8pt 0 10pt 24pt;
    }

    li {
      margin-bottom: 4pt;
    }

    /* ── Tables ───────────────────────────────────────────────────────────── */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 12pt 0;
      font-size: 11pt;
    }

    th, td {
      border: 1px solid #555;
      padding: 6pt 8pt;
      text-align: left;
      vertical-align: top;
    }

    th {
      font-weight: bold;
      background: #f0f0f0;
    }

    /* ── Signature blocks ─────────────────────────────────────────────────── */
    .signature-block {
      margin-top: 36pt;
      page-break-inside: avoid;
    }

    .signature-line {
      display: flex;
      align-items: flex-end;
      gap: 16pt;
      margin-bottom: 8pt;
    }

    .sig-label {
      font-size: 10pt;
      white-space: nowrap;
    }

    .sig-underline {
      flex: 1;
      border-bottom: 1px solid #000;
      min-width: 120pt;
    }

    /* ── Horizontal rules ─────────────────────────────────────────────────── */
    hr {
      border: none;
      border-top: 1px solid #ccc;
      margin: 18pt 0;
    }

    /* ── Block quotes / indented clauses ─────────────────────────────────── */
    blockquote {
      margin: 10pt 0 10pt 24pt;
      padding-left: 12pt;
      border-left: 3px solid #ccc;
    }

    /* ── Strong / emphasis ────────────────────────────────────────────────── */
    strong, b { font-weight: bold; }
    em, i     { font-style: italic; }
    u         { text-decoration: underline; }

    /* ── Page break helpers ───────────────────────────────────────────────── */
    .page-break { page-break-after: always; }

    /* ── Notary / certification block ─────────────────────────────────────── */
    .notary-block {
      margin-top: 36pt;
      border: 1px solid #999;
      padding: 12pt;
      page-break-inside: avoid;
      font-size: 11pt;
    }

    .notary-block p {
      margin-bottom: 6pt;
    }

    /* ── TR_ styles (template-referenced document formatting) ───────────── */
    .tr-title       { text-align: center; text-decoration: underline; text-transform: uppercase; font-size: 14pt; font-weight: bold; margin: 0 0 18pt; page-break-after: avoid; }
    .tr-cover-title { text-align: center; font-size: 14pt; margin: 36pt 0 18pt; }
    .tr-cover       { text-align: center; margin: 0 0 6pt; }
    .tr-mem-header1 { text-align: center; text-decoration: underline; margin: 24pt 0 14pt; page-break-after: avoid; }
    .tr-body1       { text-align: justify; margin: 0 0 10pt; }
    .tr-body3       { text-align: justify; margin: 10pt 0; }
    .tr-art1        { text-align: center; font-weight: bold; margin: 24pt 0 14pt; page-break-after: avoid; }
    .tr-art1 + .tr-art1 { margin-top: 5pt; }
    .tr-art2        { text-align: justify; margin: 0 0 10pt; }
    .tr-art3b       { text-align: justify; text-indent: 1in; margin: 0 0 8pt; }
    .tr-art4b       { text-align: justify; text-indent: 1.5in; margin: 0 0 8pt; }
    .tr-sig-line    { margin-left: 3.5in; margin-bottom: 4pt; }
    .tr-sig-name    { margin-left: 3.5in; font-weight: bold; margin-bottom: 10pt; }
    .tr-affid       { margin: 0 0 6pt; font-size: 11pt; }
    .tr-base        { margin: 0 0 6pt; min-height: 1em; }
  </style>
</head>
<body>
  <div class="document-body">
    <div class="draft-banner">DRAFT — NOT YET EXECUTED — DO NOT RELY ON THIS DOCUMENT</div>
    ${content}
  </div>
</body>
</html>`;
}

// ── Tiny HTML-entity escaper (for the <title> tag only) ───────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Cloud Function ────────────────────────────────────────────────────────────

export const exportDocumentPdf = functions
  .runWith({
    timeoutSeconds: 120,
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
    const { firmId, clientId, documentId } = data as {
      firmId?: string;
      clientId?: string;
      documentId?: string;
    };

    if (!firmId || !clientId || !documentId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'firmId, clientId, and documentId are required.',
      );
    }

    if ((context.auth.token.firmId as string | undefined) !== firmId) {
      throw new functions.https.HttpsError('permission-denied', 'Cannot export documents for a different firm.');
    }

    // ── 3. Fetch document from Firestore ─────────────────────────────────────
    const db = admin.firestore();
    const docRef = db.doc(
      `firms/${firmId}/clients/${clientId}/documents/${documentId}`,
    );
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Document not found.');
    }

    const docData = docSnap.data()!;
    // Support both field names used across the codebase
    const htmlContent: string =
      docData.htmlContent ?? docData.content ?? '<p>No content available.</p>';
    const displayName: string = docData.displayName ?? 'Document';
    const status: string = docData.status ?? 'draft';

    // ── 4. Build the full HTML page ──────────────────────────────────────────
    const html = buildLegalDocumentHtml(displayName, htmlContent, status);

    // ── 5. Render PDF with Puppeteer ─────────────────────────────────────────
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

    try {
      browser = await puppeteer.launch({
        headless: true,
        executablePath: await chromium.executablePath(),
        args: chromium.args,
      });

      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });

      const isDraft = status === 'draft';
      const headerHtml = `
        <div style="
          font-size: 9px;
          width: 100%;
          padding: 0 72px;
          text-align: center;
          color: #555;
          font-family: 'Times New Roman', Times, serif;
          ${isDraft ? 'color: #cc0000; font-weight: bold;' : ''}
        ">
          ${escapeHtml(displayName)}
          ${isDraft ? ' — DRAFT' : ''}
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
        margin: {
          top: '1in',
          bottom: '1in',
          left: '1in',
          right: '1in',
        },
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: headerHtml,
        footerTemplate: footerHtml,
        // ── PDF document metadata ──────────────────────────────────────────
        // The <title> tag in the HTML sets the document title embedded in the
        // PDF.  The author is set via <meta name="author"> in the HTML head.
        // Both are read by PDF viewers (e.g. Adobe Acrobat, macOS Preview).
        // Author: "Elias Counsel, LLC" (see buildLegalDocumentHtml <meta> tags).
      });

      await browser.close();
      browser = null;

      // ── 6. Upload to Cloud Storage ─────────────────────────────────────────
      const safeName = sanitizeFileName(displayName);
      const timestamp = Date.now();
      const fileName = `firms/${firmId}/clients/${clientId}/exports/${safeName}_${timestamp}.pdf`;

      const bucket = admin.storage().bucket();
      const file = bucket.file(fileName);

      await file.save(Buffer.from(pdfBuffer), {
        contentType: 'application/pdf',
        metadata: {
          firmId,
          clientId,
          documentId,
          exportedAt: new Date().toISOString(),
          exportFormat: 'pdf',
          documentStatus: status,
        },
      });

      // ── 7. Return signed URL (1 hour) ──────────────────────────────────────
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000, // 1 hour
      });

      return {
        success: true,
        downloadUrl: url,
        fileName: `${safeName}.pdf`,
        storagePath: fileName,
      };
    } catch (err: unknown) {
      if (browser) {
        try {
          await browser.close();
        } catch (_) {
          // ignore close errors
        }
      }

      const message = err instanceof Error ? err.message : 'PDF generation failed.';
      console.error('[exportDocumentPdf] Error:', message, err);
      throw new functions.https.HttpsError('internal', `PDF export failed: ${message}`);
    }
  },
  );
