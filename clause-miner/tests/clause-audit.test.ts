/**
 * clause-audit (HOMEWORK J1) — read-only corpus composition audit.
 *
 * Two properties matter more than the arithmetic, and both are load-bearing
 * for the decision J1 feeds (C1):
 *
 *   1. **A failure must not resemble a finding** (CLAUDE.md rule 10). A missing
 *      seed blob must produce `null`, never `0` — reporting "0 seed-matched
 *      families" when we simply could not look would argue *against* the PII
 *      tuning on the strength of a read error.
 *   2. **Metadata only.** The report must carry no clause text even when the
 *      input docs do (clean families still hold `canonicalText` etc.).
 */
import { describe, expect, it } from 'vitest';
import { buildReport, parseSeedFamilyIds, projectFamily } from '../src/stages/clause-audit.js';

const fam = (
  familyId: string,
  occurrences: number,
  blocked: boolean,
  category = 'trustee-powers',
): { familyId: string; occurrences: number; blocked: boolean; category: string } => ({
  familyId,
  occurrences,
  blocked,
  category,
});

const build = (
  families: ReturnType<typeof fam>[],
  seed: { ids: Set<string> } | { unavailableReason: string },
): ReturnType<typeof buildReport> =>
  buildReport('firm-1', 'run-1', '2026-08-06T00:00:00.000Z', families, seed);

describe('projectFamily — metadata allow-list', () => {
  it('reads only counts/status/category and drops every text field', () => {
    const projected = projectFamily('f1', {
      counts: { occurrences: 12, documents: 4, matters: 3 },
      piiScanStatus: 'clean',
      category: 'distribution',
      // All of the following exist on a CLEAN catalog doc and must be ignored.
      canonicalText: 'I give all my jewelry to my daughter [NAME].',
      title: 'Specific gift of tangible personal property',
      functionSummary: 'Gives named chattels to a named beneficiary.',
      switchName: 'specificGift',
      placeholders: [{ tag: '[NAME]' }],
      embedding: [0.1, 0.2],
    });
    expect(projected).toEqual({
      familyId: 'f1',
      occurrences: 12,
      blocked: false,
      category: 'distribution',
    });
  });

  it('treats any non-clean piiScanStatus as blocked, matching catalog.ts', () => {
    expect(projectFamily('f', { counts: { occurrences: 1 }, piiScanStatus: 'blocked' })?.blocked).toBe(true);
    expect(projectFamily('f', { counts: { occurrences: 1 }, piiScanStatus: 'unscanned' })?.blocked).toBe(true);
    expect(projectFamily('f', { counts: { occurrences: 1 }, piiScanStatus: 'clean' })?.blocked).toBe(false);
  });

  it('skips docs with no usable occurrence count rather than scoring them zero', () => {
    expect(projectFamily('f', { piiScanStatus: 'clean' })).toBeNull();
    expect(projectFamily('f', { counts: {}, piiScanStatus: 'clean' })).toBeNull();
    expect(projectFamily('f', { counts: { occurrences: 'lots' }, piiScanStatus: 'clean' })).toBeNull();
  });
});

describe('report carries no clause text', () => {
  it('serialises without any text-bearing field from the source docs', () => {
    const projected = projectFamily('f1', {
      counts: { occurrences: 9 },
      piiScanStatus: 'clean',
      category: 'distribution',
      canonicalText: 'SECRET-CLAUSE-TEXT',
      title: 'SECRET-TITLE',
      functionSummary: 'SECRET-SUMMARY',
    });
    expect(projected).not.toBeNull();
    const json = JSON.stringify(build([projected!], { ids: new Set(['f1']) }));
    expect(json).not.toContain('SECRET-CLAUSE-TEXT');
    expect(json).not.toContain('SECRET-TITLE');
    expect(json).not.toContain('SECRET-SUMMARY');
  });
});

