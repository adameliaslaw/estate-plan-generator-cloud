'use strict';
// Applies 8 surgical Handlebars {{#if hasSpouse}}…{{else}}…{{/if}} patches
// across 6 IL templates so fiduciary-appointment paragraphs no longer
// silently render empty for widowed/single clients.
//
// Safety:
//   - Stashes ORIGINAL content to templateBaseline_pre_marital_sweep field
//     on first run (idempotent — subsequent runs skip if field already set).
//   - Each patch's `find` string MUST match exactly once. Multiple or zero
//     matches abort that template (no partial writes).
//   - Dry-run mode via `--dry` flag.
//
// Scope (intentionally limited):
//   - Joint-trust templates (Joint Revocable, Rizzo Living, Olukhov) are
//     skipped — they require both grantors by design; single-grantor
//     clients need a different template.
//   - The "If {{spouseFullName}} is not living" contingency inside Funeral
//     Rep paragraphs is kept verbatim in the married branch and dropped
//     in the widowed branch (where it's nonsensical — primary IS the
//     fallback fiduciary, no further contingency).
const admin = require('firebase-admin');
const path = require('path');

admin.initializeApp({
  credential: admin.credential.cert(
    require(path.resolve(__dirname, '..', '..', 'service-account.json'))
  ),
});

const DRY = process.argv.includes('--dry');

// ─── Patch definitions ─────────────────────────────────────────────────────

