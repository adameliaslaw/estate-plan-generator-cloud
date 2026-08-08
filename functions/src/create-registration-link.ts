/**
 * functions/src/create-registration-link.ts
 *
 * createClientRegistrationLink — staff-only callable that mints (or returns) a
 * per-client registration token so an attorney can send a *personal* invite
 * link for the questionnaire.
 *
 * Why (audit finding R5-010): the generic firm register link
 * (`/questionnaire/:firmId/register`) previously claimed any UNLINKED existing
 * client record on a bare name+email match. Because the anonymous register flow
 * never verifies email ownership, anyone who knew (or guessed) a pre-created
 * client's email could take over that record and read/write privileged estate
 * data. The fix removes the email-claim entirely: claiming an existing record
 * now requires this attorney-issued token. The token is a bearer credential —
 * whoever the attorney sends the link to can claim that one record (like an
 * "anyone with the link" grant), without any OTP/email-verification infra.
 *
 * The token is minted on demand and reused on subsequent calls so a link the
 * attorney already shared keeps working.
 */

import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { assertStaff } from './auth-guards';

/**
 * How long a registration token stays claimable (#170). The token is a bearer
 * credential; before this TTL it lived forever, so any leaked invite link was
 * a permanent claim on the client's record. Two weeks covers the ordinary
 * "attorney sends the link, client gets to it next week" flow; a stale link
 * fails with the standard invalid-or-expired message and the attorney's next
 * copy of the link transparently re-mints.
 */
export const REGISTRATION_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * True when a stored token is still claimable. A token with no createdAt
 * stamp is treated as expired — the stamp is always written with the token,
 * so its absence is an anomaly to fail closed on, not a legacy case.
 */
export function registrationTokenIsLive(createdAt: unknown, nowMs: number): boolean {
  const millis =
    createdAt && typeof (createdAt as { toMillis?: unknown }).toMillis === 'function'
      ? (createdAt as { toMillis: () => number }).toMillis()
      : null;
  return millis !== null && nowMs - millis <= REGISTRATION_TOKEN_TTL_MS;
}

const RequestSchema = z.object({
  clientId: z.string().min(1).max(200),
  /** Mint a fresh token even if a live one exists, invalidating shared links. */
  rotate: z.boolean().optional(),
});

export const createClientRegistrationLink = onCall(
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request: CallableRequest<unknown>) => {
    const caller = assertStaff(request);
    if (!caller.firmId) {
      throw new HttpsError('permission-denied', 'Staff account is missing a firm assignment.');
    }

    const parsed = RequestSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'A valid clientId is required.');
    }
    const { clientId, rotate } = parsed.data;

    const db = admin.firestore();
    const ref = db.doc(`firms/${caller.firmId}/clients/${clientId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Client not found.');
    }

    // Reuse an already-issued token so a previously shared link keeps working —
    // but only while it is inside its TTL (#170): handing back an expired token
    // would give the attorney a link the claim path is going to refuse. An
    // expired (or rotate-requested) token is replaced, which is also the
    // revocation story: rotating kills every previously shared copy.
    // base64url avoids URL-unsafe characters.
    let token = snap.get('registrationToken') as string | undefined;
    const live = registrationTokenIsLive(snap.get('registrationTokenCreatedAt'), Date.now());
    if (!token || !live || rotate === true) {
      token = randomBytes(24).toString('base64url');
      await ref.update({
        registrationToken: token,
        registrationTokenCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return { token };
  },
);
