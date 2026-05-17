/**
 * email-notifications.ts
 *
 * Cloud Functions for sending email notifications via SendGrid.
 * All functions read the SendGrid API key from the firm's Firestore document
 * at firms/{firmId}.sendGridApiKey.
 *
 * Functions:
 * 1. sendQuestionnaireInvitation     — Email client a link to complete questionnaire
 * 2. sendQuestionnaireCompleteNotification — Notify attorney when client completes questionnaire
 * 3. sendDocumentReadyNotification   — Notify attorney/paralegal when documents are generated
 * 4. sendPaymentReceipt              — Email client a payment confirmation
 * 5. sendPaymentReceivedNotification — Notify attorney of payment received
 * 6. sendAppointmentReminder         — Email reminder 24 hours before appointment
 * 7. sendFollowUpReminder            — Automated follow-up if questionnaire not completed in 7 days
 *
 * Also exports:
 * 8. scheduledReminders — Scheduled function (every hour) that checks for upcoming appointments
 *    and overdue questionnaires, sends reminders. Commented out pending Cloud Scheduler setup.
 */

import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';

import { logAuditEvent } from './audit-trail';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Branding data read from the firm's Firestore document. */
interface FirmBranding {
  firmName: string;
  firmPhone: string;
  firmEmail: string;
  logoUrl: string;
  primaryColor: string;
}

/** Minimal SendGrid mail payload (only fields we use). */
export interface SendGridPayload {
  personalizations: Array<{
    to: Array<{ email: string; name?: string }>;
    subject: string;
  }>;
  from: { email: string; name: string };
  content: Array<{ type: string; value: string }>;
  attachments?: Array<{
    content: string; // base64-encoded
    filename: string;
    type: string; // MIME
    disposition?: 'attachment' | 'inline';
  }>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Read the firm document from Firestore. Throws `not-found` if it doesn't
 * exist, and `failed-precondition` if SendGrid is not configured.
 */
export async function getFirmData(firmId: string): Promise<admin.firestore.DocumentData> {
  const db = admin.firestore();
  const snap = await db.doc(`firms/${firmId}`).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', `Firm ${firmId} not found.`);
  }
  return snap.data()!;
}

/**
 * Extract SendGrid API key from firm data. Throws `failed-precondition` if
 * the key is missing so the caller gets an actionable error message.
 */
export function getSendGridKey(firmData: admin.firestore.DocumentData): string {
  const key = firmData.sendGridApiKey as string | undefined;
  if (!key || key.trim() === '') {
    throw new HttpsError(
      'failed-precondition',
      'SendGrid API key not configured. Please add one in Settings → Integrations.',
    );
  }
  return key.trim();
}

/**
 * Extract branding fields from a firm document, providing sensible defaults
 * for any values that may be missing.
 */
export function extractBranding(firmData: admin.firestore.DocumentData): FirmBranding {
  return {
    firmName: (firmData.firmName as string) || 'Your Estate Planning Firm',
    firmPhone: (firmData.firmPhone as string) || '',
    firmEmail: (firmData.firmEmail as string) || '',
    logoUrl: (firmData.logoUrl as string) || '',
    primaryColor: (firmData.primaryColor as string) || '#1a365d',
  };
}

/**
 * Wrap the provided body HTML in a full, branded HTML email template.
 *
 * @param bodyHtml     Inner HTML content (cards, paragraphs, CTA buttons).
 * @param branding     Firm branding values.
 * @param preheader    Short plain-text summary shown in email client previews.
 */
