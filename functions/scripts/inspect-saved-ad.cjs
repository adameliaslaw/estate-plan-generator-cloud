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
    if (!/karen|adam/i.test(pi.firstName ?? '')) continue;
    const docs = await c.ref.collection('documents').get();
    for (const d of docs.docs) {
      const data = d.data();
      if (data.docType !== 'livingWill') continue;
      console.log(`\n=== ${pi.firstName} ${pi.lastName} → ${d.id} ===`);
      console.log('  generatedAt:', data.generatedAt?.toDate?.() ?? data.generatedAt);
      console.log('  resolvedTemplateId:', data.resolvedTemplateId, '| resolvedMode:', data.resolvedMode);
      const html = data.content ?? data.htmlContent ?? '';
      const idx = html.indexOf('Successor Health Care');
      if (idx > -1) {
        console.log('  --- Successor HCR snippet ---');
        console.log(html.slice(idx, idx + 700).replace(/\s+/g, ' '));
      }
    }
  }
  process.exit(0);
})();
