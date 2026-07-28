/**
 * functions/src/inheritance-tax-store.ts
 *
 * Firestore persistence for NJ inheritance-tax matters, plus the HMAC audit chain.
 *
 * ── Why this is not a port ───────────────────────────────────────────────────
 * The source application (elias-estate-suite `apps/inherit`) has a Firestore adapter, but it
 * loads every record into memory at startup, serves reads from that cache, and writes behind —
 * which is why its own docs require `--max-instances=1`. Cloud Functions scale horizontally and
 * recycle instances constantly, so that design would produce stale reads and lost writes here.
 * This module keeps the *guarantees* and drops the plumbing: every read hits Firestore, every
 * write is awaited, and the audit chain is appended inside a transaction.
 *
 * ── Layout (firm-scoped, matching this repo's RBAC hierarchy) ────────────────
 *   /firms/{firmId}/inheritanceMatters/{matterId}
 *   /firms/{firmId}/inheritanceMatters/{matterId}/computations/{computationId}
 *   /firms/{firmId}/inheritanceMatters/{matterId}/checkpoints/{checkpointId}
 *   /firms/{firmId}/inheritanceMatters/{matterId}/audit/{entryId}
 *
 * ── Records are stored as a canonical JSON string ────────────────────────────
 * Each document holds `{ json: "<record>" }` rather than structured fields. This is
 * load-bearing, not laziness: the audit chain is verified by re-serialising each entry, so
 * field order and exact structure must survive the round trip. Firestore gives no key-order
 * guarantee on structured reads, and rejects `undefined` and nested arrays. A JSON string
 * sidesteps all three. Queryable fields (firmId, matterId, status, seq) are mirrored alongside.
 *
 * ── The chain ────────────────────────────────────────────────────────────────
 * entry.hash = HMAC-SHA256(auditKey, previousHash + canonicalJSON(body)), where body has a
 * fixed field order and SSNs are masked before storage. The first entry chains from 64 zeros.
 * FND-AUDITSIG: an unsigned chain is recomputable by anyone who can read it, so a missing key
 * fails closed rather than silently degrading to a plain SHA-256.
 */
import { createHmac, randomUUID } from 'crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type {
  AuditEntry,
  AuditAction,
  EstateComputation,
  Matter,
  ReviewCheckpoint,
} from './inheritance-tax';

const ZERO_HASH = '0'.repeat(64);

// ─── Paths ───────────────────────────────────────────────────────────────────

const matterDoc = (db: Firestore, firmId: string, matterId: string) =>
  db.collection('firms').doc(firmId).collection('inheritanceMatters').doc(matterId);

const subCollection = (db: Firestore, firmId: string, matterId: string, name: string) =>
  matterDoc(db, firmId, matterId).collection(name);

// ─── Canonical JSON storage ──────────────────────────────────────────────────

interface StoredRecord {
  json: string;
  [key: string]: unknown;
}

const encode = <T>(record: T, indexed: Record<string, unknown> = {}): StoredRecord => ({
  json: JSON.stringify(record),
  ...indexed,
});

function decode<T>(data: FirebaseFirestore.DocumentData | undefined): T | undefined {
  if (!data || typeof data['json'] !== 'string') return undefined;
  return JSON.parse(data['json'] as string) as T;
}

// ─── Audit chain ─────────────────────────────────────────────────────────────

/** Mask anything SSN-shaped before it is written. Mirrors foundation's `sanitizePayload`. */
export function sanitizePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizePayload);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = k === 'ssn' || k.toLowerCase().includes('ssn') ? '***-**-****' : sanitizePayload(v);
    }
    return out;
  }
  return value;
}

interface AuditEntryBody {
  entryId: string;
  matterId: string;
  timestamp: string;
  actor: string;
  action: AuditAction;
  payload: Record<string, unknown>;
  previousHash: string;
}

/** Field order here IS the contract — the chain is verified by re-serialising this shape. */
function makeBody(
  matterId: string,
  actor: string,
  action: AuditAction,
  payload: Record<string, unknown>,
  previousHash: string,
  timestamp: string,
): AuditEntryBody {
  return {
    entryId: randomUUID(),
    matterId,
    timestamp,
    actor,
    action,
    payload: sanitizePayload(payload) as Record<string, unknown>,
    previousHash,
  };
}