export function buildEmailHtml(
  bodyHtml: string,
  branding: FirmBranding,
  preheader = '',
): string {
  const { firmName, firmPhone, firmEmail, logoUrl, primaryColor } = branding;

  const logoBlock = logoUrl
    ? `<img src="${logoUrl}" alt="${firmName}" style="max-height:60px;max-width:200px;display:block;margin:0 auto 12px;" />`
    : `<div style="font-size:22px;font-weight:700;color:${primaryColor};text-align:center;">${firmName}</div>`;

  const contactLine = [firmPhone, firmEmail].filter(Boolean).join(' &nbsp;|&nbsp; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>${firmName}</title>
  <!--[if mso]>
  <noscript>
    <xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <!-- Preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}&nbsp;&zwnj;&hairsp;&zwnj;&hairsp;&zwnj;&hairsp;&zwnj;&hairsp;&zwnj;&hairsp;&zwnj;&hairsp;</div>

  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!-- Card -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
               style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;
                      box-shadow:0 2px 8px rgba(0,0,0,0.08);overflow:hidden;">

          <!-- Header bar -->
          <tr>
            <td style="background-color:${primaryColor};padding:24px 32px;text-align:center;">
              ${logoBlock}
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px 24px;color:#1a202c;font-size:15px;line-height:1.6;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 40px;">
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:0;" />
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 28px;color:#718096;font-size:12px;line-height:1.5;">
              ${contactLine ? `<p style="margin:0 0 8px;">${firmName} &nbsp;|&nbsp; ${contactLine}</p>` : `<p style="margin:0 0 8px;">${firmName}</p>`}
              <p style="margin:0;font-size:11px;color:#a0aec0;">
                <strong>CONFIDENTIALITY NOTICE:</strong> This email and any attachments are for the
                exclusive and confidential use of the intended recipient. If you are not the intended
                recipient, any use, distribution, or copying of this communication is strictly
                prohibited. If you have received this message in error, please notify the sender
                immediately and permanently delete this email and any attachments.
              </p>
            </td>
          </tr>

        </table>
        <!-- /Card -->

      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Render a CTA button as an HTML table (VML-compatible for Outlook).
 */
export function ctaButton(label: string, url: string, color: string): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto;">
  <tr>
    <td align="center" style="border-radius:6px;background-color:${color};">
      <a href="${url}" target="_blank"
         style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;
                color:#ffffff;text-decoration:none;border-radius:6px;
                background-color:${color};mso-padding-alt:14px 32px;"
      >${label}</a>
    </td>
  </tr>
</table>`;
}

/**
 * Format a number of cents as a US dollar currency string, e.g. "$1,250.00".
 */
function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    cents / 100,
  );
}

/**
 * Send one email via the SendGrid v3 REST API using Node's built-in `fetch`.
 *
 * @throws `HttpsError('internal', ...)` on non-2xx responses.
 */
export async function sendViaSendGrid(
  apiKey: string,
  payload: SendGridPayload,
): Promise<void> {

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorBody = '';
    try {
      errorBody = await response.text();
    } catch {
      // Ignore body-read failures; we'll use the status text instead.
    }
    logger.error('[email-notifications] SendGrid error', {
      status: response.status,
      body: errorBody.slice(0, 500),
    });
    throw new HttpsError(
      'internal',
      `SendGrid returned ${response.status}: ${response.statusText}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Custom Template Helpers
// ---------------------------------------------------------------------------

async function getCustomTemplate(firmId: string, trigger: string): Promise<{ subject: string, content: string } | null> {
  const db = admin.firestore();
  const snap = await db.collection(`firms/${firmId}/emailTemplates`)
    .where('trigger', '==', trigger)
    .where('isActive', '==', true)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const data = snap.docs[0].data();
  return { subject: data.subject || '', content: data.content || '' };
}

function processCustomTemplate(
  template: { subject: string; content: string },
  variables: Record<string, string>,
): { subject: string; bodyHtml: string } {
  let { subject, content } = template;

  for (const [key, val] of Object.entries(variables)) {
    const rx = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    subject = subject.replace(rx, val);
    content = content.replace(rx, val);
  }

  if (!content.includes('<p>') && !content.includes('<br')) {
    content = content.replace(/\n/g, '<br />');
  }

  const bodyHtml = `<div style="font-size:15px;color:#1a202c;line-height:1.6;">${content}</div>`;
  return { subject, bodyHtml };
}

// ---------------------------------------------------------------------------
// 1. sendQuestionnaireInvitation
// ---------------------------------------------------------------------------

interface QuestionnaireInvitationRequest {
  firmId: string;
  clientId: string;
  clientEmail: string;
  clientName: string;
  questionnaireUrl: string;
}

/**
 * Email the client a personalised link to complete their estate planning
 * questionnaire.
 *
 * Callable by authenticated firm staff only.
 */
export const sendQuestionnaireInvitation = onCall(
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request: CallableRequest<unknown>) => {
    // Auth check
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be logged in to send notifications.');
    }

    const {
      firmId,
      clientId,
      clientEmail,
      clientName,
      questionnaireUrl,
    } = request.data as QuestionnaireInvitationRequest;

    if (!firmId || !clientId || !clientEmail || !clientName || !questionnaireUrl) {
      throw new HttpsError(
        'invalid-argument',
        'firmId, clientId, clientEmail, clientName, and questionnaireUrl are required.',
      );
    }

    if ((request.auth.token['firmId'] as string | undefined) !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot send notifications for a different firm.');
    }

    const firmData = await getFirmData(firmId);
    const apiKey = getSendGridKey(firmData);
    const branding = extractBranding(firmData);

    let subject = `Complete Your Estate Planning Questionnaire — ${branding.firmName}`;
    let bodyHtml = `
<h2 style="margin:0 0 16px;font-size:22px;color:#1a202c;">Hello, ${clientName}!</h2>
<p style="margin:0 0 12px;">
  Thank you for choosing <strong>${branding.firmName}</strong> to assist with your estate planning.
  To get started, please complete a brief questionnaire that will allow us to prepare your
  personalised estate plan documents.
</p>
<p style="margin:0 0 12px;">
  The questionnaire takes approximately <strong>15–20 minutes</strong> to complete. You can save
  your progress and return at any time using the same link.
</p>
<p style="margin:0 0 24px;">
  Click the button below when you are ready to begin:
</p>
${ctaButton('Complete My Questionnaire', questionnaireUrl, branding.primaryColor)}
<p style="margin:24px 0 0;font-size:13px;color:#718096;">
  If the button does not work, copy and paste this link into your browser:<br />
  <a href="${questionnaireUrl}" style="color:${branding.primaryColor};word-break:break-all;">${questionnaireUrl}</a>
</p>
<p style="margin:16px 0 0;font-size:13px;color:#718096;">
  If you have any questions, please do not hesitate to contact us at
  ${branding.firmEmail || branding.firmPhone || 'our office'}.
</p>`;

    const customTemplate = await getCustomTemplate(firmId, 'questionnaire_invitation');
    if (customTemplate) {
      const processed = processCustomTemplate(customTemplate, {
        clientName,
        firmName: branding.firmName,
        link: `<a href="${questionnaireUrl}" style="color:${branding.primaryColor};">${questionnaireUrl}</a>`
      });
      subject = processed.subject;
      bodyHtml = processed.bodyHtml;
    }

    const html = buildEmailHtml(bodyHtml, branding, 'Your estate planning questionnaire is ready — click to begin.');

    await sendViaSendGrid(apiKey, {
      personalizations: [{ to: [{ email: clientEmail, name: clientName }], subject }],
      from: { email: branding.firmEmail || 'noreply@estateplan.app', name: branding.firmName },
      content: [{ type: 'text/html', value: html }],
    });

    logger.info('[sendQuestionnaireInvitation] Sent', { firmId, clientId, clientEmail });

    // Audit trail
    await logAuditEvent({
      firmId,
      eventType: 'email_sent',
      userId: request.auth.uid,
      userEmail: request.auth.token.email ?? '',
      userRole: (request.auth.token.role as string) ?? 'unknown',
      clientId,
      details: `Questionnaire invitation sent to ${clientEmail}`,
      metadata: { emailType: 'questionnaire_invitation', recipientEmail: clientEmail },
    });

    return { success: true };
  },
);

