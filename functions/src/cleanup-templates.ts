/**
 * functions/src/cleanup-templates.ts
 *
 * One-time Cloud Function to clean up AI "thinking" artifacts that leaked into
 * templatized templates. These are blocks of text like:
 *   "INI need to analyze..."
 *   "Looking at the template..."
 *   "I need to convert..."
 * that the AI model injected alongside the actual templatized HTML.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

// Patterns that indicate AI "thinking" leaked into template content.
// These should never appear in a legal document.
const AI_ARTIFACT_PATTERNS = [
  // AI reasoning / chain-of-thought leaks
  /INI need to analyze[^<]*/gi,
  /I need to analyze[^<]*/gi,
  /Looking at the template[^<]*/gi,
  /I need to convert[^<]*/gi,
  /Let me analyze[^<]*/gi,
  /I'll analyze[^<]*/gi,
  /I should[^<]{0,200}/gi,
  /Let me identify[^<]*/gi,
  /I notice that[^<]*/gi,
  /Here's my analysis[^<]*/gi,
  // Blocks that start with analysis markers
  /\n\s*[-*]\s*(?:children list|grandchildren list|child references)[^<]*/gi,
];

export const cleanupTemplates = onCall(
  { region: 'us-east1', memory: '512MiB', timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');

    const role = request.auth.token.role as string | undefined;
    if (!role || !['admin', 'attorney'].includes(role)) {
      throw new HttpsError('permission-denied', 'Only admin or attorney can clean templates.');
    }

    const { firmId, dryRun = false } = request.data as { firmId: string; dryRun?: boolean };
    if (!firmId) throw new HttpsError('invalid-argument', 'firmId is required.');

    if ((request.auth.token['firmId'] as string | undefined) !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot clean templates for a different firm.');
    }

    const db = admin.firestore();
    const col = db.collection(`firms/${firmId}/documentTemplates`);
    const snapshot = await col.get();

    const results: { name: string; status: string; artifactsRemoved: number }[] = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();
      let content = data.content || '';
      const name = data.name || doc.id;

      if (!content || typeof content !== 'string') {
        results.push({ name, status: 'skipped-no-content', artifactsRemoved: 0 });
        continue;
      }

      let artifactsRemoved = 0;

      for (const pattern of AI_ARTIFACT_PATTERNS) {
        const matches = content.match(pattern);
        if (matches) {
          artifactsRemoved += matches.length;
          content = content.replace(pattern, '');
        }
      }

      // Also clean up any resulting empty paragraphs
      content = content.replace(/<p>\s*<\/p>/gi, '');
      content = content.replace(/\n{3,}/g, '\n\n');

      if (artifactsRemoved > 0) {
        if (!dryRun) {
          await col.doc(doc.id).update({
            content,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        results.push({ name, status: dryRun ? 'would-fix' : 'fixed', artifactsRemoved });
        console.log(`[cleanup] ${name}: removed ${artifactsRemoved} AI artifacts. dryRun=${dryRun}`);
      } else {
        results.push({ name, status: 'clean', artifactsRemoved: 0 });
      }
    }

    const fixedCount = results.filter(r => r.status === 'fixed' || r.status === 'would-fix').length;
    return {
      total: snapshot.size,
      fixed: fixedCount,
      dryRun,
      results,
    };
  }
);
