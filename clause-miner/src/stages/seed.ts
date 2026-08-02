/**
 * Stage S — Curated seed ingestion (§11 P1a), revised 2026-08-02.
 *
 * The first version ran every seed file through a clause-LIBRARY segmenter
 * (separator rules / option labels / blank gaps). Adam's library turned out
 * to be a mixed forms archive — complete will/trust/POA templates, letters
 * and intake forms alongside true clause pieces — so whole instruments
 * surfaced as single "clauses" in the calibration packet, and POA text
 * entered the label pairs despite the POA exclusion decision.
 *
 * Revised flow (Adam's decisions, 2026-08-02):
 *  1. Convert with the SAME ladder as the corpus (unchanged) — a gold set
 *     measured through a different parser would validate nothing.
 *  2. Triage-classify every seed FILE (haiku, forced tool): docCategory +
 *     contentKind (complete-document vs clause-excerpt). Only trust/will
 *     content proceeds; POA (limited clause variation — Adam), living wills,
 *     letters, forms and misc are excluded BY NAME in the run ledger. No
 *     silent drops.
 *  3. Segment included files with the SAME instrument segmentation the
 *     corpus uses (reflow → style hints → text grammar). The litmus test: a
 *     complete document the instrument segmenter cannot segment carries no
 *     minable clauses and is excluded as 'unsegmentable' — never kept as one
 *     giant piece. Clause-excerpt files are exempt from that exclusion: one
 *     clean block IS their normal shape.
 *  4. Execution blocks (attestation, notary, witness lines) never become
 *     gold pieces; deterministic commentary lines are stripped as before.
 *  5. Pieces normalize through the same normalize → sigText → ring0Hash path
 *     the corpus uses, then haiku classifies clause/commentary + trust
 *     relevance per piece.
 *
 * The output pieces are the gold set for §11 Gates 1–3, the canary set for
 * Gate 4, and the boundary-confirmation half of Adam's calibration session.
 *
 * Piece ids are `${fileId}:s${segmentIndex}` — the `s` marks instrument-
 * segmented pieces so ids can never collide with the pre-revision
 * `${fileId}:${pieceIndex}` ids still present in old ledgered batches and
 * saved boundary-mark drafts.
 */

import { config } from '../config.js';
import { normalize } from '../core/normalize.js';
import { reflowParagraphs } from '../core/reflow.js';
import {
  extractLeadingHeading,
  segmentParagraphs,
  type ProvisionBlock,
  type SegmentationFlag,
} from '../core/segment.js';
import { detectExecutionBlock } from '../core/execution-blocks.js';
import { isCommentaryLine } from '../core/seed-segment.js';
import { ring0Hash, toSigText } from '../core/sigtext.js';
import { chainCollapseHook } from '../successor-chain.js';
import { deriveBoundaryHints } from '../ooxml.js';
import { DOC_CATEGORIES, type DocCategory } from './triage.js';
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
  DocData,
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
  /** Leading structural marker from the source ("FIRST", "ARTICLE IV"), if any. */
  heading: string | null;
  normText: string;
  sigText: string;
  ring0Hash: string;
  /** Which §4.2 signal opened this block ('text-grammar', 'style', 'none'…). */
  structureSignal: string;
  /** Gate 4: this piece came from a held-out canary file. */
  canary: boolean;
  /**
   * Gate 1 measures recall over TRUST-RELEVANT pieces only — the library
   * covers wills too, and a will-only clause that never appears in a trust
   * is not a miss.
   */
  trustRelevant: boolean;
  /** haiku verdict; 'commentary' pieces are excluded from every gate. */
  kind: 'clause' | 'commentary';
}

/* ------------------------------------------------------------------ */
/* File-level triage (haiku, forced tool) — the litmus-test scope     */
/* ------------------------------------------------------------------ */

export type SeedContentKind = 'complete-document' | 'clause-excerpt';

export interface SeedTriage {
  /** null = triage failed → fail SAFE into scope; segmentability decides. */
  docCategory: DocCategory | null;
  contentKind: SeedContentKind;
}

export const SEED_TRIAGE_TOOL = {
  name: 'triage_seed_file',
  description:
    'Classify one file from an estate-planning attorney template/clause library.',
  input_schema: {
    type: 'object' as const,
    properties: {
      docCategory: { type: 'string', enum: DOC_CATEGORIES as unknown as string[] },
      contentKind: {
        type: 'string',
        enum: ['complete-document', 'clause-excerpt'],
        description:
          'complete-document = a full instrument, letter or form (opening, body, execution). ' +
          'clause-excerpt = a fragment of operative drafting language — one or a few clauses ' +
          'kept as reusable library text.',
      },
      confidence: { type: 'number', description: '0.0-1.0' },
    },
    required: ['docCategory', 'contentKind', 'confidence'],
  },
};

