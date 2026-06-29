import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}
import * as admin from 'firebase-admin';
import { assertStaff } from './auth-guards';

export const exchangeGoogleAuthCode = onCall(
    {
        region: 'us-east1',
        timeoutSeconds: 60,
        memory: '512MiB',
        secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    },
    async (request: CallableRequest<unknown>) => {
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'Must be logged in to connect Google Calendar.');
        }
        assertStaff(request);

        const { code, redirectUri, firmId } = request.data as { code: string; redirectUri: string; firmId: string };

        if (!code || !firmId) {
            throw new HttpsError('invalid-argument', 'Authorization code and firmId are required.');
        }

        if (request.auth.token['firmId'] !== firmId) {
            throw new HttpsError('permission-denied', 'Cannot update Google credentials for a different firm.');
        }

        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            console.error('[exchangeGoogleAuthCode] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in Secret Manager.');
            throw new HttpsError('internal', 'Google OAuth credentials missing on the server. Please check your Secret Manager.');
        }

        try {
            const response = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    code,
                    client_id: clientId,
                    client_secret: clientSecret,
                    redirect_uri: redirectUri,
                    grant_type: 'authorization_code',
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[exchangeGoogleAuthCode] Google API Error:', errorText);
                throw new Error(`Google API responded with ${response.status}`);
            }

            const tokenData = (await response.json()) as GoogleTokenResponse;

            if (!tokenData.refresh_token) {
                throw new HttpsError(
                    'permission-denied',
                    'No refresh token received. You may need to disconnect the app from your Google Account permissions and try again.',
                );
            }

            const db = admin.firestore();
            const newExpiry = Date.now() + (tokenData.expires_in ?? 3600) * 1000;

            await db.doc(`firms/${firmId}`).update({
                'googleCalendar.connected': true,
                'googleCalendar.accessToken': tokenData.access_token,
                'googleCalendar.refreshToken': tokenData.refresh_token,
                'googleCalendar.tokenExpiry': newExpiry,
                'updatedBy': request.auth.uid,
                'updatedAt': admin.firestore.FieldValue.serverTimestamp()
            });

            return { success: true };
        } catch (error: unknown) {
            console.error('[exchangeGoogleAuthCode] Error exchanging token:', error);
            if (error instanceof HttpsError) throw error;
            const errMsg = error instanceof Error ? error.message : String(error);
            throw new HttpsError('internal', `Failed to exchange auth token: ${errMsg}`);
        }
    }
);
