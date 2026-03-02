import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

/**
 * Returns the Google OAuth 2.0 authorization URL.
 * The frontend will redirect the user to this URL to grant calendar access.
 */
export const getGoogleAuthUrl = onCall(
    {
        region: 'us-east1',
        timeoutSeconds: 30,
        memory: '256MiB',
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'Must be logged in.');
        }

        const { redirectUri } = request.data as { redirectUri: string };
        if (!redirectUri) {
            throw new HttpsError('invalid-argument', 'redirectUri is required.');
        }

        const clientId = process.env.GOOGLE_CLIENT_ID;
        if (!clientId) {
            throw new HttpsError('internal', 'GOOGLE_CLIENT_ID is not configured on the server.');
        }

        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: 'https://www.googleapis.com/auth/calendar',
            access_type: 'offline', // Requires refresh token
            prompt: 'consent', // Forces consent screen to ensure refresh token is returned
            state: request.auth.uid, // Tie the request to the user
        });

        return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
    },
);

/**
 * Exchanges the OAuth 2.0 authorization code for access and refresh tokens
 * and saves them to the firm's Firestore document.
 */
export const exchangeGoogleAuthCode = onCall(
    {
        region: 'us-east1',
        timeoutSeconds: 60,
        memory: '256MiB',
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError('unauthenticated', 'Must be logged in.');
        }

        const { code, redirectUri, firmId } = request.data as { code: string; redirectUri: string; firmId: string };

        if (!code || !redirectUri || !firmId) {
            throw new HttpsError('invalid-argument', 'code, redirectUri, and firmId are required.');
        }

        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
            throw new HttpsError('internal', 'Google OAuth credentials not configured on the server.');
        }

        try {
            const response = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
                console.error('[exchangeGoogleAuthCode] Google token exchange failed:', errorText);
                throw new HttpsError('internal', 'Failed to exchange authorization code with Google.');
            }

            const data = (await response.json()) as any;
            const { access_token, refresh_token, expires_in } = data;

            if (!access_token) {
                throw new HttpsError('internal', 'Google returned an empty access token.');
            }

            const db = admin.firestore();

            const updateData: Record<string, any> = {
                'googleCalendar.accessToken': access_token,
                'googleCalendar.tokenExpiry': Date.now() + expires_in * 1000,
            };

            // Refresh token only returns on the first authorization (prompt=consent)
            if (refresh_token) {
                updateData['googleCalendar.refreshToken'] = refresh_token;
            }

            await db.collection('firms').doc(firmId).update(updateData);

            return { success: true };
        } catch (error) {
            console.error('[exchangeGoogleAuthCode] Error:', error);
            if (error instanceof HttpsError) throw error;
            throw new HttpsError('internal', 'An unexpected error occurred during token exchange.');
        }
    },
);
