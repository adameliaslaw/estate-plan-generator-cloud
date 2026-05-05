/**
 * functions/src/lawpay-integration.ts
 *
 * LawPay / AffiniPay payment integration for the NJ Estate Plan Generator.
 *
 * Two Cloud Functions:
 *
 * 1. createPaymentRequest (onCall v2)
 *    Creates a LawPay charge via the AffiniPay REST API and stores the
 *    resulting Payment record in Firestore.
 *
 * 2. lawpayWebhook (onRequest v2)
 *    Receives POST callbacks from LawPay when charge status changes
 *    (completed, failed, refunded) and keeps the Firestore Payment doc
 *    in sync.
 *
 * Firestore path:  firms/{firmId}/clients/{clientId}/payments/{paymentId}
 * Environment:     LAWPAY_API_KEY, LAWPAY_MERCHANT_ID
 *                  LAWPAY_WEBHOOK_SECRET (for signature verification)
 */

import { onRequest, HttpsError } from 'firebase-functions/v2/https';
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreatePaymentRequestData {
  firmId: string;
  clientId: string;
  /** Amount in **cents** (e.g. 150000 = $1,500.00) */
  amount: number;
  description: string;
  /** Whether to route funds to the operating or trust account */
  accountDesignation: 'operating' | 'trust';
  /** Payment method determines which LawPay account ID to use */
  paymentMethod: 'echeck' | 'card';
  clientEmail: string;
  clientName: string;
}

/** Shape of a successful AffiniPay charge response (relevant fields). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface AffiniPayChargeResponse {
  id: string;
  status: string;
  /** URL the client visits to complete payment */
  payment_page_url?: string;
  /** Amount in cents */
  amount: number;
  currency: string;
  description: string;
  reference: string;
}

/** Shape of a LawPay webhook event body. */
interface LawPayWebhookEvent {
  type: 'charge.completed' | 'charge.failed' | 'charge.refunded' | string;
  data: {
    id: string;             // AffiniPay transaction ID
    amount: number;         // in cents
    status: string;
    reference: string;      // We set this to `${firmId}-${clientId}-${paymentId}`
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read LawPay credentials from environment variables.
 * Throws a `failed-precondition` HttpsError if either value is absent.
 */
function getLawPayCredentials(): {
  apiKey: string;
  echeckAccountId: string;
  cardAccountId: string;
} {
  const apiKey = (process.env.LAWPAY_API_KEY || '').trim();
  const echeckAccountId = (process.env.LAWPAY_ECHECK_ACCOUNT_ID || '').trim();
  const cardAccountId = (process.env.LAWPAY_CARD_ACCOUNT_ID || '').trim();
  // Fallback to legacy single LAWPAY_MERCHANT_ID if new vars not set
  const legacyMerchantId = process.env.LAWPAY_MERCHANT_ID;

  if (!apiKey) {
    throw new HttpsError(
      'failed-precondition',
      'LawPay integration not configured. Set LAWPAY_API_KEY ' +
      'as a Cloud Function secret (see Settings → Integrations).',
    );
  }

  const finalEcheck = echeckAccountId || legacyMerchantId || '';
  const finalCard = cardAccountId || legacyMerchantId || '';

  if (!finalEcheck && !finalCard) {
    throw new HttpsError(
      'failed-precondition',
      'LawPay account IDs not configured. Set LAWPAY_ECHECK_ACCOUNT_ID and/or ' +
      'LAWPAY_CARD_ACCOUNT_ID as Cloud Function secrets.',
    );
  }

  return { apiKey, echeckAccountId: finalEcheck, cardAccountId: finalCard };
}

/**
 * Verify the HMAC-SHA256 signature on incoming LawPay webhooks.
 *
 * IMPORTANT: Before going live with real payments, replace this
 * placeholder with the actual HMAC-SHA256 verification using your
 * LawPay webhook signing secret.
 *
 * Implementation steps:
 *   1. Set the signing secret: firebase functions:secrets:set LAWPAY_WEBHOOK_SECRET
 *   2. Compute HMAC-SHA256 of the raw request body using the secret
 *   3. Compare with the X-AffiniPay-Signature header (timing-safe comparison)
 *
 * Example:
 *   import { createHmac, timingSafeEqual } from 'crypto';
 *   const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
 *   const actual = req.headers['x-affinipay-signature'] as string;
 *   return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
 */
function verifyWebhookSignature(
  req: { headers: Record<string, string | string[] | undefined> },
  rawBody: string,
): boolean {
  const webhookSecret = process.env.LAWPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    // Only allow bypass in the Firebase emulator — reject in production
    if (process.env.FUNCTIONS_EMULATOR === 'true') {
      console.warn(
        '[lawpayWebhook] LAWPAY_WEBHOOK_SECRET not set — skipping signature verification (emulator only).',
      );
      return true;
    }
    console.error(
      '[lawpayWebhook] LAWPAY_WEBHOOK_SECRET not set — rejecting request. ' +
      'Set this secret before deploying to production.',
    );
    return false;
  }

  const signature = req.headers['x-affinipay-signature'] as string | undefined;
  if (!signature) {
    console.error('[lawpayWebhook] Missing X-AffiniPay-Signature header');
    return false;
  }

  // crypto is imported at the top of the file
  try {
    const expected = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    // Use timingSafeEqual to prevent timing attacks
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );

    if (!isValid) {
      console.error('[lawpayWebhook] Signature mismatch');
      return false;
    }

    return true;
  } catch (error) {
    console.error('[lawpayWebhook] Error verifying signature:', error);
    return false;
  }
}

