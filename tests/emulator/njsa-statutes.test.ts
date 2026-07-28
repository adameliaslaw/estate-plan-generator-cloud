/**
 * tests/emulator/njsa-statutes.test.ts
 *
 * Emulator-backed tests for the N.J.S.A. statutory retrieval module:
 * parse → import → read/search → verify-citations round trip, plus the
 * not-imported and stale-section-pruning paths.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { admin } from './_emulator';
import {
  NJSA_COLLECTION,
  NJSA_META_COLLECTION,
  NJSA_META_DOC_ID,
  extractNjsaCitations,
  getNjsaImportMeta,
  headingTokens,
  importNjsaSections,
  normalizeNjsaCitation,
  parseNjsaStatutesText,
  readNjsaSection,
  searchNjsaSections,
  verifyNjsaCitations,
} from '../../functions/src/njsa-statutes';

const SAMPLE = [
  'NEW JERSEY GENERAL AND PERMANENT STATUTES',
  '(UPDATED THROUGH  P.L.2025, c.346, and J.R.22)',
  '',
  'TITLE 3B        ADMINISTRATION OF ESTATES--DECEDENTS AND OTHERS',
  '',
  '3B:3-2.  Execution; witnessed wills; writings intended as wills',
  '    a. Except as provided in subsection b. and in N.J.S.3B:3-3, a will shall be:',
  '    (1) in writing;',
  '    (2) signed by the testator; and',
  '    (3) signed by at least two individuals.',
  '',
  '3B:8-1  Elective share of surviving spouse or domestic partner.',
  '    The surviving spouse or domestic partner has a right of election to take',
  'an elective share of one-third of the augmented estate.',
  '',
  'TITLE 46        PROPERTY',
  '',
  '46:2B-8.1  Short title.',
  '    This act shall be known as the "Revised Durable Power of Attorney Act."',
].join('\n');

async function wipe(): Promise<void> {
  const db = admin.firestore();
  const docs = await db.collection(NJSA_COLLECTION).get();
  await Promise.all(docs.docs.map((d) => d.ref.delete()));
  await db.collection(NJSA_META_COLLECTION).doc(NJSA_META_DOC_ID).delete();
}

describe('njsa-statutes', () => {
  describe('before any import', () => {
    beforeAll(wipe);

    it('verifyNjsaCitations reports not_imported instead of guessing', async () => {
      const result = await verifyNjsaCitations('Pursuant to N.J.S.A. 3B:3-2 …');
      expect(result.status).toBe('not_imported');
      expect(result.checks).toEqual([]);
    });
  });

  describe('after import', () => {
    beforeAll(async () => {
      await wipe();
      const parsed = parseNjsaStatutesText(SAMPLE);
      expect(parsed.sections).toHaveLength(3);
      expect(parsed.updatedThrough).toBe('P.L.2025, c.346, and J.R.22');
      await importNjsaSections(parsed, { minSections: 1 });
    });

    it('records import metadata', async () => {
      const meta = await getNjsaImportMeta();
      expect(meta?.sectionCount).toBe(3);
      expect(meta?.updatedThrough).toBe('P.L.2025, c.346, and J.R.22');
    });

    it('reads a section by any citation spelling', async () => {
      for (const spelling of ['3B:3-2', 'N.J.S.A. 3B:3-2.', 'njsa 3b:3-2', '§ 3B:3-2']) {
        const section = await readNjsaSection(spelling);
        expect(section?.citation).toBe('3B:3-2');
        expect(section?.heading).toContain('witnessed wills');
        expect(section?.text).toContain('signed by at least two individuals');
        expect(section?.currency).toContain('P.L.2025, c.346');
      }
    });

    it('returns null for unknown or malformed citations', async () => {
      expect(await readNjsaSection('3B:99-999')).toBeNull();
      expect(await readNjsaSection('not a citation')).toBeNull();
    });

    it('searches headings by keyword with title filter', async () => {
      const hits = await searchNjsaSections('elective share', { njsaTitle: '3B' });
      expect(hits.map((h) => h.citation)).toContain('3B:8-1');
      const cross = await searchNjsaSections('durable power attorney');
      expect(cross.map((h) => h.citation)).toContain('46:2B-8.1');
    });

    it('extracts and verifies citations from generated content', async () => {
      const content =
        '<p>Executed per <strong>N.J.S.A. 3B:3-2</strong> and N.J.S.A. 46:2B-8.1; ' +
        'see also N.J.S.A. 3B:99-999 (fabricated).</p>';
      expect(extractNjsaCitations(content).sort()).toEqual([
        '3B:3-2',
        '3B:99-999',
        '46:2B-8.1',
      ]);
      const result = await verifyNjsaCitations(content);
      expect(result.status).toBe('warnings');
      const byCitation = new Map(result.checks.map((c) => [c.citation, c]));
      expect(byCitation.get('3B:3-2')?.exists).toBe(true);
      expect(byCitation.get('46:2B-8.1')?.exists).toBe(true);
      expect(byCitation.get('3B:99-999')?.exists).toBe(false);
      expect(result.currency).toContain('P.L.2025');
    });

    it('re-import prunes sections dropped from the source', async () => {
      const smaller = parseNjsaStatutesText(
        ['3B:3-2.  Execution; witnessed wills', '    Same text.'].join('\n'),
      );
      await importNjsaSections(smaller, { minSections: 1 });
      expect(await readNjsaSection('3B:8-1')).toBeNull();
      expect((await readNjsaSection('3B:3-2'))?.citation).toBe('3B:3-2');
      const meta = await getNjsaImportMeta();
      expect(meta?.sectionCount).toBe(1);
    });

    it('refuses a suspiciously small import at default threshold', async () => {
      const parsed = parseNjsaStatutesText(SAMPLE);
      await expect(importNjsaSections(parsed)).rejects.toThrow(
        /source format may have changed/,
      );
    });
  });

  describe('pure helpers', () => {
    it('normalizes citation spellings', () => {
      expect(normalizeNjsaCitation('N.J.S.A. 3B:12A-1.')).toBe('3B:12A-1');
      expect(normalizeNjsaCitation('46:2B-8.1')).toBe('46:2B-8.1');
      expect(normalizeNjsaCitation('26 U.S.C. 2010')).toBeNull();
    });

    it('tokenizes headings for the keyword index', () => {
      expect(headingTokens('Elective share of surviving spouse.')).toEqual(
        expect.arrayContaining(['elective', 'share', 'surviving', 'spouse']),
      );
      expect(headingTokens(null)).toEqual([]);
    });
  });
});
