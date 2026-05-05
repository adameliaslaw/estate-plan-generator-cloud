/**
 * audit-trail.ts
 *
 * Audit trail system for compliance and security logging.
 *
 * Logs are written to: /firms/{firmId}/auditLog/{logId}
 *
 * Exports:
 * 1. logAuditEvent   — internal helper (not a Cloud Function); writes an audit entry.
 *                      Called by other Cloud Functions (email sends, document generation, etc.)
 * 2. logAccess       — onCall v2; called from frontend when attorney views a client record.
 * 3. onDocumentStatusChanged — Firestore onWrite trigger; fires when a document status changes.
 * 4. onPaymentCreated        — Firestore onCreate trigger; fires when a payment is recorded.
 */

import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { onDocumentWritten, onDocumentCreated, FirestoreEvent, Change, QueryDocumentSnapshot, DocumentSnapshot } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Every event type that can appear in the audit log.
 */
export type AuditEventType =
  | 'client_accessed'
  | 'document_generated'
  | 'document_exported'
  | 'document_status_changed'
  | 'payment_created'
  | 'payment_updated'
  | 'email_sent'
  | 'login'
  | 'settings_changed'
  | 'data_exported';

/**
 * Shape of a single entry in the `firms/{firmId}/auditLog` collection.
 */
export interface AuditEntry {
  /** Firestore document ID (auto-assigned) */
  id: string;
  firmId: string;
  eventType: AuditEventType;
  userId: string;
  userEmail: string;
  userRole: string;
  clientId?: string;
  clientName?: string;
  documentId?: string;
  /** Human-readable description of what happened. */
  details: string;
  /** Optional structured data providing additional context. */
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: admin.firestore.Timestamp;
}

/**
 * Input payload for `logAuditEvent`. Omits `id` and `timestamp` — those are
 * assigned by the helper itself.
 */
export type LogAuditEventInput = Omit<AuditEntry, 'id' | 'timestamp'>;

// ---------------------------------------------------------------------------
// 1. logAuditEvent — internal helper
// ---------------------------------------------------------------------------

/**
 * Write a structured audit log entry to `firms/{firmId}/auditLog`.
 *
 * This is a plain async helper, not a Cloud Function. It is called directly by
 * other Cloud Functions (e.g. email-notifications, generate-documents) that
 * already have the required context.
 *
 * @param input  Audit event data (without `id` and `timestamp`).
 * @returns      The Firestore document reference of the written entry.
 */
export async function logAuditEvent(
  input: LogAuditEventInput,
): Promise<admin.firestore.DocumentReference> {
  const db = admin.firestore();

  const collectionRef = db.collection(`firms/${input.firmId}/auditLog`);
  const docRef = collectionRef.doc(); // auto-ID

  const entry: AuditEntry = {
    ...input,
    id: docRef.id,
    timestamp: admin.firestore.Timestamp.now(),
  };

  try {
    await docRef.set(entry);
    logger.debug('[logAuditEvent] Written', {
      firmId: input.firmId,
      eventType: input.eventType,
      docId: docRef.id,
    });
  } catch (err) {
    // Audit failures must never crash the calling function.
    // Log the error but swallow it so the primary operation succeeds.
    logger.error('[logAuditEvent] Failed to write audit entry', {
      firmId: input.firmId,
      eventType: input.eventType,
      error: (err as Error).message,
    });
  }

  return docRef;
}

// ---------------------------------------------------------------------------
// 2. logAccess — onCall v2
// ---------------------------------------------------------------------------

interface LogAccessRequest {
  firmId: string;
  clientId: string;
  clientName: string;
  /** Describes what the user did, e.g. "Viewed client record" or "Opened documents tab" */
  action: string;
}

/**
 * Called from the frontend whenever an authenticated attorney or staff member
 * views a sensitive client record. Since Firestore triggers cannot detect
 * reads, the client application must call this function explicitly.
 *
 * Input: `{ firmId, clientId, clientName, action }`
 */
export const logAccess = onCall(
  { region: 'us-east1' },
  async (request: CallableRequest<unknown>) => {
    // Auth check
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be logged in to log access.');
    }

    const { firmId, clientId, clientName, action } = request.data as LogAccessRequest;

    if (!firmId || !clientId || !clientName || !action) {
      throw new HttpsError(
        'invalid-argument',
        'firmId, clientId, clientName, and action are required.',
      );
    }

    const callerFirmId = request.auth.token.firmId as string | undefined;
    if (!callerFirmId || callerFirmId !== firmId) {
      throw new HttpsError('permission-denied', 'Cross-firm access logging is not permitted.');
    }

    await logAuditEvent({
      firmId,
      eventType: 'client_accessed',
      userId: request.auth.uid,
      userEmail: request.auth.token.email ?? '',
      userRole: (request.auth.token.role as string | undefined) || 'unknown',
      clientId,
      clientName,
      details: `${action} — ${clientName}`,
      metadata: {
        action,
        // Pass-through request headers if the callable SDK populates them
        // (App Check / CF v2 does not expose raw headers, so these may be undefined)
      },
    });

    logger.info('[logAccess] Logged', {
      firmId,
      clientId,
      userId: request.auth.uid,
      action,
    });

    return { success: true };
  },
);

