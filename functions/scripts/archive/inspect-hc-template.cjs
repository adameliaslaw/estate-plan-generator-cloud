'use strict';
const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))) });

(async () => {
  const db = admin.firestore();
  const snap = await db.collection('firms/elias-counsel/documentTemplates').get();
  for (const d of snap.docs) {
    const t = d.data();
    const docTypes = t.docTypes ?? (t.docType ? [t.docType] : []);
    if (!docTypes.some((x) => /livingWill|healthcare|advance/i.test(x))) continue;
    console.log(`\n========== ${d.id} ==========`);
    console.log('  name:', t.name);
    console.log('  docTypes:', docTypes);
    console.log('  softwareSource:', t.softwareSource);
    console.log('  isActive:', t.isActive, '| isDefault:', t.isDefault);
    const html = t.content ?? t.html ?? '';
    console.log('  content length:', html.length);

    // Find "Health Care Representative" — could be primary or successor.
    let i = -1;
    const occs = [];
    while ((i = html.indexOf('Health Care Representative', i + 1)) !== -1) occs.push(i);
    console.log('  "Health Care Representative" occurrences:', occs.length);
    for (let k = 0; k < Math.min(occs.length, 3); k++) {
      const idx = occs[k];
      console.log(`\n  --- Occurrence ${k} at offset ${idx} ---`);
      const slice = html.slice(Math.max(0, idx - 400), idx + 300);
      console.log(slice.replace(/\s+/g, ' '));
    }
  }
  process.exit(0);
})();