describe('failure must not resemble a finding', () => {
  const families = [fam('a', 1, false), fam('b', 20, true)];

  it('reports seed figures as null — never 0 — when the seed blob is missing', () => {
    const report = build(families, { unavailableReason: 'no seed-match blob at gs://x' });
    expect(report.seedJoin.status).toBe('unavailable');
    expect(report.seedJoin.matchedFamilies).toBeNull();
    expect(report.seedJoin.matchedAndBlocked).toBeNull();
    // The per-band figure must be null too, or a table reader sees zeros.
    for (const band of report.occurrence.bands) expect(band.seedMatched).toBeNull();
    expect(report.seedJoin.reason).toContain('no seed-match blob');
    expect(report.readings.join(' ')).toContain('UNAVAILABLE');
  });

  it('distinguishes a genuine zero from an unavailable join', () => {
    const genuine = build(families, { ids: new Set<string>() });
    expect(genuine.seedJoin.status).toBe('ok');
    expect(genuine.seedJoin.matchedFamilies).toBe(0);
    expect(genuine.readings.join(' ')).not.toContain('UNAVAILABLE');
  });

  it('flags an empty catalog as empty rather than a clean audit of nothing', () => {
    const report = build([], { ids: new Set(['a']) });
    expect(report.catalog.status).toBe('empty');
    expect(report.catalog.reason).toBeDefined();
  });

  it('rejects a malformed seed blob loudly instead of yielding an empty set', () => {
    expect(() => parseSeedFamilyIds('{"pieces":[]}')).toThrow(/matches/);
    expect(() => parseSeedFamilyIds('not json')).toThrow();
  });

  it('parses familyIds out of a well-formed seed blob', () => {
    const raw = JSON.stringify({ matches: [{ familyId: 'a' }, { familyId: 'b' }, { familyId: 'a' }] });
    expect(parseSeedFamilyIds(raw)).toEqual(new Set(['a', 'b']));
  });
});

describe('the C1 signal — does blocking skew toward the reuse tail?', () => {
  it('reports over-representation when blocked families dominate the 6+ tail', () => {
    const families = [
      ...Array.from({ length: 10 }, (_, i) => fam(`lo${i}`, 1, false)),
      ...Array.from({ length: 10 }, (_, i) => fam(`hi${i}`, 30, true)),
    ];
    const report = build(families, { ids: new Set<string>() });
    expect(report.blockedSkew.blockedShareOfHighOccurrence).toBe(1);
    expect(report.blockedSkew.blockedShareOverall).toBe(0.5);
    expect(report.readings.join(' ')).toContain('OVER-represented');
    expect(report.readings.join(' ')).toContain('tuning is warranted');
  });

  it('reports under-representation when the blocked set is mostly singletons', () => {
    const families = [
      ...Array.from({ length: 10 }, (_, i) => fam(`lo${i}`, 1, true)),
      ...Array.from({ length: 10 }, (_, i) => fam(`hi${i}`, 30, false)),
    ];
    const report = build(families, { ids: new Set<string>() });
    expect(report.blockedSkew.blockedShareOfHighOccurrence).toBe(0);
    expect(report.readings.join(' ')).toContain('UNDER-represented');
    expect(report.readings.join(' ')).toContain('cleanup');
  });

  it('counts seed-matched families that are also blocked — the trapped-value number', () => {
    const families = [fam('seeded-blocked', 40, true), fam('seeded-clean', 40, false), fam('plain', 2, true)];
    const report = build(families, { ids: new Set(['seeded-blocked', 'seeded-clean']) });
    expect(report.seedJoin.matchedFamilies).toBe(2);
    expect(report.seedJoin.matchedAndBlocked).toBe(1);
    expect(report.readings.join(' ')).toContain('1 of 2 seed-matched');
  });
});

describe('distribution arithmetic', () => {
  const families = [
    fam('a', 1, false),
    fam('b', 1, true),
    fam('c', 4, false),
    fam('d', 8, true),
    fam('e', 60, false),
  ];

  it('bands families without gaps or double-counting', () => {
    const report = build(families, { ids: new Set(['e']) });
    const byBand = Object.fromEntries(report.occurrence.bands.map((b) => [b.band, b.families]));
    expect(byBand['1']).toBe(2);
    expect(byBand['3-5']).toBe(1);
    expect(byBand['6-10']).toBe(1);
    expect(byBand['51+']).toBe(1);
    const banded = report.occurrence.bands.reduce((sum, b) => sum + b.families, 0);
    expect(banded).toBe(families.length);
  });

  it('computes totals, median and singleton share', () => {
    const report = build(families, { ids: new Set<string>() });
    expect(report.occurrence.total).toBe(74);
    expect(report.occurrence.median).toBe(4);
    expect(report.occurrence.max).toBe(60);
    expect(report.occurrence.singletonShare).toBeCloseTo(0.4);
    expect(report.catalog.blocked).toBe(2);
    expect(report.catalog.clean).toBe(3);
  });

  it('aggregates categories by total occurrences', () => {
    const report = build(
      [fam('a', 5, false, 'tax'), fam('b', 50, true, 'powers'), fam('c', 1, false, 'tax')],
      { ids: new Set<string>() },
    );
    expect(report.categories[0]).toEqual({
      category: 'powers',
      families: 1,
      blocked: 1,
      occurrencesTotal: 50,
    });
  });
});
