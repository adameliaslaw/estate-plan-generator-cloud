/**
 * Calibration-session service — the review page's data layer.
 *
 * Everything goes through callables: the clauseMining workspace is
 * functions-only by rules and the packet sits in the staff-only
 * clause-mining/** Storage path, so there is no client-SDK read path.
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';

export interface CalibrationSeedPiece {
  pieceId: string;
  seedFileName: string;
  title: string | null;
  kind: string;
  trustRelevant: boolean;
  normText: string;
}

export interface CalibrationPair {
  pairId: string;
  aText: string;
  bText: string;
  score: number;
}

export interface CalibrationPacket {
  runId: string;
  seedPieces: CalibrationSeedPiece[];
  labelPairs: CalibrationPair[];
  boundaryDocs: unknown[];
  instructions: string;
}

export type PairLabel = 'same' | 'different';
export type BoundaryMark = 'ok' | 'split' | 'merge';

export interface StoredLabels {
  pairs?: Array<{ pairId: string; label: PairLabel }>;
  boundaryMarks?: Array<{ pieceId: string; mark: BoundaryMark; note?: string }>;
}

export async function getCalibrationPacket(
  firmId: string,
  runId: string,
): Promise<{ packet: CalibrationPacket; labels: StoredLabels | null; draft: StoredLabels | null }> {
  const fn = httpsCallable<
    { firmId: string; runId: string },
    { packet: CalibrationPacket; labels: StoredLabels | null; draft: StoredLabels | null }
  >(functions, 'getCalibrationPacket');
  return (await fn({ firmId, runId })).data;
}

export async function submitCalibrationLabels(req: {
  firmId: string;
  runId: string;
  pairs: Array<{ pairId: string; label: PairLabel }>;
  boundaryMarks?: Array<{ pieceId: string; mark: BoundaryMark; note?: string }>;
  /** True = autosave checkpoint, stored apart from final labels. */
  draft?: boolean;
}): Promise<{ saved: number }> {
  const fn = httpsCallable<typeof req, { saved: number }>(functions, 'submitCalibrationLabels');
  return (await fn(req)).data;
}
