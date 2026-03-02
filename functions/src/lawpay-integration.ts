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

import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

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
  clientEmail: string;
  clientName: string;
}

/** Shape of a successful AffiniPay charge response (relevant fields). */
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
function getLawPayCredentials(): { apiKey: string; merchantId: string } {
  const apiKey = process.env.LAWPAY_API_KEY;
  const merchantId = process.env.LAWPAY_MERCHANT_ID;

  if (!apiKey || !merchantId) {
    throw new HttpsError(
      'failed-precondition',
      'LawPay integration not configured. Set LAWPAY_API_KEY and LAWPAY_MERCHANT_ID ' +
      'as Cloud Function environment variables (see Settings → Integrations).',
    );
  }

  return { apiKey, merchantId };
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
  req: import('express').Request,
  rawBody: string,
): boolean {
  const webhookSecret = process.env.LAWPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.warn(
      '[lawpayWebhook] LAWPAY_WEBHOOK_SECRET not set — skipping signature verification. ' +
      'Set this variable before going to production.',
    );
    return true; // Allow in dev; reject in prod once secret is configured
  }

  const signature = req.headers['x-affinipay-signature'] as string | undefined;
  if (!signature) {
    console.error('[lawpayWebhook] Missing X-AffiniPay-Signature header');
    return false;
  }

  const crypto = require('crypto');
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
 * Creates a LawPay / AffiniPay charge and stores the resulting Payment doc in
 * Firestore.  Returns the payment URL so the frontend can open it in a new tab
 * or embed it.
 *
 * Input:  { firmId, clientId, amount, description, accountDesignation,
 *           clientEmail, clientName }
 * Output: { paymentUrl, transactionId, paymentDocId }
 */
