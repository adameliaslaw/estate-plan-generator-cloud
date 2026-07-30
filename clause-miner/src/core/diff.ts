/**
 * §4.3 Ring 1 — deterministic token diff between two sigTexts, the filter
 * between MinHash candidates and sonnet adjudication.
 *
 * Classification (§4.3):
 * - 'trivial': the diff is confined to placeholders, punctuation, case, or
 *   whitespace → auto-merge (mechanically exact after folding).
 * - 'content': any content-word difference → sonnet adjudication.
 *   THERE IS NO AUTO-MERGE BAND for content diffs.
 *
 * The legal-delta lexicon hard-routes to adjudication regardless of scores:
 * textual closeness is anti-correlated with legal-difference salience in
 * form documents ("per stirpes" vs "per capita" is a ~0.99 edit ratio).
 *
 * Pure module: strings in, classification out.
 */

/**
 * §4.3 legal-delta lexicon. A GROWING artifact: every adjudication where
 * sonnet answers SEPARATE at high similarity seeds new entries (the stage
 * appends to the run ledger's lexiconVersion, not to this seed constant).
 *
 * Single words are matched against the changed tokens themselves; multi-word
 * phrases are matched against a small context window around each change
 * hunk (so "per stirpes" vs "per capita" routes even though only
 * "stirpes"/"capita" differ).
 */
export const LEGAL_DELTA_LEXICON: readonly string[] = [
  // distribution-scheme opposites
  'per stirpes',
  'per capita',
  'at each generation',
  // modal force
  'shall',
  'may',
  // negation / waiver
  'not',
  'no',
  'without',
  'waive',
  'waived',
  'waiver',
  // income vs principal
  'income',
  'principal',
  // distribution standards
  'health, education, maintenance and support',
  'health education maintenance',
  'hems',
  'sole and absolute discretion',
  'absolute discretion',
  // revocability
  'revocable',
  'irrevocable',
  // form of disposition
  'outright',
  'in trust',
  // fiduciary bond
  'bond',
  // lapse / vesting
  'lapse',
  'vest',
  'vested',
  // marital / tax structures
  'qtip',
  'disclaimer',
  'disclaim',
  'credit shelter',
  'credit-shelter',
  // POA effectiveness
  'springing',
  'immediate',
  'immediately',
] as const;

export type DiffOpType = 'equal' | 'delete' | 'insert';

export interface DiffOp {
  type: DiffOpType;
  tokens: string[];
}

export type DiffClassification = 'trivial' | 'content';

export interface DiffResult {
  classification: DiffClassification;
  /** True when a legal-delta lexicon term appears in the diff region (§4.3). */
  hardRoute: boolean;
  ops: DiffOp[];
  /** Genuinely changed tokens (after case/punct-equal pair cancellation). */
  changedA: string[];
  changedB: string[];
}

function tokenize(text: string): string[] {
  return text.split(/\s+/).filter((t) => t.length > 0);
}

/** Fold a token for equivalence testing: lowercase, strip punctuation. */
function foldToken(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9#{}_]/g, '');
}

const PLACEHOLDER_TOKEN_RE = /^\{\{[a-zA-Z0-9_:.]+\}\}$/;
const PUNCT_ONLY_RE = /^[^a-zA-Z0-9]*$/;

function isTrivialToken(token: string): boolean {
  return PLACEHOLDER_TOKEN_RE.test(token) || PUNCT_ONLY_RE.test(token);
}

