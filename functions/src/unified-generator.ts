import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { HttpsError } from 'firebase-functions/v2/https';

import { GeneratedDoc } from './generate-documents';
import { generateFromTemplate, GenerationMode } from './template-engine';
import { aggregateClientContext, ClientContext } from './client-context-aggregator';
import { saveDocumentToVault, SaveDocumentResult } from './document-save-helper';
import { recordDraftHistory } from './ai-memory';
import { sanitizeForPrompt } from './ai-client';
import { serializeClientData } from './client-data-serializer';
import { validateDocumentStructure, buildRetryInstruction } from './document-structure-validator';
import { buildEstatePlanSummaryTemplateData } from './generators/summary-docs-generator';




// ---------------------------------------------------------------------------
// Doc-type union types — single source of truth for valid doc types.
// Adding a new doc type here forces updates to ALL_DOC_TYPES, loadGenerator(),
// DOC_TYPE_DISPLAY_NAMES, etc. via the compiler.
// ---------------------------------------------------------------------------

/** Standard generators — each has a dedicated generator file */
export type StandardDocType =
  | 'will' | 'pourOverWill' | 'poa' | 'livingWill' | 'trust'
  | 'deed' | 'affidavitOfConsideration' | 'gitRep3'
  | 'estatePlanSummary' | 'questionnaire';

/** Flex generators — AI with doc-type-specific prompts via flex-prompts.ts */
export type FlexDocType =
  | 'engagementLetter' | 'coverLetter' | 'invoice' | 'certificationOfTrust'
  | 'beneficiaryDesignation' | 'trustAmendment' | 'trustRestatement' | 'petTrust'
  | 'letterOfInstruction' | 'memorandumOfPersonalProp' | 'codicil' | 'hipaaRelease'
  | 'custom';

/** All known document types */
export type DocType = StandardDocType | FlexDocType;

/** Per-property doc types that generate one document per qualifying property */
type PerPropertyDocType = 'deed' | 'affidavitOfConsideration' | 'gitRep3';

/** Runtime type-guard: checks if a string is a known DocType */
function isDocType(s: string): s is DocType {
  return (ALL_DOC_TYPES as Set<string>).has(s);
}

/** All flex doc type strings for the runtime type guard */
const FLEX_DOC_TYPE_STRINGS: ReadonlySet<string> = new Set<string>([
  'engagementLetter', 'coverLetter', 'invoice', 'certificationOfTrust',
  'beneficiaryDesignation', 'trustAmendment', 'trustRestatement', 'petTrust',
  'letterOfInstruction', 'memorandumOfPersonalProp', 'codicil', 'hipaaRelease',
  'custom',
]);

/** Runtime type-guard: checks if a string is a flex doc type (skips structural validation, uses timestamp IDs) */
export function isFlexDocType(s: string): s is FlexDocType {
  return FLEX_DOC_TYPE_STRINGS.has(s);
}

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
  /** Formatting preset — controls paragraph styling in exports (e.g. 'interactivelegal') */
  formattingPreset?: string;
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
  /**
   * For married-couple generation: 'client' = primary client, 'spouse' = spouse.
   * When 'spouse', personalInfo ↔ spouseInfo are swapped so generators treat
   * the spouse as the primary person without per-generator changes.
   */
  spouseRole?: 'client' | 'spouse';
}

export interface UnifiedGenerateResult {
  docType: string;
  title: string;
  content: string;
  status: 'draft' | 'incomplete' | 'needs_review' | 'error';
  docId: string;
  isNew: boolean;
  currentVersion: number;
  storagePath?: string;
  propertyAddress?: string;
  propertyIndex?: number;
  /** Pre-generation warnings (missing critical fields) */
  warnings?: string[];
  /** Post-generation structural validation findings (missing elements) */
  validationFindings?: Array<{ name: string; severity: 'error' | 'warning' }>;
  /** True when client context aggregation failed — document generated in degraded AI-only mode */
  _contextFailed?: boolean;
  /** True when the requested propertyIndex was out of bounds and fell back to properties[0] */
  _propertyIndexFallback?: boolean;
}