export const createPaymentRequest = onCall(
  {
    region: 'us-east1',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (request: any /* CallableRequest */) => {
    // ------------------------------------------------------------------
    // 1. Auth check
    // ------------------------------------------------------------------
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be logged in to create payment requests.');
    }

    const {
      firmId,
      clientId,
      amount,
      description,
      accountDesignation,
      clientEmail,
      clientName,
    } = request.data as CreatePaymentRequestData;

    // ------------------------------------------------------------------
    // 2. Validate input
    // ------------------------------------------------------------------
    if (!firmId || !clientId) {
      throw new HttpsError('invalid-argument', 'firmId and clientId are required.');
    }
    if (!amount || amount <= 0) {
      throw new HttpsError('invalid-argument', 'amount must be a positive integer (in cents).');
    }
    if (!description?.trim()) {
      throw new HttpsError('invalid-argument', 'description is required.');
    }
    if (!['operating', 'trust'].includes(accountDesignation)) {
      throw new HttpsError(
        'invalid-argument',
        'accountDesignation must be "operating" or "trust".',
      );
    }
    if (!clientEmail || !clientName) {
      throw new HttpsError('invalid-argument', 'clientEmail and clientName are required.');
    }

    console.log(
      `[createPaymentRequest] firmId=${firmId} clientId=${clientId} ` +
      `amount=${amount} designation=${accountDesignation}`,
    );

    // ------------------------------------------------------------------
    // 3. Verify credentials are configured
    // ------------------------------------------------------------------
    const { apiKey, merchantId } = getLawPayCredentials();

    // ------------------------------------------------------------------
    // 4. Create charge via AffiniPay REST API
    //
    //    POST https://api.affinipay.com/v1/charges
    //    Docs: https://developer.affinipay.com/reference/charge-object
    // ------------------------------------------------------------------

    // We use a temporary Firestore ID in the reference so the webhook can
    // later look up the right firm + client documents.
    const db = admin.firestore();
    const tempPaymentRef = db
      .collection('firms')
      .doc(firmId)
      .collection('clients')
      .doc(clientId)
      .collection('payments')
      .doc(); // auto-ID — will be updated once we have the transaction ID

    const chargePayload = {
      amount,              // in cents
      currency: 'USD',
      account_id: merchantId,
      description: description.trim(),
      // reference encodes firmId + clientId + our Firestore doc ID so the webhook
      // can resolve the right document without a full-table scan.
      reference: `${firmId}-${clientId}-${tempPaymentRef.id}`,
      email: clientEmail,
      // account_designation tells AffiniPay which merchant account to credit.
      // "operating" → general operating account
      // "trust"     → IOLTA/trust account
      account_designation: accountDesignation,
    };

    let chargeResponse: AffiniPayChargeResponse;
    try {
      const response = await fetch('https://api.affinipay.com/v1/charges', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(chargePayload),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(
          `[createPaymentRequest] AffiniPay API error ${response.status}: ${errorBody}`,
        );
        throw new HttpsError(
          'internal',
          `LawPay API returned an error (${response.status}). ` +
          'Please check your API credentials and try again.',
        );
      }

      chargeResponse = (await response.json()) as AffiniPayChargeResponse;
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error('[createPaymentRequest] Fetch error:', error);
      throw new HttpsError(
        'internal',
        `Failed to reach the LawPay API: ${error instanceof Error ? error.message : 'Network error'}`,
      );
    }

    const transactionId = chargeResponse.id;
    const paymentUrl =
      chargeResponse.payment_page_url ??
      `https://secure.lawpay.com/pay/${transactionId}`;

    console.log(
      `[createPaymentRequest] Charge created — transactionId=${transactionId} url=${paymentUrl}`,
    );

    // ------------------------------------------------------------------
    // 5. Persist Payment document in Firestore
    //    Use the AffiniPay transaction ID as the document ID so the
    //    webhook handler can do a direct doc lookup.
    // ------------------------------------------------------------------
    const now = admin.firestore.FieldValue.serverTimestamp();
    const finalPaymentRef = paymentRef(db, firmId, clientId, transactionId);

    await finalPaymentRef.set({
      id: transactionId,
      firmId,
      clientId,
      // LawPay / AffiniPay fields
      lawPayTransactionId: transactionId,
      lawPayPaymentUrl: paymentUrl,
      lawPayReference: chargePayload.reference,
      // Financial details
      amount,                  // in cents
      amountFormatted: (amount / 100).toFixed(2),
      currency: 'USD',
      description: description.trim(),
      accountDesignation,
      // Client info
      clientEmail,
      clientName,
      // Status
      status: 'pending',
      amountPaid: 0,
      balanceDue: amount,
      paidAt: null,
      // Metadata
      createdAt: now,
      createdBy: request.auth.uid,
      updatedAt: now,
      updatedBy: request.auth.uid,
    });

    // Clean up the temp doc if it was actually persisted (it was just for ID generation)
    // In practice, Firestore doesn't persist the ref until .set() is called, so this is a no-op.

    console.log(`[createPaymentRequest] Saved Payment doc — id=${transactionId}`);

    return {
      paymentUrl,
      transactionId,
      paymentDocId: transactionId,
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
      const refParts = reference.split('-');

      let paymentDocRef: admin.firestore.DocumentReference | null = null;

      if (refParts.length >= 3) {
        // reference = "firmId-clientId-paymentDocId"
        // firmId and clientId may themselves contain hyphens, so extract
        // only the last segment as paymentDocId and reconstruct the path
        // using the transaction ID (which is the docId).
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
      // 4. Build status update based on event type
      // ------------------------------------------------------------------
      let updatePayload: Record<string, unknown> = {
        updatedAt: now,
        lastWebhookEventType: type,
        lastWebhookReceivedAt: now,
      };

      switch (type) {
        case 'charge.completed':
          updatePayload = {
            ...updatePayload,
            status: 'paid',
            amountPaid: data.amount,
            balanceDue: 0,
            paidAt: now,
          };
          console.log(`[lawpayWebhook] Marking payment PAID — transactionId=${transactionId}`);
          break;

        case 'charge.failed':
          // Keep as pending so the attorney can re-send or retry
          updatePayload = {
            ...updatePayload,
            status: 'pending',
            lastFailureReason: (data.failure_reason as string) ?? 'Charge failed',
          };
          console.log(`[lawpayWebhook] Charge FAILED — transactionId=${transactionId} (status stays pending)`);
          break;

        case 'charge.refunded':
          updatePayload = {
            ...updatePayload,
            status: 'refunded',
            refundedAt: now,
            refundedAmount: data.amount,
          };
          console.log(`[lawpayWebhook] Charge REFUNDED — transactionId=${transactionId}`);
          break;

        default:
          // Unknown event type — log and acknowledge without mutating Firestore
          console.log(`[lawpayWebhook] Unhandled event type="${type}" — ignoring`);
          res.status(200).send('OK');
          return;
      }

      // ------------------------------------------------------------------
      // 5. Write the update
      // ------------------------------------------------------------------
      await paymentDocRef.update(updatePayload);
      console.log(`[lawpayWebhook] Payment doc updated — transactionId=${transactionId} type=${type}`);
    } catch (error) {
      // Log the error but return 200 so LawPay doesn't retry indefinitely.
      // We rely on Cloud Logging alerts to catch persistent failures.
      console.error('[lawpayWebhook] Error processing webhook:', error);
    }

    res.status(200).send('OK');
  },
);
