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
import { z } from 'zod';

import { generateDocument } from './unified-generator';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const GenerateSingleRequestSchema = z.object({
  firmId: z.string().min(1),
  clientId: z.string().min(1),
  docType: z.string().min(1),
  /** Optional: for deed / affidavit / gitRep3, specify which property index (0-based) */
  propertyIndex: z.number().int().min(0).optional(),
  /** Optional custom instructions appended to the AI prompt */
  customInstructions: z.string().max(10000).optional(),
  trustTypes: z.array(z.string()).optional(),
  /** Generation mode: template, ai, or hybrid */
  generationMode: z.enum(['template', 'ai', 'hybrid']).optional(),
  /** Specific template variant ID to use */
  templateId: z.string().optional(),
  /** Preferred software source for template selection */
  softwareSource: z.string().optional(),
  /** Formatting preset — controls paragraph styling in exports (e.g. 'interactivelegal') */
  formattingPreset: z.string().optional(),
  /** Whose document is this — the client (testator), or their spouse?
   *  Defaults to 'client'. When 'spouse', the unified generator swaps
   *  testator/spouse identities so e.g. the will is generated FOR the
   *  spouse using the same client doc as the data source. The saved
   *  document gets a `_spouse` suffix to distinguish it. */
  spouseRole: z.enum(['client', 'spouse']).optional(),
});

type GenerateSingleRequest = z.infer<typeof GenerateSingleRequestSchema>;

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const generateSingleDocument = onCall(
  {
    // Hybrid mode with full RAG can run 3-5 min for the AI augmentation
    // step (100K char KB context + 32K maxTokens output). Old 300s cap
    // killed the function mid-AI-call; 540s = max for callable functions.
    timeoutSeconds: 540,
    // Hybrid prompt assembly + AI response handling holds the full prompt
    // text in memory (100K chars KB + template + system prompt + response).
    // 512Mi was tight; bumped to 2GiB to give headroom.
    memory: '2GiB',
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

    const parsed = GenerateSingleRequestSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        `Invalid request: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
    }
    const { firmId, clientId, docType, propertyIndex, customInstructions, trustTypes, generationMode = 'template', templateId, softwareSource, formattingPreset, spouseRole } =
      parsed.data;

    const role = auth.token.role as string | undefined;
    const isStaff = role && ['admin', 'attorney', 'paralegal'].includes(role);
    const isClient = role === 'client';

    if (!isStaff && !(isClient && docType === 'questionnaire')) {
      throw new HttpsError(
        'permission-denied',
        'Only staff members can generate legal documents. Clients can only vault their questionnaire summary.',
      );
    }

    // Verify client access
    if (isClient && auth.uid !== clientId) {
      throw new HttpsError('permission-denied', 'You can only vault your own questionnaire.');
    }

    // Verify caller is in the same firm
    const callerFirmId = auth.token.firmId as string | undefined;
    if (!callerFirmId || callerFirmId !== firmId) {
      throw new HttpsError('permission-denied', 'Cross-firm document generation is not permitted.');
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
        spouseRole,
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
