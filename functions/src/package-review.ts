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
  | 'inoperative-provision'
  | 'name-collision'
  | 'suffix-dropped'
  | 'missing-apportionment'
  | 'toc-mismatch'
  | 'empty-substitution';

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

/**
 * Who a person is in the plan.
 *
 * The distinction that matters is IDENTITY vs. ROLE. `client`, `spouse`, and
 * `child` each denote a distinct human being, so two of them sharing a name is
 * evidence of a data error. `fiduciary` is a role *assignment* — the spouse is
 * routinely also the executor and the POA agent — so fiduciary entries are
 * duplicates of people already on the roster and must never be compared for
 * collisions.
 */
export type PersonRole = 'client' | 'spouse' | 'child' | 'fiduciary';

export interface PackagePerson {
  /** Full name as recorded, including any suffix, e.g. "Constantine Rios Jr." */
  name: string;
  role: PersonRole;
  /** Human-readable role for finding text, e.g. "child", "executor". */
  label?: string;
  /**
   * NJ transfer inheritance tax class, when the caller could determine it.
   * null means the relationship was not recognised — which is NOT the same as
   * Class D, and must never be treated as taxable by default.
   */
  njTaxClass?: 'A' | 'C' | 'D' | 'E' | null;
  /** True when this person actually takes under the plan. */
  isBeneficiary?: boolean;
}

/**
 * Structured facts about the plan, supplied by the caller.
 *
 * Deliberately not parsed out of the generated prose: the pipeline already
 * holds this as data, and regexing names out of legal text would invent
 * failures that the roster answers exactly.
 */
