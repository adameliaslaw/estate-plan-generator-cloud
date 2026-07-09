/**
 * tests/unit/esign-resend-clears-signed.test.ts
 *
 * Regression test for R5-014: re-sending a document for signature must clear any
 * executed-PDF pointer left by a PRIOR request. Before the fix, the resend's
 * `docRef.set(..., { merge: true })` preserved `signedStoragePath`, so
 * storeSignedPdf's idempotency guard short-circuited and the vault kept the
 * SUPERSEDED v1 signed PDF instead of the newly-executed one.
 *
 * The fix writes FieldValue.delete() for signedStoragePath/signedFileName/signedAt
 * on every send. This drives the real `sendForSignature` handler with a path-aware
 * Firestore mock (capturing the set payload), a stubbed Dropbox Sign `fetch`, and
 * inert Puppeteer/Chromium deps.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  apiKey: 'firm_dropbox_key_xyz',
  setPayload: null as Record<string, Record<string, unknown>> | null,
  activityAdds: [] as Record<string, unknown>[],
}));

const DELETE = 'DELETE_SENTINEL';

// v1 callable — return the raw (data, context) handler so we can invoke it.
// A bare `firebase-functions/v1` mock no-ops when the module resolves through
// functions/node_modules and is actually invoked, so mock both resolvable paths.
// The real chain is functions.runWith().region().https.onCall() — build a
// self-referential builder so runWith/region compose in any order.
// (Factory inlined into each call — vi.mock is hoisted above const declarations.)
const v1Factory = vi.hoisted(() => () => {
  class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
  }
  const https = { onCall: (handler: unknown) => handler, HttpsError };
  type Builder = { https: typeof https; runWith: () => Builder; region: () => Builder };
  const builder = { https } as Builder;
  builder.runWith = () => builder;
  builder.region = () => builder;
  return { runWith: builder.runWith, region: builder.region, https };
});
vi.mock('../../functions/node_modules/firebase-functions/lib/esm/v1/index.mjs', v1Factory);
vi.mock('../../functions/node_modules/firebase-functions/lib/v1/index.js', v1Factory);

// firm secrets → the Dropbox Sign API key.
vi.mock('../../functions/src/firm-secrets', () => ({
  loadFirmSecrets: async () => ({ dropboxSignApiKey: state.apiKey }),
}));

// Keep the heavy PDF/browser deps inert. renderDocumentPdf runs, but launches a
// fake browser whose page.pdf() returns a tiny buffer.
vi.mock('../../functions/node_modules/puppeteer-core', () => ({
  default: {
    launch: async () => ({
      newPage: async () => ({ setContent: async () => {}, pdf: async () => Buffer.from('%PDF-1.4') }),
      close: async () => {},
    }),
  },
}));
vi.mock('../../functions/node_modules/@sparticuz/chromium', () => ({
  default: { executablePath: async () => '', args: [] },
}));
vi.mock('../../functions/src/export-pdf', () => ({ buildLegalDocumentHtml: () => '<html></html>' }));

vi.mock('../../functions/node_modules/firebase-admin', () => {
  type MockColl = {
    doc: (id?: string) => MockRef;
    add: (data: Record<string, unknown>) => Promise<{ id: string }>;
  };
  type MockRef = {
    id: string | undefined;
    path: string;
    get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> }>;
    set: (payload: Record<string, Record<string, unknown>>) => Promise<void>;
    collection: (name: string) => MockColl;
  };
  const makeColl = (path: string): MockColl => ({
    doc: (id?: string) => makeRef(`${path}/${id ?? 'auto'}`),
    add: async (data: Record<string, unknown>) => {
      if (path.endsWith('activityLogs')) state.activityAdds.push(data);
      return { id: 'log' };
    },
  });
  const makeRef = (path: string): MockRef => ({
    id: path.split('/').pop(),
    path,
    get: async () => {
      if (path === 'firms/firm-1') {
        return { exists: true, data: () => ({ dropboxSignTestMode: true }) };
      }
      // The document being sent for signature.
      return {
        exists: true,
        data: () => ({ displayName: 'Last Will and Testament', htmlContent: '<p>…</p>', status: 'final' }),
      };
    },
    set: async (payload: Record<string, unknown>) => { state.setPayload = payload; },
    collection: (name: string) => makeColl(`${path}/${name}`),
  });
  const db = { collection: (name: string) => makeColl(name) };
  const firestore = Object.assign(() => db, {
    FieldValue: { serverTimestamp: () => 'ts', delete: () => DELETE },
  });
  return {
    firestore,
    storage: () => ({ bucket: () => ({ file: () => ({ save: vi.fn() }) }) }),
    initializeApp: vi.fn(),
  };
});

const fetchMock = vi.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({ signature_request: { signature_request_id: 'sig_NEW' } }),
}));
vi.stubGlobal('fetch', fetchMock);

import { sendForSignature } from '../../functions/src/esign-service';

const handler = sendForSignature as unknown as (
  data: unknown,
  context: unknown,
) => Promise<{ success: boolean; signatureRequestId: string; testMode: boolean }>;

const context = { auth: { uid: 'staff-1', token: { role: 'attorney', firmId: 'firm-1' } } };
const data = {
  firmId: 'firm-1',
  clientId: 'client-1',
  documentId: 'doc-1',
  signerName: 'Jane Client',
  signerEmail: 'jane@example.com',
};

describe('sendForSignature — resend clears prior signed-PDF pointer (R5-014)', () => {
  beforeEach(() => {
    state.setPayload = null;
    state.activityAdds = [];
    fetchMock.mockClear();
  });

  it('deletes signedStoragePath/signedFileName/signedAt on send', async () => {
    const res = await handler(data, context);

    expect(res.success).toBe(true);
    expect(res.signatureRequestId).toBe('sig_NEW');

    const eSig = state.setPayload?.eSignature;
    expect(eSig).toBeTruthy();
    // The R5-014 fix: these three must be delete sentinels, not preserved.
    expect(eSig.signedStoragePath).toBe(DELETE);
    expect(eSig.signedFileName).toBe(DELETE);
    expect(eSig.signedAt).toBe(DELETE);
  });

  it('records the NEW request id with status "sent"', async () => {
    await handler(data, context);
    const eSig = state.setPayload?.eSignature;
    expect(eSig.signatureRequestId).toBe('sig_NEW');
    expect(eSig.status).toBe('sent');
  });
});
