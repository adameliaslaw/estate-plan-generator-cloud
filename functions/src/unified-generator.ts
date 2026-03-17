/**
 * functions/src/unified-generator.ts
 *
 * Unified document generation pipeline — the SINGLE source of truth for all
 * document generation in the application.
 *
 * Every generation path (batch, single, flex, chat draft) calls this module's
 * `generateDocument()` function. This eliminates:
 *   - Duplicated generator dispatch logic (was in generate-documents.ts AND generate-single-document.ts)
 *   - Siloed flex generation (was in generate-flex-document.ts with its own context/save)
 *   - Double-generation in chat drafts (was in chat-ai.ts with fragile response parsing)
 *
 * The function always:
 *   1. Aggregates full client context via `aggregateClientContext`
 *   2. Resolves the generator from a registry (no switch statements)
 *   3. Routes through the template engine when appropriate
 *   4. Saves via the shared `saveDocumentToVault` helper
 *   5. Records draft history for AI learning
 */

import * as admin from 'firebase-admin';
import { GeneratedDoc } from './generate-documents';
import { generateFromTemplate, GenerationMode } from './template-engine';
import { aggregateClientContext, ClientContext } from './client-context-aggregator';
import { saveDocumentToVault, SaveDocumentResult } from './document-save-helper';
import { recordDraftHistory } from './ai-memory';
import { sanitizeForPrompt } from './ai-client';

// Individual generators
import { generateWill } from './generators/will-generator';
import { generatePourOverWill } from './generators/pour-over-will-generator';
import { generatePOA } from './generators/poa-generator';
import { generateAdvanceDirective } from './generators/advance-directive-generator';
import { generateTrust } from './generators/trust-generator';
import { generateDeed } from './generators/deed-generator';
import { generateAffidavitOfConsideration } from './generators/affidavit-generator';
import { generateGitRep3 } from './generators/git-rep3-generator';
import { generateEstatePlanSummary } from './generators/summary-generator';
import { generateActionSteps } from './generators/action-steps-generator';

// Flex document generation (AI-based with doc-type-specific prompts)
import { generateFlexAI } from './flex-prompts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UnifiedGenerateParams {
  firmId: string;
  clientId: string;
  docType: string;
  /** Generation mode — defaults to 'hybrid' */
  generationMode?: GenerationMode;
  /** Additional instructions appended to the AI prompt */
  customInstructions?: string;
  /** Preferred software source for template selection */
  softwareSource?: string;
  /** For per-property docs (deed, affidavit, gitRep3) — which property (0-based) */
  propertyIndex?: number;
  /** Specific template ID to use */
  templateId?: string;
  /** Trust types  */
  trustTypes?: string[];
  /** Who triggered the generation (uid) */
  createdBy: string;
  /** How this generation was triggered */
  triggerSource?: 'batch' | 'single' | 'flex' | 'chat-draft';
  /** Custom prompt for flex/custom docs */
  customPrompt?: string;
  /** Additional data for flex docs */
  additionalData?: Record<string, unknown>;
  /** Model override */
  modelOverride?: string;
  /** Pre-loaded client context — skips redundant aggregation when caller already has it */
  preloadedContext?: ClientContext;
}

export interface UnifiedGenerateResult {
  docType: string;
  title: string;
  content: string;
  status: 'draft' | 'error';
  docId: string;
  isNew: boolean;
  currentVersion: number;
  propertyAddress?: string;
  propertyIndex?: number;
}

// ---------------------------------------------------------------------------
// Generator registry — replaces both switch statements
// ---------------------------------------------------------------------------

/** Signature shared by all standard generators */
type StandardGeneratorFn = (
  clientData: admin.firestore.DocumentData,
  firmData: admin.firestore.DocumentData,
  packageType: string,
  trustTypes?: string[],
  property?: admin.firestore.DocumentData,
) => Promise<GeneratedDoc>;

const STANDARD_GENERATORS: Record<string, StandardGeneratorFn> = {
  will: generateWill,
  pourOverWill: generatePourOverWill,
  poa: generatePOA,
  livingWill: generateAdvanceDirective,
  trust: generateTrust,
  deed: generateDeed,
  affidavitOfConsideration: generateAffidavitOfConsideration,
  gitRep3: generateGitRep3,
  estatePlanSummary: generateEstatePlanSummary,
  actionSteps: generateActionSteps,
};

