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
    console.log(`\n=== ${pi.firstName} ${pi.lastName} (${c.id}) ===`);
    console.log('  personalInfo.address:', pi.address);
    console.log('  personalInfo.city:', pi.city);
    console.log('  personalInfo.state:', pi.state);
    console.log('\n  spouseInfo:');
    console.log(JSON.stringify(cd.spouseInfo ?? null, null, 2));
  }
  process.exit(0);
})();
