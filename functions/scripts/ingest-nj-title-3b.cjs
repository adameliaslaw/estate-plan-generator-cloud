/**
 * functions/scripts/ingest-nj-title-3b.cjs
 *
 * One-shot importer: scraped NJ Title 3B markdown files (in .firecrawl/) →
 * Firestore firms/{firmId}/knowledgeBase as `statute` resources.
 *
 * Each .md file looks like:
 *   ...nav junk...
 *   # 2025 New Jersey Revised Statutes Title 3B - Administration of Estates...
 *   Section 3B:1-2 - Definitions I to Z.
 *   Universal Citation:
 *   NJ Rev Stat § 3B:1-2 (2025)
 *   ...
 *   **3B:1-2 Definitions I to Z.**
 *   <actual statute body>
 *   ...footer junk...
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=... node functions/scripts/ingest-nj-title-3b.cjs \
 *     --firm-id elias-counsel --source-dir .firecrawl
 *
 * Or with Application Default Credentials (firebase CLI auth):
 *   node functions/scripts/ingest-nj-title-3b.cjs --firm-id elias-counsel
 *
 * The onKnowledgeResourceWritten trigger will auto-embed each resource
 * after it lands — no manual backfill needed.
 */

'use strict';

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
function arg(flag, defaultValue) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return defaultValue;
  return process.argv[idx + 1] ?? defaultValue;
}

const FIRM_ID    = arg('--firm-id', 'elias-counsel');
const SOURCE_DIR = path.resolve(arg('--source-dir', '.firecrawl'));
const DRY_RUN    = process.argv.includes('--dry-run');
const LIMIT      = parseInt(arg('--limit', '0'), 10);

// ---------------------------------------------------------------------------
// Firebase Admin init
// ---------------------------------------------------------------------------
admin.initializeApp({
  projectId: 'estate-plan-generator',
});
const db = admin.firestore();

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/** Extract section identifier from filename slug, e.g. "section-3b-1-2" -> "3B:1-2". */
function parseSectionIdFromSlug(slug) {
  // slug like "section-3b-1-2" or "section-3b-13a-21"
  const m = slug.match(/^section-3b-([0-9a-z]+)-(.+)$/i);
  if (!m) return null;
  return `3B:${m[1].toUpperCase()}-${m[2]}`;
}

/** Extract a clean H1 heading line from the markdown. */
function parseHeading(md) {
  const m = md.match(/^#\s+(.+?)$/m);
  return m ? m[1].trim() : null;
}

/** Extract the universal citation line, e.g. "NJ Rev Stat § 3B:1-2 (2025)". */
function parseUniversalCitation(md) {
  const m = md.match(/NJ Rev Stat[^\n]+/);
  return m ? m[0].trim() : null;
}

/**
 * Extract just the statute body — the legal text, with Justia chrome
 * (nav, prev/next links, advisory disclaimers, footer) stripped.
 *
 * Strategy: find the first occurrence of `**3B:` or `3B:X-Y.` near a
 * paragraph break — that's the start of the actual statute. Cut off the
 * end when we hit any of the standard Justia footer signposts.
 */
function parseStatuteBody(md, sectionId) {
  // Find body start: typically a bolded line "**3B:1-2 Definitions...**" or
  // an unbolded "3B:1-2." after navigation. Search from after the universal
  // citation block so we skip the metadata header.
  const citationIdx = md.indexOf('NJ Rev Stat');
  const startSearch = citationIdx > 0 ? citationIdx : 0;
  const tail = md.slice(startSearch);

  // Prefer the bolded form
  const boldMatch = tail.match(/\*\*\s*3B:[A-Z0-9-]+[^*]*\*\*/);
  let bodyStart;
  if (boldMatch) {
    bodyStart = startSearch + boldMatch.index + boldMatch[0].length;
  } else {
    // Fallback: find the numbered start anywhere after metadata
    const num = tail.search(/3B:[A-Z0-9-]+\.\s/);
    bodyStart = num >= 0 ? startSearch + num : startSearch;
  }

  // Cut footer: Justia adds "Disclaimer:", "Justia Free Databases", "Legal Reference Materials"
  const FOOTER_MARKERS = [
    'Disclaimer:',
    'Justia Free Databases',
    'Legal Reference Materials',
    'Subscribe to Justia',
    'View Previous Versions',
    'Find a Lawyer',
    '## Stay Informed',
  ];
  let bodyEnd = md.length;
  for (const marker of FOOTER_MARKERS) {
    const i = md.indexOf(marker, bodyStart);
    if (i > 0 && i < bodyEnd) bodyEnd = i;
  }

  let body = md.slice(bodyStart, bodyEnd).trim();

  // Cleanup: drop markdown image references, normalize whitespace
  body = body
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')          // ![alt](url) image syntax
    .replace(/\[!\[[^\]]*\]\([^)]+\)\]\([^)]+\)/g, '') // nested link-image
    .replace(/^\s*[-=]{3,}\s*$/gm, '')              // horizontal rules
    .replace(/\n{3,}/g, '\n\n')                     // collapse blank-line runs
    .trim();

  return body;
}

/**
 * Heuristic: tag the resource with doc types it's relevant to, based on
 * the section's known topical scope. Conservative — when unsure, no tag.
 */
