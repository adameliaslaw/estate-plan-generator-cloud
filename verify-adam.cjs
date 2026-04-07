const admin = require('./functions/node_modules/firebase-admin');
const fs = require('fs');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync('./service-account.json', 'utf8'))) });

async function findClient() {
  const db = admin.firestore();
  const clientsSnap = await db.collection('firms/elias-counsel/clients').get();
  for (const doc of clientsSnap.docs) {
    const data = doc.data();
    if (data.fullName === 'Adam Elias' || data.firstName === 'Adam' || data.clientName === 'Adam Elias') {
      console.log('Found Client:', doc.id, data.fullName);
      return doc.id;
    }
  }
  return null;
}

findClient().then(id => {
  if (id) {
    admin.firestore().collection(`firms/elias-counsel/clients/${id}/documents`)
      .orderBy('updatedAt', 'desc')
      .limit(5)
      .get()
      .then(s => {
        s.docs.forEach(d => {
          const x = d.data();
          const content = x.content || '';
          console.log(`Doc: ${x.docType} | Title: ${x.title}`);
          console.log(`  hasTr: ${content.includes('tr-')}`);
          console.log(`  hasHbs: ${content.includes('{{')}`);
          console.log(`  Sample: ${content.substring(0, 100)}`);
        });
        process.exit(0);
      });
  } else {
    console.log('Client Adam Elias not found');
    process.exit(0);
  }
}).catch(e => { console.error(e.message); process.exit(1); });
