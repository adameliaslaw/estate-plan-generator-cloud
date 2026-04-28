#!/usr/bin/env node
/**
 * functions/scripts/test-save-and-provenance.cjs
 *
 * Step 5: invoke the full unified-generator path (generation → save → Firestore)
 * for one document, then read the saved doc back and verify all Phase 2.1
 * provenance fields were persisted correctly.
 */

'use strict';

const admin = require('firebase-admin');
const path = require('path');

admin.initializeApp({
  credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))),
  projectId: 'estate-plan-generator',
});

const { generateDocument } = require('../lib/unified-generator');

const FIRM_ID = 'elias-counsel';

(async () => {
  const db = admin.firestore();

  // Locate Karen Elias.
  const clientsSnap = await db.collection('firms').doc(FIRM_ID).collection('clients').get();
  const karen = clientsSnap.docs.find((d) => /karen/i.test(d.data().personalInfo?.firstName ?? ''));
  if (!karen) {
    console.error('Karen Elias not found.');
    process.exit(1);
  }
  console.log(`Generating + saving Will for ${karen.id} (Karen Elias)`);

  const result = await generateDocument({
    firmId: FIRM_ID,
    clientId: karen.id,
    docType: 'will',
    generationMode: 'hybrid',
    softwareSource: 'interactivelegal',
    createdBy: 'verification-script',
    triggerSource: 'single',
  });

  console.log(`\nGeneration result:`);
  console.log(`  docId: ${result.docId}`);
  console.log(`  status: ${result.status}`);
  console.log(`  isNew: ${result.isNew}`);
  console.log(`  currentVersion: ${result.currentVersion}`);

  // Read the saved doc back.
  const savedSnap = await db
    .collection('firms').doc(FIRM_ID)
    .collection('clients').doc(karen.id)
    .collection('documents').doc(result.docId)
    .get();
  if (!savedSnap.exists) {
    console.error('Saved doc not found in Firestore.');
    process.exit(1);
  }
  const saved = savedSnap.data();

  console.log(`\n=== Provenance fields on saved doc ===`);
  console.log(`  generationMode:           ${saved.generationMode ?? '(missing)'}`);
  console.log(`  triggerSource:            ${saved.triggerSource ?? '(missing)'}`);
  console.log(`  templateId:               ${saved.templateId ?? '(missing)'}`);
  console.log(`  templateSourceCollection: ${saved.templateSourceCollection ?? '(missing)'}`);
  console.log(`  softwareSource:           ${saved.softwareSource ?? '(missing)'}`);
  console.log(`  aiModel:                  ${saved.aiModel ?? '(missing)'}`);
  console.log(`  promptVersion:            ${saved.promptVersion ?? '(missing)'}`);
  console.log(`  currentVersion:           ${saved.currentVersion ?? '(missing)'}`);
  console.log(`  status:                   ${saved.status ?? '(missing)'}`);

  // Pass criteria: all provenance fields present and correct.
  const checks = {
    generationMode: saved.generationMode === 'hybrid' || saved.generationMode === 'template',
    triggerSource: saved.triggerSource === 'single',
    templateId: !!saved.templateId,
    templateSourceCollection: saved.templateSourceCollection === 'documentTemplates',
    softwareSource: saved.softwareSource === 'interactivelegal',
    promptVersion: !!saved.promptVersion,
    currentVersion: typeof saved.currentVersion === 'number' && saved.currentVersion >= 1,
    contentNonEmpty: typeof saved.content === 'string' && saved.content.length > 1000,
  };

  console.log(`\n=== Verdict ===`);
  for (const [k, v] of Object.entries(checks)) {
    console.log(`  ${v ? '✓' : '✗'}  ${k}`);
  }
  const allPass = Object.values(checks).every(Boolean);
  console.log(`\n${allPass ? 'ALL CHECKS PASS' : 'FAILED — some provenance fields not persisting correctly'}`);
  process.exit(allPass ? 0 : 1);
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
