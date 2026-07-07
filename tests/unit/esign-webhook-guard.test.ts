/**
 * tests/unit/esign-webhook-guard.test.ts
 *
 * Regression test for R5-013: dropboxSignWebhook applied any HMAC-valid event to
 * the document named in its (untrusted) metadata WITHOUT checking that the
 * event's signature_request_id matched the one currently stored on that doc.
 * A delayed/replayed retry of a SUPERSEDED request — or a forged event whose
 * metadata was edited to point at another document — could flip the wrong doc's
 * status or (on a downloadable event) pull a stale executed PDF into it.
 *
 * The fix (esign-service.ts ~L404-418) compares the incoming
 * signature_request_id to the stored eSignature.signatureRequestId and ignores
 * the event (acking 200 so Dropbox Sign stops retrying) when they differ.
 *
 * This drives the real onRequest handler through the real HMAC verification
 * (esign-hmac is left un-mocked) with a path-aware Firestore mock; only the
 * heavy PDF/browser deps — never touched on the webhook path — are stubbed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';

const state = vi.hoisted(() => ({
  apiKey: 'firm_dropbox_key_xyz',
  storedSigReqId: '',
  storedStatus: 'sent',
  txUpdate: null as Record<string, unknown> | null,
  activityAdds: [] as Record<string, unknown>[],
}));

// v2 https provider — return the raw handler (both esm + cjs resolution paths).
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

// Firm secrets → the HMAC key the handler verifies against.
vi.mock('../../functions/src/firm-secrets', () => ({
  loadFirmSecrets: async () => ({ dropboxSignApiKey: state.apiKey }),
}));

// Keep the module's heavy deps inert — the webhook path never uses them, but
// they load at import time.
vi.mock('../../functions/node_modules/puppeteer-core', () => ({ default: { launch: vi.fn() } }));
vi.mock('../../functions/node_modules/@sparticuz/chromium', () => ({
  default: { executablePath: async () => '', args: [] },
}));
vi.mock('../../functions/src/export-pdf', () => ({ buildLegalDocumentHtml: () => '' }));

vi.mock('../../functions/node_modules/firebase-admin', () => {
  const makeColl = (path: string): any => ({
    doc: (id?: string) => makeRef(`${path}/${id ?? 'auto'}`),
    add: async (data: Record<string, unknown>) => {
      if (path.endsWith('activityLogs')) state.activityAdds.push(data);
      return { id: 'log' };
    },
  });
  const makeRef = (path: string): any => ({
    id: path.split('/').pop(),
    path,
    get: async () => ({
      exists: true,
      data: () => ({ eSignature: { signatureRequestId: state.storedSigReqId, status: state.storedStatus } }),
    }),
    collection: (name: string) => makeColl(`${path}/${name}`),
  });
  const db = {
    collection: (name: string) => makeColl(name),
    runTransaction: async (fn: (tx: any) => Promise<void>) => {
      const tx = {
        get: async (ref: any) => ref.get(),
        update: (_ref: any, data: Record<string, unknown>) => { state.txUpdate = data; },
      };
      await fn(tx);
    },
  };
  const firestore = Object.assign(() => db, {
    FieldValue: { serverTimestamp: () => 'ts', delete: () => 'DELETE' },
  });
  return {
    firestore,
    storage: () => ({ bucket: () => ({ file: () => ({ save: vi.fn() }) }) }),
    initializeApp: vi.fn(),
  };
});

import { dropboxSignWebhook } from '../../functions/src/esign-service';

const handler = dropboxSignWebhook as unknown as (req: any, res: any) => Promise<void>;
const WEBHOOK_ACK = 'Hello API Event Received';

// Build a Dropbox Sign multipart/form-data callback with a correctly HMAC-signed
// event (HMAC-SHA256(event_time + event_type) keyed by the firm's API key).
function buildRequest(opts: { eventType: string; incomingSigReqId: string }) {
  const eventTime = '1700000000';
  const eventHash = createHmac('sha256', state.apiKey).update(eventTime + opts.eventType).digest('hex');
  const payload = {
    event: { event_time: eventTime, event_type: opts.eventType, event_hash: eventHash },
    signature_request: {
      signature_request_id: opts.incomingSigReqId,
      title: 'Last Will and Testament',
      metadata: { firmId: 'firm-1', clientId: 'client-1', documentId: 'doc-1' },
    },
  };
  const boundary = 'X-BOUNDARY-abc123';
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="json"\r\n\r\n` +
    `${JSON.stringify(payload)}\r\n` +
    `--${boundary}--\r\n`;
  return {
    method: 'POST',
    rawBody: Buffer.from(body, 'utf8'),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

function fakeRes() {
  const captured = { code: 0, body: '' };
  const res = {
    status: (c: number) => {
      captured.code = c;
      return { send: (b: string) => { captured.body = b; } };
    },
  };
  return { res, captured };
}

describe('dropboxSignWebhook — stale/foreign signature_request_id guard (R5-013)', () => {
  beforeEach(() => {
    state.storedSigReqId = '';
    state.storedStatus = 'sent';
    state.txUpdate = null;
    state.activityAdds = [];
  });

  it('ignores an HMAC-valid event whose signature_request_id != the one stored on the doc', async () => {
    state.storedSigReqId = 'req_CURRENT';
    const { res, captured } = fakeRes();

    await handler(buildRequest({ eventType: 'signature_request_signed', incomingSigReqId: 'req_SUPERSEDED' }), res);

    expect(state.txUpdate).toBeNull();          // no status write to the wrong request's doc
    expect(state.activityAdds).toHaveLength(0); // nothing logged
    expect(captured.code).toBe(200);            // acked so Dropbox Sign stops retrying
    expect(captured.body).toBe(WEBHOOK_ACK);
  });

  it('applies the event when the signature_request_id matches the stored one', async () => {
    state.storedSigReqId = 'req_CURRENT';
    const { res, captured } = fakeRes();

    await handler(buildRequest({ eventType: 'signature_request_signed', incomingSigReqId: 'req_CURRENT' }), res);

    expect(state.txUpdate).toMatchObject({ 'eSignature.status': 'signed' });
    expect(state.activityAdds).toHaveLength(1);
    expect(captured.code).toBe(200);
  });
});
