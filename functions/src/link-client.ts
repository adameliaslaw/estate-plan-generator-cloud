import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';

/**
 * linkClient
 *
 * Called by the frontend right after a new client authenticates.
 * This function looks up the client's email in the specified firm's clients collection.
 * If a match is found and the client is not already linked, it updates the
 * client document with `linkedUserId` and sets custom claims on the user.
 */
export const linkClient = onCall({ region: 'us-east1' }, async (request) => {
    // Ensure the user is authenticated
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be logged in to link their account.');
    }

    const { firmId } = request.data;
    if (!firmId) {
        throw new HttpsError('invalid-argument', 'Missing firmId.');
    }

    const uid = request.auth.uid;
    const email = request.auth.token.email;

    if (!email) {
        throw new HttpsError('failed-precondition', 'User does not have an email address associated with their account.');
    }

    try {
        const db = admin.firestore();
        // In our architecture, collections are nested under the firm document, e.g., firms/{firmId}/clients
        // Instead of using COLLECTIONS from src/ (which might use client-side paths), we construct it for admin:
        const clientsRef = db.collection(`firms/${firmId}/clients`);

        // First, check if there's ALREADY a client document linked to this UID
        const existingLinkQuery = await clientsRef.where('linkedUserId', '==', uid).limit(1).get();
        if (!existingLinkQuery.empty) {
            logger.info(`[linkClient] User ${uid} is already linked to client ${existingLinkQuery.docs[0].id}`);
            return { success: true, clientId: existingLinkQuery.docs[0].id, alreadyLinked: true };
        }

        // Attempt to find a client document directly by email
        const emailQuery = await clientsRef.where('personalInfo.email', '==', email).limit(1).get();

        let clientDoc;
        let isNewClient = false;

        if (emailQuery.empty) {
            logger.info(`[linkClient] No unlinked client found for email ${email}. Auto-creating new prospect record.`);

            // Auto-create a new client record with the "prospect" status
            const newClientData = {
                status: 'prospect',
                linkedUserId: uid,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                personalInfo: {
                    email: email,
                    // If the user signed up via Google, they might have a name.
                    // We can attempt to parse it from the token's name claim if present.
                    firstName: request.auth.token.name ? request.auth.token.name.split(' ')[0] : '',
                    lastName: request.auth.token.name ? request.auth.token.name.split(' ').slice(1).join(' ') : '',
                },
                questionnaireProgress: {
                    status: 'not_started',
                    lastUpdatedBy: 'System (Auto-Created)',
                    lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
                },
                documents: [],
            };

            const docRef = await clientsRef.add(newClientData);
            clientDoc = await docRef.get();
            isNewClient = true;
        } else {
            clientDoc = emailQuery.docs[0];
        }
        const clientData = clientDoc.data() || {};

        // If the client's linkedUserId is already set to someone else, we shouldn't steal it
        // Wait, if it's set to themselves, we handled that above. If it's set to someone else, that's a security risk to overwrite.
        if (clientData.linkedUserId && clientData.linkedUserId !== uid) {
            throw new HttpsError('permission-denied', 'This client record is already linked to another account.');
        }

        const clientId = clientDoc.id;

        // 1. Update the Client document with the linkedUserId (if not newly created)
        if (!isNewClient) {
            await clientDoc.ref.update({
                linkedUserId: uid,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }

        // 2. Assign custom claims to the Firebase Auth User
        await admin.auth().setCustomUserClaims(uid, {
            role: 'client',
            firmId,
            clientId,
        });

        logger.info(`[linkClient] Successfully linked user ${uid} (${email}) to client ${clientId} (New: ${isNewClient})`);

        return { success: true, clientId, isNewClient };
    } catch (err) {
        logger.error(`[linkClient] Error linking client for uid ${uid}:`, err);
        throw new HttpsError('internal', 'An error occurred while linking the client account.');
    }
});
