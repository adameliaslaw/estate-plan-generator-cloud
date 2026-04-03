/**
 * scripts/run-templatize.js
 *
 * Standalone script that directly performs the templatization logic
 * against the live Firestore database using Application Default Credentials
 * (set by `gcloud auth application-default login` or Firebase CLI).
 *
 * This script PERMANENTLY updates raw templates in Firestore to inject
 * Handlebars {{variables}} so they use 0 AI tokens during generation.
 *
 * Usage: node scripts/run-templatize.js
 */

const admin = require('firebase-admin');

// Initialize with ADC — Firebase CLI auth provides these automatically
admin.initializeApp({ projectId: 'estate-plan-generator' });

const db = admin.firestore();

// Deterministic string replacement map — zero AI tokens used
const SAMPLE_REPLACEMENT_MAP = {
  // Jessica / Sean Byrnes (sorted longest-first to prevent partial matches)
  'JESSICA BYRNES': '{{upper personalInfo.firstName}} {{upper personalInfo.lastName}}',
  'Jessica Byrnes': '{{personalInfo.firstName}} {{personalInfo.lastName}}',
  'SEAN BYRNES': '{{upper spouseInfo.firstName}} {{upper spouseInfo.lastName}}',
  'Sean Byrnes': '{{spouseInfo.firstName}} {{spouseInfo.lastName}}',
  'BYRNES': '{{upper personalInfo.lastName}}',

  // Rizzo samples
  'VITA MARIA RIZZO': '{{upper spouseInfo.firstName}} {{upper spouseInfo.lastName}}',
  'Vita Maria Rizzo': '{{spouseInfo.firstName}} {{spouseInfo.lastName}}',
  'VITO RIZZO': '{{upper personalInfo.firstName}} {{upper personalInfo.lastName}}',
  'Vito Rizzo': '{{personalInfo.firstName}} {{personalInfo.lastName}}',
  'Vita Maria': '{{spouseInfo.firstName}}',
  'RIZZO': '{{upper personalInfo.lastName}}',

  // Generic Does
  'JOHN DOE': '{{upper personalInfo.firstName}} {{upper personalInfo.lastName}}',
  'John Doe': '{{personalInfo.firstName}} {{personalInfo.lastName}}',
  'JANE DOE': '{{upper spouseInfo.firstName}} {{upper spouseInfo.lastName}}',
  'Jane Doe': '{{spouseInfo.firstName}} {{spouseInfo.lastName}}',
  'DOE': '{{upper personalInfo.lastName}}',
};

// Sort keys by length descending so longer names get replaced first
const SORTED_KEYS = Object.keys(SAMPLE_REPLACEMENT_MAP).sort((a, b) => b.length - a.length);

async function main() {
  console.log('🔍 Scanning ALL templates in Firestore...\n');

  const snapshot = await db.collectionGroup('templates').get();
  console.log(`Found ${snapshot.size} total template documents.\n`);

  const report = {
    investigated: snapshot.size,
    alreadyTemplatized: 0,
    fixed: 0,
    skipped: 0,
    details: [],
  };

  const batch = db.batch();

  snapshot.forEach((doc) => {
    const data = doc.data();
    let content = data.content || '';
    const name = data.name || doc.id;
    const docType = data.docType || 'unknown';

    // Skip non-template collections that might match the collectionGroup 'templates'
    // (e.g. if there's a 'templates' subcollection elsewhere)
    if (!content || typeof content !== 'string') {
      report.skipped++;
      return;
    }

    // Check if already templatized
    if (content.includes('{{')) {
      report.alreadyTemplatized++;
      report.details.push({ name, docType, status: '✅ Already templatized' });
      return;
    }

    // Perform replacements
    let modified = false;
    const replacementsMade = [];
    for (const sampleName of SORTED_KEYS) {
      if (content.includes(sampleName)) {
        const regex = new RegExp(sampleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        const count = (content.match(regex) || []).length;
        content = content.replace(regex, SAMPLE_REPLACEMENT_MAP[sampleName]);
        replacementsMade.push(`"${sampleName}" → ${count} occurrences`);
        modified = true;
      }
    }

    if (modified) {
      const variables = data.variables || [];
      if (!variables.includes('personalInfo.firstName')) {
        variables.push(
          'personalInfo.firstName', 'personalInfo.lastName',
          'spouseInfo.firstName', 'spouseInfo.lastName'
        );
      }

      batch.update(doc.ref, {
        content,
        variables,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      report.fixed++;
      report.details.push({
        name,
        docType,
        status: '🔧 FIXED',
        replacements: replacementsMade,
      });
    } else {
      report.skipped++;
      report.details.push({ name, docType, status: '⚠️ No known sample names found' });
    }
  });

  if (report.fixed > 0) {
    await batch.commit();
    console.log(`\n✅ PERMANENTLY patched ${report.fixed} templates in Firestore.\n`);
  } else {
    console.log('\nNo templates needed patching.\n');
  }

  // Print full report
  console.log('=== FULL AUDIT REPORT ===');
  console.log(`Total investigated: ${report.investigated}`);
  console.log(`Already templatized: ${report.alreadyTemplatized}`);
  console.log(`Fixed this run: ${report.fixed}`);
  console.log(`Skipped (no content or no matches): ${report.skipped}`);
  console.log('');

  for (const detail of report.details) {
    console.log(`  [${detail.docType}] ${detail.name}: ${detail.status}`);
    if (detail.replacements) {
      for (const r of detail.replacements) {
        console.log(`      ↳ ${r}`);
      }
    }
  }

  console.log('\n🏁 Done. All changes are permanent in Firestore.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
