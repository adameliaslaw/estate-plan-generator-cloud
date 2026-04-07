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
  getDocTypeDisplayName,
  UnifiedGenerateResult,
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
  /** Binary version of the document (for high-fidelity .docx generation) */
  _binaryBuffer?: Buffer;
  /** AI-extracted structured data (for debugging and review) */
  _extractedData?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Document list per package
// ---------------------------------------------------------------------------

function getDocumentsForPackage(packageType: string): string[] {
  switch (packageType) {
    case 'foundation':
      return ['will', 'poa', 'livingWill', 'estatePlanSummary'];
    case 'guardian':
      return [
        'trust',
        'pourOverWill',
        'poa',
        'livingWill',
        'estatePlanSummary',
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
      ];
    default:
      return ['will', 'poa', 'livingWill', 'estatePlanSummary'];
  }
}

// ---------------------------------------------------------------------------
// Per-spouse doc types — each spouse gets their own copy
// Joint/shared docs (trust, deed, affidavit, gitRep3, estatePlanSummary)
// only generate once for the couple.
// ---------------------------------------------------------------------------

const PER_SPOUSE_DOC_TYPES = new Set(['poa', 'livingWill', 'will', 'pourOverWill']);

/** Determine if this client is in a living marriage/domestic partnership */
function isMarriedCouple(clientData: admin.firestore.DocumentData): boolean {
  const status = clientData.personalInfo?.maritalStatus;
  return status === 'Married' || status === 'Domestic Partnership';
}

interface DocGenEntry {
  docType: string;
  spouseRole?: 'client' | 'spouse';
}

/**
 * Expand the base document list for married couples.
 * Per-spouse doc types get duplicated (one for each spouse).
 * Joint docs remain as-is.
 */
function expandForMarriedCouple(
  baseDocs: string[],
  married: boolean,
): DocGenEntry[] {
  if (!married) {
    return baseDocs.map(docType => ({ docType }));
  }

  const entries: DocGenEntry[] = [];
  for (const docType of baseDocs) {
    if (PER_SPOUSE_DOC_TYPES.has(docType)) {
      entries.push({ docType, spouseRole: 'client' });
      entries.push({ docType, spouseRole: 'spouse' });
    } else {
      entries.push({ docType });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const generateDocuments = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB', secrets: ['VERTEX_AI_KEY'] })
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
    // 2. Determine document list (with married-couple expansion)
    // ------------------------------------------------------------------
    const baseDocs = getDocumentsForPackage(packageType);

    // Fetch client data to check marital status for spouse expansion
    const db = admin.firestore();
    const clientSnap = await db.doc(`firms/${firmId}/clients/${clientId}`).get();
    if (!clientSnap.exists) {
      throw new HttpsError('not-found', `Client ${clientId} not found.`);
    }
    const clientData = clientSnap.data()!;
    const married = isMarriedCouple(clientData);
    const documentsToGenerate = expandForMarriedCouple(baseDocs, married);

    console.log(
      `[generateDocuments] Starting generation for client=${clientId} package=${packageType} mode=${generationMode}` +
      ` married=${married}` +
      (softwareSource ? ` software=${softwareSource}` : ''),
      `documents=[${documentsToGenerate.map(e => e.spouseRole ? `${e.docType}(${e.spouseRole})` : e.docType).join(', ')}]`,
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
    // 4. Generate all documents concurrently
    // ------------------------------------------------------------------
    const allResults: UnifiedGenerateResult[] = [];

    const allPromises = documentsToGenerate.map(entry =>
      generateDocumentWithPropertyExpansion({
        firmId,
        clientId,
        docType: entry.docType,
        generationMode,
        softwareSource,
        formattingPreset,
        trustTypes,
        createdBy: auth.uid,
        triggerSource: 'batch',
        modelOverride,
        preloadedContext,
        spouseRole: entry.spouseRole,
      }),
    );

    const settled = await Promise.allSettled(allPromises);

    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      const entry = documentsToGenerate[i];
      if (result.status === 'fulfilled') {
        allResults.push(...result.value);
      } else {
        console.error(`[generateDocuments] Fatal error generating ${entry.docType}:`, result.reason);
        const spouseSuffix = entry.spouseRole === 'spouse' ? '_spouse' : '';
        allResults.push({
          docType: entry.docType,
          title: `Error — ${getDocTypeDisplayName(entry.docType)}${entry.spouseRole === 'spouse' ? ' (Spouse)' : ''}`,
          content: `<p>An unexpected error occurred while generating this document: ${result.reason instanceof Error ? result.reason.message : 'Unknown error'}</p>`,
          status: 'error',
          docId: `${entry.docType}${spouseSuffix}`,
          isNew: false,
          currentVersion: 0,
        });
      }
    }

    // ------------------------------------------------------------------
    // 5. Update client record
    // ------------------------------------------------------------------
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
