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
    const start = Math.max(0, m.index - 80);
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
    if (!/karen/i.test(pi.firstName ?? '')) continue;

    console.log(`\n========== ${pi.firstName} ${pi.lastName} (${c.id}) ==========`);
    console.log('  personalInfo:', JSON.stringify(pi, null, 2));
    console.log('\n  fiduciaries.healthcareProxy:');
    console.log(JSON.stringify(cd.fiduciaries?.healthcareProxy ?? {}, null, 2));

    const docs = await c.ref.collection('documents').get();
    for (const d of docs.docs) {
      const data = d.data();
      if (data.docType !== 'livingWill') continue;
      const html = data.content ?? data.htmlContent ?? '';
      if (html.length < 500) continue;
      console.log(`\n=== ${d.id} (${html.length} chars) ===`);

      const missingMatches = (stripTags(html).match(/\[MISSING:[^\]]+\]/g) ?? []);
      console.log('  [MISSING: ...] markers:', missingMatches.length);
      missingMatches.forEach((m) => console.log('   •', m));

      // Find Healthcare Representative paragraphs (any context — primary or alternate).
      const repSnips = snippetsAround(html, /health\s*care\s+representative/i, 250);
      console.log('  --- Healthcare Rep references ---');
      repSnips.slice(0, 4).forEach((s, i) => console.log(`  [${i}]`, s));

      // Find "residing at" or "of <address>" — testator self-reference.
      const residingSnips = snippetsAround(html, /residing at|, of /i, 200);
      console.log('  --- Residing/Of references (first 4) ---');
      residingSnips.slice(0, 4).forEach((s, i) => console.log(`  [${i}]`, s));
    }
  }
  process.exit(0);
})();
