/**
 * functions/src/njsa-statutes.ts
 *
 * New Jersey Statutes (N.J.S.A.) — deterministic statutory retrieval.
 *
 * The NJ Legislature has no per-section API, but it publishes the complete
 * general and permanent statutes as a plain-text bulk file refreshed every
 * weekday:
 *
 *   https://pub.njleg.gov/statutes/STATUTES-TEXT.zip
 *
 * `scripts/import-njsa.ts` (run locally or via CI) parses that file with
 * `parseNjsaStatutesText` and loads one Firestore document per section into
 * the global `njsaStatutes` collection (statutes are public law — not
 * firm-scoped; access is Cloud Functions/admin-SDK only, client rules deny).
 *
 * Consumers:
 *  - `readNjsaSection`     — exact lookup by citation ("3B:3-2"), any common
 *                            citation spelling accepted.
 *  - `searchNjsaSections`  — keyword search over section headings (token
 *                            index; upgrade path: reuse kb-embeddings for
 *                            semantic search over section text).
 *  - `verifyNjsaCitations` — extract every N.J.S.A. citation from generated
 *                            document content and check each against the
 *                            imported statute text. This is the deterministic
 *                            complement to grounded-review.ts: existence and
 *                            currency are proven from the official text, not
 *                            inferred from web search results.
 */

import * as admin from 'firebase-admin';

export const NJSA_COLLECTION = 'njsaStatutes';
export const NJSA_META_COLLECTION = 'njsaImportMeta';
export const NJSA_META_DOC_ID = 'current';
export const NJSA_DOWNLOAD_URL =
  'https://pub.njleg.gov/statutes/STATUTES-TEXT.zip';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NjsaSection {
  /** Bare citation, e.g. "3B:3-2" — also the Firestore document id. */
  citation: string;
  /** N.J.S.A. title, e.g. "3B". */
  njsaTitle: string;
  /** Title banner name, e.g. "ADMINISTRATION OF ESTATES--DECEDENTS AND OTHERS". */
  titleName: string | null;
  /** Section heading from the header line, when present. */
  heading: string | null;
  /** Full statute text (paragraph breaks preserved). */
  text: string;
}

export interface NjsaParseResult {
  /** e.g. "P.L.2025, c.346, and J.R.22" from the file banner. */
  updatedThrough: string | null;
  titleCount: number;
  sections: NjsaSection[];
}

export interface NjsaImportMeta {
  updatedThrough: string | null;
  sectionCount: number;
  sourceUrl: string;
  importedAt: admin.firestore.Timestamp;
}

export interface NjsaCitationCheck {
  /** Citation as it appeared in the document. */
  raw: string;
  /** Normalized citation, or null when the spelling is unparseable. */
  citation: string | null;
  /** Whether the section exists in the imported statutes. */
  exists: boolean;
  /** Official heading when the section exists. */
  heading: string | null;
}

export interface NjsaVerificationResult {
  status: 'pass' | 'warnings' | 'not_imported';
  checks: NjsaCitationCheck[];
  /** Human-readable currency line, e.g. "current through P.L.2025, c.346". */
  currency: string | null;
}

// ---------------------------------------------------------------------------
// Bulk-file parsing (pure — no Firestore, unit-testable)
// ---------------------------------------------------------------------------

// Section headers sit at the start of a line with no indentation, e.g.
//   "3B:3-2.  Writings intended as wills" / "3B:1-1  Definitions A to H."
// Body lines are indented, which keeps in-text references from matching.
const SECTION_HEADER_RE =
  /^(\d+[A-Za-z]?):([0-9]+[A-Za-z]{0,3}(?:\.[0-9]+)?)-([0-9]+(?:\.[0-9]+)*[a-z]?)\.?[ \t]+(\S.*)?$/;

const TITLE_BANNER_RE = /^TITLE\s+(\d+[A-Za-z]?)[ \t]+(\S.*)$/;

const UPDATED_THROUGH_RE = /\(UPDATED THROUGH\s+(.+?)\)/i;

