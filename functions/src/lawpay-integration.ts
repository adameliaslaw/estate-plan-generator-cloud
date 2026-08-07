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
 *                  LAWPAY_WEBHOOK_TOKEN (the token in the registered Event URL — 8am does not
 *                  sign webhooks, so the token plus a gateway re-read establish authenticity)
 */

import { onRequest, HttpsError } from 'firebase-functions/v2/https';
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { loadFirmSecrets } from './firm-secrets';
import { escapeHtml } from './email-notifications';
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
    reference: string;      // We set this to `${firmId}::${clientId}::${paymentDocId}`
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
 * Verify that the caller knows the token embedded in the Event URL we registered with 8am.
 *
 * 8am does NOT sign webhooks. Their API reference documents webhook delivery — an Event URL set
 * on the partner OAuth application, retried every 10 minutes up to 25 times until you answer 200
 * — and specifies no signing secret, HMAC, signature header or IP allowlist. This matches what
 * the LawPay dashboard does in practice: creating a webhook issues no secret. The previous
 * implementation here verified an HMAC-SHA256 over `X-AffiniPay-Signature` against a
 * LAWPAY_WEBHOOK_SECRET; that header is not sent, so it rejected every request with 401, and the
 * secret it required never existed — which failed every functions deploy from 2026-07-18.
 *
 * So authenticity is established two ways instead, neither of which depends on 8am signing:
 *   1. this token, which only we and 8am's configuration know; and
 *   2. `fetchVerifiedCharge`, which re-reads the transaction from the API and trusts THAT rather
 *      than the request body.
 *
 * The token is read from `?token=` or any path segment, because which of those a Cloud Run v2
 * request exposes depends on the URL form the Event URL uses. Both are compared against a
 * SHA-256 digest so `timingSafeEqual` never sees mismatched lengths (it throws on those, and the
 * throw itself would leak length).
 */
function verifyWebhookToken(req: {
  path?: string;
  query?: Record<string, unknown>;
}): boolean {
  const expected = (process.env.LAWPAY_WEBHOOK_TOKEN || '').trim();
  if (!expected) {
    // Fail closed. An unset token must never mean "let everyone in".
    console.error(
      '[lawpayWebhook] LAWPAY_WEBHOOK_TOKEN not set — rejecting. Register the Event URL with ' +
      'its token before expecting webhooks to be accepted.',
    );
    return false;
  }

  const fromQuery = typeof req.query?.['token'] === 'string' ? (req.query['token'] as string) : '';
  const fromPath = (req.path ?? '').split('/').filter(Boolean);
  const candidates = [fromQuery, ...fromPath].filter(Boolean);

  const expectedDigest = crypto.createHash('sha256').update(expected).digest();
  for (const candidate of candidates) {
    const digest = crypto.createHash('sha256').update(candidate).digest();
    if (crypto.timingSafeEqual(digest, expectedDigest)) return true;
  }

  console.error('[lawpayWebhook] No valid token on the request — rejecting');
  return false;
}

/** A charge as re-read from the gateway. Only these fields are trusted downstream. */
interface VerifiedCharge {
  id: string;
  status: string;
  /** Cents, per the gateway's own unit. */
  amount: number;
  reference: string;
  failureReason?: string;
}

type ChargeLookup =
  | { outcome: 'verified'; charge: VerifiedCharge }
  | { outcome: 'not-found' }
  /** Network or 5xx — the caller should answer non-200 so 8am redelivers. */
  | { outcome: 'unavailable'; detail: string };

/**
 * Re-read a charge from the gateway so the webhook body is never the source of truth.
 *
 * Because 8am does not sign its callbacks, anyone who learns the Event URL could post a
 * plausible "charge.completed". Taking only the transaction id from the body and asking the API
 * what actually happened makes that harmless: a forged payload can cause a lookup and nothing
 * else. Every figure written to Firestore — amount, status, and the reference that identifies
 * which Payment doc to touch — comes from this response.
 *
 * GET on the same `/v1/charges` resource `processDirectCharge` already POSTs to, with the same
 * Basic auth. An unexpected response shape resolves to `not-found`, which is inert.
 */
