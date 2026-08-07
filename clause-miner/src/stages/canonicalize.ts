/**
 * Stage 7 — Canonicalize + label (§6, §5.3): per family with min-support
 * ≥ 3 distinct counting units:
 *
 * - Canonical selection per §6.2 AS AMENDED (Adam 2026-07-30): THE DATA
 *   DECIDES — most frequent variant weighted toward the newest era. The
 *   curated seed does NOT auto-promote; where a matched seed text diverges
 *   (token-Levenshtein < 0.80) the family is flagged `seed-divergent` for
 *   side-by-side review.
 * - Sonnet batch per family → title, functionSummary, category, switchName,
 *   and the placeholder fill-contract mapping (§6.3) validated against
 *   src/fill-contract.ts — canonicalization FAILS on unregistered tags.
 * - PII gates (§5.3): Aho-Corasick roster sweep over EVERY canonical AND
 *   variant normText + haiku PII batch gate; any hit ⇒ piiScanStatus
 *   'blocked' (fail closed).
 */

import { config } from '../config.js';
import {
  buildFillContract,
  FillContractError,
  type FillContractMapping,
  type FillSource,
  type PlaceholderKind,
} from '../fill-contract.js';
import {
  buildPiiGateRequests,
  buildRosterSweep,
  gateOutcome,
  sweepText,
  type GateReason,
  type PiiScanStatus,
} from '../pii-gates.js';
import {
  adjudicationPath,
  canonicalPath,
  runLedgerPath,
  seedMatchPath,
  seedPiecesPath,
} from '../paths.js';
import {
  planSeedMatches,
  seedPairId,
  type MatchableUnique,
  type SeedMatch,
} from '../seed-match.js';
import {
  buildAdjudicationRequest,
  parseAdjudication,
} from '../adjudication.js';
import { classifyDiff } from '../core/diff.js';
import { parseSeedPiecesArtifact } from './seed.js';
import type { SeedPiece } from './seed.js';
import {
  buildOccurrenceIndex,
  clientFolderName,
  eraYear,
  loadArtifacts,
  loadCountingUnits,
  loadDocFacts,
  loadSegmentedRows,
} from './shared.js';
import { familiesPath } from '../paths.js';
import type { Family } from './identity.js';
import type { Env } from '../env.js';
import type {
  BatchClient,
  BatchRequest,
  BlobStore,
  DocData,
  DocStore,
} from '../clients/interfaces.js';

/** §9: category = TRUST_STRUCTURES value | 'general' | 'execution-block'
 *  (values mirror functions/src/wills-schema.ts TRUST_STRUCTURES). */
export const CLAUSE_CATEGORIES = [
  'QTIP', 'Spendthrift', 'GST', 'Bypass', 'Credit-Shelter', 'Special-Needs',
  'Marital-Deduction', 'Generation-Skipping', 'Charitable-Remainder',
  'Pour-Over', 'Testamentary', 'Inter-Vivos-Reference', 'ILIT', 'IDGT',
  'Other', 'general', 'execution-block',
] as const;

/* ------------------------------------------------------------------ */
/* Pure helpers                                                       */
/* ------------------------------------------------------------------ */

