/**
 * tests/unit/template-formatting-styles.test.ts
 *
 * Unit tests for applyTemplateFormattingStyles in functions/src/template-engine.ts.
 * Verifies that the helper:
 *   - inlines class-derived styles for known tr-* classes
 *   - is idempotent across repeated invocations
 *   - lets pre-existing inline declarations win over class defaults
 *   - is a no-op on content with no tr-* classes
 *   - handles AI-introduced new classes between passes
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin', () => ({
  firestore: () => ({}),
  initializeApp: vi.fn(),
}));

import { applyTemplateFormattingStyles } from '../../functions/src/template-engine';

describe('applyTemplateFormattingStyles', () => {
  it('returns input unchanged when no tr-* classes are present', () => {
    const html = '<p class="some-other-class">Hello</p>';
    expect(applyTemplateFormattingStyles(html)).toBe(html);
  });

  it('returns empty input unchanged', () => {
    expect(applyTemplateFormattingStyles('')).toBe('');
  });

  it('inlines styles for a tr-title paragraph', () => {
    const html = '<p class="tr-title">Hello</p>';
    const out = applyTemplateFormattingStyles(html);
    expect(out).toContain('text-align:center');
    expect(out).toContain('text-decoration:underline');
    expect(out).toContain('text-transform:uppercase');
    expect(out).toContain('font-size:14pt');
  });

  it('is fully idempotent on a single pass', () => {
    const html = '<p class="tr-body1">Hello</p>';
    const once = applyTemplateFormattingStyles(html);
    const twice = applyTemplateFormattingStyles(once);
    expect(twice).toBe(once);
  });

  it('is idempotent across many passes', () => {
    const html = '<p class="tr-art1">Article I</p><p class="tr-body1">Body</p>';
    let out = applyTemplateFormattingStyles(html);
    for (let i = 0; i < 5; i++) out = applyTemplateFormattingStyles(out);
    expect(applyTemplateFormattingStyles(out)).toBe(out);
  });

  it('does not double-inline when style is already present', () => {
    const html = '<p class="tr-title">Hello</p>';
    const once = applyTemplateFormattingStyles(html);
    const twice = applyTemplateFormattingStyles(once);
    // Count the number of times "text-align" appears — should be exactly once
    const matches = twice.match(/text-align/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('lets pre-existing inline declarations win over class defaults', () => {
    // Class default for tr-title includes text-align:center; user inlined right
    const html = '<p class="tr-title" style="text-align:right;">Hello</p>';
    const out = applyTemplateFormattingStyles(html);
    // The final style should resolve text-align:right (user override wins)
    const styleMatch = out.match(/style="([^"]+)"/);
    expect(styleMatch).toBeTruthy();
    const style = styleMatch![1];
    // The resolved text-align must be 'right', not 'center'
    const taMatches = [...style.matchAll(/text-align:\s*([a-z]+)/g)];
    expect(taMatches.length).toBeGreaterThanOrEqual(1);
    // The last text-align declaration determines the resolved value, but our
    // merge collapses duplicates — there should be exactly one and it should be right
    expect(taMatches.length).toBe(1);
    expect(taMatches[0][1]).toBe('right');
  });

  it('handles new tr-* classes introduced after the first pass', () => {
    // Simulate AI substitution: first pass on HTML with one class, then AI
    // adds a paragraph with a different tr-* class, then second pass.
    const initial = '<p class="tr-body1">Body</p>';
    const afterFirst = applyTemplateFormattingStyles(initial);
    const aiAdded = afterFirst + '<p class="tr-art1">Article I</p>';
    const afterSecond = applyTemplateFormattingStyles(aiAdded);
    // Both paragraphs should now have inline styles
    expect(afterSecond).toMatch(/<p class="tr-body1"[^>]*style="[^"]*text-align:justify/);
    expect(afterSecond).toMatch(/<p class="tr-art1"[^>]*style="[^"]*text-align:center/);
    // Re-running is still a no-op
    expect(applyTemplateFormattingStyles(afterSecond)).toBe(afterSecond);
  });

  it('preserves multiple tr-* classes on a single element', () => {
    const html = '<p class="tr-base tr-art1">X</p>';
    const out = applyTemplateFormattingStyles(html);
    expect(out).toContain('text-align:center'); // from tr-art1
    expect(out).toContain('font-weight:bold'); // from tr-art1
    // Idempotent
    expect(applyTemplateFormattingStyles(out)).toBe(out);
  });

  it('preserves the original quote style on the class attribute', () => {
    const single = "<p class='tr-title'>X</p>";
    const out = applyTemplateFormattingStyles(single);
    // The output must remain valid HTML (no nested same-quote conflict)
    expect(out).toMatch(/style=['"]/);
  });

  it('is idempotent even when AI mutates style attribute between passes', () => {
    // Simulate AI inserting an extra style declaration on an already-styled tag
    const initial = applyTemplateFormattingStyles('<p class="tr-body1">X</p>');
    const styleMatch = initial.match(/style="([^"]+)"/);
    expect(styleMatch).toBeTruthy();
    // AI prepends a color override
    const aiMutated = initial.replace(
      /style="([^"]+)"/,
      `style="color:red;$1"`,
    );
    const afterPass = applyTemplateFormattingStyles(aiMutated);
    // The color override must survive
    expect(afterPass).toContain('color:red');
    // Re-running is a no-op
    expect(applyTemplateFormattingStyles(afterPass)).toBe(afterPass);
  });
});
