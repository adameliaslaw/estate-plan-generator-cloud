/**
 * Minimal OOXML paragraph extraction (§3 Stage 1 / §4.2 signals 1–2).
 * Unzips word/document.xml with fflate (the one permitted unzip dep — NO
 * mammoth) and pulls, per paragraph: text, pStyle, numbering ilvl, table
 * membership (w:tbl walk — attestation blocks and schedules live in tables),
 * and bold/centered run signals (run properties survive conversion even when
 * styles don't, §4.2 signal 3).
 *
 * Pure module: Buffer in, paragraph records out.
 */

import { unzipSync } from 'fflate';

export interface OoxmlParagraph {
  text: string;
  styleId: string | null;
  /** w:numPr ilvl — 0 = article, 1 = section (§4.2 signal 2). */
  numIlvl: number | null;
  inTable: boolean;
  /** True when every text-bearing run in the paragraph is bold. */
  bold: boolean;
  centered: boolean;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Is this buffer a real OOXML wordprocessing document (§8 pass-through check)? */
export function isOoxmlDocx(buffer: Buffer): boolean {
  try {
    const files = unzipSync(new Uint8Array(buffer));
    return files['word/document.xml'] !== undefined;
  } catch {
    return false;
  }
}

function paragraphText(paraXml: string): string {
  let out = '';
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(paraXml)) !== null) {
    if (m[0].startsWith('<w:tab')) out += '\t';
    else if (m[0].startsWith('<w:br')) out += '\n';
    else out += decodeEntities(m[1]);
  }
  return out;
}

function isAllRunsBold(paraXml: string): boolean {
  const runRe = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
  let sawTextRun = false;
  let m: RegExpExecArray | null;
  while ((m = runRe.exec(paraXml)) !== null) {
    const run = m[1];
    if (!/<w:t(?:\s[^>]*)?>/.test(run)) continue;
    sawTextRun = true;
    const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(run);
    if (rPr === null || !/<w:b\b(?!Cs)[^a-zA-Z]/.test(`${rPr[1]} `)) return false;
  }
  return sawTextRun;
}

/**
 * Parse a converted .docx into paragraph records, in document order,
 * including paragraphs inside tables (flagged inTable).
 */
export function parseDocxParagraphs(buffer: Buffer): OoxmlParagraph[] {
  const files = unzipSync(new Uint8Array(buffer));
  const docEntry = files['word/document.xml'];
  if (docEntry === undefined) {
    throw new Error('not an OOXML wordprocessing document (missing word/document.xml)');
  }
  const xml = Buffer.from(docEntry).toString('utf8');

  const out: OoxmlParagraph[] = [];
  let tblDepth = 0;
  // Walk table open/close markers and paragraphs in document order.
  const tokenRe = /<w:tbl(?=[\s>])|<\/w:tbl>|<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(xml)) !== null) {
    const token = m[0];
    if (token.startsWith('<w:tbl')) {
      tblDepth++;
      continue;
    }
    if (token.startsWith('</w:tbl')) {
      tblDepth = Math.max(0, tblDepth - 1);
      continue;
    }
    const paraXml = token;
    const style = /<w:pStyle\s+w:val="([^"]+)"/.exec(paraXml);
    const ilvl = /<w:numPr>[\s\S]*?<w:ilvl\s+w:val="(\d+)"/.exec(paraXml);
    const hasNumPr = /<w:numPr>/.test(paraXml);
    out.push({
      text: paragraphText(paraXml),
      styleId: style !== null ? style[1] : null,
      numIlvl: ilvl !== null ? parseInt(ilvl[1], 10) : hasNumPr ? 0 : null,
      inTable: tblDepth > 0,
      bold: isAllRunsBold(paraXml),
      centered: /<w:jc\s+w:val="center"/.test(paraXml),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* §4.2 signals 1–2: style/numbering boundary hints                   */
/* ------------------------------------------------------------------ */

export interface StyleBoundaryHint {
  paragraphIndex: number;
  level: 'article' | 'section';
  signal: 'style' | 'numbering';
}

/**
 * Derive boundary hints from styles and numbering (§4.2 signal hierarchy
 * 1–2). Style wins over numbering per paragraph; text-grammar (signal 3)
 * is applied later by core/segment on unhinted paragraphs.
 */
export function deriveBoundaryHints(paragraphs: OoxmlParagraph[]): StyleBoundaryHint[] {
  const hints: StyleBoundaryHint[] = [];
  paragraphs.forEach((p, index) => {
    if (p.text.trim().length === 0) return;
    const style = p.styleId ?? '';
    if (/^TR_/.test(style) || /^Heading/i.test(style)) {
      const level: 'article' | 'section' = /1$/.test(style) ? 'article' : 'section';
      hints.push({ paragraphIndex: index, level, signal: 'style' });
      return;
    }
    if (p.numIlvl !== null && p.numIlvl <= 1) {
      hints.push({
        paragraphIndex: index,
        level: p.numIlvl === 0 ? 'article' : 'section',
        signal: 'numbering',
      });
    }
  });
  return hints;
}
