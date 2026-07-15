import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

/**
 * Exposes a minimal, unauthenticated endpoint to fetch the firm's branding
 * (logoUrl and firmName) for the login page without compromising security.
 *
 * The Google Maps key is only returned to callers who belong to the firm
 * (BK): staff/linked clients via their `firmId` claim, or anonymous
 * questionnaire sessions via a client record linked to their uid (they have
 * no custom claims). The login page needs just logo/name, and neither
 * unauthenticated bots nor unrelated authenticated users should be able to
 * enumerate firm IDs and harvest another firm's key.
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

            // Browser-side key for Google Places Autocomplete in the
            // questionnaire (runs under anonymous auth). Keep the key
            // HTTP-referrer-restricted in GCP Console as defense in depth.
            let includeMapsKey = false;
            if (context.auth) {
                if (context.auth.token.firmId === targetFirmId) {
                    includeMapsKey = true;
                } else {
                    // Anonymous questionnaire sessions carry no claims — they
                    // are authorized by the client record linked to their uid.
                    const linked = await admin.firestore()
                        .collection(`firms/${targetFirmId}/clients`)
                        .where('linkedUserId', '==', context.auth.uid)
                        .limit(1)
                        .get();
                    includeMapsKey = !linked.empty;
                }
            }

            return {
                logoUrl: firmData.logoUrl || null,
                firmName: firmData.firmName || null,
                googleMapsApiKey: includeMapsKey
                    ? (firmData.settings?.googleMapsApiKey || null)
                    : null,
            };
        } catch (error) {
            console.error('[getFirmBranding] Error fetching branding:', error);
            throw new functions.https.HttpsError('internal', 'Unable to fetch branding');
        }
    }
);
