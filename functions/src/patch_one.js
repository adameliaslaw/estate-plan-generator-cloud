const admin = require('firebase-admin');
const fs = require('fs');
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const content = fs.readFileSync('C:\\Users\\adame\\.gemini\\antigravity\\brain\\6a36dcc9-bffb-4e4e-b484-1a52591da1df\\patched_will_content.txt', 'utf8');
db.collection('firms').doc('elias-counsel').collection('documentTemplates').doc('AdOq5Bj4eDDv4pd20wzP').update({
  content: content,
  updatedAt: admin.firestore.FieldValue.serverTimestamp()
}).then(() => console.log('Successfully updated template AdOq5Bj4eDDv4pd20wzP')).catch(err => { console.error(err); process.exit(1); });
