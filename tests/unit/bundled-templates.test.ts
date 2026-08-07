// @vitest-environment node
//
// This suite touches only the filesystem — no DOM. Declaring the node
// environment keeps it from spinning up a jsdom instance it never uses, which
// on a 4-core runner is enough contention to push the CPU-bound
// inheritance-tax-pdf-fill suite past its timeout.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
  loadBundledTemplate,
  deriveBundledVariant,
  __resetBundledTemplateCache,
} from '../../functions/src/bundled-templates';

const TEMPLATE_DIR = join(__dirname, '../../functions/src/templates');

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

  describe('unfilled skeletons never reach a document', () => {
    // trust-single.hbs is a registry key whose file arrives with the trust
    // template PR. Writing one here exercises the real resolution path rather
    // than a stub, and asserts on the guard that matters most: a template whose
    // articles are still [[DRAFT: ...]] placeholders looks finished at a glance
    // and must not be served.
    const scratch = join(TEMPLATE_DIR, 'trust-single.hbs');
    let preexisting = false;

    beforeEach(() => {
      preexisting = existsSync(scratch);
      __resetBundledTemplateCache();
    });
    afterEach(() => {
      if (!preexisting && existsSync(scratch)) rmSync(scratch);
      __resetBundledTemplateCache();
    });

    it('refuses a template that still carries draft markers', () => {
      if (preexisting) return; // the real template has landed; nothing to stub
      writeFileSync(
        scratch,
        '<h2>DECLARATION OF TRUST</h2>\n<p><strong>Spendthrift Clause.</strong> [[DRAFT: no alienation]]</p>\n',
        'utf8',
      );
      expect(loadBundledTemplate('trust', 'single')).toBeNull();
    });

    it('serves the same template once the markers are gone', () => {
      if (preexisting) return;
      writeFileSync(
        scratch,
        '<h2>DECLARATION OF TRUST</h2>\n<p><strong>Spendthrift Clause.</strong> No beneficiary may alienate their interest.</p>\n',
        'utf8',
      );
      const t = loadBundledTemplate('trust', 'single');
      expect(t).not.toBeNull();
      expect(t!.docType).toBe('trust');
      expect(t!.variant).toBe('single');
      expect(t!.content).not.toContain('[[DRAFT');
    });

    it('refuses when even one section of many is still a stub', () => {
      if (preexisting) return;
      const mostlyDone = Array.from({ length: 40 }, (_, i) => `<p>Section ${i} prose.</p>`).join('\n');
      writeFileSync(scratch, `${mostlyDone}\n<p>[[DRAFT: the last one]]</p>\n`, 'utf8');
      expect(loadBundledTemplate('trust', 'single')).toBeNull();
    });
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
