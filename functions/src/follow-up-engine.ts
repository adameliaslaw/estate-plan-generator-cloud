/**
 * functions/src/follow-up-engine.ts
 *
 * Configurable follow-up automation engine. Attorneys set rules
 * (trigger type + delay) and a scheduled function fires emails automatically.
 * Uses _sendFollowUpEmailInternal so it runs under Admin SDK with no auth context.
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { _sendFollowUpEmailInternal } from './email-notifications';
import { logAuditEvent } from './audit-trail';
import { getFirmData, getSendGridKey, extractBranding, buildEmailHtml, ctaButton, sendViaSendGrid } from './email-notifications';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AutomationTriggerType = 'questionnaire_incomplete' | 'payment_outstanding';

const VALID_TRIGGER_TYPES: readonly AutomationTriggerType[] = [
  'questionnaire_incomplete',
  'payment_outstanding',
];

function isValidTriggerType(v: unknown): v is AutomationTriggerType {
  return typeof v === 'string' && (VALID_TRIGGER_TYPES as readonly string[]).includes(v);
}

export interface AutomationRule {
  id: string;
  triggerType: AutomationTriggerType;
  delayDays: number;
  repeatEveryDays: number; // 0 = send once, >0 = repeat on that cadence
  enabled: boolean;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
  createdBy: string;
}

// ---------------------------------------------------------------------------
// CRUD callable
// ---------------------------------------------------------------------------

interface ManageRuleRequest {
  firmId: string;
  action: 'create' | 'update' | 'delete';
  ruleId?: string;
  rule?: Partial<Omit<AutomationRule, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>>;
}

export const manageAutomationRule = onCall(
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request: CallableRequest<ManageRuleRequest>) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'You must be logged in.');
    const { firmId, action, ruleId, rule } = request.data ?? {};
    if (!firmId || !action) throw new HttpsError('invalid-argument', 'firmId and action are required.');
    if ((request.auth.token['firmId'] as string | undefined) !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot manage rules for a different firm.');
    }

    const db = admin.firestore();
    const col = db.collection(`firms/${firmId}/automationRules`);
    const now = admin.firestore.FieldValue.serverTimestamp();

    if (action === 'create') {
      if (!isValidTriggerType(rule?.triggerType)) {
        throw new HttpsError(
          'invalid-argument',
          `triggerType must be one of: ${VALID_TRIGGER_TYPES.join(', ')}`,
        );
      }
      const ref = await col.add({
        triggerType: rule.triggerType,
        delayDays: rule.delayDays ?? 7,
        repeatEveryDays: rule.repeatEveryDays ?? 7,
        enabled: rule.enabled ?? true,
        createdAt: now,
        updatedAt: now,
        createdBy: request.auth.uid,
      });
      return { id: ref.id };
    }

    if (action === 'update') {
      if (!ruleId) throw new HttpsError('invalid-argument', 'ruleId is required for update.');
      const updates: Record<string, unknown> = { updatedAt: now };
      if (rule?.triggerType !== undefined) {
        if (!isValidTriggerType(rule.triggerType)) {
          throw new HttpsError(
            'invalid-argument',
            `triggerType must be one of: ${VALID_TRIGGER_TYPES.join(', ')}`,
          );
        }
        updates['triggerType'] = rule.triggerType;
      }
      if (rule?.delayDays !== undefined) updates['delayDays'] = rule.delayDays;
      if (rule?.repeatEveryDays !== undefined) updates['repeatEveryDays'] = rule.repeatEveryDays;
      if (rule?.enabled !== undefined) updates['enabled'] = rule.enabled;
      await col.doc(ruleId).update(updates);
      return { id: ruleId };
    }

    if (action === 'delete') {
      if (!ruleId) throw new HttpsError('invalid-argument', 'ruleId is required for delete.');
      await col.doc(ruleId).delete();
      return { deleted: true };
    }

    throw new HttpsError('invalid-argument', 'action must be create, update, or delete.');
  },
);

// ---------------------------------------------------------------------------
// List callable
// ---------------------------------------------------------------------------

export const listAutomationRules = onCall(
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request: CallableRequest<{ firmId: string }>) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'You must be logged in.');
    const { firmId } = request.data ?? {};
    if (!firmId) throw new HttpsError('invalid-argument', 'firmId is required.');
    if ((request.auth.token['firmId'] as string | undefined) !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot list rules for a different firm.');
    }

    const db = admin.firestore();
    const snap = await db.collection(`firms/${firmId}/automationRules`)
      .orderBy('createdAt', 'asc')
      .get();

    const rules = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return { rules };
  },
);

// ---------------------------------------------------------------------------
// Scheduler — runs every 60 minutes
// ---------------------------------------------------------------------------

export const scheduledFollowUps = onSchedule(
  { schedule: 'every 60 minutes', region: 'us-east1', timeZone: 'America/New_York' },
  async (_event) => {
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    const firmsSnap = await db.collection('firms').get();
    for (const firmDoc of firmsSnap.docs) {
      const firmId = firmDoc.id;
      const firmData = firmDoc.data();
      if (!firmData['sendGridApiKey']) continue;

      const rulesSnap = await db.collection(`firms/${firmId}/automationRules`)
        .where('enabled', '==', true)
        .get();

      for (const ruleDoc of rulesSnap.docs) {
        const rule = { id: ruleDoc.id, ...ruleDoc.data() } as AutomationRule;
        try {
          await processRule(db, firmId, rule, now);
        } catch (err) {
          logger.error('[scheduledFollowUps] Rule error', { firmId, ruleId: rule.id, err });
        }
      }
    }

    logger.info('[scheduledFollowUps] Completed run', { ts: now.toDate().toISOString() });
  },
);

// ---------------------------------------------------------------------------
// Rule processor
// ---------------------------------------------------------------------------

async function processRule(
  db: admin.firestore.Firestore,
  firmId: string,
  rule: AutomationRule,
  now: admin.firestore.Timestamp,
): Promise<void> {
  const cutoff = admin.firestore.Timestamp.fromMillis(
    now.toMillis() - rule.delayDays * 24 * 60 * 60 * 1000,
  );

  // Single inequality on createdAt; status/balance filtered in memory to avoid
  // requiring a composite index with a second inequality.
  const clientsSnap = await db.collection(`firms/${firmId}/clients`)
    .where('isActive', '==', true)
    .where('createdAt', '<=', cutoff)
    .get();

  for (const clientDoc of clientsSnap.docs) {
    const client = clientDoc.data();

    // Defensive: an unknown trigger type slipped past validation must not
    // fall through to a send. Skip silently and log for visibility.
    if (rule.triggerType === 'questionnaire_incomplete') {
      const status = (client['questionnaireProgress'] as Record<string, unknown> | undefined)?.['status'];
      if (status === 'completed') continue;
    } else if (rule.triggerType === 'payment_outstanding') {
      const balanceDue = (client['packageDetails'] as Record<string, unknown> | undefined)?.['balanceDue'];
      if (!balanceDue || (balanceDue as number) <= 0) continue;
    } else {
      logger.warn('[scheduledFollowUps] Unknown triggerType — skipping', {
        firmId,
        ruleId: rule.id,
        triggerType: rule.triggerType,
      });
      return;
    }

    const personalInfo = client['personalInfo'] as Record<string, unknown> | undefined;
    const clientEmail = (personalInfo?.['email'] as string) || '';
    const firstName = (personalInfo?.['firstName'] as string) || '';
    const lastName = (personalInfo?.['lastName'] as string) || '';
    const clientName = `${firstName} ${lastName}`.trim();

    if (!clientEmail || !clientName) continue;

    // Per-rule dedup key — rules with the same triggerType but different
    // cadences must not share a log entry.
    const logRef = db.doc(`firms/${firmId}/automationLog/${clientDoc.id}_${rule.id}`);

    // Atomically reserve the send slot before dispatching. Cloud Scheduler is
    // at-least-once; two overlapping invocations could otherwise both observe
    // no recent log and both send. Reserving inside a transaction makes the
    // check-then-write atomic so only one wins.
    let reserved = false;
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(logRef);
        if (snap.exists) {
          const lastSent = snap.data()!['lastSentAt'] as admin.firestore.Timestamp;
          if (rule.repeatEveryDays === 0) throw new Error('__one_shot_done');
          const nextSendMs = lastSent.toMillis() + rule.repeatEveryDays * 24 * 60 * 60 * 1000;
          if (now.toMillis() < nextSendMs) throw new Error('__too_soon');
        }
        tx.set(logRef, {
          lastSentAt: now,
          triggerType: rule.triggerType,
          ruleId: rule.id,
        });
      });
      reserved = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === '__one_shot_done' || msg === '__too_soon') continue;
      logger.error('[scheduledFollowUps] Reservation failed', { firmId, clientId: clientDoc.id, ruleId: rule.id, err });
      continue;
    }
    if (!reserved) continue;

    const clientCreatedAt = client['createdAt'] as admin.firestore.Timestamp | undefined;
    const daysSince = clientCreatedAt
      ? Math.floor((now.toMillis() - clientCreatedAt.toMillis()) / (24 * 60 * 60 * 1000))
      : rule.delayDays;

    // We've reserved the slot. If the send fails, we accept missing this
    // cycle's email rather than rolling back and risking duplicate sends on
    // the next overlapping invocation.
    try {
      if (rule.triggerType === 'questionnaire_incomplete') {
        await _sendFollowUpEmailInternal(firmId, clientDoc.id, clientEmail, clientName, daysSince);
      } else if (rule.triggerType === 'payment_outstanding') {
        await _sendPaymentReminderInternal(firmId, clientEmail, clientName, daysSince);
      }

      await logAuditEvent({
        firmId,
        eventType: 'email_sent',
        userId: 'system',
        userEmail: 'system',
        userRole: 'system',
        clientId: clientDoc.id,
        clientName,
        details: `Automated ${rule.triggerType} follow-up sent to ${clientEmail} (${daysSince}d since creation)`,
        metadata: { emailType: rule.triggerType, recipientEmail: clientEmail, daysSince, ruleId: rule.id },
      });

      logger.info('[scheduledFollowUps] Sent', { firmId, clientId: clientDoc.id, ruleId: rule.id, triggerType: rule.triggerType });
    } catch (err) {
      logger.error('[scheduledFollowUps] Send failed after reservation', { firmId, clientId: clientDoc.id, ruleId: rule.id, err });
    }
  }
}

// ---------------------------------------------------------------------------
// Payment outstanding email
// ---------------------------------------------------------------------------

async function _sendPaymentReminderInternal(
  firmId: string,
  clientEmail: string,
  clientName: string,
  daysSince: number,
): Promise<void> {
  const firmData = await getFirmData(firmId);
  const apiKey = getSendGridKey(firmData);
  const branding = extractBranding(firmData);

  const subject = 'Reminder: Outstanding balance on your estate plan';
  const daysPhrase = daysSince === 1 ? '1 day' : `${daysSince} days`;

  const bodyHtml = `
<h2 style="margin:0 0 16px;font-size:22px;color:#1a202c;">Balance Due Reminder</h2>
<p style="margin:0 0 12px;">
  Dear ${clientName}, this is a friendly reminder that there is an outstanding balance on your
  estate planning matter that has been open for <strong>${daysPhrase}</strong>.
</p>
<p style="margin:0 0 12px;">
  Please contact our office at your earliest convenience to arrange payment so we can
  continue moving your estate plan forward.
</p>
${ctaButton('Contact Our Office', `mailto:${branding.firmEmail || ''}`, branding.primaryColor)}
<p style="margin:16px 0 0;font-size:13px;color:#718096;">
  If you believe this is in error, please reach out to us at
  ${branding.firmEmail || branding.firmPhone || 'our office'}.
</p>`;

  const html = buildEmailHtml(bodyHtml, branding, 'Friendly reminder — outstanding balance on your estate plan.');

  await sendViaSendGrid(apiKey, {
    personalizations: [{ to: [{ email: clientEmail, name: clientName }], subject }],
    from: { email: branding.firmEmail || 'noreply@estateplan.app', name: branding.firmName },
    content: [{ type: 'text/html', value: html }],
  });

  logger.info('[_sendPaymentReminderInternal] Sent', { firmId, clientEmail });
}
