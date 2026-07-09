/**
 * tests/emulator/wills-cross-tenant-gate.test.ts
 *
 * Regression test for R5-066 (T3 multi-tenant): `willsPilotRun` and
 * `willsStartBackfill` used to gate only on `role == 'admin'` with NO firm
 * scoping — an admin of ANY firm could trigger this firm's Drive ingestion and
 * read pilot reports containing client-identifying file names/paths.
 *
 * The fix: after reading `pipeline_state/control`, both callables require
 * `caller.token.firmId === control.firmId` (the pipeline owner), checked
 * BEFORE the kill-switch probe so a cross-firm caller can't even learn whether
 * the pipeline is enabled. Owner unconfigured → failed-precondition (fail
 * closed); owner set but caller mismatched → permission-denied.
 *
 * These tests drive the REAL onCall handlers against the Firestore emulator.
 * They exercise the gate only — a Firm A admin "proceeding" is proven by
 * hitting the NEXT gate (kill switch disabled), so no Drive access is needed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { admin } from './_emulator';

// v2 callable — return the raw handler. A bare mock no-ops when the module
// resolves through functions/node_modules and is invoked, so mock both paths.
import { vi } from 'vitest';
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

import { willsPilotRun } from '../../functions/src/wills-pilot';
import { willsStartBackfill } from '../../functions/src/wills-backfill';

type Handler = (req: unknown) => Promise<unknown>;

const OWNER_FIRM = 'firm-pipeline-owner';
const OTHER_FIRM = 'firm-other';
const controlRef = () => admin.firestore().doc('pipeline_state/control');

const call = (handler: unknown, token: Record<string, unknown>) =>
  (handler as Handler)({ auth: { uid: 'caller-uid', token }, data: {} });

const cases: Array<[string, unknown]> = [
  ['willsPilotRun', willsPilotRun],
  ['willsStartBackfill', willsStartBackfill],
];

describe.each(cases)('%s — cross-tenant firm gate (R5-066)', (_name, handler) => {
  beforeEach(async () => {
    await controlRef().delete();
  });

  it('denies a non-admin outright', async () => {
    await expect(
      call(handler, { role: 'attorney', firmId: OWNER_FIRM }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it("fails CLOSED when the pipeline owner firm isn't configured", async () => {
    // enabled=true but no firmId — pre-fix this ran; now it must refuse.
    await controlRef().set({ enabled: true });
    await expect(
      call(handler, { role: 'admin', firmId: OWNER_FIRM }),
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      message: expect.stringContaining('not configured'),
    });
  });

  it("denies another firm's admin WITHOUT leaking the kill-switch state", async () => {
    // Pipeline disabled: a cross-firm admin must get permission-denied (the
    // firm gate), NOT the kill-switch failed-precondition — pre-fix ordering
    // let them probe whether ingestion was enabled.
    await controlRef().set({ firmId: OWNER_FIRM, enabled: false });
    await expect(
      call(handler, { role: 'admin', firmId: OTHER_FIRM }),
    ).rejects.toMatchObject({
      code: 'permission-denied',
      message: expect.stringContaining('another firm'),
    });

    // Same denial when enabled — a cross-firm admin can never trigger a run.
    await controlRef().set({ firmId: OWNER_FIRM, enabled: true });
    await expect(
      call(handler, { role: 'admin', firmId: OTHER_FIRM }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it("passes the owning firm's admin through to the kill-switch check", async () => {
    // Disabled pipeline → the owner's admin reaches the NEXT gate and gets the
    // kill-switch message. That proves the firm gate admitted them without
    // needing any Drive access.
    await controlRef().set({ firmId: OWNER_FIRM, enabled: false });
    await expect(
      call(handler, { role: 'admin', firmId: OWNER_FIRM }),
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      message: expect.stringContaining('disabled'),
    });
  });
});
