'use strict';
const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))) });
(async () => {
  const db = admin.firestore();
  const clients = await db.collection('firms').doc('elias-counsel').collection('clients').get();
  for (const d of clients.docs) {
    const data = d.data();
    const pi = data.personalInfo ?? {};
    if (!/karen|adam/i.test(pi.firstName ?? '')) continue;
    console.log(`\n=== ${pi.firstName} ${pi.lastName} (${d.id}) ===`);
    console.log('  gender:', pi.gender);
    console.log('  maritalStatus:', pi.maritalStatus);
    console.log('  address:', pi.address, pi.city, pi.state);
    console.log('  fiduciaries:', JSON.stringify(data.fiduciaries, null, 2));
  }
  process.exit(0);
})();
