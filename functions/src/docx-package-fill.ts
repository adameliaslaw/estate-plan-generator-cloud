/**
 * functions/src/docx-package-fill.ts
 *
 * High-fidelity .docx fills for PACKAGE (batch) generation.
 *
 * Single-doc high-fidelity (docx-fidelity.ts) works because the attorney
 * picks the template file by hand. A package run generates 5-12 documents at
 * once, so the pairing lives in configuration instead: one mapping per
 * docType under firms/{firmId}/docxTemplateMap/{docType} (doc id = docType —
 * duplicates impossible by construction), written from the settings UI.
 *
 * generate-documents.ts consults the map when the batch runs in
 * 'high-fidelity' mode: mapped, non-property docTypes are filled here;
 * everything else falls back to 'template' mode with a warning attached so
 * the mixed run stays honest (per-document generationMode records which path
 * actually produced each document).
 */

import * as admin from 'firebase-admin';
import mammoth from 'mammoth';
import { buildDocxTemplateData, fillDocxTemplate } from './docx-fidelity';
import { checkClientFactConsistency } from './client-facts';
import { hasSpouseData, swapClientContextForSpouse } from './spouse-swap';
import { saveDocumentToVault } from './document-save-helper';
import {
  ClientContext,
  aggregateClientContext,
} from './client-context-aggregator';
import {
  UnifiedGenerateResult,
  cloneClientContext,
  getDocTypeDisplayName,
} from './unified-generator';

export const DOCX_TEMPLATE_MAP_COLLECTION = 'docxTemplateMap';

/** Per-property docTypes never fill from a flat map (they expand per property
 *  with property context the flat placeholder set cannot express). */
export const HF_EXCLUDED_DOC_TYPES = new Set(['deed', 'affidavitOfConsideration', 'gitRep3']);

export interface DocxTemplateMapping {
  docType: string;
  templateStoragePath: string;
  templateFileName?: string;
}

// ---------------------------------------------------------------------------
// Mapping load + per-entry plan (pure decision logic — unit-testable)
// ---------------------------------------------------------------------------

export async function loadDocxTemplateMap(
  firmId: string,
): Promise<Map<string, DocxTemplateMapping>> {
  const snap = await admin
    .firestore()
    .collection('firms').doc(firmId)
    .collection(DOCX_TEMPLATE_MAP_COLLECTION)
    .get();
  const map = new Map<string, DocxTemplateMapping>();
  for (const doc of snap.docs) {
    const data = doc.data();
    const path = typeof data.templateStoragePath === 'string' ? data.templateStoragePath : '';
    // Tenant boundary + format checks at load time: a mapping pointing outside
    // this firm's storage tree (or at a non-.docx) is ignored, not filled.
    if (!path.startsWith(`firms/${firmId}/`) || !path.toLowerCase().endsWith('.docx')) {
      if (path) console.warn(`[docxPackageFill] Ignoring invalid mapping for ${doc.id}: ${path}`);
      continue;
    }
    map.set(doc.id, {
      docType: doc.id,
      templateStoragePath: path,
      templateFileName: typeof data.templateFileName === 'string' ? data.templateFileName : undefined,
    });
  }
  return map;
}

export interface HfPlanEntry {
  action: 'fill' | 'fallback';
  /** Present on fallback — attached to the generated document as a warning. */
  fallbackReason?: string;
}

/**
 * Decide, for one docType, whether a high-fidelity batch fills the mapped
 * .docx or falls back to template mode. Fallback never blocks the package —
 * the reason surfaces as a warning on the fallback-generated document.
 */
export function planHighFidelityEntry(
  docType: string,
  map: Map<string, DocxTemplateMapping>,
): HfPlanEntry {
  if (HF_EXCLUDED_DOC_TYPES.has(docType)) {
    return {
      action: 'fallback',
      fallbackReason:
        `[warning] hf-fallback: ${docType} is generated per property and cannot fill a flat ` +
        '.docx template — generated from the HTML template instead.',
    };
  }
  if (!map.has(docType)) {
    return {
      action: 'fallback',
      fallbackReason:
        `[warning] hf-fallback: no firm .docx template is mapped for ${docType} — ` +
        'generated from the HTML template instead. Map one under Settings → Firm .docx Templates.',
    };
  }
  return { action: 'fill' };
}

