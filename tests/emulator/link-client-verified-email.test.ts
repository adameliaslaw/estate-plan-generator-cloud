/**
 * tests/emulator/link-client-verified-email.test.ts
 *
 * Regression tests for BL + the linkClient half of BM:
 *
 * BL — `linkClient` used to claim an existing client record on a bare
 * `auth.token.email` match with NO `email_verified` check, so a password
 * sign-up with a victim's email could take over their estate profile (email
 * is only an identity proof when verified). Now: unverified email + existing
 * match → `failed-precondition`, record untouched; verified email claims as
 * before.
 *
 * BM — prospect auto-creation had no firm-existence check (minting custom
 * claims for arbitrary firm ids) and no rate limit (its sibling
 * registerClientFromLink has both). Now: unknown firm → `not-found`; stub
 * creation draws from the shared per-firm registration throttle.
 *
 * Also pins the error-propagation fix: deliberate HttpsError codes
 * (permission-denied etc.) surface instead of being flattened to `internal`
 * by the catch-all.
 *
 * Drives the REAL onCall handler against the Firestore + Auth emulators.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { admin, uniq } from './_emulator';

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

import { linkClient } from '../../functions/src/link-client';

type Res = { success: boolean; clientId?: string; isNewClient?: boolean; alreadyLinked?: boolean };
const handler = linkClient as unknown as (req: unknown) => Promise<Res>;

const firmId = 'firm-link-verified-gate';
const victimEmail = uniq('victim') + '@example.com';
let victimClientId = '';

const call = (uid: string, token: Record<string, unknown>, firm: string = firmId) =>
  handler({ auth: { uid, token }, data: { firmId: firm } });

describe('linkClient — verified email required to claim an existing record (BL/BM)', () => {
  beforeAll(async () => {
    const db = admin.firestore();
    await db.doc(`firms/${firmId}`).set({ name: 'Link Verified Gate Firm' });
    // A pre-created, UNLINKED client record — the takeover target.
    const ref = db.collection(`firms/${firmId}/clients`).doc();
    victimClientId = ref.id;
    await ref.set({
      firmId,
      personalInfo: { firstName: 'Vera', lastName: 'Victim', email: victimEmail },
      status: 'active',
    });
  });

  it('an UNVERIFIED email match does NOT claim the record (failed-precondition)', async () => {
    // Pre-fix: a password sign-up with the victim's email (email_verified
    // false) matched the record, linked it, and minted client claims.
    await expect(
      call('attacker-password-signup', { email: victimEmail, email_verified: false }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    const victim = await admin.firestore()
      .doc(`firms/${firmId}/clients/${victimClientId}`).get();
    expect(victim.get('linkedUserId')).toBeUndefined();
  });

  it('a VERIFIED email match claims the record, links it, and sets client claims', async () => {
    // Real auth user — setCustomUserClaims requires one in the emulator.
    const user = await admin.auth().createUser({ email: victimEmail, emailVerified: true });

    const res = await call(user.uid, { email: victimEmail, email_verified: true });

    expect(res.success).toBe(true);
    expect(res.clientId).toBe(victimClientId);
    expect(res.isNewClient).toBe(false);

    const victim = await admin.firestore()
      .doc(`firms/${firmId}/clients/${victimClientId}`).get();
    expect(victim.get('linkedUserId')).toBe(user.uid);

    const claims = (await admin.auth().getUser(user.uid)).customClaims;
    expect(claims).toMatchObject({ role: 'client', firmId, clientId: victimClientId });
  });

  it('a record already linked to someone else surfaces permission-denied (not internal)', async () => {
    // Pre-fix the catch-all flattened this deliberate code to `internal`.
    await expect(
      call('intruder-session', { email: victimEmail, email_verified: true }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('an unknown firmId is rejected before creating records or minting claims', async () => {
    await expect(
      call('any-user', { email: uniq('nobody') + '@example.com', email_verified: true }, 'no-such-firm'),
    ).rejects.toMatchObject({ code: 'not-found' });

    const orphans = await admin.firestore()
      .collection('firms/no-such-firm/clients').limit(1).get();
    expect(orphans.empty).toBe(true);
  });

  it('prospect auto-creation still works and draws from the shared per-firm throttle', async () => {
    const freshEmail = uniq('fresh') + '@example.com';
    const user = await admin.auth().createUser({ email: freshEmail, emailVerified: false });

    // No matching record → a new prospect stub is fine even unverified (the
    // caller can only create data about themselves, not read anyone else's).
    const res = await call(user.uid, { email: freshEmail, email_verified: false });
    expect(res.success).toBe(true);
    expect(res.isNewClient).toBe(true);

    const stub = await admin.firestore()
      .doc(`firms/${firmId}/clients/${res.clientId!}`).get();
    expect(stub.get('status')).toBe('prospect');
    expect(stub.get('linkedUserId')).toBe(user.uid);

    // Exhaust the shared registrationThrottle counter → next stub is refused.
    await admin.firestore()
      .doc(`firms/${firmId}/secrets/registrationThrottle`)
      .set({ windowStart: Date.now(), count: 50 });

    await expect(
      call('flooder-session', { email: uniq('flood') + '@example.com', email_verified: false }),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
  });
});
