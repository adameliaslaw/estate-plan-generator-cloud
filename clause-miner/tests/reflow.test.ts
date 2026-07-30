import { describe, expect, it } from 'vitest';
import { isHardWrapped, reflowParagraphs } from '../src/core/reflow.js';

/** Classic WP-era conversion: one paragraph per VISUAL line (§4.1). */
const hardWrapped = [
  'FOURTH: All the rest, residue and remainder of my',
  'estate, real, personal and mixed, of whatsoever kind',
  'and wheresoever situate, I give, devise and bequeath',
  'to my beloved wife, if she survives me by thirty (30)',
  'days.',
  'If my said wife shall predecease me, then I give my',
  'residuary estate to my children, in equal shares.',
];

const normalDoc = [
  'The Trustee shall hold, administer and distribute the trust estate for the benefit of the Grantor during the lifetime of the Grantor.',
  'Upon the death of the Grantor, the Trustee shall divide the remaining trust estate into equal shares for the then living children of the Grantor.',
  'Each share shall be held as a separate trust and administered as provided in this Agreement.',
];

describe('isHardWrapped (§4.1 detection)', () => {
  it('detects line-per-paragraph text via median length < 90', () => {
    expect(isHardWrapped(hardWrapped)).toBe(true);
  });

  it('detects wall text with low sentence-final punctuation rate', () => {
    const lines = [
      'and the Trustee shall pay over the income thereof'.padEnd(95, ' x'),
      'to the beneficiary in quarterly installments so long'.padEnd(95, ' x'),
      'as the beneficiary shall live and upon the death of'.padEnd(95, ' x'),
    ];
    expect(isHardWrapped(lines)).toBe(true);
  });

  it('does not fire on ordinary converted documents', () => {
    expect(isHardWrapped(normalDoc)).toBe(false);
  });

  it('handles empty input', () => {
    expect(isHardWrapped([])).toBe(false);
  });
});

describe('reflowParagraphs (§4.1 rejoin)', () => {
  it('rejoins hard-wrapped WP-style text into logical paragraphs', () => {
    const { paragraphs, reflowed } = reflowParagraphs(hardWrapped);
    expect(reflowed).toBe(true);
    expect(paragraphs).toEqual([
      'FOURTH: All the rest, residue and remainder of my estate, real, personal and mixed, of whatsoever kind and wheresoever situate, I give, devise and bequeath to my beloved wife, if she survives me by thirty (30) days.',
      'If my said wife shall predecease me, then I give my residuary estate to my children, in equal shares.',
    ]);
  });

  it('keeps standalone headings as their own paragraphs', () => {
    const doc = [
      'ARTICLE IV',
      'TRUSTEE POWERS',
      'The Trustee shall have the power',
      'to sell, exchange and convey any',
      'property of the trust estate.',
    ];
    const { paragraphs, reflowed } = reflowParagraphs(doc);
    expect(reflowed).toBe(true);
    expect(paragraphs).toEqual([
      'ARTICLE IV',
      'TRUSTEE POWERS',
      'The Trustee shall have the power to sell, exchange and convey any property of the trust estate.',
    ]);
  });

  it('treats blank lines as logical-paragraph separators', () => {
    const doc = [
      'The Trustee may retain any',
      'property without liability',
      '',
      'The Trustee may sell any',
      'property at public or private sale',
    ];
    const { paragraphs } = reflowParagraphs(doc);
    expect(paragraphs).toEqual([
      'The Trustee may retain any property without liability',
      'The Trustee may sell any property at public or private sale',
    ]);
  });

  it('returns non-hard-wrapped documents unchanged with reflowed=false', () => {
    const { paragraphs, reflowed } = reflowParagraphs(normalDoc);
    expect(reflowed).toBe(false);
    expect(paragraphs).toBe(normalDoc);
  });
});
