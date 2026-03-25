/**
 * tests/unit/template-fidelity-validator.test.ts
 *
 * Unit tests for the structural fidelity validator.
 * Verifies that compareHtmlStructure correctly detects structural changes
 * between original and modified HTML documents.
 */

import { describe, it, expect } from 'vitest';
import {
  compareHtmlStructure,
  buildFidelityRetryInstruction,
} from '../../functions/src/template-fidelity-validator';

// ===========================================================================
// Identical structure
// ===========================================================================

describe('compareHtmlStructure — identical structure', () => {
  it('returns score 1.0 for identical HTML', () => {
    const html = '<div><p>Hello</p><p>World</p></div>';
    const result = compareHtmlStructure(html, html);
    expect(result.score).toBe(1);
    expect(result.passes).toBe(true);
    expect(result.removedTags).toHaveLength(0);
    expect(result.addedTags).toHaveLength(0);
  });

  it('returns score 1.0 when only text content changed', () => {
    const original = '<div><p>John Smith</p><p>123 Main St</p><strong>Executor</strong></div>';
    const modified = '<div><p>{{clientFullName}}</p><p>{{personalInfo.address}}</p><strong>{{executorTitle}}</strong></div>';
    const result = compareHtmlStructure(original, modified);
    expect(result.score).toBe(1);
    expect(result.passes).toBe(true);
  });

  it('treats empty strings as identical', () => {
    const result = compareHtmlStructure('', '');
    expect(result.score).toBe(1);
    expect(result.passes).toBe(true);
  });
});

// ===========================================================================
// Tags removed
// ===========================================================================

describe('compareHtmlStructure — tags removed', () => {
  it('detects removed <strong> tags', () => {
    const original = '<p><strong>ARTICLE I</strong></p><p><strong>ARTICLE II</strong></p>';
    const modified = '<p>ARTICLE I</p><p>ARTICLE II</p>';
    const result = compareHtmlStructure(original, modified);
    expect(result.removedTags.some(t => t.tag === 'strong')).toBe(true);
    expect(result.score).toBeLessThan(1);
  });

  it('detects removed paragraphs', () => {
    const original = '<div><p>Para 1</p><p>Para 2</p><p>Para 3</p></div>';
    const modified = '<div><p>Para 1</p></div>';
    const result = compareHtmlStructure(original, modified);
    expect(result.removedTags.some(t => t.tag === 'p')).toBe(true);
    expect(result.removedTags.find(t => t.tag === 'p')?.count).toBe(2);
  });

  it('fails fidelity when many tags removed', () => {
    const original = '<div>' + '<p>Content</p>'.repeat(20) + '</div>';
    const modified = '<div><p>Content</p></div>';
    const result = compareHtmlStructure(original, modified);
    expect(result.passes).toBe(false);
  });
});

// ===========================================================================
// Tags added
// ===========================================================================

describe('compareHtmlStructure — tags added', () => {
  it('detects added <div> wrappers', () => {
    const original = '<p>Content</p><p>More content</p>';
    const modified = '<div><p>Content</p></div><div><p>More content</p></div>';
    const result = compareHtmlStructure(original, modified);
    expect(result.addedTags.some(t => t.tag === 'div')).toBe(true);
  });

  it('detects added heading tags', () => {
    const original = '<p>Content</p>';
    const modified = '<h1>Title</h1><h2>Section</h2><p>Content</p>';
    const result = compareHtmlStructure(original, modified);
    expect(result.addedTags.some(t => t.tag === 'h1')).toBe(true);
    expect(result.addedTags.some(t => t.tag === 'h2')).toBe(true);
  });
});

// ===========================================================================
// CSS class changes
// ===========================================================================

describe('compareHtmlStructure — CSS class changes', () => {
  it('detects removed CSS classes', () => {
    const original = '<p class="tr-art1">ARTICLE I</p><p class="tr-body1">Content</p>';
    const modified = '<p>ARTICLE I</p><p>Content</p>';
    const result = compareHtmlStructure(original, modified);
    expect(result.changedTags.some(c => c.change.includes('tr-art1'))).toBe(true);
    expect(result.changedTags.some(c => c.change.includes('tr-body1'))).toBe(true);
  });

  it('detects added CSS classes', () => {
    const original = '<p>Content</p>';
    const modified = '<p class="tr-body1">Content</p>';
    const result = compareHtmlStructure(original, modified);
    expect(result.changedTags.some(c => c.change.includes('tr-body1') && c.change.includes('added'))).toBe(true);
  });

  it('preserves score when classes unchanged', () => {
    const original = '<p class="tr-art1"><strong>ARTICLE I</strong></p>';
    const modified = '<p class="tr-art1"><strong>{{articleHeading}}</strong></p>';
    const result = compareHtmlStructure(original, modified);
    expect(result.score).toBe(1);
  });
});

// ===========================================================================
// Sequence ordering
// ===========================================================================