/** LCS-based token diff — deterministic, O(n·m); clause texts are small. */
export function tokenDiff(aText: string, bText: string): DiffOp[] {
  const a = tokenize(aText);
  const b = tokenize(bText);
  const n = a.length;
  const m = b.length;

  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  const push = (type: DiffOpType, token: string): void => {
    const last = ops[ops.length - 1];
    if (last !== undefined && last.type === type) {
      last.tokens.push(token);
    } else {
      ops.push({ type, tokens: [token] });
    }
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('equal', a[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push('delete', a[i]);
      i++;
    } else {
      push('insert', b[j]);
      j++;
    }
  }
  while (i < n) push('delete', a[i++]);
  while (j < m) push('insert', b[j++]);
  return ops;
}

/**
 * Cancel deleted/inserted token pairs that are equal after case/punctuation
 * folding — those are 'case/whitespace/punct' differences, not content.
 * Returns the genuinely changed tokens on each side.
 */
function cancelFoldedPairs(
  deleted: string[],
  inserted: string[],
): { changedA: string[]; changedB: string[] } {
  const insFolded = new Map<string, number>();
  for (const tok of inserted) {
    const f = foldToken(tok);
    insFolded.set(f, (insFolded.get(f) ?? 0) + 1);
  }
  const changedA: string[] = [];
  for (const tok of deleted) {
    const f = foldToken(tok);
    const count = insFolded.get(f) ?? 0;
    if (count > 0) {
      insFolded.set(f, count - 1);
    } else {
      changedA.push(tok);
    }
  }
  const delFolded = new Map<string, number>();
  for (const tok of deleted) {
    const f = foldToken(tok);
    delFolded.set(f, (delFolded.get(f) ?? 0) + 1);
  }
  const changedB: string[] = [];
  for (const tok of inserted) {
    const f = foldToken(tok);
    const count = delFolded.get(f) ?? 0;
    if (count > 0) {
      delFolded.set(f, count - 1);
    } else {
      changedB.push(tok);
    }
  }
  return { changedA, changedB };
}

/** Context tokens included around each hunk for phrase-term matching. */
const HUNK_CONTEXT_TOKENS = 3;

interface Hunk {
  aWindow: string;
  bWindow: string;
}

/** Contiguous change hunks with ±3 equal tokens of context on each side. */
function changeHunks(ops: DiffOp[]): Hunk[] {
  const hunks: Hunk[] = [];
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].type === 'equal') continue;
    // Extend over the contiguous run of non-equal ops.
    let end = k;
    while (end + 1 < ops.length && ops[end + 1].type !== 'equal') end++;

    const before =
      k > 0 && ops[k - 1].type === 'equal'
        ? ops[k - 1].tokens.slice(-HUNK_CONTEXT_TOKENS)
        : [];
    const after =
      end + 1 < ops.length && ops[end + 1].type === 'equal'
        ? ops[end + 1].tokens.slice(0, HUNK_CONTEXT_TOKENS)
        : [];

    const aMid: string[] = [];
    const bMid: string[] = [];
    for (let x = k; x <= end; x++) {
      if (ops[x].type === 'delete') aMid.push(...ops[x].tokens);
      if (ops[x].type === 'insert') bMid.push(...ops[x].tokens);
    }
    hunks.push({
      aWindow: [...before, ...aMid, ...after].join(' '),
      bWindow: [...before, ...bMid, ...after].join(' '),
    });
    k = end;
  }
  return hunks;
}

/** Fold free text the same way tokens are folded, keeping spaces. */
function foldText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9#{}_\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function termMatches(term: string, foldedText: string): boolean {
  const folded = foldText(term);
  if (folded.length === 0) return false;
  const re = new RegExp(`\\b${folded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  return re.test(foldedText);
}

/**
 * Classify a candidate pair (§4.3): 'trivial' auto-merges; 'content'
 * requires sonnet adjudication. `hardRoute` is reported independently.
 */
export function classifyDiff(aText: string, bText: string): DiffResult {
  const ops = tokenDiff(aText, bText);
  const deleted: string[] = [];
  const inserted: string[] = [];
  for (const op of ops) {
    if (op.type === 'delete') deleted.push(...op.tokens);
    if (op.type === 'insert') inserted.push(...op.tokens);
  }
  const { changedA, changedB } = cancelFoldedPairs(deleted, inserted);

  const classification: DiffClassification =
    changedA.every(isTrivialToken) && changedB.every(isTrivialToken)
      ? 'trivial'
      : 'content';

  return {
    classification,
    hardRoute: hardRoute(aText, bText),
    ops,
    changedA,
    changedB,
  };
}

/**
 * §4.3: true when any legal-delta lexicon term appears in the diff region,
 * regardless of classification — such pairs go to adjudication no matter
 * what similarity scores say.
 *
 * Single-word terms are tested against the genuinely changed tokens (so an
 * unchanged "shall" near a placeholder swap does not route); phrase terms
 * are tested against hunk windows with ±3 tokens of context (so
 * "per stirpes" vs "per capita" routes even though only one token differs).
 */
export function hardRoute(aText: string, bText: string): boolean {
  const ops = tokenDiff(aText, bText);
  const deleted: string[] = [];
  const inserted: string[] = [];
  for (const op of ops) {
    if (op.type === 'delete') deleted.push(...op.tokens);
    if (op.type === 'insert') inserted.push(...op.tokens);
  }
  const { changedA, changedB } = cancelFoldedPairs(deleted, inserted);
  if (changedA.length === 0 && changedB.length === 0) return false;

  const singleTerms = LEGAL_DELTA_LEXICON.filter((t) => !t.includes(' '));
  const phraseTerms = LEGAL_DELTA_LEXICON.filter((t) => t.includes(' '));

  const changedFolded = new Set(
    [...changedA, ...changedB].map(foldToken).filter((f) => f.length > 0),
  );
  for (const term of singleTerms) {
    if (changedFolded.has(foldToken(term))) return true;
  }

  const hunks = changeHunks(ops);
  for (const hunk of hunks) {
    const aFolded = foldText(hunk.aWindow);
    const bFolded = foldText(hunk.bWindow);
    for (const term of phraseTerms) {
      if (termMatches(term, aFolded) || termMatches(term, bFolded)) {
        return true;
      }
    }
  }
  return false;
}
