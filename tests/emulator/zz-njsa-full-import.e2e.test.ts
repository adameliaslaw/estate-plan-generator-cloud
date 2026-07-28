/**
 * tests/emulator/zz-njsa-full-import.e2e.test.ts
 *
 * Full-scale proof run (gated): imports the ENTIRE official NJSA bulk file
 * (~55k sections) into the Firestore emulator, then exercises reads, search,
 * and generated-document citation verification at production scale.
 *
 * Skipped unless NJSA_ZIP_PATH points at a downloaded STATUTES-TEXT.zip:
 *   NJSA_ZIP_PATH=/path/STATUTES-TEXT.zip npx firebase-tools emulators:exec \
 *     --only firestore,auth --project demo-eplan \
 *     "npx vitest run --config vitest.emulator.config.ts zz-njsa-full-import"
 */

import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import './_emulator';
import JSZip from '../../functions/node_modules/jszip';
import {
  importNjsaSections,
  parseNjsaStatutesText,
  readNjsaSection,
  searchNjsaSections,
  verifyNjsaCitations,
} from '../../functions/src/njsa-statutes';

const zipPath = process.env.NJSA_ZIP_PATH;

describe.skipIf(!zipPath)('NJSA full-scale import (real bulk file)', () => {
  it('imports all sections and serves reads, search, and verification', async () => {
    const zip = await JSZip.loadAsync(readFileSync(zipPath!));
    const entry = zip.file(/statutes\.txt$/i)[0];
    expect(entry).toBeTruthy();
    const text = new TextDecoder('windows-1252').decode(
      await entry.async('uint8array'),
    );

    const parsed = parseNjsaStatutesText(text);
    console.log(
      `parsed: ${parsed.sections.length} sections / ${parsed.titleCount} titles / through ${parsed.updatedThrough}`,
    );
    expect(parsed.sections.length).toBeGreaterThan(50_000);

    const t0 = Date.now();
    const meta = await importNjsaSections(parsed);
    console.log(
      `imported ${meta.sectionCount} sections in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );

    // Exact reads across the estate planning core.
    const will = await readNjsaSection('N.J.S.A. 3B:3-2');
    expect(will?.heading).toContain('witnessed wills');
    expect(will?.text).toContain('two individuals');
    const elective = await readNjsaSection('3B:8-1');
    expect(elective?.heading?.toLowerCase()).toContain('elective share');
    const utc = await readNjsaSection('3B:31-19');
    expect(utc?.text).toContain('capacity to create a trust');
    console.log('reads OK:', will?.citation, elective?.citation, utc?.citation);

    // Topic search at full scale.
    const hits = await searchNjsaSections('self-proving affidavit will', {
      njsaTitle: '3B',
    });
    console.log(
      'search "self-proving affidavit will" →',
      hits.slice(0, 5).map((h) => `${h.citation} (${h.heading})`),
    );
    expect(hits.length).toBeGreaterThan(0);

    // Deterministic citation verification of a generated document: the POA
    // the pipeline produced cites 46:2B-8.1; add one fabricated citation.
    const verification = await verifyNjsaCitations(
      '<p>Durable per N.J.S.A. 46:2B-8.1; executed per N.J.S.A. 3B:3-2; ' +
        'see also N.J.S.A. 99Z:1-1 (fabricated).</p>',
    );
    console.log('verification:', JSON.stringify(verification, null, 1));
    expect(verification.status).toBe('warnings');
    const byCitation = new Map(verification.checks.map((c) => [c.citation, c.exists]));
    expect(byCitation.get('46:2B-8.1')).toBe(true);
    expect(byCitation.get('3B:3-2')).toBe(true);
    expect(byCitation.get('99Z:1-1')).toBe(false);
  }, 900_000);
});
