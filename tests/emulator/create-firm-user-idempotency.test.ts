/**
 * tests/emulator/create-firm-user-idempotency.test.ts
 *
 * Regression test for R5-052: `createFirmUser` was non-idempotent. A failure
 * AFTER `auth.createUser` orphaned the Auth account (no claims, no profile), and
 * every retry then hit `already-exists`. Separately, an invite-EMAIL failure
 * used to throw — making the caller retry into `already-exists` against a
 * now-valid user.
 *
 * The fix:
 *   - Critical path (create → claims → profile): any post-create failure does a
 *     best-effort `auth.deleteUser` rollback so no orphan remains.
 *   - Non-critical invite email: failure returns success + warning, not a throw.
 *
 * This drives the REAL onCall handler against the Auth + Firestore emulators. A
 * single `setCustomUserClaims` spy injects the post-create failure; everything
 * else (createUser, deleteUser, profile writes) is real emulator I/O.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { admin, uniq, deleteAuthUserByEmail } from './_emulator';

// v2 callable — return the raw handler. A bare mock no-ops when the module
// resolves through functions/node_modules and is invoked, so mock both paths.
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

import { createFirmUser } from '../../functions/src/user-management';

const handler = createFirmUser as unknown as (req: unknown) => Promise<{ success: boolean; uid: string; warning?: string }>;

const firmId = 'firm-idem';
const callerUid = 'caller-admin';
const createdEmails: string[] = [];

const req = (email: string) => ({
  auth: { uid: callerUid, token: {} },
  data: { firmId, email, firstName: 'New', lastName: 'User', role: 'attorney' },
});

describe('createFirmUser — idempotency + rollback (R5-052)', () => {
  beforeAll(async () => {
    // Seed the calling admin's profile and a firm WITHOUT a SendGrid key.
    await admin.firestore().doc(`firms/${firmId}/users/${callerUid}`).set({ role: 'admin', firmId });
    await admin.firestore().doc(`firms/${firmId}`).set({ name: 'Test Firm' });
  });

  afterAll(async () => {
    for (const email of createdEmails) await deleteAuthUserByEmail(email);
  });

  it('an invite-email failure returns success + warning (user is NOT rolled back)', async () => {
    // No SendGrid key configured → the email step fails; the user must persist.
    const email = uniq('invite') + '@example.com';
    createdEmails.push(email);

    const res = await handler(req(email));

    expect(res.success).toBe(true);
    expect(res.warning).toBeTruthy();
    // The Auth account and its profile survive — a retry would NOT be needed.
    await expect(admin.auth().getUserByEmail(email)).resolves.toMatchObject({ email });
    const profile = await admin.firestore().doc(`firms/${firmId}/users/${res.uid}`).get();
    expect(profile.exists).toBe(true);
  });

  it('a post-create failure rolls back the orphaned Auth account', async () => {
    const email = uniq('rollback') + '@example.com';
    createdEmails.push(email); // in case rollback fails, still clean up

    // Inject a failure at step 2 (claims), AFTER auth.createUser succeeds.
    const spy = vi
      .spyOn(admin.auth(), 'setCustomUserClaims')
      .mockRejectedValueOnce(new Error('injected claims failure'));

    await expect(handler(req(email))).rejects.toMatchObject({ code: 'internal' });

    spy.mockRestore();

    // The just-created Auth user must have been deleted — no orphan, so a retry
    // won't hit `already-exists`.
    await expect(admin.auth().getUserByEmail(email)).rejects.toMatchObject({
      code: 'auth/user-not-found',
    });
  });
});
