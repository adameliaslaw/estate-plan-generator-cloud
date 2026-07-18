/**
 * functions/src/esign-service.ts
 *
 * E-signature document package generation for the NJ Estate Plan Generator.
 *
 * One Cloud Function:
 *
 * generateEsignPackage (onCall)
 *   Generates one signing-ready PDF per selected document. Each PDF includes
 *   the full document content followed by a signature page with pre-printed
 *   name/date lines for each signer. PDFs are uploaded to Cloud Storage and
 *   the function returns their storage paths so the caller can forward them
 *   to an e-signature provider (DocuSign, HelloSign, etc.) or download them
 *   for in-person signing.
 *
 * Firestore paths:
 *   Source documents:  firms/{firmId}/clients/{clientId}/documents/{documentId}
 *   Client record:     firms/{firmId}/clients/{clientId}
 *   E-sign package:    firms/{firmId}/clients/{clientId}/esignPackages/{packageId}
 *
 * Cloud Storage path:
 *   esign-packages/{firmId}/{clientId}/{packageId}/{safeName}_signing.pdf
 */

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { buildLegalDocumentHtml, blockExternalRequests } from './export-pdf';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SignerInfo {
  name: string;
  role: string; // e.g. 'Testator', 'Trustor', 'Witness', 'Notary'
  email?: string;
}

interface GenerateEsignPackageData {
  firmId: string;
  clientId: string;
  documentIds: string[];
  signers: SignerInfo[];
}

interface GeneratedPdf {
  documentId: string;
  displayName: string;
  storagePath: string;
  downloadUrl: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_DOCUMENTS = 30;
const SIGNED_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the signature page HTML appended after each document's content.
 */
function buildSignaturePageHtml(signers: SignerInfo[], documentTitle: string): string {
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const signerBlocks = signers
    .map(
      (signer) => `
      <div class="signer-block">
        <div class="signer-role">${escapeHtml(signer.role)}</div>
        <div class="sig-row">
          <div class="sig-line-group">
            <div class="sig-line"></div>
            <div class="sig-label">Signature</div>
          </div>
          <div class="sig-line-group sig-date-group">
            <div class="sig-line"></div>
            <div class="sig-label">Date</div>
          </div>
        </div>
        <div class="sig-row">
          <div class="sig-line-group">
            <div class="sig-line sig-printed">${escapeHtml(signer.name)}</div>
            <div class="sig-label">Printed Name</div>
          </div>
        </div>
        ${signer.email ? `<div class="sig-email">Email: ${escapeHtml(signer.email)}</div>` : ''}
      </div>`,
    )
    .join('\n');

  return `
    <div class="signature-page">
      <div class="sig-page-header">
        <h2>SIGNATURE PAGE</h2>
        <p class="sig-doc-title">${escapeHtml(documentTitle)}</p>
        <p class="sig-date-line">Dated: ${escapeHtml(dateStr)}</p>
      </div>
      <div class="sig-instructions">
        <p>By signing below, each party acknowledges that they have read, understood,
        and agree to the terms set forth in this document.</p>
      </div>
      ${signerBlocks}
    </div>

    <style>
      .signature-page {
        page-break-before: always;
        padding-top: 36pt;
        font-family: 'Times New Roman', Times, serif;
      }

      .sig-page-header {
        text-align: center;
        margin-bottom: 24pt;
      }

      .sig-page-header h2 {
        font-size: 13pt;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: 8pt;
      }

      .sig-doc-title {
        font-size: 11pt;
        font-style: italic;
        color: #333;
      }

      .sig-date-line {
        font-size: 11pt;
        margin-top: 6pt;
      }

      .sig-instructions {
        margin: 18pt 0 28pt;
        padding: 10pt 14pt;
        border: 1px solid #ccc;
        background: #fafafa;
        font-size: 10.5pt;
        line-height: 1.5;
      }

      .sig-instructions p { margin: 0; }

      .signer-block {
        margin-bottom: 36pt;
        page-break-inside: avoid;
      }

      .signer-role {
        font-size: 10pt;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #444;
        margin-bottom: 14pt;
        border-bottom: 1px solid #ddd;
        padding-bottom: 4pt;
      }

      .sig-row {
        display: flex;
        gap: 32pt;
        margin-bottom: 18pt;
      }

      .sig-line-group {
        flex: 1;
      }

      .sig-date-group {
        max-width: 140pt;
      }

      .sig-line {
        border-bottom: 1.5px solid #000;
        height: 28pt;
        display: flex;
        align-items: flex-end;
        padding-bottom: 2pt;
      }

      .sig-printed {
        font-weight: bold;
        font-size: 11pt;
      }

      .sig-label {
        font-size: 8.5pt;
        color: #555;
        margin-top: 3pt;
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }

      .sig-email {
        font-size: 10pt;
        color: #555;
        margin-top: 4pt;
      }
    </style>`;
}

/**
 * Minimal HTML entity escaper for interpolation into template literals.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render a single document's content + signature page to a PDF buffer.
 * Content is sanitized inside buildLegalDocumentHtml (#167).
 */
async function renderDocumentPdf(
  browser: Awaited<ReturnType<typeof puppeteer.launch>>,
  documentTitle: string,
  htmlContent: string,
  status: string,
  signers: SignerInfo[],
): Promise<Buffer> {
  const documentHtml = buildLegalDocumentHtml(documentTitle, htmlContent, status);
  const signaturePageHtml = buildSignaturePageHtml(signers, documentTitle);

  // Inject the signature page just before the closing </body></html> tags
  const fullHtml = documentHtml.replace(
    /<\/body>\s*<\/html>\s*$/,
    `${signaturePageHtml}\n</body>\n</html>`,
  );

  const page = await browser.newPage();
  try {
    // #167: deny all network access from the rendered (client-influenced) HTML.
    await blockExternalRequests(page);
    await page.setContent(fullHtml, { waitUntil: 'networkidle0', timeout: 60_000 });

    const pdfUint8 = await page.pdf({
      format: 'Letter',
      margin: { top: '1in', bottom: '1in', left: '1in', right: '1in' },
      printBackground: true,
    });

    return Buffer.from(pdfUint8);
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const generateEsignPackage = functions
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
        'Only attorneys, paralegals, and admins may generate e-sign packages.',
      );
    }

