/**
 * addMyClause / removeClause — Clause Picker writes for the closed catalog.
 *
 * The clause catalog is closed to client SDK writes (#222 sign-off), so
 * attorney-authored clauses are created here, firm-scoped and stamped
 * origin: 'manual'. Manual entries never mix into mined-family state:
 * they carry no switchName, counts, or identity fields, so pipeline
 * re-runs and the review queue ignore them.
 *
 * removeClause deletes from the library (Adam's decision 2026-08-02:
 * curate by deletion in day-to-day use instead of a labeled calibration
 * pass). Manual entries are hard-deleted — they exist nowhere else.
 * Mined entries are TOMBSTONED (status: 'removed'), never hard-deleted:
 * the catalog stage re-writes every family on a re-run and preserves
 * 'removed' status, so a tombstone is what makes the deletion durable;
 * variants/occurrences provenance stays intact underneath it.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { assertFirmStaff } from './auth-guards';

const RequestSchema = z
  .object({
    firmId: z.string().min(1).max(200),
    title: z.string().min(1).max(200),
    text: z.string().min(1).max(20000),
    category: z.string().min(1).max(100).optional(),
    state: z
      .string()
      .regex(/^[A-Z]{2}$/, 'state must be a two-letter code')
      .optional(),
  })
  .strict();

export const addMyClause = onCall(
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request) => {
    const parsed = RequestSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const { firmId, title, text, category, state } = parsed.data;
    const caller = assertFirmStaff(request, firmId);

    const ref = await getFirestore()
      .collection(`firms/${firmId}/clauseCatalog`)
      .add({
        origin: 'manual',
        title,
        canonicalText: text,
        ...(category !== undefined ? { category } : {}),
        ...(state !== undefined ? { state } : {}),
        status: 'approved',
        createdBy: caller.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    return { clauseId: ref.id };
  },
);

const RemoveRequestSchema = z
  .object({
    firmId: z.string().min(1).max(200),
    clauseId: z.string().min(1).max(200),
  })
  .strict();

export const removeClause = onCall(
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request) => {
    const parsed = RemoveRequestSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const { firmId, clauseId } = parsed.data;
    const caller = assertFirmStaff(request, firmId);

    const ref = getFirestore().doc(`firms/${firmId}/clauseCatalog/${clauseId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Clause not found.');
    }

    if (snap.get('origin') === 'manual') {
      await ref.delete();
      return { removed: 'deleted' as const };
    }
    await ref.update({
      status: 'removed',
      removedBy: caller.uid,
      removedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { removed: 'tombstoned' as const };
  },
);
