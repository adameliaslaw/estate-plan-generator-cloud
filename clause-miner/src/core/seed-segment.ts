/**
 * Deterministic commentary detection for curated seed files (§11 P1a).
 *
 * This module once held a whole clause-LIBRARY segmenter (separator rules,
 * option labels, blank gaps). Retired 2026-08-02 by Adam's decision: the
 * "library" turned out to be a mixed forms archive, and EVERY seed file now
 * goes through the same instrument segmentation as the corpus (see
 * stages/seed.ts). What survives here is the commentary line filter — a
 * drafting note must not enter the gold set as if it were operative text.
 */

/** Deterministic commentary markers (the unambiguous ones). */
export const COMMENTARY_RE =
  /^\s*(?:\(?\s*(?:NOTE|NOTES|COMMENT|COMMENTS|DRAFTING\s+NOTE|PRACTICE\s+NOTE|CAUTION|WARNING|REMINDER|TIP|SEE\s+ALSO|CF)\b\s*[:.\-–—)]|\*\s*(?:NOTE|USE)\b|USE\s+TH(?:IS|E\s+FOLLOWING)\b|USE\s+(?:ONLY\s+)?(?:IF|WHEN)\b|INSERT\s+(?:IF|WHEN|ONLY)\b|OMIT\s+(?:IF|WHEN)\b|FOR\s+USE\s+(?:IF|WHEN|WITH)\b|IF\s+(?:THE\s+)?CLIENT\b)/i;

/**
 * Deterministic commentary detection. Deliberately narrow: a false positive
 * DELETES a real clause line from the gold set (weakening every gate
 * silently), while a false negative merely leaves text for the haiku piece
 * classifier to catch.
 */
export function isCommentaryLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (COMMENTARY_RE.test(trimmed)) return true;
  // A whole line wrapped in square brackets is an aside, not operative text.
  // (A bracketed FILL-IN like "[NAME]" is short and sits inside a sentence;
  // this only fires on a standalone line long enough to be prose.)
  return /^\[[^\]]{12,}\]$/.test(trimmed);
}
