/**
 * functions/src/wills-backfill.ts
 *
 * One-shot backfill orchestrator for the Wills ingestion pipeline.
 * BFS-traverses DRIVE_ROOT_FOLDER_ID and publishes every supported file to
 * the wills-document-processing Pub/Sub topic.
 *
 * Entry point:
 *   willsStartBackfill — onCall (admin only)
 *
 * Service account must have:
 *   - drive.readonly scope + Viewer access to DRIVE_ROOT_FOLDER_ID
 *   - pubsub.topics.publish on the wills-document-processing topic
 */

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { google } from 'googleapis';
import type { BackfillProgress, WillsIngestMessage } from './wills-schema';
import { writePipelineAuditEntry } from './wills-audit';

const DRIVE_ROOT_FOLDER_ID  = '1TuJOw7hy4xKm6EJeyFb5IYS4I6eoVk-j';
const PUBSUB_TOPIC          = 'wills-document-processing';
const GCP_PROJECT           = 'estate-plan-generator';
const REGION                = 'us-east1';
const DRIVE_FOLDER_MIME     = 'application/vnd.google-apps.folder';
const PUBSUB_BATCH_SIZE     = 10;

const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);

// ---------------------------------------------------------------------------
// Internal helpers
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

// ---------------------------------------------------------------------------
// willsStartBackfill (onCall, admin only)
// ---------------------------------------------------------------------------

