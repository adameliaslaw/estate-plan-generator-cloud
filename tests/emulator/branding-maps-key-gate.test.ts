/**
 * tests/emulator/branding-maps-key-gate.test.ts
 *
 * Regression test for BK: `getFirmBranding` returned
 * `settings.googleMapsApiKey` to ANY authenticated caller for ANY firmId —
 * an authenticated user of firm A (or a throwaway anonymous session) could
 * enumerate firm ids and harvest every firm's Maps key.
 *
 * The fix gates the key on firm membership: a matching `firmId` custom claim
 * (staff and linked clients), or — for anonymous questionnaire sessions,
 * which carry no claims — a client record in that firm with
 * `linkedUserId == uid`. Logo and firm name stay public (login page).
 *
 * Drives the REAL v1 onCall handler against the Firestore emulator.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { admin, uniq } from './_emulator';

// v1 callable — `functions.region(...).https.onCall(handler)` returns the raw
// handler. Mock both module paths like the v2 tests do (factories inlined:
// vi.mock hoists above any const it would share).
vi.mock('../../functions/node_modules/firebase-functions/lib/v1/index.js', () => {
  class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
  }
  const https = { onCall: (handler: unknown) => handler, HttpsError };
  return { region: () => ({ https }), https };
});
vi.mock('../../functions/node_modules/firebase-functions/lib/esm/v1/index.mjs', () => {
  class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
  }
  const https = { onCall: (handler: unknown) => handler, HttpsError };
  return { region: () => ({ https }), https };
});

import { getFirmBranding } from '../../functions/src/branding';

type Res = { logoUrl: string | null; firmName: string | null; googleMapsApiKey: string | null } | null;
const handler = getFirmBranding as unknown as (data: unknown, context: unknown) => Promise<Res>;

const firmId = 'firm-maps-key-gate';
const mapsKey = uniq('AIza-test-key');

describe('getFirmBranding — Maps key only for firm members (BK)', () => {
  beforeAll(async () => {
    const db = admin.firestore();
    await db.doc(`firms/${firmId}`).set({
      firmName: 'Maps Key Gate Firm',
      logoUrl: 'https://example.com/logo.png',
      settings: { googleMapsApiKey: mapsKey },
    });
    // A client record linked to an anonymous questionnaire session's uid.
    await db.collection(`firms/${firmId}/clients`).doc().set({
      firmId,
      personalInfo: { email: uniq('linked') + '@example.com' },
      linkedUserId: 'anon-linked-session',
      status: 'prospect',
    });
  });

  it('unauthenticated callers get logo/name but never the key', async () => {
    const res = await handler({ firmId }, { auth: undefined });
    expect(res?.logoUrl).toBe('https://example.com/logo.png');
    expect(res?.firmName).toBe('Maps Key Gate Firm');
    expect(res?.googleMapsApiKey).toBeNull();
  });

  it('a caller with a matching firmId claim gets the key', async () => {
    const res = await handler({ firmId }, { auth: { uid: 'staff-1', token: { firmId } } });
    expect(res?.googleMapsApiKey).toBe(mapsKey);
  });

  it('an authenticated caller with no tie to the firm gets NO key', async () => {
    // Pre-fix: any authenticated session harvested the key for any firmId.
    const otherFirm = await handler({ firmId }, { auth: { uid: 'outsider', token: { firmId: 'some-other-firm' } } });
    expect(otherFirm?.googleMapsApiKey).toBeNull();

    const noClaims = await handler({ firmId }, { auth: { uid: 'anon-unlinked', token: {} } });
    expect(noClaims?.googleMapsApiKey).toBeNull();

    // Logo/name still served — the gate is only on the key.
    expect(noClaims?.firmName).toBe('Maps Key Gate Firm');
  });

  it('an anonymous session linked to a client record in the firm gets the key', async () => {
    const res = await handler({ firmId }, { auth: { uid: 'anon-linked-session', token: {} } });
    expect(res?.googleMapsApiKey).toBe(mapsKey);
  });
});
