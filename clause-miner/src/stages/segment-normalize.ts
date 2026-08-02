/**
 * Stages 4–5 — Reflow + Segment + Normalize (§4.1–4.2, §5), wiring the
 * deterministic core: core/reflow → core/segment (with style/numbering hints
 * from the segments-ready OOXML parse) → core/normalize (per-document
 * gazetteer from Stage-3 docFacts) → core/sigtext (successor-chain collapse
 * hook) → ring0Hash.
 *
 * Per-file segment records go to GCS JSON (volume — not Firestore, §9) with
 * a Firestore per-file status update. Under-segmentation (§4.2 gate) queues
 * a haiku boundary-marking fallback batch; returned offsets are VERIFIED to
 * land on paragraph breaks in the plaintext artifact; failures →
 * needs_human_review. Over-segmentation → quarantine.
 */

import { reflowParagraphs } from '../core/reflow.js';
import {
  extractLeadingHeading,
  segmentParagraphs,
  type BoundaryHint,
  type ProvisionBlock,
} from '../core/segment.js';
import { normalize, type GazetteerEntry } from '../core/normalize.js';
import { ring0Hash, toSigText } from '../core/sigtext.js';
import { detectExecutionBlock } from '../core/execution-blocks.js';
import { chainCollapseHook } from '../successor-chain.js';
import { detectEnumeration } from '../enumeration.js';
import { deriveBoundaryHints } from '../ooxml.js';
import { isPilotDoc } from './triage.js';
import type { SegmentsReadyFile } from './convert.js';
import {
  docFactsPath,
  fileDocPath,
  filesCollection,
  reflowedTextPath,
  runLedgerPath,
  segmentsPath,
  segmentsReadyPath,
  textPath,
} from '../paths.js';
import type { Env } from '../env.js';
import type {
  BatchClient,
  BatchRequest,
  BlobStore,
  DocStore,
} from '../clients/interfaces.js';

/**
 * Bump when segmentation/normalization output changes shape or content —
 * rows whose stored `segmentation.version` differs are re-processed on the
 * next STAGE=segment run (a plain resume still skips up-to-date rows).
 * seg/2: leading structural markers ("FIRST:", "ARTICLE IV") extracted to
 * `heading` metadata instead of fragmenting Ring-0 identity (2026-08-02).
 */
export const SEGMENTER_VERSION = 'seg/2';

export interface SegmentRecord {
  segmentIndex: number;
  articleIndex: number;
  sectionIndex: number;
  /** [start, end) into the doc's text artifact (textArtifactPath). */
  charSpan: [number, number];
  /** Leading structural marker from the source ("FIRST", "ARTICLE IV"), if any. */
  heading: string | null;
  normText: string;
  sigText: string;
  ring0Hash: string;
  structureSignal: string;
  executionBlock: boolean;
  /** Typed-placeholder values observed (§5.1). */
  parameters: Record<string, string[]>;
  /** Item sigText hashes for enumerated-list sections (§4.2). */
  itemSet: string[] | null;
}

export interface SegmentsArtifact {
  driveFileId: string;
  textArtifactPath: string;
  parserVersion: string;
  reflowed: boolean;
  flags: string[];
  structureConfidence: string;
  segments: SegmentRecord[];
}

/** Compute [start,end) spans for blocks over the artifact text. */
export function computeSpans(
  artifactText: string,
  blocks: ProvisionBlock[],
): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let cursor = 0;
  for (const block of blocks) {
    const first = block.paragraphs[0] ?? '';
    const last = block.paragraphs[block.paragraphs.length - 1] ?? '';
    const start = first.length > 0 ? artifactText.indexOf(first, cursor) : cursor;
    const safeStart = start >= 0 ? start : cursor;
    const lastIdx = last.length > 0 ? artifactText.indexOf(last, safeStart) : safeStart;
    const end = lastIdx >= 0 ? lastIdx + last.length : safeStart + first.length;
    spans.push([safeStart, end]);
    cursor = end;
  }
  return spans;
}

/* ------------------------------------------------------------------ */
/* Haiku boundary fallback (§4.2 signal 4)                            */
/* ------------------------------------------------------------------ */

