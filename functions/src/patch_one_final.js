const admin = require('firebase-admin');

async function patchOne() {
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  const docRef = db.collection('firms').doc('elias-counsel').collection('documentTemplates').doc('AdOq5Bj4eDDv4pd20wzP');
  const doc = await docRef.get();
  const data = doc.data();
  let html = data.content;

  const romanNumerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  const skipped = ['if my', 'appointment of', 'distribution to', 'power to', 'reliance upon', 'executor as', 'effect of'];
  let articleIndex = 0;

  console.log('--- BEFORE PATCH ---');
  // Look for Family Information
  const pos = html.indexOf('Family Information');
  if (pos !== -1) console.log(html.substring(pos-20, pos+40));

  html = html.replace(/<p class="tr-art1">(.*?)<\/p>/gi, (match, content) => {
    const plain = content.replace(/<[^>]*>/g, '').trim();
    if (plain.toUpperCase().includes('ARTICLE')) return match;
    
    let skip = false;
    for (const p of skipped) { if (plain.toLowerCase().startsWith(p)) { skip = true; break; } }
    
    if (skip) {
      return `<p class="tr-art2">${content}</p>`;
    } else {
      const roman = romanNumerals[articleIndex] || (articleIndex + 1);
      articleIndex++;
      return `<p class="tr-art1"><strong>ARTICLE ${roman} — </strong>${content}</p>`;
    }
  });

  console.log('--- AFTER PATCH ---');
  const pos2 = html.indexOf('Family Information');
  if (pos2 !== -1) console.log(html.substring(pos2-40, pos2+40));

  await docRef.update({ content: html, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  console.log('Patch one final success.');
}

patchOne().catch(console.error);
