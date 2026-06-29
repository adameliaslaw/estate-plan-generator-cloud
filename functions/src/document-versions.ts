/**
 * functions/src/document-versions.ts
 *
 * Cloud Functions for document version management:
 *   - getDocumentVersions: retrieve version history with content
 *   - revertDocumentVersion: restore a prior version (current is snapshotted first)
 */

import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { getVersionHistory, revertToVersion } from './document-save-helper';
import { assertStaff } from './auth-guards';

// ---------------------------------------------------------------------------
// Get version history
// ---------------------------------------------------------------------------

export const getDocumentVersions = onCall(
  { timeoutSeconds: 30, memory: '512MiB', region: 'us-east1' },
  async (request: CallableRequest<unknown>) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Login required.');
    assertStaff(request);

    const { firmId, clientId, documentId } = request.data as {
      firmId: string;
      clientId: string;
      documentId: string;
    };

    if (!firmId || !clientId || !documentId) {
      throw new HttpsError('invalid-argument', 'firmId, clientId, and documentId are required.');
    }

    if ((auth.token.firmId as string | undefined) !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot access document versions for a different firm.');
    }

    const versions = await getVersionHistory(firmId, clientId, documentId);

    return {
      success: true,
      documentId,
      versions: versions.map((v) => ({
        versionNumber: v.versionNumber,
        displayName: v.displayName,
        status: v.status,
        changeNotes: v.changeNotes,
        createdBy: v.createdBy,
        createdAt: v.createdAt?.toDate?.()?.toISOString() ?? null,
        // Content included so attorney can preview before reverting
        contentPreview: v.content?.slice(0, 500) ?? '',
        hasFullContent: (v.content?.length ?? 0) > 0,
      })),
    };
  },
);

// ---------------------------------------------------------------------------
// Get full content for a specific version
// ---------------------------------------------------------------------------

export const getDocumentVersionContent = onCall(
  { timeoutSeconds: 30, memory: '512MiB', region: 'us-east1' },
  async (request: CallableRequest<unknown>) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Login required.');
    assertStaff(request);

    const { firmId, clientId, documentId, versionNumber } = request.data as {
      firmId: string;
      clientId: string;
      documentId: string;
      versionNumber: number;
    };

    if (!firmId || !clientId || !documentId || versionNumber === undefined) {
      throw new HttpsError('invalid-argument', 'firmId, clientId, documentId, and versionNumber are required.');
    }

    if ((auth.token.firmId as string | undefined) !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot access document versions for a different firm.');
    }

    // Fetch only the requested version doc directly (id = `v{versionNumber}`,
    // matching the write in document-save-helper). Avoids loading the entire
    // version history into memory just to return one snapshot.
    const snap = await admin.firestore()
      .collection('firms').doc(firmId)
      .collection('clients').doc(clientId)
      .collection('documents').doc(documentId)
      .collection('versions').doc(`v${versionNumber}`)
      .get();

    if (!snap.exists) {
      throw new HttpsError('not-found', `Version ${versionNumber} not found.`);
    }

    const data = snap.data()!;
    return {
      success: true,
      versionNumber: data.versionNumber,
      content: data.content ?? '',
      displayName: data.displayName ?? '',
      status: data.status ?? 'draft',
      changeNotes: data.changeNotes ?? '',
      createdBy: data.createdBy ?? '',
      createdAt: data.createdAt?.toDate?.()?.toISOString() ?? null,
    };
  },
);

// ---------------------------------------------------------------------------
// Revert to a prior version
// ---------------------------------------------------------------------------

export const revertDocumentVersion = onCall(
  { timeoutSeconds: 60, memory: '512MiB', region: 'us-east1' },
  async (request: CallableRequest<unknown>) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Login required.');

    const role = auth.token.role as string | undefined;
    if (!role || !['admin', 'attorney', 'paralegal'].includes(role)) {
      throw new HttpsError('permission-denied', 'Only staff members can revert documents.');
    }

    const { firmId, clientId, documentId, targetVersion } = request.data as {
      firmId: string;
      clientId: string;
      documentId: string;
      targetVersion: number;
    };

    if (!firmId || !clientId || !documentId || !targetVersion) {
      throw new HttpsError('invalid-argument', 'firmId, clientId, documentId, and targetVersion are required.');
    }

    if ((auth.token.firmId as string | undefined) !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot revert document versions for a different firm.');
    }

    try {
      const result = await revertToVersion(firmId, clientId, documentId, targetVersion, auth.uid);

      return {
        success: true,
        documentId: result.docId,
        restoredVersion: targetVersion,
        newVersion: result.currentVersion,
        message: `Reverted to version ${targetVersion}. Current content saved as version ${result.currentVersion - 1}.`,
      };
    } catch (error) {
      throw new HttpsError(
        'internal',
        `Revert failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  },
);
