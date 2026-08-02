/**
 * §11 P1 / §4.3 — seed calibration: "thresholds are calibrated, not asserted".
 *
 * Two sources of labeled pairs:
 *
 *  1. **Adam's own filing, for free.** Two DISTINCT pieces in his curated
 *     library are two clauses he chose to keep apart — that is a recorded
 *     split decision, and any near-duplicate pair among them is a labeled
 *     NEGATIVE. This is the cheap half and it is the half that measures the
 *     error the checkpoint exists to prevent.
 *  2. **~30 pairs he labels by hand**, sampled from the pilot's OWN candidate
 *     band (active learning) — the pairs where a threshold change actually
 *     flips an answer. Sampling uniformly would spend his hour on pairs that
 *     are obviously the same or obviously different.
 *
 * What gets tuned is the AUTO-MERGE decision: a pair merges without a model
 * looking at it only if LSH proposes it AND the deterministic diff filter
 * calls the difference trivial. Selection is F1-maximizing **subject to zero
 * false auto-merges**, because §4.3 and §13 risk 1 both name over-merge as
 * the catastrophic error — a tuner that traded one bad merge for a point of
 * F1 would contradict the design it is calibrating.
 */

import { config } from './config.js';
import { classifyDiff } from './core/diff.js';
import { candidatePairs, jaccardFromSignatures, minhashSignature } from './core/minhash.js';

export type PairLabel = 'same' | 'different';

export interface LabeledPair {
  pairId: string;
  aId: string;
  bId: string;
  aText: string;
  bText: string;
  label: PairLabel;
  /** Where the label came from — the report distinguishes them. */
  source: 'seed-structure' | 'adam';
}

export interface Banding {
  lshBands: number;
  lshRows: number;
}

export interface BandingScore extends Banding {
  /** Labeled SAME pairs LSH proposed at all (a miss can never merge). */
  candidateRecall: number;
  autoMergePrecision: number;
  autoMergeRecall: number;
  f1: number;
  /** DIFFERENT pairs auto-merged — the catastrophic error. Must be 0. */
  falseAutoMerges: number;
  falseAutoMergeIds: string[];
}

export interface TuningResult {
  scores: BandingScore[];
  /** Best split with zero false auto-merges, or null when none qualifies. */
  selected: Banding | null;
  /** Set when nothing qualified — calibration FAILS rather than picking. */
  failure: string | null;
  labelCounts: { same: number; different: number; fromSeed: number; fromAdam: number };
}

/** Would the pipeline auto-merge this pair at the given banding? */
function autoMerges(pair: LabeledPair, banding: Banding): { candidate: boolean; merged: boolean } {
  const entries = [
    { id: 'a', signature: minhashSignature(pair.aText) },
    { id: 'b', signature: minhashSignature(pair.bText) },
  ];
  let candidate = false;
  for (const _pair of candidatePairs(entries, banding)) {
    candidate = true;
    break;
  }
  if (!candidate) return { candidate: false, merged: false };
  const diff = classifyDiff(pair.aText, pair.bText);
  return { candidate: true, merged: diff.classification === 'trivial' && !diff.hardRoute };
}

export function scoreBanding(pairs: readonly LabeledPair[], banding: Banding): BandingScore {
  let sameTotal = 0;
  let sameCandidates = 0;
  let truePositives = 0;
  let falsePositives = 0;
  const falseAutoMergeIds: string[] = [];

  for (const pair of pairs) {
    const { candidate, merged } = autoMerges(pair, banding);
    if (pair.label === 'same') {
      sameTotal++;
      if (candidate) sameCandidates++;
      if (merged) truePositives++;
    } else if (merged) {
      falsePositives++;
      falseAutoMergeIds.push(pair.pairId);
    }
  }

  const precision =
    truePositives + falsePositives === 0 ? 1 : truePositives / (truePositives + falsePositives);
  const recall = sameTotal === 0 ? 0 : truePositives / sameTotal;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    ...banding,
    candidateRecall: sameTotal === 0 ? 0 : sameCandidates / sameTotal,
    autoMergePrecision: precision,
    autoMergeRecall: recall,
    f1,
    falseAutoMerges: falsePositives,
    falseAutoMergeIds,
  };
}

