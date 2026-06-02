'use strict';
const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({
  credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))),
  projectId: 'estate-plan-generator',
});
const { aggregateClientContext } = require('../lib/client-context-aggregator');
const { getTemplate, generateFromTemplate } = require('../lib/template-engine');

(async () => {
  const FIRM_ID = 'elias-counsel';
  const db = admin.firestore();
  const clients = await db.collection('firms').doc(FIRM_ID).collection('clients').get();
  const karen = clients.docs.find((d) => /karen/i.test(d.data().personalInfo?.firstName ?? ''));

  const template = await getTemplate(FIRM_ID, 'poa', undefined, undefined, 'interactivelegal');
  if (!template) { console.error('No POA template'); process.exit(1); }
  console.log(`Template: ${template.name} (${template.id})`);

  const ctx = await aggregateClientContext(FIRM_ID, karen.id, 'poa');
  console.log('PRE-render fiduciaries.powerOfAttorney.agent:', JSON.stringify(ctx.client.fiduciaries?.powerOfAttorney?.agent, null, 2));

  const result = await generateFromTemplate(ctx, 'poa', 'template', template.id, undefined, undefined, 'interactivelegal');

  // Look for agent address rendering
  const m = result.content.match(/I appoint[^.]*?<strong>(?:[^<]+)<\/strong>[^.]{1,400}\./);
  if (m) console.log('\nAppointment text snippet:\n  ' + m[0].slice(0, 500));

  // Search for the testator's address in the agent context
  const addrMatches = (result.content.match(/93 Old Church Road/gi) ?? []).length;
  const missingMatches = (result.content.match(/\[MISSING:[^\]]*address[^\]]*\]/gi) ?? []).length;
  console.log(`\nAddress occurrences ('93 Old Church Road'): ${addrMatches}`);
  console.log(`[MISSING: ... address] markers: ${missingMatches}`);
  if (missingMatches > 0) {
    const samples = result.content.match(/\[MISSING:[^\]]*address[^\]]*\]/gi);
    console.log('  Examples:', samples.slice(0, 5).join(' | '));
  }

  const fs = require('fs');
  const outPath = path.resolve(__dirname, '..', '..', 'out', 'test-poa-karen.html');
  fs.writeFileSync(outPath, result.content);
  console.log('\nSaved to:', outPath);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