/**
 * Build the Firestore reference for a Payment document.
 * Document ID is the AffiniPay transaction ID for easy lookup from webhooks.
 */
function paymentRef(
  db: admin.firestore.Firestore,
  firmId: string,
  clientId: string,
  transactionId: string,
): admin.firestore.DocumentReference {
  return db
    .collection('firms')
    .doc(firmId)
    .collection('clients')
    .doc(clientId)
    .collection('payments')
    .doc(transactionId);
}

// ---------------------------------------------------------------------------
// Function 1 — createPaymentRequest (onCall)
// ---------------------------------------------------------------------------

/**
 * createPaymentRequest
 *
 * Creates a pre-filled LawPay payment page URL and stores the resulting
 * Payment doc in Firestore. Returns the payment URL so the frontend can
 * copy it or open it in a new tab.
 *
 * The LawPay Payment Page URL supports query parameters:
 *   ?amount=15000&description=Estate%20Plan&readOnlyFields=amount,description
 *
 * Input:  { firmId, clientId, amount, description, accountDesignation,
 *           paymentMethod, clientEmail, clientName }
 * Output: { paymentUrl, paymentDocId }
 */

// LawPay Payment Page base URL (configured in LawPay dashboard → Payment Pages)
const LAWPAY_PAYMENT_PAGE_URL = 'https://secure.lawpay.com/pages/bolsterbrudereliasllc/operating';

