/**
 * client-service.ts
 *
 * Frontend service layer for client-record operations that must go through a
 * Cloud Function rather than a direct Firestore write.
 */

import { functions } from '@/config/firebase';
import { httpsCallable } from 'firebase/functions';

interface CreateRegistrationLinkResponse {
  token: string;
}

export const clientService = {
  /**
   * Mint (or fetch) a per-client registration token and return the full personal
   * invite link. The client uses it to claim their own record via the
   * questionnaire register page — the generic firm link can no longer claim an
   * existing record by email (R5-010). The firm is derived server-side from the
   * caller's claim; the returned link embeds it in the route.
   */
  async getRegistrationLink(firmId: string, clientId: string, rotate = false): Promise<string> {
    const fn = httpsCallable<{ clientId: string; rotate?: boolean }, CreateRegistrationLinkResponse>(
      functions,
      'createClientRegistrationLink',
    );
    // rotate=true mints a fresh token, invalidating every previously shared
    // copy of the link (#170's revocation path).
    const result = await fn(rotate ? { clientId, rotate } : { clientId });
    const token = encodeURIComponent(result.data.token);
    return `${window.location.origin}/questionnaire/${firmId}/register?token=${token}`;
  },
};
