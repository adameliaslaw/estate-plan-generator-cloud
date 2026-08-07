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
import { canonicalPath, catalogCollection, clauseAuditPath, seedMatchPath } from '../paths.js';

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

/**
 * Which net fired, per §5.3. `piiFindings` entries name the mechanism, so the
 * question C1 turns on — is the 94.5% block rate an over-aggressive scanner or
 * real client names in the text? — is answerable from metadata alone.
 *
 * `gate-unspecified` is the pre-2026-08-07 label. `canonicalize` used to write
 * a bare `haiku-gate:` for three different situations (model objected, batch
 * call errored, no verdict returned at all), so an artifact written before that
 * change genuinely cannot distinguish them. It reports as its own mechanism
 * rather than being folded into `gate-flagged` — guessing would manufacture
 * exactly the false precision this stage exists to avoid.
 */
export type BlockMechanism =
  | 'roster'
  | 'gate-flagged'
  | 'gate-error'
  | 'gate-missing'
  | 'gate-unspecified'
  | 'unrecognized';

const MECHANISM_PREFIXES: ReadonlyArray<{ prefix: string; mechanism: BlockMechanism }> = [
  // Longest-first: `haiku-gate:` is a prefix of nothing else, but the three
  // specific labels all start with `haiku-gate-`, so they must be tested first.
  { prefix: 'haiku-gate-flagged:', mechanism: 'gate-flagged' },
  { prefix: 'haiku-gate-error:', mechanism: 'gate-error' },
  { prefix: 'haiku-gate-missing:', mechanism: 'gate-missing' },
  { prefix: 'haiku-gate:', mechanism: 'gate-unspecified' },
  { prefix: 'roster:', mechanism: 'roster' },
];

export function classifyFinding(finding: string): BlockMechanism {
  for (const { prefix, mechanism } of MECHANISM_PREFIXES) {
    if (finding.startsWith(prefix)) return mechanism;
  }
  return 'unrecognized';
}

/**
 * Pulls the matched term out of `roster:<term>@<hash>:<index>` for DISTINCT
 * COUNTING ONLY. The term is a real client surname — it is the exact string
 * the gate exists to catch — so it must never reach the report. Callers put it
 * in a Set and report `.size`.
 */
export function rosterTermOf(finding: string): string | null {
  if (!finding.startsWith('roster:')) return null;
  const body = finding.slice('roster:'.length);
  const at = body.lastIndexOf('@');
  const term = at === -1 ? body : body.slice(0, at);
  return term === '' ? null : term;
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
  /**
   * WHY the blocked families are blocked, from the canonical artifact's
   * `piiFindings`. `unavailable` (with a reason) when the artifact cannot be
   * read — never a zeroed breakdown.
   */
  blockReasons: BlockReasonBreakdown;
  /**
   * Catalog docs grouped by `pipelineVersion`. Catalog writes are per-family
   * `set`s and nothing prunes a family that stops existing, so the collection
   * accumulates across generations: more than one row here means the totals
   * above span pipeline versions and are not any single run's catalog.
   */
  generations: GenerationRow[];
  /** Plain-English readings. Never a decision — J1 measures, C1 decides. */
  readings: string[];
}

export interface GenerationRow {
  /** `(unstamped)` for docs written before the field existed. */
  pipelineVersion: string;
  families: number;
  blocked: number;
  occurrencesTotal: number;
  /** ISO bounds of `updatedAt` across the group; null when none carried one. */
  updatedAtEarliest: string | null;
  updatedAtLatest: string | null;
}

