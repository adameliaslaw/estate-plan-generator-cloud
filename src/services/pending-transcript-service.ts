/**
 * pending-transcript-service.ts
 *
 * Frontend service layer for the "Transcripts – Pending Filing" queue.
 * Reads happen directly against Firestore (staff-read rules on
 * pendingTranscripts); this service only wraps the filing callable, which is
 * the sole mutation path for that collection.
 */

import { functions } from '@/config/firebase';
import { httpsCallable } from 'firebase/functions';

export interface FileTranscriptToMatterRequest {
  transcriptId: string;
  matterId: string;
}

export interface FileTranscriptToMatterResponse {
  success: boolean;
  noteId: string;
  matterId: string;
}

export const pendingTranscriptService = {
  async fileTranscriptToMatter(
    params: FileTranscriptToMatterRequest,
  ): Promise<FileTranscriptToMatterResponse> {
    const fn = httpsCallable<FileTranscriptToMatterRequest, FileTranscriptToMatterResponse>(
      functions,
      'fileTranscriptToMatter',
    );
    const result = await fn(params);
    return result.data;
  },
};
