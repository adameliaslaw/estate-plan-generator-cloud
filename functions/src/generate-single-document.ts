/**
 * functions/src/generate-single-document.ts
 *
 * Callable Cloud Function to regenerate a single document for a client.
 * Used when an attorney wants to re-run generation for one document type
 * (e.g., after correcting client data, or with custom instructions).
 *
 * This is a THIN WRAPPER around the unified generator. All actual
 * generation, save, and context logic lives in unified-generator.ts.
 */

import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

import { GenerationMode } from './template-engine';
import { generateDocument } from './unified-generator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GenerateSingleRequest {
  firmId: string;
  clientId: string;
  docType: string;
  /** Optional: for deed / affidavit / gitRep3, specify which property index (0-based) */
  propertyIndex?: number;
  /** Optional custom instructions appended to the AI prompt */
  customInstructions?: string;
  trustTypes?: string[];
  /** Generation mode: template, ai, or hybrid */
  generationMode?: GenerationMode;
  /** Specific template variant ID to use */
  templateId?: string;
  /** Preferred software source for template selection */
  softwareSource?: string;
  /** Formatting preset — controls paragraph styling in exports (e.g. 'interactivelegal') */
  formattingPreset?: string;
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const generateSingleDocument = onCall(
  {
    timeoutSeconds: 300,
    memory: '512MiB',
    region: 'us-east1',
  },
  async (request: CallableRequest<GenerateSingleRequest>) => {
    // ------------------------------------------------------------------
    // 1. Auth check
    // ------------------------------------------------------------------
    const auth = request.auth;
    if (!auth) {
      throw new HttpsError('unauthenticated', 'You must be logged in to generate documents.');
    }

    const role = auth.token.role as string | undefined;
    if (!role || !['admin', 'attorney', 'paralegal'].includes(role)) {
      throw new HttpsError(
        'permission-denied',
        'Only attorneys, paralegals, and administrators can generate documents.',
      );
    }

    const { firmId, clientId, docType, propertyIndex, customInstructions, trustTypes, generationMode = 'template', templateId, softwareSource, formattingPreset } =
      request.data as GenerateSingleRequest;

    if (!firmId || !clientId || !docType) {
      throw new HttpsError('invalid-argument', 'firmId, clientId, and docType are required.');
    }

    // Verify caller is in the same firm
    if (role !== 'admin') {
      const callerFirmId = auth.token.firmId as string | undefined;
      if (callerFirmId && callerFirmId !== firmId) {
        throw new HttpsError('permission-denied', 'Cross-firm document generation is not permitted.');
      }
    }

    console.log(
      `[generateSingleDocument] docType=${docType} client=${clientId} firmId=${firmId} propertyIndex=${propertyIndex}`,
    );

    // ------------------------------------------------------------------
    // 2. Generate via unified generator
    // ------------------------------------------------------------------
    try {
      const result = await generateDocument({
        firmId,
        clientId,
        docType,
        generationMode,
        customInstructions,
        softwareSource,
        formattingPreset,
        propertyIndex,
        templateId,
        trustTypes,
        createdBy: auth.uid,
        triggerSource: 'single',
      });

      // Update client's updatedAt
      await admin.firestore().doc(`firms/${firmId}/clients/${clientId}`).update({
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: auth.uid,
      });

      console.log(`[generateSingleDocument] Saved ${result.docId} (version ${result.currentVersion})`);

      return {
        success: true,
        docId: result.docId,
        docType: result.docType,
        title: result.title,
        status: result.status,
        version: result.currentVersion,
      };
    } catch (error) {
      console.error(`[generateSingleDocument] Generation error for ${docType}:`, error);
      throw new HttpsError(
        'internal',
        `Failed to generate ${docType}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  },
);
