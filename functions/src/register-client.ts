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

    // Look for an existing client record with this email.
    const existingSnap = await db
      .collection(`firms/${firmId}/clients`)
      .where('personalInfo.email', '==', email)
      .limit(1)
      .get();

    if (!existingSnap.empty) {
      return { clientId: existingSnap.docs[0].id, isNew: false };
    }

    // Create a new prospect stub so the client can fill in the questionnaire.
    const newRef = db.collection(`firms/${firmId}/clients`).doc();
    await newRef.set({
      firmId,
      personalInfo: {
        firstName,
        lastName,
        email,
      },
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
    });

    return { clientId: newRef.id, isNew: true };
  },
);
