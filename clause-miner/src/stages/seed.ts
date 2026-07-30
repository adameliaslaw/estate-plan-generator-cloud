/**
 * Stage S — Curated seed ingestion (§11 P1a).
 *
 * Converts Adam's clause library (AAA WILL PIECES, Trust Agreements) with the
 * SAME conversion ladder as the corpus — a gold set measured through a
 * different parser would validate nothing — then segments it with the
 * clause-library segmenter (core/seed-segment.ts), classifies commentary out
 * with haiku, and normalizes each piece through the same normalize → sigText
 * → ring0Hash path the corpus uses. Identical normalization is the whole
 * point: Gate 1 asks whether a seed clause LANDS in a mined family, and it
 * can only land if both sides fold the same way.
 *
 * Blank-token folding (§5.1 #3) is what makes this comparable at all —
 * library pieces carry "____" blanks and JOHN DOE dummies where client
 * documents carry names, and normalize() already folds both to the same
 * placeholders.
 *
 * The output pieces are the gold set for §11 Gates 1–3, the canary set for
 * Gate 4, and the boundary-confirmation half of Adam's calibration session.
 */

import { normalize } from '../core/normalize.js';
import { segmentClauseLibrary } from '../core/seed-segment.js';
import { ring0Hash, toSigText } from '../core/sigtext.js';
import { chainCollapseHook } from '../successor-chain.js';
import { runConvert, seedScope, type SegmentsReadyFile } from './convert.js';
import {
  runLedgerPath,
  seedFileDocPath,
  seedFilesCollection,
  seedPiecesPath,
  segmentsReadyPath,
} from '../paths.js';
import type { Env } from '../env.js';
import type {
  BatchClient,
  BatchRequest,
  BlobStore,
  DocStore,
  DriveClient,
  ShellRunner,
} from '../clients/interfaces.js';

export interface SeedPiece {
  pieceId: string;
  seedFileId: string;
  seedFileName: string;
  pieceIndex: number;
  title: string | null;
  normText: string;
  sigText: string;
  ring0Hash: string;
  separatorSignal: string;
  /** Gate 4: this piece came from a held-out canary file. */
  canary: boolean;
  /**
   * Gate 1 measures recall over TRUST-RELEVANT pieces only — the library
   * covers wills and POAs too, and a will-only clause that never appears in a
   * trust is not a miss.
   */
  trustRelevant: boolean;
  /** haiku verdict; 'commentary' pieces are excluded from every gate. */
  kind: 'clause' | 'commentary';
}

/* ------------------------------------------------------------------ */
/* Commentary / relevance classification (haiku, forced tool)         */
/* ------------------------------------------------------------------ */

export const SEED_PIECE_TOOL = {
  name: 'classify_library_piece',
  description:
    'Classify one piece of an attorney clause library as operative clause text or drafting commentary.',
  input_schema: {
    type: 'object' as const,
    properties: {
      kind: {
        type: 'string',
        enum: ['clause', 'commentary'],
        description:
          'clause = operative text meant to appear in an executed instrument. ' +
          'commentary = a drafting note, instruction, citation or heading ABOUT the clause.',
      },
      trust_relevant: {
        type: 'boolean',
        description:
          'True if this text could appear in a revocable living trust (including provisions shared with wills). False for will-only or power-of-attorney-only text.',
      },
      title: {
        type: 'string',
        description: 'Short descriptive title for the piece (≤ 8 words).',
      },
    },
    required: ['kind', 'trust_relevant', 'title'],
  },
};

export function buildSeedPieceRequest(pieceId: string, text: string): BatchRequest {
  return {
    customId: `seedpiece:${pieceId}`,
    model: 'haiku',
    maxTokens: 256,
    system:
      'You are reading one excerpt from an estate-planning attorney\'s clause library — a file of ' +
      'reusable drafting language. Decide whether the excerpt is OPERATIVE clause text (language ' +
      'that goes into an executed instrument) or COMMENTARY (a drafting note, usage instruction, ' +
      'citation, or editorial heading about the language). Blanks such as "____" and dummy names ' +
      'such as JOHN DOE are normal in operative text and do NOT make it commentary.',
    userText: text.slice(0, 8000),
    tool: SEED_PIECE_TOOL,
  };
}

/* ------------------------------------------------------------------ */
/* Stage orchestration                                                */
/* ------------------------------------------------------------------ */

export interface SeedDeps {
  drive: DriveClient;
  store: DocStore;
  blobs: BlobStore;
  shell: ShellRunner;
  batches: BatchClient;
  tmpRoot?: string;
}

export interface SeedSummary {
  seedFiles: number;
  converted: number;
  pieces: number;
  clausePieces: number;
  commentaryPieces: number;
  trustRelevant: number;
  canaryPieces: number;
  unclassified: number;
}

