const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp({
  credential: cert(require('../service-account.json')),
  projectId: 'estate-plan-generator'
});

const db = getFirestore();

async function run() {
  const snap = await db.collection('templates').orderBy('createdAt', 'desc').limit(4).get();
  snap.forEach(doc => {
    const d = doc.data();
    console.log(`\n--- ${d.name} (${d.detectedVariables.length} vars) ---`);
    const vars = d.detectedVariables.map(v => v.suggestedVariable).sort();
    console.log(vars.join('\n'));
  });
}

run().catch(console.error);
