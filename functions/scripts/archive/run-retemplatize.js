#!/usr/bin/env node
/**
 * scripts/run-retemplatize.js
 *
 * One-shot script to re-templatize all templates in production Firestore.
 * Uses the Firebase Admin SDK directly (bypasses Cloud Function auth).
 *
 * This script replicates the same logic as retemplatizeTemplates but runs
 * locally with full admin credentials via Application Default Credentials.
 *
 * Usage:
 *   node functions/scripts/run-retemplatize.js [--dry-run] [--limit N]
 *
 * Prerequisites:
 *   - gcloud auth application-default login (or GOOGLE_APPLICATION_CREDENTIALS set)
 *   - npm run build (in functions/)
 */

const admin = require('firebase-admin');

// Initialize with ADC
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'estate-plan-generator' });
}

const db = admin.firestore();

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 100;

  console.log(`\n🔧 Re-templatize Templates`);
  console.log(`   Mode: ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log(`   Limit: ${limit}\n`);

  // 1. Find all firms
  const firmsSnap = await db.collection('firms').get();
  console.log(`Found ${firmsSnap.size} firm(s)\n`);

  for (const firmDoc of firmsSnap.docs) {
    const firmId = firmDoc.id;
    const firmData = firmDoc.data();
    console.log(`── Firm: ${firmData.firmName ?? firmData.name ?? firmId} (${firmId})`);

    // 2. Find all documentTemplates with softwareSource
    const col = db.collection(`firms/${firmId}/documentTemplates`);
    const snapshot = await col.where('softwareSource', '!=', '').get();

    if (snapshot.empty) {
      console.log(`   No templates with softwareSource found. Skipping.\n`);
      continue;
    }

    const templates = snapshot.docs.filter(doc => {
      const data = doc.data();
      return data.content && data.content.length > 100;
    });

    console.log(`   Found ${templates.length} template(s) to inspect\n`);

    let processed = 0;
    for (const doc of templates) {
      if (processed >= limit) {
        console.log(`   Reached limit of ${limit}. Stopping.\n`);
        break;
      }

      const data = doc.data();
      const name = data.name ?? doc.id;
      const content = data.content;
      const vars = data.variables ?? [];
      const hasHandlebars = /\{\{[^}]+\}\}/.test(content);

      // Check for known issues in existing templates
      const hasBrokenArraySyntax = /\{\{children\[\d+\]/.test(content);
      const hasBrokenFirmPaths = /\{\{firm\.name\}\}/.test(content) && !content.includes('{{firmName}}');
      const hasIssues = hasBrokenArraySyntax || hasBrokenFirmPaths;

      console.log(`   📄 ${name}`);
      console.log(`      Variables: ${vars.length}, Has HBS: ${hasHandlebars}`);
      console.log(`      Broken array syntax: ${hasBrokenArraySyntax}`);
      console.log(`      Broken firm paths:   ${hasBrokenFirmPaths}`);

      if (hasHandlebars && hasIssues) {
        console.log(`      ⚠️  NEEDS RE-TEMPLATIZATION`);

        if (!dryRun) {
          // Fix broken array syntax: {{children[0].name}} → {{children.[0].name}}
          let fixed = content.replace(
            /\{\{(children(?:WithTitles)?)\[(\d+)\]/g,
            '{{$1.[$2]'
          );
          // Also fix minorChildren[0], adultChildren[0], etc.
          fixed = fixed.replace(
            /\{\{(minorChildren|adultChildren)\[(\d+)\]/g,
            '{{$1.[$2]'
          );

          if (fixed !== content) {
            const fixCount = (content.match(/\{\{(?:children|minorChildren|adultChildren)(?:WithTitles)?\[\d+\]/g) ?? []).length;
            console.log(`      ✅ Fixed ${fixCount} broken array syntax occurrences`);
            await col.doc(doc.id).update({
              content: fixed,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          } else {
            console.log(`      ℹ️  No array syntax to fix (firm path issue only — requires re-templatize run)`);
          }
        }
      } else if (!hasHandlebars) {
        console.log(`      ℹ️  Raw template (no HBS variables) — needs full AI re-templatization`);
      } else {
        console.log(`      ✅ OK`);
      }
      console.log('');
      processed++;
    }
  }

  console.log('Done.\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