const SEED_TRIAGE_SYSTEM = `You are triaging one file from an estate-planning attorney's template and clause library. Classify it into exactly one docCategory:
- trust: trust agreement content — a full trust, amendment, restatement, OR trust clause language
- will: Last Will and Testament or codicil content, full or clause language
- poa: financial or healthcare power of attorney
- livingWill: living will / advance healthcare directive
- letter: correspondence, memos, cover letters
- questionnaire: intake forms, family/asset worksheets, fill-in forms
- invoice: bills, invoices, engagement/fee letters
- other: anything else

Also report contentKind: complete-document for a full instrument, letter or form; clause-excerpt for a fragment of reusable drafting language (one or a few clauses without the shape of a whole document). For a clause-excerpt, docCategory is the instrument the language belongs IN — a trustee-powers paragraph is trust, an executor-appointment clause is will. Blanks such as "____" and dummy names are normal. Output structured JSON via the tool only.`;

export function buildSeedTriageRequest(
  seedFileId: string,
  fileName: string,
  text: string,
): BatchRequest {
  return {
    customId: `seedtriage:${seedFileId}`,
    model: 'haiku',
    maxTokens: 256,
    system: SEED_TRIAGE_SYSTEM,
    userText: `File name: ${fileName}\n\nFile text (truncated):\n${text.slice(0, config.triage.triageChars)}`,
    tool: SEED_TRIAGE_TOOL,
  };
}

export function parseSeedTriage(toolInput: DocData | undefined): SeedTriage {
  const category = (DOC_CATEGORIES as readonly string[]).includes(
    toolInput?.docCategory as string,
  )
    ? (toolInput?.docCategory as DocCategory)
    : null;
  return {
    docCategory: category,
    contentKind: toolInput?.contentKind === 'clause-excerpt' ? 'clause-excerpt' : 'complete-document',
  };
}

/* ------------------------------------------------------------------ */
/* Instrument segmentation for seed files                             */
/* ------------------------------------------------------------------ */

export interface SeedSegmentation {
  blocks: ProvisionBlock[];
  flags: SegmentationFlag[];
}

/**
 * Same signal precedence as the corpus path (segment-normalize
 * segmentDocument): style/numbering hints when the OOXML has them, otherwise
 * reflow then text grammar. Seed and corpus MUST cut the same way, or a gold
 * piece could never land in a mined family (Gate 1).
 */
export function segmentSeedInstrument(ready: SegmentsReadyFile): SeedSegmentation {
  const rawParagraphs = ready.paragraphs.map((p) => p.text);
  const styleHints = deriveBoundaryHints(ready.paragraphs);
  if (styleHints.length > 0) {
    const seg = segmentParagraphs(rawParagraphs, styleHints);
    return { blocks: seg.blocks, flags: seg.flags };
  }
  const seg = segmentParagraphs(reflowParagraphs(rawParagraphs).paragraphs, []);
  return { blocks: seg.blocks, flags: seg.flags };
}

/* ------------------------------------------------------------------ */
/* Piece classification (haiku, forced tool)                          */
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

export interface SeedExcludedFile {
  seedFileId: string;
  fileName: string;
  /** 'out-of-scope:<category>' | 'unsegmentable' | 'over-segmented' | 'no-pieces' */
  reason: string;
}

export interface SeedSummary {
  seedFiles: number;
  converted: number;
  /** Files classified by the seed triage batch THIS run. */
  triaged: number;
  /** Files whose triage failed — kept in scope; segmentability decides. */
  triageFailed: number;
  inScope: number;
  /** reason → count; the named files are in the ledger's excludedFiles. */
  excluded: Record<string, number>;
  pieces: number;
  clausePieces: number;
  commentaryPieces: number;
  trustRelevant: number;
  canaryPieces: number;
  unclassified: number;
  executionBlocksDropped: number;
}

const ELIGIBLE_STATUSES = new Set(['converted', 'seed-segmented', 'seed-excluded']);

