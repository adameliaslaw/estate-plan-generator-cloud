import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

/**
 * functions/src/templatize-kb.ts
 *
 * Cloud Function utility to audit and in-place templatize raw HTML files
 * currently sitting in the Knowledge Base without overriding them.
 */

// This map acts as a direct programmatic replacement for known sample names
// in InteractiveLegal templates. Safe, deterministic, 0 tokens.
const SAMPLE_REPLACEMENT_MAP: Record<string, string> = {
  // Jessica / Sean Byrnes (Common samples)
  'Jessica Byrnes': '{{personalInfo.firstName}} {{personalInfo.lastName}}',
  'Jessica': '{{personalInfo.firstName}}',
  'Sean Byrnes': '{{spouseInfo.firstName}} {{spouseInfo.lastName}}',
  'Sean': '{{spouseInfo.firstName}}',
  'BYRNES': '{{upper personalInfo.lastName}}',
  'JESSICA BYRNES': '{{upper personalInfo.firstName}} {{upper personalInfo.lastName}}',
  'SEAN BYRNES': '{{upper spouseInfo.firstName}} {{upper spouseInfo.lastName}}',

  // Rizzo Samples
  'Vito Rizzo': '{{personalInfo.firstName}} {{personalInfo.lastName}}',
  'Vito': '{{personalInfo.firstName}}',
  'Vita Maria Rizzo': '{{spouseInfo.firstName}} {{spouseInfo.lastName}}',
  'Vita Maria': '{{spouseInfo.firstName}}',
  'RIZZO': '{{upper personalInfo.lastName}}',
  'VITO RIZZO': '{{upper personalInfo.firstName}} {{upper personalInfo.lastName}}',
  'VITA MARIA RIZZO': '{{upper spouseInfo.firstName}} {{upper spouseInfo.lastName}}',

  // Generic Does
  'John Doe': '{{personalInfo.firstName}} {{personalInfo.lastName}}',
  'John': '{{personalInfo.firstName}}',
  'Jane Doe': '{{spouseInfo.firstName}} {{spouseInfo.lastName}}',
  'Jane': '{{spouseInfo.firstName}}',
  'DOE': '{{upper personalInfo.lastName}}',
  'JOHN DOE': '{{upper personalInfo.firstName}} {{upper personalInfo.lastName}}',
  'JANE DOE': '{{upper spouseInfo.firstName}} {{upper spouseInfo.lastName}}',
};

// Protect the keys by length descending to prevent partial replacements
const SORTED_KEYS = Object.keys(SAMPLE_REPLACEMENT_MAP).sort((a, b) => b.length - a.length);

export const templatizeKnowledgeBase = onCall(
  { region: 'us-east1', memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }

    const role = request.auth.token.role as string | undefined;
    if (!role || !['admin', 'attorney'].includes(role)) {
      throw new HttpsError('permission-denied', 'Only admins/attorneys can force-templatize.');
    }

    const { firmId } = request.data as { firmId?: string } || {};

    const db = admin.firestore();
    let snapshot;
    
    if (firmId) {
      snapshot = await db.collection(`firms/${firmId}/templates`).get();
      console.log(`[templatizeKnowledgeBase] Found ${snapshot.size} templates for firm ${firmId}.`);
    } else {
      snapshot = await db.collectionGroup('templates').get();
      console.log(`[templatizeKnowledgeBase] Found ${snapshot.size} templates across ALL firms.`);
    }

    const report = {
      investigated: snapshot.size,
      alreadyTemplatized: 0,
      fixed: 0,
      failed: 0,
      modifiedTemplates: [] as string[],
    };

    const batch = db.batch();

    snapshot.forEach((doc) => {
      const data = doc.data();
      let content = data.content || '';
      const name = data.name || doc.id;

      // 1. Investigation Phase
      if (content.includes('{{')) {
        report.alreadyTemplatized++;
        return; // Already templatized
      }

      // 2. Templatization Phase
      let modified = false;
      for (const sampleName of SORTED_KEYS) {
        if (content.includes(sampleName)) {
          // Replace all occurrences
          const regex = new RegExp(`\\b${sampleName}\\b`, 'g');
          content = content.replace(regex, SAMPLE_REPLACEMENT_MAP[sampleName]);
          modified = true;
        }
      }

      if (modified) {
        // Tag with standard required variables array if missing
        const variables = data.variables || [];
        if (!variables.includes('personalInfo.firstName')) {
          variables.push('personalInfo.firstName', 'personalInfo.lastName');
        }

        batch.update(doc.ref, {
          content,
          variables,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          systemNote: 'Auto-templatized via backend utility.',
        });
        report.fixed++;
        report.modifiedTemplates.push(name);
      } else {
        // If it lacked {{ but we didn't find known sample names, it might be raw HTML
        console.warn(`[templatizeKnowledgeBase] Could not identify sample names in: ${name}`);
        report.failed++;
      }
    });

    if (report.fixed > 0) {
      await batch.commit();
      console.log(`[templatizeKnowledgeBase] Successfully patched ${report.fixed} templates.`);
    }

    return report;
  }
);
