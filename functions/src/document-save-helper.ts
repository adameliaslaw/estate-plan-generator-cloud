/**
 * functions/src/document-save-helper.ts
 *
 * Shared helper for saving AI-generated documents to the Firestore vault.
 * Used by the unified generator to ensure consistent document schema,
 * versioning, and audit trails across all generation paths.
 *
 * Version history:
 *   - Each save snapshots the FULL previous content into a `versions`
 *     subcollection before overwriting the main document.
 *   - Attorneys can view any prior version and revert to it.
 */

import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SaveDocumentParams {
  firmId: string;
  clientId: string;
  docType: string;
  displayName: string;
  content: string;
  status: 'draft' | 'review' | 'error' | 'incomplete' | 'needs_review';
  createdBy: string;
  /** AI model used for generation */
  aiModel?: string;
  /** Tags to apply to the document */
  tags?: string[];
  /** Version change notes */
  changeNotes?: string;
  /** Generation pipeline mode: how the AI/template was invoked. Persisted
   *  for audit trail so future fidelity reports can answer "why does this
   *  doc not match the template?" without re-running. */
  generationMode?: 'template' | 'hybrid' | 'ai' | 'flex';
  /** Where the call originated from (UI surface): batch, single, chat-draft,
   *  flex, etc. Distinct from generationMode — a single-doc batch may still
   *  be generated in 'hybrid' mode. */
  triggerSource?: 'batch' | 'single' | 'chat-draft' | 'flex' | 'retemplatize';
  /** ID of the template used (if any). null when generationMode='ai' or
   *  no template was matched. */
  templateId?: string | null;
  /** Which Firestore collection the template was resolved from. */
  templateSourceCollection?: 'documentTemplates' | 'knowledgeBase' | 'legacyTemplates' | null;
  /** Software source filter applied at resolution time (e.g. 'InteractiveLegal'). */
  softwareSource?: string | null;
  /**
   * If provided, use this ID (deterministic). Otherwise auto-generate.
   * Deterministic IDs allow re-generation to replace the old draft.
   */
  documentId?: string;
  /** For per-property docs (deeds, affidavits, etc.) */
  propertyAddress?: string;
  /** Completeness warnings — which required data fields are missing */
  warnings?: string[];
  /** Structural validation findings from post-generation checks */
  validationFindings?: Array<{ name: string; severity: 'error' | 'warning' }>;
  /** Short hash identifying the prompt version used for generation */
  promptVersion?: string;
  /** Pre-enhancement template HTML for side-by-side comparison (hybrid mode only) */
  templateBaseline?: string;
  /** Binary version of the document (.docx fallback path). */
  binaryBuffer?: Buffer;
  /** AI-extracted structured data (for debugging and review) */
  extractedData?: Record<string, unknown>;
}

export interface SaveDocumentResult {
  docId: string;
  isNew: boolean;
  currentVersion: number;
  storagePath?: string;
}

// ---------------------------------------------------------------------------
// Metadata helpers
// ---------------------------------------------------------------------------

const SIGNATURE_REQUIRED_TYPES = new Set([
  'will', 'pourOverWill', 'poa', 'livingWill', 'trust', 'deed',
]);

const NOTARIZATION_REQUIRED_TYPES = new Set([
  'poa', 'deed', 'affidavitOfConsideration', 'gitRep3',
]);

export function requiresSignature(docType: string): boolean {
  return SIGNATURE_REQUIRED_TYPES.has(docType);
}

export function requiresNotarization(docType: string): boolean {
  return NOTARIZATION_REQUIRED_TYPES.has(docType);
}

// ---------------------------------------------------------------------------
// Main save function
// ---------------------------------------------------------------------------

/**
 * Save a generated document to the client's vault in Firestore.
 *
 * Handles:
 * - Deterministic or auto-generated document IDs
 * - Version management (increment if existing, create v1 if new)
 * - Full content snapshots for version history (revert support)
 * - Consistent field schema across all generation paths
 * - Property-specific tagging for per-property documents
 */
