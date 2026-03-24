/**
 * functions/src/generate-documents.ts
 *
 * Batch document generation — callable Cloud Function.
 * Called when an attorney clicks "Generate Documents" in the UI.
 *
 * This is a THIN WRAPPER around the unified generator. All actual
 * generation, save, and context logic lives in unified-generator.ts.
 */

import * as functions from 'firebase-functions';
const { HttpsError } = functions.https;
import * as admin from 'firebase-admin';

import { GenerationMode } from './template-engine';
import {
  generateDocumentWithPropertyExpansion,
  generateBatchedSummaryDocs,
  getDocTypeDisplayName,
  UnifiedGenerateResult,
  BATCHABLE_SUMMARY_DOCS,
} from './unified-generator';
import { aggregateClientContext } from './client-context-aggregator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GenerateRequest {
  firmId: string;
  clientId: string;
  packageType: 'foundation' | 'guardian' | 'fortress';
  trustTypes?: string[];
  generationMode?: GenerationMode;
  /** Optional model override (e.g. 'gpt-5.4', 'claude-sonnet-4-6') */
  modelOverride?: string;
  /** Optional software source filter for template selection */
  softwareSource?: string;
  /** Formatting preset — controls paragraph styling in exports (e.g. 'interactivelegal') */
  formattingPreset?: string;
}

export interface GeneratedDoc {
  docType: string;
  title: string;
  content: string;
  status: 'draft' | 'error';
  propertyAddress?: string; // set for per-property docs
  propertyIndex?: number;
  /** Set to true when parseAIJson had to recover from a truncated AI response */
  _truncated?: boolean;
  /** Short hash identifying the prompt version used for generation */
  promptVersion?: string;
  /** Pre-enhancement template HTML for side-by-side comparison (hybrid mode only) */
  templateBaseline?: string;
}

// ---------------------------------------------------------------------------
// Document list per package
// ---------------------------------------------------------------------------

