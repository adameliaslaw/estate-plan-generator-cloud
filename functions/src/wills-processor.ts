/**
 * functions/src/wills-processor.ts
 *
 * Pub/Sub-triggered Cloud Function — processes a single Drive file event
 * through the Wills → PageIndex ingestion pipeline.
 *
 * Pub/Sub topic: wills-document-processing
 * (Create with: gcloud pubsub topics create wills-document-processing --project=estate-plan-generator)
 *
 * Full 10-step pipeline (Phase 2 — stubs only in Phase 1):
 *   1.  Check kill switch (pipeline_state/control.enabled)
 *   2.  Check cost circuit breaker (daily_spend_usd vs threshold)
 *   3.  Fetch file bytes from Drive API
 *   4.  Detect format; extract text via mammoth (.docx) or pdf-parse (.pdf)
 *   5.  Parse folder path → client_name, matter_id, version_label
 *   6.  Classify document type (Claude Haiku 4.5)
 *   7.  Route: Correspondence / Other / requires_ocr → write record, skip steps 8–9
 *   8.  Extract structured metadata (Claude Sonnet 4.6)
 *   9.  Validate schema; retry once on failure; stub on second failure
 *  10.  Write Firestore record (wills_documents/{drive_file_id})
 *  11.  Submit to PageIndex (work-product namespace)
 *  12.  Append to pipeline_audit_log
 */

import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import * as logger from 'firebase-functions/logger';
import type { WillsIngestMessage } from './wills-schema';

export const WILLS_PUBSUB_TOPIC = 'wills-document-processing';

export const willsProcessor = onMessagePublished(
  {
    topic: WILLS_PUBSUB_TOPIC,
    region: 'us-east1',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async (event) => {
    const msg = event.data.message.json as WillsIngestMessage;
    logger.info('[willsProcessor] Phase 1 stub — pipeline implementation in Phase 2', {
      drive_file_id: msg.drive_file_id,
      event_type: msg.event_type,
      source: msg.source,
    });
    // Phase 2 implementation goes here.
  },
);