export async function saveDocumentToVault(
  params: SaveDocumentParams,
): Promise<SaveDocumentResult> {
  // ── Content validation gate ────────────────────────────────────────────
  // Never save a document with empty/blank content — this is the #1 cause
  // of blank documents appearing in the vault. Error-status docs are
  // allowed to have minimal content (they're informational).
  if (params.status !== 'error' && !params.binaryBuffer) {
    const textOnly = (params.content ?? '').replace(/<[^>]*>/g, '').trim();
    if (textOnly.length === 0) {
      throw new Error(
        `[saveDocumentToVault] Refusing to save ${params.docType} with empty content. ` +
        `firmId=${params.firmId}, clientId=${params.clientId}. ` +
        `This usually means AI generation failed or returned malformed JSON.`,
      );
    }
  }

  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const docId = params.documentId ?? `${params.docType}_chat_${Date.now()}`;

  const docRef = db
    .collection('firms').doc(params.firmId)
    .collection('clients').doc(params.clientId)
    .collection('documents').doc(docId);

  const existing = await docRef.get();
  const currentVersion: number = existing.exists
    ? ((existing.data()?.currentVersion as number) ?? 0) + 1
    : 1;

  const changeNotes = params.changeNotes
    ?? (existing.exists ? 'AI regeneration' : 'Initial AI generation');

  // ── Snapshot prior version content before overwriting ──────────────────
  if (existing.exists) {
    const prevData = existing.data()!;
    const prevVersion = (prevData.currentVersion as number) ?? 0;

    // Save the FULL prior content into a versions subcollection
    const versionRef = docRef.collection('versions').doc(`v${prevVersion}`);
    await versionRef.set({
      versionNumber: prevVersion,
      content: prevData.content ?? '',
      displayName: prevData.displayName ?? '',
      status: prevData.status ?? 'draft',
      createdAt: prevData.updatedAt ?? prevData.createdAt ?? admin.firestore.Timestamp.now(),
      createdBy: prevData.updatedBy ?? prevData.createdBy ?? 'system',
      changeNotes: prevData.changeNotes ?? 'No notes',
      aiModel: prevData.aiModel ?? '',
      docType: prevData.docType ?? params.docType,
    });
  }

  // ── Build the document data ───────────────────────────────────────────
  const baseTags = params.tags ?? [];
  const allTags = params.propertyAddress
    ? [...baseTags, `property:${params.propertyAddress}`]
    : baseTags;

  const docData: Record<string, unknown> = {
    id: docId,
    firmId: params.firmId,
    clientId: params.clientId,
    docType: params.docType,
    displayName: params.displayName,
    status: params.status ?? 'draft',
    content: params.content,
    // DocumentEditor.tsx prefers `editorContent` over `content` when it has
    // any text — so leaving the old editor copy in place would silently strand
    // the user on the previous generation after every regenerate. Sync them
    // on save: the version subcollection retains the prior content for recovery.
    editorContent: params.content,
    storagePath: '',
    fileName: `${docId}.html`,
    mimeType: 'text/html',
    currentVersion,
    generatedByAI: true,
    aiModel: params.aiModel ?? 'unknown',
    requiresSignature: requiresSignature(params.docType),
    // `notarized` means "has been notarized" (it sits with notarizedAt/notaryName
    // in the Document type). A freshly generated draft has NOT been notarized, so
    // it must be false — writing the requiresNotarization() *requirement* here
    // falsely marked every notarization-required draft as already notarized
    // (R5-031). The requirement is a doc-type property (requiresNotarization),
    // not a completion state.
    notarized: false,
    changeNotes,
    tags: existing.exists
      ? (allTags.length > 0 ? admin.firestore.FieldValue.arrayUnion(...allTags) : (existing.data()?.tags ?? []))
      : allTags,
    isConfidential: true,
    updatedAt: now,
    updatedBy: params.createdBy,
  };

  // Persist quality signals when present
  if (params.warnings && params.warnings.length > 0) {
    docData.warnings = params.warnings;
  }
  if (params.validationFindings && params.validationFindings.length > 0) {
    docData.validationFindings = params.validationFindings;
  }
  if (params.promptVersion) {
    docData.promptVersion = params.promptVersion;
  }
  if (params.templateBaseline) {
    docData.templateBaseline = params.templateBaseline;
  }
  // Generation provenance — surface real values so audit queries can answer
  // "what produced this document?" without replaying the call.
  if (params.generationMode !== undefined) {
    docData.generationMode = params.generationMode;
  }
  if (params.triggerSource !== undefined) {
    docData.triggerSource = params.triggerSource;
  }
  if (params.templateId !== undefined) {
    docData.templateId = params.templateId;
  }
  if (params.templateSourceCollection !== undefined) {
    docData.templateSourceCollection = params.templateSourceCollection;
  }
  if (params.softwareSource !== undefined) {
    docData.softwareSource = params.softwareSource;
  }
  if (params.binaryBuffer) {
    docData.hasBinary = true;
    docData.mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    docData.fileName = `${docId}.docx`;
  }
  if (params.extractedData) {
    docData.extractedData = params.extractedData;
  }

  // ── Handle Binary Storage Upload ─────────────────────────────────────
  let finalStoragePath = '';
  if (params.binaryBuffer) {
    finalStoragePath = `firms/${params.firmId}/clients/${params.clientId}/documents/${docId}.docx`;
    console.log(`[saveDocumentToVault] Uploading binary buffer to ${finalStoragePath}...`);
    
    const bucket = admin.storage().bucket();
    const file = bucket.file(finalStoragePath);
    
    await file.save(params.binaryBuffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      metadata: {
        firmId: params.firmId,
        clientId: params.clientId,
        docId,
        aiModel: params.aiModel ?? 'unknown',
        generatedAt: new Date().toISOString(),
      },
    });
    
    docData.storagePath = finalStoragePath;
  }

  // Version summary on the main document (lightweight — no content)
  const versionEntry = {
    versionNumber: currentVersion,
    createdAt: admin.firestore.Timestamp.now(),
    createdBy: params.createdBy,
    changeNotes,
  };

  if (existing.exists) {
    docData.versions = admin.firestore.FieldValue.arrayUnion(versionEntry);
    // Clear stale quality flags on regeneration: update() preserves fields not
    // present in docData, so a clean re-run (no findings/warnings) would leave
    // an earlier run's flags lingering forever. Delete them when this run has none.
    if (!('validationFindings' in docData)) {
      docData.validationFindings = admin.firestore.FieldValue.delete();
    }
    if (!('warnings' in docData)) {
      docData.warnings = admin.firestore.FieldValue.delete();
    }
    await docRef.update(docData);
  } else {
    docData.versions = [versionEntry];
    docData.createdAt = now;
    docData.createdBy = params.createdBy;
    await docRef.set(docData);
  }

  return {
    docId,
    isNew: !existing.exists,
    currentVersion,
    storagePath: finalStoragePath || undefined,
  };
}

