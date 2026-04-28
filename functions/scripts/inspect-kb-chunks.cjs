'use strict';
const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))) });
(async () => {
  const db = admin.firestore();
  const FIRM = 'elias-counsel';
  const NEW_CHUNK_THRESHOLD = 12000;
  const NEW_CHUNK_SIZE = 6000;
  const OLD_CHUNK_THRESHOLD = 3000;
  const OLD_CHUNK_SIZE = 2500;

  for (const collName of ['knowledgeBase', 'documentTemplates']) {
    console.log(`\n========== ${collName} ==========`);
    const snap = await db.collection(`firms/${FIRM}/${collName}`).get();
    let total = 0, embedded = 0, unembedded = 0, atOldChunking = 0, atNewChunking = 0, ambiguous = 0;
    let totalChunks = 0;
    const samples = [];
    for (const d of snap.docs) {
      const data = d.data();
      if (data.isActive === false) continue;
      total++;
      const content = data.content ?? data.htmlContent ?? data.contentHtml ?? '';
      const len = typeof content === 'string' ? content.length : 0;
      const chunkCount = data.chunkCount ?? 0;
      const hasEmbedding = !!data.embedding;
      if (!data.embeddedAt && !hasEmbedding && chunkCount === 0) { unembedded++; continue; }
      embedded++;
      totalChunks += chunkCount;

      // Classify: under new threshold → expect single embedding (chunkCount=0)
      // Between old and new threshold (3K-12K) → OLD chunking would have split, NEW would not
      // Over new threshold → both chunk; expected count differs
      let classification;
      if (len <= OLD_CHUNK_THRESHOLD) {
        // Both old and new keep as single embedding — can't tell which produced it
        classification = chunkCount === 0 ? 'ambiguous-single' : 'ambiguous-chunked';
      } else if (len <= NEW_CHUNK_THRESHOLD) {
        // OLD: would chunk (chunkCount > 0). NEW: would NOT chunk (chunkCount = 0).
        classification = chunkCount > 0 ? 'OLD' : 'NEW';
      } else {
        // Both chunk. Estimate expected counts:
        const oldExpected = Math.ceil(len / (OLD_CHUNK_SIZE - 400));
        const newExpected = Math.ceil(len / (NEW_CHUNK_SIZE - 600));
        const distOld = Math.abs(chunkCount - oldExpected);
        const distNew = Math.abs(chunkCount - newExpected);
        classification = distOld < distNew ? 'OLD' : (distNew < distOld ? 'NEW' : 'ambiguous-chunked');
      }
      if (classification === 'OLD') atOldChunking++;
      else if (classification === 'NEW') atNewChunking++;
      else ambiguous++;

      if (samples.length < 8) {
        samples.push({
          id: d.id,
          title: (data.title ?? data.name ?? '?').slice(0, 60),
          contentLen: len,
          chunkCount,
          embeddedAt: data.embeddedAt?.toDate?.()?.toISOString?.() ?? data.embeddedAt,
          classification,
        });
      }
    }
    console.log(`  Active resources: ${total}`);
    console.log(`  Embedded: ${embedded} | Unembedded: ${unembedded}`);
    console.log(`  Total chunks across all resources: ${totalChunks}`);
    console.log(`  Classification: OLD chunking=${atOldChunking}, NEW chunking=${atNewChunking}, ambiguous=${ambiguous}`);
    console.log(`  Samples:`);
    for (const s of samples) {
      console.log(`    [${s.classification.padEnd(20)}] len=${String(s.contentLen).padStart(6)} chunks=${String(s.chunkCount).padStart(3)} | ${s.title} (embeddedAt=${s.embeddedAt})`);
    }
  }
  process.exit(0);
})();