function getDocumentsForPackage(packageType: string): string[] {
  switch (packageType) {
    case 'foundation':
      return ['will', 'poa', 'livingWill', 'estatePlanSummary', 'actionSteps'];
    case 'guardian':
      return [
        'will',
        'poa',
        'livingWill',
        'estatePlanSummary',
        'actionSteps',
      ];
    case 'fortress':
      return [
        'trust',
        'pourOverWill',
        'poa',
        'livingWill',
        'deed',
        'affidavitOfConsideration',
        'gitRep3',
        'estatePlanSummary',
        'actionSteps',
      ];
    default:
      return ['will', 'poa', 'livingWill', 'estatePlanSummary', 'actionSteps'];
  }
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const generateDocuments = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .region('us-east1')
  .https.onCall(async (data: unknown, context: functions.https.CallableContext) => {
    // ------------------------------------------------------------------
    // 1. Authentication & authorization
    // ------------------------------------------------------------------
    const auth = context.auth;
    if (!auth) {
      throw new HttpsError('unauthenticated', 'You must be logged in to generate documents.');
    }

    const role = auth.token.role as string | undefined;
    if (!role || !['admin', 'attorney', 'paralegal'].includes(role)) {
      throw new HttpsError(
        'permission-denied',
        'Only staff members can generate estate plan documents.',
      );
    }

    const { firmId, clientId, packageType, trustTypes, generationMode = 'hybrid', modelOverride, softwareSource, formattingPreset } = data as GenerateRequest;

    if (!firmId || !clientId || !packageType) {
      throw new HttpsError(
        'invalid-argument',
        'firmId, clientId, and packageType are required.',
      );
    }

    // Verify caller belongs to this firm (unless admin)
    if (role !== 'admin') {
      const callerFirmId = auth.token.firmId as string | undefined;
      if (callerFirmId && callerFirmId !== firmId) {
        throw new HttpsError(
          'permission-denied',
          'You can only generate documents for clients in your own firm.',
        );
      }
    }

    // ------------------------------------------------------------------
    // 2. Determine document list
    // ------------------------------------------------------------------
    const documentsToGenerate = getDocumentsForPackage(packageType);

    console.log(
      `[generateDocuments] Starting generation for client=${clientId} package=${packageType} mode=${generationMode}` +
      (softwareSource ? ` software=${softwareSource}` : ''),
      `documents=[${documentsToGenerate.join(', ')}]`,
    );

    // ------------------------------------------------------------------
    // 3. Pre-load context ONCE (Phase 3 optimization)
    //    aggregateClientContext is expensive (Firestore reads + vector
    //    search). Without this, each doc generation calls it independently
    //    — 5 docs × 4 calls = 20 redundant Firestore operations.
    // ------------------------------------------------------------------
    let preloadedContext: Awaited<ReturnType<typeof aggregateClientContext>> | undefined;
    try {
      preloadedContext = await aggregateClientContext(firmId, clientId);
      console.log(`[generateDocuments] Pre-loaded context (${preloadedContext.knowledgeResources.length} KB resources, ` +
        `${preloadedContext.existingDocuments.length} existing docs, ${preloadedContext.notes.length} notes)`);
    } catch (ctxErr) {
      console.warn('[generateDocuments] Context pre-load failed, each doc will re-aggregate:', ctxErr);
    }

    // ------------------------------------------------------------------
    // 4. Partition batchable vs standard doc types (Backlog #8)
    //    Summary docs (estatePlanSummary + actionSteps) can be combined
    //    into a single AI call, halving API calls for those doc types.
    // ------------------------------------------------------------------
    // In template mode, skip summary docs entirely — they require AI calls
    // and the user explicitly chose template mode for speed. Summary/action-steps
    // docs can be generated on-demand via the "Add Document" flow.
    const isTemplateMode = generationMode === 'template';
    const batchableDocs = isTemplateMode
      ? []
      : documentsToGenerate.filter(d => (BATCHABLE_SUMMARY_DOCS as Set<string>).has(d));
    const standardDocs = isTemplateMode
      ? documentsToGenerate.filter(d => !(BATCHABLE_SUMMARY_DOCS as Set<string>).has(d))
      : documentsToGenerate.filter(d => !(BATCHABLE_SUMMARY_DOCS as Set<string>).has(d));

    const allResults: UnifiedGenerateResult[] = [];

    // 4a. Build a single promise array for ALL doc generation (batch + standard)
    //     Running everything concurrently avoids the batch summary blocking standard docs.
    const allPromises: Array<{ type: 'batch' | 'standard'; docTypes: string[]; promise: Promise<UnifiedGenerateResult[]> }> = [];

    if (batchableDocs.length >= 2) {
      console.log(`[generateDocuments] Batch-aware: combining ${batchableDocs.join(' + ')} into single AI call`);
      allPromises.push({
        type: 'batch',
        docTypes: batchableDocs,
        promise: generateBatchedSummaryDocs({
          firmId,
          clientId,
          generationMode,
          softwareSource,
          formattingPreset,
          trustTypes,
          createdBy: auth.uid,
          triggerSource: 'batch',
          modelOverride,
          preloadedContext,
        }),
      });
    } else {
      // Only 1 or 0 batchable docs — no benefit from combining, treat as standard
      standardDocs.push(...batchableDocs);
    }

    // 4b. Add standard docs as individual concurrent promises
    for (const docType of standardDocs) {
      allPromises.push({
        type: 'standard',
        docTypes: [docType],
        promise: generateDocumentWithPropertyExpansion({
          firmId,
          clientId,
          docType,
          generationMode,
          softwareSource,
          formattingPreset,
          trustTypes,
          createdBy: auth.uid,
          triggerSource: 'batch',
          modelOverride,
          preloadedContext,
        }),
      });
    }

    // 4c. Run ALL concurrently
    const settled = await Promise.allSettled(allPromises.map(p => p.promise));

    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      const entry = allPromises[i];
      if (result.status === 'fulfilled') {
        allResults.push(...result.value);
      } else {
        const label = entry.docTypes.join('+');
        console.error(`[generateDocuments] Fatal error generating ${label}:`, result.reason);
        // Create an error result for each doc type in this entry
        for (const docType of entry.docTypes) {
          allResults.push({
            docType,
            title: `Error — ${getDocTypeDisplayName(docType)}`,
            content: `<p>An unexpected error occurred while generating this document: ${result.reason instanceof Error ? result.reason.message : 'Unknown error'}</p>`,
            status: 'error',
            docId: docType,
            isNew: false,
            currentVersion: 0,
          });
        }
      }
    }

    // ------------------------------------------------------------------
    // 5. Update client record
    // ------------------------------------------------------------------
    const db = admin.firestore();
    await db.doc(`firms/${firmId}/clients/${clientId}`).update({
      documentsGenerated: true,
      'packageDetails.packageType': packageType,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: auth.uid,
    });

    const successCount = allResults.filter((r) => r.status !== 'error').length;
    const errorCount = allResults.filter((r) => r.status === 'error').length;

    console.log(
      `[generateDocuments] Completed. Generated ${allResults.length} documents ` +
      `(${successCount} succeeded, ${errorCount} errors).`,
    );

    // ------------------------------------------------------------------
    // 6. Return summary
    // ------------------------------------------------------------------
    return {
      success: true,
      documentsGenerated: successCount,
      documentsErrored: errorCount,
      results: allResults.map((r) => ({
        docType: r.docType,
        title: r.title,
        status: r.status,
        propertyAddress: r.propertyAddress,
      })),
    };
  },
  );
