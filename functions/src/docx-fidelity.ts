/**
 * functions/src/docx-fidelity.ts
 *
 * High-fidelity DOCX generation (v1) — the "high-fidelity" mode that was
 * planned but unimplemented: instead of rendering HTML and reconstructing a
 * .docx on export, this fills a firm's real binary .docx template in place,
 * preserving the original file's styles, numbering, headers/footers, and
 * layout exactly.
 *
 * Pipeline:
 *   1. Load the firm's .docx template bytes from Cloud Storage.
 *   2. Fill {{placeholders}} with docxtemplater (delimiters match the HBS
 *      convention used elsewhere), from a flat data map built off the same
 *      ClientContext the rest of the pipeline uses.
 *   3. Convert the filled .docx to HTML with mammoth for the in-app preview.
 *   4. Save through document-save-helper — the binary lands in the client
 *      vault (`.docx` in Storage) and the HTML preview in Firestore, so the
 *      document behaves like any other vault document.
 *
 * Unresolved placeholders never fail the run: they render blank, are
 * reported as warnings on the saved document, and are returned to the
 * caller — same philosophy as the template engine's missing-field marking.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import mammoth from 'mammoth';
import { assertFirmStaff } from './auth-guards';
import { aggregateClientContext, ClientContext } from './client-context-aggregator';
import { formatFullName } from './client-data-serializer';
import { estimateTotalAssets } from './client-facts';
import { saveDocumentToVault } from './document-save-helper';

// ---------------------------------------------------------------------------
// Core fill (pure — unit-testable without Firebase)
// ---------------------------------------------------------------------------

export interface FillDocxResult {
  buffer: Buffer;
  /** Placeholder tags that had no value and rendered blank. */
  missingTags: string[];
}

/**
 * Fill a binary .docx template's {{placeholders}} with the given data.
 * Never throws on missing tags — they render blank and are reported.
 */
export function fillDocxTemplate(
  templateBytes: Buffer,
  data: Record<string, unknown>,
): FillDocxResult {
  const missing = new Set<string>();
  const zip = new PizZip(templateBytes);
  const doc = new Docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: (part: { value?: string }) => {
      if (part.value) missing.add(part.value);
      return '';
    },
  });
  doc.render(data);
  const buffer = doc
    .getZip()
    .generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
  return { buffer, missingTags: [...missing].sort() };
}

/**
 * Build the flat placeholder data map from ClientContext. Field names are
 * the documented contract for firm-authored .docx templates; extend here
 * (one place) rather than ad hoc.
 */