export function parseNjsaStatutesText(raw: string): NjsaParseResult {
  const text = raw.replace(/\r\n/g, '\n');
  const updatedThrough = text.match(UPDATED_THROUGH_RE)?.[1]?.trim() ?? null;

  const lines = text.split('\n');
  const sections: NjsaSection[] = [];
  const titleNames = new Map<string, string>();
  let current: {
    citation: string;
    njsaTitle: string;
    heading: string | null;
    bodyLines: string[];
  } | null = null;

  const flush = (): void => {
    if (!current) return;
    sections.push({
      citation: current.citation,
      njsaTitle: current.njsaTitle,
      titleName: titleNames.get(current.njsaTitle) ?? null,
      heading: current.heading,
      text: current.bodyLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    });
    current = null;
  };

  for (const line of lines) {
    const banner = line.match(TITLE_BANNER_RE);
    if (banner) {
      flush();
      const title = banner[1].toUpperCase();
      if (!titleNames.has(title)) titleNames.set(title, banner[2].trim());
      continue;
    }
    const header = line.match(SECTION_HEADER_RE);
    if (header) {
      flush();
      const njsaTitle = header[1].toUpperCase();
      current = {
        citation: `${njsaTitle}:${header[2]}-${header[3]}`,
        njsaTitle,
        heading: header[4]?.trim().replace(/\s+/g, ' ') || null,
        bodyLines: [],
      };
      continue;
    }
    if (current) current.bodyLines.push(line.replace(/[ \t]+$/g, ''));
  }
  flush();

  // The bulk file can repeat a citation (original + amended text); keep the
  // last occurrence, which reflects current law.
  const byCitation = new Map<string, NjsaSection>();
  for (const section of sections) byCitation.set(section.citation, section);

  return {
    updatedThrough,
    titleCount: titleNames.size,
    sections: [...byCitation.values()],
  };
}

/**
 * Normalize any common N.J.S.A. citation spelling to the stored form:
 * "N.J.S.A. 3B:3-2." / "NJSA 3b:3-2" / "§ 3B:3-2" → "3B:3-2".
 */
export function normalizeNjsaCitation(input: string): string | null {
  const cleaned = input
    .trim()
    .replace(/^(?:n\.?\s*j\.?\s*s\.?\s*a?\.?|njs|r\.s\.)\s*/i, '')
    .replace(/^§+\s*/, '')
    .replace(/\s+/g, '')
    .replace(/\.+$/, '');
  const match = cleaned.match(
    /^(\d+[A-Za-z]?):([0-9]+[A-Za-z]{0,3}(?:\.[0-9]+)?)-([0-9]+(?:\.[0-9]+)*[a-z]?)$/,
  );
  if (!match) return null;
  return `${match[1].toUpperCase()}:${match[2]}-${match[3]}`;
}

/**
 * Tokenize a section for the keyword index (lowercased, de-duplicated).
 * Indexes the heading plus the opening of the statute text — headings alone
 * miss sections whose operative name lives in the body (e.g. 46:2B-8.1 is
 * headed "Short title." while "Revised Durable Power of Attorney Act" is in
 * the text).
 */
export function headingTokens(
  heading: string | null,
  text?: string | null,
): string[] {
  const source = `${heading ?? ''} ${(text ?? '').slice(0, 400)}`;
  return [
    ...new Set(
      source
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 2),
    ),
  ].slice(0, 60);
}

// ---------------------------------------------------------------------------
// Firestore import
// ---------------------------------------------------------------------------

/**
 * Import parsed sections into Firestore with a BulkWriter. Replaces the
 * previous import (stale sections — repealed/renumbered — are removed).
 * Refuses to write when the parse looks wrong (source format change guard).
 */
