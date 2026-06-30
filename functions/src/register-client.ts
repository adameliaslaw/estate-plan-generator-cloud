/**
 * register-client.ts
 *
 * Public callable function that powers the questionnaire self-registration
 * flow. When an attorney shares a generic link (/questionnaire/:firmId/register),
 * clients land on a page that asks for their name and email. This function
 * either finds their existing record or creates a new prospect stub so the
 * client can be redirected into the questionnaire without the attorney
 * manually sending a per-client invite.
 *
 * The caller must hold a Firebase Auth token. The register page signs the
 * visitor in anonymously BEFORE calling this, so legitimate users are
 * unaffected — but unauthenticated scripts can no longer create records, and
 * the verified `request.auth.uid` is what we store as `linkedUserId` (rather
 * than trusting a caller-supplied id). That uid is the "linked session" key the
 * Firestore rules check (`resource.data.linkedUserId == request.auth.uid`), so
 * binding it to the token prevents a caller from linking a record to someone
 * else's session (audit finding BM).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Per-firm flood guard. This endpoint is reachable by any authenticated session
// (including anonymous), so cap how many NEW prospect stubs one firm can accrue
// per hour to bound abuse from a script minting anonymous tokens.
const REGISTRATION_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const REGISTRATION_CAP = 50; // new stubs per firm per window

/**
 * Throttle NEW prospect-stub creation per firm. The counter lives in the
 * Functions-only `secrets` subcollection (`allow read, write: if false`), so no
 * client can read or tamper with it and no firestore.rules change is needed.
 * `loadFirmSecrets()` reads only `secrets/apiKeys`, so this sibling doc does not
 * interfere. Throws `resource-exhausted` once the window cap is reached.
 */
async function enforceRegistrationRateLimit(
  db: admin.firestore.Firestore,
  firmId: string,
): Promise<void> {
  const ref = db.doc(`firms/${firmId}/secrets/registrationThrottle`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const windowStart = (snap.get('windowStart') as number | undefined) ?? 0;
    const count = (snap.get('count') as number | undefined) ?? 0;

    if (now - windowStart > REGISTRATION_WINDOW_MS) {
      tx.set(ref, { windowStart: now, count: 1 });
      return;
    }
    if (count >= REGISTRATION_CAP) {
      throw new HttpsError(
        'resource-exhausted',
        'Too many registrations for this firm right now. Please try again shortly.',
      );
    }
    tx.set(ref, { windowStart, count: count + 1 }, { merge: true });
  });
}

export const registerClientFromLink = onCall(
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request) => {
    // Require a Firebase Auth token. The register page signs the visitor in
    // anonymously before calling, so this is transparent to real users but
    // blocks unauthenticated scripts (audit finding BM).
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'A session is required to register.');
    }
    // The verified uid — NOT a caller-supplied value — is the linked-session key.
    const linkUid = request.auth.uid;

    const data = request.data as {
      firmId?: unknown;
      email?: unknown;
      firstName?: unknown;
      lastName?: unknown;
    };

    const firmId = typeof data.firmId === 'string' ? data.firmId.trim() : '';
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    const firstName = typeof data.firstName === 'string' ? data.firstName.trim() : '';
    const lastName = typeof data.lastName === 'string' ? data.lastName.trim() : '';

    if (!firmId) throw new HttpsError('invalid-argument', 'firmId is required.');
    if (!email || !EMAIL_RE.test(email)) throw new HttpsError('invalid-argument', 'A valid email address is required.');
    if (!firstName) throw new HttpsError('invalid-argument', 'First name is required.');
    if (!lastName) throw new HttpsError('invalid-argument', 'Last name is required.');

    const db = admin.firestore();

    // Verify the firm exists so we don't create orphan client records.
    const firmSnap = await db.doc(`firms/${firmId}`).get();
    if (!firmSnap.exists) {
      throw new HttpsError('not-found', 'Firm not found.');
    }

    const clientsCol = db.collection(`firms/${firmId}/clients`);

    // Creates a fresh prospect stub linked to this anonymous session so the
    // visitor can immediately start the questionnaire on their own record.
    async function createStub(
      extra: admin.firestore.DocumentData = {},
    ): Promise<string> {
      // Bound per-firm flooding before writing a new record.
      await enforceRegistrationRateLimit(db, firmId);
      const ref = clientsCol.doc();
      await ref.set({
        firmId,
        personalInfo: { firstName, lastName, email },
        linkedUserId: linkUid,
        status: 'prospect',
        isArchived: false,
        questionnaireProgress: {
          status: 'not_started',
          sectionsCompleted: [],
          lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdVia: 'questionnaire_link',
        ...extra,
      });
      return ref.id;
    }

    // Look for an existing client record with this email.
    const existingSnap = await clientsCol
      .where('personalInfo.email', '==', email)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      const existingDoc = existingSnap.docs[0];
      const existingLink = existingDoc.get('linkedUserId') as string | undefined;

      // The record is already linked to a DIFFERENT session. Email is not a
      // verified identity here (anonymous registration), so silently overwriting
      // the link would hand this visitor someone else's record — the
      // account-hijack path. Instead, give the visitor their own fresh record so
      // they're never locked out, and flag the collision for staff to reconcile.
      if (existingLink && existingLink !== linkUid) {
        const newId = await createStub({
          emailCollision: true,
          collidesWithClientId: existingDoc.id,
          status: 'prospect',
        });

        // Surface it in the dashboard activity feed (best-effort).
        try {
          await clientsCol.parent!.collection('activities').add({
            firmId,
            userId: 'system',
            userName: 'System',
            action: 'questionnaire registration needs review',
            description:
              `A questionnaire registration used an email already linked to another ` +
              `client record. A separate record was created for "${firstName} ${lastName}" ` +
              `(${email}); please reconcile with the existing record.`,
            context: { clientId: newId, collidesWithClientId: existingDoc.id, email },
            clientId: newId,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (logErr) {
          console.warn('[registerClientFromLink] Failed to log collision activity:', logErr);
        }

        return { clientId: newId, isNew: true, needsReview: true };
      }

      // Unlinked record (e.g. attorney-created or imported), or the same session
      // returning: claim/keep the link so the visitor can read/write it.
      if (!existingLink) {
        await existingDoc.ref.update({
          linkedUserId: linkUid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      return { clientId: existingDoc.id, isNew: false };
    }

    // No existing record — create a fresh prospect stub.
    const newId = await createStub();
    return { clientId: newId, isNew: true };
  },
);
