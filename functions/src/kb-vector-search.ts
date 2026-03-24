/**
 * functions/src/kb-vector-search.ts
 *
 * Core semantic search module for the Knowledge Base.
 * Uses Firestore's native vector search (`findNearest`) with
 * Gemini gemini-embedding-001 (768 dimensions).
 *
 * Features:
 *  - Generates query embedding, then runs findNearest on both
 *    the knowledgeBase collection and the chunks subcollection
 *  - Merges results, deduplicates chunks from the same parent
 *  - Returns full content, similarity scores, and resource metadata
 *  - Pre-filters: isActive == true, optional docType
 */

import * as admin from 'firebase-admin';
import { generateEmbedding } from './kb-embeddings';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VectorSearchOptions {
  /** Filter results to resources tagged for this document type */
  docType?: string;
  /** Maximum number of results to return (default: 15) */
  limit?: number;
  /** Minimum similarity score to include (0–1, default: 0.3) */
  minScore?: number;
  /** Exclude OCR-sourced content (default: false) */
  excludeOcr?: boolean;
  /** Scope chat insight results to a specific client (optional) */
  clientId?: string;
}

export interface VectorSearchResult {
  id: string;
  title: string;
  citation?: string;
  content: string;
  category: string;
  tags: string[];
  /** Cosine similarity score (0–1, higher is more relevant) */
  similarity: number;
  /** Whether this result came from a chunk vs. the full document */
  isChunk: boolean;
  /** For chunk results, the index of the chunk within the parent */
  chunkIndex?: number;
  /** Source of the result */
  sourceType: 'kb' | 'template' | 'chatInsight';
  /** Client ID (for chatInsight results) */
  clientId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Retrieve the firm's Gemini API key.
 */
export async function getGeminiApiKey(firmId: string): Promise<string> {
  const firmSnap = await admin.firestore().doc(`firms/${firmId}`).get();
  const firmData = firmSnap.data() ?? {};
  const apiKey =
    firmData.geminiApiKey ??
    firmData.settings?.geminiApiKey;

  if (!apiKey) {
    throw new Error('Gemini API key is missing. Configure it in Firm Settings.');
  }

  return apiKey;
}

// ---------------------------------------------------------------------------
// Shared doc-type label map
// ---------------------------------------------------------------------------

/** Human-readable labels for doc type keys, used for semantic search queries. */
export const DOC_TYPE_LABELS: Record<string, string> = {
  will: 'last will and testament',
  pourOverWill: 'pour-over will revocable trust',
  poa: 'durable power of attorney',
  livingWill: 'advance directive healthcare proxy',
  trust: 'revocable living trust',
  deed: 'deed real property transfer',
  affidavitOfConsideration: 'affidavit of consideration',
  gitRep3: 'GIT/REP-3 exemption certificate',
  estatePlanSummary: 'estate plan summary letter',
};

// ---------------------------------------------------------------------------
// Main search function
// ---------------------------------------------------------------------------

/**
 * Semantic search across the firm's Knowledge Base using vector similarity.
 *
 * 1. Generates an embedding for the query text
 * 2. Runs findNearest on the knowledgeBase collection (short docs)
 * 3. Runs findNearest on the chunks collection group (long docs)
 * 4. Merges, deduplicates, and ranks by similarity
 */

const VECTOR_SEARCH_TIMEOUT_MS = 10_000; // 10 seconds — fail fast if index is missing

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export async function searchKnowledgeBase(
  firmId: string,
  queryText: string,
  options: VectorSearchOptions = {},
): Promise<VectorSearchResult[]> {
  const {
    docType,
    limit = 15,
    minScore = 0.5,
    excludeOcr = false,
  } = options;

  const db = admin.firestore();
  const geminiApiKey = await getGeminiApiKey(firmId);

  // 1. Generate query embedding (use RETRIEVAL_QUERY for search queries)
  const queryEmbedding = await generateEmbedding(queryText, geminiApiKey, 'RETRIEVAL_QUERY');
  const queryVector = admin.firestore.FieldValue.vector(queryEmbedding);

  // 2. Search parent documents (short content with embedding on the doc)
  const kbRef = db.collection(`firms/${firmId}/knowledgeBase`);

  // Build the base query with prefilter
  let parentQuery: admin.firestore.Query = kbRef.where('isActive', '==', true);
  if (docType) {
    parentQuery = parentQuery.where('docTypes', 'array-contains', docType);
  }

  const parentResults = await withTimeout(
    parentQuery
      .findNearest({
        vectorField: 'embedding',
        queryVector,
        limit: limit + 5, // fetch extra to account for filtering
        distanceMeasure: 'COSINE',
        distanceResultField: '__distance',
      })
      .get(),
    VECTOR_SEARCH_TIMEOUT_MS,
    'KB parent vector search',
  );

  // 3. Search chunks (long content split into embedded sub-docs)
  // Chunks are stored per-resource: firms/{firmId}/knowledgeBase/{resourceId}/chunks/{chunkId}
  // We use a collection group query on 'chunks'
  const chunkResults = await withTimeout(
    db
      .collectionGroup('chunks')
      .where('firmId', '==', firmId)
      .where('isActive', '==', true)
      .findNearest({
        vectorField: 'embedding',
        queryVector,
        limit: limit + 5,
        distanceMeasure: 'COSINE',
        distanceResultField: '__distance',
      })
      .get(),
    VECTOR_SEARCH_TIMEOUT_MS,
    'KB chunk vector search',
  );

  // 4. Process parent results
  const results: VectorSearchResult[] = [];
  const seenResourceIds = new Set<string>();

  for (const doc of parentResults.docs) {
    const data = doc.data();
    // COSINE distance: 0 = identical, 2 = opposite. Convert to similarity.
    const distance = (data as Record<string, unknown>).__distance as number;
    const similarity = 1 - (distance / 2); // normalize to 0–1

    if (similarity < minScore) continue;
    if (excludeOcr && data.contentSource === 'ocr') continue;

    seenResourceIds.add(doc.id);
    results.push({
      id: doc.id,
      title: data.title ?? '',
      citation: data.citation,
      content: data.content ?? '',
      category: data.category ?? 'custom',
      tags: data.tags ?? [],
      similarity,
      isChunk: false,
      sourceType: 'kb',
    });
  }

  // 5. Process chunk results — fetch parent metadata for each unique parent
  const parentCache = new Map<string, admin.firestore.DocumentData>();

  for (const doc of chunkResults.docs) {
    const data = doc.data();
    const distance = (data as Record<string, unknown>).__distance as number;
    const similarity = 1 - (distance / 2);

    if (similarity < minScore) continue;

    const parentResourceId = data.parentResourceId as string;
    if (!parentResourceId) continue;

    // Skip if we already have the full parent document in results
    if (seenResourceIds.has(parentResourceId)) continue;

    // Fetch parent metadata if not cached
    if (!parentCache.has(parentResourceId)) {
      try {
        const parentDoc = await kbRef.doc(parentResourceId).get();
        if (parentDoc.exists) {
          const parentData = parentDoc.data()!;
          if (parentData.isActive === false) continue;
          if (excludeOcr && parentData.contentSource === 'ocr') continue;
          if (docType && !(parentData.docTypes ?? []).includes(docType)) continue;
          parentCache.set(parentResourceId, parentData);
        }
      } catch {
        continue;
      }
    }

    const parentData = parentCache.get(parentResourceId);
    if (!parentData) continue;

    // For chunked resources, use the chunk's content but parent's metadata
    seenResourceIds.add(parentResourceId);
    results.push({
      id: parentResourceId,
      title: parentData.title ?? '',
      citation: parentData.citation,
      content: data.content ?? '', // chunk content — most relevant piece
      category: parentData.category ?? 'custom',
      tags: parentData.tags ?? [],
      similarity,
      isChunk: true,
      chunkIndex: data.chunkIndex,
      sourceType: 'kb',
    });
  }

  // 6. Search template parent documents (short content with embedding on doc)
  const templateRef = db.collection(`firms/${firmId}/documentTemplates`);
  const templateQuery: admin.firestore.Query = templateRef.where('isActive', '==', true);

  try {
    const templateParentResults = await templateQuery
      .findNearest({
        vectorField: 'embedding',
        queryVector,
        limit: 10,
        distanceMeasure: 'COSINE',
        distanceResultField: '__distance',
      })
      .get();

    for (const doc of templateParentResults.docs) {
      const data = doc.data();
      const distance = (data as Record<string, unknown>).__distance as number;
      const similarity = 1 - (distance / 2);
      if (similarity < minScore) continue;

      seenResourceIds.add(`template:${doc.id}`);
      results.push({
        id: doc.id,
        title: data.name ?? data.title ?? '',
        content: data.content ?? '',
        category: 'form_template',
        tags: data.tags ?? [],
        similarity,
        isChunk: false,
        sourceType: 'template',
      });
    }
  } catch (err) {
    // Template collection may not have vector index yet — non-fatal
    console.warn('[kb-vector-search] Template parent vector search failed (index may not exist):', err);
  }

  // 7. Search template chunks (long templates split into embedded sub-docs)
  try {
    const templateChunkResults = await db
      .collectionGroup('chunks')
      .where('firmId', '==', firmId)
      .where('sourceType', '==', 'template')
      .where('isActive', '==', true)
      .findNearest({
        vectorField: 'embedding',
        queryVector,
        limit: 10,
        distanceMeasure: 'COSINE',
        distanceResultField: '__distance',
      })
      .get();

    const templateParentCache = new Map<string, admin.firestore.DocumentData>();

    for (const doc of templateChunkResults.docs) {
      const data = doc.data();
      const distance = (data as Record<string, unknown>).__distance as number;
      const similarity = 1 - (distance / 2);
      if (similarity < minScore) continue;

      const parentTemplateId = data.parentTemplateId as string;
      if (!parentTemplateId) continue;
      if (seenResourceIds.has(`template:${parentTemplateId}`)) continue;

      if (!templateParentCache.has(parentTemplateId)) {
        try {
          const parentDoc = await templateRef.doc(parentTemplateId).get();
          if (parentDoc.exists) {
            const parentData = parentDoc.data()!;
            if (parentData.isActive === false) continue;
            templateParentCache.set(parentTemplateId, parentData);
          }
        } catch {
          continue;
        }
      }

      const parentData = templateParentCache.get(parentTemplateId);
      if (!parentData) continue;

      seenResourceIds.add(`template:${parentTemplateId}`);
      results.push({
        id: parentTemplateId,
        title: parentData.name ?? parentData.title ?? '',
        content: data.content ?? '',
        category: 'form_template',
        tags: parentData.tags ?? [],
        similarity,
        isChunk: true,
        chunkIndex: data.chunkIndex,
        sourceType: 'template',
      });
    }
  } catch (err) {
    console.warn('[kb-vector-search] Template chunk vector search failed (index may not exist):', err);
  }

  // 8. Search chat insights (embedded key facts from conversations)
  try {
    const insightsRef = db.collection(`firms/${firmId}/chatInsights`);
    let insightsQuery: admin.firestore.Query = insightsRef.where('isActive', '==', true);
    if (options.clientId) {
      insightsQuery = insightsQuery.where('clientId', '==', options.clientId);
    }

    const insightResults = await withTimeout(
      insightsQuery
        .findNearest({
          vectorField: 'embedding',
          queryVector,
          limit: 10,
          distanceMeasure: 'COSINE',
          distanceResultField: '__distance',
        })
        .get(),
      VECTOR_SEARCH_TIMEOUT_MS,
      'Chat insights vector search',
    );

    for (const doc of insightResults.docs) {
      const data = doc.data();
      const distance = (data as Record<string, unknown>).__distance as number;
      const similarity = 1 - (distance / 2);
      if (similarity < minScore) continue;

      results.push({
        id: doc.id,
        title: `Chat Insight — ${(data.category as string) ?? 'general'}`,
        content: (data.fact as string) ?? '',
        category: 'chat_insight',
        tags: [(data.category as string) ?? 'general'],
        similarity,
        isChunk: false,
        sourceType: 'chatInsight',
        clientId: data.clientId as string,
      });
    }
  } catch (err) {
    console.warn('[kb-vector-search] Chat insights vector search failed (index may not exist):', err);
  }

  // 9. Sort by similarity (highest first) and limit
  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Context-aware query builder
// ---------------------------------------------------------------------------

/**
 * Build a semantic search query from client characteristics and target doc type.
 * Used by the context aggregator to fetch relevant KB resources without
 * requiring the user to manually type a query.
 */
export function buildContextQuery(
  clientData: admin.firestore.DocumentData,
  targetDocType?: string,
): string {
  const parts: string[] = [];

  // Always include doc type context
  if (targetDocType) {
    parts.push(DOC_TYPE_LABELS[targetDocType] ?? targetDocType);
  }

  // Client characteristic signals
  const children = clientData.children ?? [];
  const pi = clientData.personalInfo ?? {};
  const hasSpouse = ['Married', 'Domestic Partnership'].includes(pi.maritalStatus);
  const hasMinorChildren = children.some((c: Record<string, unknown>) => c.isMinor === true);
  const hasSpecialNeeds = children.some((c: Record<string, unknown>) => c.specialNeeds === true);
  const assets = clientData.assets ?? {};
  const realEstate = assets.realEstate ?? [];
  const hasBusinessInterests = (assets.businessInterests ?? []).length > 0;

  if (hasSpouse) parts.push('marital deduction spousal trust');
  if (hasMinorChildren) parts.push('guardianship designation minor children');
  if (hasSpecialNeeds) parts.push('supplemental needs trust special needs planning');
  if (realEstate.length > 0) parts.push('real property transfer deed');
  if (hasBusinessInterests) parts.push('business succession planning');

  // Estate size considerations
  const estTotalAssets = clientData.assets?.estimatedTotalEstate ?? 0;
  if (estTotalAssets > 1000000) parts.push('estate tax planning');

  // Default fallback
  if (parts.length === 0) {
    parts.push('New Jersey estate planning');
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Template-specific vector search
// ---------------------------------------------------------------------------

export interface TemplateSearchResult {
  /** Firestore document ID of the matched template */
  id: string;
  /** Human-readable template name */
  name: string;
  /** Cosine similarity score (0–1) */
  similarity: number;
}

/**
 * Focused vector search for document templates.
 *
 * Unlike `searchKnowledgeBase()` which searches both KB resources and templates,
 * this function ONLY searches the `documentTemplates` collection and returns
 * the single best match above a strict similarity threshold.
 *
 * Used as a fallback by `getTemplate()` when exact-match Firestore queries
 * (docType + softwareSource / isDefault) return no results.
 */
export async function searchTemplatesByDocType(
  firmId: string,
  docType: string,
): Promise<TemplateSearchResult | null> {
  const MIN_SIMILARITY = 0.65;

  const db = admin.firestore();
  let geminiApiKey: string;
  try {
    geminiApiKey = await getGeminiApiKey(firmId);
  } catch {
    console.warn('[kb-vector-search] No Gemini API key — cannot run template vector search fallback.');
    return null;
  }

  // Build a semantic query from the doc type label
  const label = DOC_TYPE_LABELS[docType] ?? docType;
  const queryText = `${label} legal document template`;

  const queryEmbedding = await generateEmbedding(queryText, geminiApiKey, 'RETRIEVAL_QUERY');
  const queryVector = admin.firestore.FieldValue.vector(queryEmbedding);

  const templateRef = db.collection(`firms/${firmId}/documentTemplates`);
  const templateQuery = templateRef
    .where('isActive', '==', true)
    .where('docType', '==', docType);

  try {
    const snap = await withTimeout(
      templateQuery
        .findNearest({
          vectorField: 'embedding',
          queryVector,
          limit: 3,
          distanceMeasure: 'COSINE',
          distanceResultField: '__distance',
        })
        .get(),
      VECTOR_SEARCH_TIMEOUT_MS,
      'Template vector search fallback',
    );

    for (const doc of snap.docs) {
      const data = doc.data();
      const distance = (data as Record<string, unknown>).__distance as number;
      const similarity = 1 - (distance / 2);

      if (similarity >= MIN_SIMILARITY) {
        console.info(
          `[kb-vector-search] Template vector search fallback matched: ` +
          `"${data.name ?? doc.id}" (similarity=${similarity.toFixed(3)}) for docType="${docType}"`,
        );
        return {
          id: doc.id,
          name: (data.name as string) ?? doc.id,
          similarity,
        };
      }
    }

    console.info(
      `[kb-vector-search] Template vector search fallback: no match above ${MIN_SIMILARITY} ` +
      `for docType="${docType}"`,
    );
    return null;
  } catch (err) {
    console.warn(
      '[kb-vector-search] Template vector search fallback failed (index may not exist):',
      err,
    );
    return null;
  }
}
