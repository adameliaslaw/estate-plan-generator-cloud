/**
 * Stage V — Validation gates (§11 P3). ALL must pass before Adam reviews the
 * catalog; the report is the deliverable that gates his time.
 *
 *  Gate 1 RECALL     ≥ 90% of trust-relevant curated seed clauses land in some
 *                    mined family, via the same identity rings.
 *  Gate 2 PURITY     no two seed pieces Adam filed SEPARATELY may land in one
 *                    family without an adjudication transcript flagged for his
 *                    confirmation. A silent merge is a HARD FAIL.
 *  Gate 3 FIDELITY   divergence between matched seed text and the data-chosen
 *                    canonical is a DIAGNOSTIC (§6.2 amended — Adam's decision
 *                    #2: the seed is evidence to evaluate, not ground truth).
 *                    Fails only when divergence exceeds half the matched
 *                    families, which indicates a normalization/clustering
 *                    defect rather than genuine drafting drift.
 *  Gate 4 CANARY     the held-out Trust Agreements files were excluded from
 *                    corpus input; the pipeline must re-derive ≥ 90% of their
 *                    clauses from client documents alone. The strongest
 *                    falsifier available — a pass means the pipeline
 *                    reconstructs the library from raw evidence.
 *  Gate 5 ROUNDTRIP  union-template round-trip. Checkpoint-2 scope (§6.4):
 *                    reported as SKIPPED, never as passed — a gate that
 *                    reports green for work that has not been done is worse
 *                    than no gate.
 *
 * Every gate reports its numbers whether it passes or fails, and misses are
 * enumerated by name so they can be diagnosed (segmentation cut vs
 * normalization divergence — both deterministic fixes plus a cheap ring
 * re-run from cache) rather than waved off.
 */

import { config } from '../config.js';
import {
  canonicalPath,
  gatesReportPath,
  runLedgerPath,
  seedFilesCollection,
  seedMatchPath,
} from '../paths.js';
import type { CanonicalFamily } from './canonicalize.js';
import type { SeedPiece } from './seed.js';
import type { SeedMatch } from '../seed-match.js';
import type { Env } from '../env.js';
import type { BlobStore, DocStore } from '../clients/interfaces.js';

export type GateStatus = 'pass' | 'fail' | 'skipped';

export interface GateResult {
  gate: string;
  name: string;
  status: GateStatus;
  /** The measured quantity, when the gate has one. */
  value: number | null;
  threshold: number | null;
  detail: string;
  /** Named items behind the number — misses, offending pairs, flagged families. */
  items: string[];
}

export interface GatesReport {
  runId: string;
  generatedAt: string;
  results: GateResult[];
  passed: boolean;
  /** True when a gate could not be evaluated (missing inputs) — never a pass. */
  incomplete: boolean;
}

export interface GatesDeps {
  store: DocStore;
  blobs: BlobStore;
}

interface SeedMatchArtifact {
  pieces: SeedPiece[];
  matches: SeedMatch[];
}

/* ------------------------------------------------------------------ */
/* Pure gate evaluation (unit-tested without I/O)                     */
/* ------------------------------------------------------------------ */

export function gate1Recall(pieces: readonly SeedPiece[], matches: readonly SeedMatch[]): GateResult {
  const relevant = pieces.filter((p) => p.kind === 'clause' && p.trustRelevant && !p.canary);
  const matched = new Set(matches.map((m) => m.pieceId));
  const misses = relevant.filter((p) => !matched.has(p.pieceId));
  const value = relevant.length === 0 ? 0 : (relevant.length - misses.length) / relevant.length;
  return {
    gate: 'gate1',
    name: 'RECALL — curated seed clauses land in mined families',
    // An empty gold set cannot pass: it would report 0/0 as success.
    status: relevant.length === 0 ? 'fail' : value >= config.gates.recallMin ? 'pass' : 'fail',
    value,
    threshold: config.gates.recallMin,
    detail:
      relevant.length === 0
        ? 'no trust-relevant seed clauses — nothing to measure recall against (§11 Gate 1 caveat: the trust-relevant seed is thin)'
        : `${relevant.length - misses.length}/${relevant.length} trust-relevant seed clauses matched`,
    items: misses.map((p) => `${p.seedFileName} #${p.pieceIndex} ${p.title ?? ''}`.trim()),
  };
}