export const createPaymentRequest = functions
  .region('us-east1')
  .runWith({
    timeoutSeconds: 30,
    memory: '256MB',
  })
  .https.onCall(async (data: CreatePaymentRequestData, context) => {
    // ------------------------------------------------------------------
    // 1. Auth check
    // ------------------------------------------------------------------
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to create payment requests.');
    }

    const {
      firmId,
      clientId,
      amount,
      description,
      accountDesignation,
      clientEmail,
      clientName,
    } = data;

    // ------------------------------------------------------------------
    // 2. Validate input and permissions
    // ------------------------------------------------------------------
    if (!firmId || !clientId) {
      throw new functions.https.HttpsError('invalid-argument', 'firmId and clientId are required.');
    }
    
    // Check firm access
    if (!context.auth.token.firmId || context.auth.token.firmId !== firmId) {
      throw new functions.https.HttpsError('permission-denied', 'You do not have access to this firm.');
    }

    // Check billing capability
    const role = context.auth.token.role;
    const capabilities = context.auth.token.capabilities || [];
    const canManageBilling = role === 'admin' || role === 'attorney' || role === 'paralegal' || capabilities.includes('manage_billing');

    if (!canManageBilling) {
      throw new functions.https.HttpsError('permission-denied', 'You do not have permission to manage billing.');
    }

    if (!amount || amount <= 0) {
      throw new functions.https.HttpsError('invalid-argument', 'amount must be a positive integer (in cents).');
    }
    if (!description?.trim()) {
      throw new functions.https.HttpsError('invalid-argument', 'description is required.');
    }


    console.log(
      `[createPaymentRequest] firmId=${firmId} clientId=${clientId} ` +
      `amount=${amount} designation=${accountDesignation}`,
    );

    // ------------------------------------------------------------------
    // 3. Construct pre-filled LawPay Payment Page URL
    //    Docs: https://developers.8am.com (Payment Pages → URL Parameters)
    // ------------------------------------------------------------------
    const params = new URLSearchParams({
      amount: amount.toString(),
      description: description.trim(),
      reference: `${firmId}::${clientId}`,
      readOnlyFields: 'amount,description',
    });

    // Add optional email if provided
    if (clientEmail) {
      params.set('email', clientEmail);
    }

    const paymentUrl = `${LAWPAY_PAYMENT_PAGE_URL}?${params.toString()}`;

    console.log(`[createPaymentRequest] Generated payment URL: ${paymentUrl}`);

    // ------------------------------------------------------------------
    // 4. Persist Payment document in Firestore
    // ------------------------------------------------------------------
    const db = admin.firestore();
    const paymentDocRef = db
      .collection('firms')
      .doc(firmId)
      .collection('clients')
      .doc(clientId)
      .collection('payments')
      .doc(); // auto-generated ID

    const now = admin.firestore.FieldValue.serverTimestamp();

    await paymentDocRef.set({
      id: paymentDocRef.id,
      firmId,
      clientId,
      // LawPay fields
      lawPayPaymentUrl: paymentUrl,
      lawPayReference: `${firmId}-${clientId}`,
      // Financial details
      amount,                  // in cents
      amountFormatted: (amount / 100).toFixed(2),
      currency: 'USD',
      description: description.trim(),
      accountDesignation,
      // Client info
      clientEmail: clientEmail || '',
      clientName: clientName || '',
      // Status
      status: 'pending',
      amountPaid: 0,
      balanceDue: amount,
      paidAt: null,
      // Metadata
      createdAt: now,
      createdBy: context.auth.uid,
      updatedAt: now,
      updatedBy: context.auth.uid,
    });

    console.log(`[createPaymentRequest] Saved Payment doc — id=${paymentDocRef.id}`);

    // ------------------------------------------------------------------
    // 5. Send payment request email to client via SendGrid
    //    (non-blocking — if email fails, payment record still created)
    // ------------------------------------------------------------------
    if (clientEmail) {
      try {
        const firmDoc = await db.doc(`firms/${firmId}`).get();
        const firmData = firmDoc.exists ? firmDoc.data()! : null;
        const sendGridKey = (firmData?.sendGridApiKey as string || '').trim();

        if (sendGridKey && firmData) {
          const firmName = (firmData.firmName as string) || 'Your Estate Planning Firm';
          const firmEmail = (firmData.firmEmail as string) || 'noreply@estateplan.app';
          const firmPhone = (firmData.firmPhone as string) || '';
          const logoUrl = (firmData.logoUrl as string) || '';
          const primaryColor = (firmData.primaryColor as string) || '#1a365d';
          const formattedAmount = new Intl.NumberFormat('en-US', {
            style: 'currency', currency: 'USD',
          }).format(amount / 100);

          const contactLine = [firmPhone, firmEmail].filter(Boolean).join(' &nbsp;|&nbsp; ');
          const logoBlock = logoUrl
            ? `<img src="${logoUrl}" alt="${firmName}" style="max-height:60px;max-width:200px;display:block;margin:0 auto 12px;" />`
            : `<div style="font-size:22px;font-weight:700;color:${primaryColor};text-align:center;">${firmName}</div>`;

          const bodyHtml = `
<h2 style="margin:0 0 16px;font-size:22px;color:#1a202c;">Payment Request</h2>
<p style="margin:0 0 12px;">
  Dear ${clientName || 'Valued Client'}, a payment of <strong>${formattedAmount}</strong>
  is requested for the following:
</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;width:100%;">
  <tr>
    <td style="padding:12px 20px;background:#f0f4f8;border-radius:6px;border-left:4px solid ${primaryColor};">
      <strong>Description:</strong> ${description.trim()}<br />
      <strong>Amount Due:</strong> <span style="font-size:18px;font-weight:700;color:#1a202c;">${formattedAmount}</span>
    </td>
  </tr>
</table>
<p style="margin:0 0 24px;">
  Please click the button below to complete your secure payment:
</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto;">
  <tr>
    <td align="center" style="border-radius:6px;background-color:${primaryColor};">
      <a href="${paymentUrl}" target="_blank"
         style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;
                color:#ffffff;text-decoration:none;border-radius:6px;
                background-color:${primaryColor};mso-padding-alt:14px 32px;"
      >Pay Now — ${formattedAmount}</a>
    </td>
  </tr>
</table>
<p style="margin:24px 0 0;font-size:13px;color:#718096;">
  If the button does not work, copy and paste this link into your browser:<br />
  <a href="${paymentUrl}" style="color:${primaryColor};word-break:break-all;">${paymentUrl}</a>
</p>
<p style="margin:16px 0 0;font-size:13px;color:#718096;">
  If you have any questions about this payment, please contact us at
  ${firmEmail || firmPhone || 'our office'}.
</p>`;

          const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /><title>${firmName}</title></head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Payment of ${formattedAmount} requested&nbsp;&zwnj;&hairsp;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0"
             style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.08);overflow:hidden;">
        <tr><td style="background-color:${primaryColor};padding:24px 32px;text-align:center;">${logoBlock}</td></tr>
        <tr><td style="padding:32px 40px 24px;color:#1a202c;font-size:15px;line-height:1.6;">${bodyHtml}</td></tr>
        <tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #e2e8f0;margin:0;" /></td></tr>
        <tr><td style="padding:20px 40px 28px;color:#718096;font-size:12px;line-height:1.5;">
          ${contactLine ? `<p style="margin:0 0 8px;">${firmName} &nbsp;|&nbsp; ${contactLine}</p>` : `<p style="margin:0 0 8px;">${firmName}</p>`}
          <p style="margin:0;font-size:11px;color:#a0aec0;">
            <strong>CONFIDENTIALITY NOTICE:</strong> This email and any attachments are for the
            exclusive and confidential use of the intended recipient.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

          const subject = `Payment Request — ${formattedAmount} — ${firmName}`;

          const sgResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${sendGridKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              personalizations: [{ to: [{ email: clientEmail, name: clientName || '' }], subject }],
              from: { email: firmEmail, name: firmName },
              content: [{ type: 'text/html', value: html }],
            }),
          });

          if (sgResponse.ok) {
            console.log(`[createPaymentRequest] Email sent to ${clientEmail}`);
          } else {
            const errBody = await sgResponse.text().catch(() => '');
            console.warn(`[createPaymentRequest] SendGrid error ${sgResponse.status}: ${errBody.slice(0, 300)}`);
          }
        } else {
          console.log('[createPaymentRequest] SendGrid not configured, skipping email');
        }
      } catch (emailErr) {
        // Non-fatal — payment record was already created
        console.warn('[createPaymentRequest] Email sending failed (non-fatal):', emailErr);
      }
    }

    return {
      paymentUrl,
      paymentDocId: paymentDocRef.id,
    };
  },
  );

