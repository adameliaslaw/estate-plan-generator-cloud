/**
 * tests/emulator/wills-processor-failure-paths.test.ts
 *
 * Injected-failure integration tests for the wills-processor Pub/Sub handler
 * (T4 rows R5-058 / R5-059 / R5-060, all shipped in #112):
 *
 *   R5-058 — a corrupt/password-protected file made `_extractText` throw and
 *            the handler reject; the file vanished with NO wills_documents
 *            record (silent data loss). Now an error record is written.
 *   R5-059 — `_writeErrorRecord` merged a `document_type:'Other'` + error stub
 *            OVER an already-good record, so a transient failure on a
 *            'modified' event corrupted a correctly-classified document. Now a
 *            prior classified/extracted/indexed record is preserved.
 *   R5-060 — the daily-spend increment was fire-and-forget (droppable at CPU
 *            freeze) and the skip-extraction path never charged its
 *            classification cost. Now both paths charge via an awaited
 *            transaction before the handler resolves.
 *
 * Drives the REAL handler against the Firestore emulator. Only the process
 * boundaries are mocked: Drive fetch (failure injection / fixture bytes) and
 * the Claude classifier (canned result). Text extraction runs the real
 * mammoth on real bytes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { admin, uniq } from './_emulator';

// pdf-parse (raw require at module top) needs DOMMatrix at load time.
vi.hoisted(() => {
  const g = globalThis as typeof globalThis & { DOMMatrix?: unknown };
  if (!g.DOMMatrix) g.DOMMatrix = class DOMMatrix {};
});

// v2 pubsub trigger — return the raw handler (both resolvable paths).
vi.mock('../../functions/node_modules/firebase-functions/lib/esm/v2/providers/pubsub.mjs', () => ({
  onMessagePublished: (_opts: unknown, handler: unknown) => handler,
}));
vi.mock('../../functions/node_modules/firebase-functions/lib/v2/providers/pubsub.js', () => ({
  onMessagePublished: (_opts: unknown, handler: unknown) => handler,
}));
// defineSecret — the handler reads ANTHROPIC_API_KEY.value() up front.
vi.mock('../../functions/node_modules/firebase-functions/lib/esm/params/index.mjs', () => ({
  defineSecret: () => ({ value: () => 'test-key' }),
}));
vi.mock('../../functions/node_modules/firebase-functions/lib/params/index.js', () => ({
  defineSecret: () => ({ value: () => 'test-key' }),
}));
// Process boundaries: Drive fetch + classifier.
vi.mock('../../functions/src/wills-drive-client', () => ({ fetchDriveFile: vi.fn() }));
vi.mock('../../functions/src/wills-classifier', () => ({ classify: vi.fn() }));

import { willsProcessor } from '../../functions/src/wills-processor';
import { fetchDriveFile } from '../../functions/src/wills-drive-client';
import { classify } from '../../functions/src/wills-classifier';

type Handler = (event: unknown) => Promise<void>;
const handler = willsProcessor as unknown as Handler;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const controlRef = () => admin.firestore().doc('pipeline_state/control');
const docRef = (id: string) => admin.firestore().collection('wills_documents').doc(id);

const evt = (drive_file_id: string, file_name: string) => ({
  data: {
    message: {
      json: {
        drive_file_id,
        drive_path: 'Wills/Doe, John',
        file_name,
        event_type: 'created',
        source: 'test',
      },
    },
  },
});

const driveResult = (bytes: Buffer, fileName: string) => ({
  bytes,
  mimeType: DOCX_MIME,
  fileName,
  fileSizeBytes: bytes.length,
  createdTime: '2026-07-01T00:00:00.000Z',
  modifiedTime: '2026-07-01T00:00:00.000Z',
});

/** A real, valid .docx built with the functions' own docx library. */
async function validDocxBuffer(text: string): Promise<Buffer> {
  const { Document, Packer, Paragraph } = await import('../../functions/node_modules/docx');
  const doc = new Document({ sections: [{ children: [new Paragraph(text)] }] });
  return Packer.toBuffer(doc);
}