export function auditChainHash(previousHash: string, body: AuditEntryBody, signingKey: string): string {
  return createHmac('sha256', signingKey).update(previousHash + JSON.stringify(body)).digest('hex');
}

/**
 * Append one entry to a matter's chain, inside a transaction.
 *
 * The transaction is what makes this safe under concurrency: two Function instances appending at
 * once would otherwise read the same `previousHash` and fork the chain. Firestore retries the
 * loser, which re-reads the new tail.
 */
export async function appendAudit(
  db: Firestore,
  firmId: string,
  matterId: string,
  actor: string,
  action: AuditAction,
  payload: Record<string, unknown>,
  signingKey: string,
): Promise<AuditEntry> {
  if (!signingKey) {
    // FND-AUDITSIG: fail closed. An unsigned chain proves nothing against someone who can write.
    throw new HttpsError(
      'failed-precondition',
      'INHERITANCE_AUDIT_KEY is not configured; refusing to write an unsigned audit entry.',
    );
  }
  const col = subCollection(db, firmId, matterId, 'audit');
  return db.runTransaction(async (t: Transaction) => {
    const tail = await t.get(col.orderBy('seq', 'desc').limit(1));
    const last = tail.docs[0];
    const previousHash = last ? ((decode<AuditEntry>(last.data())?.hash) ?? ZERO_HASH) : ZERO_HASH;
    const seq = last ? ((last.data()['seq'] as number) ?? 0) + 1 : 0;

    const body = makeBody(matterId, actor, action, payload, previousHash, new Date().toISOString());
    const entry: AuditEntry = { ...body, hash: auditChainHash(previousHash, body, signingKey) };
    t.set(col.doc(entry.entryId), encode(entry, { seq, matterId, action, actor }));
    return entry;
  });
}

/** Re-verify a matter's whole chain. Returns false on the first entry that does not chain. */
export async function verifyAuditChain(
  db: Firestore,
  firmId: string,
  matterId: string,
  signingKey: string,
): Promise<{ valid: boolean; entries: number }> {
  const snap = await subCollection(db, firmId, matterId, 'audit').orderBy('seq', 'asc').get();
  let prev = ZERO_HASH;
  let count = 0;
  for (const doc of snap.docs) {
    const entry = decode<AuditEntry>(doc.data());
    if (!entry) return { valid: false, entries: count };
    const { hash, ...body } = entry;
    if (entry.previousHash !== prev) return { valid: false, entries: count };
    if (auditChainHash(prev, body as AuditEntryBody, signingKey) !== hash) {
      return { valid: false, entries: count };
    }
    prev = hash;
    count += 1;
  }
  return { valid: true, entries: count };
}

export async function readAuditChain(
  db: Firestore,
  firmId: string,
  matterId: string,
): Promise<AuditEntry[]> {
  const snap = await subCollection(db, firmId, matterId, 'audit').orderBy('seq', 'asc').get();
  return snap.docs.map((d) => decode<AuditEntry>(d.data())).filter((e): e is AuditEntry => !!e);
}

// ─── Matters ─────────────────────────────────────────────────────────────────

export async function saveMatter(
  db: Firestore,
  firmId: string,
  matter: Matter,
  clientId?: string,
): Promise<void> {
  await matterDoc(db, firmId, matter.matterId).set(
    encode(matter, {
      firmId,
      matterId: matter.matterId,
      decedentName: `${matter.decedent.firstName} ${matter.decedent.lastName}`,
      dateOfDeath: matter.decedent.dateOfDeath,
      updatedAt: new Date().toISOString(),
      ...(clientId ? { clientId } : {}),
    }),
  );
}

export async function getMatter(
  db: Firestore,
  firmId: string,
  matterId: string,
): Promise<Matter | undefined> {
  const snap = await matterDoc(db, firmId, matterId).get();
  return decode<Matter>(snap.data());
}

/**
 * The matter plus the index fields stored beside it. `updatedAt` is what tells a reopened matter
 * whether its stored computation still describes it, so it has to come back with the record —
 * `getMatter` decodes only the matter itself.
 */
