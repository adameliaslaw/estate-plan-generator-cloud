'use strict';
const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))) });
(async () => {
  const db = admin.firestore();
  const docRef = db.collection('firms/elias-counsel/documentTemplates').doc('92qPzaWa3kmtNQ3NBvLL');
  const snap = await docRef.get();
  const data = snap.data();
  const html = data.processedTemplate ?? data.htmlTemplate ?? data.template ?? data.content ?? '';
  // Find every occurrence of an agent.address expression with surrounding text.
  const re = /[^>]{0,80}\{\{fiduciaries\.powerOfAttorney\.[^}]+\}\}[^<]{0,80}/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    console.log('---');
    console.log(m[0].replace(/\s+/g, ' ').trim());
  }
  process.exit(0);
})();
