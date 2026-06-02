/**
 * functions/src/kb-embeddings.ts
 *
 * Generates and stores vector embeddings for Knowledge Base resources.
 * Uses Vertex AI text-embedding-005 (768 dimensions) via Application Default
 * Credentials — no per-firm API key needed.
 *
 * Features:
 *  - onWrite trigger: auto-embeds new/updated KB resources
 *  - backfillEmbeddings: callable to batch-embed existing resources
 *  - Chunking: splits long resources (>2000 chars) into overlapping chunks
 *    stored in a subcollection, each with its own embedding vector
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { GoogleAuth } from 'google-auth-library';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VERTEX_LOCATION      = 'us-central1';
const EMBEDDING_MODEL      = 'text-embedding-005';
const EMBEDDING_DIMENSIONS = 768;

/** Content shorter than this gets a single embedding on the document itself.
 *  Tuned for clause/draft generation: a full sample will or trust agreement
 *  is typically 8-15K chars, and we want it embedded as a single coherent
 *  unit (not split into chunks that lose cross-article context). Anything
 *  under 12K chars stays whole; only very long source materials get chunked. */
const CHUNK_THRESHOLD = 12000;

/** Target size for each chunk (~1.5K tokens). Larger than the citation-
 *  retrieval default so each chunk preserves multi-paragraph clause flow
 *  and defined-term continuity. */
const CHUNK_SIZE = 6000;

/** Overlap between consecutive chunks to preserve context at boundaries.
 *  Scaled with CHUNK_SIZE — 10% overlap. */
const CHUNK_OVERLAP = 600;

/** Max resources to process per backfill invocation. */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Singleton GoogleAuth client — created once per cold start. */
let _auth: GoogleAuth | null = null;
function getAuth(): GoogleAuth {
  if (!_auth) {
    _auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }
  return _auth;
}

/** Task type for embeddings — specializes the vector for retrieval direction. */
export type EmbeddingTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

/**
 * Generate an embedding vector for a text string using Vertex AI.
 * Authentication is via Application Default Credentials (the function's
 * runtime service account); no per-firm API key is required.
 */
export async function generateEmbedding(
  text: string,
  taskType: EmbeddingTaskType = 'RETRIEVAL_DOCUMENT',
): Promise<number[]> {
  // text-embedding-005 caps inputs around 2048 tokens (~8000 chars). The
  // chunker stays well under this; this slice is a safety net for any
  // caller that bypasses chunkText.
  const cleanText = text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);

  if (!cleanText) {
    throw new Error('Cannot generate embedding for empty text.');
  }

  const auth = getAuth();
  const [client, projectId] = await Promise.all([auth.getClient(), auth.getProjectId()]);
  const url =
    `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/` +
    `${projectId}/locations/${VERTEX_LOCATION}/publishers/google/models/` +
    `${EMBEDDING_MODEL}:predict`;

  const response = await client.request<{
    predictions?: Array<{ embeddings?: { values?: number[] } }>;
  }>({
    url,
    method: 'POST',
    data: {
      instances: [{ task_type: taskType, content: cleanText }],
      parameters: { outputDimensionality: EMBEDDING_DIMENSIONS },
    },
  });

  const values = response.data.predictions?.[0]?.embeddings?.values;
  if (!values || values.length === 0) {
    throw new Error('Vertex AI returned empty embedding.');
  }
  return values;
}

/**
 * Split text into overlapping chunks for embedding.
 */
export function chunkText(
  text: string,
  chunkSize: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP,
): string[] {
  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + chunkSize;

    // Try to break at a sentence or paragraph boundary
    if (end < text.length) {
      const slice = text.slice(start, end + 100); // look ahead a bit
      const lastPeriod = slice.lastIndexOf('. ');
      const lastNewline = slice.lastIndexOf('\n');
      const bestBreak = Math.max(lastPeriod, lastNewline);

      if (bestBreak > chunkSize * 0.6) {
        end = start + bestBreak + 1;
      }
    }

    end = Math.min(end, text.length);
    chunks.push(text.slice(start, end).trim());

    // Advance with overlap
    start = end - overlap;
    if (start >= text.length) break;
  }

  return chunks.filter((c) => c.length > 50); // drop tiny trailing chunks
}

/**
 * Embed a single KB resource:
 *  - Short content (≤ CHUNK_THRESHOLD): embed directly on the document
 *  - Long content (> CHUNK_THRESHOLD): split into chunks, store in subcollection
 */
