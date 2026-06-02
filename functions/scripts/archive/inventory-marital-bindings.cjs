'use strict';
// Inventories every remaining IL template in
// firms/elias-counsel/documentTemplates after the dedup deletes.
// For each template, classifies binding paragraphs into:
//   - FIDUCIARY-APPOINTMENT (will rewrite with #if spouseFullName fallback)
//   - FAMILY-INFO (leave alone — spouse named for legitimate kinship reasons)
//   - INDETERMINATE (needs attorney eyeball)
// Writes tmp/sweep/<template-id>.json with classification + paragraph
// indices, and a top-level tmp/sweep/INDEX.json with the full plan.
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

admin.initializeApp({
  credential: admin.credential.cert(
    require(path.resolve(__dirname, '..', '..', 'service-account.json'))
  ),
});

const OUT_DIR = path.resolve(__dirname, '..', '..', 'tmp', 'sweep');
fs.mkdirSync(OUT_DIR, { recursive: true });

const BINDING_RE = /\{\{\s*(?:spouseFullName|spouseTitle|spouseInfo\.[a-zA-Z]+)/;
const APPOINT_RE = /\bappoint(?:s|ed|ing)?\b/i;
const DESIGNATE_RE = /\bdesignate(?:s|d)?\b/i;
const NAMED_ROLE_RE = /\b(?:Executor|Trustee|Health\s*Care\s*Representative|Attorney[-\s]*in[-\s]*Fact|Guardian|Funeral\s*Representative|POA\s*Agent)\b/i;

// Family-info indicators — these paragraphs talk ABOUT the spouse rather
// than appointing them. Leave alone.
const FAMILY_INFO_RE = /(I\s+(am\s+married|was\s+married)|my\s+(spouse|husband|wife)\s+(predeceased|survives|survives\s+me|does\s+not\s+survive)|residing\s+at|a\s+married\s+couple|Surviving\s+Spouse|Grantor|signed\s+below|If\s+my\s+\{\{spouseTitle\}\}\s+(Survives|Does\s+Not\s+Survive)|other\s+than\s+my\s+\{\{spouseTitle\}\})/i;

// Trust-name patterns ("Smith Polo Family Trust") — uses spouseInfo.lastName
// for naming, not for appointing. Leave alone.
const TRUST_NAME_RE = /\{\{\s*spouseInfo\.lastName\s*\}\}|\{\{\s*personalInfo\.lastName\s*\}\}\s*\{\{\s*spouseInfo\.lastName\s*\}\}/;

function classifyPara(html) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const reasons = [];

  if (!BINDING_RE.test(html)) {
    return { kind: 'NO-BINDING', reasons };
  }

  const isAppoint = APPOINT_RE.test(text) || DESIGNATE_RE.test(text);
  const isFamilyInfo = FAMILY_INFO_RE.test(text);
  const hasRole = NAMED_ROLE_RE.test(text);
  const hasTrustName = TRUST_NAME_RE.test(html);

  if (isFamilyInfo && !isAppoint) {
    reasons.push('family-info phrase (married/predeceased/residing/etc), no appoint verb');
    return { kind: 'FAMILY-INFO', reasons };
  }

  if (isAppoint && hasRole) {
    reasons.push(`appoint+role verb adjacent to spouse binding (role: ${(text.match(NAMED_ROLE_RE) || [''])[0]})`);
    return { kind: 'FIDUCIARY-APPOINTMENT', reasons };
  }

  if (isFamilyInfo && isAppoint && !hasRole) {
    // e.g. "I leave to my spouse Y" — gift, not appointment
    reasons.push('appoint-like verb but in family-bequest context, no fiduciary role');
    return { kind: 'FAMILY-INFO', reasons };
  }

  if (hasTrustName && !isAppoint) {
    reasons.push('trust-name composite — naming convention, not appointment');
    return { kind: 'FAMILY-INFO', reasons };
  }

  reasons.push(`indeterminate: appoint=${isAppoint}, role=${hasRole}, family=${isFamilyInfo}, trustName=${hasTrustName}`);
  return { kind: 'INDETERMINATE', reasons };
}

// Heuristic to pick the fallback fiduciary path for a given appointment.
// Returns null if the role can't be confidently determined.
function inferFiduciaryPath(text) {
  const role = (text.match(NAMED_ROLE_RE) || [''])[0].toLowerCase();
  if (/health\s*care/.test(role)) return 'fiduciaries.healthcareProxy.agent';
  if (/attorney/.test(role) || /poa\s*agent/.test(role)) return 'fiduciaries.powerOfAttorney.agent';
  if (/funeral/.test(role)) return 'fiduciaries.executor.primary'; // funeral rep is conventionally exec primary
  if (/executor/.test(role)) return 'fiduciaries.executor.primary';
  if (/trustee/.test(role)) return 'fiduciaries.trustee.primary';
  if (/guardian/.test(role)) return 'fiduciaries.guardian.primary';
  return null;
}

(async () => {
  const db = admin.firestore();
  const snap = await db.collection('firms/elias-counsel/documentTemplates').get();
  const index = [];

  for (const d of snap.docs) {
    const t = d.data();
    const html = t.content ?? t.html ?? '';
    const docTypes = t.docTypes ?? (t.docType ? [t.docType] : []);

    // Per-template paragraph walk
    const paras = [];
    const re = /<p\b[^>]*>([\s\S]*?)<\/p>/g;
    let m, idx = 0;
    while ((m = re.exec(html)) !== null) {
      const inner = m[1];
      const wholeP = m[0];
      const classification = classifyPara(wholeP);
      if (classification.kind !== 'NO-BINDING') {
        const text = wholeP.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        paras.push({
          idx,
          kind: classification.kind,
          reasons: classification.reasons,
          fallbackPath: classification.kind === 'FIDUCIARY-APPOINTMENT' ? inferFiduciaryPath(text) : null,
          html: wholeP.length > 600 ? wholeP.slice(0, 600) + '…' : wholeP,
          textPreview: text.length > 240 ? text.slice(0, 240) + '…' : text,
        });
      }
      idx++;
    }

    const counts = {
      total: paras.length,
      fiduciaryAppointment: paras.filter((p) => p.kind === 'FIDUCIARY-APPOINTMENT').length,
      familyInfo: paras.filter((p) => p.kind === 'FAMILY-INFO').length,
      indeterminate: paras.filter((p) => p.kind === 'INDETERMINATE').length,
    };

    const out = {
      id: d.id,
      name: t.name,
      docTypes,
      isActive: t.isActive,
      isDefault: t.isDefault,
      contentLength: html.length,
      counts,
      paras,
    };
    fs.writeFileSync(path.join(OUT_DIR, `${d.id}.json`), JSON.stringify(out, null, 2));
    index.push({
      id: d.id,
      name: t.name,
      docTypes,
      isActive: t.isActive,
      counts,
    });
  }

  index.sort((a, b) => (a.docTypes[0] ?? '').localeCompare(b.docTypes[0] ?? '') || a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(OUT_DIR, 'INDEX.json'), JSON.stringify(index, null, 2));

  console.log('==== Sweep inventory ====');
  console.log(`Total templates: ${index.length}`);
  let totalAppoint = 0;
  for (const t of index) {
    const a = t.counts.fiduciaryAppointment;
    const fi = t.counts.familyInfo;
    const ind = t.counts.indeterminate;
    totalAppoint += a;
    const tag = a > 0 ? '⚠' : (ind > 0 ? '?' : '·');
    console.log(`  ${tag} ${(t.docTypes[0] || '?').padEnd(13)} ${(t.name || '').padEnd(38).slice(0, 38)} appoint=${a} family=${fi} indet=${ind}  ${t.id}`);
  }
  console.log(`\nTotal fiduciary-appointment paragraphs needing the conditional patch: ${totalAppoint}`);
  console.log('\nPer-template details in tmp/sweep/<id>.json');
  console.log('Sorted summary in tmp/sweep/INDEX.json');
  process.exit(0);
})();
