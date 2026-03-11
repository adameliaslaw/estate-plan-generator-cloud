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
  createdAt: any;
}

export interface KBSnapshot {
  id: string;
  title: string;
  citation?: string;
  content: string;
  category: string;
  tags: string[];
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

  let kbQuery: admin.firestore.Query = db
    .collection(`firms/${firmId}/knowledgeBase`)
    .where('isActive', '==', true);

  if (targetDocType) {
    kbQuery = kbQuery.where('docTypes', 'array-contains', targetDocType);
  }

  const [notesSnap, docsSnap, kbSnap] = await Promise.all([
    notesQuery.get(),
    docsQuery.get(),
    kbQuery.limit(50).get(),
  ]);

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
      createdAt: data.createdAt,
    };
  });

  const knowledgeResources: KBSnapshot[] = kbSnap.docs.map((d) => {
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
): Promise<MinimalContext> {
  const db = admin.firestore();

  const [firmSnap, kbSnap] = await Promise.all([
    db.doc(`firms/${firmId}`).get(),
    db.collection(`firms/${firmId}/knowledgeBase`)
      .where('isActive', '==', true)
      .limit(50)
      .get(),
  ]);

  if (!firmSnap.exists) {
    throw new Error(`Firm ${firmId} not found.`);
  }

  const knowledgeResources: KBSnapshot[] = kbSnap.docs.map((d) => {
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

  return {
    firm: firmSnap.data()!,
    knowledgeResources,
  };
}
