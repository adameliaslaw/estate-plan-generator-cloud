/**
 * §4.2 — provision-block segmentation, TEXT-GRAMMAR layer (signal 3 of the
 * signal hierarchy) plus a hook for style/numbering boundaries (signals 1–2)
 * passed in by the caller as boundary hints.
 *
 * Pure module: paragraphs (string[]) in, provision blocks out. The OOXML
 * walking that produces style/numbering hints lives in the (stubbed)
 * conversion/segmentation stage, not here.
 */

import { config } from '../config.js';

/** Ordinal-word article headers ("FIRST:", … "TWENTIETH:"), §4.2 signal 3. */
export const ORDINAL_WORDS = [
  'FIRST',
  'SECOND',
  'THIRD',
  'FOURTH',
  'FIFTH',
  'SIXTH',
  'SEVENTH',
  'EIGHTH',
  'NINTH',
  'TENTH',
  'ELEVENTH',
  'TWELFTH',
  'THIRTEENTH',
  'FOURTEENTH',
  'FIFTEENTH',
  'SIXTEENTH',
  'SEVENTEENTH',
  'EIGHTEENTH',
  'NINETEENTH',
  'TWENTIETH',
  'TWENTY-FIRST',
  'TWENTY-SECOND',
  'TWENTY-THIRD',
  'TWENTY-FOURTH',
  'TWENTY-FIFTH',
] as const;

// Longest-first so TWENTY-FIRST wins over TWENTY... (no prefix issue since
// TWENTY itself is absent, but keep the ordering discipline anyway).
const ORDINAL_ALT = [...ORDINAL_WORDS]
  .sort((a, b) => b.length - a.length)
  .join('|');

/** `ARTICLE IV` / `ARTICLE 4` (§4.2 signal 3). */
export const ARTICLE_RE = /^ARTICLE\s+([IVXLC]+|\d+)\b/i;

/**
 * Ordinal-word header, with colon (any case: "FIRST:", "First:") or without
 * (all-caps only — "FIRST I give…" — to avoid firing on prose like
 * "First, I want…", which is not a header).
 */
const ORDINAL_COLON_RE = new RegExp(`^(${ORDINAL_ALT})\\s*:`, 'i');
const ORDINAL_CAPS_RE = new RegExp(`^(${ORDINAL_ALT})(\\s|$)`);

/** `Section 5.2` / `Paragraph 7` (§4.2 signal 3). */
export const SECTION_RE = /^(Section|Paragraph)\s+\d+(\.\d+)?\b/i;

/** Bare decimal numbering: `5.2 Trust Property…` (§4.2 signal 3). */
export const DECIMAL_RE = /^\d+\.\d+\s/;

/** ALL-CAPS heading line, ≤ 70 chars (§4.2 signal 3). */
export function isAllCapsHeading(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > config.segmentation.capsHeadingMaxChars) {
    return false;
  }
  return /[A-Z]/.test(t) && !/[a-z]/.test(t);
}

/** Article-level text-grammar boundary. */
export function isArticleBoundary(line: string): boolean {
  const t = line.trim();
  return (
    ARTICLE_RE.test(t) || ORDINAL_COLON_RE.test(t) || ORDINAL_CAPS_RE.test(t)
  );
}

/** Section-level text-grammar boundary. */
export function isSectionBoundary(line: string): boolean {
  const t = line.trim();
  return SECTION_RE.test(t) || DECIMAL_RE.test(t) || isAllCapsHeading(t);
}

/** Any text-grammar boundary — shared with the reflow pre-pass (§4.1). */
export function isHeadingLine(line: string): boolean {
  return isArticleBoundary(line) || isSectionBoundary(line);
}

/**
 * A heading that is ONLY a heading (no operative text on the same line):
 * stands alone as its own logical paragraph during reflow. Contrast
 * "FOURTH: All the rest, residue and remainder…" where the header leads the
 * paragraph and continuation lines must join onto it.
 */
