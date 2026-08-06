/**
 * functions/src/package-review.ts
 *
 * reviewPackage — deterministic, cross-document review of a freshly generated
 * document set.
 *
 * This is the complement to `ai-compliance-check.ts`, not a replacement. That
 * module asks an LLM to review ONE document against a statutory checklist. This
 * module reasons about the package AS A WHOLE, using rules rather than a model:
 *
 *   - Does a document promise an instrument the package does not contain?
 *   - Does the cover letter's enclosure list match what was actually generated?
 *   - Did a blank, a template token, or a drafting marker survive into output?
 *   - Does a provision cite an age the governing NJ statute will not permit?
 *   - Does a document carry administration provisions for a structure that no
 *     dispositive clause ever creates?
 *
 * Why rules and not an LLM: every check here is a fact about the text, so a
 * model adds latency, cost, and the possibility of an invented citation while
 * subtracting determinism. These findings are reproducible, instant, free, and
 * unit-testable against fixtures. Judgement calls stay with the AI reviewer.
 *
 * Design constraint — FALSE POSITIVES ARE THE FAILURE MODE. A review queue that
 * cries wolf gets ignored, at which point it is worse than no queue at all.
 * Every check below is deliberately conservative: it stays silent when the
 * signal is ambiguous, and phrases uncertain findings as "verify" rather than
 * "fix". Prefer missing a defect to inventing one.
 *
 * Pure module: no Firestore, no network, no AI. Input is text, output is
 * findings.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Ordered most- to least- urgent. Drives sort order and UI treatment. */
export type PackageFindingSeverity = 'high' | 'medium' | 'low';

/**
 * Why a finding was raised. Kept deliberately small — a taxonomy the reviewing
 * attorney can hold in their head, where each value implies a different fix:
 *
 *   blank-field          → fill in the missing data, regenerate
 *   unresolved-token     → generation bug; the template did not fully render
 *   missing-instrument   → wrong boilerplate for this package; remove or add
 *   enclosure-mismatch   → cover letter and package disagree
 *   statutory-limit      → the drafted term is not permitted by NJ statute
 *   inoperative-provision→ text with no legal effect as drafted
 */
export type PackageFindingReason =
  | 'blank-field'
  | 'unresolved-token'
  | 'missing-instrument'
  | 'enclosure-mismatch'
  | 'statutory-limit'
  | 'inoperative-provision';

export interface PackageFinding {
  /** docType of the document the finding is in. */
  docType: string;
  /** Human-readable document title, for display. */
  title: string;
  /**
   * Where in the document. Best-effort: the nearest preceding heading, or a
   * structural label like "Body Paragraph" when no heading precedes the hit.
   */
  location: string;
  severity: PackageFindingSeverity;
  reason: PackageFindingReason;
  /** One line. Safe to render in a table cell. */
  summary: string;
  /** Two to four sentences: what is wrong, why it matters, what to do. */
  detail: string;
}

/** The subset of a generated document this module needs. */
export interface PackageDoc {
  docType: string;
  title: string;
  /** Generated HTML. */
  content: string;
  /** Documents that failed to generate are skipped. */
  status?: string;
}

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

/**
 * HTML → plain text, preserving block boundaries as newlines so that
 * line-oriented checks (blanks, headings) behave sensibly.
 *
 * Deliberately simple: generated content is our own templated HTML, not
 * arbitrary web pages, so a parser would be overkill here.
 */
export function htmlToText(html: string): string {
  return html
    // Drop anything non-renderable before tags are stripped, so script/style
    // bodies can't leak into the text and trip a check.
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    // Block-level boundaries become newlines.
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // Collapse runs of spaces/tabs but keep newlines meaningful.
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
}

/**
 * Best-effort section label for a character offset: walk backwards to the
 * nearest line that reads like a heading.
 *
 * A heading is a short line that is either all-caps, or matches a numbered
 * section pattern ("Section 5.02", "ARTICLE THREE", "3.06 Distributions").
 */
