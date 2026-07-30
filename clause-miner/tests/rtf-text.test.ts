import { describe, expect, it } from 'vitest';
import { rtfToText } from '../src/rtf-text.js';

describe('rtfToText (§8 fallback ladder)', () => {
  it('extracts text and paragraph breaks', () => {
    const rtf = String.raw`{\rtf1\ansi\deff0 First paragraph.\par Second paragraph.\par}`;
    expect(rtfToText(rtf)).toBe('First paragraph.\nSecond paragraph.');
  });

  it('skips the font table, stylesheet, and info destinations', () => {
    const rtf = String.raw`{\rtf1{\fonttbl{\f0 Times New Roman;}}{\stylesheet{\s1 Heading;}}{\info{\author Secret Author}}Visible text only.\par}`;
    const out = rtfToText(rtf);
    expect(out).toBe('Visible text only.');
    expect(out).not.toContain('Times');
    expect(out).not.toContain('Secret');
  });

  it('skips \\* ignorable destinations', () => {
    const rtf = String.raw`{\rtf1{\*\generator LibreOffice}Body text.\par}`;
    expect(rtfToText(rtf)).toBe('Body text.');
  });

  it("decodes \\'hh hex escapes and escaped braces", () => {
    const rtf = String.raw`{\rtf1 caf\'e9 \{brace\} \\slash\par}`;
    expect(rtfToText(rtf)).toBe('café {brace} \\slash');
  });

  it('decodes \\uN unicode with fallback skip', () => {
    const rtf = String.raw`{\rtf1\uc1 \u8220?quoted\u8221? text\par}`;
    expect(rtfToText(rtf)).toBe('\u201Cquoted\u201D text');
  });

  it('handles tabs and formatting control words without leaking them', () => {
    // The single space after a control word is a delimiter, not text — a
    // writer wanting a real space emits two ("\i0  text").
    const rtf = String.raw`{\rtf1 \b Bold\b0\tab and \i italic\i0  text.\par}`;
    expect(rtfToText(rtf)).toBe('Bold\tand italic text.');
  });

  it('survives the ".doc that is actually RTF" shape', () => {
    const rtf = String.raw`{\rtf1\ansi ARTICLE FOURTH: All the rest, residue and remainder.\par}`;
    expect(rtfToText(rtf)).toContain('ARTICLE FOURTH: All the rest, residue and remainder.');
  });
});
