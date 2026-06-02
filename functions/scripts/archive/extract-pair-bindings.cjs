'use strict';
// Reads tmp/dedup/<pair>__{A,B}.html, extracts every <p>...</p> that
// contains a spouseFullName / spouseInfo / fiduciaries.* binding, and
// writes them side-by-side (one per line, full untruncated) to
// tmp/dedup/<pair>__bindings.txt so an attorney can compare prose.
const fs = require('fs');
const path = require('path');

const PAIRS = ['JessicaHC', 'JessicaPOA', 'RizzoTrust', 'JessicaLWT'];
const DIR = path.resolve(__dirname, '..', '..', 'tmp', 'dedup');

const TRIGGER = /\{\{\s*(?:spouseFullName|spouseTitle|spouseInfo\.[a-zA-Z]+|fiduciaries\.[a-zA-Z]+\.[a-zA-Z]+)/;

function extractBindingParas(html) {
  const out = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/g;
  let m, idx = 0;
  while ((m = re.exec(html)) !== null) {
    if (TRIGGER.test(m[1])) {
      out.push({ idx, html: m[0].replace(/\s+/g, ' ').trim() });
    }
    idx++;
  }
  return out;
}

for (const pair of PAIRS) {
  const aHtml = fs.readFileSync(path.join(DIR, `${pair}__A.html`), 'utf8');
  const bHtml = fs.readFileSync(path.join(DIR, `${pair}__B.html`), 'utf8');
  const a = extractBindingParas(aHtml);
  const b = extractBindingParas(bHtml);
  const lines = [];
  lines.push(`====== ${pair} ======`);
  lines.push(`A: ${a.length} binding-paragraphs`);
  for (const p of a) lines.push(`  A[${p.idx}] ${p.html}`);
  lines.push('');
  lines.push(`B: ${b.length} binding-paragraphs`);
  for (const p of b) lines.push(`  B[${p.idx}] ${p.html}`);
  fs.writeFileSync(path.join(DIR, `${pair}__bindings.txt`), lines.join('\n'));
  console.log(`[wrote] ${pair}__bindings.txt — A=${a.length} B=${b.length}`);
}
