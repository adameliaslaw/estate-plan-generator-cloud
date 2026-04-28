'use strict';
const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))) });
(async () => {
  const db = admin.firestore();
  const snap = await db.collection('firms/elias-counsel/documentTemplates').get();
  for (const d of snap.docs) {
    const data = d.data();
    if (data.docType !== 'poa') continue;
    if (data.isActive === false) continue;
    console.log(`\n=== ${d.id} (${data.name}) ===`);
    const html = data.processedTemplate ?? data.htmlTemplate ?? data.template ?? data.content ?? '';
    // Find Restriction on Authority block
    const idx = html.indexOf('Restriction on Authority');
    if (idx > -1) {
      console.log('  --- Restriction snippet ---');
      console.log(html.slice(idx, idx + 600).replace(/\s+/g, ' '));
    }
    // Also: find any reference to AIF + pronoun
    const re = /Attorney-in-Fact[^.]{0,200}\b(his|her|him)\b[^.]{0,80}/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      console.log('  AIF+pronoun:', m[0].slice(0, 220).replace(/\s+/g, ' '));
    }
  }
  process.exit(0);
})();