describe('willsProcessor — injected failure paths (R5-058/059/060)', () => {
  beforeEach(async () => {
    vi.mocked(fetchDriveFile).mockReset();
    vi.mocked(classify).mockReset();
    await controlRef().set({
      enabled: true, mode: 'live', daily_spend_usd: 0,
      daily_spend_reset_at: new Date().toISOString(),
      firmId: 'firm-pipeline-owner',
      kill_switch_set_by: null, kill_switch_set_at: null,
    });
  });

  it('a corrupt file writes an error record instead of vanishing (R5-058)', async () => {
    const id = uniq('corrupt');
    // Garbage bytes with a .docx name/mime — the real mammoth throws on them.
    vi.mocked(fetchDriveFile).mockResolvedValue(
      driveResult(Buffer.from('this is not a zip archive'), 'corrupt.docx'),
    );

    // Pre-fix the handler rejected here; now it must resolve…
    await handler(evt(id, 'corrupt.docx'));

    // …and leave a visible error record.
    const rec = await docRef(id).get();
    expect(rec.exists).toBe(true);
    expect(rec.get('processing_status')).toBe('error');
    expect(String(rec.get('processing_error'))).toContain('text_extraction_failed');
    expect(rec.get('needs_human_review')).toBe(true);
  });

  it('a transient failure does NOT clobber an already-classified record (R5-059)', async () => {
    const id = uniq('good');
    await docRef(id).set({
      drive_file_id: id,
      document_type: 'Will',
      processing_status: 'classified',
      firmId: 'firm-pipeline-owner',
      client_name: 'Doe, John',
    });
    // A 'modified' event arrives while Drive hiccups.
    vi.mocked(fetchDriveFile).mockRejectedValue(new Error('injected transient outage'));

    await handler(evt(id, 'doe-will.docx'));

    const rec = await docRef(id).get();
    // Pre-fix: document_type became 'Other', status 'error'. Now: preserved.
    expect(rec.get('document_type')).toBe('Will');
    expect(rec.get('processing_status')).toBe('classified');
    expect(rec.get('processing_error')).toBeUndefined();
  });

  it('the same transient failure with NO prior record still writes an error record', async () => {
    const id = uniq('fresh-fail');
    vi.mocked(fetchDriveFile).mockRejectedValue(new Error('injected transient outage'));

    await handler(evt(id, 'new-client.docx'));

    const rec = await docRef(id).get();
    expect(rec.exists).toBe(true);
    expect(rec.get('processing_status')).toBe('error');
    expect(String(rec.get('processing_error'))).toContain('drive_fetch_failed');
  });

  it('the skip-extraction path charges its classification cost before returning (R5-060)', async () => {
    const id = uniq('skip');
    vi.mocked(fetchDriveFile).mockResolvedValue(
      driveResult(await validDocxBuffer('Dear counsel, enclosed please find…'), 'letter.docx'),
    );
    // 'Correspondence' is in SKIP_EXTRACTION_TYPES → record written, no extract.
    vi.mocked(classify).mockResolvedValue({
      document_type: 'Correspondence', confidence: 0.95, firm_origin: 'current',
      is_likely_executed: false, language: 'en', page_count: 1,
      needs_human_review: false, needs_human_review_reasons: [],
      requires_ocr: false, notable_classification_concerns: [],
    });

    await handler(evt(id, 'letter.docx'));

    const rec = await docRef(id).get();
    expect(rec.get('processing_status')).toBe('classified');
    expect(rec.get('document_type')).toBe('Correspondence');

    // Pre-fix this path never charged: daily_spend_usd stayed 0. The handler
    // has RESOLVED, so the awaited transaction must already be visible — that
    // ordering is the fire-and-forget half of the fix.
    const control = await controlRef().get();
    expect(control.get('daily_spend_usd')).toBeGreaterThan(0);
  });
});
