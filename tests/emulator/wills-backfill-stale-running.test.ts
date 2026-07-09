/**
 * tests/emulator/wills-backfill-stale-running.test.ts
 *
 * Regression test for R5-061 (#112, T4): a `willsStartBackfill` run killed by
 * the 540s function timeout mid-BFS left `backfill_progress.status='running'`
 * forever, and the idempotency guard then permanently blocked every future
 * run. The fix treats a 'running' record whose `last_updated_at` is older
 * than one function lifetime (+margin, 15 min) as crashed and restarts.
 *
 * Drives the REAL onCall handler against the Firestore emulator. googleapis
 * is mocked so the restarted run fails FAST at the Drive BFS with an injected
 * error (never touching real Drive/Pub/Sub, and never picking up ambient
 * developer ADC credentials) — reaching that failure at all proves the guard
 * admitted the restart.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { admin } from './_emulator';

// v2 callable — return the raw handler (both resolvable paths).
vi.mock('../../functions/node_modules/firebase-functions/lib/esm/v2/providers/https.mjs', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
  },
}));
vi.mock('../../functions/node_modules/firebase-functions/lib/v2/providers/https.js', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
  },
}));
// Drive/Pub/Sub boundary — files.list rejects immediately.
vi.mock('../../functions/node_modules/googleapis', () => ({
  google: {
    auth: { GoogleAuth: class {} },
    drive: () => ({ files: { list: vi.fn().mockRejectedValue(new Error('injected drive failure')) } }),
    pubsub: () => ({ projects: { topics: { publish: vi.fn() } } }),
  },
}));

import { willsStartBackfill } from '../../functions/src/wills-backfill';

type Handler = (req: unknown) => Promise<unknown>;
const handler = willsStartBackfill as unknown as Handler;

const OWNER_FIRM = 'firm-pipeline-owner';
const progressRef = () => admin.firestore().collection('pipeline_state').doc('backfill_progress');

const call = (uid: string) =>
  handler({ auth: { uid, token: { role: 'admin', firmId: OWNER_FIRM } }, data: {} });

const runningProgress = (lastUpdatedAt: string) => ({
  status: 'running',
  total_files_discovered: 3, total_published: 3, total_processed: 0, total_errors: 0,
  started_at: lastUpdatedAt, completed_at: null,
  last_updated_at: lastUpdatedAt,
  current_folder: 'folder-x', started_by: 'prior-run-uid',
});

describe('willsStartBackfill — stuck-running guard (R5-061)', () => {
  beforeEach(async () => {
    await admin.firestore().doc('pipeline_state/control')
      .set({ enabled: true, firmId: OWNER_FIRM, daily_spend_usd: 0 });
  });

  it('a FRESH running record still blocks a second run', async () => {
    await progressRef().set(runningProgress(new Date().toISOString()));

    await expect(call('second-caller')).rejects.toMatchObject({ code: 'already-exists' });

    // Untouched — still the prior run's record.
    const p = await progressRef().get();
    expect(p.get('started_by')).toBe('prior-run-uid');
    expect(p.get('status')).toBe('running');
  });

  it('a STALE running record (crashed run) no longer blocks — the run restarts', async () => {
    // 20 minutes old — past the 15-minute staleness threshold.
    const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    await progressRef().set(runningProgress(stale));

    // Pre-fix: rejected 'already-exists' forever. Now the guard admits the
    // restart; the run proceeds to the (injected-failure) Drive BFS and fails
    // as 'internal' — which is the proof it got past the guard.
    await expect(call('restart-caller')).rejects.toMatchObject({
      code: 'internal',
      message: expect.stringContaining('injected drive failure'),
    });

    // The progress record was RESET by the new run and closed out as error.
    const p = await progressRef().get();
    expect(p.get('started_by')).toBe('restart-caller');
    expect(p.get('status')).toBe('error');
  });
});
