/**
 * functions/src/wills-audit.ts
 *
 * Non-blocking audit log writer for the Wills ingestion pipeline.
 * Writes to pipeline_audit_log/{auto_id} via Admin SDK.
 * Failures are logged but never propagate — audit must not break ingestion.
 */

import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import type { PipelineAuditEntry } from './wills-schema';

export function writePipelineAuditEntry(
  entry: Omit<PipelineAuditEntry, 'timestamp'>,
  db: admin.firestore.Firestore,
): void {
  const doc: PipelineAuditEntry = { ...entry, timestamp: new Date().toISOString() };
  db.collection('pipeline_audit_log')
    .add(doc)
    .catch((err: unknown) => {
      logger.error('[wills-audit] Failed to write audit entry', {
        action: entry.action,
        drive_file_id: entry.drive_file_id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}
