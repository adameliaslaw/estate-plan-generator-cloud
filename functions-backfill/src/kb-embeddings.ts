/**
 * functions-backfill/src/kb-embeddings.ts
 *
 * Backfill-only embedding functions for Knowledge Base resources and templates.
 * Uses Vertex AI text-embedding-005 (768 dimensions) via Application Default
 * Credentials — no per-firm API key needed.
 *
 * This file is a trimmed copy of functions/src/kb-embeddings.ts containing
 * only the backfill callables (no onWrite triggers — those stay in the main
 * codebase where they work fine with 1GiB memory).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { GoogleAuth } from 'google-auth-library';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VERTEX_LOCATION      = 'us-central1';
const EMBEDDING_MODEL      = 'text-embedding-005';
const EMBEDDING_DIMENSIONS = 768;

/** Content shorter than this gets a single embedding on the document itself.
 *  MUST stay in sync with functions/src/kb-embeddings.ts — the two files are
 *  duplicated for the OOM-isolation reason in this package's README. */
const CHUNK_THRESHOLD = 12000;

/** Target size for each chunk (~1.5K tokens). */
const CHUNK_SIZE = 6000;

/** Overlap between consecutive chunks to preserve context at boundaries. */
const CHUNK_OVERLAP = 600;

/** Max resources to process per backfill invocation. */
const BACKFILL_BATCH_SIZE = 2;

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
type EmbeddingTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

/**
 * Generate an embedding vector for a text string using Vertex AI.
 * Authentication is via Application Default Credentials.
 */
async function generateEmbedding(
  text: string,
  taskType: EmbeddingTaskType = 'RETRIEVAL_DOCUMENT',
): Promise<number[]> {
  // text-embedding-005 caps inputs around 2048 tokens (~8000 chars).
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
function chunkText(
  text: string,
  chunkSize: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP,
): string[] {
  if (text.length <= chunkSize) return [text];

  const chunks: string[] = [];
  let start = 0;
  const MAX_CHUNKS = 200; // Safety cap to prevent runaway allocation

  while (start < text.length && chunks.length < MAX_CHUNKS) {
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

    // Advance with overlap — guarantee forward progress
    const nextStart = end - overlap;
    if (nextStart <= start) {
      start = end; // Force advance when overlap would stall
    } else {
      start = nextStart;
    }
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
// Helper: strip Handlebars syntax from template content before embedding
// ---------------------------------------------------------------------------

/**
 * Remove Handlebars expressions AND HTML tags from template content. Templates
 * store full HTML (~30% tag overhead); KB resources store plain text. Tag
 * strip is a no-op on plain text. Without it, large HTML templates
 * over-chunk by 50-66% on tag noise. MUST stay in sync with the same
 * function in functions/src/kb-embeddings.ts.
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

// ---------------------------------------------------------------------------
// Backfill callable — batch-embed existing resources
// ---------------------------------------------------------------------------

export const backfillEmbeddings = onCall(
  {
    region: 'us-east1',
    memory: '8GiB',
    timeoutSeconds: 540,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }

    const { firmId, forceAll } = request.data as { firmId: string; forceAll?: boolean };
    if (!firmId) {
      throw new HttpsError('invalid-argument', 'firmId is required.');
    }

    const db = admin.firestore();

    // Fetch metadata for active resources — use a larger limit to find unembedded ones
    const snap = await db
      .collection(`firms/${firmId}/knowledgeBase`)
      .where('isActive', '==', true)
      .select('embeddedAt', 'title')
      .limit(500)
      .get();

    // Filter to those needing embedding, then take up to BACKFILL_BATCH_SIZE
    const needsEmbedding = snap.docs
      .filter((doc) => forceAll || doc.data().embeddingModel !== EMBEDDING_MODEL)
      .slice(0, BACKFILL_BATCH_SIZE);

    let processed = 0;
    let errors = 0;

    // Process one document at a time to keep memory low
    for (const docSnap of needsEmbedding) {
      try {
        // Load content for this single document
        const fullDoc = await db
          .doc(`firms/${firmId}/knowledgeBase/${docSnap.id}`)
          .get();
        const data = fullDoc.data();

        if (!data?.content || typeof data.content !== 'string' || data.content.length < 50) {
          continue; // Skip documents without meaningful content
        }

        await embedResource(firmId, docSnap.id, data.content);
        processed++;

        // Rate limiting: ~3 requests per second
        await new Promise((r) => setTimeout(r, 350));
      } catch (err) {
        console.error(`[backfillEmbeddings] Failed for ${docSnap.id}:`, err);
        errors++;
      }
    }

    const skipped = snap.docs.length - needsEmbedding.length;

    console.log(
      `[backfillEmbeddings] Done: ${processed} processed, ${skipped} skipped, ${errors} errors.`,
    );

    return {
      processed,
      skipped,
      errors,
      total: snap.docs.length,
    };
  },
);

// ---------------------------------------------------------------------------
// Backfill callable — batch-embed existing templates
// ---------------------------------------------------------------------------

export const backfillTemplateEmbeddings = onCall(
  {
    region: 'us-east1',
    memory: '8GiB',
    timeoutSeconds: 540,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }

    const { firmId, forceAll } = request.data as { firmId: string; forceAll?: boolean };
    if (!firmId) {
      throw new HttpsError('invalid-argument', 'firmId is required.');
    }

    const db = admin.firestore();

    // Fetch metadata for active templates
    const snap = await db
      .collection(`firms/${firmId}/documentTemplates`)
      .where('isActive', '==', true)
      .select('embeddedAt', 'name')
      .limit(500)
      .get();

    const needsEmbedding = snap.docs
      .filter((doc) => forceAll || doc.data().embeddingModel !== EMBEDDING_MODEL)
      .slice(0, BACKFILL_BATCH_SIZE);

    let processed = 0;
    let errors = 0;

    for (const docSnap of needsEmbedding) {
      try {
        const fullDoc = await db
          .doc(`firms/${firmId}/documentTemplates/${docSnap.id}`)
          .get();
        const data = fullDoc.data();

        if (!data?.content || typeof data.content !== 'string' || data.content.length < 50) {
          continue;
        }

        const cleanContent = stripHandlebars(data.content);
        if (cleanContent.length < 50) continue;

        await embedTemplate(firmId, docSnap.id, cleanContent);
        processed++;

        await new Promise((r) => setTimeout(r, 350));
      } catch (err) {
        console.error(`[backfillTemplateEmbeddings] Failed for ${docSnap.id}:`, err);
        errors++;
      }
    }

    const skipped = snap.docs.length - needsEmbedding.length;

    console.log(
      `[backfillTemplateEmbeddings] Done: ${processed} processed, ${skipped} skipped, ${errors} errors.`,
    );

    return {
      processed,
      skipped,
      errors,
      total: snap.docs.length,
    };
  },
);
