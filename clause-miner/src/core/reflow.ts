/**
 * §4.1 — reflow pre-pass for hard-wrapped (line-per-paragraph) legacy
 * conversions. WP-era documents frequently convert with one paragraph per
 * VISUAL line; without this pass the segmenter's ALL-CAPS/single-line
 * heuristics fire on ordinary fragments.
 *
 * Pure module: string[] in, string[] out.
 */

import { config } from '../config.js';
import {
  endsWithSentencePunct,
  isHeadingLine,
  isStandaloneHeading,
} from './segment.js';

export interface ReflowResult {
  paragraphs: string[];
  /** True when the hard-wrap heuristic fired and rejoining was applied. */
  reflowed: boolean;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Detect hard-wrap (§4.1): median paragraph length < 90 chars OR
 * sentence-final-punctuation rate < 40%.
 */
export function isHardWrapped(paragraphs: string[]): boolean {
  const nonEmpty = paragraphs.map((p) => p.trim()).filter((p) => p.length > 0);
  if (nonEmpty.length === 0) return false;
  const med = median(nonEmpty.map((p) => p.length));
  const punctRate =
    nonEmpty.filter((p) => endsWithSentencePunct(p)).length / nonEmpty.length;
  return (
    med < config.reflow.medianParaChars ||
    punctRate < config.reflow.sentencePunctRate
  );
}

/**
 * Reflow hard-wrapped paragraphs (§4.1): consecutive short paragraphs that
 * neither match the heading grammar nor end in sentence-final punctuation
 * are rejoined into logical paragraphs. Blank lines and indentation act as
 * separators. Standalone headings ("ARTICLE IV", ALL-CAPS titles) are kept
 * as their own paragraphs; a header that LEADS a paragraph ("FOURTH: All
 * the rest…") starts a new logical paragraph and its continuation lines
 * join onto it.
 *
 * Documents that do not trip the hard-wrap heuristic are returned unchanged
 * with `reflowed: false`.
 */
export function reflowParagraphs(paragraphs: string[]): ReflowResult {
  if (!isHardWrapped(paragraphs)) {
    return { paragraphs, reflowed: false };
  }

  const out: string[] = [];
  let buf = '';

  const flush = (): void => {
    if (buf.length > 0) {
      out.push(buf);
      buf = '';
    }
  };

  for (const para of paragraphs) {
    const t = para.trim();

    // Blank line = logical-paragraph separator (§4.1).
    if (t.length === 0) {
      flush();
      continue;
    }

    // Heading grammar only separates at a paragraph start. A non-empty buf
    // is always mid-sentence (completed lines flush immediately below), so
    // heading-shaped text there is a wrapped continuation — a cross-reference
    // ("…as provided in ⏎ Section 5.2 hereof"), an all-caps emphasis run, or
    // a bare decimal — and must join, not cut (2026-08-02, Adam's catch).
    if (buf.length === 0 && isHeadingLine(t)) {
      flush();
      if (isStandaloneHeading(t)) {
        out.push(t);
        continue;
      }
      // Header leading a paragraph ("FOURTH: All the rest…"): start a new
      // logical paragraph and let continuation lines join.
      buf = t;
      if (endsWithSentencePunct(t)) flush();
      continue;
    }

    // Indentation signals a new logical paragraph (§4.1).
    const indented = /^(\s{2,}|\t)/.test(para);
    if (indented && buf.length > 0) flush();

    buf = buf.length > 0 ? `${buf} ${t}` : t;
    if (endsWithSentencePunct(t)) flush();
  }
  flush();

  return { paragraphs: out, reflowed: true };
}
