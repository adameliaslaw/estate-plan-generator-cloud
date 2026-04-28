/**
 * functions/src/generate-documents.ts
 *
 * Batch document generation — callable Cloud Function.
 * Called when an attorney clicks "Generate Documents" in the UI.
 *
 * This is a THIN WRAPPER around the unified generator. All actual
 * generation, save, and context logic lives in unified-generator.ts.
 */

import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
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
  /** Binary version of the document (.docx fallback path). */
  _binaryBuffer?: Buffer;
  /** AI-extracted structured data (for debugging and review) */
  _extractedData?: Record<string, unknown>;
  /** Generation pipeline mode that actually produced this content. Distinct
   *  from the requested generationMode — e.g. when 'hybrid' was requested but
   *  no template was found, this resolves to 'ai'. */
  resolvedMode?: 'template' | 'hybrid' | 'ai' | 'flex';
  /** Template ID used (if any). null when AI-only path produced the doc. */
  resolvedTemplateId?: string | null;
  /** Firestore collection the template was resolved from. */
  resolvedTemplateSource?: 'documentTemplates' | 'knowledgeBase' | 'legacyTemplates' | null;
  /** softwareSource filter applied at resolution time. */
  resolvedSoftwareSource?: string | null;
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

export const generateDocuments = onCall(
  {
    timeoutSeconds: 540,
    // Bumped 1GiB → 2GiB to handle hybrid mode's 100K-char KB context
    // assembled per-doc (and batch generation processes multiple in
    // sequence with shared preloadedContext).
    memory: '2GiB',
    region: 'us-east1',
    secrets: ['VERTEX_AI_KEY'],
  },
  async (request: CallableRequest<GenerateRequest>) => {
    // ------------------------------------------------------------------
    // 1. Authentication & authorization
    // ------------------------------------------------------------------
    const auth = request.auth;
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

    const { firmId, clientId, packageType, trustTypes, generationMode = 'hybrid', modelOverride, softwareSource, formattingPreset } = request.data;

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
      // Fail fast — do not let each document independently re-run aggregateClientContext()
      // in parallel (8-doc batch = 8 simultaneous Firestore/vector calls under load).
      const msg = ctxErr instanceof Error ? ctxErr.message : String(ctxErr);
      console.error('[generateDocuments] Context pre-load failed — aborting batch:', ctxErr);
      throw new HttpsError(
        'internal',
        `Failed to load client context before generating documents: ${msg.slice(0, 200)}. ` +
        'Please try again. If the problem persists, contact support.',
      );
    }

    // ------------------------------------------------------------------
    // 4. Generate documents with bounded concurrency
    // ------------------------------------------------------------------
    // Cap simultaneous AI calls. Fortress packages with spouse expansion +
    // per-property docs can generate 20+ documents per client, each making
    // 1-2 AI calls; an unbounded fan-out hits provider rate limits, spikes
    // cost, and produces noisy retry storms. CONCURRENCY_LIMIT is a hand-
    // picked tradeoff between throughput and rate-limit headroom; tune as
    // model-side limits change.
    const allResults: UnifiedGenerateResult[] = [];
    const CONCURRENCY_LIMIT = 3;

    const settled: PromiseSettledResult<UnifiedGenerateResult[]>[] = new Array(documentsToGenerate.length);
    let nextIndex = 0;
    const worker = async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= documentsToGenerate.length) return;
        const entry = documentsToGenerate[i];
        try {
          const result = await generateDocumentWithPropertyExpansion({
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
          });
          settled[i] = { status: 'fulfilled', value: result };
        } catch (err) {
          settled[i] = { status: 'rejected', reason: err };
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY_LIMIT, documentsToGenerate.length) }, worker),
    );

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
        _contextFailed: r._contextFailed || undefined,
      })),
    };
  },
);

