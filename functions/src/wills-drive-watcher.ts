/**
 * functions/src/wills-drive-watcher.ts
 *
 * Google Drive change watcher for the Wills ingestion pipeline.
 * Three entry points:
 *   willsDriveWebhook    — onRequest, receives Drive push notifications (unauthenticated)
 *   willsDriveWatchRenew — onSchedule daily, renews the watch channel before it expires (~7 days)
 *   willsSetupDriveWatch — onCall (admin), initialises the watch for the first time
 *
 * Service account must have:
 *   - drive.readonly scope + Viewer access to DRIVE_ROOT_FOLDER_ID
 *   - pubsub.topics.publish on the wills-document-processing topic
 */

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { google } from 'googleapis';
import type { DriveSyncState, WillsIngestMessage } from './wills-schema';

const DRIVE_ROOT_FOLDER_ID = '1TuJOw7hy4xKm6EJeyFb5IYS4I6eoVk-j';
const PUBSUB_TOPIC        = 'wills-document-processing';
const GCP_PROJECT         = 'estate-plan-generator';
const REGION              = 'us-east1';

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

function getPubSubClient() {
  return google.pubsub({
    version: 'v1',
    auth: new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/pubsub'],
    }),
  });
}

async function publishWillsMessage(msg: WillsIngestMessage): Promise<void> {
  const pubsub = getPubSubClient();
  const topic = `projects/${GCP_PROJECT}/topics/${PUBSUB_TOPIC}`;
  await pubsub.projects.topics.publish({
    topic,
    requestBody: {
      messages: [{ data: Buffer.from(JSON.stringify(msg)).toString('base64') }],
    },
  });
}

/**
 * Reconstruct the folder path relative to DRIVE_ROOT_FOLDER_ID.
 * Walks parent IDs upward until it hits the root or runs out of parents.
 * Returns e.g. "Smith, John/2024" for a file two levels deep.
 */
async function buildDrivePath(
  fileParentId: string,
  drive: ReturnType<typeof getDriveClient>,
): Promise<string> {
  const parts: string[] = [];
  let currentId = fileParentId;

  for (let depth = 0; depth < 8; depth++) {
    if (currentId === DRIVE_ROOT_FOLDER_ID) break;

    const res = await drive.files.get({ fileId: currentId, fields: 'id,name,parents' });
    parts.unshift(res.data.name ?? currentId);

    const parents: string[] = res.data.parents ?? [];
    if (parents.length === 0) break;

    const nextParent = parents[0];
    if (nextParent === DRIVE_ROOT_FOLDER_ID) break;
    currentId = nextParent;
  }

  return parts.join('/');
}

async function setupNewWatch(
  drive: ReturnType<typeof getDriveClient>,
  pageToken: string,
  webhookUrl: string,
): Promise<{ channelId: string; resourceId: string | null; expiresAt: string | null }> {
  const channelId = crypto.randomUUID();

  const watchRes = await drive.changes.watch({
    pageToken,
    requestBody: {
      id: channelId,
      type: 'web_hook',
      address: webhookUrl,
    },
  });

  const expiresAt = watchRes.data.expiration
    ? new Date(parseInt(watchRes.data.expiration, 10)).toISOString()
    : null;

  return { channelId, resourceId: watchRes.data.resourceId ?? null, expiresAt };
}

// ---------------------------------------------------------------------------
// willsDriveWebhook
// ---------------------------------------------------------------------------

