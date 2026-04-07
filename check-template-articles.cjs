const admin = require('./functions/node_modules/firebase-admin');
const fs = require('fs');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync('./service-account.json', 'utf8'))) });

async function checkTemplate() {
  const db = admin.firestore();
  const firmId = 'elias-counsel';
  console.log(`Checking templates for firm: ${firmId}...`);
  
  const snap = await db.collection(`firms/${firmId}/documentTemplates`)
    .where('softwareSource', '==', 'interactivelegal')
    .get();

  if (snap.empty) {
    console.log('No InteractiveLegal templates found.');
    return;
  }

  for (const doc of snap.docs) {
    const data = doc.data();
    const content = data.content || '';
    
    // Find all paragraphs with tr-art classes
    const regex = /<p class="tr-art[1-4][^"]*"[^>]*>(.*?)<\/p>/g;
    let match;
    console.log(`\n--- Template: ${data.name} (${data.docType}) ---`);
    let found = false;
    while ((match = regex.exec(content)) !== null) {
      const clsMatch = match[0].match(/tr-art[1-4]/);
      const cls = clsMatch ? clsMatch[0] : 'unknown';
      console.log(`Class: ${cls} | Text: "${match[1]}"`);
      found = true;
    }
    if (!found) console.log('No tr-art paragraphs found.');
  }
}

checkTemplate().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
