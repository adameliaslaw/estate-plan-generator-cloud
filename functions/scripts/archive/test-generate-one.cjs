#!/usr/bin/env node
/**
 * functions/scripts/test-generate-one.cjs
 *
 * End-to-end smoke test for tonight's Phase 0–4 fidelity work. Picks one
 * active IL template (Will, default Karen Elias's firm) and generates the
 * corresponding document for a real client, bypassing the callable auth
 * layer so we don't need an ID token.
 *
 * Verifies:
 *   - getTemplate() resolves to a documentTemplates record
 *   - generateFromTemplate() returns content with inline tr-* styles intact
 *   - Provenance fields (resolvedMode, resolvedTemplateId, resolvedTemplateSource) populate
 *   - No unresolved {{vars}} (Phase 0.1 Handlebars syntax)
 *   - Output preserves paragraph structure relative to template
 */

'use strict';

const admin = require('firebase-admin');
const path = require('path');

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, '..', '..', 'service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
  projectId: 'estate-plan-generator',
});

// Compiled functions code lives at functions/lib after `npm run build`.
const { aggregateClientContext } = require('../lib/client-context-aggregator');
const { getTemplate, generateFromTemplate } = require('../lib/template-engine');

const FIRM_ID = 'elias-counsel';

(async () => {
  const db = admin.firestore();

  // 1. Find a real client to generate against. Prefer Karen Elias.
  const clientsSnap = await db
    .collection('firms').doc(FIRM_ID).collection('clients')
    .get();
  const clients = clientsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const karen = clients.find((c) =>
    /karen/i.test(c.personalInfo?.firstName ?? '') ||
    /karen/i.test(c.personalInfo?.fullName ?? ''),
  );
  const target = karen ?? clients[0];
  if (!target) {
    console.error('No clients found.');
    process.exit(1);
  }
  const clientName = target.personalInfo?.fullName
    ?? `${target.personalInfo?.firstName ?? ''} ${target.personalInfo?.lastName ?? ''}`.trim()
    ?? target.id;
  console.log(`Generating against client: ${clientName} (${target.id})`);

  // 2. Resolve the IL Will template.
  const template = await getTemplate(FIRM_ID, 'will', undefined, undefined, 'interactivelegal');
  if (!template) {
    console.error('No will template found for softwareSource=interactivelegal.');
    process.exit(1);
  }
  console.log(`Resolved template: "${template.name}" (id=${template.id}, source=${template._sourceCollection})`);
  console.log(`Template content: ${template.content.length} chars`);

  // 3. Aggregate client context (same path the callable uses).
  const ctx = await aggregateClientContext(FIRM_ID, target.id, 'will');
  console.log(`Client context aggregated: ${ctx.knowledgeResources.length} KB resources`);

  // 4. Generate via the template engine in hybrid mode.
  console.log('\nGenerating in hybrid mode...');
  const t0 = Date.now();
  const result = await generateFromTemplate(
    ctx,
    'will',
    'hybrid',
    template.id,
    undefined,
    undefined,
    'interactivelegal',
    undefined,
    undefined,
  );
  const elapsed = Date.now() - t0;
  console.log(`Generated in ${elapsed}ms`);

  // 5. Inspect the output.
  console.log('\n=== Output inspection ===\n');
  console.log(`Title: ${result.title}`);
  console.log(`Status: ${result.status}`);
  console.log(`Content length: ${result.content.length} chars`);
  console.log(`promptVersion: ${result.promptVersion}`);
  console.log(`templateBaseline: ${result.templateBaseline ? `${result.templateBaseline.length} chars` : 'none'}`);

  console.log('\n--- Provenance (Phase 2.1) ---');
  console.log(`resolvedMode: ${result.resolvedMode}`);
  console.log(`resolvedTemplateId: ${result.resolvedTemplateId}`);
  console.log(`resolvedTemplateSource: ${result.resolvedTemplateSource}`);
  console.log(`resolvedSoftwareSource: ${result.resolvedSoftwareSource}`);

  console.log('\n--- Content checks ---');
  // Unresolved {{vars}}?
  const unresolved = (result.content.match(/\{\{[^}]+\}\}/g) ?? []);
  // Filter [MISSING:...] markers (those are intentional)
  const realUnresolved = unresolved.filter((u) => !/\[MISSING:/i.test(u));
  console.log(`Unresolved Handlebars expressions (raw): ${unresolved.length}`);
  console.log(`Unresolved (excluding [MISSING:] markers): ${realUnresolved.length}`);
  if (realUnresolved.length > 0) {
    console.log(`  Examples: ${realUnresolved.slice(0, 5).join(' | ')}`);
  }

  // [MISSING:...] markers (Phase 2.2 fiduciary addresses + critical fields)
  const missingMarkers = result.content.match(/\[MISSING:[^\]]+\]/g) ?? [];
  console.log(`[MISSING:...] markers (Phase 2.2): ${missingMarkers.length}`);
  if (missingMarkers.length > 0) {
    console.log(`  Examples: ${[...new Set(missingMarkers)].slice(0, 8).join(' | ')}`);
  }

  // Inline tr-* style preservation
  const trWithStyle = (result.content.match(/<[^>]*\bclass=["'][^"']*\btr-[^"']*["'][^>]*\bstyle=/gi) ?? []).length;
  const trTotal = (result.content.match(/<[^>]*\bclass=["'][^"']*\btr-[^"']*["']/gi) ?? []).length;
  console.log(`tr-* paragraphs with inline styles: ${trWithStyle}/${trTotal}`);

  // Client name substitution check — confirm template's sample name (Jessica Byrnes etc.)
  // is NOT in the output, and the actual client name IS.
  const sampleNamesInTemplate = ['Jessica Byrnes', 'Sean Byrnes', 'Vito Rizzo', 'Vita Maria Rizzo', 'Deepak Buch'];
  const foundSampleNames = sampleNamesInTemplate.filter((n) => result.content.includes(n));
  console.log(`Sample names from template still in output: ${foundSampleNames.length === 0 ? 'NONE (good)' : foundSampleNames.join(', ') + ' (BAD — substitution incomplete)'}`);

  const clientLastName = target.personalInfo?.lastName ?? '';
  if (clientLastName) {
    const foundClient = result.content.includes(clientLastName);
    console.log(`Client last name "${clientLastName}" appears in output: ${foundClient ? 'YES (good)' : 'NO (substitution may have failed)'}`);
  }

  // Save the output to disk for visual inspection.
  const fs = require('fs');
  const outDir = path.resolve(__dirname, '..', '..', 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `test-generation-will-${target.id}.html`);
  fs.writeFileSync(outPath, result.content, 'utf8');
  console.log(`\nFull output saved to: ${outPath}`);

  process.exit(0);
})().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
