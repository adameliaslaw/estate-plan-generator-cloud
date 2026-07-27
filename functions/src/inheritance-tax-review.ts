/**
 * functions/src/inheritance-tax-review.ts
 *
 * The persisted NJ inheritance-tax workflow:
 *
 *   save matter → compute (stored) → request review → approve | finalize → IT-R
 *
 * The rule this file exists to enforce: **a form is rendered only from a frozen, reviewed
 * snapshot.** `buildITRFormData` refuses a checkpoint that is not `approved` and reads figures
 * exclusively from `computationSnapshot`, so editing a matter afterwards cannot retroactively
 * change a form an attorney signed off on. Editing simply leaves the matter with no approved
 * checkpoint for its latest computation, and it has to be reviewed again.
 *
 * ── Approve vs finalize ──────────────────────────────────────────────────────
 * `approveInheritanceReview` is the two-attorney path: the reviewer must be a **different**
 * staff user from the requester (separation of duties). It refuses a self-approval, always.
 *
 * `finalizeInheritanceReview` is the sole-practitioner path: the requester freezes their own
 * work. It is named for what it is. It provides the freeze and a contemporaneous record; it
 * does NOT provide an independent check, and it is audited as `matter_finalized` — never
 * `review_approved` — so anything reading the chain can tell the two apart.
 *
 * Finalize does not weaken approve: it is a separate action, and approve still rejects a
 * self-approval whether or not finalize exists.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { assertFirmStaff } from './auth-guards';
import { fillITRPdf } from './inheritance-tax/forms/it-r-pdf';
import {
  computeEstate,
  getRuleSet,
  validateMatter,
  buildITRFormData,
  renderITRHtml,
  UnsupportedMatterError,
  type EstateComputation,
  type ReviewCheckpoint,
} from './inheritance-tax';
import {
  appendAudit,
  getApprovedCheckpoint,
  getCheckpoint,
  getLatestComputation,
  getMatter,
  listMatters,
  readAuditChain,
  saveCheckpoint,
  saveComputation,
  saveMatter,
  verifyAuditChain,
} from './inheritance-tax-store';

/** HMAC key for the audit chain. Rotating it invalidates every existing chain — do not rotate. */
const INHERITANCE_AUDIT_KEY = defineSecret('INHERITANCE_AUDIT_KEY');

const CALL_OPTS = {
  region: 'us-east1' as const,
  timeoutSeconds: 60,
  memory: '512MiB' as const,
  secrets: [INHERITANCE_AUDIT_KEY],
};

/**
 * The State's blank Form IT-R booklet, held on the instance after the first read. It ships in
 * `functions/assets/` — one directory up from both `src/` and the compiled `lib/`, so the same
 * path resolves in tests and in production.
 */
let blankITR: Uint8Array | null = null;
function loadBlankITR(): Uint8Array {
  if (!blankITR) {
    blankITR = new Uint8Array(readFileSync(join(__dirname, '..', 'assets', 'itr-blank.pdf')));
  }
  return blankITR;
}

function requireFirmId(data: unknown): { firmId: string; body: Record<string, unknown> } {
  if (!data || typeof data !== 'object') throw new HttpsError('invalid-argument', 'Request body is required.');
  const body = data as Record<string, unknown>;
  const firmId = body['firmId'];
  if (typeof firmId !== 'string' || !firmId) throw new HttpsError('invalid-argument', 'firmId is required.');
  return { firmId, body };
}

function requireString(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== 'string' || !v) throw new HttpsError('invalid-argument', `${key} is required.`);
  return v;
}

// ─── Save a matter ───────────────────────────────────────────────────────────

