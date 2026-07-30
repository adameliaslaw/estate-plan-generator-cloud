/**
 * §5.2 — Tier B fold: `normText` → `sigText` (hashing/clustering only,
 * never displayed).
 *
 * Fold steps: successor-chain collapse hook → ordinal role placeholders
 * flattened ({{CHILD_1}} → {{CHILD}}) → lowercase → gendered pronoun sets →
 * neutral tokens → number-words → `#` → punctuation/whitespace collapsed.
 * Typed value placeholders are already flattened to their kind by
 * normalize.ts ({{DURATION}} carries no value), so a 30-day and a 60-day
 * survivorship clause fold to the SAME sigText while the concrete values
 * live on as per-occurrence parameters (§4.3 Ring 0).
 *
 * Ring 0 identity = SHA-256 of sigText (§4.3).
 *
 * Pure module: strings in, strings out.
 */

import { createHash } from 'node:crypto';
import { NUM_WORD_SOURCE } from './number-words.js';

export interface SigTextOptions {
  /**
   * §4.2 successor-fiduciary chains: hook for the caller to collapse
   * "if X fails to serve, then Y; if Y fails, then Z" patterns to
   * {{SUCCESSOR_CHAIN}} + {{CHAIN_DEPTH}} before folding. Runs first.
   */
  chainCollapse?: (text: string) => string;
}

const NUMBER_PHRASE_RE = new RegExp(
  `\\b${NUM_WORD_SOURCE}(?:[-\\s]${NUM_WORD_SOURCE})*\\b`,
  'g',
);

/** Fold normText to sigText (§5.2). */
export function toSigText(normText: string, opts: SigTextOptions = {}): string {
  let t = normText;

  // Successor-chain collapse hook (§4.2), applied before any folding so the
  // caller sees the original placeholder structure.
  if (opts.chainCollapse !== undefined) {
    t = opts.chainCollapse(t);
  }

  // Ordinal role placeholders flattened: {{CHILD_1}} → {{CHILD}},
  // {{TRUSTEE_2}} → {{TRUSTEE}} (§5.2).
  t = t.replace(/\{\{([A-Z][A-Z_]*?)_\d+\}\}/g, '{{$1}}');

  // Lowercase.
  t = t.toLowerCase();

  // Gendered pronoun sets → neutral tokens (§5.2).
  t = t
    .replace(/\bhimself\b|\bherself\b/g, 'themself')
    .replace(/\bhe\b|\bshe\b/g, 'they')
    .replace(/\bhis\b|\bhers\b|\bher\b/g, 'their')
    .replace(/\bhim\b/g, 'them');

  // Number-words → # (a whole spelled phrase folds to one #): "twenty-five"
  // → "#", "one hundred twenty" → "#" (§5.2).
  t = t.replace(NUMBER_PHRASE_RE, '#');

  // Collapse punctuation/whitespace. Braces/underscores survive so
  // placeholders remain single tokens; '#' survives as the number token.
  t = t.replace(/[^a-z0-9#{}_\s]/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();

  return t;
}

/** §4.3 Ring 0 — EXACT identity: SHA-256 hex of sigText. */
export function ring0Hash(sigText: string): string {
  return createHash('sha256').update(sigText, 'utf8').digest('hex');
}
