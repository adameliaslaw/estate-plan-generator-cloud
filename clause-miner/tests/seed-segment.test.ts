import { describe, expect, it } from 'vitest';
import {
  isCommentaryLine,
  isOptionLabel,
  isSeparatorLine,
  segmentClauseLibrary,
} from '../src/core/seed-segment.js';
import { segmentParagraphs } from '../src/core/segment.js';

describe('clause-library cues (§11 P1a)', () => {
  it('recognizes rule lines but not blanks or short runs', () => {
    expect(isSeparatorLine('__________')).toBe(true);
    expect(isSeparatorLine('- - - - -')).toBe(true);
    expect(isSeparatorLine('* * *')).toBe(true);
    expect(isSeparatorLine('   ')).toBe(false); // blank, handled as a gap
    expect(isSeparatorLine('--')).toBe(false); // too short to be a rule
    expect(isSeparatorLine('ARTICLE IV')).toBe(false);
  });

  it('recognizes option labels a library heads its choices with', () => {
    expect(isOptionLabel('OPTION 1')).toBe(true);
    expect(isOptionLabel('Alternative B:')).toBe(true);
    expect(isOptionLabel('[A]')).toBe(true);
    expect(isOptionLabel('The Trustee shall distribute the residue.')).toBe(false);
  });

  it('flags commentary but leaves blanks and dummy names alone', () => {
    expect(isCommentaryLine('NOTE: use only for blended families.')).toBe(true);
    expect(isCommentaryLine('Use this when the client has minor children.')).toBe(true);
    expect(isCommentaryLine('[Insert only where a corporate trustee serves]')).toBe(true);
    // Operative text carrying library conventions must NOT be dropped — a
    // false positive silently deletes a clause from the gold set.
    expect(isCommentaryLine('I, JOHN DOE, of ____________, declare this trust.')).toBe(false);
    expect(isCommentaryLine('The Trustee shall pay income to [NAME].')).toBe(false);
  });
});

describe('segmentClauseLibrary', () => {
  const library = [
    'SPENDTHRIFT PROVISION',
    'No beneficiary shall have any right to anticipate, sell, assign, or encumber',
    'any interest in the trust estate.',
    '',
    '',
    'NOTE: omit for a single-beneficiary trust.',
    'PER STIRPES DISTRIBUTION',
    'The remaining trust estate shall be distributed to my descendants, per stirpes.',
    '__________________',
    'OPTION 2',
    'The remaining trust estate shall be distributed to my descendants, per capita',
    'at each generation.',
  ];

  it('splits on blank gaps, rules and option labels', () => {
    const pieces = segmentClauseLibrary(library);
    expect(pieces).toHaveLength(3);
    expect(pieces[0].title).toBe('SPENDTHRIFT PROVISION');
    expect(pieces[0].separatorSignal).toBe('start');
    expect(pieces[1].separatorSignal).toBe('blank-gap');
    expect(pieces[2].separatorSignal).toBe('option-label');
  });

  it('keeps commentary out of the operative text but records it', () => {
    const pieces = segmentClauseLibrary(library);
    const joined = pieces.map((p) => p.paragraphs.join(' ')).join(' ');
    expect(joined).not.toContain('omit for a single-beneficiary trust');
    expect(pieces[1].commentary.join(' ')).toContain('omit for a single-beneficiary trust');
  });

  it('keeps per stirpes and per capita as SEPARATE pieces', () => {
    // These two differ by one legal-delta phrase. If the segmenter ran them
    // together the purity gate could never see them as two decisions.
    const pieces = segmentClauseLibrary(library);
    expect(pieces[1].paragraphs.join(' ')).toContain('per stirpes');
    expect(pieces[2].paragraphs.join(' ')).toContain('per capita');
  });

  it('drops fragments too short to be a clause', () => {
    expect(segmentClauseLibrary(['OPTION 1', 'yes.', '_____', 'no.'])).toHaveLength(0);
  });

  it('is why the instrument segmenter cannot be reused here', () => {
    // The negative control for this module. The instrument grammar does fire
    // on the ALL-CAPS titles, so the block COUNT can coincide — what it
    // cannot do is the two things the gold set depends on:
    const instrument = segmentParagraphs(library, []);
    const instrumentText = instrument.blocks.map((b) => b.paragraphs.join(' ')).join(' ');

    // 1. It carries the drafting note into operative text — exactly the
    //    pollution §11 P1a says would contaminate the gold set.
    expect(instrumentText).toContain('omit for a single-beneficiary trust');
    expect(
      segmentClauseLibrary(library)
        .map((p) => p.paragraphs.join(' '))
        .join(' '),
    ).not.toContain('omit for a single-beneficiary trust');

    // 2. It has no notion of an option label. A library heading its
    //    alternatives with a non-caps label runs them all into one block —
    //    and even when the label IS caps and it happens to split there, the
    //    label stays inside the clause text, so the piece hashes differently
    //    from the identical clause mined out of a client document.
    const options = [
      'Alternative A:',
      'The Trustee shall distribute the net income quarterly to my spouse.',
      'Alternative B:',
      'The Trustee shall distribute the net income annually to my spouse.',
    ];
    expect(segmentParagraphs(options, []).blocks).toHaveLength(1);
    expect(segmentClauseLibrary(options)).toHaveLength(2);

    const caps = ['OPTION 1', 'The Trustee shall distribute the net income quarterly.'];
    expect(segmentParagraphs(caps, []).blocks[0].paragraphs).toContain('OPTION 1');
    expect(segmentClauseLibrary(caps)[0].paragraphs).not.toContain('OPTION 1');
  });
});
