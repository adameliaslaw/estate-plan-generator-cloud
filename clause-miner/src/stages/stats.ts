/**
 * Stage 8 — Correlate + cards (§7): deterministic contingency tables per
 * (family, intake-observable fact=value) over §7.2 counting units, Fisher's
 * exact p (log-factorial implementation, core/fisher.ts) with
 * Benjamini–Hochberg correction across the WHOLE grid. Card gate: lift ≥ 2.0
 * or ≤ 0.5, pAdj < 0.01, n ≥ 10; two tiers (significant | exploratory).
 *
 * Primary statistics compute over ALL matters (§7.3 as amended — the whole
 * practice's history is the evidence base); per-attorney and per-era strata
 * are always computed for display but NEVER enter the BH grid or the gate.
 *
 * Opus narrates ≤3-sentence cards citing stat rows only (§7.4); statsHash
 * pins prose to the numbers it cited.
 */

import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { benjaminiHochberg, fisherExactTwoSided, lift, type Table2x2 } from '../core/fisher.js';
import {
  FACT_PARTITION,
  isCountableFactValue,
  type FactVector,
} from '../facts-vocabulary.js';
import { canonicalPath, runLedgerPath, statsPath } from '../paths.js';
import {
  buildOccurrenceIndex,
  eraYear,
  loadArtifacts,
  loadCountingUnits,
  loadDocFacts,
  loadSegmentedRows,
} from './shared.js';
import type { CanonicalFamily } from './canonicalize.js';
import type { Env } from '../env.js';
import type { BatchClient, BatchRequest, BlobStore, DocStore } from '../clients/interfaces.js';

export interface UnitFacts {
  countingUnitId: string;
  matterKey: string;
  attorneyFolder: string;
  eraBand: string;
  facts: FactVector;
}

export interface StatRow {
  familyId: string;
  fact: string;
  factClass: 'intake';
  value: string;
  stratum: string; // 'all' | 'attorney:x' | 'era:x'
  table: Table2x2;
  pGivenFact: number;
  pGivenNotFact: number;
  lift: number;
  fisherP: number;
  /** BH-adjusted p — only populated for stratum 'all' rows. */
  pAdj: number | null;
  nFact: number;
  nNotFact: number;
}

export type CardTier = 'significant' | 'exploratory';

export interface TriggerCard {
  familyId: string;
  tier: CardTier;
  prose: string;
  statsHash: string;
  stats: StatRow[];
}

export function eraBandOf(year: number | null): string {
  if (year === null) return 'unknown';
  return year < 2013 ? 'pre-2013' : 'post-2012';
}

/* ------------------------------------------------------------------ */
/* Pure grid construction                                             */
/* ------------------------------------------------------------------ */

function buildTable(
  units: UnitFacts[],
  present: ReadonlySet<string>,
  fact: keyof FactVector,
  value: string,
): { table: Table2x2; nFact: number; nNotFact: number } | null {
  let a = 0;
  let b = 0;
  let c = 0;
  let d = 0;
  for (const unit of units) {
    const v = unit.facts[fact];
    if (!isCountableFactValue(v)) continue; // 'unknown' excluded from BOTH cells
    const hasFact = v === value;
    const hasClause = present.has(unit.countingUnitId);
    if (hasClause && hasFact) a++;
    else if (hasClause && !hasFact) b++;
    else if (!hasClause && hasFact) c++;
    else d++;
  }
  const nFact = a + c;
  const nNotFact = b + d;
  if (nFact === 0 || nNotFact === 0) return null;
  return { table: { a, b, c, d }, nFact, nNotFact };
}

const INTAKE_SCALAR_FACTS = FACT_PARTITION.intake.filter(
  (f) => f !== 'trustStructures',
) as ReadonlyArray<keyof FactVector & string>;

function rowFor(
  familyId: string,
  fact: string,
  value: string,
  stratum: string,
  built: { table: Table2x2; nFact: number; nNotFact: number },
): StatRow {
  const { table, nFact, nNotFact } = built;
  return {
    familyId,
    fact,
    factClass: 'intake',
    value,
    stratum,
    table,
    pGivenFact: nFact > 0 ? table.a / nFact : 0,
    pGivenNotFact: nNotFact > 0 ? table.b / nNotFact : 0,
    lift: lift(table),
    fisherP: fisherExactTwoSided(table),
    pAdj: null,
    nFact,
    nNotFact,
  };
}