    // ── 2. Validate input ────────────────────────────────────────────────────
    const { firmId, clientId, documentIds, signers } =
      data as Partial<GenerateEsignPackageData>;

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
        `Cannot include more than ${MAX_DOCUMENTS} documents in one e-sign package.`,
      );
    }

    if (!Array.isArray(signers) || signers.length === 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'At least one signer is required.',
      );
    }

    for (const s of signers) {
      if (!s.name?.trim() || !s.role?.trim()) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Each signer must have a non-empty name and role.',
        );
      }
    }

    if ((context.auth.token.firmId as string | undefined) !== firmId) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Cannot generate e-sign packages for a different firm.',
      );
    }

    console.log(
      `[generateEsignPackage] START firmId=${firmId} clientId=${clientId} ` +
      `docs=${documentIds.length} signers=${signers.length}`,
    );

    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();

    // ── 3. Fetch source documents ────────────────────────────────────────────
    interface SourceDoc {
      id: string;
      displayName: string;
      htmlContent: string;
      status: string;
    }

    const fetched: SourceDoc[] = [];
    const missing: string[] = [];

    const CHUNK = 30;
    for (let i = 0; i < documentIds.length; i += CHUNK) {
      const chunk = documentIds.slice(i, i + CHUNK);
      const snaps = await Promise.all(
        chunk.map((docId) =>
          db.doc(`firms/${firmId}/clients/${clientId}/documents/${docId}`).get(),
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

    // ── 4. Create the e-sign package Firestore record ────────────────────────
    const packageRef = db
      .collection('firms')
      .doc(firmId)
      .collection('clients')
      .doc(clientId)
      .collection('esignPackages')
      .doc();

    const packageId = packageRef.id;

    await packageRef.set({
      id: packageId,
      firmId,
      clientId,
      documentIds: fetched.map((d) => d.id),
      signers,
      status: 'generating',
      createdAt: now,
      createdBy: context.auth.uid,
      updatedAt: now,
    });

    // ── 5. Render PDFs ───────────────────────────────────────────────────────
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
    const results: GeneratedPdf[] = [];

    try {
      browser = await puppeteer.launch({
        headless: true,
        executablePath: await chromium.executablePath(),
        args: chromium.args,
      });

      const bucket = admin.storage().bucket();

      for (const srcDoc of fetched) {
        console.log(
          `[generateEsignPackage] Rendering "${srcDoc.displayName}" (${srcDoc.id})`,
        );

        const pdfBuffer = await renderDocumentPdf(
          browser,
          srcDoc.displayName,
          srcDoc.htmlContent,
          srcDoc.status,
          signers,
        );

        // Upload to Cloud Storage
        const safeName = srcDoc.displayName
          .replace(/[^a-zA-Z0-9\s\-_]/g, '')
          .replace(/\s+/g, '_')
          .substring(0, 80);

        const storagePath = `esign-packages/${firmId}/${clientId}/${packageId}/${safeName}_signing.pdf`;
        const file = bucket.file(storagePath);

        await file.save(pdfBuffer, {
          contentType: 'application/pdf',
          metadata: {
            firmId,
            clientId,
            documentId: srcDoc.id,
            packageId,
            signerCount: String(signers.length),
            generatedAt: new Date().toISOString(),
            type: 'esign-signing-copy',
          },
        });

        const [downloadUrl] = await file.getSignedUrl({
          action: 'read',
          expires: Date.now() + SIGNED_URL_TTL_MS,
        });

        results.push({
          documentId: srcDoc.id,
          displayName: srcDoc.displayName,
          storagePath,
          downloadUrl,
        });
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

    // ── 6. Update the package record with results ────────────────────────────
    await packageRef.update({
      status: 'ready',
      generatedPdfs: results.map((r) => ({
        documentId: r.documentId,
        displayName: r.displayName,
        storagePath: r.storagePath,
      })),
      generatedAt: now,
      updatedAt: now,
    });

    console.log(
      `[generateEsignPackage] DONE — packageId=${packageId} pdfs=${results.length}`,
    );

    return {
      success: true,
      packageId,
      pdfs: results,
      skippedCount: missing.length,
      skippedIds: missing,
    };
  },
  );
