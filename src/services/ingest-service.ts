/**
 * src/services/ingest-service.ts
 *
 * Thin wrapper around the ingestDocument Cloud Function.
 * Converts a File to base64 and calls the callable.
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import { fileToBase64 } from '@/utils/file-helpers';

export type IngestNamespace = 'reference' | 'work-product' | 'client-files';

interface IngestRequest {
  fileBase64: string;
  mimeType: string;
  fileName: string;
  namespace: IngestNamespace;
}

interface IngestResponse {
  docId: string;
  fileName: string;
}

const ingestDocumentFn = httpsCallable<IngestRequest, IngestResponse>(functions, 'ingestDocument');

export const NAMESPACE_LABELS: Record<IngestNamespace, string> = {
  reference:      'Reference Library',
  'work-product': 'Work Product',
  'client-files': 'Client Files',
};

export const ACCEPTED_MIME_TYPES = [
  'application/pdf',
] as const;

export async function ingestDocument(
  file: File,
  namespace: IngestNamespace,
): Promise<IngestResponse> {
  const fileBase64 = await fileToBase64(file);
  const result = await ingestDocumentFn({
    fileBase64,
    mimeType: file.type,
    fileName: file.name,
    namespace,
  });
  return result.data;
}

