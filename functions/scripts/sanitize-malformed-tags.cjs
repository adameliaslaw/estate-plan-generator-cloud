#!/usr/bin/env node
/**
 * functions/scripts/sanitize-malformed-tags.cjs
 *
 * One-off cleanup: scan every documentTemplate's content field for malformed
 * `<TAGattribute=` patterns (introduced by AI templatization that elided the
 * space between tag name and attribute) and rewrite to add the missing space.
 *
 * Usage:
 *   node scripts/sanitize-malformed-tags.cjs            # dry run
 *   node scripts/sanitize-malformed-tags.cjs --execute  # apply
 */

'use strict';

const admin = require('firebase-admin');
const path = require('path');

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, '..', '..', 'service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
});

const FIRM_ID = 'elias-counsel';
const EXECUTE = process.argv.includes('--execute');

const SANITIZE_RE = /<([a-z][\w-]*?)(class|style|id|href|src|alt|title|name|type|value|data-[\w-]+|aria-[\w-]+|role|rel|target|width|height|colspan|rowspan|align|valign)=/gi;

(async () => {
  const db = admin.firestore();
  const snap = await db.collection('firms').doc(FIRM_ID).collection('documentTemplates').get();

  console.log(`\nScanning ${snap.size} templates in firms/${FIRM_ID}/documentTemplates`);
  console.log(`Mode: ${EXECUTE ? 'EXECUTE (will write)' : 'DRY RUN (no writes)'}\n`);

  let totalFixes = 0;
  let templatesAffected = 0;
  const writes = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const content = data.content;
    if (typeof content !== 'string' || !content) continue;

    SANITIZE_RE.lastIndex = 0;
    const matches = content.match(SANITIZE_RE) ?? [];
    if (matches.length === 0) continue;

    templatesAffected++;
    totalFixes += matches.length;
    console.log(`  ${doc.id}  "${data.name ?? '(no name)'}"  —  ${matches.length} malformed tags`);
    for (const m of matches.slice(0, 3)) {
      console.log(`    - ${m}`);
    }
    if (matches.length > 3) console.log(`    ... +${matches.length - 3} more`);

    const fixed = content.replace(SANITIZE_RE, '<$1 $2=');
    if (EXECUTE) {
      writes.push(
        doc.ref.update({
          content: fixed,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          _sanitizedAt: admin.firestore.FieldValue.serverTimestamp(),
          _sanitizedFixCount: matches.length,
        }),
      );
    }
  }

  if (EXECUTE && writes.length > 0) {
    console.log(`\nApplying ${writes.length} updates...`);
    await Promise.all(writes);
    console.log('Done.');
  }

  console.log(`\nSummary: ${templatesAffected}/${snap.size} templates affected, ${totalFixes} total fixes.`);
  if (!EXECUTE && totalFixes > 0) {
    console.log(`Re-run with --execute to apply.`);
  }
  process.exit(0);
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
