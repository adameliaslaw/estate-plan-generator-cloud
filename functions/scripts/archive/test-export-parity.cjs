#!/usr/bin/env node
/**
 * functions/scripts/test-export-parity.cjs
 *
 * Step 3 verification: feed the generated HTML from test-generate-one.cjs
 * into both the PDF and DOCX builders and compare what each preserves.
 * Saves all three artifacts (HTML / DOCX / PDF-as-HTML-shell) to ./out
 * for visual side-by-side inspection.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Packer } = require('docx');

const { buildLegalDocumentHtml } = require('../lib/export-pdf');
const { buildDocxDocument } = require('../lib/export-docx');

const OUT_DIR = path.resolve(__dirname, '..', '..', 'out');
const HTML_INPUT_GLOB = /^test-generation-.*\.html$/;

(async () => {
  // Find the most recent test generation HTML.
  const files = fs.readdirSync(OUT_DIR).filter((f) => HTML_INPUT_GLOB.test(f));
  if (files.length === 0) {
    console.error('No test-generation-*.html files in ./out — run test-generate-one.cjs first.');
    process.exit(1);
  }
  const inputPath = path.join(OUT_DIR, files[files.length - 1]);
  const html = fs.readFileSync(inputPath, 'utf8');
  console.log(`Input HTML: ${inputPath} (${html.length} chars)`);

  const TITLE = 'Last Will and Testament of Karen K. Elias';
  const STATUS = 'draft';

  // 1. Build the PDF-shell HTML (this is the input to puppeteer in production).
  console.log('\n--- Building PDF shell HTML ---');
  const pdfShellHtml = buildLegalDocumentHtml(TITLE, html, STATUS);
  const pdfShellPath = path.join(OUT_DIR, 'export-pdf-shell.html');
  fs.writeFileSync(pdfShellPath, pdfShellHtml, 'utf8');
  console.log(`PDF shell HTML: ${pdfShellHtml.length} chars  →  ${pdfShellPath}`);

  // Diagnostic: count tr-* paragraphs preserved.
  const trInPdf = (pdfShellHtml.match(/\bclass=["'][^"']*\btr-[^"']*["']/gi) ?? []).length;
  const trInSrc = (html.match(/\bclass=["'][^"']*\btr-[^"']*["']/gi) ?? []).length;
  console.log(`PDF tr-* class count: ${trInPdf}  (source: ${trInSrc})`);

  // 2. Build the DOCX document.
  console.log('\n--- Building DOCX ---');
  const t0 = Date.now();
  const docxDoc = buildDocxDocument(TITLE, html, STATUS);
  const docxBuf = await Packer.toBuffer(docxDoc);
  const docxPath = path.join(OUT_DIR, 'export-docx-output.docx');
  fs.writeFileSync(docxPath, docxBuf);
  console.log(`DOCX: ${docxBuf.length} bytes (${(Date.now() - t0)}ms)  →  ${docxPath}`);

  // 3. Diagnostic: extract docx contents and check formatting traveled.
  // DOCX is a zip; the main content lives in word/document.xml.
  console.log('\n--- DOCX content audit ---');
  const AdmZip = (() => { try { return require('adm-zip'); } catch { return null; } })();
  if (AdmZip) {
    const zip = new AdmZip(docxBuf);
    const docXmlEntry = zip.getEntry('word/document.xml');
    if (docXmlEntry) {
      const xml = docXmlEntry.getData().toString('utf8');
      // Count run/paragraph/property markers
      const counts = {
        paragraphs: (xml.match(/<w:p[ >]/g) ?? []).length,
        runs: (xml.match(/<w:r[ >]/g) ?? []).length,
        bolds: (xml.match(/<w:b\/>/g) ?? []).length,
        underlines: (xml.match(/<w:u /g) ?? []).length,
        center: (xml.match(/w:val="center"/g) ?? []).length,
        justify: (xml.match(/w:val="(both|justify)"/g) ?? []).length,
        firstLineIndent: (xml.match(/<w:ind [^/]*w:firstLine=/g) ?? []).length,
        leftIndent: (xml.match(/<w:ind [^/]*w:left=/g) ?? []).length,
        timesNewRoman: (xml.match(/Times New Roman/g) ?? []).length,
        fontSizes: [...new Set((xml.match(/<w:sz w:val="\d+"/g) ?? []).map((m) => m.replace(/.*"(\d+)".*/, '$1')))],
      };
      console.log('  paragraphs:', counts.paragraphs);
      console.log('  runs:', counts.runs);
      console.log('  bold runs:', counts.bolds);
      console.log('  underline runs:', counts.underlines);
      console.log('  center alignment:', counts.center);
      console.log('  justify alignment:', counts.justify);
      console.log('  first-line indents:', counts.firstLineIndent);
      console.log('  left indents:', counts.leftIndent);
      console.log('  Times New Roman runs:', counts.timesNewRoman);
      console.log('  distinct font-sizes (half-pt):', counts.fontSizes.join(', '));
    }
  } else {
    console.log('  (adm-zip not installed; skipping DOCX content audit)');
  }

  console.log('\n--- Verdict heuristics ---');
  // We expect non-trivial counts of: bolds (tr-art1, tr-sig-name), underlines
  // (tr-title, tr-mem-header1), center alignment (tr-title, tr-art1, tr-cover-title),
  // justify (tr-body1, tr-body3, tr-art2), and at least 2 distinct font sizes.
  console.log('Open the three artifacts side by side:');
  console.log(`  HTML preview: ${inputPath}`);
  console.log(`  PDF shell:    ${pdfShellPath}  (open in browser to mimic puppeteer render)`);
  console.log(`  DOCX:         ${docxPath}        (open in Word — should match preview/PDF)`);

  process.exit(0);
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
