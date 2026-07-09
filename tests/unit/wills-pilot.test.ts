/**
 * tests/unit/wills-pilot.test.ts
 *
 * Regression tests for the wills-pilot acceptance-report math:
 *
 *  - R5-018  'extracted' (the processor's real success status) is terminal and
 *            counts as an extraction success. Pre-fix it was omitted from
 *            TERMINAL_STATUSES, so pollUntilTerminal spun to the 8-min timeout,
 *            every doc was labeled 'timeout', and the gate could never pass.
 *  - R5-063  error records (stored with document_type:'Other') do NOT count as
 *            classified — a non-null document_type alone must not inflate the
 *            classification_success_rate.
 *  - R5-064  'skipped' docs (legacy .doc, unsupported, deleted) never ran
 *            extraction and are excluded from extraction_success_rate.
 *
 * The three helpers under test are pure; they were exported from wills-pilot.ts
 * solely for this test (they touch no Firestore/Drive state).
 */

import { describe, it, expect, vi } from 'vitest';

// wills-pilot registers an onCall at import and imports googleapis/admin — none
// of which the pure helpers touch. Stub them so the import is cheap and inert.
vi.mock('../../functions/node_modules/firebase-admin', () => ({
  firestore: Object.assign(() => ({}), { DocumentData: {} }),
  initializeApp: vi.fn(),
}));
vi.mock('googleapis', () => ({ google: {} }));
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {},
}));
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

import { TERMINAL_STATUSES, isTerminalForRun, buildReport } from '../../functions/src/wills-pilot';

const STARTED = '2026-01-01T00:00:00.000Z';
const COMPLETED = '2026-01-01T00:01:00.000Z';
const THRESHOLDS = {
  classification_success_rate: 0.95,
  extraction_success_rate: 0.9,
  mean_extraction_confidence: 0.85,
  needs_review_rate: 0.3,
};

function sampleFile(id: string) {
  return {
    drive_file_id: id,
    file_name: `${id}.pdf`,
    drive_path: '',
    mime_type: 'application/pdf',
    file_size_bytes: 1,
    created_time: STARTED,
    modified_time: STARTED,
  };
}

// last_processed_at is at/after STARTED so the record is "this run", not stale.
function willDoc(status: string, extra: Record<string, unknown> = {}): any {
  return {
    processing_status: status,
    last_processed_at: '2026-01-01T00:00:30.000Z',
    needs_human_review: false,
    needs_human_review_reasons: [],
    ...extra,
  };
}

function report(pairs: Array<[string, any]>) {
  const sample = pairs.map(([id]) => sampleFile(id));
  const results = new Map<string, any>(pairs);
  return buildReport({ runId: 'run-1', startedAt: STARTED, completedAt: COMPLETED, sample, results, thresholds: THRESHOLDS });
}

describe('wills-pilot — extracted is terminal + counts (R5-018)', () => {
  it("TERMINAL_STATUSES includes 'extracted'", () => {
    expect(TERMINAL_STATUSES.has('extracted' as never)).toBe(true);
  });

  it('isTerminalForRun returns true for a fresh extracted doc', () => {
    expect(isTerminalForRun(willDoc('extracted'), STARTED)).toBe(true);
  });

  it('an extracted doc is a full extraction success, not a timeout', () => {
    const r = report([['f1', willDoc('extracted', { document_type: 'Will', extraction_confidence: 0.9 })]]);
    expect(r.per_doc[0].terminal_status).toBe('extracted');
    expect(r.extraction_success_rate).toBe(1);
  });
});

describe('wills-pilot — error records not classified (R5-063)', () => {
  it("a document_type:'Other' error record does not inflate the classification rate", () => {
    const r = report([
      ['f1', willDoc('extracted', { document_type: 'Will' })],
      ['f2', willDoc('error', { document_type: 'Other', processing_error: 'boom' })],
    ]);
    // Only the genuinely-classified 'extracted' doc counts → 1/2, not 2/2.
    expect(r.classification_success_rate).toBe(0.5);
  });
});

describe('wills-pilot — skipped excluded from extraction rate (R5-064)', () => {
  it("'skipped' docs are not counted as extraction successes", () => {
    const r = report([
      ['f1', willDoc('extracted', { document_type: 'Will', extraction_confidence: 0.9 })],
      ['f2', willDoc('skipped')],
    ]);
    // skipped never ran extraction → 1/2, not 2/2.
    expect(r.extraction_success_rate).toBe(0.5);
  });
});
