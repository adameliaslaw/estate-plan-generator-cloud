/**
 * §5.1 — Tier A normalization: build `normText` (catalog display text) from
 * raw clause text plus the per-document gazetteer.
 *
 * Order of operations (each step justified in §5.1):
 *   1. Statute-citation allowlist protection (N.J.S.A., U.S.C., I.R.C.) —
 *      protected FIRST so "I.R.C. Section 2503" is never mistaken for an
 *      internal cross-reference and citation numbers survive untouched.
 *   2. SSN hard-redaction (never preserved, not even as a parameter).
 *   3. Internal cross-references → {{XREF:…}} (target preserved).
 *   4. Gazetteer role-typed name substitution (the document's own names).
 *   5. Child-placeholder run collapse → {{CHILDREN_LIST}} + CHILD_COUNT.
 *   6. Blank-token folding (____ blanks, JOHN DOE dummy names).
 *   7. Typed value placeholders (DATE, AMOUNT, PERCENT, AGE, DURATION,
 *      FRACTION with marital-deduction whitelist guard, COUNT, COUNTY/STATE).
 *
 * The concrete value of every typed placeholder is preserved per occurrence
 * in `parameters` — this is what makes Ring-0 merges of differing durations
 * legitimate parameterization instead of silent loss (§4.3 Ring 0). Names
 * and SSNs are NEVER recorded in parameters (PII-free by construction, §1).
 *
 * Pure module: strings in, strings out. No GCP, no network.
 */

import { NUMBERISH_SOURCE, SPELLED_NUM_SOURCE } from './number-words.js';
import { ORDINAL_WORDS } from './segment.js';

export interface GazetteerEntry {
  /**
   * Role-typed placeholder base from Stage-3 extraction: 'GRANTOR_NAME',
   * 'TRUSTEE_1', 'CHILD_2', 'SPOUSE_NAME', … Placeholder = `{{role}}`.
   */
  role: string;
  /** Surface names for this party ("JOHN DOE", "John A. Doe"). */
  names: string[];
}

export interface NormalizeResult {
  normText: string;
  /**
   * Observed concrete values per placeholder kind, in order of occurrence
   * (e.g. { DURATION: ['thirty (30) days'] }). Names/SSNs are never here.
   */
  parameters: Record<string, string[]>;
}

/* ------------------------------------------------------------------ */
/* Regexes                                                            */
/* ------------------------------------------------------------------ */

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;

/** §5.1(4): statute citations exempt from date/number substitution. */
const STATUTE_RES: readonly RegExp[] = [
  // N.J.S.A. 3B:3-2, N.J.S.A. 46:2B-8.1
  /\bN\.J\.S\.A\.?\s*§?\s*\d+[A-Za-z]?:[\dA-Za-z.-]+/g,
  // 26 U.S.C. § 2056(b)(7); 26 U.S.C. 2041
  /\b\d+\s+U\.S\.C\.(?:\s*§+\s*[\dA-Za-z().-]+)?/g,
  // I.R.C. § 2056; I.R.C. Section 2503(c)
  /\bI\.R\.C\.(?:\s*(?:§+|Section)\s*[\dA-Za-z().-]+)?/g,
];

const ORDINAL_ALT = [...ORDINAL_WORDS]
  .sort((a, b) => b.length - a.length)
  .join('|');

/** Internal cross-references: "Article FOURTH", "Section 5.2", "Paragraph 7". */
const XREF_RE = new RegExp(
  `\\b(Article|Section|Paragraph)\\s+([IVXLC]+\\b|\\d+(?:\\.\\d+)?|(?:${ORDINAL_ALT})\\b)`,
  'gi',
);

const MONTHS =
  '(?:January|February|March|April|May|June|July|August|September|October|November|December)';

const HONORIFIC_SOURCE = '(?:(?:Mr|Mrs|Ms|Dr)\\.\\s+)';