export function locateSection(text: string, index: number): string {
  const before = text.slice(0, index).split('\n');
  for (let i = before.length - 1; i >= 0 && i >= before.length - 40; i--) {
    const line = before[i].trim();
    if (!line || line.length > 90) continue;

    const numbered = line.match(
      /^((?:Section|Article|Paragraph|Clause)\s+[\w.()-]+|\d+\.\d+(?:\.\d+)?)/i,
    );
    if (numbered) return numbered[1];

    // Letterhead and address blocks are also all-caps and also short, so they
    // out-compete the real heading if not excluded. A house number opening the
    // line, or a five-digit ZIP anywhere in it, is the reliable tell.
    // (Observed: "168 PROSPECT PLAINS ROAD, MONROE TOWNSHIP, NEW JERSEY 08831"
    // was being reported as the section containing a will provision.)
    if (/^\d+\s/.test(line) || /\b\d{5}(-\d{4})?\b/.test(line)) continue;

    // All-caps heading of at least two word characters, no sentence-ending
    // punctuation. Guards against catching a short all-caps sentence.
    const letters = line.replace(/[^A-Za-z]/g, '');
    if (letters.length >= 3 && line === line.toUpperCase() && !/[.;:]$/.test(line)) {
      return toTitleCase(line);
    }
  }
  return 'Body Paragraph';
}

function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Neutralise phrases that would otherwise collide with a check's keyword.
 * A "Special Needs Trust" created BY a will is not the client's living trust,
 * so it must not satisfy the missing-instrument check.
 *
 * The replacement is length-preserving so that a match offset taken against the
 * masked string still points at the right place in the original text.
 */
function maskNestedTrusts(text: string): string {
  return text.replace(
    /\b(special|supplemental)\s+needs\s+trusts?\b/gi,
    (m) => 'x'.repeat(m.length),
  );
}

// ---------------------------------------------------------------------------
// docType groupings
// ---------------------------------------------------------------------------

/** Doc types whose presence means the client does have a trust instrument. */
const TRUST_BEARING_DOCTYPES = new Set([
  'trust',
  'certificationOfTrust',
  'trustAmendment',
  'trustRestatement',
  'petTrust',
]);

/**
 * Maps the natural-language names an attorney writes in a cover letter to the
 * docTypes that satisfy them. Only confident mappings belong here — an
 * enclosure line that matches nothing is skipped rather than flagged, because
 * "I don't recognise this" is not evidence of absence.
 */
const ENCLOSURE_PATTERNS: ReadonlyArray<{ pattern: RegExp; satisfiedBy: string[]; label: string }> = [
  { pattern: /last will|will and testament|pour[- ]over will/i, satisfiedBy: ['will', 'pourOverWill'], label: 'Last Will and Testament' },
  { pattern: /power of attorney/i, satisfiedBy: ['poa'], label: 'Power of Attorney' },
  { pattern: /health ?care directive|advance directive|living will/i, satisfiedBy: ['livingWill'], label: 'Advance Health Care Directive' },
  { pattern: /hipaa/i, satisfiedBy: ['hipaaRelease'], label: 'HIPAA Authorization' },
  { pattern: /revocable (living )?trust|living trust\b/i, satisfiedBy: [...TRUST_BEARING_DOCTYPES], label: 'Revocable Living Trust' },
  { pattern: /\bdeed\b/i, satisfiedBy: ['deed'], label: 'Deed' },
  { pattern: /certification of trust/i, satisfiedBy: ['certificationOfTrust'], label: 'Certification of Trust' },
];

// ---------------------------------------------------------------------------
// Check 1 — unresolved template tokens
// ---------------------------------------------------------------------------

/**
 * Handlebars expressions or drafting markers that survived rendering. These are
 * always generation bugs and must never reach a client, so they are high
 * severity without exception.
 */
