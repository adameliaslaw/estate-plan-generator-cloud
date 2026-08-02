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

describe('reflowParagraphs — heading grammar at a wrapped continuation line (2026-08-02, Adam: pieces cut off mid-sentence)', () => {
  it('joins a wrapped Section N.N cross-reference instead of splitting the sentence', () => {
    const doc = [
      'The Trustee shall distribute the principal as provided in',
      'Section 5.2 hereof upon the death of the Grantor and shall',
      'thereafter terminate the trust.',
    ];
    const { paragraphs, reflowed } = reflowParagraphs(doc);
    expect(reflowed).toBe(true);
    expect(paragraphs).toEqual([
      'The Trustee shall distribute the principal as provided in Section 5.2 hereof upon the death of the Grantor and shall thereafter terminate the trust.',
    ]);
  });

  it('joins a wrapped ARTICLE cross-reference instead of splitting the sentence', () => {
    const doc = [
      'The share of any deceased child shall be disposed of pursuant to',
      'ARTICLE IV of this Agreement, and the Trustee shall have no',
      'further duty with respect thereto.',
    ];
    const { paragraphs } = reflowParagraphs(doc);
    expect(paragraphs).toEqual([
      'The share of any deceased child shall be disposed of pursuant to ARTICLE IV of this Agreement, and the Trustee shall have no further duty with respect thereto.',
    ]);
  });

  it('joins an all-caps emphasis run that wrapped onto its own line', () => {
    const doc = [
      'I give all of my estate to my beloved wife,',
      'MARY ROE, IF SHE SURVIVES ME,',
      'and if she does not survive me, to my children.',
    ];
    const { paragraphs } = reflowParagraphs(doc);
    expect(paragraphs).toEqual([
      'I give all of my estate to my beloved wife, MARY ROE, IF SHE SURVIVES ME, and if she does not survive me, to my children.',
    ]);
  });

  it('joins a wrapped line starting with a bare decimal that is not numbering', () => {
    const doc = [
      'The homestead consists of approximately',
      '2.5 acres situated in the County of Kings,',
      'together with all improvements thereon.',
    ];
    const { paragraphs } = reflowParagraphs(doc);
    expect(paragraphs).toEqual([
      'The homestead consists of approximately 2.5 acres situated in the County of Kings, together with all improvements thereon.',
    ]);
  });

  it('still splits at a genuine heading that follows a completed sentence', () => {
    const doc = [
      'to my beloved wife if she survives me by thirty days.',
      'Section 5.1 Payment of Debts. My Executor shall pay all',
      'my just debts and funeral expenses.',
    ];
    const { paragraphs } = reflowParagraphs(doc);
    expect(paragraphs).toEqual([
      'to my beloved wife if she survives me by thirty days.',
      'Section 5.1 Payment of Debts. My Executor shall pay all my just debts and funeral expenses.',
    ]);
  });
});