/** Flex doc types — generated via AI with doc-type-specific system prompts */
const FLEX_DOC_TYPES = new Set([
  'engagementLetter',
  'coverLetter',
  'invoice',
  'certificationOfTrust',
  'beneficiaryDesignation',
  'trustAmendment',
  'trustRestatement',
  'petTrust',
  'letterOfInstruction',
  'memorandumOfPersonalProp',
  'codicil',
  'hipaaRelease',
  'custom',
]);

/** Per-property doc types that generate one document per qualifying property */
const PER_PROPERTY_DOCS = new Set(['deed', 'affidavitOfConsideration', 'gitRep3']);

// ---------------------------------------------------------------------------
// Display name lookup
// ---------------------------------------------------------------------------

const DOC_TYPE_DISPLAY_NAMES: Record<string, string> = {
  will: 'Last Will and Testament',
  pourOverWill: 'Pour-Over Will',
  poa: 'Durable Power of Attorney',
  livingWill: 'Advance Directive for Health Care',
  trust: 'Revocable Living Trust',
  deed: 'Deed',
  affidavitOfConsideration: 'Affidavit of Consideration',
  gitRep3: 'GIT/REP-3 Exemption Certificate',
  estatePlanSummary: 'Estate Plan Summary',
  actionSteps: 'Action Steps Checklist',
  engagementLetter: 'Engagement Letter',
  coverLetter: 'Cover Letter',
  invoice: 'Invoice',
  certificationOfTrust: 'Certification of Trust',
  beneficiaryDesignation: 'Beneficiary Designation Letter',
  trustAmendment: 'Trust Amendment',
  trustRestatement: 'Trust Restatement',
  petTrust: 'Pet Trust',
  letterOfInstruction: 'Letter of Instruction',
  memorandumOfPersonalProp: 'Memorandum of Personal Property',
  codicil: 'Codicil',
  hipaaRelease: 'HIPAA Authorization',
  custom: 'Custom Document',
};

export function getDocTypeDisplayName(docType: string): string {
  return DOC_TYPE_DISPLAY_NAMES[docType] ?? docType;
}

// ---------------------------------------------------------------------------
// Core unified generation function
// ---------------------------------------------------------------------------

/**
 * Generate a single document for a client. This is THE function that every
 * generation path calls — batch, single, flex, and chat draft.
 *
 * For per-property document types (deed, affidavit, gitRep3), call this
 * function once per property with the `propertyIndex` parameter.
 */
