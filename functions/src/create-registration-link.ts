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

const RequestSchema = z.object({
  clientId: z.string().min(1).max(200),
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
    const { clientId } = parsed.data;

    const db = admin.firestore();
    const ref = db.doc(`firms/${caller.firmId}/clients/${clientId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Client not found.');
    }

    // Reuse an already-issued token so a previously shared link keeps working;
    // mint one on first request. base64url avoids URL-unsafe characters.
    let token = snap.get('registrationToken') as string | undefined;
    if (!token) {
      token = randomBytes(24).toString('base64url');
      await ref.update({
        registrationToken: token,
        registrationTokenCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return { token };
  },
);
