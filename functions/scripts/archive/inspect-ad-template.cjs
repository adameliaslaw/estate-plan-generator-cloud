'use strict';
const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))) });
(async () => {
  const db = admin.firestore();
  const snap = await db.collection('firms/elias-counsel/documentTemplates').get();
  for (const d of snap.docs) {
    const data = d.data();
    if (data.docType !== 'livingWill') continue;
    if (data.isActive === false) continue;
    console.log(`\n=== ${d.id} (${data.name}) ===`);
    const html = data.processedTemplate ?? data.htmlTemplate ?? data.template ?? data.content ?? '';
    // Find every healthcare/POA/agent expression
    const re = /\{\{[^}]*(healthcareProxy|powerOfAttorney|agent|alternateAgent|alternate)[^}]*\}\}/gi;
    const matches = html.match(re) || [];
    console.log('  fiduciary expressions:', matches);
    // Show context around 'Successor Health Care' phrase
    const idx = html.indexOf('Successor Health Care');
    if (idx > -1) {
      console.log('\n  --- Successor HCR snippet ---');
      console.log(html.slice(idx, idx + 600).replace(/\s+/g, ' '));
    }
  }
  process.exit(0);
})();