export async function generateDocument(
  params: UnifiedGenerateParams,
): Promise<UnifiedGenerateResult> {
  const {
    firmId,
    clientId,
    docType,
    generationMode = 'hybrid',
    customInstructions,
    softwareSource,
    propertyIndex,
    templateId,
    trustTypes,
    createdBy,
    triggerSource = 'single',
    customPrompt,
    additionalData,
    modelOverride,
  } = params;

  const db = admin.firestore();

  // ------------------------------------------------------------------
  // 1. Fetch client + firm data (skip if preloadedContext already has it)
  // ------------------------------------------------------------------
  let clientData: admin.firestore.DocumentData;
  let firmData: admin.firestore.DocumentData;

  if (params.preloadedContext) {
    // Reuse data from preloaded context — avoids redundant Firestore reads
    clientData = params.preloadedContext.client;
    firmData = params.preloadedContext.firm;
    console.log(`[unifiedGenerator] Reusing preloaded context for ${docType} (skipped 2 Firestore reads)`);
  } else {
    const [clientSnap, firmSnap] = await Promise.all([
      db.doc(`firms/${firmId}/clients/${clientId}`).get(),
      db.doc(`firms/${firmId}`).get(),
    ]);

    if (!clientSnap.exists) {
      throw new Error(`Client ${clientId} not found in firm ${firmId}.`);
    }
    if (!firmSnap.exists) {
      throw new Error(`Firm ${firmId} not found.`);
    }

    clientData = clientSnap.data()!;
    firmData = firmSnap.data()!;
  }

  // Inject model override if specified
  if (modelOverride) {
    (firmData as Record<string, unknown>).documentDraftingModel = modelOverride;
  }

  // Inject custom instructions into client data for generators
  if (customInstructions) {
    const safe = sanitizeForPrompt(customInstructions);
    clientData = { ...clientData, _customInstructions: safe };
  }

  const packageType = clientData.packageDetails?.packageType ?? 'foundation';

  // ------------------------------------------------------------------
  // 2. Aggregate context (always — not just for template/hybrid)
  //    Reuse preloadedContext when available to avoid redundant Firestore reads
  // ------------------------------------------------------------------
  let clientContext: ClientContext | null = params.preloadedContext ?? null;
  if (!clientContext) {
    try {
      clientContext = await aggregateClientContext(firmId, clientId, docType);
    } catch (ctxErr) {
      console.warn(`[unifiedGenerator] Context aggregation failed for ${docType}:`, ctxErr);
    }
  }

  // ------------------------------------------------------------------
  // 3. Resolve and run the generator
  // ------------------------------------------------------------------
  const genStartTime = Date.now();
  let generatedDoc: GeneratedDoc;

  if (FLEX_DOC_TYPES.has(docType)) {
    // Flex document — use AI with doc-type-specific prompt
    generatedDoc = await generateFlexAI({
      docType,
      clientData,
      firmData,
      customPrompt,
      additionalData,
    });
  } else if (STANDARD_GENERATORS[docType]) {
    // Standard document — route through template engine or direct AI
    const generatorFn = STANDARD_GENERATORS[docType];

    // Resolve property for per-property docs
    let property: admin.firestore.DocumentData | undefined;
    if (PER_PROPERTY_DOCS.has(docType)) {
      const properties: admin.firestore.DocumentData[] =
        (clientData.assets?.realEstate ?? []).filter(
          (p: admin.firestore.DocumentData) => p.transferToTrust === true,
        );

      if (properties.length === 0) {
        // No qualifying properties — return placeholder
        generatedDoc = {
          docType,
          title: `${getDocTypeDisplayName(docType)} — No Qualifying Properties`,
          content: `<p>No real estate properties are flagged for trust transfer for this client.</p>`,
          status: 'draft',
        };
      } else {
        const idx = propertyIndex ?? 0;
        property = properties[idx] ?? properties[0];
        // Per-property docs always use AI (complex property-specific logic)
        generatedDoc = await generatorFn(clientData, firmData, packageType, trustTypes, property);
        generatedDoc.propertyAddress = property.address;
      }
    }

    // Non-per-property docs (or if we didn't generate one above)
    if (!generatedDoc!) {
      // Route based on generation mode
      if (generationMode !== 'ai' && clientContext) {
        // Template or hybrid mode — use template engine with AI fallback
        const aiGenFn = () => generatorFn(clientData, firmData, packageType, trustTypes);
        generatedDoc = await generateFromTemplate(
          clientContext,
          docType,
          generationMode,
          templateId,
          undefined, // variant
          aiGenFn,
          softwareSource,
        );
      } else {
        // AI-only mode or context aggregation failed — direct AI generation
        generatedDoc = await generatorFn(clientData, firmData, packageType, trustTypes);
      }
    }
  } else {
    // Unknown doc type
    generatedDoc = {
      docType,
      title: `Unsupported document type: ${docType}`,
      content: `<p>Document type "${docType}" is not yet supported.</p>`,
      status: 'error',
    };
  }

  // ------------------------------------------------------------------
  // 3b. Observability — structured generation log
  // ------------------------------------------------------------------
  const genElapsedMs = Date.now() - genStartTime;
  const contentLength = generatedDoc.content?.length ?? 0;
  const textOnly = generatedDoc.content?.replace(/<[^>]*>/g, '').trim() ?? '';
  const textLength = textOnly.length;

  const genLog: Record<string, unknown> = {
    event: 'document_generated',
    docType,
    mode: generationMode ?? 'hybrid',
    status: generatedDoc.status,
    contentLength,
    textLength,
    elapsedMs: genElapsedMs,
    templateId: templateId ?? null,
    firmId,
    clientId,
  };

  if (textLength < 200 && generatedDoc.status !== 'error') {
    genLog.warning = 'suspiciously_short';
    console.warn(`[unifiedGenerator] ⚠ SHORT DOCUMENT: ${docType} has only ${textLength} chars of text (${genElapsedMs}ms)`, genLog);
  } else if (textLength === 0 && generatedDoc.status !== 'error') {
    genLog.warning = 'empty_content';
    console.error(`[unifiedGenerator] 🚨 EMPTY DOCUMENT: ${docType} generated with no text content (${genElapsedMs}ms)`, genLog);
  } else {
    console.info(`[unifiedGenerator] ✓ ${docType} generated: ${textLength} chars, ${genElapsedMs}ms, mode=${generationMode ?? 'hybrid'}`);
  }

  // ------------------------------------------------------------------
  // 4. Save to vault via shared helper
  // ------------------------------------------------------------------
  const isFlexType = FLEX_DOC_TYPES.has(docType);
  const suffix = propertyIndex !== undefined ? `_${propertyIndex}` : '';

  // Flex docs use timestamp-based IDs (multiples allowed); standard docs use deterministic IDs
  const documentId = isFlexType
    ? `${docType}_${Date.now()}`
    : `${docType}${suffix}`;

  const changeNotes = customInstructions
    ? `Regenerated with custom instructions: ${sanitizeForPrompt(customInstructions).slice(0, 200)}`
    : triggerSource === 'chat-draft'
      ? 'Generated via AI drafting conversation'
      : undefined;

  const tags = isFlexType ? ['flex', docType] : [];
  if (triggerSource === 'chat-draft') tags.push('chat-draft');

  let saveResult: SaveDocumentResult;
  try {
    saveResult = await saveDocumentToVault({
      firmId,
      clientId,
      docType,
      displayName: generatedDoc.title,
      content: generatedDoc.content,
      status: generatedDoc.status,
      createdBy,
      documentId,
      generationMode: triggerSource === 'chat-draft' ? 'chat-draft' : 'batch',
      propertyAddress: generatedDoc.propertyAddress,
      changeNotes,
      tags,
    });
  } catch (saveError) {
    console.error(`[unifiedGenerator] Failed to save ${docType}:`, saveError);
    return {
      docType: generatedDoc.docType,
      title: generatedDoc.title,
      content: generatedDoc.content,
      status: 'error',
      docId: documentId,
      isNew: false,
      currentVersion: 0,
      propertyAddress: generatedDoc.propertyAddress,
      propertyIndex,
    };
  }

  // ------------------------------------------------------------------
  // 5. Record draft history (fire-and-forget)
  // ------------------------------------------------------------------
  recordDraftHistory(firmId, clientId, {
    docType,
    title: generatedDoc.title,
    generatedAt: new Date().toISOString(),
    customInstructions: customInstructions?.slice(0, 200),
    templateUsed: templateId,
    generationMode: generationMode ?? 'hybrid',
  }).catch(console.error);

  return {
    docType: generatedDoc.docType,
    title: generatedDoc.title,
    content: generatedDoc.content,
    status: generatedDoc.status,
    docId: saveResult.docId,
    isNew: saveResult.isNew,
    currentVersion: saveResult.currentVersion,
    propertyAddress: generatedDoc.propertyAddress,
    propertyIndex,
  };
}