// ---------------------------------------------------------------------------
// 2. sendQuestionnaireCompleteNotification
// ---------------------------------------------------------------------------

interface QuestionnaireCompleteRequest {
  firmId: string;
  clientId: string;
  clientName: string;
  attorneyEmail: string;
}

/**
 * Notify the assigned attorney when a client finishes their questionnaire.
 */
export const sendQuestionnaireCompleteNotification = onCall(
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request: CallableRequest<unknown>) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be logged in to send notifications.');
    }

    const { firmId, clientId, clientName, attorneyEmail } =
      request.data as QuestionnaireCompleteRequest;

    if (!firmId || !clientId || !clientName || !attorneyEmail) {
      throw new HttpsError(
        'invalid-argument',
        'firmId, clientId, clientName, and attorneyEmail are required.',
      );
    }

    if ((request.auth.token['firmId'] as string | undefined) !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot send notifications for a different firm.');
    }

    const firmData = await getFirmData(firmId);
    const apiKey = getSendGridKey(firmData);
    const branding = extractBranding(firmData);

    const subject = `${clientName} has completed their questionnaire`;

    const bodyHtml = `
<h2 style="margin:0 0 16px;font-size:22px;color:#1a202c;">Questionnaire Complete</h2>
<p style="margin:0 0 12px;">
  Good news! <strong>${clientName}</strong> has completed their estate planning questionnaire.
  Their responses are now available in the client record and documents can be generated.
</p>
<p style="margin:0 0 12px;">
  Log in to the ${branding.firmName} portal to review the questionnaire and generate
  estate planning documents.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;">
  <tr>
    <td style="padding:8px 16px;background:#f0f4f8;border-radius:6px;border-left:4px solid ${branding.primaryColor};">
      <strong>Client:</strong> ${clientName}<br />
      <strong>Completed:</strong> ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
    </td>
  </tr>
</table>`;

    const html = buildEmailHtml(bodyHtml, branding, `${clientName} has completed their estate planning questionnaire.`);

    await sendViaSendGrid(apiKey, {
      personalizations: [{ to: [{ email: attorneyEmail }], subject }],
      from: { email: branding.firmEmail || 'noreply@estateplan.app', name: branding.firmName },
      content: [{ type: 'text/html', value: html }],
    });

    logger.info('[sendQuestionnaireCompleteNotification] Sent', {
      firmId,
      clientId,
      attorneyEmail,
    });

    await logAuditEvent({
      firmId,
      eventType: 'email_sent',
      userId: request.auth.uid,
      userEmail: request.auth.token.email ?? '',
      userRole: (request.auth.token.role as string) ?? 'unknown',
      clientId,
      clientName,
      details: `Questionnaire complete notification sent to ${attorneyEmail}`,
      metadata: { emailType: 'questionnaire_complete', recipientEmail: attorneyEmail },
    });

    return { success: true };
  },
);

