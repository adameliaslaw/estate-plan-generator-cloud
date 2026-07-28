/**
 * tests/emulator/_emulator.ts
 *
 * Shared harness for emulator-backed integration tests. Initializes the
 * firebase-admin SDK (from functions/node_modules, so it's the SAME module
 * instance the functions/src code under test imports) and points it at the
 * local Firestore + Auth emulators.
 *
 * `firebase emulators:exec` sets FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST
 * automatically; the defaults below let the tests also run against a manually
 * started emulator (`firebase emulators:start`).
 */

// Resolve the exact firebase-admin the functions code uses (root has none).
import * as admin from '../../functions/node_modules/firebase-admin';

export const EMULATOR_PROJECT_ID = 'demo-eplan';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= '127.0.0.1:9199';
// A demo-* project id keeps the admin SDK from ever reaching real GCP.
process.env.GCLOUD_PROJECT ??= EMULATOR_PROJECT_ID;

if (!admin.apps.length) {
  // storageBucket makes admin.storage().bucket() resolvable against the
  // Storage emulator (tests that never touch Storage are unaffected).
  admin.initializeApp({
    projectId: EMULATOR_PROJECT_ID,
    storageBucket: `${EMULATOR_PROJECT_ID}.appspot.com`,
  });
}

export { admin };

/** Unique suffix so parallel/repeat runs never collide on ids or emails. */
let counter = 0;
export function uniq(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

/** Delete an Auth user by email if it exists (best-effort cleanup). */
export async function deleteAuthUserByEmail(email: string): Promise<void> {
  try {
    const user = await admin.auth().getUserByEmail(email);
    await admin.auth().deleteUser(user.uid);
  } catch {
    // not found / already deleted — nothing to clean up
  }
}
