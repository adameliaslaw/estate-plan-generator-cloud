/**
 * functions/src/firm-secrets.ts
 *
 * Per-firm third-party API keys (OpenAI/Anthropic/Gemini/Perplexity/CourtListener/
 * AssemblyAI/SendGrid/LawPay/Levitate) used to live as top-level fields on the
 * `firms/{firmId}` document. That document is client-SDK readable by any in-firm
 * attorney/paralegal (firestore.rules), so the secrets were fetchable in the
 * browser and exfiltratable via XSS (audit finding AR).
 *
 * They now live in a Functions-only document `firms/{firmId}/secrets/apiKeys`
 * (`allow read, write: if false` — admin SDK only). Backend code merges those
 * secrets back onto the firm data it already loads, so existing readers
 * (`firmData.openAiApiKey`, `getSendGridKey(firmData)`, etc.) keep working
 * unchanged. The browser only ever sees non-secret presence indicators
 * (`{field}Set` / `{field}Last4`) written to the firm doc by `updateFirmApiKeys`.
 */

import * as admin from 'firebase-admin';

/** The secret key fields moved off the client-readable firm document. */
export const SECRET_KEY_FIELDS = [
  'openAiApiKey',
  'anthropicApiKey',
  'geminiApiKey',
  'perplexityApiKey',
  'courtlistenerApiKey',
  'assemblyaiApiKey',
  'sendGridApiKey',
  'lawPayApiKey',
  'lawPayMerchantId',
  'levitateApiKey',
  'levitateWebhookUrl',
] as const;

// NOTE: `lawPayPublicKey` is deliberately NOT a secret — it is LawPay's
// publishable key, read in the browser by ChargePaymentDialog to initialize the
// hosted-fields SDK. It stays on the (client-readable) firm doc.

export type SecretKeyField = (typeof SECRET_KEY_FIELDS)[number];

/** Firestore path to a firm's Functions-only secrets document. */
export function firmSecretsRef(
  firmId: string,
): admin.firestore.DocumentReference {
  return admin
    .firestore()
    .collection('firms')
    .doc(firmId)
    .collection('secrets')
    .doc('apiKeys');
}

/**
 * Load a firm's secret API keys from the Functions-only secrets document.
 * Returns `{}` if none have been configured yet. Spread the result onto the
 * firm data you already loaded so downstream readers see the keys:
 *
 *   const firmData = { ...(firmSnap.data() ?? {}), ...(await loadFirmSecrets(firmId)) };
 */
export async function loadFirmSecrets(
  firmId: string,
): Promise<Record<string, unknown>> {
  const snap = await firmSecretsRef(firmId).get();
  return snap.exists ? (snap.data() ?? {}) : {};
}
