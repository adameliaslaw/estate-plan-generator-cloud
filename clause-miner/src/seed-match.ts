/**
 * Seed → family matching (§11 Gates 1–3, §6.2 seed-divergence).
 *
 * Gate 1 asks whether a curated seed clause "lands in some mined family VIA
 * THE SAME IDENTITY RINGS" — so this deliberately reuses Ring 0's exact hash,
 * Ring 1's MinHash candidates and the same deterministic diff filter, and
 * routes every content diff to the same merge-averse sonnet adjudicator. A
 * bespoke "is this close enough" similarity check here would make the gate
 * measure something the pipeline does not actually do.
 *
 * The result feeds three consumers:
 *   - Gate 1 (recall): how many trust-relevant seed clauses matched.
 *   - Gate 2 (purity): seed pieces Adam filed SEPARATELY must not land in one
 *     family without a flagged adjudication transcript.
 *   - §6.2 / Gate 3: matched families whose data-chosen canonical diverges
 *     from the seed text are flagged `seed-divergent` for side-by-side review
 *     — a DIAGNOSTIC, never an auto-promotion (Adam's decision #2).
 */

import { classifyDiff } from './core/diff.js';
import { candidatePairs, minhashSignature, jaccardFromSignatures } from './core/minhash.js';
import type { SeedPiece } from './stages/seed.js';

const SEED_PREFIX = 'seed:';

export interface MatchableUnique {
  ring0Hash: string;
  sigText: string;
  normText: string;
}

export interface SeedMatch {
  pieceId: string;
  seedFileId: string;
  familyId: string;
  matchedHash: string;
  ring: 0 | 1;
  kind: 'exact' | 'trivial' | 'adjudicated';
  scores: Record<string, number>;
  adjudicationRef: string | null;
}

export interface SeedMatchCandidate {
  piece: SeedPiece;
  unique: MatchableUnique;
  familyId: string;
  scores: Record<string, number>;
}

export interface SeedMatchPlan {
  matches: SeedMatch[];
  /** Content diffs — must be adjudicated before they may count as matches. */
  adjudicationCandidates: SeedMatchCandidate[];
}

/**
 * Ring 0 + Ring 1 planning. Pure: no I/O, no LLM. Returns confirmed matches
 * (exact + mechanically-trivial diffs) and the candidates that require
 * adjudication.
 */
export function planSeedMatches(
  pieces: readonly SeedPiece[],
  uniques: readonly MatchableUnique[],
  familyByHash: ReadonlyMap<string, string>,
  banding?: { lshBands: number; lshRows: number },
): SeedMatchPlan {
  const plan: SeedMatchPlan = { matches: [], adjudicationCandidates: [] };
  // Commentary is not clause text and is measured by no gate.
  const clausePieces = pieces.filter((p) => p.kind === 'clause');
  const uniqueByHash = new Map(uniques.map((u) => [u.ring0Hash, u]));

  // ---- Ring 0: exact signature hash ------------------------------------
  const unmatched: SeedPiece[] = [];
  for (const piece of clausePieces) {
    const familyId = familyByHash.get(piece.ring0Hash);
    if (familyId !== undefined) {
      plan.matches.push({
        pieceId: piece.pieceId,
        seedFileId: piece.seedFileId,
        familyId,
        matchedHash: piece.ring0Hash,
        ring: 0,
        kind: 'exact',
        scores: {},
        adjudicationRef: null,
      });
    } else {
      unmatched.push(piece);
    }
  }
  if (unmatched.length === 0 || uniques.length === 0) return plan;

  // ---- Ring 1: LSH candidates across the seed/corpus boundary ----------
  const entries = [
    ...unmatched.map((p) => ({
      id: `${SEED_PREFIX}${p.pieceId}`,
      signature: minhashSignature(p.sigText),
    })),
    ...uniques.map((u) => ({ id: u.ring0Hash, signature: minhashSignature(u.sigText) })),
  ];
  const sigById = new Map(entries.map((e) => [e.id, e.signature]));
  const pieceById = new Map(unmatched.map((p) => [p.pieceId, p]));

  // Best candidate per piece: a seed clause belongs to at most one family.
  const best = new Map<string, SeedMatchCandidate & { trivial: boolean }>();

  for (const [idA, idB] of candidatePairs(entries, banding)) {
    const aIsSeed = idA.startsWith(SEED_PREFIX);
    const bIsSeed = idB.startsWith(SEED_PREFIX);
    if (aIsSeed === bIsSeed) continue; // seed-seed and corpus-corpus are not this pass's job
    const seedId = (aIsSeed ? idA : idB).slice(SEED_PREFIX.length);
    const corpusHash = aIsSeed ? idB : idA;
    const piece = pieceById.get(seedId);
    const unique = uniqueByHash.get(corpusHash);
    const familyId = familyByHash.get(corpusHash);
    if (piece === undefined || unique === undefined || familyId === undefined) continue;

    const jaccard = jaccardFromSignatures(
      sigById.get(aIsSeed ? idA : idB) as Uint32Array,
      sigById.get(aIsSeed ? idB : idA) as Uint32Array,
    );
    const diff = classifyDiff(piece.sigText, unique.sigText);
    const trivial = diff.classification === 'trivial' && !diff.hardRoute;
    const candidate = {
      piece,
      unique,
      familyId,
      scores: { minhashJaccard: jaccard },
      trivial,
    };
    const incumbent = best.get(seedId);
    // A mechanically-trivial diff beats any content diff; ties break on score,
    // then on hash so the choice is replayable.
    const better =
      incumbent === undefined ||
      (trivial && !incumbent.trivial) ||
      (trivial === incumbent.trivial &&
        (jaccard > (incumbent.scores.minhashJaccard ?? 0) ||
          (jaccard === incumbent.scores.minhashJaccard &&
            unique.ring0Hash < incumbent.unique.ring0Hash)));
    if (better) best.set(seedId, candidate);
  }

  for (const candidate of best.values()) {
    if (candidate.trivial) {
      plan.matches.push({
        pieceId: candidate.piece.pieceId,
        seedFileId: candidate.piece.seedFileId,
        familyId: candidate.familyId,
        matchedHash: candidate.unique.ring0Hash,
        ring: 1,
        kind: 'trivial',
        scores: candidate.scores,
        adjudicationRef: null,
      });
    } else {
      const { trivial: _trivial, ...rest } = candidate;
      plan.adjudicationCandidates.push(rest);
    }
  }
  return plan;
}

/** Deterministic id for a seed adjudication transcript. */
export function seedPairId(pieceId: string, ring0Hash: string): string {
  return `seed-${pieceId.replace(/[^A-Za-z0-9]/g, '_').slice(0, 24)}-${ring0Hash.slice(0, 12)}`;
}
