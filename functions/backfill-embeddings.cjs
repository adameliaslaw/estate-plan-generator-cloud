#!/usr/bin/env node
/**
 * scripts/backfill-embeddings.js
 *
 * Local script to generate embeddings for existing KB resources.
 * Runs on your machine — no Cloud Functions memory limits.
 *
 * Usage:  node scripts/backfill-embeddings.js
 */

const admin = require('firebase-admin');
const OpenAI = require('openai').default;
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SERVICE_ACCOUNT = path.join(__dirname, '..', 'service-account.json');
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;
const CHUNK_THRESHOLD = 2000;
const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;

// ---------------------------------------------------------------------------
// Init Firebase Admin
// ---------------------------------------------------------------------------
admin.initializeApp({
  credential: admin.credential.cert(require(SERVICE_ACCOUNT)),
});
const db = admin.firestore();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getOpenAIClient(firmId) {
  const firmSnap = await db.doc(`firms/${firmId}`).get();
  const firmData = firmSnap.data() || {};
  const apiKey =
    firmData.openAiApiKey ||
    (firmData.settings && firmData.settings.openAiApiKey) ||
    process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('No OpenAI API key found in firm settings or env.');
  }
  return new OpenAI({ apiKey });
}

async function generateEmbedding(text, openai) {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 30000);
  if (!clean) throw new Error('Empty text for embedding');

  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: clean,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  return res.data[0].embedding;
}

function chunkText(text) {
  if (text.length <= CHUNK_SIZE) return [text];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = start + CHUNK_SIZE;
    if (end < text.length) {
      const slice = text.slice(start, end + 100);
      const lastPeriod = slice.lastIndexOf('. ');
      const lastNewline = slice.lastIndexOf('\n');
      const bestBreak = Math.max(lastPeriod, lastNewline);
      if (bestBreak > CHUNK_SIZE * 0.6) end = start + bestBreak + 1;
    }
    end = Math.min(end, text.length);
    chunks.push(text.slice(start, end).trim());
    start = end - CHUNK_OVERLAP;
    if (start >= text.length) break;
  }
  return chunks.filter((c) => c.length > 50);
}

async function embedResource(firmId, resourceId, content, openai) {
  const resourceRef = db.doc(`firms/${firmId}/knowledgeBase/${resourceId}`);
  const chunksCol = resourceRef.collection('chunks');

  if (content.length <= CHUNK_THRESHOLD) {
    // Short content: single embedding
    const embedding = await generateEmbedding(content, openai);
    await resourceRef.update({
      embedding: admin.firestore.FieldValue.vector(embedding),
      embeddingModel: EMBEDDING_MODEL,
      embeddedAt: admin.firestore.FieldValue.serverTimestamp(),
      chunkCount: 0,
    });

    // Clean up old chunks
    const existing = await chunksCol.limit(500).get();
    if (!existing.empty) {
      const batch = db.batch();
      existing.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    return { chunks: 0 };
  }

  // Long content: chunk and embed sequentially
  const textChunks = chunkText(content);

  // Delete old chunks
  const existing = await chunksCol.limit(500).get();
  if (!existing.empty) {
    const batch = db.batch();
    existing.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  for (let i = 0; i < textChunks.length; i++) {
    const embedding = await generateEmbedding(textChunks[i], openai);
    await chunksCol.doc(`chunk_${String(i).padStart(3, '0')}`).set({
      parentResourceId: resourceId,
      firmId,
      chunkIndex: i,
      content: textChunks[i],
      embedding: admin.firestore.FieldValue.vector(embedding),
      embeddingModel: EMBEDDING_MODEL,
      embeddedAt: admin.firestore.FieldValue.serverTimestamp(),
      isActive: true,
    });
    // Rate limit
    await new Promise((r) => setTimeout(r, 200));
  }

  await resourceRef.update({
    embeddingModel: EMBEDDING_MODEL,
    embeddedAt: admin.firestore.FieldValue.serverTimestamp(),
    chunkCount: textChunks.length,
    embedding: admin.firestore.FieldValue.delete(),
  });

  return { chunks: textChunks.length };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Find all firms
  const firmsSnap = await db.collection('firms').get();
  console.log(`Found ${firmsSnap.size} firm(s)\n`);

  for (const firmDoc of firmsSnap.docs) {
    const firmId = firmDoc.id;
    console.log(`\n=== Firm: ${firmId} ===`);

    let openai;
    try {
      openai = await getOpenAIClient(firmId);
    } catch (err) {
      console.log(`  Skipping — ${err.message}`);
      continue;
    }

    // Get all active resources
    const snap = await db
      .collection(`firms/${firmId}/knowledgeBase`)
      .where('isActive', '==', true)
      .get();

    const needsEmbedding = snap.docs.filter((d) => !d.data().embeddedAt);
    const alreadyDone = snap.docs.length - needsEmbedding.length;
    console.log(`  ${snap.docs.length} active resources, ${alreadyDone} already embedded, ${needsEmbedding.length} to process`);

    let processed = 0;
    let errors = 0;

    for (const doc of needsEmbedding) {
      const data = doc.data();
      if (!data.content || typeof data.content !== 'string' || data.content.length < 50) {
        console.log(`  [skip] ${doc.id} — insufficient content`);
        continue;
      }

      try {
        const result = await embedResource(firmId, doc.id, data.content, openai);
        processed++;
        const label = result.chunks > 0 ? `${result.chunks} chunks` : 'single vector';
        console.log(`  [${processed}/${needsEmbedding.length}] ${data.title || doc.id} — ${label}`);
      } catch (err) {
        errors++;
        console.error(`  [ERROR] ${doc.id}: ${err.message}`);
      }

      // Rate limit between docs
      await new Promise((r) => setTimeout(r, 300));
    }

    console.log(`  Done: ${processed} embedded, ${errors} errors, ${alreadyDone} already had embeddings`);
  }

  console.log('\n✅ Backfill complete!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
