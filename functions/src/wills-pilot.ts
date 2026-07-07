/**
 * functions/src/wills-pilot.ts
 *
 * Phase 4 pilot harness for the Wills ingestion pipeline.
 *
 * Publishes a bounded sample of Drive files into the wills-document-processing
 * Pub/Sub topic, polls Firestore until each reaches a terminal processing
 * status, and produces an acceptance-criteria report.
 *
 * Entry point:
 *   willsPilotRun — onCall (admin only)
 *
 * Pre-flight gates the same as willsStartBackfill: pipeline_state/control.enabled
 * must be true. Pilot uses source='backfill' (the existing message envelope) and
 * tracks membership via pipeline_state/pilot_runs/{runId} so concurrent live or
 * backfill traffic can't pollute the result set — polling is keyed on the exact
 * drive_file_ids published in this pilot.
 */

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { google } from 'googleapis';
import type {
  WillsIngestMessage,
  WillsDocument,
  ProcessingStatus,
  DocumentType,
} from './wills-schema';

const DRIVE_ROOT_FOLDER_ID = '1TuJOw7hy4xKm6EJeyFb5IYS4I6eoVk-j';
const PUBSUB_TOPIC         = 'wills-document-processing';
const GCP_PROJECT          = 'estate-plan-generator';
const REGION               = 'us-east1';
const DRIVE_FOLDER_MIME    = 'application/vnd.google-apps.folder';
const PUBSUB_BATCH_SIZE    = 10;

const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);

// 'extracted' is the processor's success status for Wills/Trusts/POAs;
// 'classified' is terminal for Correspondence/Other/OCR docs that skip extraction.
// Exported for unit tests (regression R5-018/063/064) — see wills-pilot.test.ts.
export const TERMINAL_STATUSES = new Set<ProcessingStatus>(['extracted', 'classified', 'indexed', 'error', 'skipped']);

const DEFAULT_SAMPLE_SIZE   = 30;
const DEFAULT_POLL_TIMEOUT  = 480_000;  // 8 min — leaves 60s headroom in a 540s function
const DEFAULT_POLL_INTERVAL = 5_000;

const DEFAULT_THRESHOLDS = {
  classification_success_rate: 0.95,
  extraction_success_rate:     0.90,
  mean_extraction_confidence:  0.85,
  needs_review_rate:           0.30,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PilotRunRequest {
  fileIds?: string[];
  sampleSize?: number;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  thresholds?: Partial<typeof DEFAULT_THRESHOLDS>;
}

interface SampledFile {
  drive_file_id: string;
  file_name: string;
  drive_path: string;
  mime_type: string;
  file_size_bytes: number;
  created_time: string;
  modified_time: string;
}

interface PilotDocResult {
  drive_file_id: string;
  file_name: string;
  drive_path: string;
  terminal_status: ProcessingStatus | 'timeout' | 'never_seen';
  document_type: DocumentType | null;
  classification_confidence: number | null;
  extraction_confidence: number | null;
  needs_human_review: boolean;
  needs_human_review_reasons: string[];
  processing_error: string | null;
}

interface AcceptanceCriterion {
  threshold: number;
  actual: number | null;
  passed: boolean;
}

interface PilotReport {
  run_id: string;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  total_docs: number;
  status_counts: Record<string, number>;
  type_counts: Record<string, number>;
  classification_success_rate: number;
  extraction_success_rate: number;
  mean_extraction_confidence: number | null;
  median_extraction_confidence: number | null;
  min_extraction_confidence: number | null;
  needs_review_rate: number;
  needs_review_reasons_grouped: Record<string, number>;
  error_messages_grouped: Record<string, number>;
  acceptance_criteria: {
    classification_success_rate: AcceptanceCriterion;
    extraction_success_rate: AcceptanceCriterion;
    mean_extraction_confidence: AcceptanceCriterion;
    needs_review_rate: AcceptanceCriterion;
  };
  overall_passed: boolean;
  per_doc: PilotDocResult[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDriveClient() {
  return google.drive({
    version: 'v3',
    auth: new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    }),
  });
}

async function publishBatch(messages: WillsIngestMessage[]): Promise<void> {
  if (messages.length === 0) return;
  const pubsub = google.pubsub({
    version: 'v1',
    auth: new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/pubsub'],
    }),
  });
  const topic = `projects/${GCP_PROJECT}/topics/${PUBSUB_TOPIC}`;
  await pubsub.projects.topics.publish({
    topic,
    requestBody: {
      messages: messages.map(msg => ({
        data: Buffer.from(JSON.stringify(msg)).toString('base64'),
      })),
    },
  });
}

/**
 * BFS-traverses the Drive root and returns up to `limit` supported files.
 * Stops early once `limit` is reached. Folder traversal order is FIFO so the
 * sample is deterministic-ish: it favours files near the root, then depth-by-depth.
 */
