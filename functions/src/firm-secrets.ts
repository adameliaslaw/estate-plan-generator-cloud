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
 *
 * Google Calendar + Drive OAuth access/refresh tokens follow the same pattern
 * (audit finding #163): they live in `firms/{firmId}/secrets/googleOAuth`
 * under the `calendar` / `drive` keys, while the non-secret status flags the
 * Settings UI reads (`googleCalendar.connected`, `.needsReauth`, …) stay on
 * the firm doc.
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
  'dropboxSignApiKey',
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

// ---------------------------------------------------------------------------
// Google OAuth tokens (audit finding #163)
// ---------------------------------------------------------------------------
//
// Google Calendar + Drive OAuth access/refresh tokens used to live on the
// client-readable `firms/{firmId}` document (`googleCalendar.accessToken`,
// `googleDrive.refreshToken`, …), so any in-firm staff browser could read the
// long-lived refresh token straight out of Firestore — the same exposure
// class as finding AR above, missed for OAuth. They now live in the
// Functions-only document `firms/{firmId}/secrets/googleOAuth`:
//
//   {
//     calendar: { accessToken, refreshToken, tokenExpiry },
//     drive:    { accessToken, refreshToken, tokenExpiry },
//   }
//
// The non-secret status flags the Settings UI and GoogleReauthBanner read
// (`googleCalendar.connected`, `.needsReauth`, `.needsReauthAt`,
// `googleDrive.rootFolderId`) stay on the firm doc. Readers fall back to the
// legacy firm-doc fields so connections made before this change keep working;
// the next successful token refresh migrates them into the secrets doc and
// deletes the legacy fields (saveGoogleOAuthTokens).

export type GoogleIntegration = 'calendar' | 'drive';

export interface GoogleOAuthTokens {
  accessToken?: string;
  refreshToken?: string;
  /** Epoch milliseconds when the access token expires. */
  tokenExpiry?: number;
}

/** The firm-doc field that holds an integration's status flags (and held its
 *  tokens before #163). */
function legacyGoogleFieldName(integration: GoogleIntegration): string {
  return integration === 'calendar' ? 'googleCalendar' : 'googleDrive';
}

/** Firestore path to a firm's Functions-only Google OAuth token document. */
export function firmGoogleOAuthRef(
  firmId: string,
): admin.firestore.DocumentReference {
  return admin
    .firestore()
    .collection('firms')
    .doc(firmId)
    .collection('secrets')
    .doc('googleOAuth');
}

/**
 * Load a firm's Google OAuth tokens for one integration from the
 * Functions-only secrets document. Falls back to the legacy firm-doc location
 * (`googleCalendar` / `googleDrive`) so pre-#163 connections keep working
 * until the next refresh migrates them. Returns null when the integration
 * was never connected (or has no usable token pair).
 */
export async function loadGoogleOAuthTokens(
  firmId: string,
  integration: GoogleIntegration,
): Promise<GoogleOAuthTokens | null> {
  const snap = await firmGoogleOAuthRef(firmId).get();
  const fromSecrets = snap.exists
    ? (snap.data()?.[integration] as GoogleOAuthTokens | undefined)
    : undefined;
  if (fromSecrets?.accessToken && fromSecrets?.refreshToken) {
    return fromSecrets;
  }

  const firmSnap = await admin.firestore().doc(`firms/${firmId}`).get();
  const legacy = firmSnap.exists
    ? (firmSnap.data()?.[legacyGoogleFieldName(integration)] as
        | GoogleOAuthTokens
        | undefined)
    : undefined;
  return legacy?.accessToken && legacy?.refreshToken ? legacy : null;
}

/**
 * Persist Google OAuth tokens to the Functions-only secrets document and
 * remove any legacy copies from the client-readable firm doc.
 */
export async function saveGoogleOAuthTokens(
  firmId: string,
  integration: GoogleIntegration,
  tokens: GoogleOAuthTokens,
): Promise<void> {
  await firmGoogleOAuthRef(firmId).set({ [integration]: tokens }, { merge: true });
  const prefix = legacyGoogleFieldName(integration);
  await admin.firestore().doc(`firms/${firmId}`).update({
    [`${prefix}.accessToken`]: admin.firestore.FieldValue.delete(),
    [`${prefix}.refreshToken`]: admin.firestore.FieldValue.delete(),
    [`${prefix}.tokenExpiry`]: admin.firestore.FieldValue.delete(),
  });
}

/**
 * Delete a firm's Google OAuth tokens for one integration from both the
 * secrets document and any legacy firm-doc fields (disconnect flow).
 */
export async function deleteGoogleOAuthTokens(
  firmId: string,
  integration: GoogleIntegration,
): Promise<void> {
  await firmGoogleOAuthRef(firmId).set(
    { [integration]: admin.firestore.FieldValue.delete() },
    { merge: true },
  );
  const prefix = legacyGoogleFieldName(integration);
  await admin.firestore().doc(`firms/${firmId}`).update({
    [`${prefix}.accessToken`]: admin.firestore.FieldValue.delete(),
    [`${prefix}.refreshToken`]: admin.firestore.FieldValue.delete(),
    [`${prefix}.tokenExpiry`]: admin.firestore.FieldValue.delete(),
  });
}
