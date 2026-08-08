/**
 * tests/unit/levitate-sync-minimize.test.ts
 *
 * #168 agent half — the Levitate sync must not leak its credential or push
 * more identity than the CRM needs:
 *
 * 1. The webhook URL IS the credential (Zapier/Make-style) and must never
 *    reach Cloud Logging — no console line may contain it.
 * 2. The payload is minimized to the CRM contact card (name + email, per the
 *    issue's own spec) — street address, phone, zip and status stay out of
 *    the marketing platform.
 * 3. A failed push writes an integration_synced audit entry with
 *    outcome 'failed', so the integration cannot silently rot (issue item 5).
 *
 * The consent/default-off gate (issue item 3) is Adam's decision and is
 * deliberately not here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface CapturedWrite {
  path: string;
  data: Record<string, unknown>;
}

const auditWrites: CapturedWrite[] = [];
const docStore = new Map<string, Record<string, unknown>>();
let docCounter = 0;

function makeDocRef(path: string, id: string) {
  return {
    id,
    path: `${path}/${id}`,
    set: vi.fn(async (data: Record<string, unknown>) => {
      if (path.endsWith('/auditLog')) auditWrites.push({ path: `${path}/${id}`, data });
    }),
    get: vi.fn(async () => {
      const data = docStore.get(`${path}/${id}`);
      return { exists: data !== undefined, data: () => data, id };
    }),
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
  })),
};

vi.mock('firebase-admin', () => {
  const firestoreFn = (() => fakeFirestore) as unknown as {
    (): typeof fakeFirestore;
    Timestamp: { now: () => { seconds: number } };
  };
  firestoreFn.Timestamp = { now: () => ({ seconds: 1754700000 }) };
  return {
    default: { firestore: firestoreFn },
    firestore: firestoreFn,
  };
});

vi.mock('../../functions/src/firm-secrets', () => ({
  loadFirmSecrets: vi.fn(async () => ({})),
}));

import { syncClientToLevitate } from '../../functions/src/levitate-sync';

type Runnable = { run: (data: unknown, context: unknown) => Promise<unknown> };

const WEBHOOK_URL = 'https://hooks.example/secret-token-abc123';

const SNAP = {
  id: 'client-9',
  data: () => ({
    // SYNTHETIC client — invented for this test, not a real matter.
    personalInfo: {
      firstName: 'Test',
      lastName: 'Client',
      email: 'test.client@example.test',
      phone: '555-0100',
      address: '1 Synthetic Way',
      city: 'Testville',
      state: 'NJ',
      zip: '00000',
    },
    status: 'Drafting',
  }),
};

beforeEach(() => {
  auditWrites.length = 0;
  docStore.clear();
  docStore.set('firms/firm-001', { levitateWebhookUrl: WEBHOOK_URL });
});

async function runSync() {
  await (syncClientToLevitate as unknown as Runnable).run(SNAP, {
    params: { firmId: 'firm-001', clientId: 'client-9' },
  });
}

describe('Levitate sync (#168 agent half)', () => {
  it('never writes the webhook URL to any console line', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '' })));

    await runSync();

    const allConsole = [...logSpy.mock.calls, ...errSpy.mock.calls]
      .flat()
      .map((a) => String(a))
      .join('\n');
    expect(allConsole).not.toContain('hooks.example');
    expect(allConsole).not.toContain('secret-token');

    logSpy.mockRestore();
    errSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('pushes only the CRM contact card — no street address, phone, zip, or status', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => '' }));
    vi.stubGlobal('fetch', fetchMock);

    await runSync();

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>;
    expect(body).toMatchObject({
      firstName: 'Test',
      lastName: 'Client',
      email: 'test.client@example.test',
    });
    for (const forbidden of ['phone', 'address', 'city', 'state', 'zip', 'status']) {
      expect(body).not.toHaveProperty(forbidden);
    }

    vi.unstubAllGlobals();
  });

  it('a failed push writes an integration_synced audit entry with outcome failed — and a hostile error body cannot smuggle the URL into the logs', async () => {
    // Zapier/Make error bodies (Cloudflare-fronted) routinely echo the webhook
    // host or the full secret URL. The console must not repeat them. (The
    // first version of this test fed a benign body and masked exactly that —
    // found by adversarial verification.)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 410,
        text: async () => `{"status":"error","url":"${WEBHOOK_URL}","host":"hooks.example"}`,
      })),
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runSync();

    const entry = auditWrites.find((w) => w.data.eventType === 'integration_synced');
    expect(entry).toBeDefined();
    const metadata = entry!.data.metadata as Record<string, unknown>;
    expect(metadata.outcome).toBe('failed');
    expect(metadata.provider).toBe('levitate');
    // Neither the audit entry nor ANY console line may carry the URL — even
    // when the vendor's error body hands it to us.
    expect(JSON.stringify(entry!.data)).not.toContain('hooks.example');
    const allConsole = [...errSpy.mock.calls, ...logSpy.mock.calls]
      .flat()
      .map((a) => String(a))
      .join('\n');
    expect(allConsole).not.toContain('hooks.example');
    expect(allConsole).not.toContain('secret-token');

    errSpy.mockRestore();
    logSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('a successful push still writes the success entry (pinned in #315, kept honest here)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '' })));

    await runSync();

    const entry = auditWrites.find((w) => w.data.eventType === 'integration_synced');
    expect(entry).toBeDefined();
    expect((entry!.data.metadata as Record<string, unknown>).outcome).toBe('success');

    vi.unstubAllGlobals();
  });
});