function ledgerBatchIds(ledger: DocData | null, namePattern: RegExp): string[] {
  const batches = (ledger?.batches as Record<string, string> | undefined) ?? {};
  return Object.keys(batches)
    .filter((k) => namePattern.test(k))
    .sort()
    .map((k) => batches[k]);
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
  // A re-run re-segments everything: rows from a completed pass carry
  // 'seed-segmented' / 'seed-excluded', not 'converted'.
  const eligible = rows.filter((r) => ELIGIBLE_STATUSES.has(r.data.status as string));

  const summary: SeedSummary = {
    seedFiles: rows.length,
    converted: convertSummary.converted + convertSummary.passthrough + convertSummary.fallbackText,
    triaged: 0,
    triageFailed: 0,
    inScope: 0,
    excluded: {},
    pieces: 0,
    clausePieces: 0,
    commentaryPieces: 0,
    trustRelevant: 0,
    canaryPieces: 0,
    unclassified: 0,
    executionBlocksDropped: 0,
  };

  const readyByFile = new Map<string, SegmentsReadyFile>();
  for (const row of eligible) {
    const raw = await deps.blobs.read(segmentsReadyPath(env.firmId, row.id));
    readyByFile.set(row.id, JSON.parse(raw.toString('utf8')) as SegmentsReadyFile);
  }
  const fileNameOf = (row: { id: string; data: DocData }): string =>
    typeof row.data.fileName === 'string' ? row.data.fileName : row.id;

  // ---- file-level triage, resume-safe (#243 pattern) -------------------
  const triageByFile = new Map<string, SeedTriage>();
  for (const row of eligible) {
    const stored = row.data.seedTriage as DocData | undefined;
    if (stored !== undefined) triageByFile.set(row.id, parseSeedTriage(stored));
  }

  const ledger = await deps.store.get(runLedgerPath(env.firmId, env.runId));
  const eligibleIds = new Set(eligible.map((r) => r.id));
  const applyTriageResult = async (result: {
    customId: string;
    ok: boolean;
    toolInput: DocData | undefined;
  }): Promise<void> => {
    const fileId = result.customId.replace(/^seedtriage:/, '');
    if (!eligibleIds.has(fileId) || triageByFile.has(fileId)) return;
    if (result.ok !== true || result.toolInput === undefined) return; // retried next run
    const triage = parseSeedTriage(result.toolInput);
    triageByFile.set(fileId, triage);
    summary.triaged++;
    await deps.store.set(seedFileDocPath(env.firmId, env.runId, fileId), {
      seedTriage: {
        docCategory: triage.docCategory,
        contentKind: triage.contentKind,
      },
    });
  };

  for (const priorId of ledgerBatchIds(ledger, /^seed-triage(-\d+)?$/)) {
    for (const result of await deps.batches.pollBatch(priorId)) {
      await applyTriageResult(result);
    }
  }
  const pendingTriage = eligible.filter((r) => !triageByFile.has(r.id));
  if (pendingTriage.length > 0) {
    const requests = pendingTriage.map((row) =>
      buildSeedTriageRequest(
        row.id,
        fileNameOf(row),
        (readyByFile.get(row.id) as SegmentsReadyFile).paragraphs.map((p) => p.text).join('\n'),
      ),
    );
    const batchIds = await deps.batches.submitBatchChunked('seed-triage', requests);
    for (const batchId of batchIds) {
      for (const result of await deps.batches.pollBatch(batchId)) {
        await applyTriageResult(result);
      }
    }
  }

  // ---- scope filter + instrument segmentation --------------------------
  interface Draft {
    piece: Omit<SeedPiece, 'kind' | 'trustRelevant' | 'title'> & { rawText: string };
  }
  const drafts: Draft[] = [];
  const excludedFiles: SeedExcludedFile[] = [];
  const includedFiles: Array<{ id: string }> = [];

  const exclude = async (row: { id: string; data: DocData }, reason: string): Promise<void> => {
    summary.excluded[reason] = (summary.excluded[reason] ?? 0) + 1;
    excludedFiles.push({ seedFileId: row.id, fileName: fileNameOf(row), reason });
    await deps.store.set(seedFileDocPath(env.firmId, env.runId, row.id), {
      status: 'seed-excluded',
      seedExclusionReason: reason,
      pieceCount: 0,
      updatedAt: new Date().toISOString(),
    });
  };

  const scopeCategories = config.seed.scopeCategories as readonly string[];
  for (const row of eligible) {
    const ready = readyByFile.get(row.id) as SegmentsReadyFile;
    const triage = triageByFile.get(row.id) ?? null;
    if (triage === null) summary.triageFailed++;

    // Out-of-scope categories are excluded by Adam's decision (2026-08-02):
    // POA named explicitly (limited clause variation); letters/forms carry no
    // clauses. A failed triage (null category) stays IN scope — the
    // segmentability litmus below is the backstop.
    const category = triage?.docCategory ?? null;
    if (category !== null && !scopeCategories.includes(category)) {
      await exclude(row, `out-of-scope:${category}`);
      continue;
    }

    const seg = segmentSeedInstrument(ready);
    // The litmus test (Adam, 2026-08-02): a complete document the instrument
    // segmenter cannot segment carries no minable clauses. Clause excerpts
    // are exempt — one clean block is their normal shape.
    if (triage?.contentKind !== 'clause-excerpt') {
      if (seg.flags.includes('needs-llm-fallback')) {
        await exclude(row, 'unsegmentable');
        continue;
      }
      if (seg.flags.includes('over-segmented')) {
        await exclude(row, 'over-segmented');
        continue;
      }
    }

    const canary = row.data.canary === true;
    let filePieces = 0;
    seg.blocks.forEach((block, i) => {
      // The leading structural marker ("FIRST:", "ARTICLE IV") is where the
      // clause SAT, not what it says — kept as metadata, out of the hash.
      const { heading, body } = extractLeadingHeading(block.paragraphs);
      // Truncate at the first execution paragraph rather than dropping the
      // block: the last article of a will runs straight into "IN WITNESS
      // WHEREOF" with no boundary between, and its operative text is real.
      const execIdx = body.findIndex((p) => detectExecutionBlock(p) !== null);
      if (execIdx !== -1) summary.executionBlocksDropped++;
      const bodyParas = execIdx === -1 ? body : body.slice(0, execIdx);
      const operative = bodyParas.filter((l) => !isCommentaryLine(l));
      const rawText = operative.join('\n');
      if (rawText.trim().length < config.seed.minPieceChars) return;
      // Empty gazetteer: a library has no client to name. Dummy names and
      // blanks fold through normalize()'s blank-token pass (§5.1 #3).
      const { normText } = normalize(rawText, []);
      const sigText = toSigText(normText, { chainCollapse: chainCollapseHook });
      drafts.push({
        piece: {
          pieceId: `${row.id}:s${i}`,
          seedFileId: row.id,
          seedFileName: fileNameOf(row),
          pieceIndex: i,
          heading,
          normText,
          sigText,
          ring0Hash: ring0Hash(sigText),
          structureSignal: block.structureSignal,
          canary,
          rawText,
        },
      });
      filePieces++;
    });

    if (filePieces === 0) {
      await exclude(row, 'no-pieces');
      continue;
    }
    summary.inScope++;
    includedFiles.push({ id: row.id });
  }
  summary.pieces = drafts.length;

  // ---- haiku classification pass, resume-safe --------------------------
  const byId = new Map<
    string,
    { kind: 'clause' | 'commentary'; trustRelevant: boolean; title: string | null }
  >();
  const draftIds = new Set(drafts.map((d) => d.piece.pieceId));
  const applyPieceResult = (result: {
    customId: string;
    ok: boolean;
    toolInput: DocData | undefined;
  }): void => {
    const id = result.customId.replace(/^seedpiece:/, '');
    if (!draftIds.has(id) || byId.has(id)) return;
    if (result.ok !== true || result.toolInput === undefined) return;
    byId.set(id, {
      kind: result.toolInput.kind === 'commentary' ? 'commentary' : 'clause',
      trustRelevant: result.toolInput.trust_relevant === true,
      title: typeof result.toolInput.title === 'string' ? result.toolInput.title : null,
    });
  };

  for (const priorId of ledgerBatchIds(ledger, /^seed-piece-classify(-\d+)?$/)) {
    for (const result of await deps.batches.pollBatch(priorId)) {
      applyPieceResult(result);
    }
  }
  const pendingDrafts = drafts.filter((d) => !byId.has(d.piece.pieceId));
  if (pendingDrafts.length > 0) {
    const requests = pendingDrafts.map((d) =>
      buildSeedPieceRequest(d.piece.pieceId, d.piece.rawText),
    );
    const batchIds = await deps.batches.submitBatchChunked('seed-piece-classify', requests);
    for (const batchId of batchIds) {
      for (const result of await deps.batches.pollBatch(batchId)) {
        applyPieceResult(result);
      }
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
    return { ...rest, title: verdict?.title ?? null, kind, trustRelevant };
  });

  for (const p of pieces) {
    if (p.kind === 'commentary') summary.commentaryPieces++;
    else summary.clausePieces++;
    if (p.kind === 'clause' && p.trustRelevant) summary.trustRelevant++;
    if (p.canary && p.kind === 'clause') summary.canaryPieces++;
  }

  await deps.blobs.write(seedPiecesPath(env.firmId, env.runId), JSON.stringify(pieces));
  for (const row of includedFiles) {
    await deps.store.set(seedFileDocPath(env.firmId, env.runId, row.id), {
      status: 'seed-segmented',
      pieceCount: pieces.filter((p) => p.seedFileId === row.id).length,
      updatedAt: new Date().toISOString(),
    });
  }
  await deps.store.set(runLedgerPath(env.firmId, env.runId), {
    stage: 'seed',
    status: 'completed',
    seed: { ...summary, excludedFiles },
    updatedAt: new Date().toISOString(),
  });
  return summary;
}
