/**
 * functions-backfill/src/client-email-lowercase.ts
 *
 * One-time backfill: lowercase `personalInfo.email` on every client record
 * in a firm. registerClientFromLink and linkClient match clients by comparing
 * against lowercase emails (the auth token's email is always lowercase), so
 * records saved with mixed-case emails (e.g. via early bulk imports) never
 * matched and caused duplicate empty prospect records.
 *
 * Invoke from the app's browser console (window.__firebase is exposed):
 *
 *   const fn = httpsCallable(window.__firebase.functions, 'backfillClientEmailLowercase');
 *   await fn({ firmId: 'elias-counsel', dryRun: true });   // preview
 *   await fn({ firmId: 'elias-counsel' });                 // apply
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

const COMMIT_BATCH_SIZE = 400;

export const backfillClientEmailLowercase = onCall(
  { region: 'us-east1', timeoutSeconds: 300 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    const role = request.auth.token.role as string | undefined;
    if (role !== 'admin' && role !== 'attorney') {
      throw new HttpsError('permission-denied', 'Admin or attorney role required.');
    }

    const { firmId, dryRun } = request.data as { firmId?: string; dryRun?: boolean };
    if (!firmId) {
      throw new HttpsError('invalid-argument', 'firmId is required.');
    }
    if (request.auth.token.firmId !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot backfill a different firm.');
    }

    const db = admin.firestore();
    const snap = await db
      .collection(`firms/${firmId}/clients`)
      .select('personalInfo.email')
      .get();

    const changes: { clientId: string; from: string; to: string }[] = [];
    let batch = db.batch();
    let pending = 0;

    for (const docSnap of snap.docs) {
      const email = docSnap.get('personalInfo.email');
      if (typeof email !== 'string') continue;
      const lower = email.trim().toLowerCase();
      if (lower === email) continue;

      changes.push({ clientId: docSnap.id, from: email, to: lower });
      if (!dryRun) {
        batch.update(docSnap.ref, {
          'personalInfo.email': lower,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        pending++;
        if (pending === COMMIT_BATCH_SIZE) {
          await batch.commit();
          batch = db.batch();
          pending = 0;
        }
      }
    }
    if (pending > 0) {
      await batch.commit();
    }

    logger.info('[backfillClientEmailLowercase] Done', {
      firmId,
      scanned: snap.size,
      changed: changes.length,
      dryRun: !!dryRun,
    });

    return { scanned: snap.size, changed: changes.length, dryRun: !!dryRun, changes };
  },
);
