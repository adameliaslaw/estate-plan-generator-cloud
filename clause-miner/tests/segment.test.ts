import { describe, expect, it } from 'vitest';
import {
  isAllCapsHeading,
  isArticleBoundary,
  isSectionBoundary,
  segmentParagraphs,
  type BoundaryHint,
} from '../src/core/segment.js';

describe('text-grammar boundary regexes (§4.2 signal 3)', () => {
  it('matches ARTICLE with roman numerals and digits', () => {
    expect(isArticleBoundary('ARTICLE IV')).toBe(true);
    expect(isArticleBoundary('Article 7')).toBe(true);
    expect(isArticleBoundary('ARTICLE XII — TRUSTEE POWERS')).toBe(true);
    expect(isArticleBoundary('The Article of furniture')).toBe(false);
  });

  it('matches ordinal-word headers with colon, any case', () => {
    expect(isArticleBoundary('FIRST: I direct my Executor to pay my debts.')).toBe(true);
    expect(isArticleBoundary('Twentieth: I nominate my spouse as Executor.')).toBe(true);
    expect(isArticleBoundary('TWENTY-FIRST: In the event of a common disaster.')).toBe(true);
  });

  it('matches all-caps ordinal headers without colon, but not prose "First,"', () => {
    expect(isArticleBoundary('FOURTH I give all my tangible personal property')).toBe(true);
    expect(isArticleBoundary('First, I want to thank my family')).toBe(false);
  });

  it('matches Section/Paragraph numbering', () => {
    expect(isSectionBoundary('Section 5.2 Distribution of Income')).toBe(true);
    expect(isSectionBoundary('Paragraph 7 shall govern')).toBe(true);
    expect(isSectionBoundary('section 3')).toBe(true);
  });

  it('matches bare decimal numbering', () => {
    expect(isSectionBoundary('4.3 Spendthrift Provision. No beneficiary...')).toBe(true);
    expect(isSectionBoundary('4. General provisions')).toBe(false);
  });

  it('matches ALL-CAPS lines up to 70 chars only', () => {
    expect(isAllCapsHeading('SPENDTHRIFT PROVISION')).toBe(true);
    expect(isAllCapsHeading('DISTRIBUTION UPON DEATH OF GRANTOR')).toBe(true);
    expect(isAllCapsHeading('The Trustee shall distribute')).toBe(false);
    expect(isAllCapsHeading('A'.repeat(71))).toBe(false);
    expect(isAllCapsHeading('12345 67890')).toBe(false); // no letters
  });
});

describe('segmentParagraphs (§4.2)', () => {
  const trustDoc = [
    'REVOCABLE LIVING TRUST AGREEMENT',
    'This Trust Agreement is made between the Grantor and the Trustee named below.',
    'ARTICLE I',
    'FAMILY IDENTIFICATION',
    'I am married and have three children, all of whom are identified on Schedule B.',
    'ARTICLE II',
    'Section 2.1 Trust Property. The Grantor transfers to the Trustee the property described on Schedule A.',
    'Section 2.2 Additions. The Grantor may add property to the trust at any time.',
    'Any such additions shall be administered under the terms of this Agreement.',
  ];

  it('produces provision blocks with article/section indices', () => {
    const result = segmentParagraphs(trustDoc);
    // Title (caps) → section under article 0; ARTICLE I → article 1; caps
    // heading + text; ARTICLE II → article 2 with two numbered sections.
    const articles = result.blocks.map((b) => b.articleIndex);
    expect(Math.max(...articles)).toBe(2);

    const art2Sections = result.blocks.filter((b) => b.articleIndex === 2);
    // ARTICLE II heading block (section 0) + Section 2.1 + Section 2.2.
    expect(art2Sections.map((b) => b.sectionIndex)).toEqual([0, 1, 2]);

    // Continuation paragraph attaches to Section 2.2's block.
    const sec22 = art2Sections[2];
    expect(sec22.paragraphs).toHaveLength(2);
    expect(sec22.paragraphs[1]).toMatch(/administered under the terms/);
  });

  it('records structureSignal text-grammar for grammar boundaries', () => {
    const result = segmentParagraphs(trustDoc);
    const boundaryBlocks = result.blocks.filter(
      (b) => b.structureSignal === 'text-grammar',
    );
    expect(boundaryBlocks.length).toBeGreaterThanOrEqual(5);
  });

  it('treats ordinal-word will headers as article boundaries', () => {
    const will = [
      'LAST WILL AND TESTAMENT',
      'FIRST: I direct my Executor to pay all my just debts and funeral expenses.',
      'SECOND: I give all my tangible personal property to my spouse.',
      'THIRD: All the rest, residue and remainder of my estate I give to my descendants, per stirpes.',
    ];
    const result = segmentParagraphs(will);
    const maxArticle = Math.max(...result.blocks.map((b) => b.articleIndex));
    expect(maxArticle).toBe(3);
  });

  it('honors caller-supplied style/numbering boundary hints (§4.2 signals 1-2)', () => {
    const paragraphs = [
      'Trust Provisions',
      'The Trustee shall hold the trust estate as follows.',
      'Distribution of Income',
      'Income shall be paid to the Grantor during lifetime.',
    ];
    const hints: BoundaryHint[] = [
      { paragraphIndex: 0, level: 'article', signal: 'style' },
      { paragraphIndex: 2, level: 'section', signal: 'style' },
    ];
    const result = segmentParagraphs(paragraphs, hints);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].structureSignal).toBe('style');
    expect(result.blocks[0].articleIndex).toBe(1);
    expect(result.blocks[1].sectionIndex).toBe(1);
    expect(result.boundaryCount).toBe(2);
  });

  it('flags under-segmentation: < 1 boundary per 4,000 chars → needs-llm-fallback', () => {
    const wall = ['The Grantor declares. '.repeat(400).trim()]; // ~8,800 chars, 0 boundaries
    const result = segmentParagraphs(wall);
    expect(result.flags).toContain('needs-llm-fallback');
    expect(result.flags).not.toContain('over-segmented');
  });

  it('flags over-segmentation: > 1 boundary per 300 chars → over-segmented', () => {
    const shredded: string[] = [];
    for (let i = 0; i < 20; i++) {
      shredded.push('TRUST PROVISION HEADING');
    }
    const result = segmentParagraphs(shredded);
    expect(result.flags).toContain('over-segmented');
  });

  it('does not flag a normally segmented document', () => {
    const paragraphs: string[] = [];
    for (let a = 1; a <= 4; a++) {
      paragraphs.push(`ARTICLE ${'IVXL'[a - 1] === 'I' ? 'I' : String(a)}`);
      paragraphs.push(
        'The Trustee shall administer the trust estate for the benefit of the beneficiaries. '.repeat(
          8,
        ),
      );
    }
    const result = segmentParagraphs(paragraphs);
    expect(result.flags).toEqual([]);
  });

  it('collects preamble text before any boundary with signal none', () => {
    const result = segmentParagraphs([
      'This declaration of trust is entered into by the undersigned.',
      'ARTICLE I',
      'Trust name and purpose.',
    ]);
    expect(result.blocks[0].structureSignal).toBe('none');
    expect(result.blocks[0].articleIndex).toBe(0);
  });

  it('ignores blank paragraphs', () => {
    const result = segmentParagraphs(['', '  ', 'ARTICLE I', '', 'Body text here.']);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].paragraphs).toEqual(['ARTICLE I', 'Body text here.']);
  });
});
