/**
 * functions/src/client-context-aggregator.ts
 *
 * Assembles the full client context for any document generation flow.
 * Pulls together:
 *   1. Client profile + questionnaire data (from Firestore client doc)
 *   2. Client notes (from notes subcollection)
 *   3. Existing vault documents (summaries from documents subcollection)
 *   4. Knowledge base resources (filtered by target docType)
 *
 * Returns a unified ClientContext consumed by the template engine,
 * AI generators (hybrid mode), and the chatbot drafting assistant.
 */

import * as admin from 'firebase-admin';
import { loadFirmSecrets } from './firm-secrets';
import { searchKnowledgeBase, buildContextQuery, VectorSearchResult } from './kb-vector-search';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClientContext {
  /** Full client data from Firestore */
  client: admin.firestore.DocumentData;
  /** Firm data */
  firm: admin.firestore.DocumentData;
  /** Derived/computed fields for easy template access */
  computed: ComputedFields;
  /** Recent client notes (last 20) */
  notes: NoteSnapshot[];
  /** Existing vault documents (metadata only) */
  existingDocuments: DocSnapshot[];
  /** Relevant knowledge base resources */
  knowledgeResources: KBSnapshot[];
}

export interface ComputedFields {
  clientFullName: string;
  spouseFullName: string;
  hasSpouse: boolean;
  hasMinorChildren: boolean;
  hasSpecialNeedsChild: boolean;
  childCount: number;
  minorChildren: Record<string, unknown>[];
  adultChildren: Record<string, unknown>[];
  propertyCount: number;
  propertiesForTrust: Record<string, unknown>[];
  estimatedTotalAssets: number;
  primaryTrustName: string;
  todayFormatted: string;
  todayISO: string;
  packageType: string;
  packageLabel: string;
  // Relationship titles
  spouseTitle: string;            // "husband" | "wife" | "spouse" | "partner"
  clientTitle: string;            // "wife" | "husband" | "spouse" | "partner" (reverse of spouseTitle)
  clientPronouns: { subject: string; object: string; possessive: string };
  spousePronouns: { subject: string; object: string; possessive: string };
  executorTitle: string;          // from fiduciaries.executor.primary.relationship, lowercased
  alternateExecutorTitle: string;
  trusteeTitle: string;
  poaAgentTitle: string;
  healthcareRepTitle: string;
  guardianTitle: string;
  // Fiduciary pronouns — derived from explicit gender field on the
  // fiduciary slot, or inferred from spouse-relationship + spouse gender.
  // Falls back to neutral pronouns when AIF gender is unknown so templates
  // don't render with the wrong specific pronoun.
  poaAgentPronouns: { subject: string; object: string; possessive: string };
  poaAlternateAgentPronouns: { subject: string; object: string; possessive: string };
  healthcareRepPronouns: { subject: string; object: string; possessive: string };
  healthcareRepAlternatePronouns: { subject: string; object: string; possessive: string };
  executorPronouns: { subject: string; object: string; possessive: string };
  executorAlternatePronouns: { subject: string; object: string; possessive: string };
  trusteePronouns: { subject: string; object: string; possessive: string };
  trusteeAlternatePronouns: { subject: string; object: string; possessive: string };
  // Children enriched with relationship titles
  childrenWithTitles: Array<Record<string, unknown> & { childTitle: string }>;
  /** Fields missing from the client data that could cause document issues */
  missingFields: string[];
}

export interface NoteSnapshot {
  id: string;
  title?: string;
  content: string;
  noteType: string;
  transcription?: string;
  aiSummary?: string;
  createdAt: admin.firestore.Timestamp | Date;
}

export interface DocSnapshot {
  id: string;
  docType: string;
  displayName: string;
  status: string;
  content?: string;
  createdAt: admin.firestore.Timestamp | Date;
}

export interface KBSnapshot {
  id: string;
  title: string;
  citation?: string;
  content: string;
  category: string;
  tags: string[];
  similarity?: number;
}

// ---------------------------------------------------------------------------
// Main aggregator
// ---------------------------------------------------------------------------

