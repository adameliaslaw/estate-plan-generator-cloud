/**
 * functions/src/firm-settings.ts
 *
 * Callable that saves per-firm third-party API keys to the Functions-only
 * `firms/{firmId}/secrets/apiKeys` document (audit finding AR — keys must not
 * live on the client-readable firm doc). The browser calls this instead of
 * writing the keys directly via the client SDK.
 *
 * For each key saved, a NON-secret presence indicator (`{field}Set` boolean and
 * `{field}Last4` string) is written onto the firm doc so the Settings UI can
 * still show "configured ••••1234" without ever loading the full key. An empty
 * value clears the key (and its indicators).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { z } from 'zod';
import { assertStaff } from './auth-guards';
import { SECRET_KEY_FIELDS, SecretKeyField, firmSecretsRef } from './firm-secrets';

const SECRET_FIELD_SET = new Set<string>(SECRET_KEY_FIELDS);

// Each value is the raw key (≤4096 chars) or '' to clear. Keys are validated
// against the SECRET_KEY_FIELDS allowlist below, so an open record is safe.
const RequestSchema = z.object({
  firmId: z.string().min(1).max(200),
  updates: z.record(z.string(), z.string().max(4096)),
});

function last4(value: string): string {
  return value.length <= 4 ? value : value.slice(-4);
}

export const updateFirmApiKeys = onCall(
  // invoker:'public' makes the browser-callable binding declarative (auth is
  // still enforced in-code below); memory inherits the global 512MiB floor
  // (256MiB OOMs on Node 22 cold start).
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request) => {
    const caller = assertStaff(request);

    const parsed = RequestSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'firmId and updates are required.');
    }
    const { firmId, updates } = parsed.data;

    // Mirror firestore.rules canManageFirmSettings(): admin/attorney or the
    // explicit manage_firm_settings capability. Paralegals are excluded by
    // policy (finding AS) unless granted the capability.
    const capabilities = (request.auth?.token.capabilities as string[] | undefined) ?? [];
    const canManageSettings =
      caller.role === 'admin' ||
      caller.role === 'attorney' ||
      capabilities.includes('manage_firm_settings');
    if (!canManageSettings) {
      throw new HttpsError('permission-denied', 'You do not have permission to manage firm settings.');
    }
    if (caller.firmId !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot update settings for a different firm.');
    }

    // Reject any field not on the secret allowlist — prevents writing arbitrary
    // data into the secrets doc or the firm doc indicators.
    const fields = Object.keys(updates);
    if (fields.length === 0) {
      throw new HttpsError('invalid-argument', 'No key updates provided.');
    }
    for (const field of fields) {
      if (!SECRET_FIELD_SET.has(field)) {
        throw new HttpsError('invalid-argument', `Unknown API key field: ${field}`);
      }
    }

    const db = admin.firestore();
    const secretWrites: Record<string, unknown> = {};
    const indicatorWrites: Record<string, unknown> = {};

    for (const field of fields as SecretKeyField[]) {
      const value = updates[field].trim();
      if (value === '') {
        // Clear the key and its indicators.
        secretWrites[field] = admin.firestore.FieldValue.delete();
        indicatorWrites[`${field}Set`] = false;
        indicatorWrites[`${field}Last4`] = admin.firestore.FieldValue.delete();
      } else {
        secretWrites[field] = value;
        indicatorWrites[`${field}Set`] = true;
        indicatorWrites[`${field}Last4`] = last4(value);
      }
    }

    // Secrets doc is Functions-only (rules: allow read, write: if false), so
    // this admin-SDK write is the only path that can touch it.
    await firmSecretsRef(firmId).set(secretWrites, { merge: true });
    await db.collection('firms').doc(firmId).set(indicatorWrites, { merge: true });

    return { success: true, updated: fields };
  },
);

/**
 * One-time migration (audit finding AR): move any provider keys still stored on
 * the client-readable `firms/{firmId}` doc into the Functions-only secrets doc,
 * write the masked presence indicators, then delete the raw key fields (top-
 * level and any legacy `settings.*` copy) from the firm doc.
 *
 * Idempotent — a second run finds no raw fields and migrates nothing. Admin-only
 * and scoped to the caller's firm. Safe to deploy before running: until it runs,
 * readers still see the keys on the firm doc (loadFirmSecrets merges an empty
 * secrets doc), so nothing breaks; the only effect pre-run is the Settings UI
 * showing keys as "not configured" until indicators exist.
 */
export const migrateFirmApiKeysToSecrets = onCall(
  // invoker:'public' makes the browser-callable binding declarative (auth is
  // still enforced in-code below); memory inherits the global 512MiB floor
  // (256MiB OOMs on Node 22 cold start).
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request) => {
    const caller = assertStaff(request);
    if (caller.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Only an admin can run this migration.');
    }
    const firmId = caller.firmId;
    if (!firmId) {
      throw new HttpsError('permission-denied', 'No firm associated with this account.');
    }

    const db = admin.firestore();
    const firmRef = db.collection('firms').doc(firmId);
    const firmSnap = await firmRef.get();
    if (!firmSnap.exists) {
      throw new HttpsError('not-found', `Firm ${firmId} not found.`);
    }
    const firm = firmSnap.data() ?? {};
    const settings = (firm.settings as Record<string, unknown> | undefined) ?? {};

    const secretWrites: Record<string, unknown> = {};
    const indicatorWrites: Record<string, unknown> = {};
    const firmDeletes: Record<string, unknown> = {};
    const migrated: string[] = [];

    for (const field of SECRET_KEY_FIELDS) {
      const raw = (firm[field] ?? settings[field]) as unknown;
      const value = typeof raw === 'string' ? raw.trim() : '';
      // Always strip any raw copy off the firm doc, even if empty/blank.
      if (field in firm) firmDeletes[field] = admin.firestore.FieldValue.delete();
      if (field in settings) firmDeletes[`settings.${field}`] = admin.firestore.FieldValue.delete();
      if (value === '') continue;
      secretWrites[field] = value;
      indicatorWrites[`${field}Set`] = true;
      indicatorWrites[`${field}Last4`] = last4(value);
      migrated.push(field);
    }

    if (Object.keys(secretWrites).length > 0) {
      await firmSecretsRef(firmId).set(secretWrites, { merge: true });
    }
    if (Object.keys(indicatorWrites).length > 0) {
      await firmRef.set(indicatorWrites, { merge: true });
    }
    if (Object.keys(firmDeletes).length > 0) {
      await firmRef.update(firmDeletes);
    }

    return { success: true, migrated, removedFromFirmDoc: Object.keys(firmDeletes) };
  },
);