// ---------------------------------------------------------------------------
// 3. sendDocumentReadyNotification
// ---------------------------------------------------------------------------

interface DocumentReadyRequest {
  firmId: string;
  clientId: string;
  clientName: string;
  documentTypes: string[];
  recipientEmail: string;
}

/**
 * Notify attorney/paralegal that AI-generated documents are ready for review.
 */
export const sendDocumentReadyNotification = onCall(
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request: CallableRequest<unknown>) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be logged in to send notifications.');
    }

    const { firmId, clientId, clientName, documentTypes, recipientEmail } =
      request.data as DocumentReadyRequest;

    if (!firmId || !clientId || !clientName || !recipientEmail || !Array.isArray(documentTypes)) {
      throw new HttpsError(
        'invalid-argument',
        'firmId, clientId, clientName, documentTypes, and recipientEmail are required.',
      );
    }

    if ((request.auth.token['firmId'] as string | undefined) !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot send notifications for a different firm.');
    }

    const firmData = await getFirmData(firmId);
    const apiKey = getSendGridKey(firmData);
    const branding = extractBranding(firmData);

    const subject = `Estate plan documents ready for review — ${clientName}`;

    const docList = documentTypes
      .map((d) => `<li style="margin-bottom:4px;">${d}</li>`)
      .join('');

    const bodyHtml = `
<h2 style="margin:0 0 16px;font-size:22px;color:#1a202c;">Documents Ready for Review</h2>
<p style="margin:0 0 12px;">
  The following estate plan documents have been generated for <strong>${clientName}</strong>
  and are ready for your review in the client portal:
</p>
<ul style="margin:12px 0 20px;padding-left:24px;color:#2d3748;">
  ${docList}
</ul>
<p style="margin:0 0 12px;">
  Please review each document carefully, make any necessary edits, and update the document
  status when approved.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;">
  <tr>
    <td style="padding:8px 16px;background:#f0f4f8;border-radius:6px;border-left:4px solid ${branding.primaryColor};">
      <strong>Client:</strong> ${clientName}<br />
      <strong>Documents:</strong> ${documentTypes.length}<br />
      <strong>Generated:</strong> ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
    </td>
  </tr>
</table>`;

    const html = buildEmailHtml(
      bodyHtml,
      branding,
      `${documentTypes.length} document(s) for ${clientName} are ready for review.`,
    );

    await sendViaSendGrid(apiKey, {
      personalizations: [{ to: [{ email: recipientEmail }], subject }],
      from: { email: branding.firmEmail || 'noreply@estateplan.app', name: branding.firmName },
      content: [{ type: 'text/html', value: html }],
    });

    logger.info('[sendDocumentReadyNotification] Sent', {
      firmId,
      clientId,
      recipientEmail,
      documentTypes,
    });

    await logAuditEvent({
      firmId,
      eventType: 'email_sent',
      userId: request.auth.uid,
      userEmail: request.auth.token.email ?? '',
      userRole: (request.auth.token.role as string) ?? 'unknown',
      clientId,
      clientName,
      details: `Document ready notification sent to ${recipientEmail} for ${documentTypes.length} document(s)`,
      metadata: {
        emailType: 'document_ready',
        recipientEmail,
        documentTypes,
      },
    });

    return { success: true };
  },
);

// ---------------------------------------------------------------------------
// 4. sendPaymentReceipt
// ---------------------------------------------------------------------------

interface PaymentReceiptRequest {
  firmId: string;
  clientId: string;
  clientEmail: string;
  clientName: string;
  /** Amount in cents (e.g., 150000 = $1,500.00) */
  amount: number;
  description: string;
}

/**
 * Email a payment receipt to the client after a successful payment.
 */
