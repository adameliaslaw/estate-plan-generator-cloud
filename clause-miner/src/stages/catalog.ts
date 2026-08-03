/**
 * Stage 9 — Catalog write (§9): firms/{firmId}/clauseCatalog/{clauseId} with
 * the §9 schema fields verbatim, plus variants/ and occurrences/
 * subcollections, and the 768-dim Vertex embedding (gemini-embedding-001 —
 * same space as kb-vector-search findNearest).
 *
 * Union master template assembly is CHECKPOINT-2 SCOPE (§6.4 gates it behind
 * approved clauses existing) — assembleUnionTemplate throws.
 *
 * Catalog docs are PII-free by construction: placeholder text only;
 * provenance rows carry char-spans into the Storage text artifacts, zero raw
 * text (§9 partition rule). Everything lands status 'mined' — nothing
 * publishes without Adam's click (§1 non-goals).
 */

import { config } from '../config.js';
import { vectorValue } from '../clients/interfaces.js';
import {
  canonicalPath,
  catalogDocPath,
  convertedPath,
  edgesPath,
  runLedgerPath,
  statsPath,
} from '../paths.js';
import {
  buildOccurrenceIndex,
  eraYear,
  loadArtifacts,
  loadCountingUnits,
  loadDocFacts,
  loadSegmentedRows,
} from './shared.js';
import { eraBandOf, type TriggerCard } from './stats.js';
import type { CanonicalFamily } from './canonicalize.js';
import type { IdentityEdge } from './identity.js';
import type { Env } from '../env.js';
import type {
  BlobStore,
  DocData,
  DocStore,
  EmbeddingClient,
} from '../clients/interfaces.js';

export const PIPELINE_VERSION = 'clause-miner/1';

/** §6.4 union master template assembly — checkpoint-2 scope. */
export function assembleUnionTemplate(): never {
  throw new Error('checkpoint-2 scope: implemented after catalog review begins');
}

/**
 * Attorney decisions outlive re-runs: 'approved' (published to drafting) and
 * 'removed' (deleted via the removeClause callable) are user-set states a
 * fresh mine must not reset to 'mined' — a re-run silently resurrecting a
 * deleted clause (or unpublishing an approved one) would break the promise
 * that the catalog only changes on Adam's click.
 */
export function carriedStatus(existing: DocData | null): 'approved' | 'removed' | null {
  const status = existing?.status;
  return status === 'approved' || status === 'removed' ? status : null;
}

export interface CatalogDeps {
  store: DocStore;
  blobs: BlobStore;
  embeddings: EmbeddingClient;
}

export interface CatalogSummary {
  written: number;
  variants: number;
  occurrences: number;
}

interface PresenceInfo {
  unitIds: Set<string>;
  matterKeys: Set<string>;
  attorneyByMatter: Map<string, string>;
}