export const willsStartBackfill = onCall(
  { region: REGION, memory: '1GiB', timeoutSeconds: 540 },
  async (request) => {
    if (request.auth?.token?.['role'] !== 'admin') {
      throw new HttpsError('permission-denied', 'Admin role required');
    }

    const db = admin.firestore();

    const controlSnap = await db.collection('pipeline_state').doc('control').get();
    const control = controlSnap.data();

    // Firm scope (R5-066): role=='admin' alone is not enough in a multi-tenant
    // deployment — an admin of any other firm could otherwise trigger this
    // firm's Drive ingestion. Only an admin of the firm that OWNS the pipeline
    // (pipeline_state/control.firmId) may run it. Fail closed if the owner is
    // unconfigured. (Checked before the kill-switch so a cross-firm caller can't
    // even probe whether the pipeline is enabled.)
    const ownerFirmId = (control?.firmId as string | undefined) ?? '';
    const callerFirmId = request.auth.token.firmId as string | undefined;
    if (!ownerFirmId) {
      throw new HttpsError('failed-precondition',
        'Pipeline owner firm is not configured — set pipeline_state/control.firmId first.');
    }
    if (callerFirmId !== ownerFirmId) {
      throw new HttpsError('permission-denied', 'This ingestion pipeline belongs to another firm.');
    }

    // Kill switch check
    if (!control?.enabled) {
      throw new HttpsError('failed-precondition', 'Pipeline is disabled — set pipeline_state/control.enabled = true first');
    }

    // Idempotency guard. A run killed by the 540s timeout mid-BFS leaves
    // status:'running' forever, which would permanently block every future run.
    // Treat a 'running' record whose checkpoint is older than one function
    // lifetime (+ buffer) as a crashed run and allow a restart. (R5-061)
    const progressSnap = await db.collection('pipeline_state').doc('backfill_progress').get();
    const priorProgress = progressSnap.data() as BackfillProgress | undefined;
    if (priorProgress?.status === 'running') {
      const STALE_MS = 15 * 60 * 1000; // > 540s max lifetime + margin
      const lastUpdatedMs = priorProgress.last_updated_at
        ? new Date(priorProgress.last_updated_at).getTime() : 0;
      const ageMs = Date.now() - lastUpdatedMs;
      if (Number.isFinite(lastUpdatedMs) && lastUpdatedMs > 0 && ageMs < STALE_MS) {
        throw new HttpsError('already-exists', 'A backfill is already running');
      }
      logger.warn('[wills-backfill] Prior run stale/crashed — restarting', { ageMs });
    }

    const firmId: string   = (control.firmId as string | undefined) ?? '';
    const startedBy: string = request.auth.uid ?? '';
    const startedAt         = new Date().toISOString();

    const initialProgress: BackfillProgress = {
      status: 'running',
      total_files_discovered: 0,
      total_published: 0,
      total_processed: 0,
      total_errors: 0,
      started_at: startedAt,
      completed_at: null,
      last_updated_at: startedAt,
      current_folder: DRIVE_ROOT_FOLDER_ID,
      started_by: startedBy,
    };

    await db.collection('pipeline_state').doc('backfill_progress').set(initialProgress);

    writePipelineAuditEntry({
      action: 'backfill_started',
      drive_file_id: null,
      pageindex_doc_id: null,
      user_uid: startedBy,
      query_text: null,
      results_returned: null,
      duration_ms: null,
      error: null,
      firmId,
    }, db);

    const drive = getDriveClient();

    // BFS state
    interface QueueItem { folderId: string; path: string }
    const queue: QueueItem[] = [{ folderId: DRIVE_ROOT_FOLDER_ID, path: '' }];
    let totalDiscovered = 0;
    let totalPublished  = 0;
    let totalErrors     = 0;
    let pending: WillsIngestMessage[] = [];

    async function flushPending(): Promise<void> {
      if (pending.length === 0) return;
      const batch = pending;
      pending = [];
      try {
        await publishBatch(batch);
        totalPublished += batch.length;
      } catch (err: unknown) {
        logger.error('[wills-backfill] Failed to publish batch', {
          count: batch.length,
          error: err instanceof Error ? err.message : String(err),
        });
        totalErrors += batch.length;
      }
    }

    try {
      while (queue.length > 0) {
        const { folderId, path } = queue.shift()!;

        // Checkpoint progress in Firestore before each folder
        await db.collection('pipeline_state').doc('backfill_progress').update({
          current_folder: folderId,
          last_updated_at: new Date().toISOString(),
          total_files_discovered: totalDiscovered,
          total_published: totalPublished,
          total_errors: totalErrors,
        });

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

            totalDiscovered++;

            const msg: WillsIngestMessage = {
              drive_file_id: file.id,
              drive_path: path,
              file_name: file.name ?? file.id,
              mime_type: file.mimeType ?? 'application/octet-stream',
              file_size_bytes: parseInt(file.size ?? '0', 10),
              created_time: file.createdTime ?? new Date().toISOString(),
              modified_time: file.modifiedTime ?? new Date().toISOString(),
              event_type: 'new',
              source: 'backfill',
            };

            pending.push(msg);

            if (pending.length >= PUBSUB_BATCH_SIZE) {
              await flushPending();
            }
          }

          pageToken = listRes.data.nextPageToken ?? undefined;
        } while (pageToken);
      }

      await flushPending();

      const completedAt = new Date().toISOString();
      await db.collection('pipeline_state').doc('backfill_progress').update({
        status: 'completed',
        completed_at: completedAt,
        last_updated_at: completedAt,
        total_files_discovered: totalDiscovered,
        total_published: totalPublished,
        total_errors: totalErrors,
        current_folder: null,
      });

      writePipelineAuditEntry({
        action: 'backfill_completed',
        drive_file_id: null,
        pageindex_doc_id: null,
        user_uid: startedBy,
        query_text: null,
        results_returned: totalPublished,
        duration_ms: Date.now() - new Date(startedAt).getTime(),
        error: null,
        firmId,
      }, db);

      logger.info('[wills-backfill] Completed', { totalDiscovered, totalPublished, totalErrors });

      return { totalDiscovered, totalPublished, totalErrors };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('[wills-backfill] Fatal error', { error: errorMsg });

      await db.collection('pipeline_state').doc('backfill_progress').update({
        status: 'error',
        last_updated_at: new Date().toISOString(),
        total_files_discovered: totalDiscovered,
        total_published: totalPublished,
        total_errors: totalErrors,
      });

      throw new HttpsError('internal', `Backfill failed: ${errorMsg}`);
    }
  },
);
