/**
 * inspect-xml.cjs
 *
 * Show how a phrase is actually stored inside a .docx's word/document.xml.
 *
 * Usage:
 *   node scripts/diagnostics/inspect-xml.cjs <file.docx> "<phrase>"
 *
 * Why this exists: Word splits a paragraph into <w:r>/<w:t> runs at arbitrary
 * points, so a phrase that is plainly visible in the document may not exist as
 * a contiguous string in the XML. Any tool that regexes over document.xml will
 * silently miss it. This prints both counts so the difference is visible.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

let PizZip;
try {
  PizZip = createRequire(path.join(REPO_ROOT, 'functions', 'package.json'))('pizzip');
} catch {
  console.error('FATAL: could not load pizzip. Run `npm ci --prefix functions` first.');
  process.exit(2);
}

const [filePath, phrase] = process.argv.slice(2);
if (!filePath || !phrase) {
  console.error('Usage: node scripts/diagnostics/inspect-xml.cjs <file.docx> "<phrase>"');
  process.exit(2);
}
if (!fs.existsSync(filePath)) {
  console.error(`FATAL: file not found — ${filePath}`);
  process.exit(2);
}

const zip = new PizZip(fs.readFileSync(path.resolve(filePath), 'binary'));
const xml = zip.file('word/document.xml').asText();

// Visible text: concatenate the <w:t> runs of each paragraph.
const paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [];
const text = paragraphs
  .map((p) =>
    [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((m) =>
        m[1]
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&amp;/g, '&'),
      )
      .join(''),
  )
  .join('\n');

const inXml = xml.split(phrase).length - 1;
const inText = text.split(phrase).length - 1;

console.log(`file:    ${filePath}`);
console.log(`phrase:  ${JSON.stringify(phrase)}`);
console.log(`in raw document.xml: ${inXml}`);
console.log(`in visible text:     ${inText}`);

if (inText > inXml) {
  console.log(
    `\nSPLIT ACROSS RUNS: ${inText - inXml} occurrence(s) are invisible to a ` +
      `regex over document.xml. A run-aware replacement is required.`,
  );
  const at = text.indexOf(phrase);
  // Anchor on the phrase's longest word — a short leading token like "16"
  // matches inside the document's namespace declarations instead.
  const anchor = phrase
    .split(/\s+/)
    .reduce((a, b) => (b.length > a.length ? b : a), '');
  const start = xml.indexOf(anchor);
  if (start !== -1) {
    console.log(`\nXML around the first fragment (offset ${start}):`);
    console.log(xml.slice(Math.max(0, start - 80), start + 320));
  }
  console.log(`\nVisible context:`);
  console.log(text.slice(Math.max(0, at - 100), at + 160).replace(/\s+/g, ' '));
} else if (inXml > 0) {
  const at = xml.indexOf(phrase);
  console.log(`\nContiguous in the XML. Context at offset ${at}:`);
  console.log(xml.slice(Math.max(0, at - 80), at + 200));
} else {
  console.log('\nNot present in this document, in either form.');
}