export interface StatsGrid {
  /** Primary (stratum 'all') rows with pAdj populated. */
  primary: StatRow[];
  /** Display-only strata rows (no pAdj, never gated). */
  strata: StatRow[];
}

export function buildStatsGrid(
  families: Array<{ familyId: string; presentUnits: ReadonlySet<string> }>,
  units: UnitFacts[],
): StatsGrid {
  const primary: StatRow[] = [];
  const strata: StatRow[] = [];

  const strataKeys = new Map<string, UnitFacts[]>();
  for (const unit of units) {
    for (const key of [`attorney:${unit.attorneyFolder}`, `era:${unit.eraBand}`]) {
      const list = strataKeys.get(key);
      if (list === undefined) strataKeys.set(key, [unit]);
      else list.push(unit);
    }
  }

  for (const family of families) {
    for (const fact of INTAKE_SCALAR_FACTS) {
      const values = new Set<string>();
      for (const unit of units) {
        const v = unit.facts[fact];
        if (isCountableFactValue(v)) values.add(v as string);
      }
      for (const value of [...values].sort()) {
        const built = buildTable(units, family.presentUnits, fact, value);
        if (built === null) continue;
        primary.push(rowFor(family.familyId, fact, value, 'all', built));
        for (const [stratum, stratumUnits] of strataKeys) {
          const sBuilt = buildTable(stratumUnits, family.presentUnits, fact, value);
          if (sBuilt !== null) {
            strata.push(rowFor(family.familyId, fact, value, stratum, sBuilt));
          }
        }
      }
    }
  }

  // §7.3: BH across the WHOLE primary grid.
  const adjusted = benjaminiHochberg(primary.map((r) => r.fisherP));
  primary.forEach((row, i) => (row.pAdj = adjusted[i]));
  return { primary, strata };
}

/** §7.3 card gate. n = units in the fact=value cell. */
export function passesCardGate(row: StatRow): boolean {
  const liftOk = row.lift >= config.stats.liftHigh || row.lift <= config.stats.liftLow;
  return (
    liftOk &&
    row.pAdj !== null &&
    row.pAdj < config.stats.pAdjMax &&
    row.nFact >= config.stats.minN
  );
}

/** Exploratory tier: lift-ranked with support, labeled as such (§7.3). */
export function isExploratory(row: StatRow): boolean {
  const liftOk = row.lift >= config.stats.liftHigh || row.lift <= config.stats.liftLow;
  return liftOk && row.nFact >= config.stats.minN && !passesCardGate(row);
}