const DUMMY_NAMES_RE =
  /\b(?:JOHN\s+DOE|JANE\s+DOE|MARY\s+ROE|RICHARD\s+ROE|JOHN\s+SMITH|JANE\s+SMITH)(?:['’]s)?\b/gi;

const FRACTION_WORD_NUM = '(?:one|two|three|four|five|six|seven|eight|nine|ten)';
const FRACTION_WORD_DEN =
  '(?:half|halves|third|thirds|quarter|quarters|fourth|fourths|fifth|fifths|sixth|sixths|seventh|sevenths|eighth|eighths|ninth|ninths|tenth|tenths)';

/**
 * §5.1(2): marital-deduction formula whitelist — fraction substitution is
 * suppressed inside any sentence matching this (a formula clause's fractions
 * are operative text, not fill values).
 */
export const FRACTION_WHITELIST_RE =
  /marital\s+deduction|fractional\s+share\s+formula/i;

const COUNT_NOUNS =
  '(?:child(?:ren)?|grandchild(?:ren)?|beneficiar(?:y|ies)|trustees?|executors?|witness(?:es)?|descendants?|shares?|parcels?)';

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Sentence spans [start, end) around every whitelist-phrase match. */
function whitelistSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const re = new RegExp(FRACTION_WHITELIST_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let start = 0;
    for (let i = m.index - 1; i > 0; i--) {
      if (/[.;!?]/.test(text[i]) && /\s/.test(text[i + 1] ?? ' ')) {
        start = i + 1;
        break;
      }
    }
    let end = text.length;
    for (let i = m.index + m[0].length; i < text.length; i++) {
      if (/[.;!?]/.test(text[i])) {
        end = i + 1;
        break;
      }
    }
    spans.push([start, end]);
  }
  return spans;
}

function inSpans(offset: number, spans: Array<[number, number]>): boolean {
  return spans.some(([s, e]) => offset >= s && offset < e);
}

/* ------------------------------------------------------------------ */
/* Main                                                               */
/* ------------------------------------------------------------------ */

export function normalize(
  text: string,
  gazetteer: GazetteerEntry[] = [],
): NormalizeResult {
  const parameters: Record<string, string[]> = {};
  const addParam = (kind: string, value: string): void => {
    (parameters[kind] ??= []).push(value.trim());
  };

  // Sentinel protection: protected substrings are swapped for \u0000<n>\u0000
  // tokens (NUL never occurs in document text) so later passes cannot touch
  // them; all sentinels are restored in one pass at the end.
  const protectedSpans: string[] = [];
  const protect = (s: string): string => {
    protectedSpans.push(s);
    return `\u0000${protectedSpans.length - 1}\u0000`;
  };

  let t = text;

  // 1. Statute-citation allowlist (§5.1(4)): protect verbatim, before the
  //    XREF pass can see "Section 2503" inside "I.R.C. Section 2503(c)".
  for (const re of STATUTE_RES) {
    t = t.replace(re, (m) => protect(m));
  }

  // 2. SSN hard-redaction — value intentionally NOT preserved (§5.1(2)).
  t = t.replace(SSN_RE, () => '{{REDACTED_SSN}}');

  // 3. Internal cross-references → {{XREF:…}}, preserving the target
  //    (§5.1(4), §6.4). A heading at the START of a line is itself, not a
  //    cross-reference — only mid-text mentions become XREF tokens.
  t = t.replace(XREF_RE, (m, _kw: string, _target: string, offset: number) => {
    if (offset === 0 || t[offset - 1] === '\n') return m;
    addParam('XREF', m);
    return `{{XREF:${m}}}`;
  });

  // 4. Gazetteer role-typed substitution (§5.1(1)). Full names first
  //    (longest first), then unambiguous surname-only (with optional
  //    honorific). Possessives keep their suffix outside the placeholder.
  const fullNames: Array<{ name: string; role: string }> = [];
  const surnameRoles = new Map<string, Set<string>>();
  for (const entry of gazetteer) {
    for (const rawName of entry.names) {
      const name = rawName.trim();
      if (name.length === 0) continue;
      fullNames.push({ name, role: entry.role });
      const parts = name.split(/\s+/);
      if (parts.length > 1) {
        const surname = parts[parts.length - 1].toLowerCase();
        let roles = surnameRoles.get(surname);
        if (roles === undefined) {
          roles = new Set<string>();
          surnameRoles.set(surname, roles);
        }
        roles.add(entry.role);
      }
    }
  }
  fullNames.sort((a, b) => b.name.length - a.name.length);
  for (const { name, role } of fullNames) {
    const re = new RegExp(`\\b${escapeRe(name)}(['’]s)?\\b`, 'gi');
    t = t.replace(
      re,
      (_m, poss: string | undefined) =>
        `{{${role}}}${poss !== undefined ? "'s" : ''}`,
    );
  }
  for (const [surname, roles] of surnameRoles) {
    // Ambiguous surnames (shared across roles, e.g. a whole family named
    // DOE) are left for the corpus-wide roster sweep (§5.3 net 2).
    if (roles.size !== 1) continue;
    const role = [...roles][0];
    const re = new RegExp(
      `\\b${HONORIFIC_SOURCE}?${escapeRe(surname)}(['’]s)?\\b`,
      'gi',
    );
    t = t.replace(
      re,
      (_m, poss: string | undefined) =>
        `{{${role}}}${poss !== undefined ? "'s" : ''}`,
    );
  }

  // 5. Collapse runs of ≥ 2 child placeholders → {{CHILDREN_LIST}}, with the
  //    run length preserved as the CHILD_COUNT parameter (§5.1(1)).
  const childRunRe =
    /\{\{CHILD_\d+\}\}(?:(?:\s*,\s*(?:and\s+|or\s+)?|\s+and\s+|\s+or\s+)\{\{CHILD_\d+\}\})+/g;
  t = t.replace(childRunRe, (m) => {
    const n = (m.match(/\{\{CHILD_\d+\}\}/g) ?? []).length;
    addParam('CHILD_COUNT', String(n));
    return '{{CHILDREN_LIST}}';
  });

  // Protect every placeholder produced so far. Ordinal role placeholders
  // carry digits ({{TRUSTEE_2}}) that the numeric passes below must never
  // see, and {{XREF:Section 5.2}} carries a protected target.
  t = t.replace(/\{\{[^{}]+\}\}/g, (m) => protect(m));

  // 6. Blank-token folding (§5.1(3)).
  //    "____ day of ________, 20__" execution-date blanks → {{DATE}}.
  t = t.replace(
    /(?:the\s+)?_{2,}\s+day\s+of\s+_{2,}\s*,?\s*(?:\d{4}|(?:20|19)_{2,}|_{2,})?/gi,
    () => {
      addParam('DATE', '(blank)');
      return protect('{{DATE}}');
    },
  );
  //    Dummy names fold to a generic name placeholder (role unknown when the
  //    gazetteer did not claim them).
  t = t.replace(DUMMY_NAMES_RE, (m) =>
    protect(`{{NAME}}${/['’]s$/i.test(m) ? "'s" : ''}`),
  );
  //    Remaining blank runs.
  t = t.replace(/_{2,}/g, () => protect('{{BLANK}}'));

  // 7. Typed value placeholders (§5.1(2)) — each records its concrete value.
  const typed = (re: RegExp, kind: string): void => {
    t = t.replace(re, (m: string) => {
      addParam(kind, m);
      return protect(`{{${kind}}}`);
    });
  };

  // 7a. Dates.
  typed(new RegExp(`\\b${MONTHS}\\s+\\d{1,2},?\\s+\\d{4}\\b`, 'gi'), 'DATE');
  typed(
    new RegExp(
      `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+day\\s+of\\s+${MONTHS},?\\s*\\d{4}\\b`,
      'gi',
    ),
    'DATE',
  );
  typed(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, 'DATE');

  // 7b. Dollar amounts — spelled-with-parenthetical first, then bare figures.
  typed(
    new RegExp(
      `\\b(?:${SPELLED_NUM_SOURCE})\\s+[Dd]ollars?\\s*\\(\\$[\\d,]+(?:\\.\\d{2})?\\)`,
      'gi',
    ),
    'AMOUNT',
  );
  typed(/\$\s?[\d,]+(?:\.\d{2})?/g, 'AMOUNT');

  // 7c. Percentages.
  typed(
    new RegExp(
      `\\b(?:${SPELLED_NUM_SOURCE})\\s+percent\\s*(?:\\(\\s*\\d+(?:\\.\\d+)?\\s*%?\\s*\\))?`,
      'gi',
    ),
    'PERCENT',
  );
  typed(/\b\d+(?:\.\d+)?\s*(?:%|percent)/gi, 'PERCENT');

  // 7d. Ages, incl. spelled-out (§5.1(2)): "age twenty-five (25)", "attains
  //     the age of twenty-five (25) years", "twenty-one (21) years of age".
  {
    const re = new RegExp(`\\b(age\\s+(?:of\\s+)?)(${NUMBERISH_SOURCE})`, 'gi');
    t = t.replace(re, (_m, prefix: string, num: string) => {
      addParam('AGE', num);
      return `${prefix}${protect('{{AGE}}')}`;
    });
    const re2 = new RegExp(
      `\\b(${NUMBERISH_SOURCE})(\\s+years\\s+of\\s+age)`,
      'gi',
    );
    t = t.replace(re2, (_m, num: string, suffix: string) => {
      addParam('AGE', num);
      return `${protect('{{AGE}}')}${suffix}`;
    });
  }

  // 7e. Durations ("thirty (30) days", "6 months"). The whole phrase becomes
  //     {{DURATION}}; the concrete phrase (value + unit) is the parameter.
  typed(
    new RegExp(
      `\\b(?:${NUMBERISH_SOURCE})\\s+(?:days?|weeks?|months?|years?)\\b`,
      'gi',
    ),
    'DURATION',
  );

  // 7f. Fractions, guarded by the marital-deduction whitelist (§5.1(2)):
  //     never substitute inside a formula sentence.
  {
    const spans = whitelistSpans(t);
    const guardedReplace = (re: RegExp): void => {
      t = t.replace(re, (m: string, ...args: unknown[]) => {
        const offset = args[args.length - 2] as number;
        if (inSpans(offset, spans)) return m; // formula clause — never eaten
        addParam('FRACTION', m);
        return protect('{{FRACTION}}');
      });
    };
    guardedReplace(
      new RegExp(
        `\\b${FRACTION_WORD_NUM}[-\\s]${FRACTION_WORD_DEN}\\b(?:\\s*\\(\\s*\\d+\\s*/\\s*\\d+\\s*\\))?`,
        'gi',
      ),
    );
    guardedReplace(/\b\d+\s*\/\s*\d+\b/g);
  }

  // 7g. Counts ("three (3) children") — the number becomes {{COUNT}}, the
  //     noun stays (it is operative text).
  {
    const re = new RegExp(
      `\\b(${NUMBERISH_SOURCE})\\s+((?:equal\\s+)?${COUNT_NOUNS})\\b`,
      'gi',
    );
    t = t.replace(re, (_m, num: string, noun: string) => {
      addParam('COUNT', num);
      return `${protect('{{COUNT}}')} ${noun}`;
    });
  }

  // 7h. County / State of X (§5.1(2)).
  t = t.replace(
    /\b(County of)\s+([A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+)?)/g,
    (_m, kw: string, name: string) => {
      addParam('COUNTY', name);
      return `${kw} ${protect('{{COUNTY}}')}`;
    },
  );
  t = t.replace(
    /\b([A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+)?)\s+County\b/g,
    (_m, name: string) => {
      addParam('COUNTY', name);
      return `${protect('{{COUNTY}}')} County`;
    },
  );
  t = t.replace(
    /\b(State of)\s+([A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+)?)/g,
    (_m, kw: string, name: string) => {
      addParam('STATE', name);
      return `${kw} ${protect('{{STATE}}')}`;
    },
  );

  // Restore all protected spans.
  t = t.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => protectedSpans[Number(i)]);

  return { normText: t, parameters };
}
