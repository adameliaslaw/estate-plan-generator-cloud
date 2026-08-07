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
import {
  buildReport,
  classifyFinding,
  parseBlockReasons,
  parseSeedFamilyIds,
  projectFamily,
  rosterTermOf,
  type BlockReasonBreakdown,
} from '../src/stages/clause-audit.js';

const fam = (
  familyId: string,
  occurrences: number,
  blocked: boolean,
  category = 'trustee-powers',
  pipelineVersion: string | null = null,
  updatedAt: string | null = null,
): {
  familyId: string;
  occurrences: number;
  blocked: boolean;
  category: string;
  pipelineVersion: string | null;
  updatedAt: string | null;
} => ({ familyId, occurrences, blocked, category, pipelineVersion, updatedAt });

/** The block-reason join is exercised on its own; most tests do not need it. */
const NO_REASONS: BlockReasonBreakdown = {
  status: 'unavailable',
  reason: 'not supplied by this test',
};

const build = (
  families: ReturnType<typeof fam>[],
  seed: { ids: Set<string> } | { unavailableReason: string },
  blockReasons: BlockReasonBreakdown = NO_REASONS,
): ReturnType<typeof buildReport> =>
  buildReport('firm-1', 'run-1', '2026-08-06T00:00:00.000Z', families, seed, blockReasons);