export async function aggregateClientContext(
  firmId: string,
  clientId: string,
  targetDocType?: string,
): Promise<ClientContext> {
  const db = admin.firestore();

  // 1. Fetch client + firm data (parallel)
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

  const client = clientSnap.data()!;
  const firm = { ...firmSnap.data()!, ...(await loadFirmSecrets(firmId)) };

  // 2. Fetch notes, existing documents, and knowledge base (parallel)
  const notesQuery = db
    .collection(`firms/${firmId}/clients/${clientId}/notes`)
    .orderBy('createdAt', 'desc')
    .limit(20);

  const docsQuery = db
    .collection(`firms/${firmId}/clients/${clientId}/documents`)
    .orderBy('createdAt', 'desc')
    .limit(50);

  // Build context-aware search query from client characteristics
  const searchQuery = buildContextQuery(client, targetDocType);

  const [notesSnap, docsSnap, kbResults] = await Promise.all([
    notesQuery.get(),
    docsQuery.get(),
    searchKnowledgeBase(firmId, searchQuery, {
      docType: targetDocType,
      limit: 15,
    }).catch((err) => {
      console.warn('[aggregateClientContext] Vector search failed, falling back to flat query:', err);
      return null;
    }),
  ]);

  // Fallback: if vector search failed, use flat query
  let kbSnap: admin.firestore.QuerySnapshot | null = null;
  if (!kbResults) {
    let kbQuery: admin.firestore.Query = db
      .collection(`firms/${firmId}/knowledgeBase`)
      .where('isActive', '==', true);
    if (targetDocType) {
      kbQuery = kbQuery.where('docTypes', 'array-contains', targetDocType);
    }
    kbSnap = await kbQuery.limit(10).get();
  }

  // 3. Map results
  const notes: NoteSnapshot[] = notesSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      title: data.title,
      content: data.content ?? '',
      noteType: data.noteType ?? 'general',
      transcription: data.transcription,
      aiSummary: data.aiSummary,
      createdAt: data.createdAt,
    };
  });

  const existingDocuments: DocSnapshot[] = docsSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      docType: data.docType,
      displayName: data.displayName ?? d.id,
      status: data.status ?? 'draft',
      content: data.content,
      createdAt: data.createdAt,
    };
  });

  // Map KB results from vector search or flat query fallback
  let knowledgeResources: KBSnapshot[];
  if (kbResults) {
    knowledgeResources = kbResults.map((r: VectorSearchResult) => ({
      id: r.id,
      title: r.title,
      citation: r.citation,
      content: r.content,
      category: r.category,
      tags: r.tags,
      similarity: r.similarity,
    }));
  } else if (kbSnap) {
    knowledgeResources = kbSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        title: data.title,
        citation: data.citation,
        content: data.content,
        category: data.category,
        tags: data.tags ?? [],
      };
    });
  } else {
    knowledgeResources = [];
  }

  // 4. Compute derived fields
  const computed = computeFields(client, firm);

  return {
    client,
    firm,
    computed,
    notes,
    existingDocuments,
    knowledgeResources,
  };
}

// ---------------------------------------------------------------------------
// Compute derived fields
// ---------------------------------------------------------------------------

/**
 * Joins split-name parts into a single full-name string.
 * Empty/whitespace-only parts are dropped so we never emit "John  Smith".
 */
function joinNameParts(p: {
  firstName?: unknown;
  middleName?: unknown;
  lastName?: unknown;
  suffix?: unknown;
}): string {
  return [p.firstName, p.middleName, p.lastName, p.suffix]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((s) => s.length > 0)
    .join(' ');
}

/**
 * If a fiduciary or repeater-item slot has split-name parts set, derive the
 * legacy `.name` field from them in place. No-op when firstName is empty
 * (legacy entries — `.name` already holds the canonical value).
 */
function deriveNameInPlace(slot: Record<string, unknown> | undefined | null): void {
  if (!slot || typeof slot !== 'object') return;
  const firstName = typeof slot.firstName === 'string' ? slot.firstName.trim() : '';
  if (firstName.length === 0) return;
  const joined = joinNameParts(slot as Record<string, unknown>);
  if (joined.length > 0) slot.name = joined;
}