export interface PackageContext {
  people: PackagePerson[];
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
// Name handling
// ---------------------------------------------------------------------------

/**
 * Generational suffixes, lowercased and stripped of punctuation. "V" is
 * included but only ever matched as a whole trailing token, so a middle
 * initial cannot be mistaken for one.
 */
const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

/** Case- and punctuation-insensitive form for comparing two names. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split a normalized name into its base and any trailing generational suffix. */
export function splitSuffix(name: string): { base: string; suffix?: string } {
  const tokens = normalizeName(name).split(' ').filter(Boolean);
  if (tokens.length < 2) return { base: tokens.join(' ') };

  const last = tokens[tokens.length - 1];
  if (NAME_SUFFIXES.has(last)) {
    return { base: tokens.slice(0, -1).join(' '), suffix: last };
  }
  return { base: tokens.join(' ') };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The name minus its generational suffix, in the original casing.
 *
 * Findings are read by attorneys, so they must quote the name the way the
 * document spells it. The normalized form is for comparison only and must
 * never reach user-facing prose.
 */
function displayBase(name: string): string {
  const tokens = name.trim().split(/\s+/);
  if (tokens.length < 2) return name.trim();
  const last = tokens[tokens.length - 1].replace(/[.,]/g, '').toLowerCase();
  return NAME_SUFFIXES.has(last) ? tokens.slice(0, -1).join(' ') : name.trim();
}

/**
 * A name repeated throughout an instrument has no meaningful single location,
 * and pinning the finding to whichever heading happened to precede the first
 * hit (often the letterhead) reads as precision that isn't there.
 */
const PERVASIVE_THRESHOLD = 3;

/**
 * Matches a name in document text while tolerating the whitespace and
 * punctuation that rendering introduces, and refusing to match when a
 * generational suffix follows.
 *
 * The negative lookahead is what makes the suffix-drop check honest: without
 * it, "Constantine Rios Jr." would itself count as a suffix-dropped reference,
 * because the base name is a prefix of the full one.
 */
function buildBareNameRegex(base: string): RegExp {
  const pattern = escapeRegex(base).replace(/ /g, '[\\s.,]+');
  const suffixAlt = [...NAME_SUFFIXES].join('|');
  return new RegExp(`\\b${pattern}\\b(?![\\s,]*(?:${suffixAlt})\\b)`, 'gi');
}

/** People whose names denote distinct human beings — see PersonRole. */
const IDENTITY_ROLES: ReadonlySet<PersonRole> = new Set<PersonRole>(['client', 'spouse', 'child']);

function countMatches(text: string, rx: RegExp): number {
  rx.lastIndex = 0;
  let n = 0;
  while (rx.exec(text) !== null) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Check 7 — two different people share a name
// ---------------------------------------------------------------------------

/**
 * A beneficiary whose full name equals the testator's or a settlor's makes
 * every gift to that name ambiguous on the face of the instrument, and the
 * prose reads perfectly well either way — which is what makes it dangerous.
 *
 * Observed in a real generated trust: the settlor and his son were both
 * rendered "CONSTANTINE RIOS" because the son's "Jr." was never captured, so
 * "When CONSTANTINE RIOS reaches 40 years of age" sat in the dispositive
 * article alongside "CONSTANTINE RIOS" as settlor and trustee.
 *
 * Roster-level, so it fires on the underlying data error rather than on one
 * document's rendering of it — one collision, one finding, one fix.
 */
function checkNameCollision(docs: PackageDoc[], context: PackageContext): PackageFinding[] {
  const people = context.people.filter(
    (p) => IDENTITY_ROLES.has(p.role) && normalizeName(p.name).split(' ').filter(Boolean).length >= 2,
  );

  const findings: PackageFinding[] = [];
  const reported = new Set<string>();

  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i];
      const b = people[j];
      const key = normalizeName(a.name);
      if (key !== normalizeName(b.name)) continue;
      if (reported.has(key)) continue;
      reported.add(key);

      // Attribute the finding to the instrument where the ambiguous name
      // appears most often — that is the one a reviewer should open first.
      const rx = new RegExp(`\\b${escapeRegex(key).replace(/ /g, '[\\s.,]+')}\\b`, 'gi');
      let worst: { doc: PackageDoc; count: number } | null = null;
      let affected = 0;
      for (const doc of docs) {
        const count = countMatches(htmlToText(doc.content), rx);
        if (count === 0) continue;
        affected++;
        if (!worst || count > worst.count) worst = { doc, count };
      }
      if (!worst) continue;

      const roleA = a.label ?? a.role;
      const roleB = b.label ?? b.role;
      const worstText = htmlToText(worst.doc.content);
      rx.lastIndex = 0;
      const firstHit = rx.exec(worstText);
      findings.push({
        docType: worst.doc.docType,
        title: worst.doc.title,
        location:
          worst.count > PERVASIVE_THRESHOLD || !firstHit
            ? 'Throughout'
            : locateSection(worstText, firstHit.index),
        severity: 'high',
        reason: 'name-collision',
        summary: `"${a.name}" names both the ${roleA} and the ${roleB}`,
        detail:
          `Two different people in this plan are recorded under the identical name ` +
          `"${a.name}" — one as the ${roleA}, one as the ${roleB}. The name appears ` +
          `${worst.count} time${worst.count === 1 ? '' : 's'} in this document and in ` +
          `${affected} document${affected === 1 ? '' : 's'} overall, so every reference to it ` +
          `is ambiguous on the face of the instrument. If they are distinguished in life by a ` +
          `generational suffix, record it (for example "Jr.") and regenerate; otherwise add a ` +
          `middle name or other identifier so each gift names one person only.`,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 8 — a generational suffix was dropped in the generated text
// ---------------------------------------------------------------------------

/**
 * The roster is right but a document rendered the person without their suffix.
 * Distinct from a collision in the roster: the data is correct and the drafting
 * lost it, so the fix is in the template or the fill, not the intake.
 *
 * Severity turns on consequence. If dropping the suffix makes the reference
 * indistinguishable from another person in the plan, the gift is ambiguous and
 * it is high. If not, it is an identification inconsistency across documents —
 * worth correcting, not worth alarming over.
 */
function checkSuffixDropped(docs: PackageDoc[], context: PackageContext): PackageFinding[] {
  const findings: PackageFinding[] = [];

  const identityNames = context.people
    .filter((p) => IDENTITY_ROLES.has(p.role))
    .map((p) => ({ person: p, normalized: normalizeName(p.name) }));

  for (const person of context.people) {
    const { base, suffix } = splitSuffix(person.name);
    if (!suffix || base.split(' ').filter(Boolean).length < 2) continue;

    // Does the bare name belong to somebody else in the plan?
    const collidesWith = identityNames.find(
      (p) => p.normalized === base && normalizeName(p.person.name) !== normalizeName(person.name),
    );

    const rx = buildBareNameRegex(base);
    for (const doc of docs) {
      const text = htmlToText(doc.content);
      rx.lastIndex = 0;
      const first = rx.exec(text);
      if (!first) continue;
      const count = countMatches(text, rx) ;

      const otherRole = collidesWith ? (collidesWith.person.label ?? collidesWith.person.role) : null;
      const shown = displayBase(person.name);
      const times = `${count} time${count === 1 ? '' : 's'}`;
      findings.push({
        docType: doc.docType,
        title: doc.title,
        location: count > PERVASIVE_THRESHOLD ? 'Throughout' : locateSection(text, first.index),
        severity: collidesWith ? 'high' : 'low',
        reason: 'suffix-dropped',
        summary: collidesWith
          ? `"${person.name}" appears without their suffix, matching the ${otherRole}`
          : `"${person.name}" appears without their "${suffix.toUpperCase()}" suffix`,
        detail: collidesWith
          ? `This document refers to ${person.name} as "${shown}" — without the generational ` +
            `suffix — ${times}. Because "${shown}" is also the ${otherRole}'s full name, each of ` +
            `those references is ambiguous between two people, and the prose reads correctly ` +
            `either way. Restore the suffix everywhere this person is named.`
          : `This document refers to ${person.name} as "${shown}" — without the generational ` +
            `suffix — ${times}, while the name is recorded with it elsewhere in the plan. ` +
            `Inconsistent identification across instruments invites questions at probate or from ` +
            `a title company. Restore the suffix, or drop it consistently if it is not part of ` +
            `their legal name.`,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Check 9 — a taxable beneficiary with no apportionment direction
// ---------------------------------------------------------------------------

/**
 * New Jersey repealed its estate tax in 2018 but kept the transfer inheritance
 * tax, which is charged on the beneficiary's relationship to the decedent. A
 * sibling, niece, nephew, or friend pays 11–16% from the first dollar.
 *
 * Where an instrument is silent, N.J.S.A. 54:35-6 makes the fiduciary deduct
 * that tax from the beneficiary's own share — so a gift the client described as
 * "$100,000 to my niece" arrives as roughly $85,000, and nobody finds out until
 * administration.
 *
 * Fires only when the plan actually has a Class C or Class D taker. A plan that
 * leaves everything to a spouse and children has no inheritance tax to
 * apportion, and telling that client about apportionment is noise.
 */
const APPORTIONMENT_SIGNALS: ReadonlyArray<RegExp> = [
  /\bapportion\w*\b/i,
  /\b54:35-6\b/,
  /\b3B:24-1\b/,
  /\b(death|inheritance|estate|transfer)\s+tax(es)?\b[^.]{0,120}\b(paid|borne|charged|payable)\b/i,
  /\bfree of (all )?(death|inheritance|estate)\s+tax(es)?\b/i,
];

function checkMissingApportionment(
  docs: PackageDoc[],
  context: PackageContext,
): PackageFinding[] {
  const taxable = context.people.filter(
    (p) => p.isBeneficiary && (p.njTaxClass === 'C' || p.njTaxClass === 'D'),
  );
  if (taxable.length === 0) return [];

  // Only dispositive instruments can carry the direction.
  const dispositive = docs.filter((d) =>
    ['will', 'pourOverWill', 'trust', 'codicil', 'trustRestatement'].includes(d.docType),
  );
  if (dispositive.length === 0) return [];

  const covered = dispositive.filter((d) => {
    const text = htmlToText(d.content);
    return APPORTIONMENT_SIGNALS.some((rx) => rx.test(text));
  });
  if (covered.length === dispositive.length) return [];

  const target = dispositive.find((d) => !covered.includes(d))!;
  const who = taxable
    .slice(0, 3)
    .map((p) => `${p.name} (Class ${p.njTaxClass})`)
    .join(', ');
  const more = taxable.length > 3 ? ` and ${taxable.length - 3} other(s)` : '';

  return [
    {
      docType: target.docType,
      title: target.title,
      location: 'Payment of Debts and Expenses',
      severity: 'medium',
      reason: 'missing-apportionment',
      summary: 'Class C/D beneficiary with no death-tax apportionment direction',
      detail:
        `This plan benefits ${who}${more}, who are subject to the New Jersey transfer ` +
        `inheritance tax at 11–16% (N.J.S.A. 54:33-1 et seq.), but this document contains ` +
        `no direction as to who bears that tax. Where the instrument is silent, N.J.S.A. ` +
        `54:35-6 requires the fiduciary to deduct the tax from that beneficiary's own ` +
        `share before distributing, so the gift arrives reduced. Add an apportionment ` +
        `article stating whether these transfers pass free of tax from the residue or ` +
        `bear their own tax — the choice materially changes what each beneficiary receives.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Check 10 — a table of contents that promises sections the document lacks
// ---------------------------------------------------------------------------

/**
 * A generated instrument whose table of contents is a static master list of
 * every section the template *can* emit, rather than one built from the
 * sections it actually emitted.
 *
 * Observed in a real generated trust: the TOC listed a Marital Trust, Bypass
 * Trust, Disclaimer Trust, Survivor's Trust, Family Pot Trust, and Qualified
 * Domestic Trust. A full-text search of that document's body found ZERO
 * occurrences of any of them — not zero headings, zero mentions. A successor
 * trustee navigating by the contents page would conclude the marital and
 * bypass provisions had been omitted in error, or that pages were missing from
 * their copy.
 *
 * Matched on the body TEXT rather than on heading structure, because a section
 * can legitimately be rendered at a different heading level than the TOC
 * implies. Only a title that appears nowhere in the body at all is reported.
 */

/** A TOC line: leading section number, then the title. */
const TOC_LINE = /^\s*(\d+\.\d+)\s*([A-Z][^\n]{2,70}?)\s*(?:\.{2,}\s*\d+)?\s*$/;

/**
 * Strip the trailing debris a contents page carries — dot leaders, page
 * numbers, tab-stop and field artifacts — so the title compares against body
 * prose rather than against its own formatting.
 *
 * Without this the check reported EVERY entry as missing on both real trusts
 * (78 of 78), because their TOC lines end in a bracketed tab artifact the body
 * headings do not have. A check that flags everything is worse than no check.
 */
function normalizeTocTitle(raw: string): string {
  return raw
    .replace(/\[\s*\]/g, ' ')          // bracketed tab/field artifacts
    .replace(/\.{2,}\s*\d*\s*$/, ' ')  // dot leaders and page numbers
    .replace(/\s*\d+\s*$/, ' ')        // a bare trailing page number
    // \u00A0 written as an escape: a literal NBSP in source trips no-irregular-whitespace.
    .replace(/[\s\u00A0]+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Enough consecutive numbered lines to be a contents page rather than prose. */
const MIN_TOC_ENTRIES = 8;

function checkTocMismatch(doc: PackageDoc, text: string): PackageFinding[] {
  const lines = text.split('\n');

  // Locate the TOC: the longest run of numbered title lines near the top.
  const entries: Array<{ num: string; title: string; key: string; line: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(TOC_LINE);
    if (!m) continue;
    const key = normalizeTocTitle(m[2]);
    if (key.length < 4) continue;
    entries.push({ num: m[1], title: m[2].replace(/\[\s*\]/g, '').trim(), key, line: i });
  }
  if (entries.length < MIN_TOC_ENTRIES) return [];

  // Body is everything after the last TOC entry.
  const tocEnd = entries[entries.length - 1].line;
  const body = lines.slice(tocEnd + 1).join('\n');
  if (body.split(/\s+/).length < 200) return [];

  // Normalise the body the same way, so a heading rendered with its own tab or
  // page artifacts still matches the contents entry that points at it.
  const bodyKey = normalizeTocTitle(body.replace(/\n/g, ' '));
  const missing = entries.filter((e) => !bodyKey.includes(e.key)).map((e) => e.title);

  // A couple of near-misses are ordinary drift in how a heading was worded.
  // A contents page is only *wrong* when it systematically promises sections
  // that were never generated.
  if (missing.length < 3) return [];

  const shown = missing.slice(0, 6).join(', ');
  const more = missing.length > 6 ? `, and ${missing.length - 6} more` : '';

  return [
    {
      docType: doc.docType,
      title: doc.title,
      location: 'Table of Contents',
      severity: 'medium',
      reason: 'toc-mismatch',
      summary: `Table of contents lists ${missing.length} section(s) not present in the document`,
      detail:
        `The contents page for this document lists sections that do not appear anywhere in its ` +
        `body: ${shown}${more}. That is the signature of a table of contents assembled from a ` +
        `master list of every section the template can produce, rather than from the sections ` +
        `this document actually contains. A reader navigating by the contents page — a ` +
        `successor fiduciary, opposing counsel, a court — would reasonably conclude that ` +
        `provisions were omitted in error or that pages are missing. Regenerate the contents ` +
        `page from the delivered document.`,
    },
  ];
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
 * Bracketed notation that belongs in a signed instrument. Compared
 * case-insensitively against the inside of a single-bracket ALL-CAPS match.
 */
const EXECUTION_MARKERS: ReadonlySet<string> = new Set([
  'SEAL', 'L.S.', 'LS', 'NOTARY SEAL', 'CORPORATE SEAL', 'AFFIX SEAL',
]);

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
    // Single-bracket ALL-CAPS, e.g. [SIGNING CITY] or [SETTLOR NAME]. This is
    // the convention the mined clause corpus uses, so it reaches generated text
    // by a different route than Handlebars does. The lookarounds keep it from
    // re-reporting the inner half of a [[…]] token already caught above.
    //
    // Bounded to ALL-CAPS deliberately: bracketed lower- or mixed-case text is
    // ordinary legal prose — [sic], an alteration inside a quotation — and
    // flagging it would make the check noise.
    { rx: /(?<!\[)\[[A-Z][A-Z0-9 ._/-]{2,60}\](?!\])/g, what: 'an unfilled placeholder' },
    { rx: /\b(TODO|TBD|FIXME|XXX)\b/g, what: 'a drafting marker' },
  ];

  for (const { rx, what } of patterns) {
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      const token = m[0];
      if (seen.has(token)) continue;
      // [SEAL] and [L.S.] are execution-block notation, not placeholders — they
      // are SUPPOSED to survive into the signed instrument.
      if (EXECUTION_MARKERS.has(token.slice(1, -1).trim().toUpperCase())) continue;
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
// Check 2b — a substituted value that came out empty
// ---------------------------------------------------------------------------

/**
 * The other half of the blank problem, and the half an underscore scan cannot
 * see: the template resolved, the variable was empty, and the surrounding
 * punctuation closed over nothing. "in , New Jersey" — the municipality is
 * gone, and there is no underscore and no token left to find.
 *
 * Distinct from `checkUnfilledBlanks` (a blank was DRAWN and never filled) and
 * from `checkUnresolvedTokens` (the placeholder SURVIVED). Here the placeholder
 * resolved successfully to nothing at all, which is why neither of the others
 * fires on it.
 *
 * NOTE the deliberate difference from `checkUnfilledBlanks`: this check does
 * NOT skip execution blocks. A drawn blank in a signature line is correct and
 * must be ignored there, but a *collapsed* one is a defect wherever it lands —
 * an execution line reading "in , New Jersey" is exactly where this shows up.
 */
const EMPTY_SUBSTITUTION_PATTERNS: ReadonlyArray<{ rx: RegExp; what: string }> = [
  {
    // A preposition that governs a value, followed straight by the comma that
    // was meant to come after it.
    rx: /\b(?:in|of|at|on|to|for|from|by|between|with)\s+,/gi,
    what: 'a preposition followed immediately by a comma, with the value missing between them',
  },
  {
    // A list or address where one element rendered empty.
    rx: /,\s*,/g,
    what: 'two commas with nothing between them',
  },
];

function checkEmptySubstitution(doc: PackageDoc, text: string): PackageFinding[] {
  const findings: PackageFinding[] = [];
  const seen = new Set<string>();

  for (const { rx, what } of EMPTY_SUBSTITUTION_PATTERNS) {
    rx.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      // Report once per distinct surrounding phrase — a boilerplate line
      // repeated in six documents should not become six near-identical rows.
      const context = text
        .slice(Math.max(0, m.index - 40), m.index + m[0].length + 40)
        .replace(/\s+/g, ' ')
        .trim();
      if (seen.has(context)) continue;
      seen.add(context);

      findings.push({
        docType: doc.docType,
        title: doc.title,
        location: locateSection(text, m.index),
        severity: 'high',
        reason: 'empty-substitution',
        summary: 'A merge value rendered empty, leaving the punctuation around it stranded',
        detail:
          `The generated text reads "…${truncate(context, 120)}…", which contains ${what}. ` +
          `A value the template expected to substitute resolved to nothing, so this is a data ` +
          `gap rather than a rendering failure — the template worked and was handed an empty ` +
          `field. Supply the missing value and regenerate. Note this can appear inside an ` +
          `execution block, where it matters most and where a blank-line scan would not see it.`,
      });
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
export function reviewPackage(
  docs: PackageDoc[],
  context?: PackageContext,
): PackageFinding[] {
  const reviewable = docs.filter((d) => d.status !== 'error' && (d.content ?? '').trim().length > 0);
  if (reviewable.length === 0) return [];

  const findings: PackageFinding[] = [];

  // Package-level checks — these need the whole set.
  findings.push(...checkMissingInstrument(reviewable));
  findings.push(...checkEnclosureMismatch(reviewable));

  // Roster-driven checks. Skipped entirely without a roster: guessing at names
  // from the prose would manufacture findings the caller can already answer.
  if (context?.people?.length) {
    findings.push(...checkNameCollision(reviewable, context));
    findings.push(...checkSuffixDropped(reviewable, context));
    findings.push(...checkMissingApportionment(reviewable, context));
  }

  // Per-document checks.
  for (const doc of reviewable) {
    const text = htmlToText(doc.content);
    findings.push(...checkUnresolvedTokens(doc, text));
    findings.push(...checkUnfilledBlanks(doc, text));
    findings.push(...checkEmptySubstitution(doc, text));
    findings.push(...checkUtmaAgeCap(doc, text));
    findings.push(...checkInoperativeSnt(doc, text));
    findings.push(...checkTocMismatch(doc, text));
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
