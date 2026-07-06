/**
 * register-client.ts
 *
 * Public callable function that powers the questionnaire self-registration
 * flow. When an attorney shares a generic link (/questionnaire/:firmId/register),
 * clients land on a page that asks for their name and email. This function
 * either claims a specific existing record via an attorney-issued token, or
 * (for the generic firm link, no token) creates a fresh prospect stub, so the
 * client can be redirected into the questionnaire.
 *
 * The caller must hold a Firebase Auth token. The register page signs the
 * visitor in anonymously BEFORE calling this, so legitimate users are
 * unaffected — but unauthenticated scripts can no longer create records, and
 * the verified `request.auth.uid` is what we store as `linkedUserId` (rather
 * than trusting a caller-supplied id). That uid is the "linked session" key the
 * Firestore rules check (`resource.data.linkedUserId == request.auth.uid`), so
 * binding it to the token prevents a caller from linking a record to someone
 * else's session (audit finding BM).
 *
 * R5-010: this flow used to CLAIM any unlinked existing record on a bare
 * name+email match. Email is not a verified identity in the anonymous flow, so
 * that let anyone who knew a pre-created client's email take over their record.
 * Claiming an existing record now requires a `registrationToken` the attorney
 * minted (createClientRegistrationLink) and embedded in a personal invite link.
 * Without a token, the generic link can ONLY create a brand-new prospect stub —
 * it never looks a record up by email.
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
      token?: unknown;
    };

    const firmId = typeof data.firmId === 'string' ? data.firmId.trim() : '';
    const token = typeof data.token === 'string' ? data.token.trim() : '';

    if (!firmId) throw new HttpsError('invalid-argument', 'firmId is required.');

    const db = admin.firestore();

    // Verify the firm exists so we don't create orphan client records.
    const firmSnap = await db.doc(`firms/${firmId}`).get();
    if (!firmSnap.exists) {
      throw new HttpsError('not-found', 'Firm not found.');
    }

    const clientsCol = db.collection(`firms/${firmId}/clients`);

    // ── Token path: claim the ONE record the attorney's invite link points to.
    // The token is a bearer credential (createClientRegistrationLink), so we do
    // not require the typed name/email to match — possession of the link is the
    // authorization. We (re-)point linkedUserId to the current session so the
    // real client is never locked out when they change devices/browsers.
    if (token) {
      const tokenSnap = await clientsCol
        .where('registrationToken', '==', token)
        .limit(1)
        .get();
      if (tokenSnap.empty) {
        throw new HttpsError('not-found', 'This invitation link is invalid or has expired.');
      }
      const clientDoc = tokenSnap.docs[0];
      const existingLink = clientDoc.get('linkedUserId') as string | undefined;
      if (existingLink !== linkUid) {
        await clientDoc.ref.update({
          linkedUserId: linkUid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      return { clientId: clientDoc.id, isNew: false };
    }

    // ── No token: self-registration via the generic firm link. Requires a
    // name + email so staff have something to work with, and always creates a
    // NEW prospect stub. It never looks a record up by email (that was the
    // R5-010 takeover oracle).
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    const firstName = typeof data.firstName === 'string' ? data.firstName.trim() : '';
    const lastName = typeof data.lastName === 'string' ? data.lastName.trim() : '';

    if (!email || !EMAIL_RE.test(email)) throw new HttpsError('invalid-argument', 'A valid email address is required.');
    if (!firstName) throw new HttpsError('invalid-argument', 'First name is required.');
    if (!lastName) throw new HttpsError('invalid-argument', 'Last name is required.');

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
    });
    return { clientId: ref.id, isNew: true };
  },
);
