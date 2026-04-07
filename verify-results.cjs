const admin = require('./functions/node_modules/firebase-admin');
const fs = require('fs');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync('./service-account.json', 'utf8'))) });

async function verify() {
  const db = admin.firestore();
  console.log('Fetching clients...');
  const clientsSnap = await db.collection('firms/elias-counsel/clients').get();
  console.log(`Found ${clientsSnap.size} clients.`);

  for (const clientDoc of clientsSnap.docs) {
    const documentsSnap = await clientDoc.ref.collection('documents').get(); // No ordering to avoid index issues
    if (documentsSnap.size > 0) {
      console.log(`\n--- Client: ${clientDoc.id} (${clientDoc.data().fullName || 'No Name'}) ---`);
      // Sort in memory to see latest
      const docs = documentsSnap.docs.sort((a, b) => b.updateTime.toMillis() - a.updateTime.toMillis()).slice(0, 5);

      docs.forEach(d => {
        const x = d.data();
        const content = x.content || '';
        const hasTr = content.includes('tr-');
        const hasHbs = content.includes('{{');
        const hasName = content.includes('Sean') || content.includes('Adam') || content.includes('Jessica') || content.includes('Byrnes');
        
        console.log(`Doc: ${x.docType} | ${x.title}`);
        console.log(`  Styles (tr-*): ${hasTr ? '✅ FOUND' : '❌ MISSING'}`);
        console.log(`  HBS Cleanup:   ${!hasHbs ? '✅ OK' : '❌ FAIL ({{ found)'}`);
        console.log(`  Name Match:    ${hasName ? '✅ OK' : '❌ FAIL'}`);
        console.log(`  Length:        ${content.length} chars`);
      });
    }
  }
}

verify().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