// ---------------------------------------------------------------------------
// Pre-generation completeness gate — critical fields per doc type
// ---------------------------------------------------------------------------

const CRITICAL_FIELDS: Partial<Record<StandardDocType, Array<{ path: string; altPath?: string; label: string }>>> = {
  will: [
    { path: 'personalInfo.firstName', label: 'Client first name' },
    { path: 'personalInfo.lastName', label: 'Client last name' },
    { path: 'fiduciaries.executor.primary', label: 'Primary executor' },
  ],
  pourOverWill: [
    { path: 'personalInfo.firstName', label: 'Client first name' },
    { path: 'personalInfo.lastName', label: 'Client last name' },
    { path: 'fiduciaries.executor.primary', label: 'Primary executor' },
    { path: 'distribution.trustName', label: 'Trust name for pour-over' },
  ],
  trust: [
    { path: 'personalInfo.firstName', label: 'Client first name' },
    { path: 'personalInfo.lastName', label: 'Client last name' },
    { path: 'fiduciaries.trustee.primary', label: 'Primary trustee' },
  ],
  poa: [
    { path: 'personalInfo.firstName', label: 'Client first name' },
    { path: 'personalInfo.lastName', label: 'Client last name' },
    { path: 'fiduciaries.powerOfAttorney.agent', label: 'POA agent' },
  ],
  livingWill: [
    { path: 'personalInfo.firstName', label: 'Client first name' },
    { path: 'personalInfo.lastName', label: 'Client last name' },
    // Healthcare proxy data lives at two paths depending on questionnaire version:
    // - fiduciaries.healthcareProxy.agent (questionnaire types / client dashboard)
    // - fiduciaries.healthcareRep.primary (questionnaire-steps.ts)
    { path: 'fiduciaries.healthcareProxy.agent', altPath: 'fiduciaries.healthcareRep.primary', label: 'Healthcare proxy agent' },
  ],
  deed: [
    { path: 'personalInfo.firstName', label: 'Client first name' },
    { path: 'personalInfo.lastName', label: 'Client last name' },
    { path: 'assets.realEstate', label: 'Real estate properties' },
  ],
  affidavitOfConsideration: [
    { path: 'personalInfo.firstName', label: 'Client first name' },
    { path: 'assets.realEstate', label: 'Real estate properties' },
  ],
  gitRep3: [
    { path: 'personalInfo.firstName', label: 'Client first name' },
    { path: 'assets.realEstate', label: 'Real estate properties' },
  ],
};

/**
 * Check if a nested field exists and has a truthy value in an object.
 */
function hasNestedField(obj: Record<string, unknown>, path: string): boolean {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return false;
    current = (current as Record<string, unknown>)[part];
  }
  // For arrays, check length > 0; for objects, check it has keys; for strings, check non-empty
  if (Array.isArray(current)) return current.length > 0;
  if (typeof current === 'object' && current !== null) return Object.keys(current).length > 0;
  if (typeof current === 'string') return current.trim().length > 0;
  return current != null;
}

/**
 * Run the pre-generation completeness check.
 * Returns an array of warning strings for missing critical fields.
 */
