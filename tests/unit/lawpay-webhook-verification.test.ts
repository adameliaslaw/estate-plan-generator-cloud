/**
 * tests/unit/lawpay-webhook-verification.test.ts
 *
 * 8am does not sign its webhooks. Their API reference documents delivery to an Event URL with
 * retries, and specifies no signing secret, HMAC, signature header or IP allowlist — which is why
 * creating a webhook in the LawPay dashboard issues no secret. The handler therefore establishes
 * authenticity two ways, and both are pinned here:
 *
 *   1. a token in the Event URL, compared in constant time;
 *   2. a re-read of the charge from the gateway, so the request BODY is never the source of truth.
 *
 * The second is the one that matters. Anyone who learns the Event URL can post a plausible
 * "charge.completed"; these tests assert that doing so cannot mark a payment paid, cannot choose
 * the amount, and cannot choose which Payment doc gets touched.
 *
 * This drives the real onRequest handler with a path-keyed Firestore mock and a stubbed fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const TOKEN = 'test-token-4d6f6e6579';

const state = vi.hoisted(() => ({
  /** Firestore docs by path. */
  docs: new Map<string, Record<string, unknown>>(),
  updates: [] as { path: string; payload: Record<string, unknown> }[],
  /** What the stubbed gateway returns for GET /v1/charges/:id */
  gateway: { status: 200, body: {} as Record<string, unknown> },
  fetchedUrls: [] as string[],
}));

vi.mock('../../functions/node_modules/firebase-functions/lib/esm/v2/providers/https.mjs', () => ({
  onRequest: (_opts: unknown, handler: unknown) => handler,
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
  },
}));
vi.mock('../../functions/node_modules/firebase-functions/lib/v2/providers/https.js', () => ({
  onRequest: (_opts: unknown, handler: unknown) => handler,
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
  },
}));

// The module registers a v1 callable too; keep the provider inert.
vi.mock('../../functions/node_modules/firebase-functions/lib/providers/https.js', () => ({
  onCall: (handler: unknown) => handler,
  onRequest: (handler: unknown) => handler,
}));

vi.mock('../../functions/node_modules/firebase-admin', () => {
  interface Ref { path: string; get: () => Promise<unknown> }
  const makeRef = (path: string): Ref => ({
    path,
    get: async () => ({
      exists: state.docs.has(path),
      data: () => state.docs.get(path) ?? {},
      ref: makeRef(path),
    }),
  });
  const collection = (base: string) => ({
    doc: (id: string) => {
      const path = `${base}/${id}`;
      return {
        ...makeRef(path),
        collection: (sub: string) => collection(`${path}/${sub}`),
      };
    },
  });
  const firestore = () => ({
    collection: (name: string) => collection(name),
    collectionGroup: () => ({
      where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
    }),
    runTransaction: async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        get: async (ref: Ref) => ({
          exists: state.docs.has(ref.path),
          data: () => state.docs.get(ref.path) ?? {},
        }),
        update: (ref: Ref, payload: Record<string, unknown>) => {
          state.updates.push({ path: ref.path, payload });
          state.docs.set(ref.path, { ...(state.docs.get(ref.path) ?? {}), ...payload });
        },
      };
      await fn(tx);
    },
  });
  const FieldValue = { serverTimestamp: () => 'SERVER_TS' };
  return {
    default: { firestore: Object.assign(firestore, { FieldValue }), apps: [{}], initializeApp: vi.fn() },
    firestore: Object.assign(firestore, { FieldValue }),
    apps: [{}],
    initializeApp: vi.fn(),
  };
});

const PAYMENT_PATH = 'firms/firm-1/clients/client-1/payments/pay-1';
const DECOY_PATH = 'firms/firm-1/clients/client-1/payments/pay-decoy';

/** Minimal Express-ish response capturing what the handler answered. */
function makeRes() {
  const out = { code: 0, body: '' };
  return {
    res: {
      status(c: number) { out.code = c; return this; },
      send(b: string) { out.body = b; return this; },
    },
    out,
  };
}

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    path: '/lawpayWebhook',
    query: {} as Record<string, unknown>,
    body: { type: 'charge.completed', data: { id: 'txn-1' } },
    ...overrides,
  };
}

let lawpayWebhook: (req: unknown, res: unknown) => Promise<void>;