export function isStandaloneHeading(line: string): boolean {
  const t = line.trim();
  if (isAllCapsHeading(t)) return true;
  if (/^ARTICLE\s+([IVXLC]+|\d+)\s*[.:]?\s*$/i.test(t)) return true;
  if (/^(Section|Paragraph)\s+\d+(\.\d+)?\s*[.:]?\s*$/i.test(t)) return true;
  if (new RegExp(`^(${ORDINAL_ALT})\\s*:?\\s*$`, 'i').test(t)) return true;
  return false;
}

/**
 * Style/numbering boundary hint supplied by the caller (§4.2 signals 1–2:
 * pStyle TR_/Heading matches, w:numPr numbering). Index refers to the
 * position in the `paragraphs` array passed to `segmentParagraphs`.
 */
export interface BoundaryHint {
  paragraphIndex: number;
  level: 'article' | 'section';
  /** Recorded as the block's structureSignal, e.g. 'style' | 'numbering'. */
  signal: string;
}

export interface ProvisionBlock {
  /** 0 = preamble before the first article boundary. */
  articleIndex: number;
  /** 0 = article heading / text before the first section boundary. */
  sectionIndex: number;
  paragraphs: string[];
  /** Which signal opened this block: hint signal, 'text-grammar', or 'none'. */
  structureSignal: string;
}

export type SegmentationFlag = 'needs-llm-fallback' | 'over-segmented';

export interface SegmentResult {
  blocks: ProvisionBlock[];
  boundaryCount: number;
  totalChars: number;
  flags: SegmentationFlag[];
}

/**
 * Segment plain paragraphs into provision blocks (§4.2).
 *
 * First sufficient signal wins per paragraph: a caller hint (style/numbering)
 * outranks text grammar, mirroring the §4.2 signal hierarchy.
 *
 * Two-sided anomaly gates (§4.2):
 * - under-segmentation: < 1 boundary / 4,000 chars → 'needs-llm-fallback'
 * - over-segmentation:  > 1 boundary / 300 chars  → 'over-segmented'
 */
export function segmentParagraphs(
  paragraphs: string[],
  boundaryHints: BoundaryHint[] = [],
): SegmentResult {
  const hintMap = new Map<number, BoundaryHint>();
  for (const h of boundaryHints) hintMap.set(h.paragraphIndex, h);

  const blocks: ProvisionBlock[] = [];
  let articleIndex = 0;
  let sectionIndex = 0;
  let current: ProvisionBlock | null = null;
  let boundaryCount = 0;
  let totalChars = 0;

  const openBlock = (signal: string, para: string): ProvisionBlock => {
    const block: ProvisionBlock = {
      articleIndex,
      sectionIndex,
      paragraphs: [para],
      structureSignal: signal,
    };
    blocks.push(block);
    return block;
  };

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const t = para.trim();
    if (t.length === 0) continue;
    totalChars += t.length;

    const hint = hintMap.get(i);
    const level: 'article' | 'section' | null =
      hint !== undefined
        ? hint.level
        : isArticleBoundary(t)
          ? 'article'
          : isSectionBoundary(t)
            ? 'section'
            : null;

    if (level === 'article') {
      articleIndex += 1;
      sectionIndex = 0;
      boundaryCount += 1;
      current = openBlock(hint?.signal ?? 'text-grammar', t);
    } else if (level === 'section') {
      sectionIndex += 1;
      boundaryCount += 1;
      current = openBlock(hint?.signal ?? 'text-grammar', t);
    } else if (current !== null) {
      current.paragraphs.push(t);
    } else {
      // Preamble text before any boundary.
      current = openBlock('none', t);
    }
  }

  const flags: SegmentationFlag[] = [];
  if (totalChars > 0) {
    if (boundaryCount < totalChars / config.segmentation.underSegCharsPerBoundary) {
      flags.push('needs-llm-fallback');
    }
    if (boundaryCount > totalChars / config.segmentation.overSegCharsPerBoundary) {
      flags.push('over-segmented');
    }
  }

  return { blocks, boundaryCount, totalChars, flags };
}