async function fetchVerifiedCharge(transactionId: string): Promise<ChargeLookup> {
  const apiKey = (process.env.LAWPAY_API_KEY || '').trim();
  if (!apiKey) return { outcome: 'unavailable', detail: 'LAWPAY_API_KEY not set' };

  const authHeader = 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');
  let response: Response;
  try {
    response = await fetch(`https://api.8am.com/v1/charges/${encodeURIComponent(transactionId)}`, {
      method: 'GET',
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });
  } catch (err) {
    return { outcome: 'unavailable', detail: err instanceof Error ? err.message : String(err) };
  }

  if (response.status === 404) return { outcome: 'not-found' };
  if (response.status >= 500) return { outcome: 'unavailable', detail: `gateway ${response.status}` };
  if (!response.ok) {
    // 401/403 means OUR credentials are wrong — worth redelivery once it is fixed.
    return { outcome: 'unavailable', detail: `gateway ${response.status}` };
  }

  let body: Record<string, unknown>;
  try {
    body = await response.json() as Record<string, unknown>;
  } catch {
    return { outcome: 'not-found' };
  }

  const id = typeof body['id'] === 'string' ? body['id'] : '';
  const status = typeof body['status'] === 'string' ? body['status'] : '';
  if (!id || !status) return { outcome: 'not-found' };

  return {
    outcome: 'verified',
    charge: {
      id,
      status,
      amount: typeof body['amount'] === 'number' ? body['amount'] : 0,
      reference: typeof body['reference'] === 'string' ? body['reference'] : '',
      ...(typeof body['failure_reason'] === 'string' ? { failureReason: body['failure_reason'] } : {}),
    },
  };
}

/**
 * Gateway statuses that mean the money is good.
 *
 * `processDirectCharge` observes AUTHORIZED on a successful card charge ("auto-captured daily"),
 * and the settled/captured wording varies by method. The set is matched case-insensitively and
 * is deliberately a WHITELIST: an unrecognised status never marks a payment paid, and gets
 * logged verbatim so the first real delivery teaches us the vocabulary instead of being
 * silently mis-read as success.
 */
const PAID_STATUSES = new Set(['authorized', 'completed', 'captured', 'settled', 'paid', 'succeeded']);

/**
 * Build the Firestore reference for a Payment document.
 * The doc id is the Firestore-generated payment id (created in
 * createPaymentRequest); webhooks resolve it from the `reference` they echo
 * back ("firmId::clientId::paymentDocId"), not from the AffiniPay transaction id.
 */
