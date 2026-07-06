/**
 * client-service.ts
 *
 * Frontend service layer for client mutations that must run server-side.
 * `deleteClient` wraps the Admin-SDK cascade callable — the client SDK's
 * `deleteDoc` leaves a deleted client's subcollections and Storage files
 * orphaned (audit finding R5-020).
 */

import { functions } from '@/config/firebase';
import { httpsCallable } from 'firebase/functions';

export interface DeleteClientRequest {
  firmId: string;
  clientId: string;
}

export interface DeleteClientResponse {
  success: boolean;
  clientId: string;
}

export const clientService = {
  async deleteClient(params: DeleteClientRequest): Promise<DeleteClientResponse> {
    const fn = httpsCallable<DeleteClientRequest, DeleteClientResponse>(
      functions,
      'deleteClient',
    );
    const result = await fn(params);
    return result.data;
  },
};
