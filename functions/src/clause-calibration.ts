/**
 * Calibration-session callables for the clause-mining review UI (§11 P1).
 *
 * The clauseMining workspace collections are functions-only by design
 * (default-deny rules, #222) and the packet lives in the staff-only
 * clause-mining/** Storage path — so the review page reads and writes
 * through these two callables rather than the client SDK.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { z } from 'zod';
import { assertStaff } from './auth-guards';
import { HttpsError as GuardError } from 'firebase-functions/v2/https';

/**
 * The mining run is FIRM INFRASTRUCTURE keyed under the pipeline's firm id
 * ('firm-001', pinned 2026-07-31), while the app's live auth claims carry
 * 'elias-counsel' — discovered when the calibration page 404'd on its own
 * packet. Staff of either id operate on the one mining scope. Revisit when
 * the catalog ships: catalog docs must land under the APP's firm id or the
 * UI cannot see them (HOMEWORK 2026-07-31 warning, now proven real).
 */
const MINING_FIRM_ID = 'firm-001';
const MINING_STAFF_FIRMS = new Set(['firm-001', 'elias-counsel']);

function assertMiningStaff(request: Parameters<typeof assertStaff>[0]): { uid: string } {
  const caller = assertStaff(request);
  if (!caller.firmId || !MINING_STAFF_FIRMS.has(caller.firmId)) {
    throw new GuardError('permission-denied', 'Not a staff member of the mining firm.');
  }
  return caller;
}

const RUN_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function packetPath(firmId: string, runId: string): string {
  // Mirrors clause-miner/src/paths.ts calibrationPacketPath.
  return `firms/${firmId}/clause-mining/runs/${runId}/calibration/packet.json`;
}

function labelsDraftDocPath(firmId: string, runId: string): string {
  // Drafts live in a SEPARATE doc: STAGE=calibrate's tune mode reads the
  // labels doc, and tuning on a half-finished session would be silent junk.
  return `firms/${firmId}/clauseMining/${runId}/calibration/labelsDraft`;
}

function labelsDocPath(firmId: string, runId: string): string {
  // Mirrors clause-miner/src/paths.ts calibrationLabelsPath.
  return `firms/${firmId}/clauseMining/${runId}/calibration/labels`;
}

const GetSchema = z
  .object({ firmId: z.string().min(1).max(200), runId: z.string().regex(RUN_ID_RE) })
  .strict();

export const getCalibrationPacket = onCall(
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request) => {
    const parsed = GetSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const { runId } = parsed.data;
    assertMiningStaff(request);
    const firmId = MINING_FIRM_ID;

    // The miner writes to its GCS_BUCKET (…firebasestorage.app) explicitly;
    // the Functions default bucket can be the legacy …appspot.com one. Try
    // both and name what was tried, so a miss is a diagnosis, not a shrug.
    const storage = getStorage();
    const candidates = [
      storage.bucket(),
      storage.bucket('estate-plan-generator.firebasestorage.app'),
    ];
    let file = null as ReturnType<(typeof candidates)[number]['file']> | null;
    const tried: string[] = [];
    for (const bucket of candidates) {
      if (tried.includes(bucket.name)) continue;
      tried.push(bucket.name);
      const candidate = bucket.file(packetPath(firmId, runId));
      const [exists] = await candidate.exists();
      if (exists) {
        file = candidate;
        break;
      }
    }
    if (file === null) {
      throw new HttpsError(
        'not-found',
        `No calibration packet for run '${runId}' (looked in ${tried.join(', ')} at ` +
          `${packetPath(firmId, runId)}) — run STAGE=calibrate first.`,
      );
    }
    const [bytes] = await file.download();
    const packet: unknown = JSON.parse(bytes.toString('utf8'));

    const db = getFirestore();
    const [labelsSnap, draftSnap] = await Promise.all([
      db.doc(labelsDocPath(firmId, runId)).get(),
      db.doc(labelsDraftDocPath(firmId, runId)).get(),
    ]);
    return {
      packet,
      labels: labelsSnap.exists ? labelsSnap.data() : null,
      draft: draftSnap.exists ? draftSnap.data() : null,
    };
  },
);

const SubmitSchema = z
  .object({
    firmId: z.string().min(1).max(200),
    runId: z.string().regex(RUN_ID_RE),
    pairs: z
      .array(
        z
          .object({
            pairId: z.string().min(1).max(100),
            label: z.enum(['same', 'different']),
          })
          .strict(),
      )
      .max(500),
    boundaryMarks: z
      .array(
        z
          .object({
            pieceId: z.string().min(1).max(200),
            mark: z.enum(['ok', 'split', 'merge']),
            note: z.string().max(1000).optional(),
          })
          .strict(),
      )
      .max(1000)
      .optional(),
    /** True = autosave checkpoint; stored apart from final labels. */
    draft: z.boolean().optional(),
  })
  .strict();

export const submitCalibrationLabels = onCall(
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request) => {
    const parsed = SubmitSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', parsed.error.issues[0]?.message ?? 'Invalid input');
    }
    const { runId, pairs, boundaryMarks, draft } = parsed.data;
    const caller = assertMiningStaff(request);
    const firmId = MINING_FIRM_ID;

    await getFirestore()
      .doc(draft === true ? labelsDraftDocPath(firmId, runId) : labelsDocPath(firmId, runId))
      .set(
        {
          pairs,
          ...(boundaryMarks !== undefined ? { boundaryMarks } : {}),
          submittedBy: caller.uid,
          submittedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    return { saved: pairs.length, boundaryMarks: boundaryMarks?.length ?? 0 };
  },
);