function computeFields(
  client: admin.firestore.DocumentData,
  _firm: admin.firestore.DocumentData,
): ComputedFields {
  const pi = client.personalInfo ?? {};
  const spouse = client.spouseInfo;
  const children: Array<Record<string, unknown>> = client.children ?? [];
  const assets = client.assets ?? {};
  const realEstate: Array<Record<string, unknown>> = assets.realEstate ?? [];
  const trusts: Array<Record<string, unknown>> = client.trusts ?? [];
  const packageDetails = client.packageDetails ?? {};

  // -- Address auto-fill: copy client address to spouse/children if sameAddress --
  if (spouse && spouse.sameAddress === true) {
    spouse.address = spouse.address || pi.address;
    spouse.city = spouse.city || pi.city;
    spouse.state = spouse.state || pi.state;
    spouse.zip = spouse.zip || pi.zip;
    spouse.county = spouse.county || pi.county;
  }
  for (const child of children) {
    if (child.sameAddress === true) {
      child.address = child.address || pi.address;
      child.city = child.city || pi.city;
      child.state = child.state || pi.state;
      child.zip = child.zip || pi.zip;
      child.county = child.county || pi.county;
    }
  }

  // -- Name derivation: write joined name back into .name when split parts are set --
  // The 2026-05-27 name-split refactor adds firstName/middleName/lastName/suffix
  // to every fiduciary slot + repeater item. Existing Firestore templates bind
  // {{...name}} directly, so we keep that field populated from the split parts
  // for back-compat. New questionnaire entries fill the split fields; the
  // joined string is computed once here and consumed everywhere downstream.
  const fidNS = client.fiduciaries ?? {};
  deriveNameInPlace(fidNS.executor?.primary);
  deriveNameInPlace(fidNS.executor?.alternate);
  deriveNameInPlace(fidNS.executor?.successor);
  deriveNameInPlace(fidNS.executor?.secondSuccessor);
  deriveNameInPlace(fidNS.trustee?.primary);
  deriveNameInPlace(fidNS.trustee?.alternate);
  deriveNameInPlace(fidNS.trustee?.successor);
  deriveNameInPlace(fidNS.trustee?.coTrustee);
  deriveNameInPlace(fidNS.powerOfAttorney?.agent);
  deriveNameInPlace(fidNS.powerOfAttorney?.alternateAgent);
  deriveNameInPlace(fidNS.powerOfAttorney?.successorAgent);
  deriveNameInPlace(fidNS.healthcareProxy?.agent);
  deriveNameInPlace(fidNS.healthcareProxy?.alternateAgent);
  deriveNameInPlace(fidNS.healthcareProxy?.successorAgent);
  deriveNameInPlace(fidNS.guardian?.primary);
  deriveNameInPlace(fidNS.guardian?.alternate);
  deriveNameInPlace(client.guardianPrimary);
  deriveNameInPlace(client.guardianAlternate);
  for (const child of children) deriveNameInPlace(child);
  const grandchildren: Array<Record<string, unknown>> = client.grandchildren ?? [];
  for (const gc of grandchildren) deriveNameInPlace(gc);
  const otherDependents: Array<Record<string, unknown>> = client.otherDependents ?? [];
  for (const od of otherDependents) deriveNameInPlace(od);

  const clientFullName = [pi.firstName, pi.middleName, pi.lastName, pi.suffix]
    .filter(Boolean)
    .join(' ');

  const spouseFullName = spouse
    ? [spouse.firstName, spouse.middleName, spouse.lastName]
      .filter(Boolean)
      .join(' ')
    : '';

  const hasSpouse = ['Married', 'Domestic Partnership'].includes(pi.maritalStatus);
  const minorChildren = children.filter((c) => c.isMinor === true);
  const adultChildren = children.filter((c) => c.isMinor !== true);
  const hasSpecialNeedsChild = children.some((c) => c.specialNeeds === true);
  const propertiesForTrust = realEstate.filter((p) => p.transferToTrust === true);

  // -- Relationship titles --------------------------------------------------
  const isDomesticPartnership = pi.maritalStatus === 'Domestic Partnership';
  // Prefer new explicit gender field; fall back to legacy isFemale boolean.
  // Normalize case + whitespace so "Female", " female ", "FEMALE" all match —
  // the Firestore admin console is a common source of mis-cased string values.
  const normalizedGender =
    typeof pi.gender === 'string' ? pi.gender.trim().toLowerCase() : undefined;
  const clientIsFemale =
    normalizedGender === 'female' ||
    (normalizedGender == null && client.isFemale === true);

  let spouseTitle: string;
  let clientTitle: string;
  if (!hasSpouse) {
    spouseTitle = '';
    clientTitle = '';
  } else if (isDomesticPartnership) {
    spouseTitle = 'partner';
    clientTitle = 'partner';
  } else if (clientIsFemale) {
    spouseTitle = 'husband';   // client is female → spouse is husband
    clientTitle = 'wife';      // client's own title is wife
  } else {
    spouseTitle = 'wife';      // client is male → spouse is wife
    clientTitle = 'husband';   // client's own title is husband
  }

  const malePronouns = { subject: 'he', object: 'him', possessive: 'his' };
  const femalePronouns = { subject: 'she', object: 'her', possessive: 'her' };
  const neutralPronouns = { subject: 'they', object: 'them', possessive: 'their' };

  const clientPronouns = clientIsFemale ? femalePronouns : malePronouns;
  const spousePronouns = hasSpouse
    ? (isDomesticPartnership ? neutralPronouns : (clientIsFemale ? malePronouns : femalePronouns))
    : neutralPronouns;

  // Fiduciary relationship titles (lowercased, from questionnaire free-text)
  const fid = client.fiduciaries ?? {};
  const executorTitle = (fid.executor?.primary?.relationship ?? '').toLowerCase();
  const alternateExecutorTitle = (fid.executor?.alternate?.relationship ?? '').toLowerCase();
  const trusteeTitle = (fid.trustee?.primary?.relationship ?? '').toLowerCase();
  const poaAgentTitle = (fid.powerOfAttorney?.agent?.relationship ?? fid.poaAgent?.primary?.relationship ?? '').toLowerCase();
  const healthcareRepTitle = (fid.healthcareProxy?.agent?.relationship ?? fid.healthcareRep?.primary?.relationship ?? '').toLowerCase();
  const guardianTitle = (client.guardianPrimary?.relationship ?? fid.guardian?.primary?.relationship ?? '').toLowerCase();

  // Fiduciary pronouns — separate from clientPronouns/spousePronouns so a
  // template can correctly render "her obligation" vs "his obligation" when
  // the AIF's gender differs from the principal's. Resolution priority:
  //   1. Explicit `gender` field on the fiduciary (Phase 2 — not yet collected)
  //   2. Spouse-relationship → spouse pronouns (when AIF is the spouse)
  //   3. Relationship-implied gender (Mother/Father/Sister/etc — most family
  //      titles in the questionnaire dropdown unambiguously imply a gender)
  //   4. Falls back to neutralPronouns so templates that hardcode an
  //      AIF-pronoun assumption don't render with the WRONG specific pronoun
  //      when AIF gender is genuinely ambiguous (Spouse/Parent/Child/etc).
  const HOUSEHOLD_REL = new Set(['spouse', 'husband', 'wife', 'partner', 'domestic partner']);
  // Relationship words that unambiguously imply a gender. Spouse/Parent/
  // Child/Sibling/Cousin/Friend/etc are intentionally NOT here — those are
  // genuinely ambiguous and fall through to neutral pronouns.
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
  function pronounsForFiduciary(slot: Record<string, unknown> | undefined) {
    if (!slot || typeof slot !== 'object') return neutralPronouns;
    const explicit = typeof slot.gender === 'string' ? (slot.gender as string).trim().toLowerCase() : '';
    if (explicit === 'male') return malePronouns;
    if (explicit === 'female') return femalePronouns;
    const rel = typeof slot.relationship === 'string' ? (slot.relationship as string).trim().toLowerCase() : '';
    if (HOUSEHOLD_REL.has(rel) && hasSpouse) return spousePronouns;
    if (FEMALE_REL.has(rel)) return femalePronouns;
    if (MALE_REL.has(rel)) return malePronouns;
    return neutralPronouns;
  }
  const poaAgentPronouns = pronounsForFiduciary(fid.powerOfAttorney?.agent ?? fid.poaAgent?.primary);
  const poaAlternateAgentPronouns = pronounsForFiduciary(fid.powerOfAttorney?.alternateAgent);
  const healthcareRepPronouns = pronounsForFiduciary(fid.healthcareProxy?.agent ?? fid.healthcareRep?.primary);
  const healthcareRepAlternatePronouns = pronounsForFiduciary(fid.healthcareProxy?.alternateAgent);
  const executorPronouns = pronounsForFiduciary(fid.executor?.primary);
  const executorAlternatePronouns = pronounsForFiduciary(fid.executor?.alternate);
  const trusteePronouns = pronounsForFiduciary(fid.trustee?.primary);
  const trusteeAlternatePronouns = pronounsForFiduciary(fid.trustee?.alternate);

  // Enrich children with gendered titles ("son", "daughter", "child")
  const childrenWithTitles = children.map((c) => {
    const gender = (c.gender as string) ?? '';
    let childTitle: string;
    if (gender === 'male') childTitle = 'son';
    else if (gender === 'female') childTitle = 'daughter';
    else childTitle = 'child';
    // Stepchildren get prefixed
    if (c.relationship === 'stepchild') {
      childTitle = gender === 'male' ? 'stepson' : gender === 'female' ? 'stepdaughter' : 'stepchild';
    }
    return { ...c, childTitle };
  });

  // Estimate total assets
  let estimatedTotalAssets = 0;
  for (const p of realEstate) estimatedTotalAssets += (p.estimatedValue as number) ?? 0;
  for (const a of assets.bankAccounts ?? []) estimatedTotalAssets += (a.estimatedBalance as number) ?? 0;
  for (const a of assets.investmentAccounts ?? []) estimatedTotalAssets += (a.estimatedValue as number) ?? 0;
  for (const a of assets.retirementAccounts ?? []) estimatedTotalAssets += (a.estimatedValue as number) ?? 0;
  for (const a of assets.lifeInsurance ?? []) estimatedTotalAssets += (a.cashValue as number) ?? (a.faceValue as number) ?? 0;
  for (const a of assets.businessInterests ?? []) estimatedTotalAssets += (a.estimatedValue as number) ?? 0;
  for (const a of assets.personalProperty ?? []) estimatedTotalAssets += (a.estimatedValue as number) ?? 0;

  if (typeof assets.estimatedTotalEstate === 'number' && assets.estimatedTotalEstate > 0) {
    estimatedTotalAssets = assets.estimatedTotalEstate;
  }

  const primaryTrustName = trusts[0]?.trustName ??
    client.distribution?.trustName ??
    `The ${clientFullName} Revocable Living Trust`;

  const packageLabels: Record<string, string> = {
    foundation: 'Basic Estate Plan',
    guardian: 'Revocable Trust',
    fortress: 'Irrevocable Trust',
  };

  const now = new Date();
  const todayFormatted = now.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const todayISO = now.toISOString().split('T')[0];

  return {
    clientFullName,
    spouseFullName,
    hasSpouse,
    hasMinorChildren: minorChildren.length > 0,
    hasSpecialNeedsChild,
    childCount: children.length,
    minorChildren,
    adultChildren,
    propertyCount: realEstate.length,
    propertiesForTrust,
    estimatedTotalAssets,
    primaryTrustName,
    todayFormatted,
    todayISO,
    packageType: packageDetails.packageType ?? 'foundation',
    packageLabel: packageLabels[packageDetails.packageType] ?? 'Basic Estate Plan',
    // Relationship titles
    spouseTitle,
    clientTitle,
    clientPronouns,
    spousePronouns,
    executorTitle,
    alternateExecutorTitle,
    trusteeTitle,
    poaAgentTitle,
    healthcareRepTitle,
    guardianTitle,
    // Fiduciary pronouns (see pronounsForFiduciary above for resolution logic)
    poaAgentPronouns,
    poaAlternateAgentPronouns,
    healthcareRepPronouns,
    healthcareRepAlternatePronouns,
    executorPronouns,
    executorAlternatePronouns,
    trusteePronouns,
    trusteeAlternatePronouns,
    childrenWithTitles,
    missingFields: computeMissingFields(pi, spouse, hasSpouse, realEstate),
  };
}