/** Token-level Levenshtein similarity ratio in [0,1] (§6.2 / Gate 3). */
export function tokenLevenshteinRatio(aText: string, bText: string): number {
  const a = aText.split(/\s+/).filter((t) => t.length > 0);
  const b = bText.split(/\s+/).filter((t) => t.length > 0);
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return 1;
  let prev = Array.from({ length: m + 1 }, (_v, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = new Array<number>(m + 1);
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return 1 - prev[m] / Math.max(n, m);
}

export interface VariantForSelection {
  sigHash: string;
  normText: string;
  occurrenceCount: number;
  /** Newest execution year across occurrences, null if unknown. */
  newestEraYear: number | null;
}

/**
 * §6.2 canonical selection: most frequent variant weighted toward the
 * newest era (variants whose newest era matches the family's newest get a
 * weight multiplier). Deterministic tiebreak by sigHash.
 */
export function selectCanonical(variants: VariantForSelection[]): VariantForSelection {
  if (variants.length === 0) throw new Error('selectCanonical: empty family');
  const familyNewest = variants.reduce<number | null>(
    (max, v) =>
      v.newestEraYear !== null && (max === null || v.newestEraYear > max) ? v.newestEraYear : max,
    null,
  );
  const weightOf = (v: VariantForSelection): number =>
    v.occurrenceCount *
    (familyNewest !== null && v.newestEraYear === familyNewest
      ? config.canonical.newestEraWeight
      : 1);
  return [...variants].sort(
    (x, y) => weightOf(y) - weightOf(x) || x.sigHash.localeCompare(y.sigHash),
  )[0];
}

/* ------------------------------------------------------------------ */
/* Labeling batch                                                     */
/* ------------------------------------------------------------------ */

export const LABEL_TOOL = {
  name: 'label_clause',
  description: 'Label a mined clause family for the firm clause catalog.',
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'Short attorney-facing title, e.g. "Spendthrift Protection".' },
      functionSummary: { type: 'string', description: 'One-line legal function.' },
      category: { type: 'string', enum: CLAUSE_CATEGORIES as unknown as string[] },
      switchName: {
        type: 'string',
        description: "docxtemplater switch name, snake_case with include_ prefix, e.g. 'include_spendthrift'.",
      },
      mappings: {
        type: 'array',
        description:
          'One entry per DISTINCT placeholder tag in the canonical text. Multi-value cases get indexed semantic tags; map each to a clientContext field, an intake fact, or attorney-supplied.',
        items: {
          type: 'object',
          properties: {
            tag: { type: 'string' },
            fillSource: { type: 'string', enum: ['clientContext', 'intake', 'attorney'] },
            contractField: { type: 'string' },
            kind: {
              type: 'string',
              enum: [
                'party', 'date', 'amount', 'percent', 'duration', 'fraction',
                'count', 'age', 'list', 'chain', 'xref', 'jurisdiction', 'redaction',
              ],
            },
          },
          required: ['tag', 'fillSource', 'kind'],
        },
      },
    },
    required: ['title', 'functionSummary', 'category', 'switchName', 'mappings'],
  },
};

/**
 * The `piiFindings` entry a variant's gate outcome earns, or null when the
 * gate cleared it.
 *
 * Fail-closed is unchanged: a variant with NO result still blocks. What
 * changed (2026-08-07) is that it no longer records the same label as a model
 * objection. The old code pushed a bare `haiku-gate:` for all three of
 * "the model found PII", "the call errored" and "no verdict came back", which
 * left the audit unable to tell a finding from a failure — the corpus-wide
 * 94.5% block rate could not be interpreted because of it.
 */
export function gateFinding(
  outcome: { verdict: PiiScanStatus; reason: GateReason } | undefined,
  hash12: string,
): string | null {
  if (outcome === undefined) return `haiku-gate-missing:${hash12}`;
  if (outcome.verdict !== 'blocked') return null;
  return `haiku-gate-${outcome.reason}:${hash12}`;
}

export function buildLabelRequest(familyId: string, canonicalText: string): BatchRequest {
  return {
    customId: `label:${familyId}`,
    model: 'sonnet',
    maxTokens: 1024,
    system:
      'You label mined estate-planning clause families for a trust clause catalog. ' +
      'The clause text is fully anonymized with {{PLACEHOLDER}} tokens. Provide a title, a one-line ' +
      'legal function summary, a category, a docxtemplater switch name, and the fill-contract mapping ' +
      'for every distinct placeholder tag. fillSource "clientContext" is for data the drafting system ' +
      'already computes (names, county, child count), "intake" for intake-form facts, "attorney" for ' +
      'values the attorney supplies per matter (ages, durations, amounts).',
    userText: canonicalText.slice(0, 12_000),
    tool: LABEL_TOOL,
  };
}