beforeEach(async () => {
  state.docs.clear();
  state.updates.length = 0;
  state.fetchedUrls.length = 0;
  state.docs.set(PAYMENT_PATH, { status: 'pending', amount: 5000 });
  state.docs.set(DECOY_PATH, { status: 'pending', amount: 5000 });
  state.gateway = {
    status: 200,
    body: { id: 'txn-1', status: 'AUTHORIZED', amount: 5000, reference: 'firm-1::client-1::pay-1' },
  };

  process.env.LAWPAY_WEBHOOK_TOKEN = TOKEN;
  process.env.LAWPAY_API_KEY = 'sk_test_key';

  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    state.fetchedUrls.push(String(url));
    return {
      ok: state.gateway.status >= 200 && state.gateway.status < 300,
      status: state.gateway.status,
      json: async () => state.gateway.body,
    };
  }));

  vi.resetModules();
  ({ lawpayWebhook } = await import('../../functions/src/lawpay-integration') as unknown as {
    lawpayWebhook: (req: unknown, res: unknown) => Promise<void>;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('lawpayWebhook — caller authentication by Event URL token', () => {
  it('rejects a request carrying no token, without calling the gateway', async () => {
    const { res, out } = makeRes();
    await lawpayWebhook(makeReq(), res);
    expect(out.code).toBe(401);
    expect(state.fetchedUrls).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
  });

  it('rejects a wrong token', async () => {
    const { res, out } = makeRes();
    await lawpayWebhook(makeReq({ query: { token: 'not-the-token' } }), res);
    expect(out.code).toBe(401);
    expect(state.updates).toHaveLength(0);
  });

  it('accepts the token as a query parameter', async () => {
    const { res, out } = makeRes();
    await lawpayWebhook(makeReq({ query: { token: TOKEN } }), res);
    expect(out.code).toBe(200);
    expect(state.fetchedUrls).toHaveLength(1);
  });

  it('accepts the token as a path segment', async () => {
    const { res, out } = makeRes();
    await lawpayWebhook(makeReq({ path: `/lawpayWebhook/${TOKEN}` }), res);
    expect(out.code).toBe(200);
    expect(state.fetchedUrls).toHaveLength(1);
  });

  it('fails closed when the token is not configured at all', async () => {
    delete process.env.LAWPAY_WEBHOOK_TOKEN;
    const { res, out } = makeRes();
    await lawpayWebhook(makeReq({ query: { token: TOKEN } }), res);
    expect(out.code).toBe(401);
  });
});

describe('lawpayWebhook — the gateway is the source of truth, not the body', () => {
  const authed = (extra: Record<string, unknown> = {}) =>
    makeReq({ query: { token: TOKEN }, ...extra });

  it('marks the payment paid using the GATEWAY amount, ignoring the amount in the body', async () => {
    const { res, out } = makeRes();
    await lawpayWebhook(authed({
      body: { type: 'charge.completed', data: { id: 'txn-1', amount: 9_999_999, status: 'COMPLETED' } },
    }), res);

    expect(out.code).toBe(200);
    const update = state.updates.find((u) => u.path === PAYMENT_PATH);
    expect(update?.payload.status).toBe('paid');
    expect(update?.payload.amountPaid).toBe(5000); // gateway's figure, not 9,999,999
  });

  it('touches the doc the GATEWAY reference names, ignoring a reference in the body', async () => {
    const { res } = makeRes();
    await lawpayWebhook(authed({
      body: {
        type: 'charge.completed',
        // A forged body pointing at another client's payment record.
        data: { id: 'txn-1', reference: 'firm-1::client-1::pay-decoy' },
      },
    }), res);

    expect(state.updates.map((u) => u.path)).toEqual([PAYMENT_PATH]);
    expect(state.docs.get(DECOY_PATH)?.status).toBe('pending');
  });

  it('refuses to mark paid when the gateway says the charge did not succeed', async () => {
    state.gateway.body = { id: 'txn-1', status: 'FAILED', amount: 5000, reference: 'firm-1::client-1::pay-1' };
    const { res, out } = makeRes();
    await lawpayWebhook(authed(), res);

    expect(out.code).toBe(200);
    expect(state.updates).toHaveLength(0);
    expect(state.docs.get(PAYMENT_PATH)?.status).toBe('pending');
  });

  it('refuses to mark paid on an unrecognised gateway status rather than assuming success', async () => {
    state.gateway.body = { id: 'txn-1', status: 'SOMETHING_NEW', amount: 5000, reference: 'firm-1::client-1::pay-1' };
    const { res, out } = makeRes();
    await lawpayWebhook(authed(), res);

    expect(out.code).toBe(200);
    expect(state.updates).toHaveLength(0);
  });

  it('ignores an event for a transaction the gateway has never heard of', async () => {
    state.gateway.status = 404;
    const { res, out } = makeRes();
    await lawpayWebhook(authed(), res);

    expect(out.code).toBe(200);
    expect(state.updates).toHaveLength(0);
  });

  it('asks for redelivery when verification could not be completed', async () => {
    state.gateway.status = 500;
    const { res, out } = makeRes();
    await lawpayWebhook(authed(), res);

    // Non-200 is deliberate: 8am retries every 10 minutes, which is what we want when the
    // alternative is dropping a real payment or acting on an unverified one.
    expect(out.code).toBe(503);
    expect(state.updates).toHaveLength(0);
  });

  it('asks for redelivery when our own API credentials are missing', async () => {
    delete process.env.LAWPAY_API_KEY;
    const { res, out } = makeRes();
    await lawpayWebhook(authed(), res);
    expect(out.code).toBe(503);
    expect(state.fetchedUrls).toHaveLength(0);
  });

  it('re-reads the charge by the id from the body, on the gateway charges resource', async () => {
    const { res } = makeRes();
    await lawpayWebhook(authed(), res);
    expect(state.fetchedUrls[0]).toBe('https://api.8am.com/v1/charges/txn-1');
  });
});
