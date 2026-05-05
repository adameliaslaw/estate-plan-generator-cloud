'use strict';
const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))) });
(async () => {
  try {
    const db = admin.firestore();
    // Try multiple collection paths
    for (const coll of ['firms/elias-counsel/documentTemplates', 'firms/elias-counsel/knowledgeBase', 'firms/elias-counsel/templates']) {
      console.log(`\n>>> Trying collection: ${coll}`);
      try {
        const snap = await db.collection(coll).get();
        console.log(`  found ${snap.size} docs`);
        for (const d of snap.docs) {
          const data = d.data();
          const dt = data.docType ?? data.documentType ?? '';
          const nm = data.name ?? data.title ?? '';
          if (!/poa|power.of.attorney/i.test(dt) && !/poa|power.of.attorney/i.test(nm)) continue;
          if (data.isActive === false) continue;
          console.log(`\n  === ${d.id} ===`);
          console.log('    docType:', dt, '| name:', nm, '| sw:', data.softwareSource);
          const html = data.processedTemplate ?? data.htmlTemplate ?? data.template ?? data.content ?? '';
          if (!html) { console.log('    (no html)'); continue; }
          // Look for address-related Handlebars expressions in the agent block
          const matches = html.match(/\{\{[^}]*(address|agent\.[a-z]+)[^}]*\}\}/gi) || [];
          console.log('    address/agent expressions:', matches.slice(0, 30));
        }
      } catch(e) { console.log('  error:', e.message); }
    }
  } catch(e) { console.error('FATAL:', e); }
  process.exit(0);
})();
