'use strict';
/**
 * One-shot backfill: re-run AI enrichment on Firecrawl-scraped KB docs that were
 * saved WITHOUT enrichment (the scraper hardcoded the retired `mercury-coder-small`
 * model, so every enrichResource() call 403'd). Now that the codebase uses
 * `mercury-2`, this re-runs the same enrichment (title/citation/category/tags/
 * docTypes/summary) directly against the Mercury API for any firecrawl doc that
 * has no `aiEnrichedAt`.
 *
 * Auth: service-account.json (repo root) for Firestore; MERCURY_API_KEY via env.
 *
 * Flags:
 *   --dry-run        (default — log proposed enrichment, no writes)
 *   --commit         write enrichment back to each doc
 *   --firm <id>      firm to scope to (default: elias-counsel)
 *
 * Run (PowerShell):
 *   $env:MERCURY_API_KEY = (gcloud secrets versions access latest --secret=MERCURY_API_KEY --project=estate-plan-generator)
 *   node functions/scripts/backfill-firecrawl-enrichment.cjs --dry-run --firm elias-counsel
 *   node functions/scripts/backfill-firecrawl-enrichment.cjs --commit  --firm elias-counsel
 */

const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({
  credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))),
});

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const FIRM = argv.includes('--firm') ? argv[argv.indexOf('--firm') + 1] : 'elias-counsel';
const API_KEY = process.env.MERCURY_API_KEY;

function truncateAtWord(text, maxLen) {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const ls = cut.lastIndexOf(' ');
  return ls > maxLen * 0.8 ? cut.slice(0, ls) + '…' : cut + '…';
}

const systemPrompt = `You are a legal research assistant specializing in New Jersey estate planning law.
Analyze the following text and extract structured metadata. Return a valid JSON object with these fields:
{
  "title": "concise descriptive title",
  "citation": "legal citation if present (e.g., N.J.S.A. 3B:3-2), or empty string",
  "category": one of "statute", "case_law", "cle_material", "checklist", "form_template", "practice_note", "custom",
  "tags": ["array", "of", "relevant", "tags"],
  "docTypes": ["array of applicable document types from: will, pourOverWill, poa, livingWill, trust, deed, affidavitOfConsideration, gitRep3, estatePlanSummary"],
  "summary": "one paragraph summary of the content"
}
Respond with ONLY the JSON object, no markdown fences.`;

async function enrich(text) {
  const snippet = truncateAtWord(text, 6000);
  const res = await fetch('https://api.inceptionlabs.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mercury-2',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Analyze this text:\n\n' + snippet },
      ],
      temperature: 0.1,
      max_tokens: 1500,
    }),
  });
  if (!res.ok) throw new Error('Mercury ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const j = await res.json();
  let raw = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  raw = raw.replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  return JSON.parse(raw);
}

(async () => {
  if (!API_KEY) {
    console.error('MERCURY_API_KEY env var not set. See header for how to populate it.');
    process.exit(1);
  }
  const col = admin.firestore().collection('firms').doc(FIRM).collection('knowledgeBase');
  const snap = await col.where('contentSource', '==', 'firecrawl').get();
  const targets = snap.docs.filter((d) => !d.data().aiEnrichedAt);
  console.log(`[backfill] firm=${FIRM} firecrawl=${snap.size} needing-enrichment=${targets.length} mode=${COMMIT ? 'COMMIT' : 'DRY-RUN'}`);

  let ok = 0, fail = 0;
  for (const doc of targets) {
    const d = doc.data();
    try {
      const p = await enrich(d.content || '');
      console.log(`  ${doc.id}: "${p.title}" [${p.category}] tags=${(p.tags || []).length} docTypes=${(p.docTypes || []).length}`);
      if (COMMIT) {
        const updates = {
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          aiEnrichedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (p.title) updates.title = p.title;
        if (p.citation) updates.citation = p.citation;
        if (p.category) updates.category = p.category;
        if (p.tags && p.tags.length) updates.tags = p.tags;
        if (p.docTypes && p.docTypes.length) updates.docTypes = p.docTypes;
        if (p.summary) updates.contentSummary = p.summary;
        await doc.ref.update(updates);
      }
      ok++;
    } catch (e) {
      console.error(`  ${doc.id}: FAILED ${e.message}`);
      fail++;
    }
  }
  console.log(`[backfill] done. enriched=${ok} failed=${fail} ${COMMIT ? '(committed)' : '(dry-run, no writes)'}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
