import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { deriveBoundaryHints, isOoxmlDocx, parseDocxParagraphs } from '../src/ooxml.js';

function docx(bodyXml: string): Buffer {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`;
  const zipped = zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(documentXml),
  });
  return Buffer.from(zipped);
}

function p(text: string, opts: { style?: string; ilvl?: number; bold?: boolean; centered?: boolean } = {}): string {
  const pPr =
    (opts.style !== undefined ? `<w:pStyle w:val="${opts.style}"/>` : '') +
    (opts.centered === true ? `<w:jc w:val="center"/>` : '') +
    (opts.ilvl !== undefined
      ? `<w:numPr><w:ilvl w:val="${opts.ilvl}"/><w:numId w:val="1"/></w:numPr>`
      : '');
  const rPr = opts.bold === true ? '<w:rPr><w:b/></w:rPr>' : '';
  return `<w:p><w:pPr>${pPr}</w:pPr><w:r>${rPr}<w:t>${text}</w:t></w:r></w:p>`;
}

describe('isOoxmlDocx', () => {
  it('accepts a real OOXML zip and rejects a non-OOXML zip', () => {
    expect(isOoxmlDocx(docx(p('hello')))).toBe(true);
    const plainZip = Buffer.from(zipSync({ 'foo.txt': strToU8('x') }));
    expect(isOoxmlDocx(plainZip)).toBe(false);
    expect(isOoxmlDocx(Buffer.from('not a zip'))).toBe(false);
  });
});

describe('parseDocxParagraphs', () => {
  it('extracts text, styles, numbering, and run signals', () => {
    const buffer = docx(
      p('ARTICLE I', { style: 'Heading1', centered: true, bold: true }) +
        p('Section 1.1 Trust Name', { style: 'TR_Section' }) +
        p('The trust shall be known as the Family Trust.') +
        p('First item', { ilvl: 1 }),
    );
    const paragraphs = parseDocxParagraphs(buffer);
    expect(paragraphs).toHaveLength(4);
    expect(paragraphs[0]).toMatchObject({
      text: 'ARTICLE I',
      styleId: 'Heading1',
      bold: true,
      centered: true,
      inTable: false,
    });
    expect(paragraphs[1].styleId).toBe('TR_Section');
    expect(paragraphs[2]).toMatchObject({ styleId: null, bold: false });
    expect(paragraphs[3].numIlvl).toBe(1);
  });

  it('flags paragraphs inside tables (attestation blocks live there)', () => {
    const buffer = docx(
      p('Before table') +
        `<w:tbl><w:tblPr/><w:tr><w:tc>${p('IN WITNESS WHEREOF')}</w:tc><w:tc>${p('Notary Public')}</w:tc></w:tr></w:tbl>` +
        p('After table'),
    );
    const paragraphs = parseDocxParagraphs(buffer);
    expect(paragraphs.map((x) => x.inTable)).toEqual([false, true, true, false]);
  });

  it('decodes entities and w:tab/w:br', () => {
    const buffer = docx(
      '<w:p><w:r><w:t>Smith &amp; Doe</w:t><w:tab/><w:t>&#8220;quoted&#8221;</w:t></w:r></w:p>',
    );
    expect(parseDocxParagraphs(buffer)[0].text).toBe('Smith & Doe\t“quoted”');
  });

  it('mixed bold runs do not mark the paragraph bold', () => {
    const buffer = docx(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:r><w:t> plain</w:t></w:r></w:p>',
    );
    expect(parseDocxParagraphs(buffer)[0].bold).toBe(false);
  });
});

describe('deriveBoundaryHints (§4.2 signals 1-2)', () => {
  it('style beats numbering; Heading1/TR_*1 are article-level', () => {
    const paragraphs = parseDocxParagraphs(
      docx(
        p('ARTICLE I', { style: 'Heading1' }) +
          p('Section A', { style: 'TR_Section' }) +
          p('numbered article', { ilvl: 0 }) +
          p('numbered section', { ilvl: 1 }) +
          p('plain prose paragraph with no signals at all'),
      ),
    );
    const hints = deriveBoundaryHints(paragraphs);
    expect(hints).toEqual([
      { paragraphIndex: 0, level: 'article', signal: 'style' },
      { paragraphIndex: 1, level: 'section', signal: 'style' },
      { paragraphIndex: 2, level: 'article', signal: 'numbering' },
      { paragraphIndex: 3, level: 'section', signal: 'numbering' },
    ]);
  });

  it('skips empty paragraphs and deep list levels', () => {
    const paragraphs = parseDocxParagraphs(
      docx(p('', { style: 'Heading1' }) + p('deep item', { ilvl: 3 })),
    );
    expect(deriveBoundaryHints(paragraphs)).toEqual([]);
  });
});
