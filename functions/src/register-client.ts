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
 * If `anonymousUid` is supplied (from a Firebase Anonymous Auth session the
 * client signed into on the register page), it is stored as `linkedUserId` on
 * the client document. This allows the anonymous session to read and write the
 * client's Firestore record directly via the "linked session" Firestore rules.
 *
 * No authentication required — this is deliberately public.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const registerClientFromLink = onCall(
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request) => {
    const data = request.data as {
      firmId?: unknown;
      email?: unknown;
      firstName?: unknown;
      lastName?: unknown;
      anonymousUid?: unknown;
    };

    const firmId = typeof data.firmId === 'string' ? data.firmId.trim() : '';
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    const firstName = typeof data.firstName === 'string' ? data.firstName.trim() : '';
    const lastName = typeof data.lastName === 'string' ? data.lastName.trim() : '';
    const anonymousUid = typeof data.anonymousUid === 'string' ? data.anonymousUid.trim() : '';

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
      const ref = clientsCol.doc();
      await ref.set({
        firmId,
        personalInfo: { firstName, lastName, email },
        ...(anonymousUid ? { linkedUserId: anonymousUid } : {}),
        status: 'prospect',
        isArchived: false,
        questionnaireProgress: {
          status: 'not_started',
          completedSections: [],
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
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

      // The record is already linked to a DIFFERENT anonymous session. Email is
      // not a verified identity here (anonymous registration), so silently
      // overwriting the link would hand this visitor someone else's record — the
      // account-hijack path. Instead, give the visitor their own fresh record so
      // they're never locked out, and flag the collision for staff to reconcile.
      if (existingLink && anonymousUid && existingLink !== anonymousUid) {
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
      if (anonymousUid && !existingLink) {
        await existingDoc.ref.update({
          linkedUserId: anonymousUid,
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