export const saveInheritanceMatter = onCall(CALL_OPTS, async (request: CallableRequest<unknown>) => {
  const { firmId, body } = requireFirmId(request.data);
  const caller = assertFirmStaff(request, firmId);
  const db = admin.firestore();

  let matter;
  try {
    matter = validateMatter(body['matter']);
  } catch (e) {
    throw new HttpsError('invalid-argument', `Matter validation failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (matter.decedent.isNJResident === false) {
    throw new HttpsError('failed-precondition', 'Nonresident decedent: this engine computes the resident IT-R only (Form IT-NR applies).');
  }

  const existing = await getMatter(db, firmId, matter.matterId);
  await saveMatter(db, firmId, matter, typeof body['clientId'] === 'string' ? body['clientId'] : undefined);
  await appendAudit(
    db, firmId, matter.matterId, caller.uid,
    existing ? 'matter_updated' : 'matter_created',
    { matterId: matter.matterId, decedent: `${matter.decedent.firstName} ${matter.decedent.lastName}` },
    INHERITANCE_AUDIT_KEY.value(),
  );
  return { matterId: matter.matterId, created: !existing };
});

// ─── Compute and store ───────────────────────────────────────────────────────

export const computeAndStoreInheritanceTax = onCall(CALL_OPTS, async (request: CallableRequest<unknown>) => {
  const { firmId, body } = requireFirmId(request.data);
  const caller = assertFirmStaff(request, firmId);
  const db = admin.firestore();
  const matterId = requireString(body, 'matterId');

  const matter = await getMatter(db, firmId, matterId);
  if (!matter) throw new HttpsError('not-found', `Matter ${matterId} not found.`);

  let computation: EstateComputation;
  try {
    const ruleSet = getRuleSet(matter.decedent.dateOfDeath);
    computation = { ...computeEstate(matter, ruleSet), computedAt: new Date().toISOString() } as EstateComputation;
  } catch (e) {
    if (e instanceof UnsupportedMatterError) throw new HttpsError('failed-precondition', e.message);
    throw e;
  }

  await saveComputation(db, firmId, matterId, computation);
  await appendAudit(
    db, firmId, matterId, caller.uid, 'computation_run',
    { matterId, totalTaxDue: (computation as unknown as { totalTaxDue: number }).totalTaxDue },
    INHERITANCE_AUDIT_KEY.value(),
  );
  return { computation, workpaper: true as const };
});

// ─── Request review ──────────────────────────────────────────────────────────

export const requestInheritanceReview = onCall(CALL_OPTS, async (request: CallableRequest<unknown>) => {
  const { firmId, body } = requireFirmId(request.data);
  const caller = assertFirmStaff(request, firmId);
  const db = admin.firestore();
  const matterId = requireString(body, 'matterId');

  const computation = await getLatestComputation(db, firmId, matterId);
  if (!computation) throw new HttpsError('failed-precondition', 'Compute the matter before requesting review.');

  // The checkpoint FREEZES this computation. Later edits produce a new computation with no
  // approved checkpoint, which is what forces a fresh review before output.
  const checkpoint: ReviewCheckpoint = {
    checkpointId: randomUUID(),
    matterId,
    requestedAt: new Date().toISOString(),
    requestedBy: caller.uid,
    computationSnapshot: computation,
    status: 'pending',
  };
  await saveCheckpoint(db, firmId, checkpoint);
  await appendAudit(db, firmId, matterId, caller.uid, 'review_requested', { matterId, checkpointId: checkpoint.checkpointId }, INHERITANCE_AUDIT_KEY.value());
  return { checkpointId: checkpoint.checkpointId, status: checkpoint.status };
});

// ─── Approve (two-attorney) ──────────────────────────────────────────────────

/**
 * Two-attorney approval. Exported separately from the callable so the separation-of-duties rule
 * is testable without Firebase (see tests/unit/inheritance-tax-review-handlers.test.ts).
 */
export async function approveHandler(
  db: FirebaseFirestore.Firestore,
  firmId: string,
  callerUid: string,
  body: Record<string, unknown>,
  auditKey: string,
): Promise<{ checkpointId: string; status: string; finalizationKind?: string }> {
  const caller = { uid: callerUid };
  const matterId = requireString(body, 'matterId');
  const checkpointId = requireString(body, 'checkpointId');

  const checkpoint = await getCheckpoint(db, firmId, matterId, checkpointId);
  if (!checkpoint) throw new HttpsError('not-found', 'Checkpoint not found for this matter.');
  if (checkpoint.status !== 'pending') throw new HttpsError('failed-precondition', `Checkpoint is already ${checkpoint.status}.`);
  // The load-bearing rule. Never relax this — finalize is the solo path, not a looser approve.
  if (checkpoint.requestedBy === caller.uid) {
    throw new HttpsError('permission-denied', 'Separation of duties: a checkpoint cannot be approved by the person who requested it. Use finalizeInheritanceReview if you are the firm\'s only attorney.');
  }

  const approved: ReviewCheckpoint = {
    ...checkpoint,
    status: 'approved',
    reviewedAt: new Date().toISOString(),
    reviewedBy: caller.uid,
    finalizationKind: 'two-attorney',
  };
  await saveCheckpoint(db, firmId, approved);
  await appendAudit(db, firmId, matterId, caller.uid, 'review_approved', { matterId, checkpointId, requestedBy: checkpoint.requestedBy }, auditKey);
  return { checkpointId, status: approved.status, finalizationKind: approved.finalizationKind };
}

export const approveInheritanceReview = onCall(CALL_OPTS, async (request: CallableRequest<unknown>) => {
  const { firmId, body } = requireFirmId(request.data);
  const caller = assertFirmStaff(request, firmId);
  return approveHandler(admin.firestore(), firmId, caller.uid, body, INHERITANCE_AUDIT_KEY.value());
});

// ─── Finalize (sole practitioner) ────────────────────────────────────────────

/** Sole-practitioner finalization. Db-injectable for the same reason as `approveHandler`. */
export async function finalizeHandler(
  db: FirebaseFirestore.Firestore,
  firmId: string,
  callerUid: string,
  body: Record<string, unknown>,
  auditKey: string,
): Promise<{ checkpointId: string; status: string; finalizationKind?: string }> {
  const caller = { uid: callerUid };
  const matterId = requireString(body, 'matterId');
  const checkpointId = requireString(body, 'checkpointId');

  const checkpoint = await getCheckpoint(db, firmId, matterId, checkpointId);
  if (!checkpoint) throw new HttpsError('not-found', 'Checkpoint not found for this matter.');
  if (checkpoint.status !== 'pending') throw new HttpsError('failed-precondition', `Checkpoint is already ${checkpoint.status}.`);
  // Finalizing someone else's checkpoint is neither a review nor a finalization.
  if (checkpoint.requestedBy !== caller.uid) {
    throw new HttpsError('permission-denied', 'Only the attorney who requested this review may finalize it. A different attorney should use approveInheritanceReview.');
  }

  const finalized: ReviewCheckpoint = {
    ...checkpoint,
    status: 'approved',
    reviewedAt: new Date().toISOString(),
    reviewedBy: caller.uid,
    finalizationKind: 'solo',
  };
  await saveCheckpoint(db, firmId, finalized);
  // NOT 'review_approved' — this records provenance, not an independent review.
  await appendAudit(db, firmId, matterId, caller.uid, 'matter_finalized', { matterId, checkpointId, finalizationKind: 'solo' }, auditKey);
  return { checkpointId, status: finalized.status, finalizationKind: finalized.finalizationKind };
}

export const finalizeInheritanceReview = onCall(CALL_OPTS, async (request: CallableRequest<unknown>) => {
  const { firmId, body } = requireFirmId(request.data);
  const caller = assertFirmStaff(request, firmId);
  return finalizeHandler(admin.firestore(), firmId, caller.uid, body, INHERITANCE_AUDIT_KEY.value());
});

// ─── The IT-R, from the frozen snapshot only ─────────────────────────────────

export const getInheritanceForm = onCall(CALL_OPTS, async (request: CallableRequest<unknown>) => {
  const { firmId, body } = requireFirmId(request.data);
  assertFirmStaff(request, firmId);
  const db = admin.firestore();
  const matterId = requireString(body, 'matterId');

  const matter = await getMatter(db, firmId, matterId);
  if (!matter) throw new HttpsError('not-found', `Matter ${matterId} not found.`);
  const approved = await getApprovedCheckpoint(db, firmId, matterId);
  if (!approved) {
    throw new HttpsError('failed-precondition', 'No approved checkpoint: the IT-R renders only from a reviewed, frozen snapshot.');
  }

  try {
    const formData = buildITRFormData(matter, approved);
    const html = body['html'] === true ? renderITRHtml(formData) : undefined;
    // The filled official form is opt-in: it costs ~700KB on the wire, and most callers
    // (the audit view, the on-screen workpaper) only want the figures.
    const pdfBase64 = body['pdf'] === true
      ? Buffer.from(await fillITRPdf(formData, loadBlankITR())).toString('base64')
      : undefined;
    return {
      formData,
      ...(html ? { html } : {}),
      ...(pdfBase64 ? { pdfBase64 } : {}),
      finalizationKind: approved.finalizationKind ?? 'two-attorney',
      workpaper: true as const,
    };
  } catch (e) {
    if (e instanceof UnsupportedMatterError) throw new HttpsError('failed-precondition', e.message);
    throw e;
  }
});

// ─── Read-side helpers ───────────────────────────────────────────────────────

export const listInheritanceMatters = onCall(CALL_OPTS, async (request: CallableRequest<unknown>) => {
  const { firmId } = requireFirmId(request.data);
  assertFirmStaff(request, firmId);
  return { matters: await listMatters(admin.firestore(), firmId) };
});

export const getInheritanceAuditTrail = onCall(CALL_OPTS, async (request: CallableRequest<unknown>) => {
  const { firmId, body } = requireFirmId(request.data);
  assertFirmStaff(request, firmId);
  const db = admin.firestore();
  const matterId = requireString(body, 'matterId');
  const [entries, verification] = await Promise.all([
    readAuditChain(db, firmId, matterId),
    verifyAuditChain(db, firmId, matterId, INHERITANCE_AUDIT_KEY.value()),
  ]);
  // `verification.entries` is a count; the chain itself is `entries`. Name them apart.
  return { entries, chainValid: verification.valid, chainLength: verification.entries };
});