export function tuneBanding(
  pairs: readonly LabeledPair[],
  grid: readonly Banding[] = config.calibration.lshGrid,
): TuningResult {
  const labelCounts = {
    same: pairs.filter((p) => p.label === 'same').length,
    different: pairs.filter((p) => p.label === 'different').length,
    fromSeed: pairs.filter((p) => p.source === 'seed-structure').length,
    fromAdam: pairs.filter((p) => p.source === 'adam').length,
  };
  const scores = grid.map((banding) => scoreBanding(pairs, banding));

  if (labelCounts.same === 0) {
    return {
      scores,
      selected: null,
      failure:
        'no SAME-labeled pairs — recall is unmeasurable, so no split can be chosen. ' +
        'Adam\'s labeling pass supplies them (§11 P1b).',
      labelCounts,
    };
  }

  const clean = scores.filter((s) => s.falseAutoMerges === 0);
  if (clean.length === 0) {
    return {
      scores,
      selected: null,
      failure:
        'every candidate banding auto-merges at least one pair labeled DIFFERENT. ' +
        'Over-merge is the catastrophic error (§4.3) — tighten the diff whitelist or ' +
        'grow the legal-delta lexicon rather than accepting a split.',
      labelCounts,
    };
  }
  // Deterministic: F1, then higher candidate recall, then more bands.
  const best = [...clean].sort(
    (a, b) =>
      b.f1 - a.f1 || b.candidateRecall - a.candidateRecall || b.lshBands - a.lshBands,
  )[0];
  return {
    scores,
    selected: { lshBands: best.lshBands, lshRows: best.lshRows },
    failure: null,
    labelCounts,
  };
}

/* ------------------------------------------------------------------ */
/* Pair generation                                                    */
/* ------------------------------------------------------------------ */

export interface TextItem {
  id: string;
  sigText: string;
  normText: string;
  /** Distinct pieces of the curated library are distinct clause decisions. */
  seedPieceId?: string;
}

export interface CandidatePair {
  pairId: string;
  aId: string;
  bId: string;
  /** sigText — what the tuner minhashes and diffs. NOT for display. */
  aText: string;
  bText: string;
  /** normText — what the review UI shows Adam (§5.2: sigText is never displayed). */
  aDisplay: string;
  bDisplay: string;
  /** MinHash Jaccard — what the band sample is drawn against. */
  score: number;
  /** True when the deterministic diff filter would auto-merge it today. */
  trivial: boolean;
}

/** All LSH candidate pairs over a set of texts, with scores and diff class. */
export function generateCandidatePairs(
  items: readonly TextItem[],
  banding?: Banding,
): CandidatePair[] {
  const entries = items.map((i) => ({ id: i.id, signature: minhashSignature(i.sigText) }));
  const sigById = new Map(entries.map((e) => [e.id, e.signature]));
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: CandidatePair[] = [];
  for (const [idA, idB] of candidatePairs(entries, banding)) {
    const a = byId.get(idA);
    const b = byId.get(idB);
    if (a === undefined || b === undefined) continue;
    const diff = classifyDiff(a.sigText, b.sigText);
    out.push({
      pairId: `${idA.slice(0, 12)}~${idB.slice(0, 12)}`,
      aId: idA,
      bId: idB,
      aText: a.sigText,
      bText: b.sigText,
      aDisplay: a.normText,
      bDisplay: b.normText,
      score: jaccardFromSignatures(
        sigById.get(idA) as Uint32Array,
        sigById.get(idB) as Uint32Array,
      ),
      trivial: diff.classification === 'trivial' && !diff.hardRoute,
    });
  }
  return out.sort((x, y) => y.score - x.score || x.pairId.localeCompare(y.pairId));
}

/**
 * Negative labels for free: any candidate pair drawn from two DIFFERENT
 * curated pieces is a pair Adam already decided to keep apart.
 */
export function seedNegativePairs(
  seedItems: readonly TextItem[],
  banding?: Banding,
): LabeledPair[] {
  const pairs = generateCandidatePairs(seedItems, banding);
  const byId = new Map(seedItems.map((i) => [i.id, i]));
  return pairs
    .filter((p) => {
      const a = byId.get(p.aId);
      const b = byId.get(p.bId);
      return (
        a?.seedPieceId !== undefined &&
        b?.seedPieceId !== undefined &&
        a.seedPieceId !== b.seedPieceId
      );
    })
    .map((p) => ({
      pairId: p.pairId,
      aId: p.aId,
      bId: p.bId,
      aText: p.aText,
      bText: p.bText,
      label: 'different' as const,
      source: 'seed-structure' as const,
    }));
}

/**
 * §11 P1b active-learning sample: the pairs nearest the middle of the
 * decision band, where the answer is genuinely in doubt. Deterministic —
 * same inputs, same 30 pairs, so a re-run does not re-ask Adam a new set.
 */
export function sampleLabelPairs(
  candidates: readonly CandidatePair[],
  count: number = config.calibration.labelPairCount,
  band: { low: number; high: number } = config.calibration.labelBand,
): CandidatePair[] {
  const midpoint = (band.low + band.high) / 2;
  return [...candidates]
    .filter((p) => p.score >= band.low && p.score <= band.high)
    .sort(
      (a, b) =>
        Math.abs(a.score - midpoint) - Math.abs(b.score - midpoint) ||
        a.pairId.localeCompare(b.pairId),
    )
    .slice(0, count);
}