export function buildDocxTemplateData(
  ctx: ClientContext,
): Record<string, unknown> {
  const client = ctx.client;
  const pi = (client.personalInfo ?? {}) as Record<string, unknown>;
  const fiduciaries = (client.fiduciaries ?? {}) as Record<string, unknown>;
  const poa = (fiduciaries.powerOfAttorney ?? {}) as Record<string, unknown>;
  const executor = (fiduciaries.executor ?? {}) as Record<string, unknown>;
  const trustee = (fiduciaries.trustee ?? {}) as Record<string, unknown>;
  const guardian = (fiduciaries.guardian ?? {}) as Record<string, unknown>;
  const healthcare = (fiduciaries.healthcareProxy ?? {}) as Record<string, unknown>;
  const person = (p: unknown): string =>
    formatFullName(p as Record<string, unknown> | null | undefined);

  return {
    // Client + spouse
    clientFullName: ctx.computed.clientFullName,
    spouseFullName: ctx.computed.spouseFullName,
    clientAddress: pi.address ?? '',
    clientCity: pi.city ?? '',
    clientCounty: pi.county ?? '',
    clientState: pi.state ?? 'NJ',
    clientZip: pi.zip ?? '',
    clientDob: pi.dob ?? '',
    maritalStatus: pi.maritalStatus ?? '',
    // Fiduciaries
    executorName: person(executor.primary),
    alternateExecutorName: person(executor.alternate),
    trusteeName: person(trustee.primary),
    alternateTrusteeName: person(trustee.alternate),
    guardianName: person(guardian.primary),
    alternateGuardianName: person(guardian.alternate),
    poaAgentName: person(poa.agent),
    poaAlternateAgentName: person(poa.alternateAgent),
    healthcareAgentName: person(healthcare.primary ?? healthcare.agent),
    // Family
    childCount: ctx.computed.childCount,
    childrenNames: (Array.isArray(client.children) ? client.children : [])
      .map((c: Record<string, unknown>) => person(c))
      .filter(Boolean)
      .join(', '),
    hasMinorChildren: ctx.computed.hasMinorChildren,
    // Estate + firm + dates
    estimatedTotalAssets: estimateTotalAssets(client.assets),
    firmName: ctx.firm.name ?? '',
    attorneyName: ctx.firm.attorneyName ?? '',
    todayFormatted: ctx.computed.todayFormatted,
    todayISO: ctx.computed.todayISO,
  };
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const generateHighFidelityDocx = onCall(
  {
    region: 'us-east1',
    memory: '1GiB',
    timeoutSeconds: 300,
  },
  async (request) => {
    const { firmId, clientId, templateStoragePath, docType, displayName } =
      request.data as {
        firmId?: string;
        clientId?: string;
        templateStoragePath?: string;
        docType?: string;
        displayName?: string;
      };
    if (!firmId || !clientId || !templateStoragePath) {
      throw new HttpsError(
        'invalid-argument',
        'Missing required fields: firmId, clientId, templateStoragePath.',
      );
    }
    const caller = assertFirmStaff(request, firmId);

    // Tenant boundary on the template read: only this firm's storage tree.
    if (!templateStoragePath.startsWith(`firms/${firmId}/`)) {
      throw new HttpsError(
        'permission-denied',
        'templateStoragePath must be inside this firm\'s storage area.',
      );
    }
    if (!templateStoragePath.toLowerCase().endsWith('.docx')) {
      throw new HttpsError(
        'invalid-argument',
        'templateStoragePath must point to a .docx file.',
      );
    }

    const file = admin.storage().bucket().file(templateStoragePath);
    const [exists] = await file.exists();
    if (!exists) {
      throw new HttpsError('not-found', `Template not found: ${templateStoragePath}`);
    }
    const [templateBytes] = await file.download();

    const ctx = await aggregateClientContext(firmId, clientId, docType);
    const data = buildDocxTemplateData(ctx);

    let filled: FillDocxResult;
    try {
      filled = fillDocxTemplate(templateBytes, data);
    } catch (err) {
      throw new HttpsError(
        'failed-precondition',
        `Template could not be rendered: ${err instanceof Error ? err.message : 'unknown error'}. ` +
          'Check the template for malformed {{placeholders}}.',
      );
    }

    // HTML preview so the vault document renders in the existing editor.
    let previewHtml = '';
    try {
      const converted = await mammoth.convertToHtml({ buffer: filled.buffer });
      previewHtml = converted.value;
    } catch (convErr) {
      console.warn('[generateHighFidelityDocx] mammoth preview failed:', convErr);
    }

    const warnings = filled.missingTags.map(
      (tag) => `[warning] unresolved-placeholder: {{${tag}}} rendered blank.`,
    );

    const resolvedDocType = docType ?? 'custom';
    const saveResult = await saveDocumentToVault({
      firmId,
      clientId,
      docType: resolvedDocType,
      displayName:
        displayName ??
        `High-Fidelity ${resolvedDocType} — ${ctx.computed.clientFullName}`,
      content:
        previewHtml ||
        '<p>[Binary .docx document — preview conversion unavailable. Download the file to review.]</p>',
      binaryBuffer: filled.buffer,
      status: 'draft',
      createdBy: caller.uid,
      triggerSource: 'single',
      warnings: warnings.length > 0 ? warnings : undefined,
      changeNotes: `High-fidelity fill from ${templateStoragePath}`,
    });

    return {
      documentId: saveResult.docId,
      currentVersion: saveResult.currentVersion,
      storagePath: saveResult.storagePath ?? null,
      missingTags: filled.missingTags,
    };
  },
);