export function gate2Purity(
  pieces: readonly SeedPiece[],
  matches: readonly SeedMatch[],
): GateResult {
  const byPieceId = new Map(pieces.map((p) => [p.pieceId, p]));
  const byFamily = new Map<string, SeedMatch[]>();
  for (const match of matches) {
    const list = byFamily.get(match.familyId);
    if (list === undefined) byFamily.set(match.familyId, [match]);
    else list.push(match);
  }

  const violations: string[] = [];
  for (const [familyId, group] of byFamily) {
    if (group.length < 2) continue;
    // Distinct curated pieces in one family. Exact-hash collisions between two
    // pieces are the library repeating itself verbatim, which is not a merge
    // decision at all — the violation is a NON-exact merge with no transcript.
    const distinct = new Set(group.map((m) => m.pieceId));
    if (distinct.size < 2) continue;
    const unflagged = group.filter((m) => m.kind !== 'exact' && m.adjudicationRef === null);
    if (unflagged.length === 0) continue;
    const names = group
      .map((m) => byPieceId.get(m.pieceId))
      .map((p) => (p === undefined ? '?' : `${p.seedFileName} #${p.pieceIndex}`));
    violations.push(`${familyId}: ${names.join(' + ')}`);
  }

  return {
    gate: 'gate2',
    name: 'PURITY — separately-filed seed pieces do not silently merge',
    status: violations.length === 0 ? 'pass' : 'fail',
    value: violations.length,
    threshold: 0,
    detail:
      violations.length === 0
        ? 'no unadjudicated merge of two distinct curated pieces'
        : `${violations.length} famil${violations.length === 1 ? 'y' : 'ies'} merged distinct curated pieces without a transcript — tighten the diff whitelist / legal-delta lexicon and re-run the rings`,
    items: violations,
  };
}

export function gate3Fidelity(families: readonly CanonicalFamily[]): GateResult {
  const matched = families.filter((f) => f.seedEditRatio !== undefined);
  const divergent = matched.filter((f) => f.seedDivergent);
  const share = matched.length === 0 ? 0 : divergent.length / matched.length;
  const ratios = matched
    .map((f) => f.seedEditRatio as number)
    .sort((a, b) => a - b);
  const medianRatio =
    ratios.length === 0
      ? null
      : ratios.length % 2 === 1
        ? ratios[(ratios.length - 1) / 2]
        : (ratios[ratios.length / 2 - 1] + ratios[ratios.length / 2]) / 2;

  return {
    gate: 'gate3',
    name: 'CANONICAL FIDELITY — seed divergence diagnostic',
    // No matched families is not a failure here: Gate 1 already reports that,
    // and double-failing one cause reads as two problems.
    status: share <= config.gates.seedDivergentMaxShare ? 'pass' : 'fail',
    value: medianRatio,
    threshold: config.canonical.seedDivergenceLevenshtein,
    detail:
      matched.length === 0
        ? 'no families matched a curated piece — nothing to compare (see Gate 1)'
        : `median token-Levenshtein ${medianRatio?.toFixed(3) ?? 'n/a'}; ${divergent.length}/${matched.length} flagged seed-divergent for side-by-side review` +
          (share > config.gates.seedDivergentMaxShare
            ? ' — above half, which reads as a normalization/clustering defect rather than drafting drift'
            : ''),
    items: divergent.map(
      (f) => `${f.familyId} ${f.title} (ratio ${(f.seedEditRatio as number).toFixed(2)})`,
    ),
  };
}

