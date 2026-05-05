/**
 * functions/src/backfill-pageindex-firmid.ts
 *
 * One-time admin callable to identify and patch pageindex_docs documents
 * that were ingested before the firmId field was added (commit 1d8f16e).
 *
 * Documents at pageindex_docs/{namespace}/files/{docId} that lack a firmId
 * field are now invisible to RAG queries, which filter by firmId. This
 * function lets an admin discover and reassign them.
 *
 * Usage:
 *   dryRun:  { dryRun: true }
 *     → Returns a list of orphaned docs per namespace. No writes.
 *   patch:   { firmId: "elias-counsel" }
 *     → Stamps the given firmId onto every orphaned doc across all namespaces.
 *   scoped:  { firmId: "elias-counsel", namespace: "client-files" }
 *     → Same, but restricted to one namespace.
 */

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

const VALID_NAMESPACES = ['reference', 'work-product', 'client-files'] as const;

interface BackfillRequest {
  dryRun?: boolean;
  firmId?: string;
  namespace?: string;
}

interface OrphanedDoc {
  namespace: string;
  docId: string;
  fileName?: string;
}

export const backfillPageIndexFirmId = functions
  .region('us-east1')
  .https.onCall(async (data: BackfillRequest, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
    }

    const role = context.auth.token['role'] as string | undefined;
    if (role !== 'admin') {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Only admins may run the pageindex firmId backfill.',
      );
    }

    const dryRun = data?.dryRun === true;
    const targetFirmId = data?.firmId as string | undefined;
    const targetNamespace = data?.namespace as string | undefined;

    if (!dryRun && !targetFirmId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'firmId is required when dryRun is false.',
      );
    }

    if (targetNamespace && !VALID_NAMESPACES.includes(targetNamespace as typeof VALID_NAMESPACES[number])) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `namespace must be one of: ${VALID_NAMESPACES.join(', ')}`,
      );
    }

    const db = admin.firestore();
    const namespacesToScan = targetNamespace ? [targetNamespace] : [...VALID_NAMESPACES];

    const orphaned: OrphanedDoc[] = [];

    for (const ns of namespacesToScan) {
      const snap = await db.collection(`pageindex_docs/${ns}/files`).get();
      for (const doc of snap.docs) {
        const d = doc.data();
        if (!d.firmId) {
          orphaned.push({ namespace: ns, docId: doc.id, fileName: d.fileName ?? d.file_name });
        }
      }
    }

    if (dryRun) {
      return {
        dryRun: true,
        orphanedCount: orphaned.length,
        orphaned,
      };
    }

    // Patch each orphaned doc with the specified firmId
    const BATCH_SIZE = 500;
    let patched = 0;
    for (let i = 0; i < orphaned.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const chunk = orphaned.slice(i, i + BATCH_SIZE);
      for (const { namespace, docId } of chunk) {
        const ref = db.doc(`pageindex_docs/${namespace}/files/${docId}`);
        batch.update(ref, { firmId: targetFirmId });
        patched++;
      }
      await batch.commit();
    }

    console.log(`[backfillPageIndexFirmId] Patched ${patched} docs with firmId=${targetFirmId}`);
    return {
      dryRun: false,
      patchedCount: patched,
      firmId: targetFirmId,
    };
  });
