/**
 * Clause Picker callables for the closed catalog: listClauseCatalog,
 * addMyClause, removeClause, approveAllClauses.
 *
 * The clause catalog is closed to client SDK writes (#222 sign-off), so
 * attorney-authored clauses are created here, firm-scoped and stamped
 * origin: 'manual'. Manual entries never mix into mined-family state:
 * they carry no switchName, counts, or identity fields, so pipeline
 * re-runs and the review queue ignore them.
 *
 * All four callables resolve the caller's firm through the mining-firm
 * bridge (resolveCatalogFirm): the mined catalog is keyed under the
 * pipeline's firm id ('firm-001') while live auth claims carry
 * 'elias-counsel', and Firestore rules stay firm-scoped — so reads moved
 * server-side too (listClauseCatalog) instead of loosening rules.
 *
 * removeClause deletes from the library (Adam's decision 2026-08-02:
 * curate by deletion in day-to-day use instead of a labeled calibration
 * pass). Manual entries are hard-deleted — they exist nowhere else.
 * Mined entries are TOMBSTONED (status: 'removed'), never hard-deleted:
 * the catalog stage re-writes every family on a re-run and preserves
 * 'removed' status, so a tombstone is what makes the deletion durable;
 * variants/occurrences provenance stays intact underneath it.
 *
 * approveAllClauses is the other half of that decision (Adam, 2026-08-05:
 * "approve them all and then I would later remove any as I went along"):
 * one call flips every clean mined clause to 'approved'. It never touches
 * tombstones (a re-approve must not resurrect a deletion) and never
 * approves PII-blocked entries (they carry no text to draft with).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { assertFirmStaff } from './auth-guards';
import { resolveCatalogFirm } from './mining-firm';

/**
 * Tenant boundary (caller's claim must match the requested firmId — unchanged
 * from assertFirmStaff), then bridge to the firm whose catalog it maps to.
 */
function assertCatalogStaff(
  request: CallableRequest<unknown>,
  firmId: string,
): { uid: string; catalogFirmId: string } {
  const caller = assertFirmStaff(request, firmId);
  return { uid: caller.uid, catalogFirmId: resolveCatalogFirm(firmId) };
}

const FirmSchema = z.object({ firmId: z.string().min(1).max(200) }).strict();

/** The catalog-doc fields the picker renders — nothing else leaves the server. */
const ENTRY_FIELDS = [
  'title',
  'functionSummary',
  'category',
  'canonicalText',
  'status',
  'origin',
  'createdBy',
  'state',
  'counts',
  'piiScanStatus',
] as const;

export const listClauseCatalog = onCall(
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request) => {
    const parsed = FirmSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const { catalogFirmId } = assertCatalogStaff(request, parsed.data.firmId);

    const snap = await getFirestore().collection(`firms/${catalogFirmId}/clauseCatalog`).get();
    const entries: Record<string, unknown>[] = [];
    let pendingMined = 0;
    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.status === 'removed') continue;
      if (data.piiScanStatus === 'blocked') continue;
      if (data.origin !== 'manual' && data.status === 'mined') pendingMined++;
      const entry: Record<string, unknown> = { id: doc.id };
      for (const field of ENTRY_FIELDS) {
        if (data[field] !== undefined) entry[field] = data[field];
      }
      entries.push(entry);
    }
    return { entries, pendingMined };
  },
);

export const approveAllClauses = onCall(
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request) => {
    const parsed = FirmSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const { uid, catalogFirmId } = assertCatalogStaff(request, parsed.data.firmId);

    const db = getFirestore();
    const snap = await db
      .collection(`firms/${catalogFirmId}/clauseCatalog`)
      .where('status', '==', 'mined')
      .get();

    let approved = 0;
    let skippedBlocked = 0;
    let batch = db.batch();
    let inBatch = 0;
    for (const doc of snap.docs) {
      if (doc.get('piiScanStatus') === 'blocked') {
        skippedBlocked++;
        continue;
      }
      batch.update(doc.ref, {
        status: 'approved',
        approvedBy: uid,
        approvedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      approved++;
      inBatch++;
      if (inBatch === 400) {
        await batch.commit();
        batch = db.batch();
        inBatch = 0;
      }
    }
    if (inBatch > 0) await batch.commit();
    return { approved, skippedBlocked };
  },
);

const AddRequestSchema = z
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
    const parsed = AddRequestSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const { firmId, title, text, category, state } = parsed.data;
    const { uid, catalogFirmId } = assertCatalogStaff(request, firmId);

    const ref = await getFirestore()
      .collection(`firms/${catalogFirmId}/clauseCatalog`)
      .add({
        origin: 'manual',
        title,
        canonicalText: text,
        ...(category !== undefined ? { category } : {}),
        ...(state !== undefined ? { state } : {}),
        status: 'approved',
        createdBy: uid,
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
    const { uid, catalogFirmId } = assertCatalogStaff(request, firmId);

    const ref = getFirestore().doc(`firms/${catalogFirmId}/clauseCatalog/${clauseId}`);
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
      removedBy: uid,
      removedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { removed: 'tombstoned' as const };
  },
);
