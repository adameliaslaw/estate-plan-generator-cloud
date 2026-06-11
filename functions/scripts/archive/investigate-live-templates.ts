/**
 * scripts/investigate-live-templates.ts
 *
 * Scans all documents in the "firms/{firmId}/templates" or "templates" collection
 * to determine if they contain Handlebars brackets ({{...}}).
 * Logs exactly which templates are templatized and which are raw.
 * 
 * STRICT READ-ONLY MODE.
 */

import * as admin from 'firebase-admin';

// Initialize with default credentials
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'estate-plan-generator'
  });
}

const db = admin.firestore();

async function main() {
  console.log('🔍 Connecting to live Knowledge Base (Firebase)...\n');

  try {
    // Usually templates are stored either in a root 'templates' collection 
    // or under 'firms/{firmId}/templates' depending on multi-tenant structure.
    // Let's query across all 'templates' using a collectionGroup query
    const templatesSnapshot = await db.collectionGroup('templates').get();

    console.log(`Found ${templatesSnapshot.size} total templates across the database.\n`);

    interface TemplateSummary { id: string; name: string; firmId: string; vars?: number }
    const rawTemplates: TemplateSummary[] = [];
    const templatizedTemplates: TemplateSummary[] = [];

    templatesSnapshot.forEach(doc => {
      const data = doc.data();
      const content = data.content || '';
      const name = data.name || doc.id;
      const firmId = data.firmId || 'unknown-firm';
      const variablesArray = data.variables || [];

      // Check if it's templatized programmatically
      const hasHandlebars = content.includes('{{');
      const hasVariablesListed = variablesArray.length > 0;

      if (hasHandlebars || hasVariablesListed) {
        templatizedTemplates.push({ id: doc.id, name, firmId, vars: variablesArray.length });
      } else {
        rawTemplates.push({ id: doc.id, name, firmId });
      }
    });

    console.log(`✅ Fully Templatized (0-token generation): ${templatizedTemplates.length}`);
    templatizedTemplates.forEach(t => console.log(`   - [${t.firmId}] ${t.name} (Variables Detected: ${t.vars})`));

    console.log(`\n❌ Raw / Un-templatized (Requires AI Fallback): ${rawTemplates.length}`);
    rawTemplates.forEach(t => console.log(`   - [${t.firmId}] ${t.name}`));

    console.log('\nInvestigation completed safely. No records were modified.');

  } catch (error) {
    console.error('Error investigating templates:', error);
  }
}

main().catch(console.error);