export function statsHashOf(rows: StatRow[]): string {
  return createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

/* ------------------------------------------------------------------ */
/* Opus card narration                                                */
/* ------------------------------------------------------------------ */

export function buildCardRequest(
  familyId: string,
  title: string,
  rows: StatRow[],
  strataRows: StatRow[],
  provenanceSnippets: string[],
): BatchRequest {
  return {
    customId: `card:${familyId}`,
    model: 'opus',
    maxTokens: 400,
    system:
      'You write trigger cards for an estate-planning clause catalog. You receive a clause title, ' +
      'precomputed contingency-table rows (primary rows over all matters, plus per-attorney/per-era ' +
      'strata for context), and up to 3 provenance snippets. Write AT MOST 3 sentences. EVERY factual ' +
      'claim must cite a stat row by its numbers (e.g. "present in 14/16 matters with minor children ' +
      'vs 3/41 without, lift 12.0, adjusted p 0.002"). Never infer a rule beyond the rows; never cite ' +
      'the snippets as evidence — they only show what the clause looks like.',
    userText: JSON.stringify({
      title,
      primaryRows: rows,
      strataRows,
      provenanceSnippets: provenanceSnippets.slice(0, 3),
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Stage orchestration                                                */
/* ------------------------------------------------------------------ */

export interface StatsDeps {
  store: DocStore;
  blobs: BlobStore;
  batches: BatchClient;
}

export interface StatsSummary {
  units: number;
  primaryRows: number;
  significant: number;
  exploratory: number;
  cards: number;
}

export async function runStats(deps: StatsDeps, env: Env): Promise<StatsSummary> {
  const rows = await loadSegmentedRows(deps.store, env);
  const artifacts = await loadArtifacts(deps.blobs, env, rows);
  const occurrenceIndex = buildOccurrenceIndex(artifacts);
  const docFacts = await loadDocFacts(deps.store, env);
  const { units, unitByDocId } = await loadCountingUnits(deps, env, rows, docFacts);

  const unitFacts: UnitFacts[] = units.map((unit) => {
    const facts = docFacts.get(unit.representativeDriveFileId);
    return {
      countingUnitId: unit.countingUnitId,
      matterKey: unit.matterKey,
      attorneyFolder: unit.attorneyFolder,
      eraBand: eraBandOf(eraYear(facts?.executionDate ?? null)),
      facts:
        facts?.facts ??
        ({
          married: 'unknown', childCountBand: 'unknown', hasMinorChildren: 'unknown',
          blendedFamily: 'unknown', specialNeedsBeneficiary: 'unknown',
          charitableBeneficiary: 'unknown', businessInterests: 'unknown',
          outOfStateRealProperty: 'unknown', trustStructures: [],
          distributionStandard: 'unknown', fundedStatus: 'unknown', estateSizeBand: 'unknown',
        } as FactVector),
    };
  });

  const canonicalRaw = await deps.blobs.read(canonicalPath(env.firmId, env.runId));
  const canonicalFamilies = JSON.parse(canonicalRaw.toString('utf8')) as CanonicalFamily[];

  const familyPresence = canonicalFamilies.map((fam) => {
    const present = new Set<string>();
    for (const variant of fam.variants) {
      for (const occ of occurrenceIndex.get(variant.sigHash) ?? []) {
        const unit = unitByDocId.get(occ.driveFileId);
        if (unit !== undefined) present.add(unit.countingUnitId);
      }
    }
    return { familyId: fam.familyId, presentUnits: present };
  });

  const grid = buildStatsGrid(familyPresence, unitFacts);
  const summary: StatsSummary = {
    units: unitFacts.length,
    primaryRows: grid.primary.length,
    significant: 0,
    exploratory: 0,
    cards: 0,
  };

  // ---- Cards ------------------------------------------------------------
  interface CardPlan {
    familyId: string;
    tier: CardTier;
    rows: StatRow[];
    strata: StatRow[];
  }
  const plans: CardPlan[] = [];
  for (const fam of canonicalFamilies) {
    const famRows = grid.primary.filter((r) => r.familyId === fam.familyId);
    const sig = famRows.filter(passesCardGate);
    const expl = famRows.filter(isExploratory);
    summary.significant += sig.length;
    summary.exploratory += expl.length;
    const chosen = sig.length > 0 ? sig : expl;
    if (chosen.length === 0) continue;
    plans.push({
      familyId: fam.familyId,
      tier: sig.length > 0 ? 'significant' : 'exploratory',
      rows: chosen,
      strata: grid.strata.filter(
        (r) => r.familyId === fam.familyId && chosen.some((c) => c.fact === r.fact && c.value === r.value),
      ),
    });
  }

  const cards: TriggerCard[] = [];
  if (plans.length > 0) {
    const famById = new Map(canonicalFamilies.map((f) => [f.familyId, f]));
    const requests = plans.map((plan) => {
      const fam = famById.get(plan.familyId) as CanonicalFamily;
      return buildCardRequest(
        plan.familyId,
        fam.title,
        plan.rows,
        plan.strata,
        fam.variants.slice(0, 3).map((v) => v.normText.slice(0, 400)),
      );
    });
    const batchId = await deps.batches.submitBatch('trigger-cards', requests);
    const results = await deps.batches.pollBatch(batchId);
    const byId = new Map(results.map((r) => [r.customId.replace(/^card:/, ''), r]));
    for (const plan of plans) {
      const result = byId.get(plan.familyId);
      cards.push({
        familyId: plan.familyId,
        tier: plan.tier,
        prose: result?.ok === true && result.text !== undefined ? result.text : '',
        statsHash: statsHashOf(plan.rows),
        stats: [...plan.rows, ...plan.strata],
      });
      summary.cards++;
    }
  }

  await deps.blobs.write(
    statsPath(env.firmId, env.runId),
    JSON.stringify({ primary: grid.primary, strata: grid.strata, cards, units: unitFacts.length }),
  );
  await deps.store.set(runLedgerPath(env.firmId, env.runId), {
    stage: 'stats',
    status: 'completed',
    stats: { ...summary },
    updatedAt: new Date().toISOString(),
  });
  return summary;
}