export async function importNjsaSections(
  parsed: NjsaParseResult,
  opts: { minSections?: number } = {},
): Promise<NjsaImportMeta> {
  const minSections = opts.minSections ?? 10_000;
  if (parsed.sections.length < minSections) {
    throw new Error(
      `Parsed only ${parsed.sections.length} sections (< ${minSections}); ` +
        'the source format may have changed. Aborting without writing.',
    );
  }
  const db = admin.firestore();
  const importedAt = admin.firestore.Timestamp.now();
  const writer = db.bulkWriter();

  for (const s of parsed.sections) {
    writer.set(db.collection(NJSA_COLLECTION).doc(s.citation), {
      citation: s.citation,
      njsaTitle: s.njsaTitle,
      titleName: s.titleName,
      heading: s.heading,
      headingTokens: headingTokens(s.heading, s.text),
      text: s.text,
      importedAt,
    });
  }
  await writer.close();

  // Remove sections dropped from the source.
  const stale = await db
    .collection(NJSA_COLLECTION)
    .where('importedAt', '<', importedAt)
    .get();
  if (!stale.empty) {
    const cleanup = db.bulkWriter();
    for (const doc of stale.docs) cleanup.delete(doc.ref);
    await cleanup.close();
  }

  const meta: NjsaImportMeta = {
    updatedThrough: parsed.updatedThrough,
    sectionCount: parsed.sections.length,
    sourceUrl: NJSA_DOWNLOAD_URL,
    importedAt,
  };
  await db.collection(NJSA_META_COLLECTION).doc(NJSA_META_DOC_ID).set(meta);
  return meta;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getNjsaImportMeta(): Promise<NjsaImportMeta | null> {
  const snap = await admin
    .firestore()
    .collection(NJSA_META_COLLECTION)
    .doc(NJSA_META_DOC_ID)
    .get();
  return snap.exists ? (snap.data() as NjsaImportMeta) : null;
}

function currencyLine(meta: NjsaImportMeta | null): string | null {
  if (!meta) return null;
  return meta.updatedThrough
    ? `current through ${meta.updatedThrough} (NJ Legislature, pub.njleg.gov)`
    : 'source: NJ Legislature (pub.njleg.gov)';
}

export async function readNjsaSection(
  citationInput: string,
): Promise<(NjsaSection & { currency: string | null }) | null> {
  const citation = normalizeNjsaCitation(citationInput);
  if (!citation) return null;
  const [snap, meta] = await Promise.all([
    admin.firestore().collection(NJSA_COLLECTION).doc(citation).get(),
    getNjsaImportMeta(),
  ]);
  if (!snap.exists) return null;
  const data = snap.data() as NjsaSection;
  return { ...data, currency: currencyLine(meta) };
}

/**
 * Keyword search over section headings. Deterministic and cheap; intended
 * for locating sections by topic ("elective share", "self-proving").
 * Ranked by number of matched terms, then citation order.
 */
export async function searchNjsaSections(
  query: string,
  opts: { njsaTitle?: string; limit?: number } = {},
): Promise<Array<Pick<NjsaSection, 'citation' | 'heading' | 'njsaTitle' | 'titleName'>>> {
  const terms = [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 2),
    ),
  ].slice(0, 10);
  if (terms.length === 0) return [];
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 25);

  let q: admin.firestore.Query = admin
    .firestore()
    .collection(NJSA_COLLECTION)
    .where('headingTokens', 'array-contains-any', terms);
  if (opts.njsaTitle) {
    q = q.where('njsaTitle', '==', opts.njsaTitle.toUpperCase());
  }
  const snap = await q.limit(200).get();

  const scored = snap.docs
    .map((doc) => {
      const data = doc.data() as NjsaSection & { headingTokens?: string[] };
      const tokens = new Set(data.headingTokens ?? []);
      const score = terms.reduce((n, t) => n + (tokens.has(t) ? 1 : 0), 0);
      return { data, score };
    })
    .sort(
      (a, b) =>
        b.score - a.score || a.data.citation.localeCompare(b.data.citation),
    )
    .slice(0, limit);

  return scored.map(({ data }) => ({
    citation: data.citation,
    heading: data.heading,
    njsaTitle: data.njsaTitle,
    titleName: data.titleName,
  }));
}

// ---------------------------------------------------------------------------
// Deterministic citation verification for generated documents
// ---------------------------------------------------------------------------

const CITATION_IN_TEXT_RE =
  /N\.?\s?J\.?\s?S\.?\s?A?\.?\s{0,2}(\d+[A-Za-z]?):([0-9]+[A-Za-z]{0,3}(?:\.[0-9]+)?)-([0-9]+(?:\.[0-9]+)*[a-z]?)/g;

/** Extract every distinct N.J.S.A. citation mentioned in document content. */
export function extractNjsaCitations(content: string): string[] {
  const plain = content.replace(/<[^>]+>/g, ' ');
  const found = new Set<string>();
  for (const m of plain.matchAll(CITATION_IN_TEXT_RE)) {
    found.add(`${m[1].toUpperCase()}:${m[2]}-${m[3]}`);
  }
  return [...found];
}

/**
 * Check every N.J.S.A. citation in generated content against the imported
 * statutes. Returns 'not_imported' (with no checks) when the statute
 * database is empty so callers can fall back to grounded-review alone.
 */
export async function verifyNjsaCitations(
  content: string,
): Promise<NjsaVerificationResult> {
  const meta = await getNjsaImportMeta();
  if (!meta || !meta.sectionCount) {
    return { status: 'not_imported', checks: [], currency: null };
  }
  const citations = extractNjsaCitations(content);
  const db = admin.firestore();
  const checks: NjsaCitationCheck[] = await Promise.all(
    citations.map(async (citation): Promise<NjsaCitationCheck> => {
      const snap = await db.collection(NJSA_COLLECTION).doc(citation).get();
      const data = snap.exists ? (snap.data() as NjsaSection) : null;
      return {
        raw: citation,
        citation,
        exists: snap.exists,
        heading: data?.heading ?? null,
      };
    }),
  );
  return {
    status: checks.every((c) => c.exists) ? 'pass' : 'warnings',
    checks,
    currency: currencyLine(meta),
  };
}