export async function getMatterWithMeta(
  db: Firestore,
  firmId: string,
  matterId: string,
): Promise<{ matter: Matter; updatedAt: string } | undefined> {
  const snap = await matterDoc(db, firmId, matterId).get();
  const matter = decode<Matter>(snap.data());
  if (!matter) return undefined;
  return { matter, updatedAt: (snap.data()?.['updatedAt'] as string) ?? '' };
}

export async function listMatters(
  db: Firestore,
  firmId: string,
): Promise<Array<{ matterId: string; decedentName: string; dateOfDeath: string; updatedAt: string }>> {
  // Deliberately projected from the indexed fields, NOT the stored record: a list must never
  // ship an SSN to a screen that only needs a name.
  const snap = await db.collection('firms').doc(firmId).collection('inheritanceMatters').get();
  return snap.docs.map((d) => ({
    matterId: (d.data()['matterId'] as string) ?? d.id,
    decedentName: (d.data()['decedentName'] as string) ?? '',
    dateOfDeath: (d.data()['dateOfDeath'] as string) ?? '',
    updatedAt: (d.data()['updatedAt'] as string) ?? '',
  }));
}

// ─── Computations ────────────────────────────────────────────────────────────

export async function saveComputation(
  db: Firestore,
  firmId: string,
  matterId: string,
  computation: EstateComputation,
): Promise<string> {
  const computationId = randomUUID();
  await subCollection(db, firmId, matterId, 'computations')
    .doc(computationId)
    .set(encode(computation, { matterId, computedAt: computation.computedAt }));
  return computationId;
}

export async function getLatestComputation(
  db: Firestore,
  firmId: string,
  matterId: string,
): Promise<EstateComputation | undefined> {
  const snap = await subCollection(db, firmId, matterId, 'computations')
    .orderBy('computedAt', 'desc')
    .limit(1)
    .get();
  const doc = snap.docs[0];
  return doc ? decode<EstateComputation>(doc.data()) : undefined;
}

// ─── Review checkpoints ──────────────────────────────────────────────────────

export async function saveCheckpoint(
  db: Firestore,
  firmId: string,
  checkpoint: ReviewCheckpoint,
): Promise<void> {
  await subCollection(db, firmId, checkpoint.matterId, 'checkpoints')
    .doc(checkpoint.checkpointId)
    .set(encode(checkpoint, { matterId: checkpoint.matterId, status: checkpoint.status }));
}

export async function getCheckpoint(
  db: Firestore,
  firmId: string,
  matterId: string,
  checkpointId: string,
): Promise<ReviewCheckpoint | undefined> {
  const snap = await subCollection(db, firmId, matterId, 'checkpoints').doc(checkpointId).get();
  return decode<ReviewCheckpoint>(snap.data());
}

/**
 * The most recent checkpoint whatever its status, so reopening a matter can resume a *pending*
 * review as well as an approved one. `getApprovedCheckpoint` stays the authority for rendering
 * forms — a form must never render from a pending checkpoint (FND-IMMUT).
 */
export async function getLatestCheckpoint(
  db: Firestore,
  firmId: string,
  matterId: string,
): Promise<ReviewCheckpoint | undefined> {
  const snap = await subCollection(db, firmId, matterId, 'checkpoints').get();
  const all = snap.docs
    .map((d) => decode<ReviewCheckpoint>(d.data()))
    .filter((c): c is ReviewCheckpoint => !!c)
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  return all[all.length - 1];
}

export async function getApprovedCheckpoint(
  db: Firestore,
  firmId: string,
  matterId: string,
): Promise<ReviewCheckpoint | undefined> {
  const snap = await subCollection(db, firmId, matterId, 'checkpoints')
    .where('status', '==', 'approved')
    .get();
  const approved = snap.docs
    .map((d) => decode<ReviewCheckpoint>(d.data()))
    .filter((c): c is ReviewCheckpoint => !!c)
    .sort((a, b) => (a.reviewedAt ?? '').localeCompare(b.reviewedAt ?? ''));
  return approved[approved.length - 1];
}
