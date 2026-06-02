'use strict';
const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))) });
(async () => {
  const db = admin.firestore();
  const clients = await db.collection('firms').doc('elias-counsel').collection('clients').get();
  const karen = clients.docs.find((d) => /karen/i.test(d.data().personalInfo?.firstName ?? ''));
  console.log('Karen children:');
  console.log(JSON.stringify(karen.data().children, null, 2));
  process.exit(0);
})();
