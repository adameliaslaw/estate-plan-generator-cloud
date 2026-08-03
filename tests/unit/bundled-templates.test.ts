import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadBundledTemplate,
  deriveBundledVariant,
  __resetBundledTemplateCache,
} from '../../functions/src/bundled-templates';

describe('bundled templates — the deploy ships its own last-resort templates', () => {
  beforeEach(() => __resetBundledTemplateCache());

  it('serves a variant-addressed template that exists on disk', () => {
    const t = loadBundledTemplate('poa', 'comprehensive');
    expect(t).not.toBeNull();
    expect(t!.docType).toBe('poa');
    expect(t!.variant).toBe('comprehensive');
    expect(t!._sourceCollection).toBe('bundled');
    // getTemplate()'s downstream validation requires a non-empty string here.
    expect(typeof t!.content).toBe('string');
    expect((t!.content as string).trim().length).toBeGreaterThan(0);
  });

  it('serves each variant separately rather than collapsing them', () => {
    const simple = loadBundledTemplate('poa', 'simple');
    const comprehensive = loadBundledTemplate('poa', 'comprehensive');
    expect(simple).not.toBeNull();
    expect(comprehensive).not.toBeNull();
    expect(simple!.content).not.toBe(comprehensive!.content);
  });

  it('refuses to guess when a docType has several bundled variants', () => {
    // poa has both simple and comprehensive on disk. Asked for a bare 'poa',
    // picking one silently would substitute a different instrument.
    expect(loadBundledTemplate('poa')).toBeNull();
  });

  it('returns null for a docType with nothing bundled', () => {
    expect(loadBundledTemplate('deed')).toBeNull();
    expect(loadBundledTemplate('will', 'anything')).toBeNull();
  });

  it('returns null for an unknown variant of a known docType', () => {
    expect(loadBundledTemplate('poa', 'nonexistent')).toBeNull();
  });

  describe('deriveBundledVariant', () => {
    it('routes a married settlor with a spouse on file to the joint spine', () => {
      const client = { personalInfo: { maritalStatus: 'Married' }, spouseInfo: { firstName: 'Karen' } };
      expect(deriveBundledVariant('trust', client)).toBe('joint');
    });

    it('routes an unmarried settlor to the single spine', () => {
      const client = { personalInfo: { maritalStatus: 'Single' } };
      expect(deriveBundledVariant('trust', client)).toBe('single');
    });

    it('routes a married settlor with no spouse record to the single spine', () => {
      // The joint template dereferences spouseInfo throughout; without it the
      // instrument would name a settlor that does not exist.
      const client = { personalInfo: { maritalStatus: 'Married' } };
      expect(deriveBundledVariant('trust', client)).toBe('single');
    });

    it('matches the MaritalStatus union exactly — casing is significant', () => {
      // MaritalStatus is 'Married', not 'married' (src/types/index.ts).
      const client = { personalInfo: { maritalStatus: 'married' }, spouseInfo: { firstName: 'Karen' } };
      expect(deriveBundledVariant('trust', client)).toBe('single');
    });

    it('does not derive a variant for docTypes whose split is an attorney choice', () => {
      const client = { personalInfo: { maritalStatus: 'Married' }, spouseInfo: {} };
      expect(deriveBundledVariant('poa', client)).toBeUndefined();
      expect(deriveBundledVariant('will', client)).toBeUndefined();
    });

    it('handles a missing client without throwing', () => {
      expect(deriveBundledVariant('trust', undefined)).toBeUndefined();
    });
  });
});
