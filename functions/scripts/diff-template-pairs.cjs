'use strict';
// Pulls 4 IL template pairs from Firestore and writes
// per-pair diff dossiers to tmp/dedup/ so attorney can pick the canonical
// version. Read-only — does not modify or delete anything.
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

admin.initializeApp({
  credential: admin.credential.cert(
    require(path.resolve(__dirname, '..', '..', 'service-account.json'))
  ),
});

const PAIRS = [
  { label: 'JessicaHC',   docType: 'livingWill',   a: 'QU978ikcinUlcKuMCqyg', b: 'zNXZnZNN1YqGqSGWIEOe' },
  { label: 'JessicaPOA',  docType: 'poa',          a: 'SUJUQRIjiTTxjdKJO79o', b: 'fN5MXom5iYsVkdUAZd6l' },
  { label: 'RizzoTrust',  docType: 'trust',        a: '7HbUWAD8ofeHYYtq6tNZ', b: 'mcrsbJBXr8zBeZamjXbJ' },
  { label: 'JessicaLWT',  docType: 'will',         a: 'CCepgSwMNusH1jsWPRf8', b: 'nGH7jfJINVP08BK1mc7A' },
];

const OUT_DIR = path.resolve(__dirname, '..', '..', 'tmp', 'dedup');
fs.mkdirSync(OUT_DIR, { recursive: true });

function bindingCounts(html) {
  const count = (re) => (html.match(re) || []).length;
  return {
    spouseFullName: count(/\{\{\s*spouseFullName\s*\}\}/g),
    spouseTitle:    count(/\{\{\s*spouseTitle\s*\}\}/g),
    spouseInfo:     count(/\{\{\s*spouseInfo\./g),
    fiduciariesExec:    count(/\{\{\s*fiduciaries\.executor\./g),
    fiduciariesTrustee: count(/\{\{\s*fiduciaries\.trustee\./g),
    fiduciariesPOA:     count(/\{\{\s*fiduciaries\.powerOfAttorney\./g),
    fiduciariesHC:      count(/\{\{\s*fiduciaries\.healthcareProxy\./g),
    appointMy: count(/appoint my/gi),
    designate: count(/designate/gi),
    pStart: count(/<p[\s>]/g),
  };
}

function findAppointmentParas(html) {
  // Find <p> blocks that contain "appoint my" OR "appoint" near a spouse binding.
  // Return up to 8 of them as terse single-line excerpts.
  const paras = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const inner = m[1];
    const text = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const hasAppoint = /appoint(?:s|ed|ing)?\b/i.test(text);
    const hasSpouseBinding = /\{\{\s*spouseFullName\s*\}\}|\{\{\s*spouseTitle\s*\}\}|\{\{\s*spouseInfo\./.test(inner);
    if (hasAppoint && hasSpouseBinding) {
      const rawSnippet = inner.replace(/\s+/g, ' ').trim();
      paras.push(rawSnippet.length > 380 ? rawSnippet.slice(0, 380) + '…' : rawSnippet);
    }
    if (paras.length >= 12) break;
  }
  return paras;
}

(async () => {
  const db = admin.firestore();
  for (const pair of PAIRS) {
    const a = await db.doc(`firms/elias-counsel/documentTemplates/${pair.a}`).get();
    const b = await db.doc(`firms/elias-counsel/documentTemplates/${pair.b}`).get();
    if (!a.exists || !b.exists) {
      console.log(`[skip] ${pair.label}: ${pair.a} exists=${a.exists}, ${pair.b} exists=${b.exists}`);
      continue;
    }
    const ad = a.data(), bd = b.data();
    const aHtml = ad.content ?? ad.html ?? '';
    const bHtml = bd.content ?? bd.html ?? '';
    const aMeta = {
      id: pair.a, name: ad.name, len: aHtml.length,
      sha: crypto.createHash('sha1').update(aHtml).digest('hex').slice(0, 12),
      isActive: ad.isActive, isDefault: ad.isDefault, variant: ad.variant,
      version: ad.version, updatedAt: ad.updatedAt?.toDate?.()?.toISOString?.() ?? ad.updatedAt,
      createdAt: ad.createdAt?.toDate?.()?.toISOString?.() ?? ad.createdAt,
      promptVersion: ad.promptVersion,
      counts: bindingCounts(aHtml),
      appointParas: findAppointmentParas(aHtml),
    };
    const bMeta = {
      id: pair.b, name: bd.name, len: bHtml.length,
      sha: crypto.createHash('sha1').update(bHtml).digest('hex').slice(0, 12),
      isActive: bd.isActive, isDefault: bd.isDefault, variant: bd.variant,
      version: bd.version, updatedAt: bd.updatedAt?.toDate?.()?.toISOString?.() ?? bd.updatedAt,
      createdAt: bd.createdAt?.toDate?.()?.toISOString?.() ?? bd.createdAt,
      promptVersion: bd.promptVersion,
      counts: bindingCounts(bHtml),
      appointParas: findAppointmentParas(bHtml),
    };

    const dossier = { pair: pair.label, docType: pair.docType, a: aMeta, b: bMeta };
    const outPath = path.join(OUT_DIR, `${pair.label}.json`);
    fs.writeFileSync(outPath, JSON.stringify(dossier, null, 2));
    fs.writeFileSync(path.join(OUT_DIR, `${pair.label}__A.html`), aHtml);
    fs.writeFileSync(path.join(OUT_DIR, `${pair.label}__B.html`), bHtml);
    console.log(`[wrote] ${pair.label} → ${outPath}`);
    console.log(`         A: ${aMeta.id} len=${aMeta.len} sha=${aMeta.sha} isActive=${aMeta.isActive} isDefault=${aMeta.isDefault} updated=${aMeta.updatedAt}`);
    console.log(`             counts: ${JSON.stringify(aMeta.counts)}`);
    console.log(`         B: ${bMeta.id} len=${bMeta.len} sha=${bMeta.sha} isActive=${bMeta.isActive} isDefault=${bMeta.isDefault} updated=${bMeta.updatedAt}`);
    console.log(`             counts: ${JSON.stringify(bMeta.counts)}`);
  }
  process.exit(0);
})();
