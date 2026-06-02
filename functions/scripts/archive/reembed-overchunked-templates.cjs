'use strict';
/**
 * One-off cleanup: re-embed Joint Revocable Trust + Rizzo Living Trust.
 * Both were processed by the buggy backfill pipeline that left HTML tags
 * in the chunked text, producing 15/17 chunks instead of the expected
 * 9/11. Clears their embeddedAt + chunkCount, then re-runs the same
 * direct-embed flow that handled the other 9 templates correctly.
 */
const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))) });

const FIRM = 'elias-counsel';
const TARGET_NAMES = ['Joint Revocable Trust', 'Rizzo Living Trust'];

(async () => {
  const db = admin.firestore();
  const snap = await db.collection(`firms/${FIRM}/documentTemplates`).get();
  for (const d of snap.docs) {
    const data = d.data();
    if (!TARGET_NAMES.includes(data.name)) continue;
    console.log(`CLEAR ${d.id}: ${data.name} (was chunkCount=${data.chunkCount})`);
    // Delete chunks subcollection first
    const chunksCol = d.ref.collection('chunks');
    const existing = await chunksCol.limit(500).get();
    if (!existing.empty) {
      const batch = db.batch();
      existing.docs.forEach((c) => batch.delete(c.ref));
      await batch.commit();
      console.log(`       deleted ${existing.size} stale chunks`);
    }
    await d.ref.update({
      embeddedAt: admin.firestore.FieldValue.delete(),
      chunkCount: 0,
      embedding: admin.firestore.FieldValue.delete(),
    });
  }
  console.log('\nNow run: node functions/scripts/embed-unembedded-templates.cjs');
  process.exit(0);
})();
