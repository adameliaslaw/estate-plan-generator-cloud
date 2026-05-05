'use strict';
const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))) });
(async () => {
  const db = admin.firestore();
  const FIRM = 'elias-counsel';
  const snap = await db.collection(`firms/${FIRM}/knowledgeBase`).get();
  const unembedded = [];
  for (const d of snap.docs) {
    const data = d.data();
    if (data.isActive === false) continue;
    if (data.embeddedAt) continue;
    if (data.embedding) continue;
    if ((data.chunkCount ?? 0) > 0) continue;
    // Confirmed unembedded
    const fields = Object.keys(data);
    const contentField = ['content', 'htmlContent', 'contentHtml', 'text', 'body'].find((f) => typeof data[f] === 'string' && data[f].length > 0);
    const contentLen = contentField ? data[contentField].length : 0;
    unembedded.push({
      id: d.id,
      title: (data.title ?? data.name ?? '?').slice(0, 80),
      isActive: data.isActive,
      docType: data.docType,
      category: data.category,
      contentField,
      contentLen,
      hasContent: contentLen > 0,
      createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? data.createdAt,
      fieldKeys: fields.sort().join(','),
    });
  }
  console.log(`Total unembedded (active, no embeddedAt, no embedding, chunkCount=0): ${unembedded.length}\n`);
  for (const u of unembedded) {
    console.log(`--- ${u.id} ---`);
    console.log(`  title:      ${u.title}`);
    console.log(`  isActive:   ${u.isActive}`);
    console.log(`  docType:    ${u.docType}`);
    console.log(`  category:   ${u.category}`);
    console.log(`  content:    field=${u.contentField || '(NONE)'} len=${u.contentLen}`);
    console.log(`  createdAt:  ${u.createdAt}`);
    console.log(`  fields:     ${u.fieldKeys}`);
  }
  process.exit(0);
})();
