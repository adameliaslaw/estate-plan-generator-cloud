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
import { z } from 'zod';
import {
  generateDocumentWithPropertyExpansion,
  getDocTypeDisplayName,
  UnifiedGenerateResult,
} from './unified-generator';
import { aggregateClientContext } from './client-context-aggregator';
import {
  DocxTemplateMapping,
  fillDocxForEntry,
  loadDocxTemplateMap,
  planHighFidelityEntry,
} from './docx-package-fill';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const GenerateRequestSchema = z.object({
  firmId: z.string().min(1),
  clientId: z.string().min(1),
  packageType: z.enum(['foundation', 'guardian', 'fortress']),
  trustTypes: z.array(z.string()).optional(),
  generationMode: z.enum(['template', 'ai', 'hybrid', 'high-fidelity']).optional(),
  /** Optional model override (e.g. 'gpt-5.6', 'claude-sonnet-5') */
  modelOverride: z.string().optional(),
  /** Optional software source filter for template selection */
  softwareSource: z.string().optional(),
  /** Formatting preset — controls paragraph styling in exports (e.g. 'interactivelegal') */
  formattingPreset: z.string().optional(),
});

type GenerateRequest = z.infer<typeof GenerateRequestSchema>;

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
  resolvedTemplateSource?: 'documentTemplates' | 'knowledgeBase' | 'legacyTemplates' | 'bundled' | null;
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

    const parsed = GenerateRequestSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        `Invalid request: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
    }
    // Default 'template' — matches generateSingleDocument and the frontend
    // selectors, so an omitted mode behaves the same on every entry point.
    const { firmId, clientId, packageType, trustTypes, generationMode = 'template', modelOverride, softwareSource, formattingPreset } = parsed.data;

    // Verify caller belongs to this firm
    const callerFirmId = auth.token.firmId as string | undefined;
    if (!callerFirmId || callerFirmId !== firmId) {
      throw new HttpsError(
        'permission-denied',
        'You can only generate documents for clients in your own firm.',
      );
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
    // 3b. High-fidelity mode: load the firm's docType → .docx mapping once.
    //     Mapped, non-property entries fill the firm's real template;
    //     everything else falls back to 'template' mode with a warning on
    //     the generated document (per-doc generationMode keeps the mixed
    //     run honest). A missing/empty map degrades the WHOLE run to
    //     template-mode fallbacks rather than failing the package.
    // ------------------------------------------------------------------
    let docxMap: Map<string, DocxTemplateMapping> | null = null;
    // Mode the normal pipeline runs in: unchanged for template/ai/hybrid;
    // 'template' for high-fidelity fallback entries.
    const pipelineMode = generationMode === 'high-fidelity' ? 'template' : generationMode;
    if (generationMode === 'high-fidelity') {
      try {
        docxMap = await loadDocxTemplateMap(firmId);
      } catch (mapErr) {
        console.warn('[generateDocuments] docxTemplateMap load failed — all entries fall back to template mode:', mapErr);
        docxMap = new Map();
      }
      console.log(`[generateDocuments] high-fidelity mode: ${docxMap.size} docType mapping(s) configured`);
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
          // High-fidelity branch: fill the mapped .docx; unmapped/per-property
          // entries run the normal pipeline in 'template' mode with the
          // fallback reason attached as a document warning.
          const hfPlan = docxMap ? planHighFidelityEntry(entry.docType, docxMap) : null;
          if (docxMap && hfPlan?.action === 'fill') {
            const result = await fillDocxForEntry({
              firmId,
              clientId,
              docType: entry.docType,
              spouseRole: entry.spouseRole,
              mapping: docxMap.get(entry.docType)!,
              createdBy: auth.uid,
              preloadedContext,
            });
            settled[i] = { status: 'fulfilled', value: [result] };
          } else {
            const result = await generateDocumentWithPropertyExpansion({
              firmId,
              clientId,
              docType: entry.docType,
              generationMode: pipelineMode,
              softwareSource,
              formattingPreset,
              trustTypes,
              createdBy: auth.uid,
              triggerSource: 'batch',
              modelOverride,
              preloadedContext,
              spouseRole: entry.spouseRole,
              packageType,
              extraWarnings: hfPlan?.fallbackReason ? [hfPlan.fallbackReason] : undefined,
            });
            settled[i] = { status: 'fulfilled', value: result };
          }
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
    // Bookkeeping — best-effort. The documents are already generated and saved;
    // a failure updating the client record must not throw and report the whole
    // batch as failed (finding AE).
    try {
      await db.doc(`firms/${firmId}/clients/${clientId}`).update({
        documentsGenerated: true,
        'packageDetails.packageType': packageType,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: auth.uid,
      });
    } catch (updateErr) {
      console.error('[generateDocuments] Non-fatal: client record update failed:', updateErr);
    }

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
      // Honest outcome: only a clean run (no per-doc errors) is success.
      // Counts below let the caller render partial results (finding E/AE).
      success: errorCount === 0,
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

