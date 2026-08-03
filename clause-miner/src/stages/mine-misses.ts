/**
 * Stage mine-misses — gazetteer expansion from adjudicated normalization
 * misses (checkpoint-2 C4 remediation, step ③→④ bridge).
 *
 * Every NORMALIZATION_MISS verdict is an adjudicator attesting that a
 * client-specific token survived normalization. This stage mines the
 * previous identity run's edges into a SUPPLEMENTAL gazetteer that
 * STAGE=segment merges into every document's per-doc gazetteer, so the
 * missed names fold to placeholders on the re-segment.
 *
 * The filter that keeps common legal vocabulary out of the roster is the
 * SEED LIBRARY ITSELF: seed pieces are client-free boilerplate, so any miss
 * token that also appears in seed text is shared drafting vocabulary, not a
 * name — adding it would redact ordinary words corpus-wide. Only name-shaped
 * tokens absent from the seed vocabulary are admitted. Runs entirely inside
 * GCP: no client name is ever printed to logs.
 */

import { mineNormalizationMisses, type IdentityEdge } from './identity.js';
import { parseSeedPiecesArtifact } from './seed.js';
import {
  edgesPath,
  runLedgerPath,
  seedPiecesPath,
  supplementalGazetteerPath,
} from '../paths.js';
import type { Env } from '../env.js';
import type { BlobStore, DocStore } from '../clients/interfaces.js';

/** Alphabetic, apostrophe/hyphen-tolerant, ≥3 chars — a name-shaped token. */
const NAME_SHAPE_RE = /^[a-z][a-z'’-]{2,}$/i;

export interface SupplementalGazetteer {
  generatedAt: string;
  source: 'normalization-misses';
  /** Miss-pair count the roster was mined from (for the run report). */
  minedFromPairs: number;
  /** Admitted tokens, descending by miss count. */
  names: string[];
  /** Rejected-token tallies — counts only, never the tokens themselves. */
  rejected: { notNameShaped: number; inSeedVocabulary: number };
}

export function buildSupplementalGazetteer(
  edges: readonly IdentityEdge[],
  seedVocabulary: ReadonlySet<string>,
  now: string,
): SupplementalGazetteer {
  const report = mineNormalizationMisses(edges);
  const names: string[] = [];
  let notNameShaped = 0;
  let inSeedVocabulary = 0;
  for (const { token } of report.tokenCounts) {
    if (!NAME_SHAPE_RE.test(token)) {
      notNameShaped++;
      continue;
    }
    if (seedVocabulary.has(token.toLowerCase())) {
      inSeedVocabulary++;
      continue;
    }
    names.push(token.toLowerCase());
  }
  return {
    generatedAt: now,
    source: 'normalization-misses',
    minedFromPairs: report.pairs.length,
    names,
    rejected: { notNameShaped, inSeedVocabulary },
  };
}

export function seedVocabularyOf(pieceTexts: readonly string[]): Set<string> {
  const vocab = new Set<string>();
  for (const text of pieceTexts) {
    for (const token of text.toLowerCase().split(/[^a-z'’-]+/)) {
      if (token.length > 0) vocab.add(token);
    }
  }
  return vocab;
}

export interface MineMissesSummary {
  missPairs: number;
  admitted: number;
  rejectedNotNameShaped: number;
  rejectedSeedVocabulary: number;
}

export async function runMineMisses(
  deps: { store: DocStore; blobs: BlobStore },
  env: Env,
): Promise<MineMissesSummary> {
  let edges: IdentityEdge[];
  try {
    const raw = await deps.blobs.read(edgesPath(env.firmId, env.runId));
    edges = JSON.parse(raw.toString('utf8')) as IdentityEdge[];
  } catch {
    throw new Error(
      'mine-misses: no identity edges artifact for this run — run STAGE=identity first. ' +
        'The supplemental gazetteer is mined from adjudicated NORMALIZATION_MISS verdicts.',
    );
  }
  let seedTexts: string[] = [];
  try {
    const raw = await deps.blobs.read(seedPiecesPath(env.firmId, env.runId));
    seedTexts = parseSeedPiecesArtifact(raw.toString('utf8')).pieces.map(
      (p) => `${p.normText} ${p.sigText}`,
    );
  } catch {
    throw new Error(
      'mine-misses: no seed-pieces artifact — run STAGE=seed first. The seed vocabulary is ' +
        'the filter that keeps shared drafting words out of the supplemental roster; mining ' +
        'without it would admit common legal vocabulary as "names".',
    );
  }
  const gazetteer = buildSupplementalGazetteer(
    edges,
    seedVocabularyOf(seedTexts),
    new Date().toISOString(),
  );
  await deps.blobs.write(
    supplementalGazetteerPath(env.firmId, env.runId),
    JSON.stringify(gazetteer),
  );
  const summary: MineMissesSummary = {
    missPairs: gazetteer.minedFromPairs,
    admitted: gazetteer.names.length,
    rejectedNotNameShaped: gazetteer.rejected.notNameShaped,
    rejectedSeedVocabulary: gazetteer.rejected.inSeedVocabulary,
  };
  await deps.store.set(runLedgerPath(env.firmId, env.runId), {
    stage: 'mine-misses',
    status: 'completed',
    mineMisses: { ...summary },
    updatedAt: new Date().toISOString(),
  });
  return summary;
}
