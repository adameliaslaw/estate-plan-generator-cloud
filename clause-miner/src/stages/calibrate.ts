/**
 * Stage C — Calibration (§11 P1), the stage that produces Adam's bounded
 * one-hour session and consumes its result.
 *
 * Two modes, decided by whether his labels exist yet:
 *
 *  - **emit** — no labels on file. Writes the packet: (a) the segmented
 *    curated-seed pieces for boundary confirmation, (b) ~30 same/different
 *    pairs sampled from the pilot's own candidate band, (c) a handful of
 *    representative trusts spanning eras for hand-marked boundaries. This is
 *    the CLAUDE.md rule-9 "one bounded diagnostic" instead of guessing at
 *    thresholds.
 *  - **tune** — labels present. Scores every banding split against the
 *    labeled set (his hand labels PLUS the free negatives implied by his own
 *    filing) and writes the selected thresholds to the run ledger, where the
 *    corpus run reads them.
 *
 * Tuning can FAIL, deliberately: if no split avoids auto-merging a pair he
 * called different, the stage records the failure and selects nothing rather
 * than shipping the least-bad over-merger.
 */

import { config } from '../config.js';
import {
  generateCandidatePairs,
  sampleLabelPairs,
  seedNegativePairs,
  tuneBanding,
  type CandidatePair,
  type LabeledPair,
  type TextItem,
  type TuningResult,
} from '../calibration.js';
import {
  calibrationLabelsPath,
  calibrationPacketPath,
  runLedgerPath,
  seedPiecesPath,
} from '../paths.js';
import { eraYear, loadArtifacts, loadDocFacts, loadSegmentedRows } from './shared.js';
import type { SeedPiece } from './seed.js';
import type { Env } from '../env.js';
import type { BlobStore, DocData, DocStore } from '../clients/interfaces.js';

export interface BoundaryReviewDoc {
  driveFileId: string;
  fileName: string;
  eraYear: number | null;
  /** First line of each segment — enough to confirm a boundary is right. */
  segmentOpeners: Array<{ segmentIndex: number; structureSignal: string; opener: string }>;
}

export interface CalibrationPacket {
  runId: string;
  seedPieces: Array<{
    pieceId: string;
    seedFileName: string;
    title: string | null;
    separatorSignal: string;
    kind: string;
    trustRelevant: boolean;
    normText: string;
  }>;
  labelPairs: CandidatePair[];
  boundaryDocs: BoundaryReviewDoc[];
  instructions: string;
}

export interface CalibrateSummary {
  mode: 'emit' | 'tune';
  seedPieces: number;
  labelPairsRequested: number;
  boundaryDocs: number;
  /** tune mode only. */
  labelsReceived: number;
  selected: { lshBands: number; lshRows: number } | null;
  failure: string | null;
}

export interface CalibrateDeps {
  store: DocStore;
  blobs: BlobStore;
}

const INSTRUCTIONS =
  'Three asks, ~1 hour total. (1) Boundaries: for each curated piece, is this ONE clause? ' +
  'Mark split/merge where it is not. (2) Pairs: for each pair, are these the SAME clause — ' +
  'interchangeable after filling in names and values — or DIFFERENT clauses? When in doubt, ' +
  'answer different. (3) Trusts: skim the segment openers and flag any boundary that cuts a ' +
  'clause in half or runs two clauses together.';

async function loadSeedPieces(deps: CalibrateDeps, env: Env): Promise<SeedPiece[]> {
  try {
    const raw = await deps.blobs.read(seedPiecesPath(env.firmId, env.runId));
    return JSON.parse(raw.toString('utf8')) as SeedPiece[];
  } catch {
    return [];
  }
}

/** Parse the labels doc the review UI writes. Unknown labels are ignored. */
export function parseLabels(
  data: DocData | null,
  candidates: readonly CandidatePair[],
): LabeledPair[] {
  if (data === null || !Array.isArray(data.pairs)) return [];
  const byId = new Map(candidates.map((c) => [c.pairId, c]));
  const out: LabeledPair[] = [];
  for (const entry of data.pairs as Array<Record<string, unknown>>) {
    const pairId = typeof entry.pairId === 'string' ? entry.pairId : null;
    const label = entry.label === 'same' ? 'same' : entry.label === 'different' ? 'different' : null;
    if (pairId === null || label === null) continue;
    const candidate = byId.get(pairId);
    if (candidate === undefined) continue; // stale label from another run
    out.push({
      pairId,
      aId: candidate.aId,
      bId: candidate.bId,
      aText: candidate.aText,
      bText: candidate.bText,
      label,
      source: 'adam',
    });
  }
  return out;
}

/**
 * Representative documents for hand-marked boundaries: spread across eras so
 * the sample includes the WP-era conversions the reflow pass exists for, not
 * just the clean InteractiveLegal ones.
 */
export function pickBoundaryDocs<T extends { driveFileId: string; eraYear: number | null }>(
  docs: readonly T[],
  count: number,
): T[] {
  if (docs.length <= count) return [...docs];
  const dated = docs
    .filter((d) => d.eraYear !== null)
    .sort((a, b) => (a.eraYear as number) - (b.eraYear as number) || a.driveFileId.localeCompare(b.driveFileId));
  const undated = docs
    .filter((d) => d.eraYear === null)
    .sort((a, b) => a.driveFileId.localeCompare(b.driveFileId));
  const out: T[] = [];
  // Even spread across the era range, then undated docs fill any shortfall
  // (an undocumented era is exactly where segmentation is least trusted).
  if (dated.length > 0) {
    const want = Math.min(count, dated.length);
    for (let i = 0; i < want; i++) {
      out.push(dated[Math.floor((i * (dated.length - 1)) / Math.max(1, want - 1))]);
    }
  }
  for (const d of undated) {
    if (out.length >= count) break;
    out.push(d);
  }
  return out.slice(0, count);
}