function checkUnresolvedTokens(doc: PackageDoc, text: string): PackageFinding[] {
  const findings: PackageFinding[] = [];
  const seen = new Set<string>();

  const patterns: Array<{ rx: RegExp; what: string }> = [
    { rx: /\{\{[^{}]{1,80}\}\}/g, what: 'an unrendered Handlebars expression' },
    { rx: /\[\[[^[\]]{1,80}\]\]/g, what: 'an unrendered placeholder token' },
    { rx: /\b(TODO|TBD|FIXME|XXX)\b/g, what: 'a drafting marker' },
  ];

  for (const { rx, what } of patterns) {
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      const token = m[0];
      if (seen.has(token)) continue;
      seen.add(token);
      findings.push({
        docType: doc.docType,
        title: doc.title,
        location: locateSection(text, m.index),
        severity: 'high',
        reason: 'unresolved-token',
        summary: `Unresolved template token "${truncate(token, 40)}" in the generated text`,
        detail:
          `The generated document still contains ${what}: "${truncate(token, 60)}". ` +
          `This is a rendering failure, not a data gap — the template did not fully resolve. ` +
          `Regenerate the document; if the token persists, the underlying template or its ` +
          `data binding needs to be corrected before this package is delivered.`,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 2 — unfilled blanks
// ---------------------------------------------------------------------------

/**
 * A run of underscores sitting INLINE in a sentence — text before it and text
 * after it on the same line — is an unfilled field.
 *
 * Signature blocks, notary jurats, and horizontal rules also use underscores,
 * and those are correct. They are excluded two ways: the run must have real
 * words on both sides (a signature line has nothing after it), and the line
 * must not read like an execution block.
 */
const SIGNATURE_CONTEXT =
  /\b(signature|signed|witness|notar|seal|subscribed|sworn|commission expires|print(ed)? name|date[d]?\b|attest)/i;

function checkUnfilledBlanks(doc: PackageDoc, text: string): PackageFinding[] {
  const findings: PackageFinding[] = [];
  const lines = text.split('\n');
  let offset = 0;

  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1; // +1 for the newline consumed by split

    const rx = /_{3,}/g;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(line)) !== null) {
      // Test the neighbourhood of the blank, not the whole line — generated
      // paragraphs run long, and an incidental "dated" 400 characters away
      // would otherwise suppress a real finding.
      const neighbourhood = line.slice(
        Math.max(0, m.index - 100),
        m.index + m[0].length + 100,
      );
      if (SIGNATURE_CONTEXT.test(neighbourhood)) continue;

      const before = line.slice(0, m.index).trim();
      const after = line.slice(m.index + m[0].length).trim();

      // Require substantive text on BOTH sides. This is what separates
      // "my wish that ______ be given preference" (a real blank) from
      // "Signed on ______" and from a full-width divider rule.
      if (!/[A-Za-z]{3}/.test(before) || !/[A-Za-z]{3}/.test(after)) continue;

      findings.push({
        docType: doc.docType,
        title: doc.title,
        location: locateSection(text, lineStart),
        severity: 'high',
        reason: 'blank-field',
        summary: 'A required field was left blank in the operative text',
        detail:
          `An unfilled blank appears mid-sentence: "…${truncate(before.slice(-60), 60)} ` +
          `______ ${truncate(after, 60)}…". Because the blank sits inside an operative ` +
          `provision rather than a signature block, the document may not accomplish its ` +
          `intended purpose as drafted. Supply the missing value and regenerate, or strike ` +
          `the provision if it does not apply.`,
      });
      break; // one finding per line is enough to prompt a look
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 3 — references to an instrument the package does not contain
// ---------------------------------------------------------------------------

/**
 * The check the competition misses.
 *
 * Boilerplate written for a trust-based plan routinely ends up in a wills-only
 * package: an acknowledgment letter telling the client they are responsible for
 * funding "your trust" when no trust was drafted. The client signs an
 * acknowledgment about an instrument that does not exist.
 *
 * No single document is internally inconsistent, which is exactly why a
 * per-document review cannot see it. It is only visible from the package.
 */
const EXISTING_TRUST_PHRASES: ReadonlyArray<RegExp> = [
  /\b(your|our|my|their)\s+trust\b/i,
  /\bthe\s+trust\s+(is|be|has been|must be|should be)\s+funded\b/i,
  /\bfunding\s+of\s+(the|your|our|my)\s+trust\b/i,
  /\btransferred?\s+(in)?to\s+the\s+trust\b/i,
  /\bthe\s+trust\s+document\b/i,
  /\bassets?\s+(in|held by)\s+the\s+trust\b/i,
];

function checkMissingInstrument(docs: PackageDoc[]): PackageFinding[] {
  const present = new Set(docs.map((d) => d.docType));
  const hasTrust = [...TRUST_BEARING_DOCTYPES].some((t) => present.has(t));
  if (hasTrust) return [];

  const findings: PackageFinding[] = [];

  for (const doc of docs) {
    // A pour-over will legitimately speaks of a trust it pours into; the
    // absent-trust problem there is a different (and intended) drafting
    // posture, so it is out of scope for this check.
    if (doc.docType === 'pourOverWill') continue;

    const text = htmlToText(doc.content);
    const masked = maskNestedTrusts(text);

    for (const rx of EXISTING_TRUST_PHRASES) {
      const m = masked.match(rx);
      if (!m || m.index === undefined) continue;

      findings.push({
        docType: doc.docType,
        title: doc.title,
        location: locateSection(text, m.index),
        severity: 'high',
        reason: 'missing-instrument',
        summary: 'Refers to a trust, but no trust document exists in this package',
        detail:
          `This document refers to the client's trust as an existing instrument ` +
          `("${m[0].trim()}"), but no trust, certification of trust, or trust amendment was ` +
          `generated for this matter. Either the wrong boilerplate was selected for a ` +
          `wills-only package, or a trust document is missing from it. As drafted, the ` +
          `client would be acknowledging obligations — typically funding — with respect to ` +
          `an instrument they do not have.`,
      });
      break; // one report per document; the fix is the same for all hits
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 4 — cover letter enclosure list vs. what was generated
// ---------------------------------------------------------------------------

/**
 * The cover letter enumerates what is enclosed. If it names a document the
 * package does not contain, the client will go looking for something that isn't
 * there. Again invisible to a per-document review: the letter is internally
 * fine, it just disagrees with its own package.
 */
function checkEnclosureMismatch(docs: PackageDoc[]): PackageFinding[] {
  const letter = docs.find((d) => d.docType === 'coverLetter');
  if (!letter) return [];

  const present = new Set(docs.map((d) => d.docType));
  const text = htmlToText(letter.content);

  // Only inspect the enclosure list itself — the prose after it describes what
  // each document does and would otherwise re-trigger every pattern.
  const listStart = text.search(/\b(include|enclosed|enclosing|following documents|as follows)\b/i);
  const scope = listStart === -1 ? text : text.slice(listStart, listStart + 1200);

  const findings: PackageFinding[] = [];
  const reported = new Set<string>();

  for (const { pattern, satisfiedBy, label } of ENCLOSURE_PATTERNS) {
    const m = scope.match(pattern);
    if (!m) continue;
    if (satisfiedBy.some((t) => present.has(t))) continue;
    if (reported.has(label)) continue;
    reported.add(label);

    findings.push({
      docType: letter.docType,
      title: letter.title,
      location: 'Enclosure List',
      severity: 'medium',
      reason: 'enclosure-mismatch',
      summary: `Cover letter lists "${label}", which is not in this package`,
      detail:
        `The cover letter tells the client the package encloses a ${label}, but no such ` +
        `document was generated for this matter. Either add the document to the package or ` +
        `remove it from the enclosure list — a client who cannot find a document the letter ` +
        `promises will assume the delivery is incomplete.`,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 5 — NJ UTMA custodianship age ceiling
// ---------------------------------------------------------------------------

/**
 * New Jersey's Uniform Transfers to Minors Act (N.J.S.A. 46:38A-1 et seq.) does
 * not permit custodial property to be held past 21. A provision directing a
 * custodianship "until the beneficiary reaches 25" is unenforceable on its face,
 * and it is an easy defect to miss because the sentence reads perfectly well.
 *
 * The age is matched only within a short window after the UTMA reference, so an
 * unrelated age elsewhere in the document cannot trigger this.
 */
const UTMA_REFERENCE = /uniform transfers to minors|transfers?[- ]to[- ]minors/gi;
const AGE_AFTER_UTMA =
  /\b(?:reaches|attains|turns|until|age of|age)\s+(?:the\s+age\s+of\s+)?(\d{2})\b/i;
const NJ_UTMA_MAX_AGE = 21;

function checkUtmaAgeCap(doc: PackageDoc, text: string): PackageFinding[] {
  const findings: PackageFinding[] = [];
  const reportedAges = new Set<number>();

  let m: RegExpExecArray | null;
  UTMA_REFERENCE.lastIndex = 0;
  while ((m = UTMA_REFERENCE.exec(text)) !== null) {
    // Look only just past the statutory reference — far enough to clear the
    // citation, short enough not to reach an unrelated sentence.
    const window = text.slice(m.index, m.index + 400);
    const ageMatch = window.match(AGE_AFTER_UTMA);
    if (!ageMatch) continue;

    const age = Number(ageMatch[1]);
    if (!Number.isFinite(age) || age <= NJ_UTMA_MAX_AGE) continue;
    if (reportedAges.has(age)) continue;
    reportedAges.add(age);

    findings.push({
      docType: doc.docType,
      title: doc.title,
      location: locateSection(text, m.index),
      severity: 'medium',
      reason: 'statutory-limit',
      summary: `UTMA custodianship directed to age ${age}; NJ caps it at ${NJ_UTMA_MAX_AGE}`,
      detail:
        `This provision directs that custodial property be held under the New Jersey ` +
        `Uniform Transfers to Minors Act until age ${age}. New Jersey's UTMA ` +
        `(N.J.S.A. 46:38A-1 et seq.) requires custodial property to be transferred to the ` +
        `beneficiary no later than 21, so a custodianship cannot be extended to ${age} and ` +
        `the term is unenforceable as drafted. Reduce the age to ${NJ_UTMA_MAX_AGE}, or use a ` +
        `trust to hold the share for the years between ${NJ_UTMA_MAX_AGE} and ${age}.`,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 6 — administration provisions with nothing to administer
// ---------------------------------------------------------------------------

/**
 * A will can carry pages of Special Needs Trust administration provisions while
 * every dispositive clause distributes outright — in which case the SNT article
 * has no operative effect, because nothing ever creates the trust it governs.
 *
 * Phrased as "verify" rather than "fix": the creation language is drafted many
 * different ways, and a novel phrasing this check does not recognise would
 * otherwise produce a confident, wrong finding. Medium severity for the same
 * reason.
 */
const SNT_ADMINISTRATION =
  /(administration of (any |the )?special needs trust|special needs trust created under this (instrument|will|trust))/i;

const SNT_CREATION: ReadonlyArray<RegExp> = [
  /(shall|will|is to|are to)\s+(be\s+)?(held|retained|administered|distributed|set aside)[^.]{0,80}\bin\s+(a|one or more|the)\s+special needs trust/i,
  /(establish|create|fund)\w*\s+(a|one or more|the)\s+special needs trust/i,
  /share\s+(of|for)[^.]{0,80}shall\s+be\s+held[^.]{0,60}special needs/i,
  /distribut\w+\s+(to|into)\s+(a|the)\s+special needs trust/i,
];

function checkInoperativeSnt(doc: PackageDoc, text: string): PackageFinding[] {
  const admin = text.match(SNT_ADMINISTRATION);
  if (!admin || admin.index === undefined) return [];
  if (SNT_CREATION.some((rx) => rx.test(text))) return [];

  return [
    {
      docType: doc.docType,
      title: doc.title,
      location: locateSection(text, admin.index),
      severity: 'medium',
      reason: 'inoperative-provision',
      summary: 'Special Needs Trust provisions appear to have no operative effect',
      detail:
        `This document sets out detailed administration provisions for a Special Needs Trust, ` +
        `but no dispositive clause appears to direct that any beneficiary's share be held in ` +
        `one — the distribution provisions appear to pass property outright. Without a ` +
        `triggering provision, the Special Needs Trust article has no operative effect. ` +
        `Verify whether a beneficiary was intended to take in trust, and if so add the ` +
        `provision that creates it.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<PackageFindingSeverity, number> = { high: 0, medium: 1, low: 2 };

/**
 * Run every check over a generated package.
 *
 * Documents with status 'error' are skipped — their content is an error message,
 * not a draft, and reviewing it produces noise on top of an already-visible
 * failure.
 *
 * Findings come back sorted most-urgent-first, then grouped by document, so the
 * caller can render the list without further processing.
 */
export function reviewPackage(docs: PackageDoc[]): PackageFinding[] {
  const reviewable = docs.filter((d) => d.status !== 'error' && (d.content ?? '').trim().length > 0);
  if (reviewable.length === 0) return [];

  const findings: PackageFinding[] = [];

  // Package-level checks — these need the whole set.
  findings.push(...checkMissingInstrument(reviewable));
  findings.push(...checkEnclosureMismatch(reviewable));

  // Per-document checks.
  for (const doc of reviewable) {
    const text = htmlToText(doc.content);
    findings.push(...checkUnresolvedTokens(doc, text));
    findings.push(...checkUnfilledBlanks(doc, text));
    findings.push(...checkUtmaAgeCap(doc, text));
    findings.push(...checkInoperativeSnt(doc, text));
  }

  return findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.docType.localeCompare(b.docType) ||
      a.reason.localeCompare(b.reason),
  );
}

/** Counts by severity, for a badge on the package. */
export function summarizeFindings(findings: PackageFinding[]): {
  total: number;
  high: number;
  medium: number;
  low: number;
} {
  return {
    total: findings.length,
    high: findings.filter((f) => f.severity === 'high').length,
    medium: findings.filter((f) => f.severity === 'medium').length,
    low: findings.filter((f) => f.severity === 'low').length,
  };
}

function truncate(s: string, n: number): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length <= n ? clean : `${clean.slice(0, n - 1)}…`;
}