export function gate4Canary(
  pieces: readonly SeedPiece[],
  matches: readonly SeedMatch[],
  canaryExcludedFromCorpus: boolean,
): GateResult {
  const canary = pieces.filter((p) => p.kind === 'clause' && p.canary && p.trustRelevant);
  const matched = new Set(matches.map((m) => m.pieceId));
  const recovered = canary.filter((p) => matched.has(p.pieceId));
  const value = canary.length === 0 ? 0 : recovered.length / canary.length;

  // The exclusion is the gate's precondition. If the canary files reached the
  // corpus, a "pass" would only prove the pipeline can find a document it was
  // given — which is what the gate exists to rule out.
  if (!canaryExcludedFromCorpus) {
    return {
      gate: 'gate4',
      name: 'INDEPENDENT-RECOVERY CANARY',
      status: 'fail',
      value: null,
      threshold: config.gates.canaryRecallMin,
      detail:
        'canary files were NOT excluded from corpus input — the recovery result is meaningless. ' +
        'Set CLAUSE_MINER_CANARY_FOLDER_IDS (a subset of the seed folders) and re-manifest.',
      items: [],
    };
  }
  return {
    gate: 'gate4',
    name: 'INDEPENDENT-RECOVERY CANARY — held-out library re-derived from client documents',
    status: canary.length === 0 ? 'fail' : value >= config.gates.canaryRecallMin ? 'pass' : 'fail',
    value,
    threshold: config.gates.canaryRecallMin,
    detail:
      canary.length === 0
        ? 'no held-out canary clauses — the strongest falsifier did not run'
        : `${recovered.length}/${canary.length} held-out clauses re-derived from client documents alone`,
    items: canary
      .filter((p) => !matched.has(p.pieceId))
      .map((p) => `${p.seedFileName} #${p.pieceIndex} ${p.title ?? ''}`.trim()),
  };
}

export function gate5Roundtrip(): GateResult {
  return {
    gate: 'gate5',
    name: 'TEMPLATE ROUND-TRIP',
    status: 'skipped',
    value: null,
    threshold: null,
    detail:
      'checkpoint-2 scope (§6.4): union master template assembly is not implemented, so the ' +
      'round-trip fill cannot run. Reported as skipped — never as passed.',
    items: [],
  };
}

export function summarizeGates(runId: string, results: GateResult[], now: string): GatesReport {
  const incomplete = results.some((r) => r.status === 'skipped');
  return {
    runId,
    generatedAt: now,
    results,
    // Skipped is not passed: the report is honest about what it did not check.
    passed: results.every((r) => r.status === 'pass'),
    incomplete,
  };
}

/* ------------------------------------------------------------------ */
/* Stage orchestration                                                */
/* ------------------------------------------------------------------ */

export async function runGates(deps: GatesDeps, env: Env): Promise<GatesReport> {
  let artifact: SeedMatchArtifact;
  try {
    const raw = await deps.blobs.read(seedMatchPath(env.firmId, env.runId));
    artifact = JSON.parse(raw.toString('utf8')) as SeedMatchArtifact;
  } catch {
    throw new Error(
      'no seed-match artifact for this run — run STAGE=seed then STAGE=canonicalize first. ' +
        'Gates 1–4 all measure against the curated seed; without it they would report ' +
        'vacuous passes (§11 P3).',
    );
  }

  let families: CanonicalFamily[] = [];
  try {
    const raw = await deps.blobs.read(canonicalPath(env.firmId, env.runId));
    families = JSON.parse(raw.toString('utf8')) as CanonicalFamily[];
  } catch {
    families = [];
  }

  // Gate 4's precondition, read from the data rather than from the config:
  // canary rows must exist in the SEED collection (which the corpus stages
  // never walk), and at least one must be tagged canary.
  const seedRows = await deps.store.listDocs(seedFilesCollection(env.firmId, env.runId));
  const canaryExcluded =
    env.canaryFolderIds.length > 0 && seedRows.some((r) => r.data.canary === true);

  const results = [
    gate1Recall(artifact.pieces, artifact.matches),
    gate2Purity(artifact.pieces, artifact.matches),
    gate3Fidelity(families),
    gate4Canary(artifact.pieces, artifact.matches, canaryExcluded),
    gate5Roundtrip(),
  ];
  const report = summarizeGates(env.runId, results, new Date().toISOString());

  await deps.blobs.write(gatesReportPath(env.firmId, env.runId), JSON.stringify(report));
  await deps.store.set(runLedgerPath(env.firmId, env.runId), {
    stage: 'gates',
    status: 'completed',
    gates: {
      passed: report.passed,
      incomplete: report.incomplete,
      results: results.map((r) => ({
        gate: r.gate,
        status: r.status,
        value: r.value,
        detail: r.detail,
        itemCount: r.items.length,
      })),
      reportPath: gatesReportPath(env.firmId, env.runId),
    },
    updatedAt: new Date().toISOString(),
  });
  return report;
}