async function embedResource(
  firmId: string,
  resourceId: string,
  content: string,
): Promise<{ embedded: boolean; chunks: number }> {
  const db = admin.firestore();
  const resourceRef = db.doc(`firms/${firmId}/knowledgeBase/${resourceId}`);
  const chunksCol = resourceRef.collection('chunks');

  if (content.length <= CHUNK_THRESHOLD) {
    // Short content: single embedding on the document
    const embedding = await generateEmbedding(content);

    await resourceRef.update({
      embedding: admin.firestore.FieldValue.vector(embedding),
      embeddingModel: EMBEDDING_MODEL,
      embeddedAt: admin.firestore.FieldValue.serverTimestamp(),
      chunkCount: 0,
    });

    // Clean up any existing chunks from a prior version
    const existingChunks = await chunksCol.limit(500).get();
    if (!existingChunks.empty) {
      const batch = db.batch();
      existingChunks.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }

    return { embedded: true, chunks: 0 };
  }

  // Long content: split into chunks, embed and write each one sequentially
  // to avoid holding all embeddings in memory at once
  const textChunks = chunkText(content);

  // Delete existing chunks first
  const existingChunks = await chunksCol.limit(500).get();
  if (!existingChunks.empty) {
    const deleteBatch = db.batch();
    existingChunks.docs.forEach((doc) => deleteBatch.delete(doc.ref));
    await deleteBatch.commit();
  }

  // Embed and write each chunk one at a time
  for (let i = 0; i < textChunks.length; i++) {
    const embedding = await generateEmbedding(textChunks[i]);
    const chunkRef = chunksCol.doc(`chunk_${String(i).padStart(3, '0')}`);
    await chunkRef.set({
      parentResourceId: resourceId,
      firmId,
      chunkIndex: i,
      content: textChunks[i],
      embedding: admin.firestore.FieldValue.vector(embedding),
      embeddingModel: EMBEDDING_MODEL,
      embeddedAt: admin.firestore.FieldValue.serverTimestamp(),
      isActive: true,
    });
    // Small delay between chunks to stay within rate limits
    await new Promise((r) => setTimeout(r, 200));
  }

  // Update parent document with metadata (no embedding on parent for chunked docs)
  await resourceRef.update({
    embeddingModel: EMBEDDING_MODEL,
    embeddedAt: admin.firestore.FieldValue.serverTimestamp(),
    chunkCount: textChunks.length,
    // Remove any old single-doc embedding
    embedding: admin.firestore.FieldValue.delete(),
  });

  return { embedded: true, chunks: textChunks.length };
}

// ---------------------------------------------------------------------------
// Firestore onWrite trigger — auto-embed on create/update
// ---------------------------------------------------------------------------

export const onKnowledgeResourceWritten = onDocumentWritten(
  {
    document: 'firms/{firmId}/knowledgeBase/{resourceId}',
    region: 'us-east1',
    memory: '1GiB',
    timeoutSeconds: 120,
  },
  async (event) => {
    const { firmId, resourceId } = event.params;

    // Skip deletions
    if (!event.data?.after.exists) {
      console.log(`[kb-embeddings] Resource ${resourceId} deleted, skipping.`);
      return;
    }

    const afterData = event.data.after.data();
    if (!afterData) return;

    // Skip if content hasn't changed (compare to before)
    if (event.data.before.exists) {
      const beforeData = event.data.before.data();
      if (beforeData?.content === afterData.content && afterData.embeddedAt) {
        // Content unchanged and already embedded — skip
        return;
      }
    }

    const content = afterData.content;
    if (!content || typeof content !== 'string' || content.length < 50) {
      console.log(`[kb-embeddings] Resource ${resourceId} has insufficient content, skipping.`);
      return;
    }

    // Skip if resource is inactive
    if (afterData.isActive === false) {
      console.log(`[kb-embeddings] Resource ${resourceId} is inactive, skipping.`);
      return;
    }

    try {
      const result = await embedResource(firmId, resourceId, content);
      console.log(
        `[kb-embeddings] Embedded resource ${resourceId}: ${result.chunks > 0 ? `${result.chunks} chunks` : 'single vector'}`,
      );
    } catch (err) {
      console.error(`[kb-embeddings] Failed to embed resource ${resourceId}:`, err);
      // Non-fatal — resource is still usable without embedding
    }
  },
);

// ---------------------------------------------------------------------------
// Backfill callable — batch-embed existing resources
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Helper: strip Handlebars syntax from template content before embedding
// ---------------------------------------------------------------------------

/**
 * Remove Handlebars expressions AND HTML tags from template content so the
 * embedding captures the legal prose, not variable placeholders or markup.
 *
 * Templates store full HTML (with `<p class="tr-base" style="...">`-style
 * markup, ~30% tag overhead). KB resources store plain text (extracted at
 * ingest time). Stripping tags is a no-op on plain text, so this function
 * is safe to call on either source.
 *
 * Without the tag strip, large HTML templates over-chunk by 50-66% — every
 * 6K-char chunk wastes ~2K chars on `<p class="...">` style markup
 * instead of carrying actual legal prose. Caught when Joint Revocable
 * Trust + Rizzo Living Trust embedded at 15/17 chunks instead of 9/11.
 */