export const sendPaymentReceipt = onCall(
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request: CallableRequest<unknown>) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be logged in to send notifications.');
    }

    const { firmId, clientId, clientEmail, clientName, amount, description } =
      request.data as PaymentReceiptRequest;

    if (!firmId || !clientId || !clientEmail || !clientName || amount == null || !description) {
      throw new HttpsError(
        'invalid-argument',
        'firmId, clientId, clientEmail, clientName, amount, and description are required.',
      );
    }

    if ((request.auth.token['firmId'] as string | undefined) !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot send notifications for a different firm.');
    }

    const firmData = await getFirmData(firmId);
    const apiKey = getSendGridKey(firmData);
    const branding = extractBranding(firmData);

    const formattedAmount = formatCurrency(amount);
    let subject = `Payment Receipt — ${branding.firmName}`;
    const receiptDate = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    let bodyHtml = `
<h2 style="margin:0 0 16px;font-size:22px;color:#1a202c;">Payment Receipt</h2>
<p style="margin:0 0 16px;">
  Dear ${clientName}, thank you for your payment. Please retain this receipt for your records.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
       style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:0 0 20px;">
  <tr style="background:#f7fafc;">
    <td style="padding:12px 16px;font-weight:600;color:#4a5568;border-bottom:1px solid #e2e8f0;">Receipt Details</td>
  </tr>
  <tr>
    <td style="padding:12px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:4px 0;color:#718096;width:40%;">Date</td>
          <td style="padding:4px 0;color:#1a202c;font-weight:500;">${receiptDate}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#718096;">Description</td>
          <td style="padding:4px 0;color:#1a202c;">${description}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#718096;">Billed to</td>
          <td style="padding:4px 0;color:#1a202c;">${clientName}</td>
        </tr>
        <tr style="border-top:1px solid #e2e8f0;">
          <td style="padding:12px 0 4px;color:#1a202c;font-weight:700;font-size:16px;">Amount Paid</td>
          <td style="padding:12px 0 4px;color:#1a202c;font-weight:700;font-size:18px;">${formattedAmount}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
<p style="margin:0;font-size:13px;color:#718096;">
  If you have any questions about this charge, please contact us at
  ${branding.firmEmail || branding.firmPhone || 'our office'}.
</p>`;

    const html = buildEmailHtml(
      bodyHtml,
      branding,
      `Payment of ${formattedAmount} received — thank you!`,
    );

    await sendViaSendGrid(apiKey, {
      personalizations: [{ to: [{ email: clientEmail, name: clientName }], subject }],
      from: { email: branding.firmEmail || 'noreply@estateplan.app', name: branding.firmName },
      content: [{ type: 'text/html', value: html }],
    });

    logger.info('[sendPaymentReceipt] Sent', { firmId, clientId, clientEmail, amount });

    await logAuditEvent({
      firmId,
      eventType: 'email_sent',
      userId: request.auth.uid,
      userEmail: request.auth.token.email ?? '',
      userRole: (request.auth.token.role as string) ?? 'unknown',
      clientId,
      clientName,
      details: `Payment receipt sent to ${clientEmail} for ${formattedAmount}`,
      metadata: {
        emailType: 'payment_receipt',
        recipientEmail: clientEmail,
        amountCents: amount,
        description,
      },
    });

    return { success: true };
  },
);

// ---------------------------------------------------------------------------
// 5. sendPaymentReceivedNotification
// ---------------------------------------------------------------------------

interface PaymentReceivedNotificationRequest {
  firmId: string;
  clientId: string;
  clientName: string;
  /** Amount in cents */
  amount: number;
  attorneyEmail: string;
}

/**
 * Notify the attorney that a client payment has been received.
 */
export const sendPaymentReceivedNotification = onCall(
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request: CallableRequest<unknown>) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be logged in to send notifications.');
    }

    const { firmId, clientId, clientName, amount, attorneyEmail } =
      request.data as PaymentReceivedNotificationRequest;

    if (!firmId || !clientId || !clientName || amount == null || !attorneyEmail) {
      throw new HttpsError(
        'invalid-argument',
        'firmId, clientId, clientName, amount, and attorneyEmail are required.',
      );
    }

    if ((request.auth.token['firmId'] as string | undefined) !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot send notifications for a different firm.');
    }

    const firmData = await getFirmData(firmId);
    const apiKey = getSendGridKey(firmData);
    const branding = extractBranding(firmData);

    const formattedAmount = formatCurrency(amount);
    const subject = `Payment received from ${clientName} — ${formattedAmount}`;

    const bodyHtml = `
<h2 style="margin:0 0 16px;font-size:22px;color:#1a202c;">Payment Received</h2>
<p style="margin:0 0 16px;">
  A payment has been recorded from <strong>${clientName}</strong>.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;">
  <tr>
    <td style="padding:12px 20px;background:#f0f4f8;border-radius:6px;border-left:4px solid ${branding.primaryColor};">
      <strong>Client:</strong> ${clientName}<br />
      <strong>Amount:</strong> <span style="font-size:18px;font-weight:700;color:#1a202c;">${formattedAmount}</span><br />
      <strong>Date:</strong> ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
    </td>
  </tr>
</table>
<p style="margin:16px 0 0;font-size:13px;color:#718096;">
  You can view the full payment record in the client portal.
</p>`;

    const html = buildEmailHtml(
      bodyHtml,
      branding,
      `Payment of ${formattedAmount} received from ${clientName}.`,
    );

    await sendViaSendGrid(apiKey, {
      personalizations: [{ to: [{ email: attorneyEmail }], subject }],
      from: { email: branding.firmEmail || 'noreply@estateplan.app', name: branding.firmName },
      content: [{ type: 'text/html', value: html }],
    });

    logger.info('[sendPaymentReceivedNotification] Sent', {
      firmId,
      clientId,
      attorneyEmail,
      amount,
    });

    await logAuditEvent({
      firmId,
      eventType: 'email_sent',
      userId: request.auth.uid,
      userEmail: request.auth.token.email ?? '',
      userRole: (request.auth.token.role as string) ?? 'unknown',
      clientId,
      clientName,
      details: `Payment received notification sent to ${attorneyEmail} — ${formattedAmount} from ${clientName}`,
      metadata: {
        emailType: 'payment_received',
        recipientEmail: attorneyEmail,
        amountCents: amount,
      },
    });

    return { success: true };
  },
);

