#!/usr/bin/env node
/**
 * scripts/flush-ai-templates.js
 *
 * Identifies and optionally deletes Firestore documentTemplates records that
 * were AI-generated rather than uploaded from real estate planning software.
 *
 * Identification logic:
 *   softwareSource == "" / null / undefined  →  AI-generated or untagged  →  DELETE
 *   softwareSource == "InteractiveLegal" etc →  real uploaded template     →  KEEP
 *
 * Usage:
 *   node scripts/flush-ai-templates.js            # dry run — prints only, deletes nothing
 *   node scripts/flush-ai-templates.js --execute  # live delete with confirmation prompt
 *
 * Requires firebase-admin to be authenticated via one of:
 *   - GOOGLE_APPLICATION_CREDENTIALS env var pointing to a service-account JSON
 *   - Application Default Credentials (gcloud auth application-default login)
 */

'use strict';

const admin = require('firebase-admin');
const readline = require('readline');

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
admin.initializeApp();
const db = admin.firestore();

const isDryRun = !process.argv.includes('--execute');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

function formatDate(ts) {
  if (!ts) return 'unknown';
  try { return ts.toDate().toISOString().slice(0, 10); } catch { return 'unknown'; }
}

function isEmpty(value) {
  return value === '' || value === null || value === undefined;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  flush-ai-templates — Estate Plan Generator');
  console.log('  Mode: ' + (isDryRun ? 'DRY RUN (no changes will be made)' : '⚠️  EXECUTE (will delete records)'));
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // 1. Collect all firms
  const firmsSnap = await db.collection('firms').get();
  if (firmsSnap.empty) {
    console.log('No firms found in Firestore. Nothing to do.');
    process.exit(0);
  }

  const toDelete = [];
  const kept = [];

  // 2. For each firm, scan documentTemplates
  for (const firmDoc of firmsSnap.docs) {
    const firmId = firmDoc.id;
    const templatesSnap = await db
      .collection('firms')
      .doc(firmId)
      .collection('documentTemplates')
      .get();

    if (templatesSnap.empty) continue;

    for (const doc of templatesSnap.docs) {
      const data = doc.data();
      const record = {
        firmId,
        templateId:    doc.id,
        docType:       data.docType       || '(unknown)',
        name:          data.name          || '(unnamed)',
        softwareSource: data.softwareSource ?? null,
        isDefault:     data.isDefault     || false,
        isActive:      data.isActive      || false,
        createdAt:     data.createdAt     || null,
        ref:           doc.ref,
      };

      if (isEmpty(record.softwareSource)) {
        toDelete.push(record);
      } else {
        kept.push(record);
      }
    }
  }

  // 3. Print what will be kept
  console.log('KEEPING (softwareSource is set — real uploaded templates): ' + kept.length);
  for (const r of kept) {
    console.log(
      '  ✅  firm=' + r.firmId +
      '  id=' + r.templateId +
      '  docType=' + r.docType +
      '  source="' + r.softwareSource + '"' +
      '  created=' + formatDate(r.createdAt)
    );
  }
  console.log('');

  // 4. Print what will be deleted
  console.log('TO DELETE (softwareSource empty/null — AI-generated or untagged): ' + toDelete.length);
  if (toDelete.length === 0) {
    console.log('  (none — nothing to flush)');
    console.log('');
    process.exit(0);
  }

  for (const r of toDelete) {
    const flags = (r.isDefault ? ' [isDefault]' : '') + (!r.isActive ? ' [inactive]' : '');
    console.log(
      '  🗑️   firm=' + r.firmId +
      '  id=' + r.templateId +
      '  docType=' + r.docType +
      '  name="' + r.name + '"' +
      '  created=' + formatDate(r.createdAt) +
      flags
    );
  }
  console.log('');

  if (isDryRun) {
    console.log('DRY RUN — no changes made.');
    console.log('Re-run with --execute to perform the actual deletion.');
    console.log('');
    process.exit(0);
  }

  // 5. Confirm before executing
  const answer = await prompt(
    '⚠️  About to permanently delete ' + toDelete.length + ' template(s) from Firestore.\n' +
    'Type "yes" to confirm, anything else to abort: '
  );

  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('Aborted. Nothing deleted.');
    process.exit(0);
  }

  // 6. Delete in batches of 500 (Firestore batch limit)
  console.log('');
  console.log('Deleting...');
  const BATCH_SIZE = 500;
  let deleted = 0;

  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = toDelete.slice(i, i + BATCH_SIZE);
    for (const r of chunk) batch.delete(r.ref);
    await batch.commit();
    deleted += chunk.length;
    console.log('  Deleted ' + deleted + ' / ' + toDelete.length);
  }

  console.log('');
  console.log('✅  Done. Deleted ' + deleted + ' AI-generated / untagged template(s).');
  console.log('   ' + kept.length + ' InteractiveLegal (or other software) template(s) untouched.');
  console.log('');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