export async function runCalibrate(deps: CalibrateDeps, env: Env): Promise<CalibrateSummary> {
  const pieces = await loadSeedPieces(deps, env);
  if (pieces.length === 0) {
    throw new Error(
      'no curated-seed pieces for this run — run STAGE=seed first. Calibrating without ' +
        'the seed would tune thresholds against nothing (§11 P1).',
    );
  }

  const clausePieces = pieces.filter((p) => p.kind === 'clause');
  const seedItems: TextItem[] = clausePieces.map((p) => ({
    id: `seed:${p.pieceId}`,
    sigText: p.sigText,
    normText: p.normText,
    seedPieceId: p.pieceId,
  }));

  // Candidate band comes from the pilot's OWN segments where they exist, so
  // the pairs Adam labels are the pairs the corpus run will actually face.
  const rows = await loadSegmentedRows(deps.store, env);
  const artifacts = await loadArtifacts(deps.blobs, env, rows);
  const corpusItems: TextItem[] = [];
  const seenHash = new Set<string>();
  for (const artifact of artifacts.values()) {
    for (const seg of artifact.segments) {
      if (seenHash.has(seg.ring0Hash)) continue;
      seenHash.add(seg.ring0Hash);
      corpusItems.push({ id: seg.ring0Hash, sigText: seg.sigText, normText: seg.normText });
    }
  }

  const allItems = [...seedItems, ...corpusItems];
  const candidates = generateCandidatePairs(allItems);
  const labelPairs = sampleLabelPairs(candidates);

  const labels = parseLabels(
    await deps.store.get(calibrationLabelsPath(env.firmId, env.runId)),
    labelPairs,
  );

  // ---- emit mode -------------------------------------------------------
  const docFacts = await loadDocFacts(deps.store, env);
  const boundaryCandidates = rows.map((row) => ({
    driveFileId: row.id,
    fileName: typeof row.data.fileName === 'string' ? row.data.fileName : row.id,
    eraYear: eraYear(docFacts.get(row.id)?.executionDate ?? null),
  }));
  const boundaryDocs: BoundaryReviewDoc[] = pickBoundaryDocs(
    boundaryCandidates,
    config.calibration.handMarkDocCount,
  ).map((doc) => {
    const artifact = artifacts.get(doc.driveFileId);
    return {
      ...doc,
      segmentOpeners:
        artifact === undefined
          ? []
          : artifact.segments.map((seg) => ({
              segmentIndex: seg.segmentIndex,
              structureSignal: seg.structureSignal,
              opener: seg.normText.split('\n')[0].slice(0, 160),
            })),
    };
  });

  const packet: CalibrationPacket = {
    runId: env.runId,
    seedPieces: clausePieces.map((p) => ({
      pieceId: p.pieceId,
      seedFileName: p.seedFileName,
      title: p.title,
      separatorSignal: p.separatorSignal,
      kind: p.kind,
      trustRelevant: p.trustRelevant,
      normText: p.normText,
    })),
    labelPairs,
    boundaryDocs,
    instructions: INSTRUCTIONS,
  };
  await deps.blobs.write(calibrationPacketPath(env.firmId, env.runId), JSON.stringify(packet));

  const summary: CalibrateSummary = {
    mode: labels.length > 0 ? 'tune' : 'emit',
    seedPieces: clausePieces.length,
    labelPairsRequested: labelPairs.length,
    boundaryDocs: boundaryDocs.length,
    labelsReceived: labels.length,
    selected: null,
    failure: null,
  };

  // ---- tune mode -------------------------------------------------------
  let tuning: TuningResult | null = null;
  if (labels.length > 0) {
    const negatives = seedNegativePairs(seedItems);
    tuning = tuneBanding([...negatives, ...labels]);
    summary.selected = tuning.selected;
    summary.failure = tuning.failure;
  }

  await deps.store.set(runLedgerPath(env.firmId, env.runId), {
    stage: 'calibrate',
    status: 'completed',
    calibrate: {
      ...summary,
      packetPath: calibrationPacketPath(env.firmId, env.runId),
      labelsPath: calibrationLabelsPath(env.firmId, env.runId),
      ...(tuning !== null
        ? {
            tuning: {
              scores: tuning.scores,
              labelCounts: tuning.labelCounts,
            },
          }
        : {}),
    },
    // Thresholds the corpus run reads (§9 run-ledger `thresholds`). Only
    // written on a successful tune — a failed calibration leaves the
    // configured defaults in force rather than a half-chosen split.
    ...(tuning?.selected != null
      ? {
          thresholds: {
            lshBands: tuning.selected.lshBands,
            lshRows: tuning.selected.lshRows,
            calibratedAt: new Date().toISOString(),
            labelCounts: tuning.labelCounts,
          },
        }
      : {}),
    updatedAt: new Date().toISOString(),
  });
  return summary;
}