// ---------------------------------------------------------------------------
// 6. sendAppointmentReminder
// ---------------------------------------------------------------------------

interface AppointmentReminderRequest {
  firmId: string;
  clientId: string;
  recipientEmail: string;
  recipientName: string;
  eventTitle: string;
  eventDate: string;  // e.g. "Monday, March 10, 2025"
  eventTime: string;  // e.g. "2:00 PM EST"
  location: string;   // address or video-call link
}

/**
 * Send a reminder email 24 hours before an appointment.
 * Called manually or by the scheduledReminders function.
 */
export const sendAppointmentReminder = onCall(
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request: CallableRequest<unknown>) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be logged in to send notifications.');
    }

    const {
      firmId,
      clientId,
      recipientEmail,
      recipientName,
      eventTitle,
      eventDate,
      eventTime,
      location,
    } = request.data as AppointmentReminderRequest;

    if (
      !firmId || !clientId || !recipientEmail || !recipientName ||
      !eventTitle || !eventDate || !eventTime
    ) {
      throw new HttpsError(
        'invalid-argument',
        'firmId, clientId, recipientEmail, recipientName, eventTitle, eventDate, and eventTime are required.',
      );
    }

    if ((request.auth.token['firmId'] as string | undefined) !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot send notifications for a different firm.');
    }

    const firmData = await getFirmData(firmId);
    const apiKey = getSendGridKey(firmData);
    const branding = extractBranding(firmData);

    let subject = `Reminder: ${eventTitle} — ${eventDate}`;

    const locationBlock = location
      ? `<tr>
           <td style="padding:4px 0;color:#718096;">Location</td>
           <td style="padding:4px 0;color:#1a202c;">${location}</td>
         </tr>`
      : '';

    let bodyHtml = `
<h2 style="margin:0 0 16px;font-size:22px;color:#1a202c;">Appointment Reminder</h2>
<p style="margin:0 0 16px;">
  Dear ${recipientName}, this is a friendly reminder about your upcoming appointment.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
       style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:0 0 20px;">
  <tr style="background:#f7fafc;">
    <td style="padding:12px 16px;font-weight:600;color:#4a5568;border-bottom:1px solid #e2e8f0;">
      Appointment Details
    </td>
  </tr>
  <tr>
    <td style="padding:12px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:4px 0;color:#718096;width:40%;">Event</td>
          <td style="padding:4px 0;color:#1a202c;font-weight:600;">${eventTitle}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#718096;">Date</td>
          <td style="padding:4px 0;color:#1a202c;">${eventDate}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#718096;">Time</td>
          <td style="padding:4px 0;color:#1a202c;">${eventTime}</td>
        </tr>
        ${locationBlock}
      </table>
    </td>
  </tr>
</table>
<p style="margin:0 0 12px;">
  If you need to reschedule or have any questions, please contact us as soon as possible at
  ${branding.firmEmail || branding.firmPhone || 'our office'}.
</p>
  We look forward to meeting with you.
</p>`;

    const customTemplate = await getCustomTemplate(firmId, 'appointment_confirmation');
    if (customTemplate) {
      const processed = processCustomTemplate(customTemplate, {
        clientName: recipientName,
        firmName: branding.firmName,
        date: eventDate,
        eventTitle,
        eventTime,
        location,
      });
      subject = processed.subject;
      bodyHtml = processed.bodyHtml;
    }

    const html = buildEmailHtml(
      bodyHtml,
      branding,
      `Reminder: ${eventTitle} on ${eventDate} at ${eventTime}`,
    );

    await sendViaSendGrid(apiKey, {
      personalizations: [{ to: [{ email: recipientEmail, name: recipientName }], subject }],
      from: { email: branding.firmEmail || 'noreply@estateplan.app', name: branding.firmName },
      content: [{ type: 'text/html', value: html }],
    });

    logger.info('[sendAppointmentReminder] Sent', {
      firmId,
      clientId,
      recipientEmail,
      eventTitle,
      eventDate,
    });

    await logAuditEvent({
      firmId,
      eventType: 'email_sent',
      userId: request.auth.uid,
      userEmail: request.auth.token.email ?? '',
      userRole: (request.auth.token.role as string) ?? 'unknown',
      clientId,
      details: `Appointment reminder sent to ${recipientEmail} for "${eventTitle}" on ${eventDate}`,
      metadata: {
        emailType: 'appointment_reminder',
        recipientEmail,
        eventTitle,
        eventDate,
        eventTime,
      },
    });

    return { success: true };
  },
);

// ---------------------------------------------------------------------------
// 7. sendFollowUpReminder
// ---------------------------------------------------------------------------

