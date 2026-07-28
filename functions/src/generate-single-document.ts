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

import { generateDocument, generateDocumentWithPropertyExpansion } from './unified-generator';
import { fillDocxForEntry, loadDocxTemplateMap, planHighFidelityEntry } from './docx-package-fill';

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
  generationMode: z.enum(['template', 'ai', 'hybrid', 'high-fidelity']).optional(),
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
      // High-fidelity: fill the firm's mapped .docx (same plan/fallback logic
      // as the batch entry point) so subset regenerations behave identically
      // to full-package runs. Unmapped/per-property docTypes fall back to
      // template mode with the reason attached as a document warning.
      let hfFallbackReason: string | undefined;
      const effectiveMode: 'template' | 'ai' | 'hybrid' = generationMode === 'high-fidelity' ? 'template' : generationMode;
      if (generationMode === 'high-fidelity') {
        const docxMap = await loadDocxTemplateMap(firmId);
        const plan = planHighFidelityEntry(docType, docxMap);
        if (plan.action === 'fill') {
          const result = await fillDocxForEntry({
            firmId,
            clientId,
            docType,
            spouseRole,
            mapping: docxMap.get(docType)!,
            createdBy: auth.uid,
          });
          try {
            await admin.firestore().doc(`firms/${firmId}/clients/${clientId}`).update({
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedBy: auth.uid,
            });
          } catch (updateErr) {
            console.error('[generateSingleDocument] Non-fatal: client updatedAt write failed:', updateErr);
          }
          console.log(`[generateSingleDocument] Saved ${result.docId} (high-fidelity fill)`);
          return {
            success: result.status !== 'error',
            docId: result.docId,
            docType: result.docType,
            title: result.title,
            status: result.status,
            version: result.currentVersion,
          };
        }
        hfFallbackReason = plan.fallbackReason;
      }

      const genParams = {
        firmId,
        clientId,
        docType,
        generationMode: effectiveMode,
        extraWarnings: hfFallbackReason ? [hfFallbackReason] : undefined,
        customInstructions,
        softwareSource,
        formattingPreset,
        propertyIndex,
        templateId,
        trustTypes,
        spouseRole,
        createdBy: auth.uid,
        triggerSource: 'single' as const,
      };

      // For per-property docs (deed / affidavit / gitRep3) with NO explicit
      // propertyIndex, expand across every qualifying property so we write the
      // suffixed doc ids (deed_0, deed_1, …) that the batch generator uses —
      // otherwise a subset regen writes an un-suffixed `deed` that duplicates
      // rather than replaces the per-property docs (R5-070). When a specific
      // propertyIndex is passed (e.g. editor regen of one property), generate
      // just that one. generateDocumentWithPropertyExpansion returns a single
      // result for non-per-property doc types, so this path is a no-op for
      // wills/POAs/trusts/questionnaire.
      const results =
        propertyIndex !== undefined
          ? [await generateDocument(genParams)]
          : await generateDocumentWithPropertyExpansion(genParams);

      // Bookkeeping only (client updatedAt) — best-effort. A transient failure
      // here must NOT turn a successfully generated+saved document into a
      // reported failure that prompts a duplicate retry (finding A).
      try {
        await admin.firestore().doc(`firms/${firmId}/clients/${clientId}`).update({
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: auth.uid,
        });
      } catch (updateErr) {
        console.error('[generateSingleDocument] Non-fatal: client updatedAt write failed:', updateErr);
      }

      // Aggregate into the single-result response the callers expect. The
      // subset generator lists one row per selected doc type, so returning the
      // primary result (with a count hint when expanded) keeps that contract.
      const primary = results[0];
      const allOk = results.every((r) => r.status !== 'error');
      const extra = results.length - 1;

      console.log(
        `[generateSingleDocument] Saved ${results.map((r) => r.docId).join(', ')} ` +
        `(${results.length} doc${results.length === 1 ? '' : 's'})`,
      );

      // `success` must reflect the real outcome: the orchestrator returns
      // status:'error' when the vault save failed, so don't report success:true
      // and tell the attorney the doc saved when it didn't (finding E).
      return {
        success: allOk,
        docId: primary.docId,
        docType: primary.docType,
        title: extra > 0 ? `${primary.title} (+${extra} more)` : primary.title,
        status: allOk ? primary.status : 'error',
        version: primary.currentVersion,
      };
    } catch (error) {
      console.error(`[generateSingleDocument] Generation error for ${docType}:`, error);
      // Preserve meaningful HttpsError codes (not-found, failed-precondition,
      // resource-exhausted/OOM, …) instead of flattening everything to
      // 'internal', which masks the real cause (finding B).
      if (error instanceof HttpsError) throw error;
      throw new HttpsError(
        'internal',
        `Failed to generate ${docType}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  },
);