// ---------------------------------------------------------------------------
// Missing field detection — surfaces warnings during document generation
// ---------------------------------------------------------------------------

const NJ_COUNTIES = [
  'Atlantic', 'Bergen', 'Burlington', 'Camden', 'Cape May', 'Cumberland',
  'Essex', 'Gloucester', 'Hudson', 'Hunterdon', 'Mercer', 'Middlesex',
  'Monmouth', 'Morris', 'Ocean', 'Passaic', 'Salem', 'Somerset',
  'Sussex', 'Union', 'Warren',
];

function computeMissingFields(
  pi: Record<string, unknown>,
  spouse: Record<string, unknown> | undefined,
  hasSpouse: boolean,
  realEstate: Array<Record<string, unknown>>,
): string[] {
  const missing: string[] = [];

  // County is critical for NJ estate documents (probate courts are county-based)
  const state = (pi.state as string) ?? 'NJ';
  if (state === 'NJ' && !pi.county) {
    missing.push('personalInfo.county');
  }
  // Validate county value if present but not in the NJ list
  if (state === 'NJ' && pi.county && !NJ_COUNTIES.includes(pi.county as string)) {
    missing.push('personalInfo.county (invalid NJ county)');
  }

  // Spouse county for NJ
  if (hasSpouse && spouse) {
    const spState = (spouse.state as string) ?? state;
    if (spState === 'NJ' && !spouse.county) {
      missing.push('spouseInfo.county');
    }
  }

  // Property legal descriptions — needed for deeds
  realEstate.forEach((p, i) => {
    if (!p.legalDescription && !p.blockLot) {
      missing.push(`assets.realEstate[${i}].legalDescription`);
    }
  });

  return missing;
}

