/**
 * functions/src/generate-flex-document.ts
 *
 * Callable Cloud Function for flexible / ancillary document generation.
 * Handles document types beyond the core estate plan package:
 *
 *  - engagementLetter, coverLetter, invoice, certificationOfTrust,
 *    beneficiaryDesignation, trustAmendment, trustRestatement, petTrust,
 *    letterOfInstruction, memorandumOfPersonalProp, codicil, hipaaRelease, custom
 *
 * This is a THIN WRAPPER around the unified generator. All actual
 * generation, save, and context logic lives in unified-generator.ts.
 * The flex-specific system prompts live in flex-prompts.ts.
 */

import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';

import { generateDocument } from './unified-generator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FlexDocumentRequest {
  firmId: string;
  clientId: string;
  docType: string;
  /** Free-form additional instructions for the AI */
  customPrompt?: string;
  /** Additional data for specific doc types (e.g., amendment text) */
  additionalData?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const generateFlexDocument = onCall(
  {
    timeoutSeconds: 540,
    memory: '1GiB',
    region: 'us-east1',
  },
  async (request: CallableRequest<unknown>) => {
    // ------------------------------------------------------------------
    // 1. Auth check
    // ------------------------------------------------------------------
    const auth = request.auth;
    if (!auth) {
      throw new HttpsError('unauthenticated', 'You must be logged in.');
    }

    const role = auth.token.role as string | undefined;
    if (!role || !['admin', 'attorney', 'paralegal'].includes(role)) {
      throw new HttpsError('permission-denied', 'Insufficient permissions.');
    }

    const { firmId, clientId, docType, customPrompt, additionalData } =
      request.data as FlexDocumentRequest;

    if (!firmId || !clientId || !docType) {
      throw new HttpsError('invalid-argument', 'firmId, clientId, and docType are required.');
    }

    // Verify firm access
    const callerFirmId = auth.token.firmId as string | undefined;
    if (!callerFirmId || callerFirmId !== firmId) {
      throw new HttpsError('permission-denied', 'Cross-firm generation is not permitted.');
    }

    console.log(`[generateFlexDocument] docType=${docType} client=${clientId}`);

    // ------------------------------------------------------------------
    // 2. Generate via unified generator
    // ------------------------------------------------------------------
    try {
      const result = await generateDocument({
        firmId,
        clientId,
        docType,
        generationMode: 'ai', // Flex docs are AI-only (no templates yet)
        customPrompt,
        additionalData,
        createdBy: auth.uid,
        triggerSource: 'flex',
      });

      console.log(`[generateFlexDocument] Saved ${result.docId}`);

      return {
        success: true,
        docId: result.docId,
        docType: result.docType,
        title: result.title,
        status: result.status,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : '';
      console.error(`[generateFlexDocument] FAILED for ${docType}:`, {
        message: errMsg,
        stack: errStack,
        firmId,
        clientId,
        docType,
      });
      throw new HttpsError(
        'internal',
        `Failed to generate ${docType}: ${errMsg}`,
      );
    }
  },
);