interface FollowUpReminderRequest {
  firmId: string;
  clientId: string;
  clientEmail: string;
  clientName: string;
  daysSinceInvitation: number;
}

/**
 * Core email-build + send logic, no auth context. Safe to call from both the
 * onCall wrapper below and the scheduled follow-up engine (Admin SDK, no JWT).
 */
export async function _sendFollowUpEmailInternal(
  firmId: string,
  clientId: string,
  clientEmail: string,
  clientName: string,
  daysSince: number,
): Promise<void> {
  const db = admin.firestore();
  const clientSnap = await db.doc(`firms/${firmId}/clients/${clientId}`).get();
  if (!clientSnap.exists) return; // client deleted — skip silently
  const clientData = clientSnap.data()!;
  const questionnaireUrl = (clientData['questionnaireUrl'] as string) || '';

  const firmData = await getFirmData(firmId);
  const apiKey = getSendGridKey(firmData);
  const branding = extractBranding(firmData);

  const subject = 'Reminder: Please complete your estate planning questionnaire';
  const daysPhrase = daysSince === 1 ? '1 day' : `${daysSince} days`;

  const ctaBlock = questionnaireUrl
    ? ctaButton('Complete My Questionnaire', questionnaireUrl, branding.primaryColor)
    : '';

  const urlLine = questionnaireUrl
    ? `<p style="margin:16px 0 0;font-size:13px;color:#718096;">
         If the button does not work, copy and paste this link:<br />
         <a href="${questionnaireUrl}" style="color:${branding.primaryColor};word-break:break-all;">${questionnaireUrl}</a>
       </p>`
    : '';

  const bodyHtml = `
<h2 style="margin:0 0 16px;font-size:22px;color:#1a202c;">A Quick Reminder</h2>
<p style="margin:0 0 12px;">
  Dear ${clientName}, we noticed that your estate planning questionnaire has been waiting
  for <strong>${daysPhrase}</strong>. We wanted to follow up and make sure everything is all right.
</p>
<p style="margin:0 0 12px;">
  Completing the questionnaire is the essential first step to preparing your personalised
  estate plan. It only takes <strong>15–20 minutes</strong> and you can save your progress
  and return whenever it is convenient.
</p>
${ctaBlock}
${urlLine}
<p style="margin:16px 0 0;font-size:13px;color:#718096;">
  If you have any questions or need assistance, please do not hesitate to reach out to us at
  ${branding.firmEmail || branding.firmPhone || 'our office'}.
</p>`;

  const html = buildEmailHtml(
    bodyHtml,
    branding,
    `Friendly reminder to complete your estate planning questionnaire (${daysPhrase} since creation).`,
  );

  await sendViaSendGrid(apiKey, {
    personalizations: [{ to: [{ email: clientEmail, name: clientName }], subject }],
    from: { email: branding.firmEmail || 'noreply@estateplan.app', name: branding.firmName },
    content: [{ type: 'text/html', value: html }],
  });

  logger.info('[_sendFollowUpEmailInternal] Sent', { firmId, clientId, clientEmail, daysSince });
}

/**
 * Send an automated follow-up to a client who has not yet completed their
 * questionnaire. Typically triggered after 7 days of inactivity.
 */
export const sendFollowUpReminder = onCall(
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request: CallableRequest<unknown>) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be logged in to send notifications.');
    }

    const { firmId, clientId, clientEmail, clientName, daysSinceInvitation } =
      request.data as FollowUpReminderRequest;

    if (!firmId || !clientId || !clientEmail || !clientName || daysSinceInvitation == null) {
      throw new HttpsError(
        'invalid-argument',
        'firmId, clientId, clientEmail, clientName, and daysSinceInvitation are required.',
      );
    }

    if ((request.auth.token['firmId'] as string | undefined) !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot send notifications for a different firm.');
    }

    await _sendFollowUpEmailInternal(firmId, clientId, clientEmail, clientName, daysSinceInvitation);

    await logAuditEvent({
      firmId,
      eventType: 'email_sent',
      userId: request.auth.uid,
      userEmail: request.auth.token.email ?? '',
      userRole: (request.auth.token.role as string) ?? 'unknown',
      clientId,
      clientName,
      details: `Follow-up reminder sent to ${clientEmail} (${daysSinceInvitation === 1 ? '1 day' : `${daysSinceInvitation} days`} since invitation)`,
      metadata: {
        emailType: 'follow_up_reminder',
        recipientEmail: clientEmail,
        daysSinceInvitation,
      },
    });

    return { success: true };
  },
);