// ---------------------------------------------------------------------------
// Batch generation helper — generates all per-property variants
// ---------------------------------------------------------------------------

/**
 * Generate a document that may have per-property variants.
 * For per-property docs, returns one result per qualifying property.
 * For all other docs, returns a single result.
 */
export async function generateDocumentWithPropertyExpansion(
  params: UnifiedGenerateParams,
  clientData?: admin.firestore.DocumentData,
): Promise<UnifiedGenerateResult[]> {
  if (PER_PROPERTY_DOCS.has(params.docType)) {
    // Fetch client data if not passed in (batch callers may pass it to avoid re-fetching)
    let client = clientData;
    if (!client) {
      const snap = await admin.firestore()
        .doc(`firms/${params.firmId}/clients/${params.clientId}`)
        .get();
      client = snap.data();
    }

    const properties: admin.firestore.DocumentData[] =
      (client?.assets?.realEstate ?? []).filter(
        (p: admin.firestore.DocumentData) => p.transferToTrust === true,
      );

    if (properties.length === 0) {
      // Generate a single placeholder
      return [await generateDocument(params)];
    }

    // Generate one document per qualifying property
    const results: UnifiedGenerateResult[] = [];
    for (let i = 0; i < properties.length; i++) {
      try {
        const result = await generateDocument({ ...params, propertyIndex: i });
        results.push(result);
      } catch (error) {
        console.error(`[unifiedGenerator] Error generating ${params.docType} for property ${i}:`, error);
        results.push({
          docType: params.docType,
          title: `Error — ${getDocTypeDisplayName(params.docType)} (Property ${i + 1})`,
          content: `<p>Error generating document: ${error instanceof Error ? error.message : 'Unknown error'}</p>`,
          status: 'error',
          docId: `${params.docType}_${i}`,
          isNew: false,
          currentVersion: 0,
          propertyIndex: i,
        });
      }
    }
    return results;
  }

  // Non-per-property doc — single result
  return [await generateDocument(params)];
}
