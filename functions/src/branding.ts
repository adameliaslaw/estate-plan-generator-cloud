import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

/**
 * Exposes a minimal, unauthenticated endpoint to fetch the firm's branding
 * (logoUrl and firmName) for the login page without compromising security.
 */
export const getFirmBranding = functions.region('us-east1').https.onCall(
    async () => {
        try {
            const firmsSnapshot = await admin.firestore().collection('firms').limit(1).get();
            if (firmsSnapshot.empty) {
                return null;
            }
            const firmData = firmsSnapshot.docs[0].data();
            return {
                logoUrl: firmData.logoUrl || null,
                firmName: firmData.firmName || null,
            };
        } catch (error) {
            console.error('[getFirmBranding] Error fetching branding:', error);
            throw new functions.https.HttpsError('internal', 'Unable to fetch branding');
        }
    }
);
