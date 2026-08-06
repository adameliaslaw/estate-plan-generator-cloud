/**
 * clause-audit — HOMEWORK J1. Read-only corpus composition audit.
 *
 * Answers the question C1 was reframed around: *which* clauses are worth
 * carrying, measured rather than asserted. It reports the occurrence-frequency
 * distribution across the catalog and cross-tabulates it against `piiScanStatus`
 * and seed-match, so two things become facts instead of guesses:
 *
 *   1. How much of the corpus is single-occurrence text that survived
 *      extraction (low reuse — fails the value test's reuse criterion) versus
 *      genuinely recurring drafting content.
 *   2. Whether the PII-blocked families skew toward the high-occurrence,
 *      seed-matched end. If they do, value is trapped behind the gate and the
 *      over-aggression tuning is warranted. If they skew toward singletons, it
 *      is cleanup.
 *
 * ── Confidentiality ──────────────────────────────────────────────────────
 * METADATA ONLY. This stage never reads clause text. It projects an explicit
 * allow-list of numeric/enum fields off each catalog doc and ignores
 * everything else, so `canonicalText`, `title`, `functionSummary`,
 * `switchName`, `placeholders`, `embedding` and `triggerCard.prose` are never
 * loaded into the report even for families that are NOT blocked and therefore
 * still carry them. Nothing is unblocked and the PII gate is not touched: this
 * stage only reads, and `counts` survives `scrubBlockedCatalogDoc` by design.
 *
 * ── Failure must not resemble a finding (CLAUDE.md rule 10) ───────────────
 * An empty catalog is NOT "0 families, none blocked" — it is an error, and the
 * stage says so and exits non-zero. A missing or unreadable seed-match blob is
 * NOT "0 seed-matched families" — every seed-derived figure becomes `null` and
 * `seedJoin.status` reads `unavailable` with a reason. A reader can always tell
 * "we looked and found nothing" apart from "we could not look".
 */
import type { BlobStore, DocData, DocStore } from '../clients/interfaces.js';
import type { Env } from '../env.js';
import { catalogCollection, clauseAuditPath, seedMatchPath } from '../paths.js';

/** Upper bound of each occurrence band; the last is open-ended. */
const BANDS: ReadonlyArray<{ label: string; min: number; max: number }> = [
  { label: '1', min: 1, max: 1 },
  { label: '2', min: 2, max: 2 },
  { label: '3-5', min: 3, max: 5 },
  { label: '6-10', min: 6, max: 10 },
  { label: '11-25', min: 11, max: 25 },
  { label: '26-50', min: 26, max: 50 },
  { label: '51+', min: 51, max: Number.POSITIVE_INFINITY },
];

export interface BandRow {
  band: string;
  families: number;
  blocked: number;
  clean: number;
  /** null when the seed join is unavailable — never silently 0. */
  seedMatched: number | null;
  occurrencesTotal: number;
}

export interface ClauseAuditReport {
  firmId: string;
  runId: string;
  generatedAt: string;
  catalog: {
    status: 'ok' | 'empty';
    families: number;
    blocked: number;
    clean: number;
    reason?: string;
  };
  seedJoin: {
    status: 'ok' | 'unavailable';
    reason?: string;
    /** Families the curated seed matched. null when unavailable. */
    matchedFamilies: number | null;
    /** Seed-matched families that are ALSO PII-blocked — the trapped-value number. */
    matchedAndBlocked: number | null;
  };
  occurrence: {
    total: number;
    min: number;
    max: number;
    median: number;
    mean: number;
    /** Share of families appearing exactly once — extraction noise, by hypothesis. */
    singletonShare: number;
    bands: BandRow[];
  };
  /** Blocked share overall vs within the high-occurrence tail — the C1 signal. */
  blockedSkew: {
    blockedShareOverall: number;
    highOccurrenceThreshold: number;
    highOccurrenceFamilies: number;
    blockedShareOfHighOccurrence: number;
  };
  categories: Array<{ category: string; families: number; blocked: number; occurrencesTotal: number }>;
  /** Plain-English readings. Never a decision — J1 measures, C1 decides. */
  readings: string[];
}

