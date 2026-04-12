import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

/**
 * Exposes a minimal, unauthenticated endpoint to fetch the firm's branding
 * (logoUrl and firmName) for the login page without compromising security.
 */
export const getFirmBranding = functions.region('us-east1').https.onCall(
    async (data) => {
        try {
            // Default to 'elias-counsel' or use provided firmId
            const targetFirmId = data?.firmId || 'elias-counsel';
            const firmDoc = await admin.firestore().collection('firms').doc(targetFirmId).get();

            if (!firmDoc.exists) {
                return null;
            }
            const firmData = firmDoc.data()!;
            return {
                logoUrl: firmData.logoUrl || null,
                firmName: firmData.firmName || null,
                googleMapsApiKey: firmData.settings?.googleMapsApiKey || null,
            };
        } catch (error) {
            console.error('[getFirmBranding] Error fetching branding:', error);
            throw new functions.https.HttpsError('internal', 'Unable to fetch branding');
        }
    }
);