async function sampleDriveFiles(limit: number): Promise<SampledFile[]> {
  const drive = getDriveClient();
  interface QueueItem { folderId: string; path: string }
  const queue: QueueItem[] = [{ folderId: DRIVE_ROOT_FOLDER_ID, path: '' }];
  const sample: SampledFile[] = [];

  while (queue.length > 0 && sample.length < limit) {
    const { folderId, path } = queue.shift()!;
    let pageToken: string | undefined;

    do {
      const listRes = await drive.files.list({
        q: `"${folderId}" in parents and trashed = false`,
        fields: 'nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime)',
        pageSize: 100,
        ...(pageToken ? { pageToken } : {}),
      });

      for (const file of listRes.data.files ?? []) {
        if (!file.id) continue;
        if (file.mimeType === DRIVE_FOLDER_MIME) {
          const subPath = path ? `${path}/${file.name ?? file.id}` : (file.name ?? file.id);
          queue.push({ folderId: file.id, path: subPath });
          continue;
        }
        if (!SUPPORTED_MIME_TYPES.has(file.mimeType ?? '')) continue;

        sample.push({
          drive_file_id: file.id,
          file_name: file.name ?? file.id,
          drive_path: path,
          mime_type: file.mimeType ?? 'application/octet-stream',
          file_size_bytes: parseInt(file.size ?? '0', 10),
          created_time: file.createdTime ?? new Date().toISOString(),
          modified_time: file.modifiedTime ?? new Date().toISOString(),
        });

        if (sample.length >= limit) break;
      }

      pageToken = listRes.data.nextPageToken ?? undefined;
    } while (pageToken && sample.length < limit);
  }

  return sample;
}

/**
 * Fetches Drive metadata for explicit file IDs so the publish payload matches
 * the shape the processor expects.
 */