function paymentRef(
  db: admin.firestore.Firestore,
  firmId: string,
  clientId: string,
  paymentDocId: string,
): admin.firestore.DocumentReference {
  return db
    .collection('firms')
    .doc(firmId)
    .collection('clients')
    .doc(clientId)
    .collection('payments')
    .doc(paymentDocId);
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

// Default LawPay Payment Page base URL (configured in LawPay dashboard →
// Payment Pages). Per-firm override: `lawpayPaymentPageUrl` on the
// firms/{firmId} document (top level or under .settings).
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
    // Create the Payment doc ref up-front so its id can be embedded in the
    // LawPay `reference`. The webhook parses that reference to locate THIS exact
    // doc and mark it paid; without the doc id it could not reconcile, so
    // payment-page payments stayed "pending" forever (finding BN). `.doc()` only
    // generates an id here — the write happens below.
    const db = admin.firestore();
    const paymentDocRef = db
      .collection('firms')
      .doc(firmId)
      .collection('clients')
      .doc(clientId)
      .collection('payments')
      .doc(); // auto-generated ID

    // reference = "{firmId}::{clientId}::{paymentDocId}" — round-trips through
    // LawPay and comes back on the webhook as data.reference.
    const paymentReference = `${firmId}::${clientId}::${paymentDocRef.id}`;

    const params = new URLSearchParams({
      amount: amount.toString(),
      description: description.trim(),
      reference: paymentReference,
      readOnlyFields: 'amount,description',
    });

    // Add optional email if provided
    if (clientEmail) {
      params.set('email', clientEmail);
    }

    // Per-firm payment page (falls back to the default page if not configured).
    const firmSnapForUrl = await admin.firestore().doc(`firms/${firmId}`).get();
    const firmForUrl = firmSnapForUrl.exists ? firmSnapForUrl.data()! : {};
    const pageUrl =
      (firmForUrl.lawpayPaymentPageUrl as string | undefined)?.trim() ||
      (firmForUrl.settings?.lawpayPaymentPageUrl as string | undefined)?.trim() ||
      LAWPAY_PAYMENT_PAGE_URL;

    const paymentUrl = `${pageUrl}?${params.toString()}`;

    console.log(`[createPaymentRequest] Generated payment URL: ${paymentUrl}`);

    // ------------------------------------------------------------------
    // 4. Persist Payment document in Firestore
    // ------------------------------------------------------------------
    const now = admin.firestore.FieldValue.serverTimestamp();

    await paymentDocRef.set({
      id: paymentDocRef.id,
      firmId,
      clientId,
      // LawPay fields
      lawPayPaymentUrl: paymentUrl,
      lawPayReference: paymentReference,
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
        const firmData = firmDoc.exists
          ? { ...firmDoc.data()!, ...(await loadFirmSecrets(firmId)) }
          : null;
        const sendGridKey = (firmData?.sendGridApiKey as string || '').trim();

        if (sendGridKey && firmData) {
          const firmName = (firmData.firmName as string) || 'Your Estate Planning Firm';
          const firmEmail = (firmData.firmEmail as string) || 'noreply@estateplan.app';
          const firmPhone = (firmData.firmPhone as string) || '';
          const rawLogoUrl = (firmData.logoUrl as string) || '';
          // Used only inside email HTML below, so escaped/gated at creation
          // (issue #166 — this email predates the BJ/T9 escaping pass).
          // firmName/firmEmail also feed SendGrid's from/subject fields, so
          // those are escaped per interpolation site instead.
          const primaryColor = escapeHtml((firmData.primaryColor as string) || '#1a365d');
          const logoUrl = /^https?:\/\//i.test(rawLogoUrl) ? escapeHtml(rawLogoUrl) : '';
          const formattedAmount = new Intl.NumberFormat('en-US', {
            style: 'currency', currency: 'USD',
          }).format(amount / 100);

          const contactLine = [firmPhone, firmEmail].filter(Boolean).map(escapeHtml).join(' &nbsp;|&nbsp; ');
          const logoBlock = logoUrl
            ? `<img src="${logoUrl}" alt="${escapeHtml(firmName)}" style="max-height:60px;max-width:200px;display:block;margin:0 auto 12px;" />`
            : `<div style="font-size:22px;font-weight:700;color:${primaryColor};text-align:center;">${escapeHtml(firmName)}</div>`;

          const bodyHtml = `
<h2 style="margin:0 0 16px;font-size:22px;color:#1a202c;">Payment Request</h2>
<p style="margin:0 0 12px;">
  Dear ${escapeHtml(clientName || 'Valued Client')}, a payment of <strong>${formattedAmount}</strong>
  is requested for the following:
</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;width:100%;">
  <tr>
    <td style="padding:12px 20px;background:#f0f4f8;border-radius:6px;border-left:4px solid ${primaryColor};">
      <strong>Description:</strong> ${escapeHtml(description.trim())}<br />
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
      <a href="${escapeHtml(paymentUrl)}" target="_blank"
         style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;
                color:#ffffff;text-decoration:none;border-radius:6px;
                background-color:${primaryColor};mso-padding-alt:14px 32px;"
      >Pay Now — ${formattedAmount}</a>
    </td>
  </tr>
</table>
<p style="margin:24px 0 0;font-size:13px;color:#718096;">
  If the button does not work, copy and paste this link into your browser:<br />
  <a href="${escapeHtml(paymentUrl)}" style="color:${primaryColor};word-break:break-all;">${escapeHtml(paymentUrl)}</a>
</p>
<p style="margin:16px 0 0;font-size:13px;color:#718096;">
  If you have any questions about this payment, please contact us at
  ${escapeHtml(firmEmail || firmPhone || 'our office')}.
</p>`;

          const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /><title>${escapeHtml(firmName)}</title></head>
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
          ${contactLine ? `<p style="margin:0 0 8px;">${escapeHtml(firmName)} &nbsp;|&nbsp; ${contactLine}</p>` : `<p style="margin:0 0 8px;">${escapeHtml(firmName)}</p>`}
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
 * 8am does NOT sign these requests. The caller is authenticated by the token in the Event URL,
 * and every figure is re-read from the gateway (see fetchVerifiedCharge) rather than taken from
 * the body. Answer 200 on any definitive outcome so 8am stops retrying; answer 503 only when
 * verification could not be completed, which is exactly when a redelivery helps.
 */
export const lawpayWebhook = onRequest(
  {
    region: 'us-east1',
    timeoutSeconds: 60,
    memory: '512MiB',
    // Bind the webhook signing secret so verifyWebhookSignature can read it
    // from process.env. Without this v2 `secrets` option the env var is never
    // populated in production, the signature check fails closed, and every
    // webhook is rejected with 401 (audit #165).
    // LAWPAY_WEBHOOK_TOKEN authenticates the caller; LAWPAY_API_KEY re-reads the charge so the
    // request body is never trusted. LAWPAY_WEBHOOK_SECRET is gone: 8am issues no signing
    // secret, so binding one both rejected every webhook and failed every deploy.
    secrets: ['LAWPAY_WEBHOOK_TOKEN', 'LAWPAY_API_KEY'],
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
    // 1. Authenticate the caller by the token in the Event URL
    // ------------------------------------------------------------------
    if (!verifyWebhookToken(req)) {
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
      res.status(200).send('OK: malformed-body');
      return;
    }

    const { type, data } = event;
    const transactionId = data?.id;

    console.log(`[lawpayWebhook] Received event type=${type} transactionId=${transactionId}`);

    if (!transactionId) {
      console.error('[lawpayWebhook] Missing data.id in webhook payload');
      res.status(200).send('OK: missing-data-id');
      return;
    }

    // ------------------------------------------------------------------
    // 2b. Re-read the charge from the gateway. The id above is the ONLY thing taken from the
    //     body; the amount, status and reference used below all come from this response.
    // ------------------------------------------------------------------
    const lookup = await fetchVerifiedCharge(transactionId);
    if (lookup.outcome === 'unavailable') {
      // Could not establish what actually happened. Answer non-200 so 8am redelivers rather
      // than acting on an unverified payload or dropping a real payment.
      console.error(
        `[lawpayWebhook] Could not verify transactionId=${transactionId} (${lookup.detail}) — asking for redelivery`,
      );
      res.status(503).send('Verification unavailable');
      return;
    }
    if (lookup.outcome === 'not-found') {
      console.error(
        `[lawpayWebhook] Gateway does not know transactionId=${transactionId} — ignoring (payload was not authentic, or the charge is gone)`,
      );
      res.status(200).send('OK: gateway-unknown-transaction');
      return;
    }
    const charge = lookup.charge;
    if (type === 'charge.completed' && !PAID_STATUSES.has(charge.status.toLowerCase())) {
      // The body claimed success; the gateway disagrees. Never mark a payment paid on the
      // strength of the claim, and log the status verbatim so the vocabulary becomes known.
      console.error(
        `[lawpayWebhook] Refusing to mark paid — gateway status="${charge.status}" for transactionId=${transactionId}`,
      );
      res.status(200).send(`OK: gateway-status-not-paid status="${charge.status}"`);
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
      // From the gateway, not the caller.
      const reference: string = charge.reference;
      const refParts = reference.split('::');

      let paymentDocRef: admin.firestore.DocumentReference | null = null;

      if (refParts.length >= 3) {
        // reference = "firmId::clientId::paymentDocId" — locate the exact doc
        // created by createPaymentRequest. (Its id is the doc id, NOT the
        // transactionId, which LawPay only assigns at payment time.)
        const [firmId, clientId, paymentDocId] = refParts;
        paymentDocRef = paymentRef(db, firmId, clientId, paymentDocId);
      }
      // A 2-part legacy reference (or none) falls through to the
      // lawPayTransactionId fallback query below.

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
          // referenceParts, not the reference itself: enough to tell "the gateway sent no
          // usable reference" from "it sent one and the doc is gone", without putting firm and
          // client ids in an HTTP body.
          res.status(200).send(`OK: payment-doc-not-found reference-parts=${refParts.length}`);
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
        res.status(200).send(`OK: unhandled-event-type type="${type}"`);
        return;
      }

      // What the transaction actually did, so the response can say so. Without this the
      // "skipped" and "updated" cases are both a bare 200 and are indistinguishable from outside.
      let outcome = 'updated';

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(paymentDocRef!);
        if (!snap.exists) {
          console.warn(`[lawpayWebhook] Payment doc disappeared mid-transaction transactionId=${transactionId}`);
          outcome = 'payment-doc-vanished';
          return;
        }
        const currentStatus = (snap.data() as Record<string, unknown>).status as string | undefined;
        if (!allowed.includes(currentStatus ?? 'pending')) {
          console.log(
            `[lawpayWebhook] Skipping ${type} — current status "${currentStatus}" not in allowed set [${allowed.join(', ')}]`,
          );
          outcome = `transition-not-allowed from="${currentStatus}"`;
          return;
        }

        let updatePayload: Record<string, unknown> = {
          updatedAt: now,
          lastWebhookEventType: type,
          lastWebhookReceivedAt: now,
        };

        switch (type) {
          case 'charge.completed':
            // Persist the transactionId so a later charge.refunded (which may
            // arrive with only data.id and no reference) can be matched via the
            // fallback collectionGroup query.
            updatePayload = { ...updatePayload, status: 'paid', amountPaid: charge.amount, balanceDue: 0, paidAt: now, lawPayTransactionId: charge.id, lawPayChargeStatus: charge.status };
            console.log(`[lawpayWebhook] Marking payment PAID — transactionId=${transactionId}`);
            break;
          case 'charge.failed':
            updatePayload = { ...updatePayload, status: 'pending', lastFailureReason: charge.failureReason ?? 'Charge failed' };
            console.log(`[lawpayWebhook] Charge FAILED — transactionId=${transactionId} (status stays pending)`);
            break;
          case 'charge.refunded':
            updatePayload = { ...updatePayload, status: 'refunded', refundedAt: now, refundedAmount: charge.amount };
            console.log(`[lawpayWebhook] Charge REFUNDED — transactionId=${transactionId}`);
            break;
        }

        tx.update(paymentDocRef!, updatePayload);
      });

      console.log(`[lawpayWebhook] Payment doc updated — transactionId=${transactionId} type=${type}`);
      res.status(200).send(`OK: ${outcome}`);
      return;
    } catch (error) {
      // Log the error but return 200 so LawPay doesn't retry indefinitely.
      // We rely on Cloud Logging alerts to catch persistent failures.
      console.error('[lawpayWebhook] Error processing webhook:', error);
      // The message only — never the stack, and never anything read from the gateway.
      res.status(200).send(`OK: handler-error ${error instanceof Error ? error.message : 'unknown'}`);
      return;
    }
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
