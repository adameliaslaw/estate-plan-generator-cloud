'use strict';
const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))) });

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function snippetsAround(html, regex, len = 350) {
  const text = stripTags(html);
  const out = [];
  let m;
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  while ((m = re.exec(text)) !== null) {
    const start = Math.max(0, m.index - 40);
    out.push(text.slice(start, m.index + len));
  }
  return out;
}

(async () => {
  const db = admin.firestore();
  const snap = await db.collection('firms/elias-counsel/clients').get();
  for (const c of snap.docs) {
    const cd = c.data();
    const pi = cd.personalInfo ?? {};
    if (!/karen|adam/i.test(pi.firstName ?? '')) continue;
    const docs = await c.ref.collection('documents').get();
    for (const d of docs.docs) {
      const data = d.data();
      if (data.docType !== 'will') continue;
      console.log(`\n=== ${pi.firstName} ${pi.lastName} → ${d.id} ===`);
      console.log('  generatedAt:', data.generatedAt?.toDate?.() ?? data.generatedAt);
      console.log('  resolvedTemplateId:', data.resolvedTemplateId, '| resolvedMode:', data.resolvedMode);
      const html = data.content ?? data.htmlContent ?? '';
      console.log('  total length:', html.length);

      // Count occurrences of MISSING markers in the rendered will.
      const missingMatches = (stripTags(html).match(/\[MISSING:[^\]]+\]/g) ?? []);
      console.log('  [MISSING: ...] markers:', missingMatches.length);
      missingMatches.forEach((m) => console.log('   •', m));

      // Find Executor paragraphs.
      console.log('\n  --- Executor paragraphs ---');
      const execSnips = snippetsAround(html, /to serve as Executor/i, 200);
      execSnips.forEach((s, i) => console.log(`  [${i}]`, s));

      // Find Trustee paragraphs.
      console.log('\n  --- Trustee paragraphs ---');
      const trusteeSnips = snippetsAround(html, /to serve as Trustee/i, 200);
      trusteeSnips.forEach((s, i) => console.log(`  [${i}]`, s));
    }
  }
  process.exit(0);
})();