export async function runSeed(deps: SeedDeps, env: Env): Promise<SeedSummary> {
  if (env.seedFolderIds.length === 0) {
    throw new Error(
      'CLAUSE_MINER_SEED_FOLDER_IDS is empty — the seed stage has nothing to ingest. ' +
        'The curated library is the gold set for §11 Gates 1–3; running without it would ' +
        'report vacuous passes.',
    );
  }

  // Same ladder as the corpus, seed collection (§11 P1 / paths.seedFilesCollection).
  const convertSummary = await runConvert(deps, env, seedScope(env));

  const rows = await deps.store.listDocs(seedFilesCollection(env.firmId, env.runId));
  const converted = rows.filter((r) => r.data.status === 'converted');

  interface Draft {
    piece: Omit<SeedPiece, 'kind' | 'trustRelevant'> & { rawText: string };
  }
  const drafts: Draft[] = [];

  for (const row of converted) {
    const readyRaw = await deps.blobs.read(segmentsReadyPath(env.firmId, row.id));
    const ready = JSON.parse(readyRaw.toString('utf8')) as SegmentsReadyFile;
    const fileName = typeof row.data.fileName === 'string' ? row.data.fileName : row.id;
    const canary = row.data.canary === true;

    for (const draft of segmentClauseLibrary(ready.paragraphs.map((p) => p.text))) {
      const rawText = draft.paragraphs.join('\n');
      // Empty gazetteer: a library has no client to name. Dummy names and
      // blanks fold through normalize()'s blank-token pass (§5.1 #3).
      const { normText } = normalize(rawText, []);
      const sigText = toSigText(normText, { chainCollapse: chainCollapseHook });
      drafts.push({
        piece: {
          pieceId: `${row.id}:${draft.pieceIndex}`,
          seedFileId: row.id,
          seedFileName: fileName,
          pieceIndex: draft.pieceIndex,
          title: draft.title,
          normText,
          sigText,
          ring0Hash: ring0Hash(sigText),
          separatorSignal: draft.separatorSignal,
          canary,
          rawText,
        },
      });
    }
  }

  const summary: SeedSummary = {
    seedFiles: rows.length,
    converted: convertSummary.converted + convertSummary.passthrough + convertSummary.fallbackText,
    pieces: drafts.length,
    clausePieces: 0,
    commentaryPieces: 0,
    trustRelevant: 0,
    canaryPieces: 0,
    unclassified: 0,
  };

  // ---- haiku classification pass ---------------------------------------
  const byId = new Map<string, { kind: 'clause' | 'commentary'; trustRelevant: boolean; title: string | null }>();
  if (drafts.length > 0) {
    const requests = drafts.map((d) => buildSeedPieceRequest(d.piece.pieceId, d.piece.rawText));
    const batchId = await deps.batches.submitBatch('seed-piece-classify', requests);
    const results = await deps.batches.pollBatch(batchId);
    for (const r of results) {
      const id = r.customId.replace(/^seedpiece:/, '');
      if (r.ok !== true || r.toolInput === undefined) continue;
      const kind = r.toolInput.kind === 'commentary' ? 'commentary' : 'clause';
      byId.set(id, {
        kind,
        trustRelevant: r.toolInput.trust_relevant === true,
        title: typeof r.toolInput.title === 'string' ? r.toolInput.title : null,
      });
    }
  }

  const pieces: SeedPiece[] = drafts.map((d) => {
    const verdict = byId.get(d.piece.pieceId);
    if (verdict === undefined) summary.unclassified++;
    // Fail SAFE, not silent: an unclassified piece stays a clause and stays
    // trust-relevant, so it counts AGAINST Gate 1 recall rather than
    // quietly shrinking the denominator it is measured over.
    const kind = verdict?.kind ?? 'clause';
    const trustRelevant = verdict?.trustRelevant ?? true;
    const { rawText: _rawText, ...rest } = d.piece;
    return { ...rest, title: rest.title ?? verdict?.title ?? null, kind, trustRelevant };
  });

  for (const p of pieces) {
    if (p.kind === 'commentary') summary.commentaryPieces++;
    else summary.clausePieces++;
    if (p.kind === 'clause' && p.trustRelevant) summary.trustRelevant++;
    if (p.canary && p.kind === 'clause') summary.canaryPieces++;
  }

  await deps.blobs.write(seedPiecesPath(env.firmId, env.runId), JSON.stringify(pieces));
  for (const row of converted) {
    await deps.store.set(seedFileDocPath(env.firmId, env.runId, row.id), {
      status: 'seed-segmented',
      pieceCount: pieces.filter((p) => p.seedFileId === row.id).length,
      updatedAt: new Date().toISOString(),
    });
  }
  await deps.store.set(runLedgerPath(env.firmId, env.runId), {
    stage: 'seed',
    status: 'completed',
    seed: { ...summary },
    updatedAt: new Date().toISOString(),
  });
  return summary;
}
