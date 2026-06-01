'use strict';
const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))) });
(async () => {
  const db = admin.firestore();
  const snap = await db.collection('firms').doc('elias-counsel').collection('documentTemplates').doc('CCepgSwMNusH1jsWPRf8').get();
  const content = snap.data().content;
  console.log('Raw template content length:', content.length);
  // Look for malformed <pclass=
  const malformedPattern = /<p(class=|[a-z]+\s*=)/g;
  const matches = [...content.matchAll(malformedPattern)];
  console.log(`Malformed <pSomething tags: ${matches.length}`);
  for (const m of matches.slice(0, 10)) {
    console.log(`  at offset ${m.index}: "${content.slice(Math.max(0, m.index - 10), m.index + 50)}"`);
  }

  // Also check rawContent if present
  if (snap.data().rawContent) {
    const raw = snap.data().rawContent;
    const rawMatches = [...raw.matchAll(malformedPattern)];
    console.log(`\nRaw rawContent has ${rawMatches.length} malformed tags`);
  }
  process.exit(0);
})();
