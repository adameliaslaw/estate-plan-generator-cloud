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
  minorChildren: any[];
  adultChildren: any[];
  propertyCount: number;
  propertiesForTrust: any[];
  estimatedTotalAssets: number;
  primaryTrustName: string;
  todayFormatted: string;
  todayISO: string;
  packageType: string;
  packageLabel: string;
}

export interface NoteSnapshot {
  id: string;
  title?: string;
  content: string;
  noteType: string;
  transcription?: string;
  aiSummary?: string;
  createdAt: any;
}

export interface DocSnapshot {
  id: string;
  docType: string;
  displayName: string;
  status: string;
  content?: string;
  createdAt: any;
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
  const firm = firmSnap.data()!;

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
    kbSnap = await kbQuery.limit(50).get();
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

function computeFields(
  client: admin.firestore.DocumentData,
  firm: admin.firestore.DocumentData,
): ComputedFields {
  const pi = client.personalInfo ?? {};
  const spouse = client.spouseInfo;
  const children: any[] = client.children ?? [];
  const assets = client.assets ?? {};
  const realEstate: any[] = assets.realEstate ?? [];
  const trusts: any[] = client.trusts ?? [];
  const packageDetails = client.packageDetails ?? {};

  const clientFullName = [pi.firstName, pi.middleName, pi.lastName, pi.suffix]
    .filter(Boolean)
    .join(' ');

  const spouseFullName = spouse
    ? [spouse.firstName, spouse.middleName, spouse.lastName]
        .filter(Boolean)
        .join(' ')
    : '';

  const hasSpouse = ['Married', 'Domestic Partnership'].includes(pi.maritalStatus);
  const minorChildren = children.filter((c: any) => c.isMinor === true);
  const adultChildren = children.filter((c: any) => c.isMinor !== true);
  const hasSpecialNeedsChild = children.some((c: any) => c.specialNeeds === true);
  const propertiesForTrust = realEstate.filter((p: any) => p.transferToTrust === true);

  // Estimate total assets
  let estimatedTotalAssets = 0;
  for (const p of realEstate) estimatedTotalAssets += p.estimatedValue ?? 0;
  for (const a of assets.bankAccounts ?? []) estimatedTotalAssets += a.estimatedBalance ?? 0;
  for (const a of assets.investmentAccounts ?? []) estimatedTotalAssets += a.estimatedValue ?? 0;
  for (const a of assets.retirementAccounts ?? []) estimatedTotalAssets += a.estimatedValue ?? 0;
  for (const a of assets.lifeInsurance ?? []) estimatedTotalAssets += a.cashValue ?? a.faceValue ?? 0;
  for (const a of assets.businessInterests ?? []) estimatedTotalAssets += a.estimatedValue ?? 0;
  for (const a of assets.personalProperty ?? []) estimatedTotalAssets += a.estimatedValue ?? 0;

  if (typeof assets.estimatedTotalEstate === 'number' && assets.estimatedTotalEstate > 0) {
    estimatedTotalAssets = assets.estimatedTotalEstate;
  }

  const primaryTrustName = trusts[0]?.trustName ??
    client.distribution?.trustName ??
    `The ${clientFullName} Revocable Living Trust`;

  const packageLabels: Record<string, string> = {
    foundation: 'Foundation',
    guardian: 'Guardian',
    fortress: 'Fortress',
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
    packageLabel: packageLabels[packageDetails.packageType] ?? 'Foundation',
  };
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
    firm: firmSnap.data()!,
    knowledgeResources,
  };
}

/** Fallback flat Firestore query for KB resources */
async function _flatKBQuery(firmId: string): Promise<KBSnapshot[]> {
  const db = admin.firestore();
  const kbSnap = await db
    .collection(`firms/${firmId}/knowledgeBase`)
    .where('isActive', '==', true)
    .limit(50)
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
