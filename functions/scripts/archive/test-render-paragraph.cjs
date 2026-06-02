'use strict';
// Renders a single paragraph from a template against a client's actual
// Firestore data, side-by-side for Karen Elias (married) and Lucas Polo
// (widowed). Use this in-loop after each template patch to confirm:
//   - Karen's output is IDENTICAL pre/post patch (re-run with --baseline
//     vs --post to compare)
//   - Lucas's output picks up the fallback fiduciary (Ibrahim Polo for HC)
//
// Usage:
//   node scripts/test-render-paragraph.cjs <templateId> <paragraphIdx>
const admin = require('firebase-admin');
const path = require('path');
const Handlebars = require('handlebars');

admin.initializeApp({
  credential: admin.credential.cert(
    require(path.resolve(__dirname, '..', '..', 'service-account.json'))
  ),
});

const KAREN_ID = '4Shw3Wp3Pf0kzozGAxGX';
const LUCAS_ID = 'B6t17ajHjjNOddKz81td';

const templateId = process.argv[2];
const paragraphIdx = parseInt(process.argv[3] || '0', 10);
if (!templateId) {
  console.error('Usage: test-render-paragraph.cjs <templateId> <paragraphIdx>');
  process.exit(1);
}

// ── Helper registrations (subset relevant to our patches) ────────────────
Handlebars.registerHelper('eq', (a, b) => a === b);
Handlebars.registerHelper('upper', (s) => (typeof s === 'string' ? s.toUpperCase() : ''));

// ── Inline replica of autoFillSpouseInfoAddress + autoFillSpouseFiduciaryAddresses ──
function autoFillSpouseInfoAddress(spouseInfo, personalInfo) {
  if (!spouseInfo || !personalInfo) return spouseInfo;
  const out = { ...spouseInfo };
  if (!out.address && personalInfo.address) out.address = personalInfo.address;
  if (!out.city && personalInfo.city) out.city = personalInfo.city;
  if (!out.state && personalInfo.state) out.state = personalInfo.state;
  if (!out.zip && personalInfo.zip) out.zip = personalInfo.zip;
  if (!out.county && personalInfo.county) out.county = personalInfo.county;
  return out;
}

const SPOUSE_REL = new Set(['Spouse', 'Husband', 'Wife', 'Partner', 'Domestic Partner']);
function autoFillSpouseFiduciaryAddresses(fids, personalInfo) {
  if (!fids || !personalInfo) return fids;
  const out = JSON.parse(JSON.stringify(fids));
  for (const role of Object.keys(out)) {
    for (const tier of Object.keys(out[role] || {})) {
      const slot = out[role][tier];
      if (slot && SPOUSE_REL.has(slot.relationship) && !slot.address && personalInfo.address) {
        slot.address = personalInfo.address;
        slot.city = personalInfo.city;
        slot.state = personalInfo.state;
        slot.zip = personalInfo.zip;
        slot.county = personalInfo.county;
      }
    }
  }
  return out;
}

function buildClientContext(client) {
  const pi = client.personalInfo || {};
  const spouseInfoRaw = client.spouseInfo || null;
  const spouseInfo = autoFillSpouseInfoAddress(spouseInfoRaw || {}, pi);
  const fiduciaries = autoFillSpouseFiduciaryAddresses(client.fiduciaries || {}, pi);

  const hasSpouse = ['Married', 'Domestic Partnership'].includes(pi.maritalStatus);
  const clientFullName = [pi.firstName, pi.middleName, pi.lastName, pi.suffix].filter(Boolean).join(' ');
  const spouseFullName = spouseInfoRaw
    ? [spouseInfoRaw.firstName, spouseInfoRaw.middleName, spouseInfoRaw.lastName].filter(Boolean).join(' ')
    : '';

  // Title derivation (heuristic — Wife/Husband based on spouse gender)
  let spouseTitle = 'Spouse';
  if (hasSpouse && spouseInfoRaw) {
    const sg = (spouseInfoRaw.gender || '').toLowerCase();
    if (sg === 'female') spouseTitle = 'Wife';
    else if (sg === 'male') spouseTitle = 'Husband';
  }

  return {
    client,
    personalInfo: pi,
    spouseInfo,
    fiduciaries,
    hasSpouse,
    clientFullName,
    spouseFullName,
    spouseTitle,
    children: (client.children || []).filter((c) => c?.name?.trim?.()),
  };
}

(async () => {
  const db = admin.firestore();

  const tplSnap = await db.doc(`firms/elias-counsel/documentTemplates/${templateId}`).get();
  if (!tplSnap.exists) {
    console.error(`Template ${templateId} not found`);
    process.exit(1);
  }
  const tpl = tplSnap.data();
  const html = tpl.content || tpl.html || '';

  // Find paragraph
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/g;
  let m, i = 0, target = null;
  while ((m = re.exec(html)) !== null) {
    if (i === paragraphIdx) {
      target = m[0];
      break;
    }
    i++;
  }
  if (!target) {
    console.error(`Paragraph index ${paragraphIdx} not found in template ${templateId}`);
    process.exit(1);
  }

  console.log(`\n=== Template: ${tpl.name} (${templateId}) ===`);
  console.log(`=== Paragraph idx=${paragraphIdx} ===`);

  for (const [label, id] of [['KAREN (married)', KAREN_ID], ['LUCAS (widowed)', LUCAS_ID]]) {
    const clientSnap = await db.doc(`firms/elias-counsel/clients/${id}`).get();
    if (!clientSnap.exists) {
      console.log(`\n--- ${label} [${id}] NOT FOUND ---`);
      continue;
    }
    const ctx = buildClientContext(clientSnap.data());
    const compiled = Handlebars.compile(target);
    const rendered = compiled(ctx);
    const text = rendered.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    console.log(`\n--- ${label} ---`);
    console.log('  hasSpouse:', ctx.hasSpouse, '| spouseFullName:', JSON.stringify(ctx.spouseFullName), '| spouseTitle:', ctx.spouseTitle);
    if (ctx.fiduciaries?.healthcareProxy?.agent) {
      console.log('  HC.agent:', JSON.stringify(ctx.fiduciaries.healthcareProxy.agent));
    }
    if (ctx.fiduciaries?.executor?.primary) {
      console.log('  Exec.primary:', JSON.stringify(ctx.fiduciaries.executor.primary));
    }
    if (ctx.fiduciaries?.powerOfAttorney?.agent) {
      console.log('  POA.agent:', JSON.stringify(ctx.fiduciaries.powerOfAttorney.agent));
    }
    console.log('  rendered text:');
    console.log('    ' + text);
  }
  process.exit(0);
})();
