'use strict';
// Trigger the deployed template-engine code path locally against Lucas Polo
// (widowed) to confirm warnNonMarriedFiduciaryGaps() fires, AND that the
// {{#if hasSpouse}} conditional routes through Ibrahim Polo's data.
//
// Reads from prod Firestore via admin SDK — no UI / callable auth needed.
const admin = require('firebase-admin');
const path = require('path');

const SERVICE_ACCOUNT_PATH = path.resolve(__dirname, '..', '..', 'service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(require(SERVICE_ACCOUNT_PATH)),
  projectId: 'estate-plan-generator',
});

const { aggregateClientContext } = require('../lib/client-context-aggregator');
const { getTemplate, generateFromTemplate } = require('../lib/template-engine');

const FIRM_ID = 'elias-counsel';
const LUCAS_ID = 'B6t17ajHjjNOddKz81td';

(async () => {
  console.log('=== Building Lucas Polo client context ===');
  const ctx = await aggregateClientContext(FIRM_ID, LUCAS_ID, 'livingWill');
  console.log('maritalStatus:', ctx.client?.personalInfo?.maritalStatus);
  console.log('hasSpouse computed:', ctx.computed?.hasSpouse);
  console.log('spouseFullName computed:', JSON.stringify(ctx.computed?.spouseFullName));
  console.log('healthcareProxy.agent:', JSON.stringify(ctx.client?.fiduciaries?.healthcareProxy?.agent));

  console.log('\n=== Resolving livingWill template ===');
  const tpl = await getTemplate(FIRM_ID, 'livingWill', undefined, undefined, 'interactivelegal');
  console.log('template id:', tpl?.id);
  console.log('template name:', tpl?.name);

  if (!tpl) {
    console.error('No template resolved — aborting');
    process.exit(1);
  }

  console.log('\n=== Generating livingWill (template mode) — watch for [template-engine] warnings ===');
  const result = await generateFromTemplate(ctx, 'livingWill', 'template', tpl.id, undefined, undefined, 'interactivelegal');

  console.log('\n=== Output summary ===');
  console.log('content length:', result.content?.length);
  // Print just the primary HC Rep paragraph
  const m = (result.content || '').match(/<p[^>]*>[\s\S]*?Appointment of Health Care Representative[\s\S]*?<\/p>/);
  if (m) {
    const text = m[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log('\n--- Primary HCR paragraph (rendered text) ---');
    console.log(text);
  }
  process.exit(0);
})().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