describe('compareHtmlStructure — sequence ordering', () => {
  it('detects reordered tags (lower score)', () => {
    const original = '<h2>Title</h2><p>Body</p><ul><li>Item</li></ul>';
    const modified = '<p>Body</p><h2>Title</h2><ul><li>Item</li></ul>';
    const result = compareHtmlStructure(original, modified);
    // Frequency is same (1.0), but sequence differs
    expect(result.score).toBeLessThan(1);
    expect(result.score).toBeGreaterThan(0.5); // Should still be fairly high since tags are same
  });
});

// ===========================================================================
// Real-world template-like structures
// ===========================================================================

describe('compareHtmlStructure — real template structures', () => {
  const willTemplate = `
    <p class="tr-title"><u>LAST WILL AND TESTAMENT OF JESSICA A. BYRNES</u></p>
    <p class="tr-base"></p>
    <p class="tr-body1">I, <strong>JESSICA A. BYRNES</strong>, of Morris County, New Jersey, declare this to be my Last Will and Testament.</p>
    <p class="tr-base"></p>
    <p class="tr-art1"><strong>ARTICLE I</strong></p>
    <p class="tr-art1"><strong>FAMILY INFORMATION</strong></p>
    <p class="tr-art2">I am married to <strong>SEAN M. BYRNES</strong>, my husband.</p>
    <p class="tr-art2">We have the following children:</p>
    <p class="tr-art3b">1. Child One, born January 1, 2010</p>
    <p class="tr-art3b">2. Child Two, born June 15, 2012</p>
    <p class="tr-base"></p>
    <p class="tr-art1"><strong>ARTICLE II</strong></p>
    <p class="tr-art1"><strong>REVOCATION</strong></p>
    <p class="tr-art2">I revoke all prior wills and codicils.</p>
  `;

  it('perfect templatization: only text replaced, score = 1.0', () => {
    const templatized = willTemplate
      .replace('JESSICA A. BYRNES', '{{clientFullName}}')
      .replace('JESSICA A. BYRNES', '{{clientFullName}}')
      .replace('SEAN M. BYRNES', '{{spouseFullName}}')
      .replace('Morris County', '{{personalInfo.county}} County')
      .replace('my husband', 'my {{spouseTitle}}');
    const result = compareHtmlStructure(willTemplate, templatized);
    expect(result.score).toBe(1);
    expect(result.passes).toBe(true);
  });

  it('bad templatization: tags restructured, score < 0.85', () => {
    // AI replaced <p class="tr-art1"> with <h2> and removed <strong>
    const badTemplatized = willTemplate
      .replace(/<p class="tr-art1"><strong>/g, '<h2>')
      .replace(/<\/strong><\/p>/g, '</h2>')
      .replace('JESSICA A. BYRNES', '{{clientFullName}}')
      .replace('JESSICA A. BYRNES', '{{clientFullName}}');
    const result = compareHtmlStructure(willTemplate, badTemplatized);
    expect(result.passes).toBe(false);
    expect(result.addedTags.some(t => t.tag === 'h2')).toBe(true);
    expect(result.removedTags.some(t => t.tag === 'strong')).toBe(true);
  });
});

// ===========================================================================
// Self-closing tags
// ===========================================================================

describe('compareHtmlStructure — self-closing tags', () => {
  it('handles <br/> and <hr/> correctly', () => {
    const original = '<p>Line 1</p><br/><p>Line 2</p><hr/>';
    const modified = '<p>Line 1</p><br/><p>Line 2</p><hr/>';
    const result = compareHtmlStructure(original, modified);
    expect(result.score).toBe(1);
  });

  it('detects removed <br> tags', () => {
    const original = '<p>Line 1<br/>Line 2</p>';
    const modified = '<p>Line 1 Line 2</p>';
    const result = compareHtmlStructure(original, modified);
    expect(result.removedTags.some(t => t.tag === 'br')).toBe(true);
  });
});

// ===========================================================================
// Style / script blocks ignored
// ===========================================================================

describe('compareHtmlStructure — style/script blocks', () => {
  it('ignores <style> blocks in comparison', () => {
    const original = '<style>body { font: serif; }</style><p>Content</p>';
    const modified = '<p>Content</p>';
    const result = compareHtmlStructure(original, modified);
    expect(result.score).toBe(1);
    expect(result.passes).toBe(true);
  });
});

// ===========================================================================
// buildFidelityRetryInstruction
// ===========================================================================

describe('buildFidelityRetryInstruction', () => {
  it('lists removed tags', () => {
    const result = compareHtmlStructure(
      '<p>A</p><p>B</p><strong>C</strong>',
      '<p>A B C</p>',
    );
    const instruction = buildFidelityRetryInstruction(result);
    expect(instruction).toContain('REMOVED');
    expect(instruction).toContain('<p>');
  });

  it('lists added tags', () => {
    const result = compareHtmlStructure(
      '<p>Content</p>',
      '<div><h1>Title</h1><p>Content</p></div>',
    );
    const instruction = buildFidelityRetryInstruction(result);
    expect(instruction).toContain('ADDED');
    expect(instruction).toContain('<h1>');
  });

  it('includes fidelity score', () => {
    const result = compareHtmlStructure(
      '<p>A</p><p>B</p>',
      '<div>A B</div>',
    );
    const instruction = buildFidelityRetryInstruction(result);
    expect(instruction).toMatch(/\d+\.\d+%/);
  });
});