export type BlockReasonBreakdown =
  | { status: 'unavailable'; reason: string }
  | {
      status: 'ok';
      /**
       * Catalog families the artifact actually covered. A join well below the
       * catalog's blocked count is itself the staleness signal — those families
       * were written by a generation this artifact does not describe.
       */
      coverage: { catalogBlocked: number; matchedInArtifact: number; missingFromArtifact: number };
      /** Per-family: which nets fired. Sums to `matchedInArtifact`. */
      families: {
        rosterOnly: number;
        gateOnly: number;
        both: number;
        /** Blocked in the artifact but carrying no findings — should be 0. */
        blockedWithNoFindings: number;
      };
      /** Individual finding entries by mechanism (a family may raise several). */
      findings: Record<BlockMechanism, number>;
      /**
       * How many DISTINCT roster terms drove every roster hit. Three surnames
       * behaving like a stuck automaton reads very differently from three
       * hundred. The terms themselves are never emitted.
       */
      distinctRosterTerms: number;
    };

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
  /** null when the doc predates the stamp. Not text — already in the blocked-doc allow-list. */
  pipelineVersion: string | null;
  updatedAt: string | null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
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
    // Both survive `scrubBlockedCatalogDoc` (they are in BLOCKED_DOC_FIELDS),
    // so a blocked family reports its generation like a clean one does.
    pipelineVersion: asNonEmptyString(data.pipelineVersion),
    updatedAt: asNonEmptyString(data.updatedAt),
  };
}

/**
 * Reads `piiFindings` off the canonical artifact and counts mechanisms. Never
 * reads `canonicalText`, `title` or any other text field, and never emits a
 * roster term.
 *
 * Throws on a malformed artifact rather than returning an empty breakdown — the
 * caller turns that into `status: 'unavailable'` with the reason attached.
 */
