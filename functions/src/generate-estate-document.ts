import * as functions from 'firebase-functions/v1';
import { generateDocument } from './unified-generator';

/**
 * Cloud Function to generate an estate document (Word .docx).
 * 
 * DEPRECATED: This function is now a thin wrapper around the unified generator.
 * Use the unified generator's `generateDocument` function for all new development.
 */
export const generateEstateDocument = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '1GB',
  })
  .region('us-east1')
  .https.onCall(async (data: unknown, context: functions.https.CallableContext) => {
    // ── 1. Auth check ────────────────────────────────────────────────────────
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required.');
    }

    const { firmId, clientId, docType = 'will' } = data as {
      firmId?: string;
      clientId?: string;
      docType?: 'will' | 'poa' | 'hc';
    };

    if (!firmId || !clientId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'firmId and clientId are required.',
      );
    }

    if ((context.auth.token.firmId as string | undefined) !== firmId) {
      throw new functions.https.HttpsError('permission-denied', 'Cannot generate documents for a different firm.');
    }

    console.log(`[generateEstateDocument] Routing to unified generator for client ${clientId} (${docType})...`);

    try {
      const result = await generateDocument({
        firmId,
        clientId,
        docType,
        generationMode: 'template', // Default to template mode for fidelity
        createdBy: context.auth.uid,
        triggerSource: 'single',
      });

      return {
        success: true,
        docId: result.docId,
        storagePath: result.storagePath,
        displayName: result.title,
      };
    } catch (error) {
      console.error(`[generateEstateDocument] Unified generation failure:`, error);
      throw new functions.https.HttpsError(
        'internal',
        `Failed to generate ${docType}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });
