const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Force production, ignore emulator
delete process.env.FIRESTORE_EMULATOR_HOST;

const serviceAccount = require('../service-account.json');

initializeApp({
  credential: cert(serviceAccount),
  projectId: 'estate-plan-generator' // Explicitly use the prod project
});

const db = getFirestore();

async function run() {
  console.log('Fetching templates from production Firestore...');
  const snap = await db.collection('templates').orderBy('createdAt', 'desc').limit(4).get();
  
  if (snap.empty) {
    console.log('No templates found! Check database or project ID.');
    return;
  }
  
  snap.forEach(doc => {
    const d = doc.data();
    console.log(`\n--- ${d.name} (${d.detectedVariables ? d.detectedVariables.length : 0} vars) ---`);
    if (d.detectedVariables) {
      const vars = d.detectedVariables.map(v => v.suggestedVariable).sort();
      console.log(vars.join('\n'));
    }
  });
}

run().catch(console.error);