function stripHandlebars(content: string): string {
  return content
    // Strip block comments {{!-- ... --}}
    .replace(/\{\{!--[\s\S]*?--\}\}/g, '')
    // Strip line comments {{! ... }}
    .replace(/\{\{![\s\S]*?\}\}/g, '')
    // Strip all Handlebars expressions (simple, block open, block close)
    .replace(/\{\{[^}]*\}\}/g, ' ')
    // Strip HTML tags so embedding text is pure prose, not markup
    .replace(/<[^>]+>/g, ' ')
    // Collapse excessive whitespace
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Firestore onWrite trigger — auto-embed templates on create/update
// ---------------------------------------------------------------------------

export const onTemplateWritten = onDocumentWritten(
  {
    document: 'firms/{firmId}/documentTemplates/{templateId}',
    region: 'us-east1',
    memory: '2GiB',
    timeoutSeconds: 120,
  },
  async (event) => {
    const { firmId, templateId } = event.params;

    // Skip deletions
    if (!event.data?.after.exists) {
      console.log(`[kb-embeddings] Template ${templateId} deleted, skipping.`);
      return;
    }

    const afterData = event.data.after.data();
    if (!afterData) return;

    // Skip if content hasn't changed
    if (event.data.before.exists) {
      const beforeData = event.data.before.data();
      if (beforeData?.content === afterData.content && afterData.embeddedAt) {
        return;
      }
    }

    const content = afterData.content;
    if (!content || typeof content !== 'string' || content.length < 50) {
      console.log(`[kb-embeddings] Template ${templateId} has insufficient content, skipping.`);
      return;
    }

    // Skip inactive templates
    if (afterData.isActive === false) {
      console.log(`[kb-embeddings] Template ${templateId} is inactive, skipping.`);
      return;
    }

    // Strip Handlebars syntax before embedding
    const cleanContent = stripHandlebars(content);
    if (cleanContent.length < 50) {
      console.log(`[kb-embeddings] Template ${templateId} has no meaningful text after stripping Handlebars, skipping.`);
      return;
    }

    try {
      const result = await embedTemplate(firmId, templateId, cleanContent);
      console.log(
        `[kb-embeddings] Embedded template ${templateId}: ${result.chunks > 0 ? `${result.chunks} chunks` : 'single vector'}`,
      );
    } catch (err) {
      console.error(`[kb-embeddings] Failed to embed template ${templateId}:`, err);
    }
  },
);

// ---------------------------------------------------------------------------
// Template-specific embedding helper
// ---------------------------------------------------------------------------

/**
 * Embed a single template document. Mirrors embedResource but writes to
 * the documentTemplates collection and tags chunks with sourceType: 'template'.
 */
async function embedTemplate(
  firmId: string,
  templateId: string,
  cleanContent: string,
): Promise<{ embedded: boolean; chunks: number }> {
  const db = admin.firestore();
  const templateRef = db.doc(`firms/${firmId}/documentTemplates/${templateId}`);
  const chunksCol = templateRef.collection('chunks');

  if (cleanContent.length <= CHUNK_THRESHOLD) {
    const embedding = await generateEmbedding(cleanContent);

    await templateRef.update({
      embedding: admin.firestore.FieldValue.vector(embedding),
      embeddingModel: EMBEDDING_MODEL,
      embeddedAt: admin.firestore.FieldValue.serverTimestamp(),
      chunkCount: 0,
    });

    // Clean up old chunks
    const existingChunks = await chunksCol.limit(500).get();
    if (!existingChunks.empty) {
      const batch = db.batch();
      existingChunks.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }

    return { embedded: true, chunks: 0 };
  }

  // Long content: chunk and embed sequentially
  const textChunks = chunkText(cleanContent);

  // Delete existing chunks
  const existingChunks = await chunksCol.limit(500).get();
  if (!existingChunks.empty) {
    const deleteBatch = db.batch();
    existingChunks.docs.forEach((doc) => deleteBatch.delete(doc.ref));
    await deleteBatch.commit();
  }

  for (let i = 0; i < textChunks.length; i++) {
    const embedding = await generateEmbedding(textChunks[i]);
    await chunksCol.doc(`chunk_${String(i).padStart(3, '0')}`).set({
      parentTemplateId: templateId,
      firmId,
      sourceType: 'template',
      chunkIndex: i,
      content: textChunks[i],
      embedding: admin.firestore.FieldValue.vector(embedding),
      embeddingModel: EMBEDDING_MODEL,
      embeddedAt: admin.firestore.FieldValue.serverTimestamp(),
      isActive: true,
    });
    await new Promise((r) => setTimeout(r, 200));
  }

  await templateRef.update({
    embeddingModel: EMBEDDING_MODEL,
    embeddedAt: admin.firestore.FieldValue.serverTimestamp(),
    chunkCount: textChunks.length,
    embedding: admin.firestore.FieldValue.delete(),
  });

  return { embedded: true, chunks: textChunks.length };
}