const PATCHES = [
  // ── Pattern A: spouseInfo address composite (3 paragraphs) ──────────────
  {
    templateId: 'aPLknvTyvOPNhJ4l2Y3L',
    label: 'Deepak HC primary HCR',
    expectIdx: 3,
    find:
      'I appoint my {{spouseTitle}}, <strong>{{spouseFullName}}</strong>, of {{spouseInfo.address}}, {{spouseInfo.city}}, {{spouseInfo.state}},<strong> </strong>as my Health Care Representative',
    replace:
      'I appoint my {{#if hasSpouse}}{{spouseTitle}}, <strong>{{spouseFullName}}</strong>, of {{spouseInfo.address}}, {{spouseInfo.city}}, {{spouseInfo.state}}{{else}}{{fiduciaries.healthcareProxy.agent.relationship}}, <strong>{{fiduciaries.healthcareProxy.agent.name}}</strong>, of {{fiduciaries.healthcareProxy.agent.address}}, {{fiduciaries.healthcareProxy.agent.city}}, {{fiduciaries.healthcareProxy.agent.state}}{{/if}},<strong> </strong>as my Health Care Representative',
  },
  {
    templateId: 'zNXZnZNN1YqGqSGWIEOe',
    label: 'Jessica HC primary HCR',
    expectIdx: 3,
    find:
      'I appoint my {{spouseTitle}}, <strong>{{spouseFullName}}</strong>, of {{spouseInfo.address}}, {{spouseInfo.city}}, {{spouseInfo.state}},<strong> </strong>as my Health Care Representative',
    replace:
      'I appoint my {{#if hasSpouse}}{{spouseTitle}}, <strong>{{spouseFullName}}</strong>, of {{spouseInfo.address}}, {{spouseInfo.city}}, {{spouseInfo.state}}{{else}}{{fiduciaries.healthcareProxy.agent.relationship}}, <strong>{{fiduciaries.healthcareProxy.agent.name}}</strong>, of {{fiduciaries.healthcareProxy.agent.address}}, {{fiduciaries.healthcareProxy.agent.city}}, {{fiduciaries.healthcareProxy.agent.state}}{{/if}},<strong> </strong>as my Health Care Representative',
  },
  {
    templateId: 'SUJUQRIjiTTxjdKJO79o',
    label: 'Jessica POA primary AIF',
    expectIdx: 1,
    find:
      'designate my {{spouseTitle}}, <strong>{{spouseFullName}}</strong>, of {{spouseInfo.address}}, {{spouseInfo.city}}, {{spouseInfo.state}}, to be my Attorney-in-Fact',
    replace:
      'designate my {{#if hasSpouse}}{{spouseTitle}}, <strong>{{spouseFullName}}</strong>, of {{spouseInfo.address}}, {{spouseInfo.city}}, {{spouseInfo.state}}{{else}}{{fiduciaries.powerOfAttorney.agent.relationship}}, <strong>{{fiduciaries.powerOfAttorney.agent.name}}</strong>, of {{fiduciaries.powerOfAttorney.agent.address}}, {{fiduciaries.powerOfAttorney.agent.city}}, {{fiduciaries.powerOfAttorney.agent.state}}{{/if}}, to be my Attorney-in-Fact',
  },

  // ── Pattern B: personalInfo composite + Initial Executor (2 paragraphs) ─
  {
    templateId: '7uu7gxTN1Z7RMmCUCuTO',
    label: 'Vita Maria Initial Executor',
    expectIdx: 9,
    find:
      'I appoint my {{spouseTitle}}, <strong>{{spouseFullName}}</strong> of {{personalInfo.address}}, {{personalInfo.city}}, {{personalInfo.state}} to serve as Executor hereunder.',
    replace:
      'I appoint my {{#if hasSpouse}}{{spouseTitle}}, <strong>{{spouseFullName}}</strong> of {{personalInfo.address}}, {{personalInfo.city}}, {{personalInfo.state}}{{else}}{{fiduciaries.executor.primary.relationship}}, <strong>{{fiduciaries.executor.primary.name}}</strong> of {{fiduciaries.executor.primary.address}}, {{fiduciaries.executor.primary.city}}, {{fiduciaries.executor.primary.state}}{{/if}} to serve as Executor hereunder.',
  },
  {
    templateId: 'CCepgSwMNusH1jsWPRf8',
    label: 'Jessica LWT Initial Executor',
    expectIdx: 25,
    find:
      'I appoint my {{spouseTitle}}, <strong>{{spouseFullName}}</strong>, of {{personalInfo.address}}, {{personalInfo.city}}, {{personalInfo.state}}, to serve as Executor hereunder.',
    replace:
      'I appoint my {{#if hasSpouse}}{{spouseTitle}}, <strong>{{spouseFullName}}</strong>, of {{personalInfo.address}}, {{personalInfo.city}}, {{personalInfo.state}}{{else}}{{fiduciaries.executor.primary.relationship}}, <strong>{{fiduciaries.executor.primary.name}}</strong>, of {{fiduciaries.executor.primary.address}}, {{fiduciaries.executor.primary.city}}, {{fiduciaries.executor.primary.state}}{{/if}}, to serve as Executor hereunder.',
  },

  // ── Pattern C: Funeral Rep with spouse-contingency (3 paragraphs) ───────
  // Married branch keeps the full "spouse → child" chain.
  // Widowed branch appoints executor.primary directly, no contingency.
  {
    templateId: '7uu7gxTN1Z7RMmCUCuTO',
    label: 'Vita Maria Funeral Rep',
    expectIdx: 5,
    find:
      'I appoint my {{spouseTitle}}, <strong>{{spouseFullName}}</strong>, <a id="_Hlk204238565"></a>to act as my representative pursuant to N.J.S.A. 45:27-22 to control the arrangements for my funeral and the disposition of my remains (my "Funeral Representative"). If {{spouseFullName}} is not living at my death or is not reasonably available or willing to act as my Funeral Representative at my death, then I appoint my {{#each childrenWithTitles}}{{#if @first}}{{this.childTitle}}{{/if}}{{/each}}, <br /><strong>{{#each childrenWithTitles}}{{#if @first}}{{this.name}}{{/if}}{{/each}}</strong> to act as my successor Funeral Representative.',
    replace:
      '{{#if hasSpouse}}I appoint my {{spouseTitle}}, <strong>{{spouseFullName}}</strong>, <a id="_Hlk204238565"></a>to act as my representative pursuant to N.J.S.A. 45:27-22 to control the arrangements for my funeral and the disposition of my remains (my "Funeral Representative"). If {{spouseFullName}} is not living at my death or is not reasonably available or willing to act as my Funeral Representative at my death, then I appoint my {{#each childrenWithTitles}}{{#if @first}}{{this.childTitle}}{{/if}}{{/each}}, <br /><strong>{{#each childrenWithTitles}}{{#if @first}}{{this.name}}{{/if}}{{/each}}</strong> to act as my successor Funeral Representative.{{else}}I appoint my {{fiduciaries.executor.primary.relationship}}, <strong>{{fiduciaries.executor.primary.name}}</strong>, to act as my representative pursuant to N.J.S.A. 45:27-22 to control the arrangements for my funeral and the disposition of my remains (my "Funeral Representative").{{/if}}',
  },
  {
    templateId: 'ltaUcvCq5BsJigzmXPvv',
    label: 'Vito Funeral Rep',
    expectIdx: 5,
    find:
      'I appoint my {{spouseTitle}}, <strong>{{spouseFullName}}</strong>, <a id="_Hlk204238565"></a>to act as my representative pursuant to N.J.S.A. 45:27-22 to control the arrangements for my funeral and the disposition of my remains (my "Funeral Representative"). If {{spouseFullName}} is not living at my death or is not reasonably available or willing to act as my Funeral Representative at my death, then I appoint my {{#each childrenWithTitles}}{{#if @first}}{{this.childTitle}}, <br /><strong>{{this.name}}</strong>{{/if}}{{/each}} to act as my successor Funeral Representative.',
    replace:
      '{{#if hasSpouse}}I appoint my {{spouseTitle}}, <strong>{{spouseFullName}}</strong>, <a id="_Hlk204238565"></a>to act as my representative pursuant to N.J.S.A. 45:27-22 to control the arrangements for my funeral and the disposition of my remains (my "Funeral Representative"). If {{spouseFullName}} is not living at my death or is not reasonably available or willing to act as my Funeral Representative at my death, then I appoint my {{#each childrenWithTitles}}{{#if @first}}{{this.childTitle}}, <br /><strong>{{this.name}}</strong>{{/if}}{{/each}} to act as my successor Funeral Representative.{{else}}I appoint my {{fiduciaries.executor.primary.relationship}}, <strong>{{fiduciaries.executor.primary.name}}</strong>, to act as my representative pursuant to N.J.S.A. 45:27-22 to control the arrangements for my funeral and the disposition of my remains (my "Funeral Representative").{{/if}}',
  },
  {
    templateId: 'CCepgSwMNusH1jsWPRf8',
    label: 'Jessica LWT Funeral Rep',
    expectIdx: 5,
    find:
      'I appoint my {{spouseTitle}}, <strong>{{spouseFullName}}</strong>, to act as my representative pursuant to N.J.S.A. 45:27-22 to control the arrangements for my funeral and the disposition of my remains (my "Funeral Representative"). If {{spouseFullName}} is not living at my death or is not reasonably available or willing to act as my Funeral Representative at my death, then I appoint my {{fiduciaries.executor.alternate.relationship}}, <strong>{{fiduciaries.executor.alternate.name}}</strong>, to act as my successor Funeral Representative.',
    replace:
      '{{#if hasSpouse}}I appoint my {{spouseTitle}}, <strong>{{spouseFullName}}</strong>, to act as my representative pursuant to N.J.S.A. 45:27-22 to control the arrangements for my funeral and the disposition of my remains (my "Funeral Representative"). If {{spouseFullName}} is not living at my death or is not reasonably available or willing to act as my Funeral Representative at my death, then I appoint my {{fiduciaries.executor.alternate.relationship}}, <strong>{{fiduciaries.executor.alternate.name}}</strong>, to act as my successor Funeral Representative.{{else}}I appoint my {{fiduciaries.executor.primary.relationship}}, <strong>{{fiduciaries.executor.primary.name}}</strong>, to act as my representative pursuant to N.J.S.A. 45:27-22 to control the arrangements for my funeral and the disposition of my remains (my "Funeral Representative").{{/if}}',
  },
];

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    n++;
    i += needle.length;
  }
  return n;
}