function inferDocTypes(sectionId) {
  // Map of section-prefix ranges to estate-planning doc types.
  // Examples derived from NJ Title 3B's chapter structure.
  // 3B:1-* general definitions (no specific doctype)
  // 3B:3-* wills (execution, witnesses, revocation)
  // 3B:5-* intestate succession
  // 3B:8-* probate
  // 3B:10-* personal representatives
  // 3B:11-* trusts
  // 3B:12-* guardianship
  // 3B:13-* + 3B:13a-* fiduciaries
  // 3B:14-* fiduciary duties
  // 3B:18-* commissions
  // 3B:22-* claims against estates
  // 3B:24-* + 3B:31-* (UTC) trust code
  const types = [];
  if (/^3B:3-/.test(sectionId))                  types.push('will', 'pourOverWill');
  if (/^3B:5-/.test(sectionId))                  types.push('will', 'pourOverWill');
  if (/^3B:8-/.test(sectionId))                  types.push('will', 'pourOverWill');
  if (/^3B:1[12]-/.test(sectionId))              types.push('trust');
  if (/^3B:12-/.test(sectionId))                 types.push('will', 'pourOverWill'); // guardianship
  if (/^3B:24-/.test(sectionId) || /^3B:31-/.test(sectionId)) types.push('trust');
  return [...new Set(types)];
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------
function findMarkdownFiles(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.isFile() && /law\.justia\.com-codes-new-jersey-title-3b-section-3b-.+\.md$/.test(ent.name)) {
      out.push(path.join(dir, ent.name));
    } else if (ent.isDirectory()) {
      out.push(...findMarkdownFiles(path.join(dir, ent.name)));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Idempotency: build a deterministic doc ID per section so re-runs upsert
// instead of duplicating.
// ---------------------------------------------------------------------------
function deterministicDocId(sectionId) {
  // sectionId like "3B:1-2" → "nj-title-3b-1-2"
  return `nj-title-3b-${sectionId.replace('3B:', '').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`[ingest-nj-title-3b] Firm: ${FIRM_ID}`);
  console.log(`[ingest-nj-title-3b] Source: ${SOURCE_DIR}`);
  console.log(`[ingest-nj-title-3b] Dry run: ${DRY_RUN}`);

  const files = findMarkdownFiles(SOURCE_DIR);
  console.log(`[ingest-nj-title-3b] Found ${files.length} markdown files`);

  let imported = 0, skipped = 0, errors = 0;
  const processed = new Set(); // dedup by sectionId across nested directories

  for (let i = 0; i < files.length; i++) {
    if (LIMIT > 0 && imported >= LIMIT) break;
    const file = files[i];
    const slug = path.basename(file).replace(/^law\.justia\.com-codes-new-jersey-title-3b-/, '').replace(/\.md$/, '');

    const sectionId = parseSectionIdFromSlug(slug);
    if (!sectionId) {
      console.warn(`[skip] Could not parse section ID from ${slug}`);
      skipped++;
      continue;
    }
    if (processed.has(sectionId)) {
      skipped++;
      continue;
    }
    processed.add(sectionId);

    const md = fs.readFileSync(file, 'utf8');
    const heading = parseHeading(md);
    const universalCitation = parseUniversalCitation(md);
    const body = parseStatuteBody(md, sectionId);

    if (!body || body.length < 30) {
      console.warn(`[skip] ${sectionId}: body too short (${body?.length ?? 0} chars) — likely a parsing miss`);
      skipped++;
      continue;
    }

    const docTypes = inferDocTypes(sectionId);
    const title = heading
      ? heading.replace(/^2025 New Jersey Revised Statutes\s+Title 3B[^S]*Section\s+/, 'N.J.S.A. ')
      : `N.J.S.A. ${sectionId}`;

    const citation = `N.J.S.A. ${sectionId}`;
    const sourceUrl = `https://law.justia.com/codes/new-jersey/title-3b/${slug}/`;

    const docId = deterministicDocId(sectionId);
    const ref = db.collection('firms').doc(FIRM_ID).collection('knowledgeBase').doc(docId);

    const resource = {
      id: docId,
      firmId: FIRM_ID,
      category: 'statute',
      title,
      citation,
      content: body,
      tags: ['title-3b', 'NJ', 'statute', 'estate-administration'],
      docTypes,
      jurisdiction: 'NJ',
      isActive: true,
      source: 'Justia',
      sourceUrl,
      universalCitation: universalCitation ?? undefined,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: 'system:ingest-nj-title-3b',
      updatedBy: 'system:ingest-nj-title-3b',
    };

    if (DRY_RUN) {
      console.log(`[dry] ${sectionId}: ${title} (${body.length} chars, docTypes=${docTypes.join(',') || 'none'})`);
      imported++;
    } else {
      try {
        await ref.set(resource, { merge: true });
        console.log(`[ok]  ${sectionId}: ${title.slice(0, 60)}... (${body.length} chars)`);
        imported++;
      } catch (err) {
        console.error(`[err] ${sectionId}:`, err.message);
        errors++;
      }
    }
  }

  console.log(`\n[ingest-nj-title-3b] DONE — imported=${imported}, skipped=${skipped}, errors=${errors}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
