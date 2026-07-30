/**
 * Clause-library segmenter (§11 P1a) — for Adam's CURATED seed files
 * (AAA WILL PIECES, Trust Agreements), NOT for client instruments.
 *
 * The design of record is explicit that these need their own segmenter:
 * "curated files are structurally unlike instruments and the instrument
 * segmenter would pollute the gold set". A clause library is a pile of
 * alternative paragraphs — often several drafting options for the SAME
 * provision, interleaved with the author's own commentary. Running the
 * ARTICLE/SECTION grammar over that yields one giant block (there are no
 * article headings) or splits on the first ALL-CAPS option label.
 *
 * So the cues here are the ones a library actually uses:
 *   - explicit separator rules ("_____", "-----", "* * *", "=====")
 *   - blank-line gaps of two or more lines
 *   - option labels ("OPTION 1", "ALTERNATIVE B", "[A]")
 *
 * Commentary (drafting notes: "NOTE:", "Use this when…", bracketed asides)
 * must not enter the gold set as if it were operative text. Obvious markers
 * are caught deterministically here; the residue is classified by haiku in
 * the seed stage (§11 P1a) — the same two-tier shape the instrument
 * segmenter uses for its boundary fallback.
 */

/** A separator RULE — a line that is only rule characters, ≥ 3 of them. */
export const SEPARATOR_RE = /^\s*([_\-*=~•·]|\s)*\s*$/;

/** Option/alternative labels a clause library uses to head each choice. */
export const OPTION_LABEL_RE =
  /^\s*(?:\[?\s*(?:OPTION|ALTERNATIVE|ALT|VERSION|VARIANT|FORM|CHOICE)\s*[-–—:.]?\s*(?:[0-9]+|[A-Z]|[IVXLC]+)?\s*\]?|\[[A-Z0-9]{1,3}\])\s*[-–—:.)]?\s*$/i;

/** Deterministic commentary markers (the unambiguous ones). */
export const COMMENTARY_RE =
  /^\s*(?:\(?\s*(?:NOTE|NOTES|COMMENT|COMMENTS|DRAFTING\s+NOTE|PRACTICE\s+NOTE|CAUTION|WARNING|REMINDER|TIP|SEE\s+ALSO|CF)\b\s*[:.\-–—)]|\*\s*(?:NOTE|USE)\b|USE\s+TH(?:IS|E\s+FOLLOWING)\b|USE\s+(?:ONLY\s+)?(?:IF|WHEN)\b|INSERT\s+(?:IF|WHEN|ONLY)\b|OMIT\s+(?:IF|WHEN)\b|FOR\s+USE\s+(?:IF|WHEN|WITH)\b|IF\s+(?:THE\s+)?CLIENT\b)/i;

export function isSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false; // blank, not a rule
  if (!SEPARATOR_RE.test(trimmed)) return false;
  // Require real rule characters, so a line of stray spaces is not a rule.
  return trimmed.replace(/\s/g, '').length >= 3;
}

export function isOptionLabel(line: string): boolean {
  return OPTION_LABEL_RE.test(line.trim());
}

/**
 * Deterministic commentary detection. Deliberately narrow: a false positive
 * DELETES a real clause from the gold set (weakening every gate silently),
 * while a false negative merely leaves a piece for the haiku pass to catch.
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

export interface SeedPieceDraft {
  pieceIndex: number;
  /** Operative lines only — commentary removed. */
  paragraphs: string[];
  /** Lines dropped as commentary (kept for the calibration packet). */
  commentary: string[];
  /** Which cue closed the previous piece — recorded for calibration review. */
  separatorSignal: 'rule' | 'blank-gap' | 'option-label' | 'start';
  /** Heading-ish first line, when the piece opens with one. */
  title: string | null;
}

/** Blank-line runs of this length or more separate two library pieces. */
const BLANK_GAP = 2;

/** A piece shorter than this (after commentary removal) is not a clause. */
const MIN_PIECE_CHARS = 40;

function titleOf(paragraphs: readonly string[]): string | null {
  const first = paragraphs[0]?.trim() ?? '';
  if (first.length === 0 || first.length > 90) return null;
  // A heading does not end in sentence punctuation and is short.
  if (/[.;,]$/.test(first)) return null;
  const isCapsish = first === first.toUpperCase() && /[A-Z]/.test(first);
  return isCapsish || /^[A-Z][A-Za-z ,'()-]*$/.test(first) ? first : null;
}

/**
 * Segment a curated clause-library file into candidate pieces.
 *
 * `paragraphs` are the converted document's paragraphs in order (the same
 * array the instrument path uses), so a library that converted to one
 * paragraph per visual line still segments — blank gaps survive conversion
 * as empty paragraphs.
 */
export function segmentClauseLibrary(paragraphs: readonly string[]): SeedPieceDraft[] {
  const pieces: SeedPieceDraft[] = [];
  let current: string[] = [];
  let commentary: string[] = [];
  let signal: SeedPieceDraft['separatorSignal'] = 'start';
  let pendingSignal: SeedPieceDraft['separatorSignal'] | null = null;
  let blankRun = 0;

  const flush = (nextSignal: SeedPieceDraft['separatorSignal']): void => {
    const operative = current.filter((l) => l.trim().length > 0);
    if (operative.join(' ').trim().length >= MIN_PIECE_CHARS) {
      pieces.push({
        pieceIndex: pieces.length,
        paragraphs: operative,
        commentary: [...commentary],
        separatorSignal: signal,
        title: titleOf(operative),
      });
    }
    current = [];
    commentary = [];
    signal = nextSignal;
  };

  for (const line of paragraphs) {
    if (line.trim().length === 0) {
      blankRun++;
      if (blankRun >= BLANK_GAP && current.length > 0) pendingSignal = 'blank-gap';
      continue;
    }

    if (isSeparatorLine(line)) {
      blankRun = 0;
      if (current.length > 0) flush('rule');
      else signal = 'rule';
      pendingSignal = null;
      continue;
    }

    if (isOptionLabel(line)) {
      blankRun = 0;
      if (current.length > 0) flush('option-label');
      else signal = 'option-label';
      pendingSignal = null;
      // The label itself is not operative text — it names the choice.
      continue;
    }

    if (pendingSignal !== null) {
      flush(pendingSignal);
      pendingSignal = null;
    }
    blankRun = 0;

    if (isCommentaryLine(line)) commentary.push(line);
    else current.push(line);
  }
  flush('start');

  return pieces;
}