export const willsDriveWebhook = onRequest(
  { region: REGION, memory: '512MiB', timeoutSeconds: 60 },
  async (req, res) => {
    const state     = req.headers['x-goog-resource-state'] as string | undefined;
    const channelId = req.headers['x-goog-channel-id']     as string | undefined;

    // Initial sync notification — nothing to process
    if (state === 'sync') {
      res.status(200).send('ok');
      return;
    }

    if (state !== 'change' && state !== 'update') {
      res.status(200).send('ok');
      return;
    }

    const db = admin.firestore();

    // Validate channel ID against stored value to reject stale/unknown channels
    const syncSnap = await db.collection('pipeline_state').doc('drive_sync').get();
    const syncState = syncSnap.data() as DriveSyncState | undefined;

    if (!syncState?.watch_channel_id || syncState.watch_channel_id !== channelId) {
      logger.warn('[wills-drive-watcher] Ignoring notification from unknown channel', { channelId });
      res.status(200).send('ok');
      return;
    }

    const pageToken = syncState.last_page_token;
    if (!pageToken) {
      logger.error('[wills-drive-watcher] No page token stored — skipping change');
      res.status(200).send('ok');
      return;
    }

    const drive = getDriveClient();

    try {
      let token = pageToken;

       
      while (true) {
        const changesRes = await drive.changes.list({
          pageToken: token,
          fields: 'nextPageToken,newStartPageToken,changes(removed,file(id,name,mimeType,size,createdTime,modifiedTime,parents,trashed))',
          includeRemoved: true,
          spaces: 'drive',
        });

        for (const change of changesRes.data.changes ?? []) {
          if (change.removed || change.file?.trashed) continue;
          const file = change.file;
          if (!file?.id) continue;
          if (!SUPPORTED_MIME_TYPES.has(file.mimeType ?? '')) continue;

          const parents: string[] = file.parents ?? [];
          if (parents.length === 0) continue;

          const drivePath = await buildDrivePath(parents[0], drive);

          const msg: WillsIngestMessage = {
            drive_file_id: file.id,
            drive_path: drivePath,
            file_name: file.name ?? file.id,
            mime_type: file.mimeType ?? 'application/octet-stream',
            file_size_bytes: parseInt(file.size ?? '0', 10),
            created_time: file.createdTime ?? new Date().toISOString(),
            modified_time: file.modifiedTime ?? new Date().toISOString(),
            event_type: 'new',
            source: 'drive_watch',
          };

          await publishWillsMessage(msg);
          logger.info('[wills-drive-watcher] Published', { fileId: file.id, name: file.name });
        }

        if (changesRes.data.nextPageToken) {
          token = changesRes.data.nextPageToken;
        } else {
          // Persist new start token for next notification
          const newToken = changesRes.data.newStartPageToken ?? token;
          await db.collection('pipeline_state').doc('drive_sync').update({
            last_page_token: newToken,
            last_sync_at: new Date().toISOString(),
          });
          break;
        }
      }
    } catch (err: unknown) {
      logger.error('[wills-drive-watcher] Error processing changes', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    res.status(200).send('ok');
  },
);

// ---------------------------------------------------------------------------
// willsDriveWatchRenew
// ---------------------------------------------------------------------------

export const willsDriveWatchRenew = onSchedule(
  { region: REGION, schedule: 'every 24 hours', memory: '512MiB', timeoutSeconds: 60 },
  async () => {
    const db = admin.firestore();

    const [syncSnap, controlSnap] = await Promise.all([
      db.collection('pipeline_state').doc('drive_sync').get(),
      db.collection('pipeline_state').doc('control').get(),
    ]);

    const syncState = syncSnap.data() as DriveSyncState | undefined;
    const webhookUrl = controlSnap.data()?.webhook_url as string | undefined;

    if (!webhookUrl) {
      logger.error('[wills-drive-watcher] webhook_url missing from pipeline_state/control — cannot renew');
      return;
    }

    const pageToken = syncState?.last_page_token;
    if (!pageToken) {
      logger.error('[wills-drive-watcher] No page token — run willsSetupDriveWatch first');
      return;
    }

    const drive = getDriveClient();

    // Stop the expiring channel before creating a new one
    if (syncState?.watch_channel_id && syncState.watch_resource_id) {
      try {
        await drive.channels.stop({
          requestBody: {
            id: syncState.watch_channel_id,
            resourceId: syncState.watch_resource_id,
          },
        });
      } catch (err: unknown) {
        // Non-fatal: old channel may have already expired
        logger.warn('[wills-drive-watcher] Could not stop old channel', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const { channelId, resourceId, expiresAt } = await setupNewWatch(drive, pageToken, webhookUrl);

    await db.collection('pipeline_state').doc('drive_sync').update({
      watch_channel_id: channelId,
      watch_resource_id: resourceId,
      watch_expiry: expiresAt,
    });

    logger.info('[wills-drive-watcher] Watch renewed', { channelId, expiresAt });
  },
);

// ---------------------------------------------------------------------------
// willsSetupDriveWatch (onCall, admin only)
// ---------------------------------------------------------------------------

export const willsSetupDriveWatch = onCall(
  { region: REGION, memory: '512MiB', timeoutSeconds: 60 },
  async (request) => {
    if (request.auth?.token?.['role'] !== 'admin') {
      throw new HttpsError('permission-denied', 'Admin role required');
    }

    const data = request.data as Record<string, unknown>;
    const webhookUrl = data.webhookUrl;
    if (typeof webhookUrl !== 'string' || !webhookUrl) {
      throw new HttpsError('invalid-argument', 'webhookUrl is required');
    }

    const db = admin.firestore();
    const drive = getDriveClient();

    // Fetch a fresh start page token so we only process future changes
    const tokenRes = await drive.changes.getStartPageToken({});
    const pageToken = tokenRes.data.startPageToken;
    if (!pageToken) {
      throw new HttpsError('internal', 'Failed to obtain start page token from Drive');
    }

    const { channelId, resourceId, expiresAt } = await setupNewWatch(drive, pageToken, webhookUrl);

    const syncState: DriveSyncState = {
      last_page_token: pageToken,
      last_sync_at: null,
      watch_expiry: expiresAt,
      watch_resource_id: resourceId,
      watch_channel_id: channelId,
    };

    await Promise.all([
      db.collection('pipeline_state').doc('drive_sync').set(syncState),
      // Store webhookUrl so willsDriveWatchRenew can re-use it
      db.collection('pipeline_state').doc('control').set({ webhook_url: webhookUrl }, { merge: true }),
    ]);

    logger.info('[wills-drive-watcher] Watch initialised', { channelId, webhookUrl, expiresAt });

    return { channelId, expiresAt };
  },
);
