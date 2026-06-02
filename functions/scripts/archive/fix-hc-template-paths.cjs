'use strict';
/**
 * Fix AD/livingWill templates that reference wrong Handlebars paths:
 *   1. `healthcareProxy.alternate.X` → `healthcareProxy.alternateAgent.X`
 *      (questionnaire stores HC alternate at `.alternateAgent`, NOT `.alternate`)
 *   2. In livingWill templates ONLY, `powerOfAttorney.alternateAgent.{address,city,state}`
 *      → `healthcareProxy.alternateAgent.{address,city,state}`
 *      (IL HC template author used POA's alternate-address path instead of HC's
 *      for the successor HCR address — visible as wrong [MISSING] label)
 *
 * Safe to re-run: only swaps when current path is exactly the wrong form.
 */
const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))) });

function patchAd(html) {
  let out = html;
  let changes = 0;
  // (1) healthcareProxy.alternate.X → .alternateAgent.X (any field).
  out = out.replace(/\{\{(\s*fiduciaries\.healthcareProxy\.alternate)(\.[a-zA-Z]+)?(\s*)\}\}/g, (m, p, field, ws) => {
    changes++;
    return `{{${p}Agent${field || ''}${ws}}}`;
  });
  // (2) powerOfAttorney.alternateAgent.{address,city,state,zip,county} → healthcareProxy.alternateAgent.X
  // ONLY where this is clearly the HC template's mis-routed address. We scope by
  // proximity to "Health Care" / "Representative" — but easier: in livingWill
  // templates ALL references to powerOfAttorney are wrong (HC docs shouldn't
  // reference POA agent fields at all), so swap them.
  out = out.replace(/\{\{(\s*fiduciaries\.)powerOfAttorney(\.alternateAgent\.(?:address|city|state|zip|county)\s*)\}\}/g, (m, pre, suf) => {
    changes++;
    return `{{${pre}healthcareProxy${suf}}}`;
  });
  return { out, changes };
}

(async () => {
  const db = admin.firestore();
  const snap = await db.collection('firms/elias-counsel/documentTemplates').get();
  let touched = 0;
  for (const d of snap.docs) {
    const data = d.data();
    if (data.docType !== 'livingWill') continue;
    if (data.isActive === false) continue;
    const fields = ['processedTemplate', 'htmlTemplate', 'template', 'content'];
    const updates = {};
    let totalChanges = 0;
    for (const f of fields) {
      const html = data[f];
      if (typeof html !== 'string' || !html.includes('{{')) continue;
      const { out, changes } = patchAd(html);
      if (changes > 0) {
        updates[f] = out;
        totalChanges += changes;
      }
    }
    if (totalChanges > 0) {
      console.log(`PATCH ${d.id} (${data.name}): ${totalChanges} path corrections`);
      await d.ref.update(updates);
      touched++;
    }
  }
  console.log(`\nDone. ${touched} HC template(s) updated.`);
  process.exit(0);
})();
