import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

/**
 * Exposes a minimal, unauthenticated endpoint to fetch the firm's branding
 * (logoUrl and firmName) for the login page without compromising security.
 *
 * The Google Maps key is only returned to authenticated callers (anonymous
 * questionnaire sessions included) — the login page needs just logo/name,
 * and unauthenticated bots should not be able to enumerate firm IDs and
 * harvest the key.
 */
export const getFirmBranding = functions.region('us-east1').https.onCall(
    async (data, context) => {
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
                // Browser-side key for Google Places Autocomplete in the
                // questionnaire (runs under anonymous auth). Keep the key
                // HTTP-referrer-restricted in GCP Console as defense in depth.
                googleMapsApiKey: context.auth
                    ? (firmData.settings?.googleMapsApiKey || null)
                    : null,
            };
        } catch (error) {
            console.error('[getFirmBranding] Error fetching branding:', error);
            throw new functions.https.HttpsError('internal', 'Unable to fetch branding');
        }
    }
);
