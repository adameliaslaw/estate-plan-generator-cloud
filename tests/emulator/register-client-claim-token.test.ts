/**
 * tests/emulator/register-client-claim-token.test.ts
 *
 * Regression test for R5-010 (T3 multi-tenant): `registerClientFromLink` used
 * to CLAIM any unlinked existing client record on a bare name+email match.
 * Email is not a verified identity in the anonymous flow, so anyone who knew a
 * pre-created client's email could take over their estate profile.
 *
 * The fix: claiming an existing record requires an attorney-minted
 * `registrationToken` (embedded in a personal invite link). Without a token,
 * the generic link can ONLY create a brand-new prospect stub — it never looks
 * a record up by email.
 *
 * Drives the REAL onCall handler against the Firestore emulator.
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

import { registerClientFromLink } from '../../functions/src/register-client';

type Res = { clientId: string; isNew: boolean };
const handler = registerClientFromLink as unknown as (req: unknown) => Promise<Res>;

const firmId = 'firm-claim-gate';
const victimEmail = uniq('victim') + '@example.com';
const registrationToken = uniq('tok');
let victimClientId = '';

const call = (uid: string, data: Record<string, unknown>) =>
  handler({ auth: { uid, token: {} }, data: { firmId, ...data } });

describe('registerClientFromLink — attorney-issued token required to claim (R5-010)', () => {
  beforeAll(async () => {
    const db = admin.firestore();
    await db.doc(`firms/${firmId}`).set({ name: 'Claim Gate Firm' });
    // A pre-created, UNLINKED client record — the takeover target. It carries
    // an attorney-minted registration token for the legitimate-claim test.
    const ref = db.collection(`firms/${firmId}/clients`).doc();
    victimClientId = ref.id;
    await ref.set({
      firmId,
      personalInfo: { firstName: 'Vera', lastName: 'Victim', email: victimEmail },
      registrationToken,
      status: 'active',
    });
  });

  it('a tokenless registration with a known email does NOT claim the existing record', async () => {
    // Pre-fix: this matched the victim by email and handed the record (and the
    // whole estate profile) to the anonymous caller's session.
    const res = await call('anon-attacker', {
      email: victimEmail,
      firstName: 'Vera',
      lastName: 'Victim',
    });

    expect(res.isNew).toBe(true);
    expect(res.clientId).not.toBe(victimClientId);

    // The victim's record is untouched — still unlinked.
    const victim = await admin.firestore()
      .doc(`firms/${firmId}/clients/${victimClientId}`).get();
    expect(victim.get('linkedUserId')).toBeUndefined();

    // The attacker only got a fresh prospect stub bound to their own session.
    const stub = await admin.firestore()
      .doc(`firms/${firmId}/clients/${res.clientId}`).get();
    expect(stub.get('status')).toBe('prospect');
    expect(stub.get('linkedUserId')).toBe('anon-attacker');
  });

  it('an invalid token claims nothing', async () => {
    await expect(
      call('anon-guesser', { token: 'no-such-token' }),
    ).rejects.toMatchObject({ code: 'not-found' });
    const victim = await admin.firestore()
      .doc(`firms/${firmId}/clients/${victimClientId}`).get();
    expect(victim.get('linkedUserId')).toBeUndefined();
  });

  it('a valid attorney-minted token claims the record and links the session', async () => {
    const res = await call('real-client-session', { token: registrationToken });

    expect(res.isNew).toBe(false);
    expect(res.clientId).toBe(victimClientId);
    const victim = await admin.firestore()
      .doc(`firms/${firmId}/clients/${victimClientId}`).get();
    expect(victim.get('linkedUserId')).toBe('real-client-session');
  });
});
