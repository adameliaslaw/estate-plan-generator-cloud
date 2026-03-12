/**
 * functions/src/kb-embeddings.ts
 *
 * Generates and stores vector embeddings for Knowledge Base resources.
 * Uses OpenAI text-embedding-3-small (1536 dimensions) for cost efficiency.
 *
 * Features:
 *  - onWrite trigger: auto-embeds new/updated KB resources
 *  - backfillEmbeddings: callable to batch-embed existing resources
 *  - Chunking: splits long resources (>2000 chars) into overlapping chunks
 *    stored in a subcollection, each with its own embedding vector
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;

/** Content shorter than this gets a single embedding on the document itself. */
const CHUNK_THRESHOLD = 2000;

/** Target size for each chunk. */
const CHUNK_SIZE = 1500;

/** Overlap between consecutive chunks to preserve context at boundaries. */
const CHUNK_OVERLAP = 200;

/** Max resources to process per backfill invocation. */
const BACKFILL_BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Get or create an OpenAI client using the firm's API key.
 */
async function getOpenAIClient(firmId: string): Promise<OpenAI> {
  const firmSnap = await admin.firestore().doc(`firms/${firmId}`).get();
  const firmData = firmSnap.data() ?? {};
  const apiKey =
    firmData.openAiApiKey ??
    firmData.settings?.openAiApiKey ??
    process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OpenAI API key is missing. Configure it in Firm Settings.');
  }

  return new OpenAI({ apiKey });
}

/**
 * Generate an embedding vector for a text string.
 */
export async function generateEmbedding(
  text: string,
  openaiClient: OpenAI,
): Promise<number[]> {
  // Clean and truncate text — OpenAI has an 8191 token limit for this model
  const cleanText = text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30000); // ~8K tokens rough estimate

  if (!cleanText) {
    throw new Error('Cannot generate embedding for empty text.');
  }

  const response = await openaiClient.embeddings.create({
    model: EMBEDDING_MODEL,
    input: cleanText,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  return response.data[0].embedding;
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
  openaiClient: OpenAI,
): Promise<{ embedded: boolean; chunks: number }> {
  const db = admin.firestore();
  const resourceRef = db.doc(`firms/${firmId}/knowledgeBase/${resourceId}`);
  const chunksCol = resourceRef.collection('chunks');

  if (content.length <= CHUNK_THRESHOLD) {
    // Short content: single embedding on the document
    const embedding = await generateEmbedding(content, openaiClient);

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

  // Long content: split into chunks and embed each
  const textChunks = chunkText(content);
  const embeddings = await Promise.all(
    textChunks.map((chunk) => generateEmbedding(chunk, openaiClient)),
  );

  // Delete existing chunks first
  const existingChunks = await chunksCol.limit(500).get();
  if (!existingChunks.empty) {
    const deleteBatch = db.batch();
    existingChunks.docs.forEach((doc) => deleteBatch.delete(doc.ref));
    await deleteBatch.commit();
  }

  // Write new chunks in batches
  let batch = db.batch();
  let batchCount = 0;

  for (let i = 0; i < textChunks.length; i++) {
    const chunkRef = chunksCol.doc(`chunk_${String(i).padStart(3, '0')}`);
    batch.set(chunkRef, {
      parentResourceId: resourceId,
      firmId,
      chunkIndex: i,
      content: textChunks[i],
      embedding: admin.firestore.FieldValue.vector(embeddings[i]),
      embeddingModel: EMBEDDING_MODEL,
      embeddedAt: admin.firestore.FieldValue.serverTimestamp(),
      isActive: true,
    });
    batchCount++;

    if (batchCount >= 400) {
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
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
    memory: '512MiB',
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
      const openai = await getOpenAIClient(firmId);
      const result = await embedResource(firmId, resourceId, content, openai);
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

export const backfillEmbeddings = onCall(
  {
    region: 'us-east1',
    memory: '1GiB',
    timeoutSeconds: 540,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }

    const { firmId } = request.data as { firmId: string };
    if (!firmId) {
      throw new HttpsError('invalid-argument', 'firmId is required.');
    }

    // Get OpenAI client — fail early with a clear message
    let openai: OpenAI;
    try {
      openai = await getOpenAIClient(firmId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to initialize OpenAI client';
      throw new HttpsError('failed-precondition', msg);
    }

    const db = admin.firestore();

    // Find resources without embeddings
    const snap = await db
      .collection(`firms/${firmId}/knowledgeBase`)
      .where('isActive', '==', true)
      .limit(BACKFILL_BATCH_SIZE)
      .get();

    // Filter to those missing embeddings
    const needsEmbedding = snap.docs.filter((doc) => {
      const data = doc.data();
      return (
        !data.embeddedAt &&
        data.content &&
        typeof data.content === 'string' &&
        data.content.length >= 50
      );
    });

    let processed = 0;
    let errors = 0;

    for (const doc of needsEmbedding) {
      try {
        const result = await embedResource(firmId, doc.id, doc.data().content, openai);
        if (result.embedded) {
          processed++;
        }

        // Rate limiting: ~3 requests per second to stay well within OpenAI limits
        await new Promise((r) => setTimeout(r, 350));
      } catch (err) {
        console.error(`[backfillEmbeddings] Failed for ${doc.id}:`, err);
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
    };
  },
);