// ---------------------------------------------------------------------------
// 8. scheduledReminders (commented out pending Cloud Scheduler setup)
// ---------------------------------------------------------------------------
//
// import { onSchedule } from 'firebase-functions/v2/scheduler';
//
// /**
//  * Runs every hour. Checks for:
//  *   1. Appointments scheduled within the next 24 hours → sendAppointmentReminder
//  *   2. Clients whose questionnaire has been pending for 7 days → sendFollowUpReminder
//  *
//  * Enable by:
//  *   1. Uncomment this block.
//  *   2. Exporting `scheduledReminders` from index.ts.
//  *   3. Enabling Cloud Scheduler API in the Firebase project.
//  */
// export const scheduledReminders = onSchedule(
//   { schedule: 'every 60 minutes', region: 'us-east1', timeZone: 'America/New_York' },
//   async (_event) => {
//     const db = admin.firestore();
//     const now = admin.firestore.Timestamp.now();
//     const in24h = admin.firestore.Timestamp.fromMillis(now.toMillis() + 24 * 60 * 60 * 1000);
//     const sevenDaysAgo = admin.firestore.Timestamp.fromMillis(now.toMillis() - 7 * 24 * 60 * 60 * 1000);
//
//     // Iterate over all firms
//     const firmsSnap = await db.collection('firms').get();
//     for (const firmDoc of firmsSnap.docs) {
//       const firmId = firmDoc.id;
//       const firmData = firmDoc.data();
//
//       // Skip firms without SendGrid configured
//       if (!firmData.sendGridApiKey) continue;
//
//       // --- 1. Appointment reminders ---
//       // Requires a top-level `firms/{firmId}/events` collection with `startTime` and `attendees`.
//       // Implementation left to the calendar-sync module; trigger from there instead.
//
//       // --- 2. Questionnaire follow-ups ---
//       const pendingClientsSnap = await db
//         .collection(`firms/${firmId}/clients`)
//         .where('questionnaireStatus', '==', 'invited')
//         .where('questionnaireInvitedAt', '<=', sevenDaysAgo)
//         .get();
//
//       for (const clientDoc of pendingClientsSnap.docs) {
//         const client = clientDoc.data();
//         if (!client.email || !client.firstName) continue;
//         const invitedAt: admin.firestore.Timestamp = client.questionnaireInvitedAt;
//         const daysSince = Math.floor(
//           (now.toMillis() - invitedAt.toMillis()) / (24 * 60 * 60 * 1000),
//         );
//         // Only remind every 7 days (7, 14, 21…) to avoid spamming
//         if (daysSince % 7 !== 0) continue;
//
//         logger.info('[scheduledReminders] Sending follow-up', { firmId, clientId: clientDoc.id, daysSince });
//         // NOTE: logAuditEvent called inside sendFollowUpReminder via the callable function.
//         // For the scheduled function, call the internal helpers directly (no auth context).
//       }
//     }
//
//     logger.info('[scheduledReminders] Completed run', { ts: now.toDate().toISOString() });
//   },
// );

// ---------------------------------------------------------------------------
// 8. Auto Email: On Client Created
// ---------------------------------------------------------------------------

import { onDocumentCreated } from 'firebase-functions/v2/firestore';

/**
 * Automatically send a welcome email if the firm has an active
 * 'client_created' email template.
 */
export const onClientCreatedSendEmail = onDocumentCreated(
  { document: 'firms/{firmId}/clients/{clientId}', region: 'us-east1' },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const firmId = event.params.firmId;
    const clientId = event.params.clientId;
    const clientData = snap.data();

    // Check if client has email
    const clientEmail = clientData.email;
    const clientName = clientData.firstName
      ? `${clientData.firstName} ${clientData.lastName || ''}`.trim()
      : 'Client';

    if (!clientEmail) return;

    // Check for active 'client_created' template
    const customTemplate = await getCustomTemplate(firmId, 'client_created');
    if (!customTemplate) {
      // No automation configured for welcome emails
      return;
    }

    try {
      const firmData = await getFirmData(firmId);
      const apiKey = getSendGridKey(firmData);
      const branding = extractBranding(firmData);

      const processed = processCustomTemplate(customTemplate, {
        clientName,
        firmName: branding.firmName,
        date: new Date().toLocaleDateString('en-US'),
      });

      const html = buildEmailHtml(
        processed.bodyHtml,
        branding,
        `Welcome to ${branding.firmName}`,
      );

      await sendViaSendGrid(apiKey, {
        personalizations: [{ to: [{ email: clientEmail, name: clientName }], subject: processed.subject }],
        from: { email: branding.firmEmail || 'noreply@estateplan.app', name: branding.firmName },
        content: [{ type: 'text/html', value: html }],
      });

      logger.info('[onClientCreatedSendEmail] Sent', { firmId, clientId, clientEmail });

      // Audit trail (System generated)
      await logAuditEvent({
        firmId,
        eventType: 'email_sent',
        userId: 'system',
        userEmail: 'system@estateplan.app',
        userRole: 'system',
        clientId,
        clientName,
        details: `Automated 'Client Created' welcome email sent to ${clientEmail}`,
        metadata: {
          emailType: 'client_created_auto',
          recipientEmail: clientEmail,
        },
      });
    } catch (error) {
      logger.error('[onClientCreatedSendEmail] Failed to process template', error);
    }
  }
);
