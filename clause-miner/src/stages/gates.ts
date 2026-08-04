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
  edgesPath,
  filesCollection,
  gatesReportPath,
  runLedgerPath,
  seedFilesCollection,
  seedMatchPath,
} from '../paths.js';
import { UnionFind } from '../union-find.js';
import { SEGMENTER_VERSION } from './segment-normalize.js';
import type { CanonicalFamily } from './canonicalize.js';
import type { IdentityEdge } from './identity.js';
import type { SeedPiece } from './seed.js';
import type { SeedMatch } from '../seed-match.js';
import type { Env } from '../env.js';
import type { BlobStore, DocData, DocStore } from '../clients/interfaces.js';

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
  /** SEGMENTER_VERSION of the seed run (M1); absent/null on pre-stamp artifacts. */
  segmenterVersion?: string | null;
  seedGeneratedAt?: string | null;
  generatedAt?: string;
  pieces: SeedPiece[];
  matches: SeedMatch[];
}

/**
 * M1 — the gates must refuse to measure against a stale artifact. Pilot-1's
 * report carried denominators that did not reconcile with the seed run
 * (107+16 ≠ 130) and nothing could tell which side was stale. Returns an
 * error string (the caller throws) or null when consistent.
 */
export function checkSeedMatchConsistency(
  artifact: SeedMatchArtifact,
  ledgerSeed: DocData | null | undefined,
): string | null {
  if (artifact.segmenterVersion == null) {
    return (
      'seed-match artifact carries no segmenter-version stamp (written before M1) — ' +
      're-run STAGE=seed then STAGE=canonicalize so the gates measure a stamped artifact'
    );
  }
  if (artifact.segmenterVersion !== SEGMENTER_VERSION) {
    return (
      `seed-match artifact was built under segmenter ${artifact.segmenterVersion} but the ` +
      `pipeline is at ${SEGMENTER_VERSION} — re-run STAGE=segment, STAGE=seed, STAGE=canonicalize`
    );
  }
  if (ledgerSeed != null) {
    const pieces = artifact.pieces;
    const clause = pieces.filter((p) => p.kind === 'clause').length;
    const commentary = pieces.filter((p) => p.kind === 'commentary').length;
    const trustRelevant = pieces.filter((p) => p.kind === 'clause' && p.trustRelevant).length;
    const checks: Array<[string, number, unknown]> = [
      ['clausePieces', clause, ledgerSeed.clausePieces],
      ['commentaryPieces', commentary, ledgerSeed.commentaryPieces],
      ['trustRelevant', trustRelevant, ledgerSeed.trustRelevant],
    ];
    for (const [name, fromArtifact, fromLedger] of checks) {
      if (typeof fromLedger === 'number' && fromLedger !== fromArtifact) {
        return (
          `seed-match artifact disagrees with the seed run ledger on ${name} ` +
          `(artifact ${fromArtifact}, ledger ${fromLedger}) — one of them is stale; ` +
          're-run STAGE=seed then STAGE=canonicalize'
        );
      }
    }
  }
  return null;
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

/**
 * "Separately FILED" must mean separate filings, not separate revisions of
 * one template file (M6): DISCLAIMER WILL.doc / DISCLAIMER WILL (NEW).doc /
 * DISCLAIMER WILL (NEW) (JJB).doc are three eras of one filing, and the same
 * clause appearing in each is Adam re-using it, not Adam keeping two clauses
 * apart. Strips the extension and every parenthesized revision marker.
 */
export function filingKey(seedFileName: string): string {
  return seedFileName
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function gate2Purity(
  pieces: readonly SeedPiece[],
  matches: readonly SeedMatch[],
  edges: readonly IdentityEdge[] | null,
): GateResult {
  const byPieceId = new Map(pieces.map((p) => [p.pieceId, p]));
  const byFamily = new Map<string, SeedMatch[]>();
  for (const match of matches) {
    const list = byFamily.get(match.familyId);
    if (list === undefined) byFamily.set(match.familyId, [match]);
    else list.push(match);
  }

  // Connectivity over TRANSCRIPT-LESS merged edges only (M6): two hashes in
  // one component of this graph were joined by the corpus rings with no
  // adjudication anywhere between them. If every route between them crosses
  // an adjudicated edge, the merge was reviewed and is not silent.
  const silent = new UnionFind();
  for (const edge of edges ?? []) {
    if (edge.merged && edge.adjudicationRef === null) silent.union(edge.a, edge.b);
  }

  const violations: string[] = [];
  for (const [familyId, group] of byFamily) {
    if (group.length < 2) continue;
    const distinct = new Set(group.map((m) => m.pieceId));
    if (distinct.size < 2) continue;

    // Only pieces from genuinely different filings can violate purity:
    // different filing lineages (filingKey differs), or two distinct pieces
    // of the SAME file (Adam kept them apart within the document). The same
    // clause carried across revisions of one template (same filingKey,
    // different files) is one filing re-used, not two kept apart.
    const entries = group.map((m) => ({ m, p: byPieceId.get(m.pieceId) }));
    const separatelyFiled = (
      a: { p?: SeedPiece },
      b: { p?: SeedPiece },
    ): boolean => {
      if (a.p === undefined || b.p === undefined) return true; // fail closed
      if (filingKey(a.p.seedFileName) !== filingKey(b.p.seedFileName)) return true;
      return a.p.seedFileId === b.p.seedFileId && a.p.pieceId !== b.p.pieceId;
    };

    // A separately-filed pair is a violation when their matched hashes were
    // joined silently: either the SAME hash reached non-exactly without
    // adjudication (a fold collision), or two DIFFERENT hashes connected
    // through transcript-less corpus merges — the all-exact blind spot the
    // old gate had (it excused every exact seed match, never looking at the
    // corpus edge that actually formed the family).
    let violated = false;
    outer: for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (!separatelyFiled(entries[i], entries[j])) continue;
        const ma = entries[i].m;
        const mb = entries[j].m;
        if (ma.matchedHash === mb.matchedHash) {
          const bothReviewed =
            (ma.kind === 'exact' || ma.adjudicationRef !== null) &&
            (mb.kind === 'exact' || mb.adjudicationRef !== null);
          if (!bothReviewed) { violated = true; break outer; }
        } else if (
          edges === null ||
          silent.find(ma.matchedHash) === silent.find(mb.matchedHash)
        ) {
          // edges===null: the artifact is missing, so silence cannot be
          // ruled out — fail closed rather than excuse the merge.
          violated = true;
          break outer;
        }
      }
    }
    if (!violated) continue;
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
    // value/threshold state the ACTUAL pass rule (divergent share vs max
    // share). The pilot-1 report printed median-ratio 1.000 against the 0.8
    // Levenshtein cutoff — an unrelated pair that read as the rule (M6-adj).
    value: share,
    threshold: config.gates.seedDivergentMaxShare,
    detail:
      matched.length === 0
        ? 'no families matched a curated piece — nothing to compare (see Gate 1)'
        : `divergent share ${share.toFixed(3)} over ${matched.length} matched families; median token-Levenshtein ${medianRatio?.toFixed(3) ?? 'n/a'} (flag cutoff ${config.canonical.seedDivergenceLevenshtein}); ${divergent.length}/${matched.length} flagged seed-divergent for side-by-side review` +
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
  /** Canary files whose byte-identical copy sits in the corpus (md5 match). */
  compromisedFiles: readonly string[] = [],
): GateResult {
  // A byte-duplicated canary file defeats the holdout FOR ITS OWN pieces —
  // the pipeline was effectively handed those answers. Excluding them and
  // grading the clean remainder keeps the gate meaningful (Adam's call,
  // 2026-08-04) as long as the exclusion is REPORTED, never silent, and an
  // empty clean remainder still fails as compromised rather than passing
  // vacuously.
  const compromisedSet = new Set(compromisedFiles);
  const allCanary = pieces.filter((p) => p.kind === 'clause' && p.canary && p.trustRelevant);
  const canary = allCanary.filter((p) => !compromisedSet.has(p.seedFileName));
  const excludedPieces = allCanary.length - canary.length;
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
  // Folder exclusion is not enough when the same bytes live elsewhere in the
  // corpus tree (M6-adj: cross-check by md5). If NOTHING clean remains, the
  // holdout is wholly compromised and the gate fails rather than passing on
  // zero evidence.
  if (canary.length === 0 && compromisedFiles.length > 0) {
    return {
      gate: 'gate4',
      name: 'INDEPENDENT-RECOVERY CANARY',
      status: 'fail',
      value: null,
      threshold: config.gates.canaryRecallMin,
      detail:
        `every canary piece comes from the ${compromisedFiles.length} file(s) with a ` +
        'byte-identical (md5) corpus copy — no clean holdout remains. Remove the duplicates ' +
        'from the corpus tree or add clean canary files.',
      items: [...compromisedFiles],
    };
  }
  const exclusionNote =
    excludedPieces > 0
      ? `; ${excludedPieces} piece(s) from ${compromisedFiles.length} byte-duplicated file(s) EXCLUDED from the holdout`
      : '';
  return {
    gate: 'gate4',
    name: 'INDEPENDENT-RECOVERY CANARY — held-out library re-derived from client documents',
    status: canary.length === 0 ? 'fail' : value >= config.gates.canaryRecallMin ? 'pass' : 'fail',
    value,
    threshold: config.gates.canaryRecallMin,
    detail:
      canary.length === 0
        ? 'no held-out canary clauses — the strongest falsifier did not run'
        : `${recovered.length}/${canary.length} held-out clauses re-derived from client documents alone${exclusionNote}`,
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

  // M1 — refuse to measure a stale artifact. Throwing (not a red gate) keeps
  // the existing contract: gates that cannot run say so loudly.
  const ledger = await deps.store.get(runLedgerPath(env.firmId, env.runId));
  const staleness = checkSeedMatchConsistency(
    artifact,
    (ledger?.seed ?? null) as DocData | null,
  );
  if (staleness !== null) throw new Error(`gates: ${staleness}`);

  let families: CanonicalFamily[] = [];
  try {
    const raw = await deps.blobs.read(canonicalPath(env.firmId, env.runId));
    families = JSON.parse(raw.toString('utf8')) as CanonicalFamily[];
  } catch {
    families = [];
  }

  // Gate 2 walks the corpus merge edges; a missing edges artifact fails
  // closed inside the gate rather than excusing merges it cannot see.
  let edges: IdentityEdge[] | null = null;
  try {
    const raw = await deps.blobs.read(edgesPath(env.firmId, env.runId));
    edges = JSON.parse(raw.toString('utf8')) as IdentityEdge[];
  } catch {
    edges = null;
  }

  // Gate 4's precondition, read from the data rather than from the config:
  // canary rows must exist in the SEED collection (which the corpus stages
  // never walk), and at least one must be tagged canary.
  const seedRows = await deps.store.listDocs(seedFilesCollection(env.firmId, env.runId));
  const canaryExcluded =
    env.canaryFolderIds.length > 0 && seedRows.some((r) => r.data.canary === true);

  // Gate 4 md5 cross-check: a canary file byte-duplicated inside the corpus
  // tree defeats the folder-level holdout.
  const corpusRows = await deps.store.listDocs(filesCollection(env.firmId, env.runId));
  const corpusMd5 = new Set(
    corpusRows
      .map((r) => r.data.md5Checksum)
      .filter((m): m is string => typeof m === 'string' && m.length > 0),
  );
  const compromised = seedRows
    .filter(
      (r) =>
        r.data.canary === true &&
        typeof r.data.md5Checksum === 'string' &&
        corpusMd5.has(r.data.md5Checksum),
    )
    .map((r) => (typeof r.data.fileName === 'string' ? r.data.fileName : r.id));

  const results = [
    gate1Recall(artifact.pieces, artifact.matches),
    gate2Purity(artifact.pieces, artifact.matches, edges),
    gate3Fidelity(families),
    gate4Canary(artifact.pieces, artifact.matches, canaryExcluded, compromised),
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
