'use strict';
/**
 * Direct-embed all UNEMBEDDED knowledgeBase resources, mirroring the
 * functions-backfill chunking logic at current constants. Sidesteps the
 * (now-fixed) UI loop bug. Safe to re-run; only touches docs missing
 * embeddedAt.
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

async function generateEmbedding(text, apiKey) {
  const cleanText = text.replace(/\s+/g, ' ').trim().slice(0, 8000);
  if (!cleanText) throw new Error('empty text');
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text: cleanText }] },
      taskType: 'RETRIEVAL_DOCUMENT',
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

(async () => {
  const db = admin.firestore();
  const firmSnap = await db.doc(`firms/${FIRM}`).get();
  const apiKey = firmSnap.data()?.geminiApiKey ?? firmSnap.data()?.settings?.geminiApiKey;
  if (!apiKey) throw new Error('No Gemini API key on firm doc');

  const snap = await db.collection(`firms/${FIRM}/knowledgeBase`).where('isActive', '==', true).get();
  const todo = snap.docs.filter((d) => !d.data().embeddedAt && !d.data().embedding && (d.data().chunkCount ?? 0) === 0);
  console.log(`Found ${todo.length} unembedded KB resources of ${snap.size} active.\n`);

  let totalChunks = 0;
  for (const d of todo) {
    const data = d.data();
    const content = data.content;
    if (typeof content !== 'string' || content.length < 50) {
      console.log(`SKIP ${d.id} (${(data.title ?? '?').slice(0, 50)}): no usable content`);
      continue;
    }
    const ref = d.ref;
    const chunksCol = ref.collection('chunks');
    const existing = await chunksCol.limit(500).get();
    if (!existing.empty) {
      const batch = db.batch();
      existing.docs.forEach((c) => batch.delete(c.ref));
      await batch.commit();
    }

    if (content.length <= CHUNK_THRESHOLD) {
      const emb = await generateEmbedding(content, apiKey);
      await ref.update({
        embedding: admin.firestore.FieldValue.vector(emb),
        embeddingModel: EMBEDDING_MODEL,
        embeddedAt: admin.firestore.FieldValue.serverTimestamp(),
        chunkCount: 0,
      });
      console.log(`OK   ${d.id}: single (${content.length} chars) | ${(data.title ?? '?').slice(0, 60)}`);
    } else {
      const parts = chunkText(content);
      for (let i = 0; i < parts.length; i++) {
        const emb = await generateEmbedding(parts[i], apiKey);
        await chunksCol.doc(`chunk_${String(i).padStart(3, '0')}`).set({
          parentResourceId: d.id,
          firmId: FIRM,
          sourceType: 'kb',
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
      totalChunks += parts.length;
      console.log(`OK   ${d.id}: ${parts.length} chunks (${content.length} chars) | ${(data.title ?? '?').slice(0, 60)}`);
    }
  }
  console.log(`\nDone. ${totalChunks} chunks created across long resources.`);
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