export function parseBlockReasons(
  raw: string,
  catalogBlockedIds: ReadonlySet<string>,
): BlockReasonBreakdown {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('canonical artifact is not an array of families');
  }

  const findings: Record<BlockMechanism, number> = {
    roster: 0,
    'gate-flagged': 0,
    'gate-error': 0,
    'gate-missing': 0,
    'gate-unspecified': 0,
    unrecognized: 0,
  };
  const rosterTerms = new Set<string>();
  let rosterOnly = 0;
  let gateOnly = 0;
  let both = 0;
  let blockedWithNoFindings = 0;
  let matched = 0;

  for (const entry of parsed) {
    const fam = asRecord(entry);
    if (fam === null) continue;
    const familyId = asNonEmptyString(fam.familyId);
    // Only families the CURRENT catalog reports as blocked. An artifact family
    // that never reached the catalog, or reached it clean, is not evidence
    // about the catalog's block rate.
    if (familyId === null || !catalogBlockedIds.has(familyId)) continue;
    matched++;

    const list = Array.isArray(fam.piiFindings) ? fam.piiFindings : [];
    let sawRoster = false;
    let sawGate = false;
    for (const item of list) {
      if (typeof item !== 'string') continue;
      const mechanism = classifyFinding(item);
      findings[mechanism]++;
      if (mechanism === 'roster') {
        sawRoster = true;
        const term = rosterTermOf(item);
        if (term !== null) rosterTerms.add(term);
      } else if (mechanism !== 'unrecognized') {
        sawGate = true;
      }
    }

    if (sawRoster && sawGate) both++;
    else if (sawRoster) rosterOnly++;
    else if (sawGate) gateOnly++;
    else blockedWithNoFindings++;
  }

  return {
    status: 'ok',
    coverage: {
      catalogBlocked: catalogBlockedIds.size,
      matchedInArtifact: matched,
      missingFromArtifact: catalogBlockedIds.size - matched,
    },
    families: { rosterOnly, gateOnly, both, blockedWithNoFindings },
    findings,
    distinctRosterTerms: rosterTerms.size,
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

function buildGenerations(families: readonly FamilyMetadata[]): GenerationRow[] {
  const byVersion = new Map<string, GenerationRow>();
  for (const fam of families) {
    const key = fam.pipelineVersion ?? '(unstamped)';
    const row = byVersion.get(key) ?? {
      pipelineVersion: key,
      families: 0,
      blocked: 0,
      occurrencesTotal: 0,
      updatedAtEarliest: null,
      updatedAtLatest: null,
    };
    row.families++;
    if (fam.blocked) row.blocked++;
    row.occurrencesTotal += fam.occurrences;
    if (fam.updatedAt !== null) {
      if (row.updatedAtEarliest === null || fam.updatedAt < row.updatedAtEarliest) {
        row.updatedAtEarliest = fam.updatedAt;
      }
      if (row.updatedAtLatest === null || fam.updatedAt > row.updatedAtLatest) {
        row.updatedAtLatest = fam.updatedAt;
      }
    }
    byVersion.set(key, row);
  }
  return [...byVersion.values()].sort((a, b) => b.families - a.families);
}

export function buildReport(
  firmId: string,
  runId: string,
  generatedAt: string,
  families: readonly FamilyMetadata[],
  seed: { ids: Set<string> } | { unavailableReason: string },
  blockReasons: BlockReasonBreakdown,
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
  const generations = buildGenerations(families);
  if (generations.length > 1) {
    readings.push(
      `The catalog collection spans ${generations.length} pipeline generations (${generations
        .map((g) => `${g.pipelineVersion}: ${g.families}`)
        .join(', ')}). Catalog writes are per-family and nothing prunes, so every total in this report is the size of the COLLECTION, not of any single run's catalog. Re-run \`catalog\` for the current generation, or prune the stale ids, before quoting these figures as a run result.`,
    );
  }

  if (blockReasons.status === 'unavailable') {
    readings.push(
      `Block-reason breakdown UNAVAILABLE (${blockReasons.reason}). Why the blocked families are blocked is therefore UNKNOWN in this run — not "no reasons found". Do not read the block rate above as evidence either for or against PII over-aggression without it.`,
    );
  } else {
    const { families: byFamily, findings, coverage, distinctRosterTerms } = blockReasons;
    const rosterInvolved = byFamily.rosterOnly + byFamily.both;
    const gateAlone = byFamily.gateOnly;
    readings.push(
      `Of ${coverage.matchedInArtifact} blocked families the canonical artifact covers, ${rosterInvolved} had a roster hit (a real name from the run's own party roster matched in the text) and ${gateAlone} were blocked by the model gate ALONE. ${distinctRosterTerms} distinct roster terms drove every roster hit.`,
    );
    if (findings['gate-unspecified'] > 0) {
      readings.push(
        `${findings['gate-unspecified']} gate findings carry the pre-2026-08-07 \`haiku-gate:\` label, which conflated "the model objected", "the batch call errored" and "no verdict came back". Those three are NOT distinguishable in this artifact. A canonicalize re-run records them separately; until then, treat gate-only blocks as unexplained rather than as model objections.`,
      );
    }
    if (coverage.missingFromArtifact > 0) {
      readings.push(
        `${coverage.missingFromArtifact} of ${coverage.catalogBlocked} blocked catalog families are ABSENT from the canonical artifact for RUN_ID=${runId} — they were written by a different generation and this breakdown says nothing about them.`,
      );
    }
    if (byFamily.blockedWithNoFindings > 0) {
      readings.push(
        `${byFamily.blockedWithNoFindings} families are blocked but carry no findings at all. That combination should be impossible and points at a defect, not at a PII hit.`,
      );
    }
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
    blockReasons,
    generations,
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

  // The canonical artifact carries `piiFindings` — the only record of WHICH
  // net blocked each family. Same discipline as the seed blob: a read failure
  // is its own reported state, never a breakdown of zeroes.
  const blockedIds = new Set(families.filter((f) => f.blocked).map((f) => f.familyId));
  let blockReasons: BlockReasonBreakdown;
  const canonPath = canonicalPath(env.firmId, env.runId);
  try {
    if (await deps.blobs.exists(canonPath)) {
      blockReasons = parseBlockReasons(
        (await deps.blobs.read(canonPath)).toString('utf8'),
        blockedIds,
      );
    } else {
      blockReasons = {
        status: 'unavailable',
        reason: `no canonical artifact at ${canonPath} — canonicalize has not run for RUN_ID=${env.runId}`,
      };
    }
  } catch (error) {
    blockReasons = {
      status: 'unavailable',
      reason: `canonical artifact at ${canonPath} could not be read or parsed: ${
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
    blockReasons,
  );
  await deps.blobs.write(clauseAuditPath(env.firmId, env.runId), JSON.stringify(report, null, 2));
  return report;
}
