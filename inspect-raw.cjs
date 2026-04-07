const admin = require('./functions/node_modules/firebase-admin');
const fs = require('fs');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync('./service-account.json', 'utf8'))) });

async function inspectRaw() {
  const db = admin.firestore();
  console.log('Inspecting raw content for InteractiveLegal headers...');
  const snap = await db.collection('firms/elias-counsel/documentTemplates')
    .where('softwareSource', '==', 'interactivelegal')
    .limit(1)
    .get();

  if (snap.empty) return console.log('No templates.');
  const data = snap.docs[0].data();
  console.log('--- RAW CONTENT SNIPPET ---');
  console.log((data.rawContent || '').substring(0, 5000));
}

inspectRaw().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
