/**
 * functions/src/document-save-helper.ts
 *
 * Shared helper for saving AI-generated documents to the Firestore vault.
 * Used by both generate-documents.ts (batch generation) and chat-ai.ts
 * (chat draft mode) to ensure consistent document schema across all
 * generation paths.
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
  status: 'draft' | 'error';
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
 * - Consistent field schema across all generation paths
 * - Property-specific tagging for per-property documents
 */
export async function saveDocumentToVault(
  params: SaveDocumentParams,
): Promise<SaveDocumentResult> {
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
    aiModel: params.aiModel ?? 'gpt-5.4',
    requiresSignature: requiresSignature(params.docType),
    notarized: requiresNotarization(params.docType),
    tags: existing.exists
      ? admin.firestore.FieldValue.arrayUnion(...allTags)
      : allTags,
    isConfidential: true,
    updatedAt: now,
    updatedBy: params.createdBy,
  };

  // Version history
  const versionEntry = {
    versionNumber: currentVersion,
    storagePath: '',
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