// ---------------------------------------------------------------------------
// Function 2 — lawpayWebhook (onRequest)
// ---------------------------------------------------------------------------

/**
 * lawpayWebhook
 *
 * Receives POST callbacks from LawPay (AffiniPay) when charge status changes.
 * Updates the corresponding Firestore Payment document to reflect the new status.
 *
 * Supported event types:
 *   - charge.completed  → status: 'paid'
 *   - charge.failed     → status: 'pending'  (allow retry)
 *   - charge.refunded   → status: 'refunded'
 *
 * LawPay signs each request with HMAC-SHA256 via X-AffiniPay-Signature.
 * Always return HTTP 200 so LawPay stops retrying — log errors internally.
 */
export const lawpayWebhook = onRequest(
  {
    region: 'us-east1',
    timeoutSeconds: 60,
    memory: '256MiB',
    // CORS: allow requests from LawPay / AffiniPay domains
    cors: [
      'https://secure.lawpay.com',
      'https://api.affinipay.com',
      'https://affinipay.com',
    ],
  },
  async (req, res) => {
    // LawPay sends POST; reject other methods
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    // ------------------------------------------------------------------
    // 1. Verify webhook signature
    // ------------------------------------------------------------------
    const rawBody =
      typeof req.rawBody === 'object'
        ? (req.rawBody as Buffer).toString('utf8')
        : JSON.stringify(req.body);

    if (!verifyWebhookSignature(req, rawBody)) {
      console.error('[lawpayWebhook] Signature verification failed — rejecting request');
      res.status(401).send('Unauthorized');
      return;
    }

    // ------------------------------------------------------------------
    // 2. Parse event body
    // ------------------------------------------------------------------
    let event: LawPayWebhookEvent;
    try {
      event = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as LawPayWebhookEvent;
    } catch (parseError) {
      console.error('[lawpayWebhook] Failed to parse request body:', parseError);
      // Return 200 so LawPay doesn't retry a malformed payload
      res.status(200).send('OK');
      return;
    }

    const { type, data } = event;
    const transactionId = data?.id;

    console.log(`[lawpayWebhook] Received event type=${type} transactionId=${transactionId}`);

    if (!transactionId) {
      console.error('[lawpayWebhook] Missing data.id in webhook payload');
      res.status(200).send('OK');
      return;
    }

    // ------------------------------------------------------------------
    // 3. Resolve the Firestore Payment doc from the `reference` field
    //    reference format: "{firmId}-{clientId}-{paymentDocId}"
    //    We stored the transactionId as the doc ID, so we do a collectionGroup query.
    // ------------------------------------------------------------------
    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();

    try {
      // Prefer a direct lookup if reference is available (fast path)
      const reference: string = (data.reference as string) ?? '';
      const refParts = reference.split('::');

      let paymentDocRef: admin.firestore.DocumentReference | null = null;

      if (refParts.length >= 2) {
        // reference = "firmId::clientId"
        const firmId = refParts[0];
        const clientId = refParts[1];
        paymentDocRef = paymentRef(db, firmId, clientId, transactionId);
      }

      // Fallback: collectionGroup query across all firms (slower but safe)
      if (!paymentDocRef) {
        const snapshot = await db
          .collectionGroup('payments')
          .where('lawPayTransactionId', '==', transactionId)
          .limit(1)
          .get();

        if (snapshot.empty) {
          console.warn(
            `[lawpayWebhook] No Payment doc found for transactionId=${transactionId}`,
          );
          res.status(200).send('OK');
          return;
        }
        paymentDocRef = snapshot.docs[0].ref;
      }

      // ------------------------------------------------------------------
      // 4. Apply state transition inside a transaction (idempotency guard).
      //    Only advance to the new state if the current state allows it, so
      //    duplicate or out-of-order delivery cannot corrupt the record.
      // ------------------------------------------------------------------
      const VALID_TRANSITIONS: Record<string, string[]> = {
        'charge.completed': ['pending', 'failed'],   // pending/failed → paid
        'charge.failed':    ['pending'],              // pending → failed (stays pending for retry)
        'charge.refunded':  ['paid'],                 // paid → refunded
      };

      const allowed = VALID_TRANSITIONS[type];
      if (!allowed) {
        // Unknown event type — log and acknowledge without mutating Firestore
        console.log(`[lawpayWebhook] Unhandled event type="${type}" — ignoring`);
        res.status(200).send('OK');
        return;
      }

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(paymentDocRef!);
        if (!snap.exists) {
          console.warn(`[lawpayWebhook] Payment doc disappeared mid-transaction transactionId=${transactionId}`);
          return;
        }
        const currentStatus = (snap.data() as Record<string, unknown>).status as string | undefined;
        if (!allowed.includes(currentStatus ?? 'pending')) {
          console.log(
            `[lawpayWebhook] Skipping ${type} — current status "${currentStatus}" not in allowed set [${allowed.join(', ')}]`,
          );
          return;
        }

        let updatePayload: Record<string, unknown> = {
          updatedAt: now,
          lastWebhookEventType: type,
          lastWebhookReceivedAt: now,
        };

        switch (type) {
          case 'charge.completed':
            updatePayload = { ...updatePayload, status: 'paid', amountPaid: data.amount, balanceDue: 0, paidAt: now };
            console.log(`[lawpayWebhook] Marking payment PAID — transactionId=${transactionId}`);
            break;
          case 'charge.failed':
            updatePayload = { ...updatePayload, status: 'pending', lastFailureReason: (data.failure_reason as string) ?? 'Charge failed' };
            console.log(`[lawpayWebhook] Charge FAILED — transactionId=${transactionId} (status stays pending)`);
            break;
          case 'charge.refunded':
            updatePayload = { ...updatePayload, status: 'refunded', refundedAt: now, refundedAmount: data.amount };
            console.log(`[lawpayWebhook] Charge REFUNDED — transactionId=${transactionId}`);
            break;
        }

        tx.update(paymentDocRef!, updatePayload);
      });

      console.log(`[lawpayWebhook] Payment doc updated — transactionId=${transactionId} type=${type}`);
    } catch (error) {
      // Log the error but return 200 so LawPay doesn't retry indefinitely.
      // We rely on Cloud Logging alerts to catch persistent failures.
      console.error('[lawpayWebhook] Error processing webhook:', error);
    }

    res.status(200).send('OK');
  },
);

