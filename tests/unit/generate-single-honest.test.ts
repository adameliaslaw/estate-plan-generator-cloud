/**
 * tests/unit/generate-single-honest.test.ts
 *
 * Regression test for findings E/A/AE/B: generateSingleDocument must
 *   (E) derive `success` from the per-doc status/counts — not report
 *       success:true when the orchestrator returned status:'error'; and
 *   (B) preserve a typed HttpsError code (not-found, failed-precondition, …)
 *       instead of flattening every failure to 'internal'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const uni = vi.hoisted(() => ({
  generateDocument: vi.fn(),
  generateDocumentWithPropertyExpansion: vi.fn(),
}));

// Shared error class so the handler's `error instanceof HttpsError` check sees
// the same constructor the test throws. Hoisted for the mock factories.
const { MockHttpsError } = vi.hoisted(() => {
  class MockHttpsError extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
  }
  return { MockHttpsError };
});

// firebase-functions resolves from functions/node_modules — mock the physical
// v2/https file so the mock actually intercepts (a bare specifier no-ops).
// Mock both the ESM (.mjs) and CJS (.js) entry points.
vi.mock('../../functions/node_modules/firebase-functions/lib/esm/v2/providers/https.mjs', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: MockHttpsError,
}));
vi.mock('../../functions/node_modules/firebase-functions/lib/v2/providers/https.js', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: MockHttpsError,
}));
vi.mock('../../functions/node_modules/firebase-admin', () => ({
  firestore: Object.assign(
    () => ({ doc: () => ({ update: vi.fn(async () => undefined) }) }),
    { FieldValue: { serverTimestamp: () => 'ts' }, Timestamp: class {}, DocumentData: {} },
  ),
  initializeApp: vi.fn(),
}));
vi.mock('../../functions/src/unified-generator', () => ({
  generateDocument: uni.generateDocument,
  generateDocumentWithPropertyExpansion: uni.generateDocumentWithPropertyExpansion,
}));

import { generateSingleDocument } from '../../functions/src/generate-single-document';

const REQ = {
  auth: { uid: 'u1', token: { role: 'attorney', firmId: 'firm-1' } },
  data: { firmId: 'firm-1', clientId: 'c1', docType: 'will' },
} as any;

const handler = generateSingleDocument as unknown as (r: unknown) => Promise<any>;

describe('generateSingleDocument — honest success + error codes (E/A/AE/B)', () => {
  beforeEach(() => {
    uni.generateDocument.mockReset();
    uni.generateDocumentWithPropertyExpansion.mockReset();
  });

  it('reports success:false when a generated doc has status error (E)', async () => {
    uni.generateDocumentWithPropertyExpansion.mockResolvedValue([
      { docId: 'will', docType: 'will', title: 'Will', status: 'error', currentVersion: 0 },
    ]);
    const res = await handler(REQ);
    expect(res.success).toBe(false);
    expect(res.status).toBe('error');
  });

  it('reports success:true for a saved doc (draft status)', async () => {
    uni.generateDocumentWithPropertyExpansion.mockResolvedValue([
      { docId: 'will', docType: 'will', title: 'Will', status: 'draft', currentVersion: 1 },
    ]);
    const res = await handler(REQ);
    expect(res.success).toBe(true);
    expect(res.status).toBe('draft');
  });

  it('preserves a typed HttpsError code instead of flattening to internal (B)', async () => {
    uni.generateDocumentWithPropertyExpansion.mockRejectedValue(
      new MockHttpsError('failed-precondition', 'no spouse info'),
    );
    await expect(handler(REQ)).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('wraps a plain Error as internal', async () => {
    uni.generateDocumentWithPropertyExpansion.mockRejectedValue(new Error('boom'));
    await expect(handler(REQ)).rejects.toMatchObject({ code: 'internal' });
  });
});