// ---------------------------------------------------------------------------
// Version history retrieval
// ---------------------------------------------------------------------------

export interface VersionSnapshot {
  versionNumber: number;
  content: string;
  displayName: string;
  status: string;
  createdAt: admin.firestore.Timestamp;
  createdBy: string;
  changeNotes: string;
}

/**
 * Get all version snapshots for a document, ordered by version number descending.
 */
export async function getVersionHistory(
  firmId: string,
  clientId: string,
  documentId: string,
): Promise<VersionSnapshot[]> {
  const db = admin.firestore();
  const versionsSnap = await db
    .collection('firms').doc(firmId)
    .collection('clients').doc(clientId)
    .collection('documents').doc(documentId)
    .collection('versions')
    .orderBy('versionNumber', 'desc')
    .get();

  return versionsSnap.docs.map((d) => {
    const data = d.data();
    return {
      versionNumber: data.versionNumber,
      content: data.content,
      displayName: data.displayName,
      status: data.status,
      createdAt: data.createdAt,
      createdBy: data.createdBy,
      changeNotes: data.changeNotes,
    };
  });
}

/**
 * Revert a document to a specific prior version.
 * The current content is snapshotted first (so revert is itself reversible).
 */
export async function revertToVersion(
  firmId: string,
  clientId: string,
  documentId: string,
  targetVersion: number,
  revertedBy: string,
): Promise<SaveDocumentResult> {
  const db = admin.firestore();
  const docRef = db
    .collection('firms').doc(firmId)
    .collection('clients').doc(clientId)
    .collection('documents').doc(documentId);

  // Fetch the target version snapshot
  const versionSnap = await docRef
    .collection('versions')
    .doc(`v${targetVersion}`)
    .get();

  if (!versionSnap.exists) {
    throw new Error(`Version ${targetVersion} not found for document ${documentId}.`);
  }

  const versionData = versionSnap.data()!;

  // Save current content as a new version snapshot before reverting
  // (so the revert itself can be undone)
  return saveDocumentToVault({
    firmId,
    clientId,
    docType: versionData.docType,
    displayName: versionData.displayName,
    content: versionData.content,
    status: 'draft',
    createdBy: revertedBy,
    changeNotes: `Reverted to version ${targetVersion}`,
    documentId,
  });
}