// ---------------------------------------------------------------------------
// Function 3 — processDirectCharge (onCall)
// ---------------------------------------------------------------------------

/**
 * processDirectCharge
 *
 * Processes a direct payment charge using a one-time payment token obtained
 * from AffiniPay Hosted Fields on the frontend. The token is passed to
 * POST /v1/charges on the AffiniPay Payment Gateway API.
 *
 * Input:  { firmId, clientId, amount, description, paymentToken,
 *           paymentType, clientEmail, clientName }
 * Output: { success, chargeId?, status?, errorMessage? }
 */

interface ProcessDirectChargeData {
  firmId: string;
  clientId: string;
  /** Amount in **cents** (e.g. 150000 = $1,500.00) */
  amount: number;
  description: string;
  /** One-time token ID from AffiniPay Hosted Fields */
  paymentToken: string;
  /** 'card' or 'echeck' — determines which LawPay account ID to use */
  paymentType: 'card' | 'echeck';
  clientEmail?: string;
  clientName?: string;
}

export const processDirectCharge = functions
  .region('us-east1')
  .runWith({
    timeoutSeconds: 60,
    memory: '256MB',
    secrets: ['LAWPAY_API_KEY', 'LAWPAY_ECHECK_ACCOUNT_ID', 'LAWPAY_CARD_ACCOUNT_ID'],
  })
  .https.onCall(async (data: ProcessDirectChargeData, context) => {
    // ------------------------------------------------------------------
    // 1. Auth check
    // ------------------------------------------------------------------
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'You must be logged in to process payments.',
      );
    }

    const {
      firmId,
      clientId,
      amount,
      description,
      paymentToken,
      paymentType,
      clientEmail,
      clientName,
    } = data;

    // ------------------------------------------------------------------
    // 2. Validate input and permissions
    // ------------------------------------------------------------------
    if (!firmId || !clientId) {
      throw new functions.https.HttpsError('invalid-argument', 'firmId and clientId are required.');
    }

    // Check firm access
    if (!context.auth.token.firmId || context.auth.token.firmId !== firmId) {
      throw new functions.https.HttpsError('permission-denied', 'You do not have access to this firm.');
    }

    // Check billing capability
    const role = context.auth.token.role as string | undefined;
    const capabilities = (context.auth.token.capabilities || []) as string[];
    const canManageBilling =
      role === 'admin' || role === 'attorney' || role === 'paralegal' || capabilities.includes('manage_billing');

    if (!canManageBilling) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'You do not have permission to manage billing.',
      );
    }

    if (!amount || amount <= 0) {
      throw new functions.https.HttpsError('invalid-argument', 'amount must be a positive integer (in cents).');
    }
    if (!description?.trim()) {
      throw new functions.https.HttpsError('invalid-argument', 'description is required.');
    }
    if (!paymentToken?.trim()) {
      throw new functions.https.HttpsError('invalid-argument', 'paymentToken is required.');
    }
    if (!paymentType || !['card', 'echeck'].includes(paymentType)) {
      throw new functions.https.HttpsError('invalid-argument', 'paymentType must be "card" or "echeck".');
    }

    console.log(
      `[processDirectCharge] firmId=${firmId} clientId=${clientId} ` +
      `amount=${amount} paymentType=${paymentType}`,
    );

    // ------------------------------------------------------------------
    // 3. Get LawPay credentials
    // ------------------------------------------------------------------
    const { apiKey, echeckAccountId, cardAccountId } = getLawPayCredentials();
    const accountId = paymentType === 'echeck' ? echeckAccountId : cardAccountId;

    if (!accountId) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `LawPay ${paymentType} account ID is not configured. ` +
        `Set LAWPAY_${paymentType === 'echeck' ? 'ECHECK' : 'CARD'}_ACCOUNT_ID as a Cloud Function secret.`,
      );
    }

    // ------------------------------------------------------------------
    // 4. Create the charge via AffiniPay Payment Gateway API
    // ------------------------------------------------------------------
    const db = admin.firestore();
    const paymentDocRef = db
      .collection('firms')
      .doc(firmId)
      .collection('clients')
      .doc(clientId)
      .collection('payments')
      .doc(); // auto-generated ID

    const reference = `${firmId}::${clientId}::${paymentDocRef.id}`;
    const now = admin.firestore.FieldValue.serverTimestamp();

    // Pull client address for AVS — LawPay rejects card charges without postal_code.
    const clientSnap = await db.doc(`firms/${firmId}/clients/${clientId}`).get();
    const pi = ((clientSnap.data() || {}).personalInfo || {}) as {
      zip?: string; address?: string; city?: string; state?: string;
    };
    const postalCode = (pi.zip || '').trim();
    if (!postalCode) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Client has no zip code on file. Open their questionnaire → About You → Address and save before charging.',
      );
    }

    try {
      const chargeBody: Record<string, unknown> = {
        amount,
        method: paymentToken.trim(),
        account_id: accountId,
        reference,
        description: description.trim(),
        auto_capture: true,
        postal_code: postalCode,
      };
      if (pi.address) chargeBody.address1 = pi.address.trim();
      if (pi.city)    chargeBody.city = pi.city.trim();
      if (pi.state)   chargeBody.state = pi.state.trim();

      console.log(`[processDirectCharge] Calling POST /v1/charges — account_id=${accountId}`);

      const authHeader = 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');

      const response = await fetch('https://api.8am.com/v1/charges', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
        },
        body: JSON.stringify(chargeBody),
      });

      const responseData = await response.json() as Record<string, unknown>;

      if (!response.ok) {
        // Charge was rejected by the gateway
        const errorMsg =
          (responseData.messages as Array<{ message: string }> | undefined)?.[0]?.message ??
          (responseData.message as string | undefined) ??
          `Charge failed with status ${response.status}`;

        console.error(
          `[processDirectCharge] Charge REJECTED — status=${response.status} error="${errorMsg}"`,
        );

        // Save as failed payment record so the user can see the attempt
        await paymentDocRef.set({
          id: paymentDocRef.id,
          firmId,
          clientId,
          amount,
          amountPaid: 0,
          balanceDue: amount,
          description: description.trim(),
          paymentMethod: paymentType === 'card' ? 'Credit Card' : 'ACH / Bank Transfer',
          accountDesignation: 'operating',
          status: 'failed',
          lastFailureReason: errorMsg,
          clientEmail: clientEmail || '',
          clientName: clientName || '',
          createdAt: now,
          createdBy: context.auth.uid,
          updatedAt: now,
          updatedBy: context.auth.uid,
        });

        return {
          success: false,
          errorMessage: errorMsg,
          paymentDocId: paymentDocRef.id,
        };
      }

      // Charge succeeded (status is typically AUTHORIZED, auto-captured daily)
      const chargeId = responseData.id as string;
      const chargeStatus = responseData.status as string;
      const authorizationCode = responseData.authorization_code as string | undefined;

      console.log(
        `[processDirectCharge] Charge SUCCESS — chargeId=${chargeId} status=${chargeStatus}`,
      );

      // Save the payment record — mark as paid since the charge was authorized
      await paymentDocRef.set({
        id: paymentDocRef.id,
        firmId,
        clientId,
        amount,
        amountPaid: amount,
        balanceDue: 0,
        description: description.trim(),
        paymentMethod: paymentType === 'card' ? 'Credit Card' : 'ACH / Bank Transfer',
        accountDesignation: 'operating',
        status: 'paid',
        paidAt: now,
        lawPayChargeId: chargeId,
        lawPayTransactionId: chargeId,
        authorizationCode: authorizationCode || '',
        clientEmail: clientEmail || '',
        clientName: clientName || '',
        createdAt: now,
        createdBy: context.auth.uid,
        updatedAt: now,
        updatedBy: context.auth.uid,
      });

      return {
        success: true,
        chargeId,
        status: chargeStatus,
        paymentDocId: paymentDocRef.id,
      };
    } catch (error: unknown) {
      console.error('[processDirectCharge] Unexpected error:', error);

      // Save a failed record so the attempt is visible
      try {
        await paymentDocRef.set({
          id: paymentDocRef.id,
          firmId,
          clientId,
          amount,
          amountPaid: 0,
          balanceDue: amount,
          description: description.trim(),
          paymentMethod: paymentType === 'card' ? 'Credit Card' : 'ACH / Bank Transfer',
          accountDesignation: 'operating',
          status: 'failed',
          lastFailureReason: error instanceof Error ? error.message : 'Unexpected error processing charge',
          clientEmail: clientEmail || '',
          clientName: clientName || '',
          createdAt: now,
          createdBy: context.auth.uid,
          updatedAt: now,
          updatedBy: context.auth.uid,
        });
      } catch (saveError) {
        console.error('[processDirectCharge] Failed to save error record:', saveError);
      }

      throw new functions.https.HttpsError(
        'internal',
        error instanceof Error ? error.message : 'Failed to process payment.',
      );
    }
  });
