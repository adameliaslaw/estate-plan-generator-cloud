const admin = require('firebase-admin');

admin.initializeApp({
  projectId: 'estate-plan-generator-488918'
});

const db = admin.firestore();

async function checkTemplates() {
  console.log('Querying all active templates across all firms...');
  const templatesSnap = await db.collectionGroup('documentTemplates').where('isActive', '==', true).get();
  
  let emptyCount = 0;
  for (const tDoc of templatesSnap.docs) {
    const data = tDoc.data();
    const content = data.content || data.editorContent || '';
    if (content.trim().length < 50) {
      emptyCount++;
      console.log(`Found empty/short active template:`);
      console.log(`- Template ID: ${tDoc.id}`);
      console.log(`- docType: ${data.docType}`);
      console.log(`- name: ${data.name}`);
      console.log(`- content: '${content}'`);
      console.log(`- firmId: ${tDoc.ref.parent.parent.id}`);
      console.log('---');
    }
  }
  console.log(`Finished. Found ${emptyCount} empty/short active templates out of ${templatesSnap.size} total active templates.`);
}

checkTemplates().then(() => {
  console.log('Done');
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
