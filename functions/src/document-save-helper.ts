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
  status: 'draft' | 'review' | 'error';
  createdBy: string;
  /** AI model used for generation */
  aiModel?: string;
  /** Tags to apply to the document */
  tags?: string[];
  /** Version change notes */
  changeNotes?: string;
  /** How this doc was generated */
  generationMode?: 'batch' | 'chat-draft';
  /**
   * If provided, use this ID (deterministic). Otherwise auto-generate.
   * Deterministic IDs allow re-generation to replace the old draft.
   */
  documentId?: string;
  /** For per-property docs (deeds, affidavits, etc.) */
  propertyAddress?: string;
}

export interface SaveDocumentResult {
  docId: string;
  isNew: boolean;
  currentVersion: number;
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
  if (params.status !== 'error') {
    const textOnly = (params.content ?? '').replace(/<[^>]*>/g, '').trim();
    if (textOnly.length === 0) {
      throw new Error(
        `[saveDocumentToVault] Refusing to save ${params.docType} with empty content. ` +
        `firmId=${params.firmId}, clientId=${params.clientId}. ` +
        `This usually means AI generation failed or returned malformed JSON.`,
      );
    }
    if (textOnly.length < 100) {
      console.warn(
        `[saveDocumentToVault] Suspiciously short content for ${params.docType} ` +
        `(${textOnly.length} chars). firmId=${params.firmId}, clientId=${params.clientId}.`,
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
    status: 'draft',
    content: params.content,
    storagePath: '',
    fileName: `${docId}.html`,
    mimeType: 'text/html',
    currentVersion,
    generatedByAI: true,
    aiModel: params.aiModel ?? 'unknown',
    requiresSignature: requiresSignature(params.docType),
    notarized: requiresNotarization(params.docType),
    changeNotes,
    tags: existing.exists
      ? (allTags.length > 0 ? admin.firestore.FieldValue.arrayUnion(...allTags) : (existing.data()?.tags ?? []))
      : allTags,
    isConfidential: true,
    updatedAt: now,
    updatedBy: params.createdBy,
  };

  // Version summary on the main document (lightweight — no content)
  const versionEntry = {
    versionNumber: currentVersion,
    createdAt: admin.firestore.Timestamp.now(),
    createdBy: params.createdBy,
    changeNotes,
  };

  if (existing.exists) {
    docData.versions = admin.firestore.FieldValue.arrayUnion(versionEntry);
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