export const BOUNDARY_TOOL = {
  name: 'mark_boundaries',
  description: 'Mark provision-block boundaries in a legal document.',
  input_schema: {
    type: 'object' as const,
    properties: {
      boundaries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            offset: {
              type: 'integer',
              description: 'Character offset (0-based) where the heading/boundary paragraph STARTS. Must be the exact start of a line.',
            },
            level: { type: 'string', enum: ['article', 'section'] },
          },
          required: ['offset', 'level'],
        },
      },
    },
    required: ['boundaries'],
  },
};

export function buildBoundaryRequest(driveFileId: string, text: string): BatchRequest {
  return {
    customId: `boundary:${driveFileId}`,
    model: 'haiku',
    maxTokens: 2048,
    system:
      'You mark the structural boundaries of a legal document whose formatting was lost in conversion. ' +
      'Return the character offset of the START of each article-level heading (e.g. "ARTICLE IV", "FOURTH:") ' +
      'and each section-level heading ("Section 5.2", numbered or ALL-CAPS headings). ' +
      'Offsets are 0-based into the exact text given and MUST point at the first character of a line.',
    userText: text.slice(0, 60_000),
    tool: BOUNDARY_TOOL,
  };
}

/** Paragraph start offsets in an artifact (join('\n') convention). */
export function paragraphStartOffsets(paragraphs: readonly string[]): number[] {
  const offsets: number[] = [];
  let cursor = 0;
  for (const p of paragraphs) {
    offsets.push(cursor);
    cursor += p.length + 1; // '\n'
  }
  return offsets;
}

/**
 * Verify LLM offsets land on paragraph breaks and convert them to
 * BoundaryHints. Returns null when ANY offset fails verification (§4.2:
 * failures → needs_human_review — no partial trust).
 */
export function verifyBoundaries(
  paragraphs: readonly string[],
  boundaries: Array<{ offset: number; level: string }>,
): BoundaryHint[] | null {
  const starts = paragraphStartOffsets(paragraphs);
  const byStart = new Map<number, number>();
  starts.forEach((off, idx) => byStart.set(off, idx));
  const hints: BoundaryHint[] = [];
  for (const b of boundaries) {
    const idx = byStart.get(b.offset);
    if (idx === undefined) return null; // does not land on a paragraph break
    if (b.level !== 'article' && b.level !== 'section') return null;
    hints.push({ paragraphIndex: idx, level: b.level, signal: 'llm-fallback' });
  }
  return hints;
}

/* ------------------------------------------------------------------ */
/* Per-document segmentation                                          */
/* ------------------------------------------------------------------ */

export interface SegmentDocResult {
  artifact: SegmentsArtifact;
  reflowedText: string | null;
  flags: string[];
}

export function segmentDocument(
  driveFileId: string,
  ready: SegmentsReadyFile,
  gazetteer: GazetteerEntry[],
  defaultArtifactPath: string,
  reflowedArtifactPath: string,
  extraHints: BoundaryHint[] | null = null,
): SegmentDocResult {
  const rawParagraphs = ready.paragraphs.map((p) => p.text);
  const styleHints = deriveBoundaryHints(ready.paragraphs);

  // Docs with style/numbering hints are structured (InteractiveLegal case) —
  // reflow only applies to structure-less conversions (§4.1).
  let paragraphs = rawParagraphs;
  let reflowed = false;
  let hints: BoundaryHint[] = styleHints;
  if (extraHints !== null) {
    paragraphs = rawParagraphs;
    hints = extraHints;
  } else if (styleHints.length === 0) {
    const result = reflowParagraphs(rawParagraphs);
    paragraphs = result.paragraphs;
    reflowed = result.reflowed;
    hints = [];
  }

  const artifactText = paragraphs.join('\n');
  const seg = segmentParagraphs(paragraphs, hints);
  const spans = computeSpans(artifactText, seg.blocks);

  const segments: SegmentRecord[] = seg.blocks.map((block, i) => {
    const split = extractLeadingHeading(block.paragraphs);
    // A block that is ONLY a heading (next boundary followed immediately)
    // keeps its old text rather than hashing an empty string.
    const heading = split.body.join('').trim().length > 0 ? split.heading : null;
    const bodyParas = heading !== null ? split.body : [...block.paragraphs];
    const rawText = bodyParas.join('\n');
    const executionBlock = detectExecutionBlock(block.paragraphs) !== null;
    const { normText, parameters } = normalize(rawText, gazetteer);
    const sigText = toSigText(normText, { chainCollapse: chainCollapseHook });
    // Anchored to the raw block (first paragraph is the heading/lead-in),
    // exactly as before heading extraction existed — item text is unaffected.
    const enumeration = detectEnumeration(block.paragraphs.slice(1));
    const itemSet = enumeration.isEnumerated
      ? enumeration.items.map((item) =>
          ring0Hash(toSigText(normalize(item, gazetteer).normText)),
        )
      : null;
    return {
      segmentIndex: i,
      articleIndex: block.articleIndex,
      sectionIndex: block.sectionIndex,
      charSpan: spans[i],
      heading,
      normText,
      sigText,
      ring0Hash: ring0Hash(sigText),
      structureSignal: block.structureSignal,
      executionBlock,
      parameters,
      itemSet,
    };
  });

  return {
    artifact: {
      driveFileId,
      textArtifactPath: reflowed ? reflowedArtifactPath : defaultArtifactPath,
      parserVersion: ready.parserVersion,
      reflowed,
      flags: seg.flags,
      structureConfidence: ready.structureConfidence,
      segments,
    },
    reflowedText: reflowed ? artifactText : null,
    flags: seg.flags,
  };
}

