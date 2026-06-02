#!/usr/bin/env node
/**
 * One-off cleanup: scan every documentTemplate's content for invalid
 * Handlebars pipe syntax (Liquid/Vue style: `{{path | helper}}`) that the
 * AI templatization emitted by mistake. Rewrite each pipe expression to
 * proper Handlebars subexpression syntax: `{{helper path}}`.
 *
 * Pattern fixed: `{{ANY | helperName}}` → `{{helperName ANY}}`
 *
 * Usage:
 *   node scripts/fix-pipe-syntax.cjs            # dry run
 *   node scripts/fix-pipe-syntax.cjs --execute  # apply
 */

'use strict';

const admin = require('firebase-admin');
const path = require('path');

admin.initializeApp({
  credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))),
});

const FIRM_ID = 'elias-counsel';
const EXECUTE = process.argv.includes('--execute');

// Match {{ <something> | <ident> }} where the right side of the pipe is a
// bare identifier. Handlebars has no pipe syntax — AI templatization
// emitted Liquid/Vue style by mistake. The right-hand identifier in
// observed cases (e.g. `childTitle`) is a FIELD name, not a helper, so
// dropping the pipe segment is the correct fix; the path on the left
// resolves on its own.
const PIPE_RE = /\{\{\s*([^|{}]+?)\s*\|\s*[A-Za-z_][\w]*\s*\}\}/g;

(async () => {
  const db = admin.firestore();
  const snap = await db.collection('firms').doc(FIRM_ID).collection('documentTemplates').get();

  console.log(`\nScanning ${snap.size} templates`);
  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY RUN'}\n`);

  let totalFixes = 0;
  let templatesAffected = 0;
  const writes = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const content = data.content;
    if (typeof content !== 'string' || !content) continue;

    const matches = content.match(PIPE_RE) ?? [];
    if (matches.length === 0) continue;

    templatesAffected++;
    totalFixes += matches.length;
    console.log(`${doc.id}  "${data.name ?? '(no name)'}"  —  ${matches.length} pipe expressions`);
    for (const m of matches.slice(0, 3)) console.log(`    - ${m}`);
    if (matches.length > 3) console.log(`    ... +${matches.length - 3} more`);

    const fixed = content.replace(PIPE_RE, (_match, lhs) => `{{${lhs.trim()}}}`);

    if (EXECUTE) {
      writes.push(
        doc.ref.update({
          content: fixed,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          _pipeSyntaxFixedAt: admin.firestore.FieldValue.serverTimestamp(),
          _pipeSyntaxFixCount: matches.length,
        }),
      );
    }
  }

  if (EXECUTE && writes.length) {
    console.log(`\nApplying ${writes.length} updates...`);
    await Promise.all(writes);
    console.log('Done.');
  }

  console.log(`\nSummary: ${templatesAffected}/${snap.size} templates affected, ${totalFixes} total fixes.`);
  if (!EXECUTE && totalFixes > 0) console.log(`Re-run with --execute to apply.`);
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