export async function runCatalog(deps: CatalogDeps, env: Env): Promise<CatalogSummary> {
  const rows = await loadSegmentedRows(deps.store, env);
  const rowById = new Map(rows.map((r) => [r.id, r.data]));
  const artifacts = await loadArtifacts(deps.blobs, env, rows);
  const occurrenceIndex = buildOccurrenceIndex(artifacts);
  const docFacts = await loadDocFacts(deps.store, env);
  const { unitByDocId } = await loadCountingUnits(deps, env, rows, docFacts);

  const canonicalFamilies = JSON.parse(
    (await deps.blobs.read(canonicalPath(env.firmId, env.runId))).toString('utf8'),
  ) as CanonicalFamily[];
  const edges = JSON.parse(
    (await deps.blobs.read(edgesPath(env.firmId, env.runId))).toString('utf8'),
  ) as IdentityEdge[];
  const statsBlob = JSON.parse(
    (await deps.blobs.read(statsPath(env.firmId, env.runId))).toString('utf8'),
  ) as { cards: TriggerCard[] };
  const cardByFamily = new Map(statsBlob.cards.map((c) => [c.familyId, c]));

  // Merge-edge lookup per variant hash (first merged edge touching it).
  const edgeByHash = new Map<string, IdentityEdge>();
  for (const edge of edges) {
    if (!edge.merged) continue;
    if (!edgeByHash.has(edge.a)) edgeByHash.set(edge.a, edge);
    if (!edgeByHash.has(edge.b)) edgeByHash.set(edge.b, edge);
  }

  // Presence + attribution per family.
  const presence = new Map<string, PresenceInfo>();
  for (const fam of canonicalFamilies) {
    const info: PresenceInfo = {
      unitIds: new Set(),
      matterKeys: new Set(),
      attorneyByMatter: new Map(),
    };
    for (const variant of fam.variants) {
      for (const occ of occurrenceIndex.get(variant.sigHash) ?? []) {
        const unit = unitByDocId.get(occ.driveFileId);
        if (unit !== undefined) {
          info.unitIds.add(unit.countingUnitId);
          info.matterKeys.add(unit.matterKey);
          info.attorneyByMatter.set(unit.matterKey, unit.attorneyFolder);
        }
      }
    }
    presence.set(fam.familyId, info);
  }

  // §9 cooccurrence: top 10 by Jaccard over counting-unit sets.
  function cooccurrenceOf(familyId: string): Array<{ clauseId: string; jaccard: number; n: number }> {
    const mine = (presence.get(familyId) as PresenceInfo).unitIds;
    const out: Array<{ clauseId: string; jaccard: number; n: number }> = [];
    for (const other of canonicalFamilies) {
      if (other.familyId === familyId) continue;
      const theirs = (presence.get(other.familyId) as PresenceInfo).unitIds;
      let inter = 0;
      for (const id of mine) if (theirs.has(id)) inter++;
      const union = mine.size + theirs.size - inter;
      if (inter > 0 && union > 0) {
        out.push({ clauseId: other.familyId, jaccard: inter / union, n: inter });
      }
    }
    return out.sort((a, b) => b.jaccard - a.jaccard || b.n - a.n).slice(0, 10);
  }

  // Embeddings for all canonical texts, batched (§3 Stage 6 pattern).
  const embeddings = await deps.embeddings.embedBatch(
    canonicalFamilies.map((f) => f.canonicalText),
  );

  const summary: CatalogSummary = { written: 0, variants: 0, occurrences: 0 };
  const now = new Date().toISOString();

  for (let fi = 0; fi < canonicalFamilies.length; fi++) {
    const fam = canonicalFamilies[fi];
    const info = presence.get(fam.familyId) as PresenceInfo;
    const card = cardByFamily.get(fam.familyId);

    // Occurrence + structure/era/attorney aggregation.
    let occurrenceCount = 0;
    const documents = new Set<string>();
    const byEra: Record<string, number> = {};
    const structureMix: Record<string, number> = {};
    const itemHashes = new Set<string>();
    const perItemCounts: Record<string, number> = {};
    for (const variant of fam.variants) {
      for (const occ of occurrenceIndex.get(variant.sigHash) ?? []) {
        occurrenceCount++;
        documents.add(occ.driveFileId);
        const facts = docFacts.get(occ.driveFileId);
        const band = eraBandOf(eraYear(facts?.executionDate ?? null));
        byEra[band] = (byEra[band] ?? 0) + 1;
        const artifact = artifacts.get(occ.driveFileId);
        const conf = artifact !== undefined ? artifact.structureConfidence : 'unknown';
        structureMix[conf] = (structureMix[conf] ?? 0) + 1;
        const seg = artifact?.segments[occ.segmentIndex];
        if (seg?.itemSet != null) {
          for (const item of seg.itemSet) {
            itemHashes.add(item);
            perItemCounts[item] = (perItemCounts[item] ?? 0) + 1;
          }
        }
      }
    }

    const byAttorney: Record<string, number> = {
      adams: 0, george: 0, jerome: 0, elizabeth: 0, legacy: 0,
    };
    for (const attorney of info.attorneyByMatter.values()) {
      const key = attorney === 'legacy-root' ? 'legacy' : attorney;
      byAttorney[key] = (byAttorney[key] ?? 0) + 1;
    }
    const attributed = info.matterKeys.size - byAttorney.legacy;
    const attributionCoverage =
      info.matterKeys.size > 0 ? attributed / info.matterKeys.size : 0;

    // §6.2 stale-canon detection: all matches predate ~2015 while a
    // divergent modern variant dominates — approximated as: canonical's
    // newest era < 2015 while the family has a post-2015 variant.
    const canonicalVariant = fam.variants.find((v) => v.sigHash === fam.canonicalHash);
    const canonicalNewest = canonicalVariant?.eraRange[1] ?? null;
    const familyNewest = fam.variants.reduce<number | null>(
      (max, v) => (v.eraRange[1] !== null && (max === null || v.eraRange[1] > max) ? v.eraRange[1] : max),
      null,
    );
    const staleFlag =
      canonicalNewest !== null && familyNewest !== null && canonicalNewest < 2015 && familyNewest >= 2015;

    // ---- §9 clauseCatalog doc (fields verbatim) ------------------------
    const doc: DocData = {
      docType: 'trust',
      category: fam.category,
      title: fam.title,
      functionSummary: fam.functionSummary,
      canonicalText: fam.canonicalText,
      switchName: fam.switchName,
      placeholders: fam.fillContract.map((m) => ({
        tag: m.tag,
        kind: m.kind,
        fillSource: m.fillSource,
        ...(m.contractField !== undefined ? { contractField: m.contractField } : {}),
      })),
      status: 'mined',
      structureConfidenceMix: structureMix,
      counts: {
        occurrences: occurrenceCount,
        documents: documents.size,
        matters: info.matterKeys.size,
        byAttorney,
        byEra,
        attributionCoverage,
      },
      positionMedian: fam.positionMedian,
      cooccurrence: cooccurrenceOf(fam.familyId),
      relatedTo: fam.relatedTo,
      ...(itemHashes.size > 0
        ? { itemization: { itemHashes: [...itemHashes].sort(), perItemCounts } }
        : {}),
      ...(card !== undefined
        ? {
            triggerCard: {
              prose: card.prose,
              statsHash: card.statsHash,
              tier: card.tier,
              stats: card.stats.map((s) => ({
                fact: s.fact,
                factClass: s.factClass,
                stratum: s.stratum,
                pGivenFact: s.pGivenFact,
                pGivenNotFact: s.pGivenNotFact,
                lift: s.lift,
                fisherP: s.fisherP,
                pAdj: s.pAdj,
                nFact: s.nFact,
                nNotFact: s.nNotFact,
              })),
            },
          }
        : {}),
      validation: { staleFlag },
      embedding: vectorValue(embeddings[fi]),
      piiScanStatus: fam.piiScanStatus,
      pipelineVersion: PIPELINE_VERSION,
      createdAt: now,
      updatedAt: now,
    };
    const clausePath = catalogDocPath(env.firmId, fam.familyId);
    const carried = carriedStatus(await deps.store.get(clausePath));
    if (carried !== null) doc.status = carried;
    await deps.store.set(clausePath, doc);
    summary.written++;

    // ---- variants/{sigHash} --------------------------------------------
    for (const variant of fam.variants) {
      const edge = edgeByHash.get(variant.sigHash);
      await deps.store.set(`${clausePath}/variants/${variant.sigHash}`, {
        normText: variant.normText, // PII-gated upstream (§5.3 runs HERE too)
        occurrenceCount: variant.occurrenceCount,
        matterCount: variant.matterCount,
        eraRange: variant.eraRange,
        parameters: variant.parameters,
        mergeEdge:
          edge !== undefined
            ? {
                ring: edge.ring,
                scores: edge.scores,
                diff: edge.diff,
                ...(edge.adjudicationRef !== null ? { adjudicationRef: edge.adjudicationRef } : {}),
              }
            : { ring: 0, scores: {}, diff: { changedA: [], changedB: [] } },
      });
      summary.variants++;
    }

    // ---- occurrences/{occId} — provenance only, zero raw text ----------
    for (const variant of fam.variants) {
      for (const occ of occurrenceIndex.get(variant.sigHash) ?? []) {
        const row = rowById.get(occ.driveFileId) ?? {};
        const unit = unitByDocId.get(occ.driveFileId);
        const occId = `${occ.driveFileId}_${occ.segmentIndex}`;
        await deps.store.set(`${clausePath}/occurrences/${occId}`, {
          driveFileId: occ.driveFileId,
          drivePath: typeof row.drivePath === 'string' ? row.drivePath : '',
          fileName: typeof row.fileName === 'string' ? row.fileName : '',
          convertedStoragePath:
            typeof row.convertedStoragePath === 'string'
              ? row.convertedStoragePath
              : convertedPath(env.firmId, occ.driveFileId),
          textArtifactPath: occ.textArtifactPath,
          parserVersion: occ.parserVersion,
          charSpan: occ.charSpan,
          articleIndex: occ.articleIndex,
          sectionIndex: occ.sectionIndex,
          variantSigHash: variant.sigHash,
          matterKey: unit?.matterKey ?? null,
          countingUnitId: unit?.countingUnitId ?? null,
          runId: env.runId,
        });
        summary.occurrences++;
      }
    }
  }

  await deps.store.set(runLedgerPath(env.firmId, env.runId), {
    stage: 'catalog',
    status: 'completed',
    catalog: { ...summary },
    thresholds: {
      lshBands: config.minhash.lshBands,
      cosinePropose: config.ring2.cosinePropose,
      minSupport: config.canonical.minSupport,
    },
    updatedAt: new Date().toISOString(),
  });
  return summary;
}
