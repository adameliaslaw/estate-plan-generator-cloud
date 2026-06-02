'use strict';
/**
 * One-off patch: the Deepak Buch IL POA template uses bare
 * `{{fiduciaries.powerOfAttorney.agent.address}}` and
 * `{{fiduciaries.powerOfAttorney.alternateAgent.address}}` for the agent
 * designation, which renders only the street and drops city/state. Replace
 * each occurrence with the full composite `address, city, state` matching
 * the principal designation pattern used elsewhere in the same template.
 *
 * Safe to re-run: skips templates already in composite form. Logs every
 * template touched.
 */
const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))) });

const TIERS = [
  'fiduciaries.powerOfAttorney.agent',
  'fiduciaries.powerOfAttorney.alternateAgent',
  'fiduciaries.healthcareProxy.agent',
  'fiduciaries.healthcareProxy.alternateAgent',
  'fiduciaries.executor.primary',
  'fiduciaries.executor.alternate',
  'fiduciaries.trustee.primary',
  'fiduciaries.trustee.alternate',
];

function expandAddress(html) {
  let out = html;
  let changes = 0;
  for (const tier of TIERS) {
    const escTier = tier.replace(/\./g, '\\.');
    // Match `{{TIER.address}}` ONLY when not already followed (within a few
    // dozen chars) by `{{TIER.city}}` — i.e. only when the composite is
    // missing. Conservative — won't double-expand.
    const re = new RegExp(`\\{\\{\\s*${escTier}\\.address\\s*\\}\\}(?![^<]{0,80}\\{\\{\\s*${escTier}\\.city)`, 'g');
    out = out.replace(re, () => {
      changes++;
      return `{{${tier}.address}}, {{${tier}.city}}, {{${tier}.state}}`;
    });
  }
  return { out, changes };
}

(async () => {
  const db = admin.firestore();
  const snap = await db.collection('firms/elias-counsel/documentTemplates').get();
  let touched = 0;
  for (const d of snap.docs) {
    const data = d.data();
    if (data.isActive === false) continue;
    const fields = ['processedTemplate', 'htmlTemplate', 'template', 'content'];
    const updates = {};
    let totalChanges = 0;
    for (const f of fields) {
      const html = data[f];
      if (typeof html !== 'string' || !html.includes('{{')) continue;
      const { out, changes } = expandAddress(html);
      if (changes > 0) {
        updates[f] = out;
        totalChanges += changes;
      }
    }
    if (totalChanges > 0) {
      console.log(`PATCH ${d.id} (${data.docType ?? '?'} | ${data.name ?? '?'}): ${totalChanges} address expansions`);
      await d.ref.update(updates);
      touched++;
    }
  }
  console.log(`\nDone. ${touched} template(s) updated.`);
  process.exit(0);
})();
