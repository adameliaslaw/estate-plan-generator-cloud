import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { loadFirmSecrets } from './firm-secrets';
import * as crypto from 'crypto';

import { GeneratedDoc } from './generate-documents';
import { generateFromTemplate, GenerationMode } from './template-engine';
import { aggregateClientContext, ClientContext } from './client-context-aggregator';
import { saveDocumentToVault, SaveDocumentResult } from './document-save-helper';
import { recordDraftHistory } from './ai-memory';
import { sanitizeForPrompt } from './ai-client';
import { serializeClientData } from './client-data-serializer';
import { checkClientFactConsistency } from './client-facts';
import { validateDocumentStructure, buildRetryInstruction } from './document-structure-validator';
import { checkContentIntegrity } from './doc-content-integrity-checker';
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
  /**
   * Package tier for this generation run. The batch entry point writes the
   * requested packageType to the client record only AFTER generation, so on a
   * first run the stored client doc still holds the intake default. Pass it
   * explicitly so generators see the tier the attorney actually selected;
   * falls back to the stored value when omitted.
   */
  packageType?: string;
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
    firmData = { ...firmSnap.data()!, ...(await loadFirmSecrets(firmId)) };
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

  // Deterministic pre-generation consistency check (client-facts.ts): never
  // send a contradictory prompt silently. Findings are logged and attached to
  // the generated document for attorney review; they do not block generation.
  let dataConsistencyWarnings: string[] = [];
  if (clientContext) {
    const findings = checkClientFactConsistency(clientContext.client);
    if (findings.length > 0) {
      dataConsistencyWarnings = findings.map(
        (f) => `[${f.severity}] ${f.code}: ${f.message}`,
      );
      for (const line of dataConsistencyWarnings) {
        console.warn(`[unifiedGenerator] client-fact check (${docType}): ${line}`);
      }
    }
  }

  // R5-034: a spouse document requires spouse data on file. Without it the swap
  // below is skipped, yet the document is still generated from the PRIMARY
  // client's data and saved under the `_spouse` docId — a misleading duplicate
  // of the primary's document in the spouse's vault slot. Fail loudly instead.
  if (params.spouseRole === 'spouse') {
    const sp = clientData.spouseInfo as Record<string, unknown> | undefined;
    if (!sp || (!sp.firstName && !sp.lastName)) {
      throw new HttpsError(
        'failed-precondition',
        'Cannot generate a spouse document: no spouse information is on file for this client.',
      );
    }
  }

  if (params.spouseRole === 'spouse' && clientData.spouseInfo) {
    const originalPersonal = { ...clientData.personalInfo };
    const originalSpouse = { ...clientData.spouseInfo };
    console.log(`[unifiedGenerator] Spouse swap for ${docType}: ${originalSpouse.firstName ?? 'unknown'} ↔ ${originalPersonal.firstName ?? 'unknown'}`);

    // The questionnaire's spouseInfo block typically captures name + dob +
    // citizenship but NOT address or gender (those are derived for the
    // primary client). When we swap to make the spouse the testator, the
    // resulting personalInfo can be missing those fields — which causes
    // downstream errors like "Gender is required" and blank address
    // renders on AD/POA templates. Backfill missing fields from the
    // original primary's data: spouses share a household address; gender
    // inverts under heteronormative marriage (skipped silently for
    // domestic-partnership where we can't infer).
    const backfillFields = ['address', 'city', 'state', 'zip', 'county', 'lastName'] as const;
    const swappedPersonal: Record<string, unknown> = { ...originalSpouse };
    for (const field of backfillFields) {
      const val = swappedPersonal[field];
      if ((val === undefined || val === null || val === '') && originalPersonal[field] !== undefined) {
        swappedPersonal[field] = originalPersonal[field];
      }
    }
    // Gender inversion is a heteronormative-marriage heuristic. It must NOT
    // apply to Domestic Partnership (or any non-married status) — the adjacent
    // comment claimed this was already skipped, but the code never checked
    // marital status and inverted regardless (R5-035). Gate it on 'Married';
    // for everything else leave gender undefined so the user sets it explicitly.
    const originalMaritalStatus =
      typeof originalPersonal.maritalStatus === 'string'
        ? (originalPersonal.maritalStatus as string).trim().toLowerCase()
        : '';
    if (
      !swappedPersonal.gender &&
      typeof originalPersonal.gender === 'string' &&
      originalMaritalStatus === 'married'
    ) {
      const og = (originalPersonal.gender as string).trim().toLowerCase();
      if (og === 'female') swappedPersonal.gender = 'male';
      else if (og === 'male') swappedPersonal.gender = 'female';
    }

    // Swap fiduciary entries whose relationship marks them as the spouse:
    // when generating Adam's doc via spouseRole='spouse' from Karen's vault,
    // Karen's fiduciaries say "agent: Adam (Husband)" — but in Adam's doc,
    // his spouse is Karen, not himself. Without this swap, Adam's AD would
    // appoint Adam as his own healthcare rep. Replaces the spouse-tagged
    // fiduciary's name with the now-spouse's full name and inverts the
    // relationship label to match the new testator's perspective.
    const HOUSEHOLD_REL = new Set(['spouse', 'husband', 'wife', 'partner', 'domestic partner']);
    // Kinship terms that flip to "in-law" on the spouse-swap view. The original
    // primary's blood relatives become the new testator's relatives-by-marriage.
    // Scope intentionally limited to siblings + parents (the unambiguous cases)
    // — Son/Daughter is left alone because the child could be a joint biological
    // child (still "Son"/"Daughter" on the spouse's view) or a stepchild from a
    // prior relationship (would be "Stepson"/"Stepdaughter"), and the data
    // model can't distinguish those.
    const IN_LAW_TRANSLATION = new Map<string, string>([
      ['brother', 'Brother-in-Law'],
      ['sister', 'Sister-in-Law'],
      ['mother', 'Mother-in-Law'],
      ['father', 'Father-in-Law'],
    ]);
    const newSpouseFullName = [originalPersonal.firstName, originalPersonal.middleName, originalPersonal.lastName].filter(Boolean).join(' ').trim();
    const newSpouseRelationship = (() => {
      const og = typeof originalPersonal.gender === 'string' ? (originalPersonal.gender as string).trim().toLowerCase() : '';
      if (og === 'female') return 'Wife';
      if (og === 'male') return 'Husband';
      return 'Spouse';
    })();
    const swapFiduciaries = (raw: Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
      if (!raw || typeof raw !== 'object') return raw;
      const out: Record<string, unknown> = { ...raw };
      for (const [role, roleVal] of Object.entries(out)) {
        if (!roleVal || typeof roleVal !== 'object') continue;
        const nextRole: Record<string, unknown> = { ...(roleVal as Record<string, unknown>) };
        for (const [tier, tierVal] of Object.entries(nextRole)) {
          if (!tierVal || typeof tierVal !== 'object') continue;
          const t = tierVal as Record<string, unknown>;
          const rel = typeof t.relationship === 'string' ? (t.relationship as string).trim().toLowerCase() : '';
          if (HOUSEHOLD_REL.has(rel)) {
            // Re-target this slot at the now-spouse (the original primary).
            nextRole[tier] = {
              ...t,
              name: newSpouseFullName || t.name,
              relationship: newSpouseRelationship,
              // Address fields auto-fill via the template-engine pass; clear
              // any stale ones tied to the previous person so the auto-fill
              // re-populates with the new testator's household address.
              address: '',
              city: '',
              state: '',
              zip: '',
              county: '',
            };
          } else if (IN_LAW_TRANSLATION.has(rel)) {
            // Translate the kinship term to its in-law equivalent — the
            // fiduciary stays the same person, only their relationship label
            // changes from the new testator's perspective.
            nextRole[tier] = {
              ...t,
              relationship: IN_LAW_TRANSLATION.get(rel),
            };
          }
        }
        out[role] = nextRole;
      }
      return out;
    };
    const swappedClientFiduciaries = swapFiduciaries(clientData.fiduciaries as Record<string, unknown> | undefined);

    // Swap clientData for generators
    clientData = {
      ...clientData,
      personalInfo: swappedPersonal,
      spouseInfo: originalPersonal,
      fiduciaries: swappedClientFiduciaries ?? clientData.fiduciaries,
    };

    // Swap clientContext for template engine
    if (clientContext?.client?.spouseInfo) {
      const ctxOriginalPersonal = { ...clientContext.client.personalInfo };
      const ctxOriginalSpouse = { ...clientContext.client.spouseInfo };
      // Apply the same backfills to the context-side copy so the template
      // engine sees the merged data on its render path.
      const ctxSwappedPersonal: Record<string, unknown> = { ...ctxOriginalSpouse };
      for (const field of backfillFields) {
        const val = ctxSwappedPersonal[field];
        if ((val === undefined || val === null || val === '') && ctxOriginalPersonal[field] !== undefined) {
          ctxSwappedPersonal[field] = ctxOriginalPersonal[field];
        }
      }
      if (!ctxSwappedPersonal.gender && typeof ctxOriginalPersonal.gender === 'string') {
        const og = (ctxOriginalPersonal.gender as string).trim().toLowerCase();
        if (og === 'female') ctxSwappedPersonal.gender = 'male';
        else if (og === 'male') ctxSwappedPersonal.gender = 'female';
      }
      clientContext.client.personalInfo = ctxSwappedPersonal;
      clientContext.client.spouseInfo = ctxOriginalPersonal;

      // Mirror the fiduciary swap on the context-side copy so the template
      // engine sees the same remapped entries on its render path.
      const ctxSwappedFiduciaries = swapFiduciaries(clientContext.client.fiduciaries as Record<string, unknown> | undefined);
      if (ctxSwappedFiduciaries) {
        clientContext.client.fiduciaries = ctxSwappedFiduciaries as never;
      }

      // Swap computed names
      const originalClientFullName = clientContext.computed.clientFullName;
      const originalSpouseFullName = clientContext.computed.spouseFullName;
      clientContext.computed.clientFullName = originalSpouseFullName;
      clientContext.computed.spouseFullName = originalClientFullName;

      // Swap derived spouse-title / client-title / pronouns. Without this,
      // generating Adam's will from Karen's vault would still report
      // spouseTitle='husband' (Karen's view) and Adam's will would say "my
      // husband" referring to Karen — wrong. Reflip from the now-current
      // testator's gender.
      const newGender = (ctxSwappedPersonal.gender as string | undefined)?.trim().toLowerCase();
      // The new spouse IS the original primary, whose actual gender is reliably
      // captured. Derive the spouse's title/pronouns from THAT — not by
      // inverting the new testator's gender, which assumed an opposite-sex
      // marriage and rendered a same-sex spouse with the wrong title and
      // pronouns (R5-003).
      const newSpouseGender = (ctxOriginalPersonal.gender as string | undefined)?.trim().toLowerCase();
      const newClientIsFemale = newGender === 'female';
      const newSpouseIsFemale = newSpouseGender === 'female';
      const newMaritalStatus = (ctxSwappedPersonal.maritalStatus as string | undefined) ?? '';
      const isDP = newMaritalStatus === 'Domestic Partnership';
      if (isDP) {
        clientContext.computed.spouseTitle = 'partner';
        clientContext.computed.clientTitle = 'partner';
      } else {
        if (newSpouseGender) clientContext.computed.spouseTitle = newSpouseIsFemale ? 'wife' : 'husband';
        if (newGender) clientContext.computed.clientTitle = newClientIsFemale ? 'wife' : 'husband';
      }
      if (newGender || newSpouseGender) {
        const malePronouns = { subject: 'he', object: 'him', possessive: 'his' };
        const femalePronouns = { subject: 'she', object: 'her', possessive: 'her' };
        const neutralPronouns = { subject: 'they', object: 'them', possessive: 'their' };
        clientContext.computed.clientPronouns = newGender ? (newClientIsFemale ? femalePronouns : malePronouns) : neutralPronouns;
        clientContext.computed.spousePronouns = newSpouseGender ? (newSpouseIsFemale ? femalePronouns : malePronouns) : neutralPronouns;

        // Recompute fiduciary pronouns now that the testator perspective has
        // flipped. A spouse-tagged fiduciary slot now points at the new
        // spouse (the original primary), so its inferred pronoun must follow
        // the new spousePronouns. Any non-spouse slot retains its slot's
        // explicit gender if set, else neutral.
        const HOUSEHOLD_REL = new Set(['spouse', 'husband', 'wife', 'partner', 'domestic partner']);
        // Same relationship-gender inference as client-context-aggregator —
        // kept inline so the spouse-swap rebuild stays self-contained.
        const FEMALE_REL = new Set([
          'wife', 'mother', 'daughter', 'sister', 'grandmother', 'granddaughter',
          'aunt', 'niece', 'mother-in-law', 'daughter-in-law', 'sister-in-law',
          'great-grandmother', 'great-granddaughter', 'great-aunt', 'great-niece',
          'great-great-grandmother', 'great-great-granddaughter',
        ]);
        const MALE_REL = new Set([
          'husband', 'father', 'son', 'brother', 'grandfather', 'grandson',
          'uncle', 'nephew', 'father-in-law', 'son-in-law', 'brother-in-law',
          'great-grandfather', 'great-grandson', 'great-uncle', 'great-nephew',
          'great-great-grandfather', 'great-great-grandson',
        ]);
        const newSpousePronouns = clientContext.computed.spousePronouns;
        const recompute = (slot: Record<string, unknown> | undefined) => {
          if (!slot || typeof slot !== 'object') return neutralPronouns;
          const explicit = typeof slot.gender === 'string' ? (slot.gender as string).trim().toLowerCase() : '';
          if (explicit === 'male') return malePronouns;
          if (explicit === 'female') return femalePronouns;
          const rel = typeof slot.relationship === 'string' ? (slot.relationship as string).trim().toLowerCase() : '';
          if (HOUSEHOLD_REL.has(rel)) return newSpousePronouns;
          if (FEMALE_REL.has(rel)) return femalePronouns;
          if (MALE_REL.has(rel)) return malePronouns;
          return neutralPronouns;
        };
        const fids = clientContext.client.fiduciaries as Record<string, Record<string, Record<string, unknown> | undefined> | undefined> | undefined;
        clientContext.computed.poaAgentPronouns = recompute(fids?.powerOfAttorney?.agent);
        clientContext.computed.poaAlternateAgentPronouns = recompute(fids?.powerOfAttorney?.alternateAgent);
        clientContext.computed.healthcareRepPronouns = recompute(fids?.healthcareProxy?.agent);
        clientContext.computed.healthcareRepAlternatePronouns = recompute(fids?.healthcareProxy?.alternateAgent);
        clientContext.computed.executorPronouns = recompute(fids?.executor?.primary);
        clientContext.computed.executorAlternatePronouns = recompute(fids?.executor?.alternate);
        clientContext.computed.trusteePronouns = recompute(fids?.trustee?.primary);
        clientContext.computed.trusteeAlternatePronouns = recompute(fids?.trustee?.alternate);
      }
    }
  }

  // Prefer the tier the caller requested for THIS run (the batch entry point
  // persists it to the client doc only after generation), falling back to the
  // stored value, then the intake default.
  const packageType = params.packageType ?? clientData.packageDetails?.packageType ?? 'foundation';

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
  // Hoisted to function scope so the structural-validation retry below can
  // forward the resolved property to per-property generators (deed/affidavit/
  // gitRep3). Without it, the retry regenerates these docs with no property and
  // silently drops the address, block/lot, county, etc.
  let property: admin.firestore.DocumentData | undefined;

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
          // Forward the resolved `property` for per-property docs; it is
          // undefined (and ignored) for all other generators.
          const retryDoc = await retryGeneratorFn!(
            retryClientData, firmData, packageType, trustTypes, property,
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

  // ------------------------------------------------------------------
  // 3c. Post-generation CONTENT integrity check (all modes, including template)
  // ------------------------------------------------------------------
  // Catches symptoms that template mode can still produce: unresolved
  // Handlebars, empty fiduciary slots, missing client name, double-period
  // typos. Findings merge with structural ones; same Firestore field, same
  // status semantics. Does NOT trigger retries — these are mostly
  // post-processing/data issues, not AI-output issues.
  if (generatedDoc.status !== 'error' && generatedDoc.content) {
    const integrity = checkContentIntegrity(generatedDoc.content, docType, clientContext);
    if (integrity.findings.length > 0) {
      console.warn(
        `[unifiedGenerator] CONTENT INTEGRITY for ${docType}: ` +
          integrity.findings
            .map((f) => `[${f.severity}] ${f.name}${f.detail ? ` — ${f.detail}` : ''}`)
            .join('; '),
      );
      validationFindings = [
        ...validationFindings,
        ...integrity.findings.map((f) => ({ name: f.name, severity: f.severity })),
      ];
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
    mode: generationMode,
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
    console.info(`[unifiedGenerator] ✓ ${docType} generated: ${textLength} chars, ${genElapsedMs}ms, mode=${generationMode}, status=${finalStatus}`);
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
      status: finalStatus,
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
      warnings:
        completenessWarnings.length > 0 || dataConsistencyWarnings.length > 0
          ? [...dataConsistencyWarnings, ...completenessWarnings]
          : undefined,
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
    generationMode,
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
