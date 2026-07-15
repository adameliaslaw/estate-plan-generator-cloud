import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { enforceRegistrationRateLimit } from './register-client';

/**
 * linkClient
 *
 * Called by the frontend right after a new client authenticates.
 * This function looks up the client's email in the specified firm's clients collection.
 * If a match is found and the client is not already linked, it updates the
 * client document with `linkedUserId` and sets custom claims on the user.
 *
 * BL: claiming an EXISTING record by email match requires the auth token's
 * `email_verified` — a password sign-up with someone else's email must not be
 * able to take over their estate profile. Google / email-link sign-ins are
 * verified, and attorney invite links (registerClientFromLink token path)
 * bypass email matching entirely, so legitimate clients keep working.
 *
 * BM: prospect auto-creation checks the firm exists and draws from the same
 * per-firm rate limit as registerClientFromLink, so an authenticated script
 * can't flood a firm with stubs or mint claims for arbitrary firm ids.
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

    // If the user already has a firmId claim (already linked or is staff), they
    // may not re-link to a different firm. New clients have no firmId yet.
    const existingFirmId = request.auth.token.firmId as string | undefined;
    if (existingFirmId && existingFirmId !== firmId) {
        throw new HttpsError('permission-denied', 'Cannot link to a different firm.');
    }

    const uid = request.auth.uid;
    const rawEmail = request.auth.token.email;

    if (!rawEmail) {
        throw new HttpsError('failed-precondition', 'User does not have an email address associated with their account.');
    }

    // Match on lowercase email — registerClientFromLink and the client-import
    // flow both store personalInfo.email lowercased. Using the raw token email
    // (which may be mixed-case from an OAuth provider) would miss the existing
    // record and create a duplicate.
    const email = rawEmail.toLowerCase();

    try {
        const db = admin.firestore();

        // Verify the firm exists — otherwise this would mint custom claims for
        // an arbitrary firmId and create orphan client records (BM).
        const firmSnap = await db.doc(`firms/${firmId}`).get();
        if (!firmSnap.exists) {
            throw new HttpsError('not-found', 'Firm not found.');
        }

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

            // Bound per-firm flooding before writing a new record (BM) —
            // shares registerClientFromLink's counter.
            await enforceRegistrationRateLimit(db, firmId);

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
            // BL: an email match only proves identity when the token email is
            // verified. Password sign-ups start unverified, so without this
            // gate anyone could claim a pre-created client's estate profile by
            // signing up with their email.
            if (request.auth.token.email_verified !== true) {
                throw new HttpsError(
                    'failed-precondition',
                    'A client record already exists for this email address. Please open the invitation link your attorney sent you, or sign in with Google to verify you own this email.',
                );
            }
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
        // Preserve deliberate error codes (permission-denied, failed-precondition,
        // not-found, resource-exhausted) instead of flattening them to `internal`.
        if (err instanceof HttpsError) {
            throw err;
        }
        logger.error(`[linkClient] Error linking client for uid ${uid}:`, err);
        throw new HttpsError('internal', 'An error occurred while linking the client account.');
    }
});
