'use strict';
/**
 * Patch templates that hardcoded an AIF/HC-rep pronoun via the wrong
 * computed field. The "Restriction on Authority" paragraph in IL POA
 * templates says "to satisfy {{clientPronouns.possessive}} obligation of
 * support" — but the obligation is the AIF's, not the principal's.
 *
 * Replaces clientPronouns / spousePronouns with the new fiduciary-scoped
 * computed fields (poaAgentPronouns / healthcareRepPronouns) within the
 * scope of an AIF/HC-rep paragraph.
 *
 * Conservative: only rewrites the specific known IL pattern. The broader
 * "any clientPronouns near AIF" case is left for explicit template
 * authoring — those mostly DO refer to the principal and shouldn't change.
 */
const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))) });

function patchPoa(html) {
  let out = html;
  let changes = 0;
  // The known IL "Restriction on Authority" sentence. Match the full
  // sentence and rewrite the pronoun reference to poaAgentPronouns.
  // Captures: any clientPronouns/spousePronouns possessive in the scope of
  // "satisfy ... obligation of support" — that's unambiguously the AIF's.
  out = out.replace(
    /(satisfy\s+)\{\{\s*(?:clientPronouns|spousePronouns)\.possessive\s*\}\}(\s+obligation of support)/gi,
    (_m, pre, post) => {
      changes++;
      return `${pre}{{poaAgentPronouns.possessive}}${post}`;
    },
  );
  return { out, changes };
}

(async () => {
  const db = admin.firestore();
  const snap = await db.collection('firms/elias-counsel/documentTemplates').get();
  let touched = 0;
  for (const d of snap.docs) {
    const data = d.data();
    if (data.docType !== 'poa') continue;
    if (data.isActive === false) continue;
    const fields = ['processedTemplate', 'htmlTemplate', 'template', 'content'];
    const updates = {};
    let totalChanges = 0;
    for (const f of fields) {
      const html = data[f];
      if (typeof html !== 'string' || !html.includes('{{')) continue;
      const { out, changes } = patchPoa(html);
      if (changes > 0) {
        updates[f] = out;
        totalChanges += changes;
      }
    }
    if (totalChanges > 0) {
      console.log(`PATCH ${d.id} (${data.name}): ${totalChanges} AIF-pronoun corrections`);
      await d.ref.update(updates);
      touched++;
    }
  }
  console.log(`\nDone. ${touched} POA template(s) updated.`);
  process.exit(0);
})();
