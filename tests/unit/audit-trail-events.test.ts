/**
 * tests/unit/audit-trail-events.test.ts
 *
 * #172 — the audit-trail gaps: exports and integration syncs must write audit
 * entries, and payment amounts must stop being guessed at.
 *
 * 1. paymentAmountDisplay prefers the explicit `amountCents` every writer now
 *    stores, and only falls back to the legacy `amount` heuristic for records
 *    that predate it. The motivating case is real: a $1.00 live test charge
 *    (amount: 100, in cents per the data model) rendered as "$100.00" under
 *    the heuristic.
 * 2. exportDocumentPdf / exportDocumentDocx write a `document_exported` entry
 *    on success — including the preserved-binary short-circuit, the path a
 *    future edit is most likely to forget.
 * 3. syncClientToLevitate writes an `integration_synced` entry on a successful
 *    webhook push — and that entry never contains the webhook URL, which
 *    embeds a credential (#168).
 *
 * The callables are invoked through their v1 `.run()` handle with
 * firebase-admin, puppeteer, and chromium mocked; the audit write is asserted
 * against the mocked Firestore, so the real logAuditEvent runs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

interface CapturedWrite {
  path: string;
  data: Record<string, unknown>;
}

const auditWrites: CapturedWrite[] = [];
const docStore = new Map<string, Record<string, unknown>>();

function makeDocRef(path: string, id: string) {
  return {
    id,
    path: `${path}/${id}`,
    set: vi.fn(async (data: Record<string, unknown>) => {
      if (path.endsWith('/auditLog')) auditWrites.push({ path: `${path}/${id}`, data });
    }),
    update: vi.fn(async () => undefined),
    get: vi.fn(async () => {
      const data = docStore.get(`${path}/${id}`);
      return { exists: data !== undefined, data: () => data, id };
    }),
  };
}

let docCounter = 0;

const fakeFirestore = {
  doc: vi.fn((fullPath: string) => {
    const parts = fullPath.split('/');
    const id = parts.pop() as string;
    return makeDocRef(parts.join('/'), id);
  }),
  collection: vi.fn((path: string) => ({
    doc: vi.fn((id?: string) => makeDocRef(path, id ?? `auto-${++docCounter}`)),
    get: vi.fn(async () => ({ empty: true, docs: [] })),
  })),
};

const storedFile = {
  save: vi.fn(async () => undefined),
  exists: vi.fn(async () => [true]),
  download: vi.fn(async () => [Buffer.from('binary')]),
  getSignedUrl: vi.fn(async () => ['https://signed.example/url']),
};

vi.mock('firebase-admin', () => {
  const firestoreFn = (() => fakeFirestore) as unknown as {
    (): typeof fakeFirestore;
    Timestamp: { now: () => { seconds: number } };
    FieldValue: { serverTimestamp: () => string };
  };
  firestoreFn.Timestamp = { now: () => ({ seconds: 1754600000 }) };
  firestoreFn.FieldValue = { serverTimestamp: () => 'SERVER_TIMESTAMP' };
  return {
    default: { firestore: firestoreFn, storage: () => ({ bucket: () => ({ file: () => storedFile }) }) },
    firestore: firestoreFn,
    storage: () => ({ bucket: () => ({ file: () => storedFile }) }),
  };
});

vi.mock('puppeteer-core', () => ({
  default: {
    launch: vi.fn(async () => ({
      newPage: vi.fn(async () => ({
        setRequestInterception: vi.fn(async () => undefined),
        on: vi.fn(),
        setContent: vi.fn(async () => undefined),
        pdf: vi.fn(async () => Buffer.from('%PDF-fake')),
      })),
      close: vi.fn(async () => undefined),
      process: vi.fn(() => null),
    })),
  },
}));

vi.mock('@sparticuz/chromium', () => ({
  default: { executablePath: vi.fn(async () => '/fake/chromium'), args: [] },
}));

vi.mock('../../functions/src/firm-secrets', () => ({
  loadFirmSecrets: vi.fn(async () => ({})),
}));

import { paymentAmountDisplay } from '../../functions/src/audit-trail';
import { exportDocumentPdf } from '../../functions/src/export-pdf';
import { exportDocumentDocx } from '../../functions/src/export-docx';
import { syncClientToLevitate } from '../../functions/src/levitate-sync';

type Runnable = { run: (data: unknown, context: unknown) => Promise<unknown> };

const STAFF_CONTEXT = {
  auth: {
    uid: 'attorney-1',
    token: { role: 'attorney', firmId: 'firm-001', email: 'adam@example.test' },
  },
};

beforeEach(() => {
  auditWrites.length = 0;
  docStore.clear();
});

// ---------------------------------------------------------------------------
// 1. paymentAmountDisplay
// ---------------------------------------------------------------------------

describe('paymentAmountDisplay (#172 — amountCents at creation)', () => {
  it('prefers the explicit amountCents: a real $1.00 test charge displays as $1.00, not $100.00', () => {
    // Under the legacy heuristic alone (amount: 100 ≤ 500 → dollars), this
    // displayed as "$100.00" — the exact record Adam's live card test wrote.
    expect(paymentAmountDisplay({ amount: 100, amountCents: 100 })).toBe('$1.00');
  });

  it('prefers amountCents even when it disagrees with a heuristic-friendly amount', () => {
    expect(paymentAmountDisplay({ amount: 150000, amountCents: 150000 })).toBe('$1,500.00');
  });

  it('falls back to the legacy heuristic for records without amountCents', () => {
    expect(paymentAmountDisplay({ amount: 150000 })).toBe('$1,500.00'); // > 500 → cents
    expect(paymentAmountDisplay({ amount: 300 })).toBe('$300.00');      // ≤ 500 → dollars (legacy ambiguity)
  });

  it('reports unknown when neither field is a finite number', () => {
    expect(paymentAmountDisplay({})).toBe('unknown amount');
    expect(paymentAmountDisplay({ amount: 'x', amountCents: NaN })).toBe('unknown amount');
  });
});

// ---------------------------------------------------------------------------
// 2. Export callables write document_exported
// ---------------------------------------------------------------------------

describe('export audit events (#172)', () => {
  it('exportDocumentPdf writes a document_exported audit entry on success', async () => {
    docStore.set('firms/firm-001/clients/client-1/documents/doc-1', {
      displayName: 'Last Will and Testament',
      status: 'final',
      content: '<p>I revoke all prior wills.</p>',
    });

    const result = (await (exportDocumentPdf as unknown as Runnable).run(
      { firmId: 'firm-001', clientId: 'client-1', documentId: 'doc-1' },
      STAFF_CONTEXT,
    )) as { success: boolean };
    expect(result.success).toBe(true);

    const entry = auditWrites.find((w) => w.data.eventType === 'document_exported');
    expect(entry).toBeDefined();
    expect(entry!.path).toContain('firms/firm-001/auditLog/');
    expect(entry!.data.userId).toBe('attorney-1');
    expect(entry!.data.clientId).toBe('client-1');
    expect(entry!.data.documentId).toBe('doc-1');
    expect((entry!.data.metadata as Record<string, unknown>).format).toBe('pdf');
  });

  it('exportDocumentDocx audits the preserved-binary short-circuit path', async () => {
    docStore.set('firms/firm-001/clients/client-1/documents/doc-2', {
      displayName: 'Power of Attorney',
      status: 'final',
      content: '<p>I appoint my spouse.</p>',
      hasBinary: true,
      binaryStoragePath: 'firms/firm-001/clients/client-1/generated/doc-2.docx',
    });

    const result = (await (exportDocumentDocx as unknown as Runnable).run(
      { firmId: 'firm-001', clientId: 'client-1', documentId: 'doc-2' },
      STAFF_CONTEXT,
    )) as { success: boolean; source?: string };
    expect(result.success).toBe(true);

    const entry = auditWrites.find((w) => w.data.eventType === 'document_exported');
    expect(entry).toBeDefined();
    expect((entry!.data.metadata as Record<string, unknown>).format).toBe('docx');
  });
});

// ---------------------------------------------------------------------------
// 3. Levitate sync writes integration_synced, without the webhook URL
// ---------------------------------------------------------------------------

describe('Levitate sync audit event (#172)', () => {
  it('writes integration_synced on a successful webhook push, and the entry never carries the URL', async () => {
    const webhookUrl = 'https://hooks.example/secret-token-abc123';
    docStore.set('firms/firm-001', { levitateWebhookUrl: webhookUrl });

    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => '' }));
    vi.stubGlobal('fetch', fetchMock);

    const snap = {
      id: 'client-9',
      data: () => ({
        personalInfo: { firstName: 'Test', lastName: 'Client (synthetic)' },
        status: 'Drafting',
      }),
    };

    await (syncClientToLevitate as unknown as Runnable).run(snap, {
      params: { firmId: 'firm-001', clientId: 'client-9' },
    });

    expect(fetchMock).toHaveBeenCalledOnce();

    const entry = auditWrites.find((w) => w.data.eventType === 'integration_synced');
    expect(entry).toBeDefined();
    expect(entry!.data.clientId).toBe('client-9');
    expect((entry!.data.metadata as Record<string, unknown>).provider).toBe('levitate');
    expect((entry!.data.metadata as Record<string, unknown>).route).toBe('webhook');

    // The webhook URL embeds a credential (#168) — it must never reach the log.
    expect(JSON.stringify(entry!.data)).not.toContain('hooks.example');
    expect(JSON.stringify(entry!.data)).not.toContain('secret-token');

    vi.unstubAllGlobals();
  });
});
