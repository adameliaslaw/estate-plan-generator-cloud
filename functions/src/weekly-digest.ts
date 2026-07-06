/**
 * weekly-digest.ts
 *
 * Scheduled Cloud Function that fires every Monday at 8:00 America/New_York
 * and sends the per-firm weekly analytics digest.
 *
 * Per-firm opt-in: firms with a non-empty `weeklyDigestRecipients: string[]`
 * field on their Firestore document get the email. Firms with the field
 * missing or empty are skipped (silent opt-out).
 *
 * Each digest contains:
 *   - Inline HTML summary (revenue, clients, package mix, questionnaires,
 *     this-week deltas, action queue sizes)
 *   - PDF attachment: client roster (all active clients)
 *   - PDF attachment: analytics summary (one-pager mirroring the inline block)
 *
 * Requires: Cloud Scheduler API + Pub/Sub API enabled in GCP. Without those,
 * the function will deploy but never fire — see HOMEWORK.md.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { loadFirmSecrets } from './firm-secrets';

import {
  buildEmailHtml,
  extractBranding,
  getSendGridKey,
  sendViaSendGrid,
  type SendGridPayload,
} from './email-notifications';
import {
  buildAnalyticsSummaryPdf,
  buildClientRosterPdf,
  computeDigestStats,
  type PdfClient,
  type PdfDocument,
  type DigestStats,
} from './pdf-reports';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrencyCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function renderInlineSummary(stats: DigestStats, primaryColor: string): string {
  const weekLabel = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const metricRow = (label: string, value: string): string => `
  <tr>
    <td style="padding:6px 0;color:#4a5568;font-size:14px;">${label}</td>
    <td style="padding:6px 0;text-align:right;font-weight:600;color:#1a202c;font-size:14px;">${value}</td>
  </tr>`;

  return `
<h2 style="margin:0 0 6px;font-size:22px;color:#1a202c;">Weekly Analytics Digest</h2>
<p style="margin:0 0 20px;color:#718096;font-size:13px;">Week of ${weekLabel}</p>

<h3 style="margin:18px 0 8px;font-size:14px;color:${primaryColor};text-transform:uppercase;letter-spacing:0.5px;">Revenue</h3>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
  ${metricRow('Total Revenue', formatCurrencyCents(stats.totalRevenue))}
  ${metricRow('Outstanding Balance', formatCurrencyCents(stats.totalBalance))}
  ${metricRow('Collection Rate', `${stats.collectRatePct}%`)}
</table>

<h3 style="margin:24px 0 8px;font-size:14px;color:${primaryColor};text-transform:uppercase;letter-spacing:0.5px;">Clients</h3>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
  ${metricRow('Active Clients', String(stats.activeCount))}
  ${metricRow('New This Week', String(stats.newClientsThisWeek))}
  ${metricRow('Basic Estate Plans', String(stats.packages.foundation))}
  ${metricRow('Revocable Trusts', String(stats.packages.guardian))}
  ${metricRow('Irrevocable Trusts', String(stats.packages.fortress))}
</table>

<h3 style="margin:24px 0 8px;font-size:14px;color:${primaryColor};text-transform:uppercase;letter-spacing:0.5px;">Questionnaires</h3>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
  ${metricRow('Completed', String(stats.qCompleted))}
  ${metricRow('In Progress', String(stats.qInProgress))}
  ${metricRow('Not Started', String(stats.qNotStarted))}
  ${metricRow('Completed This Week', String(stats.questionnairesCompletedThisWeek))}
</table>

<h3 style="margin:24px 0 8px;font-size:14px;color:${primaryColor};text-transform:uppercase;letter-spacing:0.5px;">Action Queues</h3>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
  ${metricRow('Ready to Draft', String(stats.readyToDraft))}
  ${metricRow('Awaiting Review', String(stats.awaitingReview))}
  ${metricRow('Overdue Deadlines', String(stats.overdueDeadlines))}
</table>

<p style="margin:24px 0 0;color:#718096;font-size:12px;font-style:italic;">
  The attached PDFs contain the full client roster and a printable version of this summary.
</p>`;
}

// ── Per-firm sender ───────────────────────────────────────────────────────────

async function sendDigestForFirm(
  db: admin.firestore.Firestore,
  firmId: string,
  firmData: admin.firestore.DocumentData,
): Promise<{ sent: number; skipped: boolean; reason?: string }> {
  const recipients: string[] = Array.isArray(firmData.weeklyDigestRecipients)
    ? firmData.weeklyDigestRecipients.filter(
        (e: unknown): e is string => typeof e === 'string' && e.includes('@'),
      )
    : [];

  if (recipients.length === 0) {
    return { sent: 0, skipped: true, reason: 'no recipients configured' };
  }

  let apiKey: string;
  try {
    apiKey = getSendGridKey(firmData);
  } catch {
    return { sent: 0, skipped: true, reason: 'SendGrid not configured' };
  }

  const branding = extractBranding(firmData);
  const primaryColor = branding.primaryColor || '#1a365d';

  // Pull all clients + documents for this firm
  const clientsSnap = await db.collection(`firms/${firmId}/clients`).get();
  const clients: PdfClient[] = clientsSnap.docs.map((d) => {
    const raw = d.data();
    return { id: d.id, ...(raw as Omit<PdfClient, 'id'>) };
  });

  const docsSnap = await db
    .collectionGroup('documents')
    .where('firmId', '==', firmId)
    .get();
  const documents: PdfDocument[] = docsSnap.docs.map(
    (d) => d.data() as PdfDocument,
  );

  const stats = computeDigestStats(clients, documents);
  const inlineBody = renderInlineSummary(stats, primaryColor);
  const html = buildEmailHtml(
    inlineBody,
    branding,
    `Weekly analytics digest for ${branding.firmName}`,
  );

  // Generate both PDFs
  const rosterPdf = buildClientRosterPdf(clients, documents, {
    firmName: branding.firmName,
    primaryColor,
  });
  const summaryPdf = buildAnalyticsSummaryPdf(stats, {
    firmName: branding.firmName,
    primaryColor,
  });

  const datestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  const payload: SendGridPayload = {
    personalizations: [
      {
        to: recipients.map((email) => ({ email })),
        subject: `${branding.firmName} — Weekly Analytics Digest`,
      },
    ],
    from: {
      email: branding.firmEmail || 'noreply@estateplan.app',
      name: branding.firmName,
    },
    content: [{ type: 'text/html', value: html }],
    attachments: [
      {
        content: rosterPdf.toString('base64'),
        filename: `client-roster-${datestamp}.pdf`,
        type: 'application/pdf',
        disposition: 'attachment',
      },
      {
        content: summaryPdf.toString('base64'),
        filename: `analytics-summary-${datestamp}.pdf`,
        type: 'application/pdf',
        disposition: 'attachment',
      },
    ],
  };

  await sendViaSendGrid(apiKey, payload);
  return { sent: recipients.length, skipped: false };
}

// ── Scheduled entry point ────────────────────────────────────────────────────

/**
 * Monday 8:00 America/New_York. Cron minute=0, hour=8, dayOfWeek=1 (Mon).
 * Cloud Scheduler + Pub/Sub APIs must be enabled in GCP for this to fire.
 */
