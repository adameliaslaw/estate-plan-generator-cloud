/**
 * tests/unit/generate-flex-honest.test.ts
 *
 * Regression test for R5-032: generateFlexDocument returned success:true
 * unconditionally, even when the orchestrator reported status:'error' (a failed
 * vault save — generateDocument catches saveError instead of throwing). success
 * must reflect the real outcome: `result.status !== 'error'`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const genDoc = vi.hoisted(() => ({ fn: vi.fn() }));

// firebase-functions resolves from functions/node_modules — mock the physical
// v2/https file so the mock actually intercepts (a bare specifier no-ops).
// Mock both the ESM (.mjs) and CJS (.js) entry points so it works regardless of
// which condition vitest resolves.
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
vi.mock('../../functions/src/unified-generator', () => ({
  generateDocument: genDoc.fn,
}));

import { generateFlexDocument } from '../../functions/src/generate-flex-document';

const REQ = {
  auth: { uid: 'u1', token: { role: 'attorney', firmId: 'firm-1' } },
  data: { firmId: 'firm-1', clientId: 'c1', docType: 'coverLetter' },
};

const handler = generateFlexDocument as unknown as (r: unknown) => Promise<{ success: boolean; status: string }>;

describe('generateFlexDocument — honest success (R5-032)', () => {
  beforeEach(() => genDoc.fn.mockReset());

  it('returns success:false when the generator result status is error', async () => {
    genDoc.fn.mockResolvedValue({ docId: 'coverLetter', docType: 'coverLetter', title: 'X', status: 'error' });
    const res = await handler(REQ);
    expect(res.success).toBe(false);
    expect(res.status).toBe('error');
  });

  it('returns success:true when the document saved (non-error status)', async () => {
    genDoc.fn.mockResolvedValue({ docId: 'coverLetter', docType: 'coverLetter', title: 'X', status: 'draft' });
    const res = await handler(REQ);
    expect(res.success).toBe(true);
  });
});
