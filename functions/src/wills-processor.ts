/**
 * functions/src/wills-processor.ts
 *
 * Pub/Sub-triggered Cloud Function — the core of the Wills ingestion pipeline.
 * Processes one Drive file event end-to-end through 10 steps.
 *
 * Pub/Sub topic: wills-document-processing
 * Create with: gcloud pubsub topics create wills-document-processing \
 *              --project=estate-plan-generator
 *
 * Steps:
 *   1.  Check kill switch   (pipeline_state/control.enabled)
 *   2.  Check cost circuit breaker
 *   3.  Fetch file bytes from Drive API
 *   4.  Detect format; extract text (mammoth / pdf-parse)
 *   5.  Parse folder path → client_name, matter_id, version_label
 *   6.  Classify (claude-haiku-4-5-20251001)
 *   7.  Route: Correspondence | Other | requires_ocr → write record, done
 *   8.  Extract metadata (claude-sonnet-4-6)
 *   9.  Validate schema; stub on second failure
 *  10.  Write Firestore record, push to PageIndex, write audit log
 */

import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import mammoth from 'mammoth';
// pdf-parse v2 ships a CJS module; import via require for correct callable shape
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string; numpages: number }>;

import type {
  WillsIngestMessage, WillsDocument, PipelineControl,
} from './wills-schema';
import { fetchDriveFile } from './wills-drive-client';
import { classify } from './wills-classifier';
import { extract } from './wills-extractor';
import { writePipelineAuditEntry } from './wills-audit';

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

const PAGEINDEX_API_KEY = defineSecret('PAGEINDEX_API_KEY');
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

export const WILLS_PUBSUB_TOPIC = 'wills-document-processing';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGEINDEX_BASE        = 'https://api.pageindex.ai';
const PAGEINDEX_NAMESPACE   = 'work-product' as const;
const OCR_TEXT_MIN_CHARS    = 100;
const BACKFILL_SPEND_LIMIT  = 50;   // USD / day in backfill mode
const LIVE_SPEND_LIMIT      = 5;    // USD / day in live mode