function checkCompleteness(
  clientData: Record<string, unknown>,
  docType: string,
): string[] {
  const rules = CRITICAL_FIELDS[docType as StandardDocType];
  if (!rules) return [];

  const warnings: string[] = [];
  for (const rule of rules) {
    // Check primary path, then altPath fallback if provided
    const found = hasNestedField(clientData, rule.path)
      || (rule.altPath ? hasNestedField(clientData, rule.altPath) : false);
    if (!found) {
      warnings.push(`Missing: ${rule.label} (${rule.path})`);
    }
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Generator registry — lazy-loaded to avoid pulling all 10 generators'
// system prompts (~52KB) into memory on every function invocation.
// ---------------------------------------------------------------------------

/** Signature shared by all standard generators */
type StandardGeneratorFn = (
  clientData: admin.firestore.DocumentData,
  firmData: admin.firestore.DocumentData,
  packageType: string,
  trustTypes?: string[],
  property?: admin.firestore.DocumentData,
) => Promise<GeneratedDoc>;

/** All known doc types — used for membership checks */
const ALL_DOC_TYPES = new Set<DocType>([
  // Standard generators
  'will', 'pourOverWill', 'poa', 'livingWill', 'trust',
  'deed', 'affidavitOfConsideration', 'gitRep3',
  'estatePlanSummary', 'questionnaire',
  // Flex generators (AI with doc-type-specific prompts)
  'engagementLetter', 'coverLetter', 'invoice', 'certificationOfTrust',
  'beneficiaryDesignation', 'trustAmendment', 'trustRestatement', 'petTrust',
  'letterOfInstruction', 'memorandumOfPersonalProp', 'codicil', 'hipaaRelease',
  'custom',
]);

// (Flex doc types are identified via isFlexDocType() — no separate set needed)

/**
 * Dynamically import the generator for a given docType.
 * Returns null if the docType is unknown.
 * Standard generators are imported directly; flex doc types return an
 * adapter wrapper that delegates to generateFlexAI().
 * Node's module cache means each import() only loads once.
 */
async function loadGenerator(docType: DocType): Promise<StandardGeneratorFn | null> {
  switch (docType) {
    // --- Standard generators ---
    case 'will': return (await import('./generators/will-generator')).generateWill;
    case 'pourOverWill': return (await import('./generators/pour-over-will-generator')).generatePourOverWill;
    case 'poa': return (await import('./generators/poa-generator')).generatePOA;
    case 'livingWill': return (await import('./generators/advance-directive-generator')).generateAdvanceDirective;
    case 'trust': return (await import('./generators/trust-generator')).generateTrust;
    case 'deed': return (await import('./generators/deed-generator')).generateDeed;
    case 'affidavitOfConsideration': return (await import('./generators/affidavit-generator')).generateAffidavitOfConsideration;
    case 'gitRep3': return (await import('./generators/git-rep3-generator')).generateGitRep3;
    case 'estatePlanSummary': return (await import('./generators/summary-docs-generator')).generateEstatePlanSummary;
    case 'questionnaire': return (await import('./generators/questionnaire-generator')).generateQuestionnaire;

    // --- Flex generators (all route through generateFlexAI adapter) ---
    case 'engagementLetter':
    case 'coverLetter':
    case 'invoice':
    case 'certificationOfTrust':
    case 'beneficiaryDesignation':
    case 'trustAmendment':
    case 'trustRestatement':
    case 'petTrust':
    case 'letterOfInstruction':
    case 'memorandumOfPersonalProp':
    case 'codicil':
    case 'hipaaRelease':
    case 'custom': {
      const { generateFlexAI } = await import('./flex-prompts');
      return async (clientData: admin.firestore.DocumentData, firmData: admin.firestore.DocumentData) => {
        const cd = clientData as Record<string, unknown>;
        return generateFlexAI({
          docType,
          clientData,
          firmData,
          customPrompt: cd._customPrompt as string | undefined,
          additionalData: cd._additionalData as Record<string, unknown> | undefined,
        });
      };
    }

    default:
      return null;
  }
}

/** Per-property doc types that generate one document per qualifying property */
const PER_PROPERTY_DOCS = new Set<PerPropertyDocType>(['deed', 'affidavitOfConsideration', 'gitRep3']);

// ---------------------------------------------------------------------------
// Display name lookup
// ---------------------------------------------------------------------------

const DOC_TYPE_DISPLAY_NAMES: Record<DocType, string> = {
  will: 'Last Will and Testament',
  pourOverWill: 'Pour-Over Will',
  poa: 'Durable Power of Attorney',
  livingWill: 'Advance Directive for Health Care',
  trust: 'Revocable Living Trust',
  deed: 'Deed',
  affidavitOfConsideration: 'Affidavit of Consideration',
  gitRep3: 'GIT/REP-3 Exemption Certificate',
  estatePlanSummary: 'Estate Plan Summary',
  questionnaire: 'Questionnaire Summary',
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
  return DOC_TYPE_DISPLAY_NAMES[docType as DocType] ?? docType;
}

/**
 * Compute a short, deterministic hash of a prompt string.
 * Used to track which prompt version produced a given document.
 * Returns a 12-char hex string (48 bits — sufficient for version tracking).
 */
export function computePromptHash(promptText: string): string {
  return crypto.createHash('sha256').update(promptText).digest('hex').slice(0, 12);
}

/**
 * Build a standardized document title.
 *
 * Standard format: "{Doc Type} of {Client Full Name}"
 * Exceptions:
 *   - Trust: "The {Name} Revocable Living Trust" (legal convention)
 *   - Per-property docs: "{Doc Type} of {Name} — {Address}"
 *
 * All generators, template-engine, and flex-prompts should use this
 * instead of ad-hoc title formatting — ensures consistent vault sorting.
 */
export function buildStandardTitle(
  docType: DocType | string,
  clientFullName: string,
  propertyAddress?: string,
): string {
  const displayName = getDocTypeDisplayName(docType);

  // Trust follows legal convention: "The {Name} Revocable Living Trust"
  if (docType === 'trust') {
    return `The ${clientFullName} Revocable Living Trust`;
  }

  // Per-property docs include the address
  if ((PER_PROPERTY_DOCS as Set<string>).has(docType) && propertyAddress) {
    return `${displayName} of ${clientFullName} — ${propertyAddress}`;
  }

  // Standard format for everything else
  return `${displayName} of ${clientFullName}`;
}

// ---------------------------------------------------------------------------
// Core unified generation function
// ---------------------------------------------------------------------------
// Context cloning — Timestamp-aware deep clone for batch preload (Phase 3.3)
// ---------------------------------------------------------------------------

/**
 * Recursive deep-clone that preserves Firestore Timestamp instances and Date
 * objects. JSON.parse(JSON.stringify(...)) would coerce both to strings,
 * breaking any helper that calls .toDate() / .toMillis() and producing date
 * drift between single and batch generation paths.
 */
function cloneTimestampAware<T>(value: T, seen: WeakMap<object, unknown> = new WeakMap()): T {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  // Firestore Timestamp has toMillis/toDate but not isFrozen — duck-type detect.
  if (value instanceof admin.firestore.Timestamp) {
    return admin.firestore.Timestamp.fromMillis(value.toMillis()) as unknown as T;
  }
  if (seen.has(value as object)) return seen.get(value as object) as T;

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    seen.set(value as object, out);
    for (const item of value as unknown[]) out.push(cloneTimestampAware(item, seen));
    return out as unknown as T;
  }
  const out: Record<string, unknown> = {};
  seen.set(value as object, out);
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = cloneTimestampAware(v, seen);
  }
  return out as unknown as T;
}

