/**
 * src/services/citation-verifier-service.ts
 *
 * Frontend wrapper for the verifyCitations Cloud Function.
 */

import { functions } from '@/config/firebase';
import { httpsCallable } from 'firebase/functions';

export interface CitationResult {
  raw: string;
  status: 'verified' | 'not_found' | 'error';
  caseName?: string;
  court?: string;
  dateFiled?: string;
  url?: string;
}

export interface CitationCheckResponse {
  citations: CitationResult[];
  checkedAt: string;
}

export async function verifyCitations(
  firmId: string,
  text: string,
): Promise<CitationCheckResponse> {
  const fn = httpsCallable<{ firmId: string; text: string }, CitationCheckResponse>(
    functions,
    'verifyCitations',
  );
  const result = await fn({ firmId, text });
  return result.data;
}