/* ------------------------------------------------------------------ */
/* Stage orchestration                                                */
/* ------------------------------------------------------------------ */

export interface SegmentDeps {
  store: DocStore;
  blobs: BlobStore;
  batches: BatchClient;
}

export interface SegmentSummary {
  segmented: number;
  reflowed: number;
  llmFallback: number;
  needsHumanReview: number;
  quarantined: number;
  skipped: number;
}

async function loadGazetteer(
  store: DocStore,
  env: Env,
  driveFileId: string,
): Promise<GazetteerEntry[]> {
  const facts = await store.get(docFactsPath(env.firmId, env.runId, driveFileId));
  const parties = Array.isArray(facts?.parties) ? facts.parties : [];
  const out: GazetteerEntry[] = [];
  for (const p of parties as Array<Record<string, unknown>>) {
    if (typeof p.role === 'string' && Array.isArray(p.names)) {
      out.push({ role: p.role, names: p.names.filter((n): n is string => typeof n === 'string') });
    }
  }
  return out;
}

async function persistDoc(
  deps: SegmentDeps,
  env: Env,
  driveFileId: string,
  result: SegmentDocResult,
  status: string,
): Promise<void> {
  if (result.reflowedText !== null) {
    await deps.blobs.write(reflowedTextPath(env.firmId, driveFileId), result.reflowedText);
  }
  await deps.blobs.write(
    segmentsPath(env.firmId, env.runId, driveFileId),
    JSON.stringify(result.artifact),
  );
  await deps.store.set(fileDocPath(env.firmId, env.runId, driveFileId), {
    status,
    segmentation: {
      version: SEGMENTER_VERSION,
      flags: result.flags,
      reflowed: result.artifact.reflowed,
      segmentCount: result.artifact.segments.length,
      textArtifactPath: result.artifact.textArtifactPath,
    },
    updatedAt: new Date().toISOString(),
  });
}

// Statuses a previous segment pass leaves behind. Rows carrying one are
// re-processed ONLY when their stored segmentation.version is stale — a
// plain resume after a flake still skips everything already done, while a
// segmenter revision (SEGMENTER_VERSION bump) re-runs the whole corpus
// without any manual reset. 'needs_human_review' rows are deliberately NOT
// eligible: retrying them re-submits paid boundary batches.
const RESEGMENTABLE_STATUSES = new Set(['segmented', 'segmented-under', 'quarantined']);

