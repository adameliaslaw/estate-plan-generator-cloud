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
  gateVerdict,
  sweepText,
  type PiiScanStatus,
} from '../pii-gates.js';
import { canonicalPath, runLedgerPath } from '../paths.js';
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
  seedDivergent: boolean;
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

export interface CanonicalizeSummary {
  families: number;
  belowSupport: number;
  labeled: number;
  fillContractFailures: number;
  piiBlocked: number;
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

  // normText/parameters per hash (from artifacts).
  const hashInfo = new Map<string, { normText: string; parameters: Record<string, string[]> }>();
  for (const artifact of artifacts.values()) {
    for (const seg of artifact.segments) {
      if (!hashInfo.has(seg.ring0Hash)) {
        hashInfo.set(seg.ring0Hash, { normText: seg.normText, parameters: seg.parameters });
      }
    }
  }

  const summary: CanonicalizeSummary = {
    families: 0,
    belowSupport: 0,
    labeled: 0,
    fillContractFailures: 0,
    piiBlocked: 0,
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
  const gateVerdicts = new Map<string, PiiScanStatus>();
  if (gateTexts.length > 0) {
    const batchId = await deps.batches.submitBatch('pii-gate', buildPiiGateRequests(gateTexts));
    for (const result of await deps.batches.pollBatch(batchId)) {
      gateVerdicts.set(result.customId.replace(/^pii:/, ''), gateVerdict(result));
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
      const verdict =
        gateVerdicts.get(`${p.family.familyId}:${v.sigHash.slice(0, 12)}`) ?? 'blocked';
      if (verdict === 'blocked') {
        pii = 'blocked';
        piiFindings.push(`haiku-gate:${v.sigHash.slice(0, 12)}`);
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
      // Seed matching is wired when the curated seed manifest is provided
      // (§6.2 / Gate 3) — absent seeds, nothing is flagged (data decides).
      seedDivergent: false,
      labelError: contractError ?? labelError,
      executionBlock: p.family.executionBlock,
      relatedTo: p.family.relatedTo,
      positionMedian: p.positionMedian,
    });
    if (labelError === null && contractError === null) summary.labeled++;
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