// ---------------------------------------------------------------------------
// Per-entry fill
// ---------------------------------------------------------------------------

export interface FillDocxForEntryParams {
  firmId: string;
  clientId: string;
  docType: string;
  spouseRole?: 'client' | 'spouse';
  mapping: DocxTemplateMapping;
  createdBy: string;
  preloadedContext?: ClientContext;
  /** Test seam — defaults to a Cloud Storage download. */
  loadTemplateBytes?: (storagePath: string) => Promise<Buffer>;
}

async function downloadFromStorage(storagePath: string): Promise<Buffer> {
  const file = admin.storage().bucket().file(storagePath);
  const [exists] = await file.exists();
  if (!exists) throw new Error(`Template not found in storage: ${storagePath}`);
  const [bytes] = await file.download();
  return bytes;
}

/**
 * Fill the mapped .docx for one package entry and save it to the vault.
 * Mirrors unified-generator conventions: deterministic docId with `_spouse`
 * suffix, spouse swap via spouse-swap.ts (R5-034 guard included), and
 * client-fact consistency findings attached as warnings.
 */
export async function fillDocxForEntry(
  params: FillDocxForEntryParams,
): Promise<UnifiedGenerateResult> {
  const { firmId, clientId, docType, mapping, createdBy } = params;

  const ctx = params.preloadedContext
    ? cloneClientContext(params.preloadedContext)
    : await aggregateClientContext(firmId, clientId, docType);

  // R5-034: a spouse document requires spouse data on file — fail this entry
  // loudly rather than saving the primary's data under the spouse docId.
  if (params.spouseRole === 'spouse') {
    if (!hasSpouseData(ctx.client)) {
      throw new Error(
        'Cannot generate a spouse document: no spouse information is on file for this client.',
      );
    }
    swapClientContextForSpouse(ctx);
  }

  const warnings: string[] = [];
  for (const f of checkClientFactConsistency(ctx.client)) {
    warnings.push(`[${f.severity}] ${f.code}: ${f.message}`);
  }

  const loadBytes = params.loadTemplateBytes ?? downloadFromStorage;
  const templateBytes = await loadBytes(mapping.templateStoragePath);

  const data = buildDocxTemplateData(ctx);
  const filled = fillDocxTemplate(templateBytes, data);
  for (const tag of filled.missingTags) {
    warnings.push(`[warning] unresolved-placeholder: {{${tag}}} rendered blank.`);
  }

  // HTML preview so the vault document renders in the existing editor.
  let previewHtml = '';
  try {
    const converted = await mammoth.convertToHtml({ buffer: filled.buffer });
    previewHtml = converted.value;
  } catch (convErr) {
    console.warn(`[docxPackageFill] mammoth preview failed for ${docType}:`, convErr);
  }

  const spouseSuffix = params.spouseRole === 'spouse' ? '_spouse' : '';
  const documentId = `${docType}${spouseSuffix}`;
  const displayName =
    `${getDocTypeDisplayName(docType)} of ${ctx.computed.clientFullName}`;

  const saveResult = await saveDocumentToVault({
    firmId,
    clientId,
    docType,
    displayName,
    content:
      previewHtml ||
      '<p>[Binary .docx document — preview conversion unavailable. Download the file to review.]</p>',
    binaryBuffer: filled.buffer,
    status: 'draft',
    createdBy,
    documentId,
    generationMode: 'high-fidelity',
    triggerSource: 'batch',
    warnings: warnings.length > 0 ? warnings : undefined,
    changeNotes: `High-fidelity fill from ${mapping.templateFileName ?? mapping.templateStoragePath}`,
  });

  return {
    docType,
    title: displayName,
    content: previewHtml,
    status: 'draft',
    docId: saveResult.docId,
    isNew: saveResult.isNew,
    currentVersion: saveResult.currentVersion,
    storagePath: saveResult.storagePath,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