/** Shapes one canonical-artifact family the way `canonicalize` writes it. */
const canon = (familyId: string, piiFindings: string[]): Record<string, unknown> => ({
  familyId,
  piiFindings,
  // Text fields a real artifact carries — the parser must never surface them.
  canonicalText: 'SECRET-CANONICAL-TEXT',
  title: 'SECRET-TITLE',
});

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
      // Stamps: metadata, not text, and already in catalog.ts's blocked-doc
      // allow-list, so a blocked family reports its generation too.
      pipelineVersion: 'cm/3',
      updatedAt: '2026-08-04T18:31:00.000Z',
    });
    expect(projected).toEqual({
      familyId: 'f1',
      occurrences: 12,
      blocked: false,
      category: 'distribution',
      pipelineVersion: 'cm/3',
      updatedAt: '2026-08-04T18:31:00.000Z',
    });
  });

  it('reports a missing generation stamp as null rather than inventing one', () => {
    const projected = projectFamily('f', { counts: { occurrences: 3 }, piiScanStatus: 'clean' });
    expect(projected?.pipelineVersion).toBeNull();
    expect(projected?.updatedAt).toBeNull();
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
    // Names the SEED reading rather than the bare word: other sections report
    // their own availability, and a blanket match would fail on those instead.
    expect(genuine.readings.join(' ')).not.toContain('Seed cross-tabulation UNAVAILABLE');
    expect(genuine.readings.join(' ')).toContain('0 of 0 seed-matched');
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

/* ------------------------------------------------------------------ */
/* Block reasons — the measurement C1 actually turns on               */
/* ------------------------------------------------------------------ */

describe('classifyFinding — which net fired', () => {
  it('separates the three situations the old bare label conflated', () => {
    expect(classifyFinding('haiku-gate-flagged:abc123')).toBe('gate-flagged');
    expect(classifyFinding('haiku-gate-error:abc123')).toBe('gate-error');
    expect(classifyFinding('haiku-gate-missing:abc123')).toBe('gate-missing');
  });

  it('keeps the legacy label as its own mechanism rather than guessing', () => {
    // Every family in the pilot-1 artifact carries this. Folding it into
    // `gate-flagged` would assert the model objected when the artifact does
    // not record whether it even ran.
    expect(classifyFinding('haiku-gate:abc123')).toBe('gate-unspecified');
  });

  it('classifies roster hits and refuses to silently drop anything else', () => {
    expect(classifyFinding('roster:Pensabene@a1b2c3d4e5f6:412')).toBe('roster');
    expect(classifyFinding('something-new:xyz')).toBe('unrecognized');
  });
});

describe('roster terms are counted, never emitted', () => {
  it('extracts the term for counting', () => {
    expect(rosterTermOf('roster:Pensabene@a1b2c3d4e5f6:412')).toBe('Pensabene');
    // A two-word term, and one containing an @, still split on the LAST @.
    expect(rosterTermOf('roster:Karen M. Clayton@a1b2c3d4e5f6:7')).toBe('Karen M. Clayton');
    expect(rosterTermOf('haiku-gate:abc')).toBeNull();
  });

  it('the serialised report contains no roster term and no artifact text', () => {
    const raw = JSON.stringify([
      canon('f1', ['roster:Pensabene@a1b2c3d4e5f6:412', 'roster:Pensabene@ffffffffffff:9']),
      canon('f2', ['roster:Clayton@bbbbbbbbbbbb:3']),
    ]);
    const reasons = parseBlockReasons(raw, new Set(['f1', 'f2']));
    const json = JSON.stringify(
      build([fam('f1', 9, true), fam('f2', 4, true)], { ids: new Set<string>() }, reasons),
    );
    expect(json).not.toContain('Pensabene');
    expect(json).not.toContain('Clayton');
    expect(json).not.toContain('SECRET-CANONICAL-TEXT');
    expect(json).not.toContain('SECRET-TITLE');
    // Two distinct surnames across three hits.
    expect(reasons).toMatchObject({ status: 'ok', distinctRosterTerms: 2 });
  });
});

describe('parseBlockReasons', () => {
  it('splits families by which nets fired', () => {
    const raw = JSON.stringify([
      canon('rosterOnly', ['roster:Smith@aaaaaaaaaaaa:1']),
      canon('gateOnly', ['haiku-gate-flagged:bbbbbbbbbbbb']),
      canon('both', ['roster:Jones@cccccccccccc:2', 'haiku-gate-error:cccccccccccc']),
    ]);
    const reasons = parseBlockReasons(raw, new Set(['rosterOnly', 'gateOnly', 'both']));
    expect(reasons).toMatchObject({
      status: 'ok',
      families: { rosterOnly: 1, gateOnly: 1, both: 1, blockedWithNoFindings: 0 },
      findings: { roster: 2, 'gate-flagged': 1, 'gate-error': 1 },
    });
  });

  it('ignores artifact families the catalog does not report as blocked', () => {
    const raw = JSON.stringify([
      canon('blocked', ['roster:Smith@aaaaaaaaaaaa:1']),
      canon('cleanNow', ['roster:Stale@bbbbbbbbbbbb:1']),
    ]);
    const reasons = parseBlockReasons(raw, new Set(['blocked']));
    expect(reasons).toMatchObject({
      status: 'ok',
      coverage: { catalogBlocked: 1, matchedInArtifact: 1, missingFromArtifact: 0 },
      distinctRosterTerms: 1,
    });
  });

  it('counts blocked families the artifact does not cover — the staleness signal', () => {
    const raw = JSON.stringify([canon('here', ['haiku-gate:aaaaaaaaaaaa'])]);
    const reasons = parseBlockReasons(raw, new Set(['here', 'fromAnOlderGeneration']));
    expect(reasons).toMatchObject({
      status: 'ok',
      coverage: { catalogBlocked: 2, matchedInArtifact: 1, missingFromArtifact: 1 },
    });
    const report = build(
      [fam('here', 5, true), fam('fromAnOlderGeneration', 5, true)],
      { ids: new Set<string>() },
      reasons,
    );
    expect(report.readings.join(' ')).toContain('ABSENT from the canonical artifact');
  });

  it('surfaces blocked-with-no-findings as a defect rather than a clean family', () => {
    const reasons = parseBlockReasons(JSON.stringify([canon('f', [])]), new Set(['f']));
    expect(reasons).toMatchObject({ status: 'ok', families: { blockedWithNoFindings: 1 } });
    const report = build([fam('f', 5, true)], { ids: new Set<string>() }, reasons);
    expect(report.readings.join(' ')).toContain('should be impossible');
  });

  it('throws on a malformed artifact instead of returning an empty breakdown', () => {
    expect(() => parseBlockReasons('{"families":[]}', new Set(['f']))).toThrow(/not an array/);
    expect(() => parseBlockReasons('not json', new Set(['f']))).toThrow();
  });
});

describe('block reasons — a failure must not resemble a finding', () => {
  it('says UNKNOWN, not zero, when the canonical artifact cannot be read', () => {
    const report = build([fam('a', 9, true)], { ids: new Set<string>() }, {
      status: 'unavailable',
      reason: 'no canonical artifact at gs://x — canonicalize has not run for RUN_ID=pilot-1',
    });
    expect(report.blockReasons.status).toBe('unavailable');
    const prose = report.readings.join(' ');
    expect(prose).toContain('UNAVAILABLE');
    expect(prose).toContain('not "no reasons found"');
  });

  it('warns that legacy gate findings cannot be read as model objections', () => {
    const raw = JSON.stringify([canon('f', ['haiku-gate:aaaaaaaaaaaa'])]);
    const reasons = parseBlockReasons(raw, new Set(['f']));
    const report = build([fam('f', 9, true)], { ids: new Set<string>() }, reasons);
    expect(report.readings.join(' ')).toContain('treat gate-only blocks as unexplained');
  });

  it('reports the roster/gate split the C1 decision needs', () => {
    const raw = JSON.stringify([
      canon('a', ['roster:Smith@aaaaaaaaaaaa:1']),
      canon('b', ['haiku-gate-flagged:bbbbbbbbbbbb']),
      canon('c', ['haiku-gate-flagged:cccccccccccc']),
    ]);
    const reasons = parseBlockReasons(raw, new Set(['a', 'b', 'c']));
    const report = build(
      [fam('a', 9, true), fam('b', 9, true), fam('c', 9, true)],
      { ids: new Set<string>() },
      reasons,
    );
    expect(report.readings.join(' ')).toContain('1 had a roster hit');
    expect(report.readings.join(' ')).toContain('2 were blocked by the model gate ALONE');
  });
});

/* ------------------------------------------------------------------ */
/* Generations — the 477-vs-302 reconciliation                        */
/* ------------------------------------------------------------------ */

describe('generation grouping', () => {
  it('groups by pipelineVersion and bounds updatedAt', () => {
    const report = build(
      [
        fam('a', 5, true, 'tax', 'cm/3', '2026-08-04T18:31:00.000Z'),
        fam('b', 7, false, 'tax', 'cm/3', '2026-08-04T18:35:00.000Z'),
        fam('c', 9, true, 'tax', 'cm/2', '2026-08-03T19:00:00.000Z'),
      ],
      { ids: new Set<string>() },
    );
    expect(report.generations).toEqual([
      {
        pipelineVersion: 'cm/3',
        families: 2,
        blocked: 1,
        occurrencesTotal: 12,
        updatedAtEarliest: '2026-08-04T18:31:00.000Z',
        updatedAtLatest: '2026-08-04T18:35:00.000Z',
      },
      {
        pipelineVersion: 'cm/2',
        families: 1,
        blocked: 1,
        occurrencesTotal: 9,
        updatedAtEarliest: '2026-08-03T19:00:00.000Z',
        updatedAtLatest: '2026-08-03T19:00:00.000Z',
      },
    ]);
  });

  it('warns when the collection spans generations, so totals are not a run result', () => {
    const report = build(
      [fam('a', 5, true, 'tax', 'cm/3'), fam('b', 5, true, 'tax', 'cm/2')],
      { ids: new Set<string>() },
    );
    expect(report.readings.join(' ')).toContain('spans 2 pipeline generations');
    expect(report.readings.join(' ')).toContain('not of any single run');
  });

  it('stays silent when every family is one generation', () => {
    const report = build(
      [fam('a', 5, true, 'tax', 'cm/3'), fam('b', 5, true, 'tax', 'cm/3')],
      { ids: new Set<string>() },
    );
    expect(report.generations).toHaveLength(1);
    expect(report.readings.join(' ')).not.toContain('pipeline generations');
  });

  it('buckets unstamped docs visibly rather than dropping them', () => {
    const report = build([fam('a', 5, true), fam('b', 5, true, 'tax', 'cm/3')], {
      ids: new Set<string>(),
    });
    expect(report.generations.map((g) => g.pipelineVersion).sort()).toEqual(['(unstamped)', 'cm/3']);
  });
});
