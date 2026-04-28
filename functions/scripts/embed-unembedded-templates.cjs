'use strict';
/**
 * One-off: directly embed all UNEMBEDDED templates by calling the Gemini
 * Embedding API with the firm's API key. Sidesteps the buggy UI loop
 * (which keeps re-embedding the same first 2 templates because forceAll=true
 * + BATCH_SIZE=2 + slice(0, BATCH_SIZE) gives no progress).
 *
 * Mirrors the chunking logic in functions-backfill/src/kb-embeddings.ts at
 * the current constants (CHUNK_THRESHOLD=12000, CHUNK_SIZE=6000, OVERLAP=600).
 */
const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))) });

const FIRM = 'elias-counsel';
const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMENSIONS = 768;
const CHUNK_THRESHOLD = 12000;
const CHUNK_SIZE = 6000;
const CHUNK_OVERLAP = 600;

async function generateEmbedding(text, apiKey, taskType = 'RETRIEVAL_DOCUMENT') {
  const cleanText = text.replace(/\s+/g, ' ').trim().slice(0, 8000);
  if (!cleanText) throw new Error('empty text');
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text: cleanText }] },
      taskType,
      outputDimensionality: EMBEDDING_DIMENSIONS,
    }),
  });
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const v = data.embedding?.values;
  if (!v || v.length === 0) throw new Error('empty embedding');
  return v;
}

function chunkText(text) {
  if (text.length <= CHUNK_SIZE) return [text];
  const chunks = [];
  let start = 0;
  const MAX = 200;
  while (start < text.length && chunks.length < MAX) {
    let end = start + CHUNK_SIZE;
    if (end < text.length) {
      const slice = text.slice(start, end);
      const breakAt = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('.\n'), slice.lastIndexOf('\n\n'));
      if (breakAt > CHUNK_SIZE * 0.6) end = start + breakAt + 1;
    }
    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks.filter((c) => c.length > 50);
}

function stripHandlebars(c) {
  return c
    .replace(/\{\{!--[\s\S]*?--\}\}/g, '')
    .replace(/\{\{![\s\S]*?\}\}/g, '')
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

(async () => {
  const db = admin.firestore();
  // Get firm Gemini API key
  const firmSnap = await db.doc(`firms/${FIRM}`).get();
  const apiKey = firmSnap.data()?.geminiApiKey ?? firmSnap.data()?.settings?.geminiApiKey;
  if (!apiKey) throw new Error('No Gemini API key on firm doc');

  // Find unembedded templates
  const snap = await db.collection(`firms/${FIRM}/documentTemplates`).where('isActive', '==', true).get();
  const todo = snap.docs.filter((d) => !d.data().embeddedAt);
  console.log(`Found ${todo.length} unembedded templates of ${snap.size} active.\n`);

  for (const d of todo) {
    const data = d.data();
    const rawHtml = data.processedTemplate ?? data.htmlTemplate ?? data.template ?? data.content ?? '';
    const cleanContent = stripHandlebars(rawHtml.replace(/<[^>]+>/g, ' '));
    if (!cleanContent || cleanContent.length < 50) {
      console.log(`SKIP ${d.id} (${data.name}): no usable content (${cleanContent.length} chars)`);
      continue;
    }
    const ref = d.ref;
    const chunksCol = ref.collection('chunks');

    // Clear existing chunks
    const existing = await chunksCol.limit(500).get();
    if (!existing.empty) {
      const batch = db.batch();
      existing.docs.forEach((c) => batch.delete(c.ref));
      await batch.commit();
    }

    if (cleanContent.length <= CHUNK_THRESHOLD) {
      const emb = await generateEmbedding(cleanContent, apiKey);
      await ref.update({
        embedding: admin.firestore.FieldValue.vector(emb),
        embeddingModel: EMBEDDING_MODEL,
        embeddedAt: admin.firestore.FieldValue.serverTimestamp(),
        chunkCount: 0,
      });
      console.log(`OK   ${d.id} (${data.name}): single embedding, ${cleanContent.length} chars`);
    } else {
      const parts = chunkText(cleanContent);
      for (let i = 0; i < parts.length; i++) {
        const emb = await generateEmbedding(parts[i], apiKey);
        await chunksCol.doc(`chunk_${String(i).padStart(3, '0')}`).set({
          parentTemplateId: d.id,
          firmId: FIRM,
          sourceType: 'template',
          chunkIndex: i,
          content: parts[i],
          embedding: admin.firestore.FieldValue.vector(emb),
          embeddingModel: EMBEDDING_MODEL,
          embeddedAt: admin.firestore.FieldValue.serverTimestamp(),
          isActive: true,
        });
        await new Promise((r) => setTimeout(r, 200));
      }
      await ref.update({
        embeddingModel: EMBEDDING_MODEL,
        embeddedAt: admin.firestore.FieldValue.serverTimestamp(),
        chunkCount: parts.length,
        embedding: admin.firestore.FieldValue.delete(),
      });
      console.log(`OK   ${d.id} (${data.name}): ${parts.length} chunks, ${cleanContent.length} chars`);
    }
  }
  console.log(`\nDone.`);
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
