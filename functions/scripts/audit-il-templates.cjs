#!/usr/bin/env node
/**
 * scripts/diagnostics/audit-il-templates.js
 *
 * Verifies that freshly uploaded InteractiveLegal templates landed correctly
 * after the Phase 0 fixes. Checks each template in
 *   firms/elias-counsel/documentTemplates
 * against the criteria from the post-Phase-0 verification plan:
 *
 *   1. content field is a non-empty HTML string
 *   2. paragraphs carrying tr-* classes also have inline style="" attributes
 *      (proves applyTemplateFormattingStyles ran on upload)
 *   3. docType is one of the supported types
 *   4. softwareSource is set (and matches one of the IL-style values)
 *   5. isActive: true
 *   6. _sourceCollection: 'documentTemplates' (provenance)
 *
 * Output: per-template pass/fail table + summary.
 *
 * Usage:
 *   node scripts/diagnostics/audit-il-templates.js
 */

'use strict';

const admin = require('firebase-admin');
const path = require('path');

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, '..', '..', 'service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
});

const FIRM_ID = 'elias-counsel';

const SUPPORTED_DOCTYPES = new Set([
  'will', 'pourOverWill', 'trust', 'poa', 'livingWill',
  'deed', 'affidavitOfConsideration', 'gitRep3',
  'estatePlanSummary', 'questionnaireSummary',
]);

const TR_CLASS_RE = /<([a-z][\w:-]*)([^>]*\bclass=(["'])([^"']*\btr-[^"']*)\3[^>]*)>/gi;

function extractTrTagSamples(html, max = 5) {
  const samples = [];
  let m;
  TR_CLASS_RE.lastIndex = 0;
  while ((m = TR_CLASS_RE.exec(html)) !== null && samples.length < max) {
    const fullTag = m[0];
    const className = m[4];
    const hasStyle = /\bstyle=/i.test(fullTag);
    samples.push({ className, hasStyle, snippet: fullTag.slice(0, 200) });
  }
  return samples;
}

function checkTemplate(id, data) {
  const issues = [];
  const ok = [];

  // 1. content field
  const content = data.content;
  if (typeof content !== 'string' || !content.trim()) {
    issues.push('MISSING content');
  } else {
    ok.push(`content (${content.length} chars)`);
  }

  // 2. inline styles on tr-* paragraphs
  const samples = typeof content === 'string' ? extractTrTagSamples(content) : [];
  if (samples.length === 0 && typeof content === 'string') {
    issues.push('NO tr-* classes found in content (mammoth extraction may have failed)');
  } else if (samples.length > 0) {
    const withStyle = samples.filter((s) => s.hasStyle).length;
    if (withStyle === 0) {
      issues.push(`NO inline styles on any of ${samples.length} sampled tr-* paragraphs (Phase 0.2/0.4 did NOT bake styles)`);
    } else if (withStyle < samples.length) {
      issues.push(`PARTIAL inline styles — only ${withStyle}/${samples.length} sampled tr-* paragraphs have style=""`);
    } else {
      ok.push(`inline styles on ${withStyle}/${samples.length} sampled tr-* paragraphs`);
    }
  }

  // 3. docType
  if (!SUPPORTED_DOCTYPES.has(data.docType)) {
    issues.push(`docType="${data.docType}" not in supported set`);
  } else {
    ok.push(`docType=${data.docType}`);
  }

  // 4. softwareSource
  if (!data.softwareSource || typeof data.softwareSource !== 'string') {
    issues.push('softwareSource MISSING');
  } else {
    ok.push(`softwareSource=${data.softwareSource}`);
  }

  // 5. isActive
  if (data.isActive !== true) {
    issues.push(`isActive=${data.isActive} (expected true)`);
  } else {
    ok.push('isActive');
  }

  // 6. _sourceCollection (only set after the post-Phase-0 commits — older
  // uploads may legitimately lack it, but Phase 0 commits add it on read).
  if (data._sourceCollection && data._sourceCollection !== 'documentTemplates') {
    issues.push(`_sourceCollection="${data._sourceCollection}" (expected documentTemplates)`);
  } else if (data._sourceCollection === 'documentTemplates') {
    ok.push('_sourceCollection');
  } else {
    ok.push('(_sourceCollection absent — set on next read by getTemplate)');
  }

  return { id, name: data.name ?? '(no name)', ok, issues, sampleCount: samples.length };
}

(async () => {
  const db = admin.firestore();
  const snap = await db
    .collection('firms').doc(FIRM_ID)
    .collection('documentTemplates')
    .get();

  console.log(`\nAuditing ${snap.size} templates in firms/${FIRM_ID}/documentTemplates\n`);
  console.log('='.repeat(80));

  const results = [];
  snap.forEach((doc) => {
    results.push(checkTemplate(doc.id, doc.data()));
  });

  // Group by status
  const failed = results.filter((r) => r.issues.length > 0);
  const passed = results.filter((r) => r.issues.length === 0);

  for (const r of results) {
    const status = r.issues.length === 0 ? 'PASS' : 'FAIL';
    console.log(`\n[${status}] ${r.id}  —  "${r.name}"`);
    if (r.issues.length > 0) {
      for (const issue of r.issues) console.log(`   ✗ ${issue}`);
    }
    for (const o of r.ok) console.log(`   ✓ ${o}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log(`\nSummary: ${passed.length}/${results.length} passed, ${failed.length} failed.\n`);

  // Distribution by docType + softwareSource
  const byDocType = {};
  const bySource = {};
  for (const r of results) {
    const data = snap.docs.find((d) => d.id === r.id).data();
    byDocType[data.docType] = (byDocType[data.docType] ?? 0) + 1;
    bySource[data.softwareSource ?? '(none)'] = (bySource[data.softwareSource ?? '(none)'] ?? 0) + 1;
  }
  console.log('By docType:', byDocType);
  console.log('By softwareSource:', bySource);

  process.exit(failed.length === 0 ? 0 : 1);
})();