async function fetchExplicitFiles(fileIds: string[]): Promise<SampledFile[]> {
  const drive = getDriveClient();
  const out: SampledFile[] = [];
  for (const id of fileIds) {
    try {
      const meta = await drive.files.get({
        fileId: id,
        fields: 'id,name,mimeType,size,createdTime,modifiedTime,parents',
      });
      const f = meta.data;
      if (!f.id) continue;
      out.push({
        drive_file_id: f.id,
        file_name: f.name ?? f.id,
        drive_path: '',  // explicit-IDs path: caller didn't provide folder context
        mime_type: f.mimeType ?? 'application/octet-stream',
        file_size_bytes: parseInt(f.size ?? '0', 10),
        created_time: f.createdTime ?? new Date().toISOString(),
        modified_time: f.modifiedTime ?? new Date().toISOString(),
      });
    } catch (err) {
      logger.warn('[willsPilot] Failed to fetch Drive metadata; skipping', {
        drive_file_id: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

/**
 * Returns true only if the document reached a terminal status during this pilot
 * run (i.e. last_processed_at is at or after startedAt). Stale records from
 * previous runs are ignored so they can't produce false positives.
 */
export function isTerminalForRun(doc: WillsDocument, startedAt: string): boolean {
  if (!TERMINAL_STATUSES.has(doc.processing_status)) return false;
  if (!doc.last_processed_at) return false;
  return doc.last_processed_at >= startedAt;
}

async function pollUntilTerminal(
  fileIds: string[],
  timeoutMs: number,
  intervalMs: number,
  startedAt: string,
  db: admin.firestore.Firestore,
): Promise<Map<string, WillsDocument | null>> {
  const results = new Map<string, WillsDocument | null>();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const pending = fileIds.filter(id => {
      const doc = results.get(id);
      return !doc || !isTerminalForRun(doc, startedAt);
    });
    if (pending.length === 0) break;

    const snaps = await Promise.all(
      pending.map(id => db.collection('wills_documents').doc(id).get()),
    );
    for (let i = 0; i < pending.length; i++) {
      const data = snaps[i].exists ? (snaps[i].data() as WillsDocument) : null;
      results.set(pending[i], data);
    }

    if (pending.every(id => {
      const doc = results.get(id);
      return doc && isTerminalForRun(doc, startedAt);
    })) break;

    await new Promise(r => setTimeout(r, intervalMs));
  }

  // Ensure every requested id has an entry (null if never written).
  for (const id of fileIds) {
    if (!results.has(id)) results.set(id, null);
  }
  return results;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function buildReport(args: {
  runId: string;
  startedAt: string;
  completedAt: string;
  sample: SampledFile[];
  results: Map<string, WillsDocument | null>;
  thresholds: typeof DEFAULT_THRESHOLDS;
}): PilotReport {
  const { runId, startedAt, completedAt, sample, results, thresholds } = args;

  const perDoc: PilotDocResult[] = sample.map(s => {
    const doc = results.get(s.drive_file_id) ?? null;
    let terminalStatus: PilotDocResult['terminal_status'];
    if (!doc) {
      terminalStatus = 'never_seen';
    } else if (TERMINAL_STATUSES.has(doc.processing_status)) {
      terminalStatus = doc.processing_status;
    } else {
      terminalStatus = 'timeout';
    }
    return {
      drive_file_id: s.drive_file_id,
      file_name: s.file_name,
      drive_path: s.drive_path,
      terminal_status: terminalStatus,
      document_type: doc?.document_type ?? null,
      classification_confidence: doc?.classification_confidence ?? null,
      extraction_confidence: doc?.extraction_confidence ?? null,
      needs_human_review: doc?.needs_human_review ?? false,
      needs_human_review_reasons: doc?.needs_human_review_reasons ?? [],
      processing_error: doc?.processing_error ?? null,
    };
  });

  const total = perDoc.length;

  const statusCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};
  const reviewReasons: Record<string, number> = {};
  const errorMessages: Record<string, number> = {};
  const extractionConfidences: number[] = [];
  let classifiedOk = 0;
  let extractedOk  = 0;
  let needsReview  = 0;

  for (const r of perDoc) {
    statusCounts[r.terminal_status] = (statusCounts[r.terminal_status] ?? 0) + 1;

    // R5-063: _writeErrorRecord stores document_type:'Other' on failure, so a
    // non-null document_type alone does NOT mean the doc classified OK. Only
    // count genuine classification successes; 'error'/'skipped'/'timeout'/
    // 'never_seen' are not classifications.
    const classifiedOkStatus =
      r.terminal_status === 'classified' ||
      r.terminal_status === 'extracted' ||
      r.terminal_status === 'indexed';
    if (r.document_type && classifiedOkStatus) {
      typeCounts[r.document_type] = (typeCounts[r.document_type] ?? 0) + 1;
      classifiedOk++;
    }
    // R5-064: 'skipped' (legacy .doc, unsupported formats, deleted files) never
    // ran extraction — it is not an extraction success.
    if (
      r.terminal_status === 'extracted' ||   // the processor's actual success status
      r.terminal_status === 'indexed'
    ) {
      extractedOk++;
    }
    if (typeof r.extraction_confidence === 'number') {
      extractionConfidences.push(r.extraction_confidence);
    }
    if (r.needs_human_review) needsReview++;
    for (const reason of r.needs_human_review_reasons) {
      reviewReasons[reason] = (reviewReasons[reason] ?? 0) + 1;
    }
    if (r.processing_error) {
      // Group by first sentence / first 80 chars to keep cardinality sane.
      const key = r.processing_error.slice(0, 80);
      errorMessages[key] = (errorMessages[key] ?? 0) + 1;
    }
  }

  const classRate     = total === 0 ? 0 : classifiedOk / total;
  const extractRate   = total === 0 ? 0 : extractedOk / total;
  const reviewRate    = total === 0 ? 0 : needsReview / total;
  const meanConf      = extractionConfidences.length === 0
    ? null
    : extractionConfidences.reduce((a, b) => a + b, 0) / extractionConfidences.length;
  const medianConf    = median(extractionConfidences);
  const minConf       = extractionConfidences.length === 0 ? null : Math.min(...extractionConfidences);

  const acceptance = {
    classification_success_rate: {
      threshold: thresholds.classification_success_rate,
      actual: classRate,
      passed: classRate >= thresholds.classification_success_rate,
    },
    extraction_success_rate: {
      threshold: thresholds.extraction_success_rate,
      actual: extractRate,
      passed: extractRate >= thresholds.extraction_success_rate,
    },
    mean_extraction_confidence: {
      threshold: thresholds.mean_extraction_confidence,
      actual: meanConf,
      passed: meanConf !== null && meanConf >= thresholds.mean_extraction_confidence,
    },
    needs_review_rate: {
      threshold: thresholds.needs_review_rate,
      actual: reviewRate,
      passed: reviewRate <= thresholds.needs_review_rate,
    },
  };

  const overallPassed = Object.values(acceptance).every(c => c.passed);

  return {
    run_id: runId,
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
    total_docs: total,
    status_counts: statusCounts,
    type_counts: typeCounts,
    classification_success_rate: classRate,
    extraction_success_rate: extractRate,
    mean_extraction_confidence: meanConf,
    median_extraction_confidence: medianConf,
    min_extraction_confidence: minConf,
    needs_review_rate: reviewRate,
    needs_review_reasons_grouped: reviewReasons,
    error_messages_grouped: errorMessages,
    acceptance_criteria: acceptance,
    overall_passed: overallPassed,
    per_doc: perDoc,
  };
}

// ---------------------------------------------------------------------------
// willsPilotRun (onCall, admin only)
// ---------------------------------------------------------------------------

export const willsPilotRun = onCall(
  { region: REGION, memory: '1GiB', timeoutSeconds: 540 },
  async (request) => {
    if (request.auth?.token?.['role'] !== 'admin') {
      throw new HttpsError('permission-denied', 'Admin role required');
    }

    const req = (request.data ?? {}) as PilotRunRequest;
    const sampleSize    = Math.max(1, Math.min(req.sampleSize ?? DEFAULT_SAMPLE_SIZE, 100));
    const pollTimeoutMs = Math.max(60_000, req.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT);
    const pollInterval  = Math.max(1_000, req.pollIntervalMs ?? DEFAULT_POLL_INTERVAL);
    const thresholds    = { ...DEFAULT_THRESHOLDS, ...(req.thresholds ?? {}) };

    const db = admin.firestore();

    const controlSnap = await db.collection('pipeline_state').doc('control').get();
    const control = controlSnap.data();

    // ── Firm scope (R5-066) ─────────────────────────────────────────────────
    // role=='admin' alone is not enough in a multi-tenant deployment — an admin
    // of any other firm could otherwise run this firm's Drive pilot and read
    // reports containing client-identifying file names/paths. Only an admin of
    // the firm that OWNS the pipeline (pipeline_state/control.firmId) may run it.
    // Fail closed if the owner is unconfigured. Checked before the kill-switch so
    // a cross-firm caller can't even probe whether the pipeline is enabled.
    const ownerFirmId = (control?.firmId as string | undefined) ?? '';
    const callerFirmId = request.auth.token.firmId as string | undefined;
    if (!ownerFirmId) {
      throw new HttpsError('failed-precondition',
        'Pipeline owner firm is not configured — set pipeline_state/control.firmId first.');
    }
    if (callerFirmId !== ownerFirmId) {
      throw new HttpsError('permission-denied', 'This ingestion pipeline belongs to another firm.');
    }

    // ── Pre-flight: kill switch ─────────────────────────────────────────────
    if (!control?.enabled) {
      throw new HttpsError(
        'failed-precondition',
        'Pipeline is disabled — set pipeline_state/control.enabled = true first',
      );
    }
    const firmId: string = ownerFirmId;

    // ── Resolve sample ──────────────────────────────────────────────────────
    let sample: SampledFile[];
    if (req.fileIds && req.fileIds.length > 0) {
      sample = await fetchExplicitFiles(req.fileIds);
    } else {
      sample = await sampleDriveFiles(sampleSize);
    }
    if (sample.length === 0) {
      throw new HttpsError(
        'failed-precondition',
        'No supported files were found in the Drive root (or the explicit fileIds list).',
      );
    }

    // ── Open the run record ─────────────────────────────────────────────────
    const startedAt = new Date().toISOString();
    const runRef = db.collection('pipeline_state').doc('pilot_runs')
      .collection('runs').doc();
    const runId = runRef.id;

    await runRef.set({
      run_id: runId,
      status: 'running',
      started_at: startedAt,
      started_by: request.auth.uid ?? '',
      firmId,
      sample_size: sample.length,
      drive_file_ids: sample.map(s => s.drive_file_id),
      thresholds,
    });

    logger.info('[willsPilot] Run started', { runId, sampleSize: sample.length });

    // ── Publish messages to wills-document-processing ───────────────────────
    let pending: WillsIngestMessage[] = [];
    for (const s of sample) {
      pending.push({
        drive_file_id: s.drive_file_id,
        drive_path: s.drive_path,
        file_name: s.file_name,
        mime_type: s.mime_type,
        file_size_bytes: s.file_size_bytes,
        created_time: s.created_time,
        modified_time: s.modified_time,
        event_type: 'new',
        source: 'backfill',
      });
      if (pending.length >= PUBSUB_BATCH_SIZE) {
        await publishBatch(pending);
        pending = [];
      }
    }
    await publishBatch(pending);

    // ── Poll for terminal status ────────────────────────────────────────────
    const fileIds = sample.map(s => s.drive_file_id);
    const results = await pollUntilTerminal(fileIds, pollTimeoutMs, pollInterval, startedAt, db);

    // ── Build + persist report ──────────────────────────────────────────────
    const completedAt = new Date().toISOString();
    const report = buildReport({ runId, startedAt, completedAt, sample, results, thresholds });

    await runRef.update({
      status: report.overall_passed ? 'completed_passed' : 'completed_failed',
      completed_at: completedAt,
      report,
    });

    logger.info('[willsPilot] Run finished', {
      runId,
      overall_passed: report.overall_passed,
      duration_ms: report.duration_ms,
      total_docs: report.total_docs,
      classification_success_rate: report.classification_success_rate,
      extraction_success_rate: report.extraction_success_rate,
    });

    return report;
  },
);
