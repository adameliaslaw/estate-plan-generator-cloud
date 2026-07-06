/**
 * functions/src/delete-client.ts
 *
 * Permanently delete a client and ALL of its data.
 *
 * Why a callable (audit finding R5-020): the client SDK's `deleteDoc` removes
 * only the client document — its subcollections (documents, notes, payments,
 * versions, activityLogs, …) and Storage files are left orphaned. The
 * orphaned documents still match the dashboard's firm-wide
 * `collectionGroup('documents')` query (inflating "Awaiting Review" analytics)
 * and privileged legal content the attorney believes was deleted stays stored
 * and readable. Only the Admin SDK can cascade (`recursiveDelete`) and sweep
 * Storage, so deletion must go through this callable.
 */

import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { assertFirmStaff } from './auth-guards';

interface DeleteClientRequest {
  firmId?: string;
  clientId?: string;
}

export const deleteClient = onCall(
  { region: 'us-east1', memory: '512MiB', invoker: 'public' },
  async (request: CallableRequest<DeleteClientRequest>) => {
    const { firmId, clientId } = request.data ?? {};
    if (!firmId || !clientId) {
      throw new HttpsError('invalid-argument', 'firmId and clientId are required.');
    }
    // Staff role + tenant boundary. A `client`-role session carries a real
    // firmId claim, so firm-scoping alone is not enough (audit theme T6).
    assertFirmStaff(request, firmId);

    const db = admin.firestore();
    const clientRef = db
      .collection('firms').doc(firmId)
      .collection('clients').doc(clientId);

    const snap = await clientRef.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Client not found.');
    }

    // 1. Cascade-delete the client document + every subcollection. The client
    //    SDK cannot do this; a plain deleteDoc would orphan the subcollections
    //    (R5-020).
    await db.recursiveDelete(clientRef);

    // 2. Sweep the client's Storage tree (generated PDFs/DOCX, signed docs,
    //    scans, uploads) — recursiveDelete only covers Firestore. Best-effort:
    //    Firestore is already gone, so a Storage failure must not fail the op;
    //    `force` continues past per-file errors and we log the prefix for any
    //    manual cleanup.
    const prefix = `firms/${firmId}/clients/${clientId}/`;
    try {
      await admin.storage().bucket().deleteFiles({ prefix, force: true });
    } catch (storageErr) {
      console.error(`[deleteClient] Storage sweep failed for ${prefix}:`, storageErr);
    }

    console.log(`[deleteClient] Deleted client ${clientId} (firm ${firmId}) + subtree.`);
    return { success: true, clientId };
  },
);