export function parseLabelMappings(toolInput: DocData | undefined): Map<string, FillContractMapping> {
  const out = new Map<string, FillContractMapping>();
  const raw = Array.isArray(toolInput?.mappings) ? toolInput.mappings : [];
  for (const m of raw as Array<Record<string, unknown>>) {
    if (typeof m.tag !== 'string') continue;
    const fillSource = m.fillSource;
    if (fillSource !== 'clientContext' && fillSource !== 'intake' && fillSource !== 'attorney') continue;
    const kind = typeof m.kind === 'string' ? m.kind : 'party';
    out.set(m.tag, {
      tag: m.tag,
      fillSource: fillSource as FillSource,
      kind: kind as PlaceholderKind,
      ...(typeof m.contractField === 'string' ? { contractField: m.contractField } : {}),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Canonical family record (input to Stage 9 catalog write)           */
/* ------------------------------------------------------------------ */

export interface CanonicalVariant {
  sigHash: string;
  normText: string;
  occurrenceCount: number;
  matterCount: number;
  eraRange: [number | null, number | null];
  parameters: Record<string, string[]>;
}

export interface CanonicalFamily {
  familyId: string;
  canonicalHash: string;
  canonicalText: string;
  title: string;
  functionSummary: string;
  category: string;
  switchName: string;
  fillContract: FillContractMapping[];
  variants: CanonicalVariant[];
  countingUnitCount: number;
  piiScanStatus: PiiScanStatus;
  piiFindings: string[];
  /** §6.2 / Gate 3 — a review flag, never an auto-promotion. */
  seedDivergent: boolean;
  /** §9 validation block: which curated file matched, and how closely. */
  seedSourceFileId?: string;
  seedEditRatio?: number;
  labelError: string | null;
  executionBlock: boolean;
  relatedTo: string[];
  /** 0-1 median relative position — orders the master template (§9). */
  positionMedian: number;
}

export interface CanonicalizeDeps {
  store: DocStore;
  blobs: BlobStore;
  batches: BatchClient;
}

/* ------------------------------------------------------------------ */
/* Curated-seed matching (§11 Gates 1–3, §6.2)                        */
/* ------------------------------------------------------------------ */

export interface SeedMatchResult {
  pieces: SeedPiece[];
  matches: SeedMatch[];
  /** familyId → the seed pieces that landed in it. */
  byFamily: Map<string, SeedMatch[]>;
}

/**
 * Run the curated seed through the SAME rings the corpus used, adjudicating
 * every content diff. Absent a seed artifact this is a no-op — a run without
 * the curated library still produces a catalog, it just cannot be gated.
 */
export async function matchSeed(
  deps: CanonicalizeDeps,
  env: Env,
  families: readonly Family[],
  hashInfo: ReadonlyMap<string, { normText: string; sigText: string }>,
): Promise<SeedMatchResult> {
  const empty: SeedMatchResult = { pieces: [], matches: [], byFamily: new Map() };
  let pieces: SeedPiece[];
  let seedSegmenterVersion: string | null;
  let seedGeneratedAt: string | null;
  try {
    const raw = await deps.blobs.read(seedPiecesPath(env.firmId, env.runId));
    const parsed = parseSeedPiecesArtifact(raw.toString('utf8'));
    pieces = parsed.pieces;
    seedSegmenterVersion = parsed.segmenterVersion;
    seedGeneratedAt = parsed.generatedAt;
  } catch {
    return empty; // no seed stage ran for this run
  }
  if (pieces.length === 0) return empty;

  const familyByHash = new Map<string, string>();
  for (const family of families) {
    for (const hash of family.memberHashes) familyByHash.set(hash, family.familyId);
  }
  const uniques: MatchableUnique[] = [...hashInfo.entries()].map(([ring0Hash, info]) => ({
    ring0Hash,
    sigText: info.sigText,
    normText: info.normText,
  }));

  const plan = planSeedMatches(pieces, uniques, familyByHash);

  // Content diffs are adjudicated with the same merge-averse rubric — a seed
  // clause that is legally distinct from its nearest mined family did NOT
  // land there, and Gate 1 must count it as a miss.
  if (plan.adjudicationCandidates.length > 0) {
    const requests = plan.adjudicationCandidates.map((c) => {
      const diff = classifyDiff(c.piece.sigText, c.unique.sigText);
      return buildAdjudicationRequest({
        pairId: seedPairId(c.piece.pieceId, c.unique.ring0Hash),
        textA: c.piece.normText,
        textB: c.unique.normText,
        diffSummary: `A-only: ${diff.changedA.join(' ') || '(none)'}\nB-only: ${diff.changedB.join(' ') || '(none)'}`,
      });
    });
    const batchId = await deps.batches.submitBatch('seed-match-adjudication', requests);
    const results = await deps.batches.pollBatch(batchId);
    const byId = new Map(results.map((r) => [r.customId.replace(/^adj:/, ''), r]));

    for (const c of plan.adjudicationCandidates) {
      const id = seedPairId(c.piece.pieceId, c.unique.ring0Hash);
      const result = byId.get(id);
      const parsed = parseAdjudication(result?.ok === true ? result.toolInput : undefined);
      const transcriptPath = adjudicationPath(env.firmId, env.runId, id);
      await deps.blobs.write(
        transcriptPath,
        JSON.stringify({
          pairId: id,
          kind: 'seed-match',
          seedPieceId: c.piece.pieceId,
          seedFileId: c.piece.seedFileId,
          familyId: c.familyId,
          a: { pieceId: c.piece.pieceId, normText: c.piece.normText },
          b: { ring0Hash: c.unique.ring0Hash, normText: c.unique.normText },
          scores: c.scores,
          verdict: parsed.verdict,
          rationale: parsed.rationale,
          error: result?.error ?? null,
        }),
      );
      if (parsed.verdict !== 'MERGE') continue;
      plan.matches.push({
        pieceId: c.piece.pieceId,
        seedFileId: c.piece.seedFileId,
        familyId: c.familyId,
        matchedHash: c.unique.ring0Hash,
        ring: 1,
        kind: 'adjudicated',
        scores: c.scores,
        adjudicationRef: transcriptPath,
      });
    }
  }

  const byFamily = new Map<string, SeedMatch[]>();
  for (const match of plan.matches) {
    const list = byFamily.get(match.familyId);
    if (list === undefined) byFamily.set(match.familyId, [match]);
    else list.push(match);
  }
  // Stamps carried through so the gates stage can hard-fail on staleness
  // instead of measuring against a seed artifact from a different run (M1).
  await deps.blobs.write(
    seedMatchPath(env.firmId, env.runId),
    JSON.stringify({
      segmenterVersion: seedSegmenterVersion,
      seedGeneratedAt,
      generatedAt: new Date().toISOString(),
      pieces,
      matches: plan.matches,
    }),
  );
  return { pieces, matches: plan.matches, byFamily };
}

export interface CanonicalizeSummary {
  families: number;
  belowSupport: number;
  labeled: number;
  fillContractFailures: number;
  piiBlocked: number;
  seedMatched: number;
  seedDivergent: number;
}

/**
 * §6.2 / Gate 3 divergence diagnostic for one family. Compares the
 * data-chosen canonical against the CLOSEST matched seed text (a family can
 * attract more than one seed piece; the nearest is the fair comparison —
 * flagging against the worst match would report divergence that isn't there).
 */
export function seedDivergenceFor(
  seed: SeedMatchResult,
  familyId: string,
  canonicalText: string,
): { seedDivergent: boolean; seedSourceFileId?: string; seedEditRatio?: number } {
  const matches = seed.byFamily.get(familyId);
  if (matches === undefined || matches.length === 0) return { seedDivergent: false };
  const byPieceId = new Map(seed.pieces.map((p) => [p.pieceId, p]));
  let bestRatio = -1;
  let bestFileId = '';
  for (const match of matches) {
    const piece = byPieceId.get(match.pieceId);
    if (piece === undefined) continue;
    const ratio = tokenLevenshteinRatio(piece.normText, canonicalText);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestFileId = piece.seedFileId;
    }
  }
  if (bestRatio < 0) return { seedDivergent: false };
  return {
    seedDivergent: bestRatio < config.canonical.seedDivergenceLevenshtein,
    seedSourceFileId: bestFileId,
    seedEditRatio: bestRatio,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0.5;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function runCanonicalize(
  deps: CanonicalizeDeps,
  env: Env,
): Promise<CanonicalizeSummary> {
  const rows = await loadSegmentedRows(deps.store, env);
  const artifacts = await loadArtifacts(deps.blobs, env, rows);
  const occurrenceIndex = buildOccurrenceIndex(artifacts);
  const docFacts = await loadDocFacts(deps.store, env);
  const { unitByDocId } = await loadCountingUnits(deps, env, rows, docFacts);
  const familiesRaw = await deps.blobs.read(familiesPath(env.firmId, env.runId));
  const families = JSON.parse(familiesRaw.toString('utf8')) as Family[];

  // normText/sigText/parameters per hash (from artifacts).
  const hashInfo = new Map<
    string,
    { normText: string; sigText: string; parameters: Record<string, string[]> }
  >();
  for (const artifact of artifacts.values()) {
    for (const seg of artifact.segments) {
      if (!hashInfo.has(seg.ring0Hash)) {
        hashInfo.set(seg.ring0Hash, {
          normText: seg.normText,
          sigText: seg.sigText,
          parameters: seg.parameters,
        });
      }
    }
  }

  // §11 Gates 1–3 / §6.2: which curated-seed pieces landed in which family.
  const seed = await matchSeed(deps, env, families, hashInfo);

  const summary: CanonicalizeSummary = {
    families: 0,
    belowSupport: 0,
    labeled: 0,
    fillContractFailures: 0,
    piiBlocked: 0,
    seedMatched: seed.matches.length,
    seedDivergent: 0,
  };

  // ---- Assemble variant data + min-support filter ----------------------
  interface Prepared {
    family: Family;
    variants: CanonicalVariant[];
    canonical: VariantForSelection;
    countingUnitCount: number;
    positionMedian: number;
  }
  const prepared: Prepared[] = [];
  for (const family of families) {
    const variants: CanonicalVariant[] = [];
    const unitIds = new Set<string>();
    const positions: number[] = [];
    for (const hash of family.memberHashes) {
      const occurrences = occurrenceIndex.get(hash) ?? [];
      const info = hashInfo.get(hash);
      if (info === undefined || occurrences.length === 0) continue;
      const years = occurrences
        .map((o) => eraYear(docFacts.get(o.driveFileId)?.executionDate ?? null))
        .filter((y): y is number => y !== null);
      const matterKeys = new Set<string>();
      for (const o of occurrences) {
        const unit = unitByDocId.get(o.driveFileId);
        if (unit !== undefined) {
          matterKeys.add(unit.matterKey);
          unitIds.add(unit.countingUnitId);
        }
        const artifact = artifacts.get(o.driveFileId);
        const total = artifact !== undefined ? artifact.segments.length : 0;
        if (total > 1) positions.push(o.segmentIndex / (total - 1));
      }
      variants.push({
        sigHash: hash,
        normText: info.normText,
        occurrenceCount: occurrences.length,
        matterCount: matterKeys.size,
        eraRange: [
          years.length > 0 ? Math.min(...years) : null,
          years.length > 0 ? Math.max(...years) : null,
        ],
        parameters: info.parameters,
      });
    }
    if (variants.length === 0) continue;
    if (unitIds.size < config.canonical.minSupport) {
      summary.belowSupport++;
      continue;
    }
    const canonical = selectCanonical(
      variants.map((v) => ({
        sigHash: v.sigHash,
        normText: v.normText,
        occurrenceCount: v.occurrenceCount,
        newestEraYear: v.eraRange[1],
      })),
    );
    prepared.push({
      family,
      variants,
      canonical,
      countingUnitCount: unitIds.size,
      positionMedian: median(positions),
    });
  }

  // ---- Sonnet labeling batch -------------------------------------------
  const labelRequests = prepared.map((p) =>
    buildLabelRequest(p.family.familyId, p.canonical.normText),
  );
  const labelResults = new Map<string, DocData | undefined>();
  const labelErrors = new Map<string, string>();
  if (labelRequests.length > 0) {
    const batchId = await deps.batches.submitBatch('canonicalize-label', labelRequests);
    for (const result of await deps.batches.pollBatch(batchId)) {
      const familyId = result.customId.replace(/^label:/, '');
      if (result.ok) labelResults.set(familyId, result.toolInput);
      else labelErrors.set(familyId, result.error ?? 'unknown');
    }
  }

  // ---- PII gates over EVERY canonical and variant normText -------------
  const roster: string[] = [];
  for (const facts of docFacts.values()) {
    for (const party of facts.parties) roster.push(...party.names);
  }
  for (const row of rows) {
    roster.push(clientFolderName(row.data.drivePath));
  }
  const sweep = buildRosterSweep(roster);

  const gateTexts: Array<{ id: string; text: string }> = [];
  for (const p of prepared) {
    for (const v of p.variants) {
      gateTexts.push({ id: `${p.family.familyId}:${v.sigHash.slice(0, 12)}`, text: v.normText });
    }
  }
  const gateVerdicts = new Map<string, { verdict: PiiScanStatus; reason: GateReason }>();
  if (gateTexts.length > 0) {
    const batchId = await deps.batches.submitBatch('pii-gate', buildPiiGateRequests(gateTexts));
    for (const result of await deps.batches.pollBatch(batchId)) {
      gateVerdicts.set(result.customId.replace(/^pii:/, ''), gateOutcome(result));
    }
  }

  // ---- Assemble canonical families -------------------------------------
  const out: CanonicalFamily[] = [];
  for (const p of prepared) {
    const label = labelResults.get(p.family.familyId);
    const labelError = labelErrors.get(p.family.familyId) ?? null;

    let fillContract: FillContractMapping[] = [];
    let contractError: string | null = null;
    try {
      fillContract = buildFillContract(p.canonical.normText, parseLabelMappings(label));
    } catch (err: unknown) {
      if (err instanceof FillContractError) {
        contractError = err.message;
        summary.fillContractFailures++;
      } else {
        throw err;
      }
    }

    // §5.3: roster sweep + haiku gate over canonical AND every variant.
    const piiFindings: string[] = [];
    let pii: PiiScanStatus = 'clean';
    for (const v of p.variants) {
      const result = sweepText(sweep, v.normText);
      if (!result.clean) {
        pii = 'blocked';
        piiFindings.push(
          ...result.hits.map((h) => `roster:${h.term}@${v.sigHash.slice(0, 12)}:${h.index}`),
        );
      }
      const finding = gateFinding(
        gateVerdicts.get(`${p.family.familyId}:${v.sigHash.slice(0, 12)}`),
        v.sigHash.slice(0, 12),
      );
      if (finding !== null) {
        pii = 'blocked';
        piiFindings.push(finding);
      }
    }
    if (pii === 'blocked') summary.piiBlocked++;

    const category =
      p.family.executionBlock === true
        ? 'execution-block'
        : (CLAUSE_CATEGORIES as readonly string[]).includes(label?.category as string)
          ? (label?.category as string)
          : 'general';

    out.push({
      familyId: p.family.familyId,
      canonicalHash: p.canonical.sigHash,
      canonicalText: p.canonical.normText,
      title: typeof label?.title === 'string' ? label.title : `Unlabeled family ${p.family.familyId}`,
      functionSummary: typeof label?.functionSummary === 'string' ? label.functionSummary : '',
      category,
      switchName:
        typeof label?.switchName === 'string' && /^include_[a-z0-9_]+$/.test(label.switchName)
          ? label.switchName
          : `include_${p.family.familyId.replace(/^fam_/, '')}`,
      fillContract,
      variants: p.variants,
      countingUnitCount: p.countingUnitCount,
      piiScanStatus: pii,
      piiFindings,
      // §6.2 as amended: the seed NEVER promotes itself over the data-chosen
      // canonical. A material divergence is a FLAG that puts the two texts
      // side by side with usage counts, so Adam evaluates his predecessors'
      // phrasing against the evidence — the first time anyone has.
      ...seedDivergenceFor(seed, p.family.familyId, p.canonical.normText),
      labelError: contractError ?? labelError,
      executionBlock: p.family.executionBlock,
      relatedTo: p.family.relatedTo,
      positionMedian: p.positionMedian,
    });
    if (labelError === null && contractError === null) summary.labeled++;
    if (out[out.length - 1].seedDivergent) summary.seedDivergent++;
  }
  summary.families = out.length;

  await deps.blobs.write(canonicalPath(env.firmId, env.runId), JSON.stringify(out));
  await deps.store.set(runLedgerPath(env.firmId, env.runId), {
    stage: 'canonicalize',
    status: 'completed',
    canonicalize: { ...summary },
    updatedAt: new Date().toISOString(),
  });
  return summary;
}
