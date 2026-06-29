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
import { z } from 'zod';

import { generateDocument } from './unified-generator';

// Length caps at the callable boundary (finding T9) — customPrompt feeds the AI
// prompt directly, so bound it (and the other free-form fields) to prevent
// unbounded token cost / DoS. additionalData stays a passthrough object (bounded
// by the overall callable payload limit).
const FlexDocumentSchema = z.object({
  firmId: z.string().min(1).max(200),
  clientId: z.string().min(1).max(200),
  docType: z.string().min(1).max(100),
  customPrompt: z.string().max(20_000).optional(),
  additionalData: z.record(z.string(), z.unknown()).optional(),
  generationMode: z.enum(['template', 'ai', 'hybrid']).optional(),
  templateId: z.string().max(200).optional(),
  softwareSource: z.string().max(200).optional(),
  formattingPreset: z.string().max(200).optional(),
});

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const generateFlexDocument = onCall(
  {
    timeoutSeconds: 540,
    // Bumped 1GiB → 2GiB to handle hybrid mode's 100K-char KB context.
    memory: '2GiB',
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

    const parsed = FlexDocumentSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'firmId, clientId, and docType are required (and within size limits).');
    }
    const {
      firmId,
      clientId,
      docType,
      customPrompt,
      additionalData,
      generationMode,
      templateId,
      softwareSource,
      formattingPreset,
    } = parsed.data;

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
      // Default to AI when caller didn't pick a mode — preserves prior
      // behaviour for callers that don't yet pass generationMode. When the
      // caller does opt into template/hybrid, the unified generator will
      // route through the template engine and fall back to AI if no
      // matching flex template exists.
      const result = await generateDocument({
        firmId,
        clientId,
        docType,
        generationMode: generationMode ?? 'ai',
        templateId,
        softwareSource,
        formattingPreset,
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