export const sendWeeklyDigest = onSchedule(
  {
    schedule: '0 8 * * 1',
    timeZone: 'America/New_York',
    region: 'us-east1',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    logger.info('[sendWeeklyDigest] Starting scheduled run');
    const db = admin.firestore();

    const firmsSnap = await db.collection('firms').get();

    let firmsProcessed = 0;
    let emailsSent = 0;
    let firmsSkipped = 0;

    for (const firmDoc of firmsSnap.docs) {
      const firmId = firmDoc.id;
      try {
        // Merge Functions-only secrets (SendGrid key moved off the firm doc in
        // #59 / finding AR) so getSendGridKey() can find it.
        const firmData = { ...firmDoc.data(), ...(await loadFirmSecrets(firmId)) };
        const result = await sendDigestForFirm(db, firmId, firmData);
        if (result.skipped) {
          firmsSkipped++;
          logger.info('[sendWeeklyDigest] Skipped firm', {
            firmId,
            reason: result.reason,
          });
        } else {
          firmsProcessed++;
          emailsSent += result.sent;
          logger.info('[sendWeeklyDigest] Sent digest', {
            firmId,
            recipients: result.sent,
          });
        }
      } catch (err) {
        logger.error('[sendWeeklyDigest] Firm failed', {
          firmId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('[sendWeeklyDigest] Completed', {
      firmsProcessed,
      firmsSkipped,
      emailsSent,
    });
  },
);
