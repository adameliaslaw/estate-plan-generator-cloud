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
  const snap = await db.collection('templates')
    .orderBy('createdAt', 'desc')
    .limit(4)
    .get();
  
  const templates = [];
  snap.forEach(doc => {
    const d = doc.data();
    templates.push({
        name: d.name,
        vars: d.detectedVariables ? d.detectedVariables.map(v => v.suggestedVariable).sort() : []
    });
  });

  if (templates.length < 4) {
      console.log('Not enough templates found.');
      return;
  }

  // templates[0] and templates[1] are the most recent 44 variable runs
  // templates[2] and templates[3] are the older 46 variable runs
  
  const newerRun = new Set([...templates[0].vars, ...templates[1].vars]);
  const olderRun = new Set([...templates[2].vars, ...templates[3].vars]);
  
  console.log(`\nNewer run total unique vars: ${newerRun.size}`);
  console.log(`Older run total unique vars: ${olderRun.size}`);
  
  console.log('\n--- Missing in Newer Run (Dropped Variables) ---');
  for (const v of olderRun) {
      if (!newerRun.has(v)) {
          console.log(v);
      }
  }

  console.log('\n--- Added in Newer Run (New Variables) ---');
  for (const v of newerRun) {
      if (!olderRun.has(v)) {
          console.log(v);
      }
  }
}

run().catch(console.error);
