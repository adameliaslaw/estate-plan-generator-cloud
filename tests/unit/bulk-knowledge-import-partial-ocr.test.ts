/**
 * tests/unit/bulk-knowledge-import-partial-ocr.test.ts
 *
 * Regression test for R5-051 (backend half): a scanned PDF larger than the ~15MB
 * Gemini inline limit is byte-chunked, and only chunk 0 is OCR'd (later chunks
 * aren't valid standalone PDFs). Before the fix, the resource was saved with the
 * FULL pageCount as `ocrPagesCount` and reported as a clean success — a silent
 * partial import of legal reference content.
 *
 * The fix routes the completeness derivation through `deriveOcrCompleteness`: a
 * partial OCR reports `ocrPartial:true` and `ocrPagesCount:0` (byte-chunking
 * gives no reliable page boundary, so it does not fabricate a count). This tests
 * that exact arithmetic — the seam the bug lived in — without needing a real
 * multi-megabyte PDF fixture or the Gemini OCR call.
 */

import { describe, it, expect, vi } from 'vitest';

// pdf-parse needs DOMMatrix at load time; the test env lacks it and this module
// (unlike process-template-file) has no in-source polyfill. Define it via
// vi.hoisted so it runs BEFORE the hoisted module import.
vi.hoisted(() => {
  const g = globalThis as typeof globalThis & { DOMMatrix?: unknown };
  if (!g.DOMMatrix) g.DOMMatrix = class DOMMatrix {};
});

// The module registers an onCall at import and pulls in admin + ai-client; none
// are touched by the pure deriveOcrCompleteness helper. Keep them light.
vi.mock('../../functions/node_modules/firebase-admin', () => ({
  storage: vi.fn(),
  firestore: Object.assign(() => ({}), { FieldValue: { serverTimestamp: () => 'ts' } }),
  initializeApp: vi.fn(),
}));
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {},
}));
vi.mock('mammoth', () => ({ default: { convertToHtml: vi.fn(), extractRawText: vi.fn() } }));
vi.mock('../../functions/src/firm-secrets', () => ({ loadFirmSecrets: vi.fn() }));
vi.mock('../../functions/src/ai-client', () => ({
  callAI: vi.fn(), parseAIJson: vi.fn(), callAIWithVision: vi.fn(),
}));

import { deriveOcrCompleteness } from '../../functions/src/bulk-knowledge-import';

const MB = 1024 * 1024;
const MAX = 15 * MB; // production chunk size

describe('deriveOcrCompleteness — partial OCR honesty (R5-051)', () => {
  it('a >15MB scan is partial: pages unknown (0), chunks skipped', () => {
    // 15MB + 1 byte → 2 chunks; only chunk 0 is OCR'd, chunk 1 skipped.
    const out = deriveOcrCompleteness(MAX + 1, MAX, 100);
    expect(out.totalChunks).toBe(2);
    expect(out.chunksSkipped).toBe(1);
    expect(out.ocrPartial).toBe(true);
    expect(out.ocrPagesCount).toBe(0); // does NOT fabricate the full pageCount (the R5-051 bug)
  });

  it('a much larger scan skips all chunks beyond the first', () => {
    const out = deriveOcrCompleteness(31 * MB, MAX, 250);
    expect(out.totalChunks).toBe(3);
    expect(out.chunksSkipped).toBe(2);
    expect(out.ocrPartial).toBe(true);
    expect(out.ocrPagesCount).toBe(0);
  });

  it('a single-chunk (≤15MB) scan is complete: real page count, nothing skipped', () => {
    const out = deriveOcrCompleteness(1024, MAX, 100);
    expect(out.totalChunks).toBe(1);
    expect(out.chunksSkipped).toBe(0);
    expect(out.ocrPartial).toBe(false);
    expect(out.ocrPagesCount).toBe(100); // full pageCount only when nothing was skipped
  });

  it('exactly 15MB is still a single complete chunk', () => {
    const out = deriveOcrCompleteness(MAX, MAX, 42);
    expect(out.totalChunks).toBe(1);
    expect(out.ocrPartial).toBe(false);
    expect(out.ocrPagesCount).toBe(42);
  });
});
