/**
 * tests/unit/registration-token-ttl.test.ts
 *
 * #170 agent half — the portal registration token was a bearer credential
 * with no lifecycle: minted once, reused forever, claim never audited
 * (registrationTokenCreatedAt was written and read by nothing).
 *
 * 1. TTL: a claim with a token older than the TTL is refused with the same
 *    message as an unknown token; a token with no createdAt stamp is treated
 *    as expired (fail closed — the stamp is always written with the token, so
 *    its absence is an anomaly, not a legacy case to honour).
 * 2. Rotation: createClientRegistrationLink re-mints when the stored token has
 *    expired instead of handing back a dead link, and mints fresh on demand
 *    when rotate=true (invalidating whatever was shared before).
 * 3. Audit: both registration paths write a client_registered entry — claims
 *    are the portal trust boundary and were invisible to the audit log.
 *
 * The firestore.rules field allowlist (the other half of #170) is Never-Break
 * and is deliberately not here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface CapturedWrite {
  path: string;
  data: Record<string, unknown>;
}

const auditWrites: CapturedWrite[] = [];
const updates: CapturedWrite[] = [];
const docStore = new Map<string, Record<string, unknown>>();
let docCounter = 0;

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = 1_754_700_000_000;

function tsOf(millis: number) {
  return { toMillis: () => millis, seconds: Math.floor(millis / 1000) };
}

function makeDocRef(path: string, id: string): Record<string, unknown> {
  const fullPath = `${path}/${id}`;
  return {
    id,
    path: fullPath,
    set: vi.fn(async (data: Record<string, unknown>) => {
      if (path.endsWith('/auditLog')) auditWrites.push({ path: fullPath, data });
      else docStore.set(fullPath, { ...(docStore.get(fullPath) ?? {}), ...data });
    }),
    update: vi.fn(async (data: Record<string, unknown>) => {
      updates.push({ path: fullPath, data });
      docStore.set(fullPath, { ...(docStore.get(fullPath) ?? {}), ...data });
    }),
    get: vi.fn(async () => snapFor(fullPath, id)),
  };
}

function snapFor(fullPath: string, id: string) {
  const data = docStore.get(fullPath);
  return {
    id,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => (data ?? {})[field],
    ref: makeDocRef(fullPath.split('/').slice(0, -1).join('/'), id),
  };
}

const fakeFirestore = {
  doc: vi.fn((fullPath: string) => {
    const parts = fullPath.split('/');
    const id = parts.pop() as string;
    return makeDocRef(parts.join('/'), id);
  }),
  collection: vi.fn((path: string) => ({
    doc: vi.fn((id?: string) => makeDocRef(path, id ?? `auto-${++docCounter}`)),
    where: vi.fn((field: string, _op: string, value: unknown) => ({
      limit: vi.fn(() => ({
        get: vi.fn(async () => {
          const docs: unknown[] = [];
          for (const [fullPath, data] of docStore.entries()) {
            if (fullPath.startsWith(`${path}/`) && data[field] === value) {
              const id = fullPath.slice(path.length + 1);
              if (!id.includes('/')) docs.push(snapFor(fullPath, id));
            }
          }
          return { empty: docs.length === 0, docs };
        }),
      })),
    })),
  })),
  runTransaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
    const tx = {
      get: vi.fn(async (ref: { path: string; id: string }) => snapFor(ref.path, ref.id)),
      set: vi.fn((ref: { path: string }, data: Record<string, unknown>) => {
        docStore.set(ref.path, { ...(docStore.get(ref.path) ?? {}), ...data });
      }),
    };
    await fn(tx);
  }),
};

vi.mock('firebase-admin', () => {
  const firestoreFn = (() => fakeFirestore) as unknown as {
    (): typeof fakeFirestore;
    Timestamp: { now: () => { seconds: number } };
    FieldValue: { serverTimestamp: () => string };
  };
  firestoreFn.Timestamp = { now: () => ({ seconds: NOW_MS / 1000 }) };
  firestoreFn.FieldValue = { serverTimestamp: () => 'SERVER_TIMESTAMP' };
  return { default: { firestore: firestoreFn }, firestore: firestoreFn };
});

import { registerClientFromLink } from '../../functions/src/register-client';
import { createClientRegistrationLink } from '../../functions/src/create-registration-link';

type Runnable = { run: (request: unknown) => Promise<unknown> };

const STAFF_REQUEST = (data: Record<string, unknown>) => ({
  data,
  auth: { uid: 'atty-1', token: { role: 'attorney', firmId: 'firm-001', email: 'a@b.test' } },
});

const CLIENT_REQUEST = (data: Record<string, unknown>) => ({
  data,
  auth: { uid: 'anon-session-1', token: {} },
});

beforeEach(() => {
  auditWrites.length = 0;
  updates.length = 0;
  docStore.clear();
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  docStore.set('firms/firm-001', { firmName: 'Test Firm (synthetic)' });
});

describe('registration token TTL (#170)', () => {
  it('claims with a fresh token, and audits the claim', async () => {
    docStore.set('firms/firm-001/clients/client-1', {
      registrationToken: 'tok-fresh',
      registrationTokenCreatedAt: tsOf(NOW_MS - 1 * DAY_MS),
    });

    const res = (await (registerClientFromLink as unknown as Runnable).run(
      CLIENT_REQUEST({ firmId: 'firm-001', token: 'tok-fresh' }),
    )) as { clientId: string; isNew: boolean };

    expect(res.clientId).toBe('client-1');
    expect(res.isNew).toBe(false);

    const entry = auditWrites.find((w) => w.data.eventType === 'client_registered');
    expect(entry).toBeDefined();
    expect(entry!.data.clientId).toBe('client-1');
    expect((entry!.data.metadata as Record<string, unknown>).via).toBe('invite-token');
    // The bearer token itself must never reach the audit log.
    expect(JSON.stringify(entry!.data)).not.toContain('tok-fresh');
  });

  it('refuses a claim once the token has outlived its TTL', async () => {
    docStore.set('firms/firm-001/clients/client-1', {
      registrationToken: 'tok-stale',
      registrationTokenCreatedAt: tsOf(NOW_MS - 15 * DAY_MS),
    });

    await expect(
      (registerClientFromLink as unknown as Runnable).run(
        CLIENT_REQUEST({ firmId: 'firm-001', token: 'tok-stale' }),
      ),
    ).rejects.toThrow(/invalid or has expired/);

    // The record must not have been re-pointed.
    expect(updates.filter((u) => u.path.includes('client-1'))).toHaveLength(0);
  });

  it('treats a token with no createdAt stamp as expired (fail closed)', async () => {
    docStore.set('firms/firm-001/clients/client-1', {
      registrationToken: 'tok-unstamped',
    });

    await expect(
      (registerClientFromLink as unknown as Runnable).run(
        CLIENT_REQUEST({ firmId: 'firm-001', token: 'tok-unstamped' }),
      ),
    ).rejects.toThrow(/invalid or has expired/);
  });

  it('audits a generic-link prospect registration too', async () => {
    await (registerClientFromLink as unknown as Runnable).run(
      CLIENT_REQUEST({
        firmId: 'firm-001',
        // SYNTHETIC person — invented for this test.
        email: 'new.prospect@example.test',
        firstName: 'New',
        lastName: 'Prospect',
      }),
    );

    const entry = auditWrites.find((w) => w.data.eventType === 'client_registered');
    expect(entry).toBeDefined();
    expect((entry!.data.metadata as Record<string, unknown>).via).toBe('generic-link');
  });
});

describe('createClientRegistrationLink rotation (#170)', () => {
  it('reuses a token that is still inside its TTL', async () => {
    docStore.set('firms/firm-001/clients/client-1', {
      registrationToken: 'tok-live',
      registrationTokenCreatedAt: tsOf(NOW_MS - 2 * DAY_MS),
    });

    const res = (await (createClientRegistrationLink as unknown as Runnable).run(
      STAFF_REQUEST({ clientId: 'client-1' }),
    )) as { token: string };

    expect(res.token).toBe('tok-live');
  });

  it('re-mints instead of returning a dead link once the stored token expired', async () => {
    docStore.set('firms/firm-001/clients/client-1', {
      registrationToken: 'tok-dead',
      registrationTokenCreatedAt: tsOf(NOW_MS - 30 * DAY_MS),
    });

    const res = (await (createClientRegistrationLink as unknown as Runnable).run(
      STAFF_REQUEST({ clientId: 'client-1' }),
    )) as { token: string };

    expect(res.token).not.toBe('tok-dead');
    expect(res.token.length).toBeGreaterThan(20);
    expect(docStore.get('firms/firm-001/clients/client-1')!.registrationToken).toBe(res.token);
  });

  it('rotate: true mints a fresh token even while the old one is live', async () => {
    docStore.set('firms/firm-001/clients/client-1', {
      registrationToken: 'tok-live',
      registrationTokenCreatedAt: tsOf(NOW_MS - 1 * DAY_MS),
    });

    const res = (await (createClientRegistrationLink as unknown as Runnable).run(
      STAFF_REQUEST({ clientId: 'client-1', rotate: true }),
    )) as { token: string };

    expect(res.token).not.toBe('tok-live');
    expect(docStore.get('firms/firm-001/clients/client-1')!.registrationToken).toBe(res.token);
  });
});
