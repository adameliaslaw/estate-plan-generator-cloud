'use strict';
const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))) });
(async () => {
  const db = admin.firestore();
  const snap = await db.collection('firms/elias-counsel/clients').get();
  for (const d of snap.docs) {
    const data = d.data();
    const pi = data.personalInfo ?? {};
    if (!/karen/i.test(pi.firstName ?? '')) continue;
    console.log(`\n=== ${pi.firstName} ${pi.lastName} (${d.id}) ===`);
    console.log('FULL fiduciaries:');
    console.log(JSON.stringify(data.fiduciaries ?? {}, null, 2));
  }
  process.exit(0);
})();
