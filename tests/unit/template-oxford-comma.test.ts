/**
 * tests/unit/template-oxford-comma.test.ts
 *
 * Regression tests for insertOxfordAnd in functions/src/template-engine.ts.
 * R5-044: the pre-normalization that inserts ", " between adjacent <strong>
 * spans must only fire on TRULY-adjacent spans (the missing-comma name-list
 * bug) — never between bold spans separated by whitespace, which are
 * legitimate prose emphasis.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin', () => ({
  firestore: () => ({}),
  initializeApp: vi.fn(),
}));

import { insertOxfordAnd } from '../../functions/src/template-engine';

describe('insertOxfordAnd — R5-044 no spurious comma between space-separated bold spans', () => {
  it('leaves two whitespace-separated bold spans untouched (legitimate prose)', () => {
    const html = '<strong>Executor</strong> <strong>Trustee</strong>';
    expect(insertOxfordAnd(html)).toBe(html);
  });

  it('still normalizes a truly-adjacent 2-name list into "A and B"', () => {
    const html = '<strong>ALINA J. ELIAS</strong><strong>ADAM J. ELIAS, JR.</strong>';
    expect(insertOxfordAnd(html)).toBe(
      '<strong>ALINA J. ELIAS</strong> and <strong>ADAM J. ELIAS, JR.</strong>',
    );
  });

  it('applies the Oxford comma to a truly-adjacent 3-name list', () => {
    const html = '<strong>A</strong><strong>B</strong><strong>C</strong>';
    expect(insertOxfordAnd(html)).toBe(
      '<strong>A</strong>, <strong>B</strong>, and <strong>C</strong>',
    );
  });

  it('still fixes an existing comma-separated 3-name list', () => {
    const html = '<strong>A</strong>, <strong>B</strong>, <strong>C</strong>';
    expect(insertOxfordAnd(html)).toBe(
      '<strong>A</strong>, <strong>B</strong>, and <strong>C</strong>',
    );
  });
});