// ---------------------------------------------------------------------------
// Minimal context (firm + KB only, no client required)
// ---------------------------------------------------------------------------

export interface MinimalContext {
  firm: admin.firestore.DocumentData;
  knowledgeResources: KBSnapshot[];
}

/**
 * Lightweight context for scenarios without a specific client
 * (e.g., chatbot in general Q&A mode). Returns firm data and
 * up to 50 active knowledge base resources.
 */
export async function aggregateMinimalContext(
  firmId: string,
  searchQuery?: string,
): Promise<MinimalContext> {
  const db = admin.firestore();

  const firmSnap = await db.doc(`firms/${firmId}`).get();
  if (!firmSnap.exists) {
    throw new Error(`Firm ${firmId} not found.`);
  }

  // Use vector search if a query is provided, otherwise fall back to flat query
  let knowledgeResources: KBSnapshot[];
  if (searchQuery) {
    try {
      const results = await searchKnowledgeBase(firmId, searchQuery, { limit: 15 });
      knowledgeResources = results.map((r) => ({
        id: r.id,
        title: r.title,
        citation: r.citation,
        content: r.content,
        category: r.category,
        tags: r.tags,
        similarity: r.similarity,
      }));
    } catch (err) {
      console.warn('[aggregateMinimalContext] Vector search failed, falling back to flat query:', err);
      knowledgeResources = await _flatKBQuery(firmId);
    }
  } else {
    knowledgeResources = await _flatKBQuery(firmId);
  }

  return {
    firm: { ...firmSnap.data()!, ...(await loadFirmSecrets(firmId)) },
    knowledgeResources,
  };
}

/** Fallback flat Firestore query for KB resources */
async function _flatKBQuery(firmId: string): Promise<KBSnapshot[]> {
  const db = admin.firestore();
  const kbSnap = await db
    .collection(`firms/${firmId}/knowledgeBase`)
    .where('isActive', '==', true)
    .limit(10)
    .get();

  return kbSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      title: data.title,
      citation: data.citation,
      content: data.content,
      category: data.category,
      tags: data.tags ?? [],
    };
  });
}
