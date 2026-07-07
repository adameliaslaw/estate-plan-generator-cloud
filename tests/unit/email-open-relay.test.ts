/**
 * tests/unit/email-open-relay.test.ts
 *
 * Regression test for R5-057: sendQuestionnaireCompleteNotification is
 * intentionally client-callable (it fires when a CLIENT submits their
 * questionnaire), but it trusted a caller-supplied `attorneyEmail` + `clientName`
 * — letting any authenticated client send firm-branded email from the firm's
 * SendGrid sender to ANY address (open relay / spam).
 *
 * The fix ignores both request fields and resolves them server-side:
 *   - recipient ← the client's `assignedAttorneyId` (only if that user belongs
 *     to this firm), else the firm's own email, else `failed-precondition`.
 *   - clientName ← the client's `personalInfo`.
 *
 * The test drives the real onCall handler with a path-aware Firestore mock and a
 * stubbed `fetch`, and asserts the SendGrid recipient is NEVER the caller-supplied
 * address.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  firm: {} as Record<string, unknown>,
  client: {} as Record<string, unknown>,
  attorney: undefined as Record<string, unknown> | undefined,
  sent: null as any,
}));

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

vi.mock('../../functions/src/auth-guards', () => ({ assertStaff: () => ({ uid: 'x', firmId: 'firm-1' }) }));
vi.mock('../../functions/src/firm-secrets', () => ({ loadFirmSecrets: async () => ({}) }));
vi.mock('../../functions/src/audit-trail', () => ({ logAuditEvent: async () => {} }));

vi.mock('../../functions/node_modules/firebase-admin', () => {
  const makeDoc = (path: string) => ({
    get: async () => {
      if (path === 'firms/firm-1') return { exists: true, data: () => state.firm };
      if (path === 'firms/firm-1/clients/client-1') return { exists: true, data: () => state.client };
      if (path === 'users/att-1') return { exists: state.attorney !== undefined, data: () => state.attorney };
      return { exists: false, data: () => undefined };
    },
  });
  const firestore = Object.assign(() => ({ doc: (p: string) => makeDoc(p) }), {
    FieldValue: { serverTimestamp: () => 'ts' },
  });
  return { firestore, initializeApp: vi.fn() };
});

const fetchMock = vi.fn(async (_url: string, opts: any) => {
  state.sent = JSON.parse(opts.body);
  return { ok: true, status: 200, statusText: 'OK', text: async () => '' };
});
vi.stubGlobal('fetch', fetchMock);

import { sendQuestionnaireCompleteNotification } from '../../functions/src/email-notifications';

const handler = sendQuestionnaireCompleteNotification as unknown as (r: unknown) => Promise<any>;

// The caller ALWAYS supplies a hostile attorneyEmail/clientName; the fix must
// ignore both.
const req = () => ({
  auth: { uid: 'client-user', token: { firmId: 'firm-1', role: 'client', email: 'c@x.com' } },
  data: {
    firmId: 'firm-1',
    clientId: 'client-1',
    attorneyEmail: 'attacker@evil.com',
    clientName: 'Attacker McEvil',
  },
});

const recipient = () => state.sent?.personalizations?.[0]?.to?.[0]?.email;
const subject = () => state.sent?.personalizations?.[0]?.subject;

describe('sendQuestionnaireCompleteNotification — open-relay hardening (R5-057)', () => {
  beforeEach(() => {
    state.firm = { sendGridApiKey: 'SG.key', firmName: 'Acme Law', firmEmail: 'office@acme.law' };
    state.client = { personalInfo: { firstName: 'Real', lastName: 'Client' }, assignedAttorneyId: 'att-1' };
    state.attorney = { email: 'assigned.attorney@acme.law', firmId: 'firm-1' };
    state.sent = null;
    fetchMock.mockClear();
  });

  it('ignores caller-supplied attorneyEmail; sends to the assigned attorney', async () => {
    const res = await handler(req());

    expect(res.success).toBe(true);
    expect(recipient()).toBe('assigned.attorney@acme.law');
    expect(recipient()).not.toBe('attacker@evil.com');
  });

  it('ignores caller-supplied clientName; uses the client record', async () => {
    await handler(req());
    expect(subject()).toContain('Real Client');
    expect(subject()).not.toContain('Attacker');
  });

  it('falls back to the firm email when the client has no assigned attorney', async () => {
    state.client = { personalInfo: { firstName: 'Real', lastName: 'Client' } };
    await handler(req());
    expect(recipient()).toBe('office@acme.law');
    expect(recipient()).not.toBe('attacker@evil.com');
  });

  it('rejects an assigned attorney that belongs to a different firm (falls back to firm email)', async () => {
    state.attorney = { email: 'attorney@other-firm.com', firmId: 'other-firm' };
    await handler(req());
    expect(recipient()).toBe('office@acme.law');
    expect(recipient()).not.toBe('attorney@other-firm.com');
  });

  it('throws failed-precondition (and sends nothing) when no attorney and no firm email exist', async () => {
    state.client = { personalInfo: { firstName: 'Real', lastName: 'Client' } };
    state.firm = { sendGridApiKey: 'SG.key', firmName: 'Acme Law' }; // no firmEmail / email
    await expect(handler(req())).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enforces the firm tenant boundary via the auth claim', async () => {
    const r = req();
    r.auth.token.firmId = 'someone-elses-firm';
    await expect(handler(r)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