function cloneClientContext(ctx: ClientContext): ClientContext {
  return cloneTimestampAware(ctx);
}

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
    formattingPreset,
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

  // Inject formatting preset if specified (so generators can apply correct paragraph classes)
  if (formattingPreset) {
    (firmData as Record<string, unknown>).formattingPreset = formattingPreset;
  }

  // Inject custom instructions into client data for generators
  if (customInstructions) {
    const safe = sanitizeForPrompt(customInstructions);
    clientData = { ...clientData, _customInstructions: safe };
  }

  // ------------------------------------------------------------------
  // 1a. Spouse data swap — for married-couple generation
  // ------------------------------------------------------------------
  // We must apply the swap to BOTH 'clientData' (for the generator) AND 'clientContext' (for the template engine).
  let clientContext: ClientContext | null = null;
  let contextFailed = false;

  if (params.preloadedContext) {
    // Deep clone preloaded context so we don't mutate the shared batch instance.
    // Use structuredClone so Firestore Timestamp / Date objects survive (a plain
    // JSON.stringify round-trip would coerce them to ISO strings, breaking any
    // template helper that calls .toDate() — silent date drift between batch
    // and single generation paths). Timestamp instances aren't structured-
    // cloneable directly; fall back to a Timestamp-aware recursive clone.
    clientContext = cloneClientContext(params.preloadedContext);
  } else {
    try {
      clientContext = await aggregateClientContext(firmId, clientId, docType);
    } catch (ctxErr) {
      contextFailed = true;
      console.warn(`[unifiedGenerator] Context aggregation failed for ${docType} — document will generate in AI-only mode:`, ctxErr);
    }
  }

  if (params.spouseRole === 'spouse' && clientData.spouseInfo) {
    const originalPersonal = { ...clientData.personalInfo };
    const originalSpouse = { ...clientData.spouseInfo };
    console.log(`[unifiedGenerator] Spouse swap for ${docType}: ${originalSpouse.firstName ?? 'unknown'} ↔ ${originalPersonal.firstName ?? 'unknown'}`);
    
    // Swap clientData for generators
    clientData = {
      ...clientData,
      personalInfo: originalSpouse,
      spouseInfo: originalPersonal,
    };

    // Swap clientContext for template engine
    if (clientContext?.client?.spouseInfo) {
      const ctxOriginalPersonal = { ...clientContext.client.personalInfo };
      const ctxOriginalSpouse = { ...clientContext.client.spouseInfo };
      clientContext.client.personalInfo = ctxOriginalSpouse;
      clientContext.client.spouseInfo = ctxOriginalPersonal;

      // Swap computed names
      const originalClientFullName = clientContext.computed.clientFullName;
      const originalSpouseFullName = clientContext.computed.spouseFullName;
      clientContext.computed.clientFullName = originalSpouseFullName;
      clientContext.computed.spouseFullName = originalClientFullName;
    }
  }

  const packageType = clientData.packageDetails?.packageType ?? 'foundation';

  // ------------------------------------------------------------------
  // 1b. Pre-generation completeness gate (Phase 3)
  // ------------------------------------------------------------------
  const completenessWarnings = checkCompleteness(
    clientData as Record<string, unknown>,
    docType,
  );
  if (completenessWarnings.length > 0) {
    console.warn(
      `[unifiedGenerator] ⚠ INCOMPLETE DATA for ${docType}: ${completenessWarnings.join('; ')}`,
    );
  }

  // ------------------------------------------------------------------
  // 1c. Serialize client data canonically (Phase 1)
  // ------------------------------------------------------------------
  try {
    const serialized = serializeClientData(clientData, firmData, docType);
    clientData = {
      ...clientData,
      _serializedClientData: serialized.text,
      _clientFullName: serialized.clientFullName,
      _spouseFullName: serialized.spouseFullName,
    };
  } catch (serErr) {
    console.warn('[unifiedGenerator] Client data serialization failed (non-blocking):', serErr);
  }

  // ------------------------------------------------------------------
  // 3. Resolve and run the generator
  // ------------------------------------------------------------------
  const genStartTime = Date.now();
  let generatedDoc: GeneratedDoc;
  let propertyIndexFallback = false;

  if (isDocType(docType)) {
    // Unified dispatch — loads standard generator or flex adapter wrapper
    const generatorFn = await loadGenerator(docType);
    if (!generatorFn) throw new Error(`Generator loader returned null for known docType: ${docType}`);

    // For flex docs, inject customPrompt/additionalData into clientData so the adapter can extract them
    if (isFlexDocType(docType)) {
      (clientData as Record<string, unknown>)._customPrompt = customPrompt;
      (clientData as Record<string, unknown>)._additionalData = additionalData;
      // Phase 1.2: flex docs can opt into template/hybrid rendering by passing
      // a generationMode other than 'ai'. When a clientContext exists and a
      // matching flex template is uploaded, route through the template engine;
      // otherwise fall back to the AI flex generator (closure preserves the
      // injected customPrompt/additionalData).
      if (generationMode !== 'ai' && clientContext) {
        console.info(`[unifiedGenerator] dispatch: docType=${docType} path=template-flex generationMode=${generationMode}`);
        const aiGenFn = () => {
          console.info(`[unifiedGenerator] dispatch: docType=${docType} path=ai-fallback-from-template (flex)`);
          return generatorFn(clientData, firmData, packageType, trustTypes);
        };
        generatedDoc = await generateFromTemplate(
          clientContext,
          docType,
          generationMode,
          templateId,
          undefined,
          aiGenFn,
          softwareSource,
          formattingPreset,
          additionalData,
        );
      } else {
        console.info(`[unifiedGenerator] dispatch: docType=${docType} path=ai-only-direct (flex) reason=${generationMode === 'ai' ? 'mode' : 'no-context'}`);
        generatedDoc = await generatorFn(clientData, firmData, packageType, trustTypes);
      }
    } else {
      // Resolve property for per-property docs
      let property: admin.firestore.DocumentData | undefined;
      if ((PER_PROPERTY_DOCS as Set<string>).has(docType)) {
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
          propertyIndexFallback = idx >= properties.length;
          if (propertyIndexFallback) {
            console.warn(
              `[unifiedGenerator] propertyIndex=${idx} out of bounds for ${docType} ` +
              `(${properties.length} qualifying properties) — falling back to properties[0]`,
            );
          }
          property = properties[idx] ?? properties[0];
          // Try templates first when a clientContext is available; per-property
          // generators are then used as the AI fallback (closure carries the
          // resolved property forward). When no template exists for this
          // doc type, generateFromTemplate falls through to aiGenFn — yielding
          // identical behaviour to the legacy direct-AI path. Per-property
          // Handlebars templates can read {{property.address}} etc. via the
          // additionalData payload.
          if (generationMode !== 'ai' && clientContext) {
            console.info(`[unifiedGenerator] dispatch: docType=${docType} path=template-with-property generationMode=${generationMode}`);
            const aiGenFn = () => {
              console.info(`[unifiedGenerator] dispatch: docType=${docType} path=ai-fallback-from-template (per-property)`);
              return generatorFn(clientData, firmData, packageType, trustTypes, property);
            };
            generatedDoc = await generateFromTemplate(
              clientContext,
              docType,
              generationMode,
              templateId,
              undefined,
              aiGenFn,
              softwareSource,
              formattingPreset,
              { property },
            );
          } else {
            console.info(`[unifiedGenerator] dispatch: docType=${docType} path=ai-only-direct (per-property) reason=${generationMode === 'ai' ? 'mode' : 'no-context'}`);
            generatedDoc = await generatorFn(clientData, firmData, packageType, trustTypes, property);
          }
          generatedDoc.propertyAddress = property.address;
        }
      }

      // Non-per-property docs (or if we didn't generate one above)
      if (!generatedDoc!) {
        if (generationMode !== 'ai' && clientContext) {
          // Legacy Template or hybrid mode (HTML based)
          console.info(`[unifiedGenerator] dispatch: docType=${docType} path=template generationMode=${generationMode}`);
          const aiGenFn = () => {
            console.info(`[unifiedGenerator] dispatch: docType=${docType} path=ai-fallback-from-template`);
            return generatorFn(clientData, firmData, packageType, trustTypes);
          };

          // Special case: Estate Plan Summary needs its own complex data mapper 
          // (it's not just a simple questionnaire field lookup)
          let additionalData: Record<string, unknown> | undefined;
          if (docType === 'estatePlanSummary') {
            additionalData = buildEstatePlanSummaryTemplateData(clientData, firmData, packageType);
          }

          generatedDoc = await generateFromTemplate(
            clientContext,
            docType,
            generationMode,
            templateId,
            undefined, // variant
            aiGenFn,
            softwareSource,
            formattingPreset,
            additionalData,
          );
        } else {
          // AI-only mode or context aggregation failed — direct AI generation
          console.info(`[unifiedGenerator] dispatch: docType=${docType} path=ai-only-direct reason=${generationMode === 'ai' ? 'mode' : 'no-context'}`);
          generatedDoc = await generatorFn(clientData, firmData, packageType, trustTypes);
        }
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
  // 3b. Post-generation structural validation (Phase 2 + Phase 4)
  // ------------------------------------------------------------------
  let validationFindings: Array<{ name: string; severity: 'error' | 'warning' }> = [];

  if (generatedDoc.status !== 'error' && generatedDoc.content && generationMode !== 'template') {
    // Skip structural validation for template mode — the uploaded template from
    // legal software (e.g. InteractiveLegal) is authoritative. Validation is only
    // meaningful for AI-generated content where sections might be missed.
    const structureResult = validateDocumentStructure(generatedDoc.content, docType);

    if (!structureResult.valid) {
      console.warn(
        `[unifiedGenerator] ⚠ STRUCTURAL VALIDATION FAILED for ${docType}: ` +
        `missing=[${structureResult.missing.map(m => m.name).join(', ')}], ` +
        `minLength=${structureResult.meetsMinimumLength}, truncated=${structureResult.appearsTruncated}, ` +
        `placeholders=${structureResult.placeholderCount}`,
      );

      // Auto-retry ONCE for standard AI generators with error-severity failures.
      // Do NOT retry for template/hybrid modes — the user's template dictates the legal structure,
      // and retrying would overwrite their template with a purely AI-generated document.
      const hasErrors = structureResult.missing.some(m => m.severity === 'error');
      const isAIGeneration = generationMode === 'ai' || !clientContext;
      
      if (hasErrors && isDocType(docType) && !isFlexDocType(docType) && isAIGeneration) {
        console.info(`[unifiedGenerator] Retrying ${docType} with structural feedback...`);
        const retryInstruction = buildRetryInstruction(structureResult, docType);

        try {
          // Inject retry instruction and re-run the generator
          const retryClientData = {
            ...clientData,
            _customInstructions: [
              (clientData as Record<string, unknown>)._customInstructions ?? '',
              retryInstruction,
            ].filter(Boolean).join('\n\n'),
          };

          // Re-use loadGenerator (Node caches the module after first import)
          const retryGeneratorFn = await loadGenerator(docType as DocType);
          const retryDoc = await retryGeneratorFn!(
            retryClientData, firmData, packageType, trustTypes,
          );

          // Validate the retry
          const retryValidation = validateDocumentStructure(retryDoc.content ?? '', docType);
          if (retryValidation.valid || retryValidation.missing.filter(m => m.severity === 'error').length < structureResult.missing.filter(m => m.severity === 'error').length) {
            // Retry improved — use it
            generatedDoc = retryDoc;
            validationFindings = retryValidation.missing;
            console.info(`[unifiedGenerator] ✓ Retry improved ${docType}: ${retryValidation.missing.length} issues (was ${structureResult.missing.length})`);
          } else {
            // Retry didn't help — keep original, flag for review
            validationFindings = structureResult.missing;
            console.warn(`[unifiedGenerator] Retry did not improve ${docType}, keeping original. Flagging as needs_review.`);
          }
        } catch (retryErr) {
          console.error(`[unifiedGenerator] Retry failed for ${docType}:`, retryErr);
          validationFindings = structureResult.missing;
        }
      } else {
        validationFindings = structureResult.missing;
      }
    }
  }

  // Determine final status based on completeness + validation + truncation
  let finalStatus: 'draft' | 'incomplete' | 'needs_review' | 'error' = generatedDoc.status as 'draft' | 'error';
  if (finalStatus !== 'error') {
    const hasValidationErrors = validationFindings.some(f => f.severity === 'error');
    if (hasValidationErrors || generatedDoc._truncated) {
      finalStatus = 'needs_review';
      if (generatedDoc._truncated) {
        console.warn(`[unifiedGenerator] ${docType} was truncated by AI — flagging as needs_review`);
      }
    } else if (completenessWarnings.length > 0) {
      finalStatus = 'incomplete';
    }
  }

  // ------------------------------------------------------------------
  // 3c. Observability — structured generation log
  // ------------------------------------------------------------------
  const genElapsedMs = Date.now() - genStartTime;
  const contentLength = generatedDoc.content?.length ?? 0;
  const textOnly = generatedDoc.content?.replace(/<[^>]*>/g, '').trim() ?? '';
  const textLength = textOnly.length;

  const genLog: Record<string, unknown> = {
    event: 'document_generated',
    docType,
    mode: generationMode ?? 'hybrid',
    status: finalStatus,
    contentLength,
    textLength,
    elapsedMs: genElapsedMs,
    templateId: templateId ?? null,
    firmId,
    clientId,
    completenessWarnings: completenessWarnings.length > 0 ? completenessWarnings : undefined,
    validationFindings: validationFindings.length > 0 ? validationFindings : undefined,
  };

  if (textLength < 200 && finalStatus !== 'error') {
    genLog.warning = 'suspiciously_short';
    console.warn(`[unifiedGenerator] ⚠ SHORT DOCUMENT: ${docType} has only ${textLength} chars of text (${genElapsedMs}ms)`, genLog);
  } else if (textLength === 0 && finalStatus !== 'error') {
    genLog.warning = 'empty_content';
    console.error(`[unifiedGenerator] 🚨 EMPTY DOCUMENT: ${docType} generated with no text content (${genElapsedMs}ms)`, genLog);
  } else {
    console.info(`[unifiedGenerator] ✓ ${docType} generated: ${textLength} chars, ${genElapsedMs}ms, mode=${generationMode ?? 'hybrid'}, status=${finalStatus}`);
  }

  // ------------------------------------------------------------------
  // 4. Save to vault via shared helper
  // ------------------------------------------------------------------
  const isFlexType = isFlexDocType(docType);
  const suffix = propertyIndex !== undefined ? `_${propertyIndex}` : '';
  const spouseSuffix = params.spouseRole === 'spouse' ? '_spouse' : '';

  // Flex docs use timestamp-based IDs (multiples allowed); standard docs use deterministic IDs
  const documentId = isFlexType
    ? `${docType}_${Date.now()}`
    : `${docType}${suffix}${spouseSuffix}`;

  const changeNotes = customInstructions
    ? `Regenerated with custom instructions: ${sanitizeForPrompt(customInstructions).slice(0, 200)}`
    : triggerSource === 'chat-draft'
      ? 'Generated via AI drafting conversation'
      : undefined;

  const tags = isFlexType ? ['flex', docType] : [];
  if (triggerSource === 'chat-draft') tags.push('chat-draft');

  let saveResult: SaveDocumentResult;
  try {
    if (contextFailed) {
      console.warn(`[unifiedGenerator] Saving ${docType} with _contextFailed=true (degraded AI-only output)`);
    }
    // Resolved generation mode — what actually ran. When generateFromTemplate
    // matched a template, generatedDoc.resolvedMode is set; otherwise we ran
    // the AI fallback directly so resolvedMode is 'ai'. Flex docs report
    // 'flex' to distinguish them from standard AI generation.
    const resolvedMode: 'template' | 'hybrid' | 'ai' | 'flex' =
      generatedDoc.resolvedMode
        ?? (isFlexType ? 'flex' : 'ai');

    saveResult = await saveDocumentToVault({
      firmId,
      clientId,
      docType,
      displayName: generatedDoc.title,
      content: generatedDoc.content,
      binaryBuffer: generatedDoc._binaryBuffer,
      extractedData: generatedDoc._extractedData,
      status: finalStatus === 'error' ? 'error' : finalStatus,
      createdBy,
      documentId,
      generationMode: resolvedMode,
      triggerSource,
      templateId: generatedDoc.resolvedTemplateId ?? null,
      templateSourceCollection: generatedDoc.resolvedTemplateSource ?? null,
      softwareSource: generatedDoc.resolvedSoftwareSource ?? softwareSource ?? null,
      propertyAddress: generatedDoc.propertyAddress,
      changeNotes,
      tags,
      warnings: completenessWarnings.length > 0 ? completenessWarnings : undefined,
      validationFindings: validationFindings.length > 0 ? validationFindings : undefined,
      promptVersion: generatedDoc.promptVersion,
      templateBaseline: generatedDoc.templateBaseline,
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
      _contextFailed: contextFailed || undefined,
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
    status: finalStatus,
    docId: saveResult.docId,
    isNew: saveResult.isNew,
    currentVersion: saveResult.currentVersion,
    storagePath: saveResult.storagePath,
    propertyAddress: generatedDoc.propertyAddress,
    propertyIndex,
    warnings: completenessWarnings.length > 0 ? completenessWarnings : undefined,
    validationFindings: validationFindings.length > 0 ? validationFindings : undefined,
    _contextFailed: contextFailed || undefined,
    _propertyIndexFallback: propertyIndexFallback || undefined,
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
  if ((PER_PROPERTY_DOCS as Set<string>).has(params.docType)) {
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