export interface ClauseAuditDeps {
  store: DocStore;
  blobs: BlobStore;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The ONLY fields read off a catalog doc. Adding a text field here would be a
 * confidentiality regression — see the header note.
 */
interface FamilyMetadata {
  familyId: string;
  occurrences: number;
  blocked: boolean;
  category: string;
}

export function projectFamily(id: string, data: DocData): FamilyMetadata | null {
  const counts = asRecord(data.counts);
  const occurrences = counts === null ? null : asFiniteNumber(counts.occurrences);
  if (occurrences === null) return null;
  const status = data.piiScanStatus;
  const category = data.category;
  return {
    familyId: id,
    occurrences,
    // Mirrors catalog.ts: anything not exactly 'clean' is blocked.
    blocked: status !== 'clean',
    category: typeof category === 'string' && category !== '' ? category : 'uncategorized',
  };
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Parses the seed-match blob into the set of family ids the seed matched. */
export function parseSeedFamilyIds(raw: string): Set<string> {
  const parsed: unknown = JSON.parse(raw);
  const root = asRecord(parsed);
  const matches = root === null ? null : root.matches;
  if (!Array.isArray(matches)) {
    throw new Error('seed-match blob has no `matches` array');
  }
  const ids = new Set<string>();
  for (const entry of matches) {
    const match = asRecord(entry);
    const familyId = match === null ? undefined : match.familyId;
    if (typeof familyId === 'string' && familyId !== '') ids.add(familyId);
  }
  return ids;
}

export function buildReport(
  firmId: string,
  runId: string,
  generatedAt: string,
  families: readonly FamilyMetadata[],
  seed: { ids: Set<string> } | { unavailableReason: string },
): ClauseAuditReport {
  const seedIds = 'ids' in seed ? seed.ids : null;
  const blocked = families.filter((f) => f.blocked);
  const counts = families.map((f) => f.occurrences).sort((a, b) => a - b);
  const total = counts.reduce((sum, n) => sum + n, 0);

  const bands: BandRow[] = BANDS.map((band) => {
    const inBand = families.filter((f) => f.occurrences >= band.min && f.occurrences <= band.max);
    return {
      band: band.label,
      families: inBand.length,
      blocked: inBand.filter((f) => f.blocked).length,
      clean: inBand.filter((f) => !f.blocked).length,
      seedMatched: seedIds === null ? null : inBand.filter((f) => seedIds.has(f.familyId)).length,
      occurrencesTotal: inBand.reduce((sum, f) => sum + f.occurrences, 0),
    };
  });

  // "High occurrence" = the reuse tail the value test cares about. 6+ is the
  // first band where a family has appeared in enough matters that reuse is not
  // plausibly coincidental. Stated explicitly so it can be argued with.
  const HIGH = 6;
  const high = families.filter((f) => f.occurrences >= HIGH);
  const share = (num: number, den: number): number => (den === 0 ? 0 : num / den);

  const byCategory = new Map<string, { families: number; blocked: number; occurrencesTotal: number }>();
  for (const fam of families) {
    const row = byCategory.get(fam.category) ?? { families: 0, blocked: 0, occurrencesTotal: 0 };
    row.families++;
    if (fam.blocked) row.blocked++;
    row.occurrencesTotal += fam.occurrences;
    byCategory.set(fam.category, row);
  }

  const matchedFamilies =
    seedIds === null ? null : families.filter((f) => seedIds.has(f.familyId)).length;
  const matchedAndBlocked =
    seedIds === null ? null : blocked.filter((f) => seedIds.has(f.familyId)).length;

  const blockedShareOverall = share(blocked.length, families.length);
  const blockedShareOfHigh = share(high.filter((f) => f.blocked).length, high.length);
  const singletonShare = share(families.filter((f) => f.occurrences === 1).length, families.length);

  const readings: string[] = [];
  readings.push(
    `${(singletonShare * 100).toFixed(1)}% of families occur exactly once. Under the value test's reuse criterion these are extraction noise rather than library candidates.`,
  );
  if (blockedShareOfHigh > blockedShareOverall + 0.05) {
    readings.push(
      `PII-blocked families are OVER-represented in the ${HIGH}+ occurrence tail (${(blockedShareOfHigh * 100).toFixed(1)}% vs ${(blockedShareOverall * 100).toFixed(1)}% overall). This is evidence that value IS trapped behind the gate, and that the over-aggression tuning is warranted.`,
    );
  } else if (blockedShareOfHigh < blockedShareOverall - 0.05) {
    readings.push(
      `PII-blocked families are UNDER-represented in the ${HIGH}+ occurrence tail (${(blockedShareOfHigh * 100).toFixed(1)}% vs ${(blockedShareOverall * 100).toFixed(1)}% overall). On this evidence the blocked set is mostly low-reuse text and tuning is cleanup, not value recovery.`,
    );
  } else {
    readings.push(
      `PII-blocked families are distributed roughly evenly across occurrence bands (${(blockedShareOfHigh * 100).toFixed(1)}% of the ${HIGH}+ tail vs ${(blockedShareOverall * 100).toFixed(1)}% overall). The blocking is not selecting for reuse either way.`,
    );
  }
  if (matchedAndBlocked === null) {
    readings.push(
      'Seed cross-tabulation UNAVAILABLE — the seed-matched figures in this report are null, not zero. No conclusion about expert-curated families can be drawn from this run.',
    );
  } else {
    readings.push(
      `${matchedAndBlocked} of ${matchedFamilies ?? 0} seed-matched (expert-curated) families are PII-blocked. These carry independent evidence of value and are the highest-priority candidates for remediation.`,
    );
  }
  readings.push(
    'This stage measures. It does not decide C1, and it recommends no target count.',
  );

  return {
    firmId,
    runId,
    generatedAt,
    catalog: {
      status: families.length === 0 ? 'empty' : 'ok',
      families: families.length,
      blocked: blocked.length,
      clean: families.length - blocked.length,
      ...(families.length === 0
        ? { reason: 'catalog collection returned no families carrying counts.occurrences' }
        : {}),
    },
    seedJoin:
      seedIds === null
        ? {
            status: 'unavailable',
            reason: 'unavailableReason' in seed ? seed.unavailableReason : 'unknown',
            matchedFamilies: null,
            matchedAndBlocked: null,
          }
        : { status: 'ok', matchedFamilies, matchedAndBlocked },
    occurrence: {
      total,
      min: counts.length === 0 ? 0 : counts[0],
      max: counts.length === 0 ? 0 : counts[counts.length - 1],
      median: median(counts),
      mean: counts.length === 0 ? 0 : total / counts.length,
      singletonShare,
      bands,
    },
    blockedSkew: {
      blockedShareOverall,
      highOccurrenceThreshold: HIGH,
      highOccurrenceFamilies: high.length,
      blockedShareOfHighOccurrence: blockedShareOfHigh,
    },
    categories: [...byCategory.entries()]
      .map(([category, row]) => ({ category, ...row }))
      .sort((a, b) => b.occurrencesTotal - a.occurrencesTotal),
    readings,
  };
}

export async function runClauseAudit(
  deps: ClauseAuditDeps,
  env: Env,
): Promise<ClauseAuditReport> {
  const docs = await deps.store.listDocs(catalogCollection(env.firmId));
  const families: FamilyMetadata[] = [];
  for (const doc of docs) {
    const projected = projectFamily(doc.id, doc.data);
    if (projected !== null) families.push(projected);
  }

  // The seed blob is per-run. A missing one is a distinct, reportable state —
  // never folded into a zero.
  let seed: { ids: Set<string> } | { unavailableReason: string };
  const seedPath = seedMatchPath(env.firmId, env.runId);
  try {
    if (await deps.blobs.exists(seedPath)) {
      seed = { ids: parseSeedFamilyIds((await deps.blobs.read(seedPath)).toString('utf8')) };
    } else {
      seed = {
        unavailableReason: `no seed-match blob at ${seedPath} — canonicalize has not run for RUN_ID=${env.runId}`,
      };
    }
  } catch (error) {
    seed = {
      unavailableReason: `seed-match blob at ${seedPath} could not be read or parsed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const report = buildReport(
    env.firmId,
    env.runId,
    new Date().toISOString(),
    families,
    seed,
  );
  await deps.blobs.write(clauseAuditPath(env.firmId, env.runId), JSON.stringify(report, null, 2));
  return report;
}