export async function runSegmentNormalize(deps: SegmentDeps, env: Env): Promise<SegmentSummary> {
  const rows = await deps.store.listDocs(filesCollection(env.firmId, env.runId));
  const pending = rows.filter((r) => {
    if (!isPilotDoc(r.data)) return false;
    if (r.data.status === 'converted') return true;
    if (RESEGMENTABLE_STATUSES.has(r.data.status as string)) {
      const seg = r.data.segmentation as { version?: string } | undefined;
      return seg?.version !== SEGMENTER_VERSION;
    }
    return false;
  });
  const summary: SegmentSummary = {
    segmented: 0,
    reflowed: 0,
    llmFallback: 0,
    needsHumanReview: 0,
    quarantined: 0,
    skipped: rows.length - pending.length,
  };

  interface FallbackItem {
    driveFileId: string;
    ready: SegmentsReadyFile;
    gazetteer: GazetteerEntry[];
    paragraphs: string[];
    /** True when `paragraphs` came from the reflowed artifact (spans must
     *  index into text-reflowed/, already persisted by the first pass). */
    usedReflowed: boolean;
  }
  const fallbackQueue: FallbackItem[] = [];

  for (const row of pending) {
    const readyRaw = await deps.blobs.read(segmentsReadyPath(env.firmId, row.id));
    const ready = JSON.parse(readyRaw.toString('utf8')) as SegmentsReadyFile;
    const gazetteer = await loadGazetteer(deps.store, env, row.id);
    const result = segmentDocument(
      row.id,
      ready,
      gazetteer,
      textPath(env.firmId, row.id),
      reflowedTextPath(env.firmId, row.id),
    );

    if (result.flags.includes('over-segmented')) {
      // §4.2 two-sided gate: reflow already ran; quarantine.
      summary.quarantined++;
      await persistDoc(deps, env, row.id, result, 'quarantined');
      continue;
    }
    if (result.flags.includes('needs-llm-fallback')) {
      // Queue for the haiku boundary batch; keep the deterministic result on
      // disk meanwhile (frequency counts still valid via exact hash).
      const usedReflowed = result.reflowedText !== null;
      const paragraphs = usedReflowed
        ? (result.reflowedText as string).split('\n')
        : ready.paragraphs.map((p) => p.text);
      fallbackQueue.push({ driveFileId: row.id, ready, gazetteer, paragraphs, usedReflowed });
      await persistDoc(deps, env, row.id, result, 'segmented-under');
      continue;
    }
    if (result.artifact.reflowed) summary.reflowed++;
    summary.segmented++;
    await persistDoc(deps, env, row.id, result, 'segmented');
  }

  // ---- Haiku boundary fallback batch (§4.2 signal 4) -------------------
  if (fallbackQueue.length > 0) {
    const requests = fallbackQueue.map((item) =>
      buildBoundaryRequest(item.driveFileId, item.paragraphs.join('\n')),
    );
    const batchId = await deps.batches.submitBatch('boundary-fallback', requests);
    const results = await deps.batches.pollBatch(batchId);
    const byId = new Map(results.map((r) => [r.customId.replace(/^boundary:/, ''), r]));

    for (const item of fallbackQueue) {
      const result = byId.get(item.driveFileId);
      const boundaries = Array.isArray(result?.toolInput?.boundaries)
        ? (result.toolInput.boundaries as Array<{ offset: number; level: string }>)
        : null;
      const hints =
        result?.ok === true && boundaries !== null
          ? verifyBoundaries(item.paragraphs, boundaries)
          : null;
      if (hints === null || hints.length === 0) {
        summary.needsHumanReview++;
        await deps.store.set(fileDocPath(env.firmId, env.runId, item.driveFileId), {
          status: 'needs_human_review',
          needs_human_review: true,
          needs_human_review_reasons: ['boundary_fallback_failed_verification'],
          updatedAt: new Date().toISOString(),
        });
        continue;
      }
      // Re-segment with verified LLM hints over the SAME paragraph array.
      const readyWithParagraphs: SegmentsReadyFile = {
        ...item.ready,
        paragraphs: item.paragraphs.map((text) => ({
          text,
          styleId: null,
          numIlvl: null,
          inTable: false,
          bold: false,
          centered: false,
        })),
      };
      const reResult = segmentDocument(
        item.driveFileId,
        readyWithParagraphs,
        item.gazetteer,
        item.usedReflowed
          ? reflowedTextPath(env.firmId, item.driveFileId)
          : textPath(env.firmId, item.driveFileId),
        reflowedTextPath(env.firmId, item.driveFileId),
        hints,
      );
      summary.llmFallback++;
      summary.segmented++;
      await persistDoc(deps, env, item.driveFileId, reResult, 'segmented');
    }
  }

  await deps.store.set(runLedgerPath(env.firmId, env.runId), {
    stage: 'segment',
    status: 'completed',
    segment: { ...summary },
    updatedAt: new Date().toISOString(),
  });
  return summary;
}