// ---------------------------------------------------------------------------
// 3. onDocumentStatusChanged — Firestore onWrite trigger
// ---------------------------------------------------------------------------

/**
 * Fires when any field on a document record changes (create, update, or delete).
 * Specifically watches for `status` transitions and writes a
 * `document_status_changed` audit entry.
 *
 * Path: `firms/{firmId}/clients/{clientId}/documents/{docId}`
 */
export const onDocumentStatusChanged = onDocumentWritten(
  {
    document: 'firms/{firmId}/clients/{clientId}/documents/{docId}',
    region: 'us-east1',
  },
  async (event: FirestoreEvent<Change<DocumentSnapshot> | undefined>) => {
    const { firmId, clientId, docId } = event.params;

    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    // -----------------------------------------------------------------------
    // Only act when the status field actually changed
    // -----------------------------------------------------------------------
    const statusBefore = before?.status as string | undefined;
    const statusAfter = after?.status as string | undefined;

    if (statusBefore === statusAfter) {
      // Status unchanged — nothing to log (e.g. content regeneration with same status)
      return;
    }

    const title =
      (after?.displayName as string | undefined) ??
      (before?.displayName as string | undefined) ??
      docId;

    const updatedBy =
      (after?.updatedBy as string | undefined) ??
      (before?.updatedBy as string | undefined) ??
      'unknown';

    let details: string;
    if (!before?.status) {
      details = `Document '${title}' created with status '${statusAfter}'`;
    } else if (!after?.status) {
      details = `Document '${title}' was deleted (previous status: '${statusBefore}')`;
    } else {
      details = `Document '${title}' status changed from '${statusBefore}' to '${statusAfter}'`;
    }

    logger.info('[onDocumentStatusChanged]', {
      firmId,
      clientId,
      docId,
      statusBefore,
      statusAfter,
      updatedBy,
    });

    await logAuditEvent({
      firmId,
      eventType: 'document_status_changed',
      userId: updatedBy,
      userEmail: '', // Not available in Firestore trigger context
      userRole: '',  // Not available in Firestore trigger context
      clientId,
      documentId: docId,
      details,
      metadata: {
        docId,
        title,
        statusBefore: statusBefore ?? null,
        statusAfter: statusAfter ?? null,
        docType: (after?.docType as string | undefined) ?? (before?.docType as string | undefined) ?? null,
        updatedBy,
      },
    });
  },
);

// ---------------------------------------------------------------------------
// 4. onPaymentCreated — Firestore onCreate trigger
// ---------------------------------------------------------------------------

/**
 * Fires when a new payment document is created under a client record.
 * Writes a `payment_created` audit entry.
 *
 * Path: `firms/{firmId}/clients/{clientId}/payments/{paymentId}`
 */
export const onPaymentCreated = onDocumentCreated(
  {
    document: 'firms/{firmId}/clients/{clientId}/payments/{paymentId}',
    region: 'us-east1',
  },
  async (event: FirestoreEvent<QueryDocumentSnapshot | undefined>) => {
    const { firmId, clientId, paymentId } = event.params;
    const data = event.data?.data();

    if (!data) {
      logger.warn('[onPaymentCreated] No data in snapshot', { firmId, clientId, paymentId });
      return;
    }

    // Amount may be stored as cents (integer) or dollars (float) — normalise to dollars.
    const rawAmount = data.amount as number | undefined;
    const amountDisplay =
      rawAmount != null
        ? rawAmount > 500 // heuristic: values > 500 are likely cents
          ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(rawAmount / 100)
          : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(rawAmount)
        : 'unknown amount';

    const clientName =
      (data.clientName as string | undefined) ??
      (data.displayName as string | undefined) ??
      clientId;

    const createdBy = (data.createdBy as string | undefined) ?? 'unknown';
    const description = (data.description as string | undefined) ?? '';

    const details = description
      ? `Payment of ${amountDisplay} recorded for ${clientName} — ${description}`
      : `Payment of ${amountDisplay} recorded for ${clientName}`;

    logger.info('[onPaymentCreated]', {
      firmId,
      clientId,
      paymentId,
      amountDisplay,
      createdBy,
    });

    await logAuditEvent({
      firmId,
      eventType: 'payment_created',
      userId: createdBy,
      userEmail: '', // Not available in Firestore trigger context
      userRole: '',  // Not available in Firestore trigger context
      clientId,
      clientName,
      details,
      metadata: {
        paymentId,
        amountRaw: rawAmount ?? null,
        amountDisplay,
        description,
        status: (data.status as string | undefined) ?? null,
        paymentMethod: (data.paymentMethod as string | undefined) ?? null,
        createdBy,
      },
    });
  },
);