// Doc types that skip extraction + PageIndex indexing
const SKIP_EXTRACTION_TYPES = new Set(['Correspondence', 'Letter-of-Instruction', 'Other']);

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const willsProcessor = onMessagePublished(
  {
    topic: WILLS_PUBSUB_TOPIC,
    region: 'us-east1',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [PAGEINDEX_API_KEY, ANTHROPIC_API_KEY],
  },
  async (event) => {
    // ── Parse Pub/Sub message ───────────────────────────────────────────────
    let msg: WillsIngestMessage;
    try {
      msg = event.data.message.json as WillsIngestMessage;
    } catch (err) {
      logger.error('[willsProcessor] Invalid Pub/Sub message JSON — dropping', {
        error: err instanceof Error ? err.message : String(err),
        data: event.data.message.data,
      });
      return; // ack so it isn't retried
    }

    const { drive_file_id, drive_path, file_name, event_type, source } = msg;
    const startMs = Date.now();

    logger.info('[willsProcessor] start', { drive_file_id, event_type, source });

    // Handle deletions — remove from Firestore if present
    if (event_type === 'deleted') {
      await _handleDeletion(drive_file_id);
      return;
    }

    const db = admin.firestore();
    const anthropicKey = ANTHROPIC_API_KEY.value();
    const pageIndexKey = PAGEINDEX_API_KEY.value();

    // ── Step 1: Kill switch ─────────────────────────────────────────────────
    const control = await _readControl(db);
    if (!control.enabled) {
      logger.warn('[willsProcessor] kill switch active — dropping', { drive_file_id });
      writePipelineAuditEntry({
        action: 'ingestion_skipped', drive_file_id, pageindex_doc_id: null,
        user_uid: null, query_text: null, results_returned: null, duration_ms: null,
        error: 'kill_switch_active', firmId: control.firmId ?? 'unknown',
      }, db);
      return;
    }

    // ── Step 2: Cost circuit breaker ────────────────────────────────────────
    const spendLimit = control.mode === 'backfill' ? BACKFILL_SPEND_LIMIT : LIVE_SPEND_LIMIT;
    if (control.daily_spend_usd >= spendLimit) {
      logger.warn('[willsProcessor] daily spend limit reached — dropping', {
        drive_file_id, spent: control.daily_spend_usd, limit: spendLimit,
      });
      return;
    }

    const firmId: string = control.firmId ?? 'unknown';

    writePipelineAuditEntry({
      action: 'ingestion_started', drive_file_id, pageindex_doc_id: null,
      user_uid: null, query_text: null, results_returned: null, duration_ms: null,
      error: null, firmId,
    }, db);

    // ── Step 3: Fetch file bytes from Drive ─────────────────────────────────
    let driveFile: Awaited<ReturnType<typeof fetchDriveFile>>;
    try {
      driveFile = await fetchDriveFile(drive_file_id);
    } catch (err) {
      await _writeErrorRecord(db, drive_file_id, drive_path, file_name, firmId,
        `drive_fetch_failed: ${(err as Error).message}`);
      logger.error('[willsProcessor] Drive fetch failed', { drive_file_id, err });
      return;
    }

    const { bytes, mimeType, fileName, fileSizeBytes, createdTime, modifiedTime } = driveFile;

    // ── Step 4: Detect format + extract text ───────────────────────────────
    const { text, fileFormat, pageCount, requiresOcr } = await _extractText(bytes, mimeType, fileName);

    // .doc (legacy) — flag and skip
    if (fileFormat === 'doc') {
      await _writeSkipRecord(db, drive_file_id, drive_path, fileName, fileSizeBytes,
        createdTime, modifiedTime, firmId, 'legacy .doc format', fileFormat);
      return;
    }

    // Other unsupported formats
    if (fileFormat === 'other') {
      await _writeSkipRecord(db, drive_file_id, drive_path, fileName, fileSizeBytes,
        createdTime, modifiedTime, firmId, 'unsupported format', fileFormat);
      return;
    }

    // ── Step 5: Parse folder path ───────────────────────────────────────────
    const { clientName, matterId, versionLabel } = _parseFolderPath(drive_path, fileName);

    // ── Step 6: Classify ────────────────────────────────────────────────────
    let classification: Awaited<ReturnType<typeof classify>>;
    try {
      classification = await classify(text, fileName, anthropicKey);
    } catch (err) {
      await _writeErrorRecord(db, drive_file_id, drive_path, fileName, firmId,
        `classification_failed: ${(err as Error).message}`);
      logger.error('[willsProcessor] Classification failed', { drive_file_id, err });
      return;
    }

    logger.info('[willsProcessor] classified', {
      drive_file_id, document_type: classification.document_type,
      confidence: classification.confidence,
    });

    writePipelineAuditEntry({
      action: 'classification_completed', drive_file_id, pageindex_doc_id: null,
      user_uid: null, query_text: null, results_returned: null, duration_ms: Date.now() - startMs,
      error: null, firmId,
    }, db);

    // ── Step 7: Route — skip extraction for Correspondence / Other / OCR ────
    const skipExtraction = SKIP_EXTRACTION_TYPES.has(classification.document_type)
      || classification.requires_ocr || requiresOcr;

    if (skipExtraction) {
      const docRef = db.collection('wills_documents').doc(drive_file_id);
      const record: WillsDocument = _buildBaseRecord({
        drive_file_id, drive_path, clientName, matterId, versionLabel,
        fileFormat, fileSizeBytes, createdTime, modifiedTime,
        fileName, pageCount, firmId, classification, requiresOcr,
        processing_status: 'classified',
        extraction_confidence: null,
        field_confidence: null,
        type_fields: null,
        pageindex_doc_id: null,
      });
      await docRef.set(record);

      writePipelineAuditEntry({
        action: 'ingestion_completed', drive_file_id, pageindex_doc_id: null,
        user_uid: null, query_text: null, results_returned: null,
        duration_ms: Date.now() - startMs, error: null, firmId,
      }, db);
      logger.info('[willsProcessor] skipped extraction (type/ocr)', { drive_file_id });
      return;
    }

    // ── Step 8: Extract metadata ────────────────────────────────────────────
    let extraction: Awaited<ReturnType<typeof extract>>;
    try {
      extraction = await extract(text, classification.document_type, anthropicKey);
    } catch (err) {
      extraction = {
        extraction_confidence: 0,
        field_confidence: {},
        type_fields: null,
      };
      logger.error('[willsProcessor] Extraction failed — using stub', { drive_file_id, err });
    }

    writePipelineAuditEntry({
      action: 'extraction_completed', drive_file_id, pageindex_doc_id: null,
      user_uid: null, query_text: null, results_returned: null, duration_ms: Date.now() - startMs,
      error: null, firmId,
    }, db);

    // ── Step 9: Merge needs_human_review from both stages ───────────────────
    const needsHumanReview = classification.needs_human_review
      || extraction.extraction_confidence < 0.7
      || extraction.type_fields === null;

    const needsHumanReviewReasons = [
      ...classification.needs_human_review_reasons,
      ...(extraction.type_fields === null ? ['extraction_schema_failure'] : []),
    ];

    // ── Step 10a: Write Firestore record ────────────────────────────────────
    const docRef = db.collection('wills_documents').doc(drive_file_id);
    const record: WillsDocument = _buildBaseRecord({
      drive_file_id, drive_path, clientName, matterId, versionLabel,
      fileFormat, fileSizeBytes, createdTime, modifiedTime,
      fileName, pageCount, firmId, classification, requiresOcr,
      processing_status: 'extracted',
      extraction_confidence: extraction.extraction_confidence,
      field_confidence: extraction.field_confidence,
      type_fields: extraction.type_fields,
      pageindex_doc_id: null,
      needs_human_review_override: needsHumanReview,
      needs_human_review_reasons_override: needsHumanReviewReasons,
    });
    await docRef.set(record);

    // ── Step 10b: Push to PageIndex ─────────────────────────────────────────
    let pageIndexDocId: string | null = null;
    try {
      pageIndexDocId = await _uploadToPageIndex(bytes, fileName, mimeType, pageIndexKey);
      await docRef.update({
        pageindex_doc_id: pageIndexDocId,
        processing_status: 'indexed',
      });

      // Register in existing pageindex_docs collection for RAG retrieval
      await db.collection(`pageindex_docs/${PAGEINDEX_NAMESPACE}/files`).doc(pageIndexDocId).set({
        doc_id: pageIndexDocId,
        fileName,
        namespace: PAGEINDEX_NAMESPACE,
        firmId,
        drive_file_id,
        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      writePipelineAuditEntry({
        action: 'pageindex_submitted', drive_file_id, pageindex_doc_id: pageIndexDocId,
        user_uid: null, query_text: null, results_returned: null, duration_ms: Date.now() - startMs,
        error: null, firmId,
      }, db);
    } catch (err) {
      logger.error('[willsProcessor] PageIndex upload failed', { drive_file_id, err });
      await docRef.update({ processing_status: 'error', processing_error: (err as Error).message });
    }

    // ── Step 10c: Update daily spend estimate ───────────────────────────────
    _incrementDailySpend(db, _estimateCost(text)).catch((e: unknown) =>
      logger.warn('[willsProcessor] spend tracking failed', { err: String(e) }),
    );

    writePipelineAuditEntry({
      action: 'ingestion_completed', drive_file_id, pageindex_doc_id: pageIndexDocId,
      user_uid: null, query_text: null, results_returned: null,
      duration_ms: Date.now() - startMs, error: null, firmId,
    }, db);

    logger.info('[willsProcessor] done', {
      drive_file_id, document_type: classification.document_type,
      pageindex_doc_id: pageIndexDocId, duration_ms: Date.now() - startMs,
    });
  },
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function _readControl(db: admin.firestore.Firestore): Promise<PipelineControl & { firmId?: string }> {
  const snap = await db.doc('pipeline_state/control').get();
  if (!snap.exists) {
    return { enabled: true, mode: 'live', kill_switch_set_by: null, kill_switch_set_at: null,
             daily_spend_usd: 0, daily_spend_reset_at: null };
  }
  return snap.data() as PipelineControl & { firmId?: string };
}

async function _extractText(bytes: Buffer, mimeType: string, fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'doc') {
    return { text: '', fileFormat: 'doc' as const, pageCount: 0, requiresOcr: false };
  }

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      || ext === 'docx') {
    const result = await mammoth.extractRawText({ buffer: bytes });
    return {
      text: result.value,
      fileFormat: 'docx' as const,
      pageCount: Math.max(1, Math.ceil(result.value.length / 3000)),
      requiresOcr: false,
    };
  }

  if (mimeType === 'application/pdf' || ext === 'pdf') {
    const data = await pdfParse(bytes);
    const requiresOcr = data.text.trim().length < OCR_TEXT_MIN_CHARS;
    return {
      text: data.text,
      fileFormat: 'pdf' as const,
      pageCount: data.numpages,
      requiresOcr,
    };
  }

  return { text: '', fileFormat: 'other' as const, pageCount: 0, requiresOcr: false };
}

function _parseFolderPath(drivePath: string, fileName: string) {
  const parts = drivePath.split('/').filter(Boolean);
  // Client name is typically the immediate parent folder
  const clientName = parts.length >= 1 ? _cleanClientName(parts[parts.length - 1]) : null;
  // Matter ID: look for patterns like "M-12345", "#12345", or "(12345)"
  const matterMatch = drivePath.match(/(?:M-|matter[-\s]?#?|#|[(])(\d{4,})/i);
  const matterId = matterMatch ? matterMatch[1] : null;
  // Version label: look in filename and last folder segment
  const versionLabel = _extractVersionLabel(`${drivePath} ${fileName}`);

  return { clientName, matterId, versionLabel };
}

function _cleanClientName(segment: string): string | null {
  // Strip trailing matter references, dates, version labels
  const cleaned = segment
    .replace(/[-–—]\s*(M-?\d+|matter\s*\d+|#\d+)/gi, '')
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

function _extractVersionLabel(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\bexecuted\b/.test(lower)) return 'executed';
  if (/\bfinal\b/.test(lower)) return 'final';
  if (/\bsigned\b/.test(lower)) return 'signed';
  if (/\bv(\d+)\b/.test(lower)) return lower.match(/\bv(\d+)\b/)![0];
  if (/\bdraft\b/.test(lower)) return 'draft';
  return null;
}

async function _uploadToPageIndex(
  bytes: Buffer,
  fileName: string,
  mimeType: string,
  apiKey: string,
): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), fileName);

  const res = await fetch(`${PAGEINDEX_BASE}/doc/`, {
    method: 'POST',
    headers: { api_key: apiKey },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`PageIndex upload ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as { doc_id?: string };
  if (!data.doc_id) throw new Error('PageIndex returned no doc_id');
  return data.doc_id;
}

function _estimateCost(text: string): number {
  // Haiku: ~$0.80/$4 per MTok. Sonnet: ~$3/$15 per MTok.
  // Rough estimate: classification input ~4K tok, extraction input ~text.length/4 tok
  const classificationCost = (4000 * 0.80 + 500 * 4) / 1_000_000;
  const extractionInputToks = text.length / 4;
  const extractionCost = (extractionInputToks * 3 + 2000 * 15) / 1_000_000;
  return classificationCost + extractionCost;
}

async function _incrementDailySpend(db: admin.firestore.Firestore, amount: number) {
  const ref = db.doc('pipeline_state/control');
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const d = snap.data() as PipelineControl;
    const now = new Date();
    const resetAt = d.daily_spend_reset_at ? new Date(d.daily_spend_reset_at) : null;
    const isNewDay = !resetAt || now.toDateString() !== resetAt.toDateString();
    tx.update(ref, {
      daily_spend_usd: isNewDay ? amount : admin.firestore.FieldValue.increment(amount),
      ...(isNewDay ? { daily_spend_reset_at: now.toISOString() } : {}),
    });
  });
}

async function _handleDeletion(driveFileId: string) {
  const db = admin.firestore();
  const snap = await db.collection('wills_documents').doc(driveFileId).get();
  if (snap.exists) {
    await snap.ref.update({ processing_status: 'skipped', processing_error: 'file_deleted_in_drive' });
  }
}

async function _writeErrorRecord(
  db: admin.firestore.Firestore,
  driveFileId: string,
  drivePath: string,
  fileName: string,
  firmId: string,
  error: string,
) {
  await db.collection('wills_documents').doc(driveFileId).set({
    drive_file_id: driveFileId,
    drive_path: drivePath,
    file_format: 'other',
    document_type: 'Other',
    processing_status: 'error',
    processing_error: error,
    firmId,
    ingest_timestamp: new Date().toISOString(),
    schema_version: '1.0',
    needs_human_review: true,
    needs_human_review_reasons: [error],
    requires_ocr: false,
  }, { merge: true });
}

async function _writeSkipRecord(
  db: admin.firestore.Firestore,
  driveFileId: string, drivePath: string, fileName: string,
  fileSizeBytes: number, createdTime: string, modifiedTime: string,
  firmId: string, reason: string, fileFormat: string,
) {
  await db.collection('wills_documents').doc(driveFileId).set({
    drive_file_id: driveFileId,
    drive_path: drivePath,
    client_name: null,
    matter_id: null,
    file_format: fileFormat,
    file_size_bytes: fileSizeBytes,
    created_date: createdTime,
    modified_date: modifiedTime,
    document_type: 'Other',
    firm_origin: 'unknown',
    version_label: null,
    is_likely_executed: false,
    page_count: 0,
    language: 'en',
    ingest_timestamp: new Date().toISOString(),
    schema_version: '1.0',
    classification_confidence: 0,
    needs_human_review: true,
    needs_human_review_reasons: [reason],
    requires_ocr: fileFormat !== 'doc',
    processing_status: 'skipped',
    processing_error: reason,
    extraction_confidence: null,
    field_confidence: null,
    type_fields: null,
    pageindex_doc_id: null,
    pageindex_namespace: PAGEINDEX_NAMESPACE,
    firmId,
    last_processed_at: new Date().toISOString(),
  });
}

type BaseRecordArgs = {
  drive_file_id: string; drive_path: string; clientName: string | null;
  matterId: string | null; versionLabel: string | null;
  fileFormat: 'docx' | 'pdf' | 'doc' | 'other'; fileSizeBytes: number;
  createdTime: string; modifiedTime: string; fileName: string;
  pageCount: number; firmId: string;
  classification: Awaited<ReturnType<typeof classify>>;
  requiresOcr: boolean; processing_status: WillsDocument['processing_status'];
  extraction_confidence: number | null; field_confidence: Record<string, number> | null;
  type_fields: WillsDocument['type_fields']; pageindex_doc_id: string | null;
  needs_human_review_override?: boolean; needs_human_review_reasons_override?: string[];
};

function _buildBaseRecord(args: BaseRecordArgs): WillsDocument {
  const {
    drive_file_id, drive_path, clientName, matterId, versionLabel,
    fileFormat, fileSizeBytes, createdTime, modifiedTime, fileName,
    pageCount, firmId, classification, requiresOcr, processing_status,
    extraction_confidence, field_confidence, type_fields, pageindex_doc_id,
    needs_human_review_override, needs_human_review_reasons_override,
  } = args;

  return {
    drive_file_id,
    drive_path,
    client_name: clientName,
    matter_id: matterId,
    file_format: fileFormat,
    file_size_bytes: fileSizeBytes,
    created_date: createdTime,
    modified_date: modifiedTime,
    document_type: classification.document_type,
    firm_origin: classification.firm_origin,
    version_label: versionLabel,
    is_likely_executed: classification.is_likely_executed,
    page_count: pageCount || classification.page_count,
    language: classification.language,
    ingest_timestamp: new Date().toISOString(),
    schema_version: '1.0',
    classification_confidence: classification.confidence,
    needs_human_review: needs_human_review_override ?? classification.needs_human_review,
    needs_human_review_reasons: needs_human_review_reasons_override ?? classification.needs_human_review_reasons,
    requires_ocr: requiresOcr || classification.requires_ocr,
    extraction_confidence,
    field_confidence,
    type_fields,
    pageindex_doc_id,
    pageindex_namespace: PAGEINDEX_NAMESPACE,
    firmId,
    processing_status,
    processing_error: null,
    last_processed_at: new Date().toISOString(),
  };
}
