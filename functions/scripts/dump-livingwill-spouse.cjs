'use strict';
const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))) });

(async () => {
  const db = admin.firestore();
  const snap = await db.collection('firms/elias-counsel/clients').get();
  for (const c of snap.docs) {
    const cd = c.data();
    const pi = cd.personalInfo ?? {};
    if (!/karen/i.test(pi.firstName ?? '')) continue;
    const docs = await c.ref.collection('documents').get();
    for (const d of docs.docs) {
      const data = d.data();
      if (d.id !== 'livingWill_spouse') continue;
      console.log(`\n=== doc id: ${d.id} ===`);
      console.log('  fields:', Object.keys(data).sort().join(', '));
      console.log('  generatedAt:', data.generatedAt);
      console.log('  updatedAt:', data.updatedAt);
      console.log('  status:', data.status);
      console.log('  currentVersion:', data.currentVersion);
      console.log('  content len:', (data.content ?? '').length);
      console.log('  htmlContent len:', (data.htmlContent ?? '').length);
      console.log('  templateBaseline len:', (data.templateBaseline ?? '').length);

      // Check versions subcollection.
      const versions = await d.ref.collection('versions').orderBy('versionNumber', 'desc').limit(5).get();
      console.log(`  versions subcollection: ${versions.size} (showing newest 5)`);
      for (const v of versions.docs) {
        const vd = v.data();
        console.log(`    v${vd.versionNumber ?? v.id} | createdAt=${vd.createdAt} | contentLen=${(vd.content ?? '').length}`);
      }

      // Check the first paragraph snippet from content vs htmlContent.
      const peek = (s, n = 250) => (s ?? '').toString().slice(0, n).replace(/\s+/g, ' ');
      console.log('\n  content first 250:', peek(data.content));
      if (data.htmlContent && data.htmlContent !== data.content) {
        console.log('\n  htmlContent first 250:', peek(data.htmlContent));
      }
      if (data.templateBaseline) {
        console.log('\n  templateBaseline first 250:', peek(data.templateBaseline));
      }
      if (data.editorContent) {
        console.log('\n  editorContent type:', typeof data.editorContent, 'len:', JSON.stringify(data.editorContent).length);
        console.log('  editorContent first 500:', JSON.stringify(data.editorContent).slice(0, 500));
      }

      // Search content for the testator line.
      const idx1 = (data.content ?? '').indexOf('residing at');
      if (idx1 > -1) {
        console.log('\n  content "residing at" snippet:', data.content.slice(idx1, idx1 + 200));
      }
      const idx2 = (data.editorContent ? JSON.stringify(data.editorContent) : '').indexOf('residing at');
      if (idx2 > -1) {
        console.log('\n  editorContent "residing at" snippet:', JSON.stringify(data.editorContent).slice(idx2, idx2 + 300));
      }
      const idx3 = (data.templateBaseline ?? '').indexOf('residing at');
      if (idx3 > -1) {
        console.log('\n  templateBaseline "residing at" snippet:', data.templateBaseline.slice(idx3, idx3 + 200));
      }
    }
  }
  process.exit(0);
})();