(async () => {
  const db = admin.firestore();

  // Group patches by templateId so each template is read/written once.
  const byTemplate = new Map();
  for (const p of PATCHES) {
    if (!byTemplate.has(p.templateId)) byTemplate.set(p.templateId, []);
    byTemplate.get(p.templateId).push(p);
  }

  for (const [templateId, templatePatches] of byTemplate) {
    const ref = db.doc(`firms/elias-counsel/documentTemplates/${templateId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`[ABORT] ${templateId}: not found`);
      process.exit(1);
    }
    const data = snap.data();
    const originalContent = data.content ?? data.html ?? '';
    let working = originalContent;
    const stashExists = typeof data.templateBaseline_pre_marital_sweep === 'string'
      && data.templateBaseline_pre_marital_sweep.length > 0;
    let appliedHere = 0;
    let alreadyDoneHere = 0;
    const skippedReasons = [];

    for (const p of templatePatches) {
      const findCount = countOccurrences(working, p.find);
      const replaceCount = countOccurrences(working, p.replace);
      if (findCount === 0 && replaceCount === 1) {
        alreadyDoneHere++;
        console.log(`  [skip] ${p.label}: already patched (replace already present)`);
        continue;
      }
      if (findCount === 0) {
        console.log(`  [ABORT] ${p.label}: find pattern not present and replace not present either`);
        skippedReasons.push(`${p.label}: find missing`);
        continue;
      }
      if (findCount > 1) {
        console.log(`  [ABORT] ${p.label}: find pattern matches ${findCount} times — refusing to patch`);
        skippedReasons.push(`${p.label}: multi-match`);
        continue;
      }
      working = working.split(p.find).join(p.replace);
      appliedHere++;
      console.log(`  [ok]   ${p.label}: 1 match → patched`);
    }

    if (skippedReasons.length > 0) {
      console.log(`[ABORT] ${templateId}: ${skippedReasons.length} patch(es) failed validation — no write performed`);
      process.exit(1);
    }

    if (appliedHere === 0) {
      console.log(`[noop] ${templateId} (${data.name}): no patches needed (${alreadyDoneHere} already done)`);
      continue;
    }

    if (DRY) {
      console.log(`[DRY] ${templateId} (${data.name}): would apply ${appliedHere} patches, stash original (size: ${originalContent.length}→${working.length})`);
      continue;
    }

    const update = { content: working };
    if (!stashExists) {
      update.templateBaseline_pre_marital_sweep = originalContent;
      update.maritalSweepAppliedAt = admin.firestore.FieldValue.serverTimestamp();
      update.maritalSweepAppliedBy = 'scripts/patch-marital-conditionals.cjs';
    }
    await ref.update(update);
    console.log(`[WROTE] ${templateId} (${data.name}): ${appliedHere} patches applied (size: ${originalContent.length}→${working.length}, stash:${stashExists ? 'kept' : 'created'})`);
  }
  console.log('\nDone.');
  process.exit(0);
})();
