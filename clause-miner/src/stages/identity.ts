/**
 * Stage 6 — Identity (§4.3): Ring 0 exact grouping by ring0Hash; Ring 1
 * MinHash/LSH candidates over unique sigTexts + deterministic diff filter
 * (trivial → auto-merge; ANY content diff → sonnet adjudication with the
 * merge-averse rubric — there is no auto-merge band); enumerated-section
 * item-set path (Jaccard ≥ 0.7); Ring 2 Vertex text-embedding-005 cosine
 * (≥ 0.92 proposes → adjudication; 0.80–0.92 → relatedTo edges, never
 * merged). Union-find over the confirmed edge set; EVERY non-exact edge is
 * stored {ring, scores, diff, adjudicationRef} so one-edge deletion reverses
 * any merge.
 *
 * structureConfidence 'none' docs contribute occurrences via exact hash only
 * — never cluster seeds (§4.2).
 */

import { config } from '../config.js';
import { classifyDiff, hardRoute } from '../core/diff.js';
import {
  candidatePairs,
  itemSetJaccard,
  jaccardFromSignatures,
  minhashSignature,
  type SignatureEntry,
} from '../core/minhash.js';
import { UnionFind } from '../union-find.js';
import {
  buildAdjudicationRequest,
  parseAdjudication,
  type AdjudicationVerdict,
} from '../adjudication.js';
import {
  adjudicationPath,
  edgesPath,
  familiesPath,
  filesCollection,
  runLedgerPath,
  segmentsPath,
} from '../paths.js';
import type { SegmentsArtifact } from './segment-normalize.js';
import type { Env } from '../env.js';
import type {
  BatchClient,
  BlobStore,
  DocStore,
  EmbeddingClient,
} from '../clients/interfaces.js';

export interface UniqueSignature {
  ring0Hash: string;
  sigText: string;
  normText: string;
  itemSet: string[] | null;
  executionBlock: boolean;
  /** True when at least one occurrence came from a structured doc — only
   *  these seed clusters (§4.2). */
  clusterSeed: boolean;
  occurrenceCount: number;
}

export interface IdentityEdge {
  a: string;
  b: string;
  ring: 0 | 1 | 2;
  kind: 'trivial' | 'item-set' | 'adjudicated' | 'related';
  scores: Record<string, number>;
  diff: { changedA: string[]; changedB: string[] };
  adjudicationRef: string | null;
  verdict: AdjudicationVerdict | null;
  /** relatedTo edges are stored but never merged. */
  merged: boolean;
}

export interface Family {
  familyId: string;
  memberHashes: string[];
  occurrenceCount: number;
  executionBlock: boolean;
  relatedTo: string[];
}

/* ------------------------------------------------------------------ */
/* Pure planning helpers (unit-tested without I/O)                    */
/* ------------------------------------------------------------------ */

export function collectUniqueSignatures(
  artifacts: Array<{ artifact: SegmentsArtifact; structureConfidence: string }>,
): UniqueSignature[] {
  const map = new Map<string, UniqueSignature>();
  for (const { artifact, structureConfidence } of artifacts) {
    foldArtifact(map, artifact, structureConfidence);
  }
  return [...map.values()].sort((a, b) => a.ring0Hash.localeCompare(b.ring0Hash));
}

function foldArtifact(
  map: Map<string, UniqueSignature>,
  artifact: SegmentsArtifact,
  structureConfidence: string,
): void {
  const seedable = structureConfidence !== 'none';
  for (const seg of artifact.segments) {
    const existing = map.get(seg.ring0Hash);
    if (existing === undefined) {
      map.set(seg.ring0Hash, {
        ring0Hash: seg.ring0Hash,
        sigText: seg.sigText,
        normText: seg.normText,
        itemSet: seg.itemSet,
        executionBlock: seg.executionBlock,
        clusterSeed: seedable,
        occurrenceCount: 1,
      });
    } else {
      existing.occurrenceCount++;
      existing.clusterSeed = existing.clusterSeed || seedable;
      if (existing.itemSet === null && seg.itemSet !== null) existing.itemSet = seg.itemSet;
    }
  }
}

export interface Ring1Plan {
  autoMergeEdges: IdentityEdge[];
  adjudicationPairs: Array<{ a: UniqueSignature; b: UniqueSignature; scores: Record<string, number> }>;
}

/** Ring 1: LSH candidates + item-set path, split by the diff filter (§4.3). */
export function planRing1(uniques: UniqueSignature[]): Ring1Plan {
  const seeds = uniques.filter((u) => u.clusterSeed);
  const byHash = new Map(uniques.map((u) => [u.ring0Hash, u]));
  const entries: SignatureEntry[] = seeds.map((u) => ({
    id: u.ring0Hash,
    signature: minhashSignature(u.sigText),
  }));
  const sigByHash = new Map(entries.map((e) => [e.id, e.signature]));

  const plan: Ring1Plan = { autoMergeEdges: [], adjudicationPairs: [] };
  const seen = new Set<string>();

  const classify = (a: UniqueSignature, b: UniqueSignature, scores: Record<string, number>): void => {
    const key = a.ring0Hash < b.ring0Hash ? `${a.ring0Hash}|${b.ring0Hash}` : `${b.ring0Hash}|${a.ring0Hash}`;
    if (seen.has(key)) return;
    seen.add(key);
    const diff = classifyDiff(a.sigText, b.sigText);
    if (diff.classification === 'trivial' && !diff.hardRoute) {
      plan.autoMergeEdges.push({
        a: a.ring0Hash,
        b: b.ring0Hash,
        ring: 1,
        kind: 'trivial',
        scores,
        diff: { changedA: diff.changedA, changedB: diff.changedB },
        adjudicationRef: null,
        verdict: null,
        merged: true,
      });
    } else {
      plan.adjudicationPairs.push({ a, b, scores });
    }
  };

  let lshPairCount = 0;
  for (const [idA, idB] of candidatePairs(entries)) {
    if (++lshPairCount > config.identity.maxAdjudicationPairs) {
      throw new Error(
        `identity: LSH produced over ${config.identity.maxAdjudicationPairs} candidate pairs ` +
          `(seeds=${seeds.length}) — banding thresholds need calibration before this run is affordable`,
      );
    }
    const a = byHash.get(idA) as UniqueSignature;
    const b = byHash.get(idB) as UniqueSignature;
    const jaccard = jaccardFromSignatures(
      sigByHash.get(idA) as Uint32Array,
      sigByHash.get(idB) as Uint32Array,
    );
    classify(a, b, { minhashJaccard: jaccard });
  }

  // §4.2 enumerated-section item-set path.
  const withItems = seeds.filter((u) => u.itemSet !== null && u.itemSet.length > 0);
  // Candidate generation via an inverted index over item hashes instead of an
  // all-pairs sweep: Jaccard ≥ threshold requires at least one shared item, so
  // the prefilter is EXACT (no recall loss) — and the all-pairs loop was
  // quadratic over every enumerated section in the corpus, which is what
  // OOM-killed the identity run on 512 near-identical form trusts.
  const byItem = new Map<string, number[]>();
  withItems.forEach((u, idx) => {
    for (const item of u.itemSet as string[]) {
      const list = byItem.get(item);
      if (list === undefined) byItem.set(item, [idx]);
      else list.push(idx);
    }
  });
  const itemCandidates = new Set<string>();
  for (const list of byItem.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        itemCandidates.add(`${list[x]}|${list[y]}`);
      }
    }
  }
  for (const cand of itemCandidates) {
    const [iStr, jStr] = cand.split('|');
    {
      const a = withItems[Number(iStr)];
      const b = withItems[Number(jStr)];
      const jaccard = itemSetJaccard(a.itemSet as string[], b.itemSet as string[]);
      if (jaccard < config.itemSet.jaccardThreshold) continue;
      const key = a.ring0Hash < b.ring0Hash ? `${a.ring0Hash}|${b.ring0Hash}` : `${b.ring0Hash}|${a.ring0Hash}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Merge-averse: a lexicon hit on the item diff still adjudicates.
      if (hardRoute(a.sigText, b.sigText)) {
        plan.adjudicationPairs.push({ a, b, scores: { itemJaccard: jaccard } });
      } else {
        const diff = classifyDiff(a.sigText, b.sigText);
        plan.autoMergeEdges.push({
          a: a.ring0Hash,
          b: b.ring0Hash,
          ring: 1,
          kind: 'item-set',
          scores: { itemJaccard: jaccard },
          diff: { changedA: diff.changedA, changedB: diff.changedB },
          adjudicationRef: null,
          verdict: null,
          merged: true,
        });
      }
    }
  }

  // Spend/memory guard (§10 spirit): a pair explosion must be a NAMED failure
  // with counts, never an OOM or a runaway adjudication bill.
  if (plan.adjudicationPairs.length > config.identity.maxAdjudicationPairs) {
    throw new Error(
      `identity: ${plan.adjudicationPairs.length} adjudication pairs exceeds the ` +
        `${config.identity.maxAdjudicationPairs} guard (uniques=${uniques.length}, ` +
        `seeds=${seeds.length}) — thresholds need calibration before this run is affordable`,
    );
  }
  return plan;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function pairId(a: string, b: string): string {
  const [x, y] = a < b ? [a, b] : [b, a];
  return `${x.slice(0, 12)}-${y.slice(0, 12)}`;
}

/* ------------------------------------------------------------------ */
/* Stage orchestration                                                */
/* ------------------------------------------------------------------ */

export interface IdentityDeps {
  store: DocStore;
  blobs: BlobStore;
  batches: BatchClient;
  embeddings: EmbeddingClient;
}

export interface IdentitySummary {
  uniqueSignatures: number;
  autoMerges: number;
  adjudicated: number;
  merges: number;
  separates: number;
  normalizationMisses: number;
  ring2Proposals: number;
  relatedEdges: number;
  families: number;
}

async function adjudicatePairs(
  deps: IdentityDeps,
  env: Env,
  batchName: string,
  ring: 1 | 2,
  pairs: Array<{ a: UniqueSignature; b: UniqueSignature; scores: Record<string, number> }>,
  edges: IdentityEdge[],
  summary: IdentitySummary,
): Promise<void> {
  if (pairs.length === 0) return;

  // Resume from the durable transcripts (§4.3 writes one per adjudicated
  // pair): a pair whose transcript exists is replayed from it — verdict and
  // edge reconstructed with zero re-billing. Only transcript-less pairs are
  // (re)submitted, and via the chunked path (an oversized create body gets
  // '400 terminated' at the API edge, as extract proved).
  const fresh: typeof pairs = [];
  for (const pair of pairs) {
    const id = pairId(pair.a.ring0Hash, pair.b.ring0Hash);
    const transcriptPath = adjudicationPath(env.firmId, env.runId, id);
    if (!(await deps.blobs.exists(transcriptPath))) {
      fresh.push(pair);
      continue;
    }
    const stored = JSON.parse((await deps.blobs.read(transcriptPath)).toString('utf8')) as {
      verdict?: string;
    };
    const parsed = parseAdjudication(
      typeof stored.verdict === 'string' ? { verdict: stored.verdict } : undefined,
    );
    applyAdjudication(pair, parsed, transcriptPath, ring, edges, summary);
  }
  if (fresh.length === 0) return;

  const requests = fresh.map(({ a, b }) => {
    const diff = classifyDiff(a.sigText, b.sigText);
    return buildAdjudicationRequest({
      pairId: pairId(a.ring0Hash, b.ring0Hash),
      textA: a.normText,
      textB: b.normText,
      diffSummary: `A-only: ${diff.changedA.join(' ') || '(none)'}\nB-only: ${diff.changedB.join(' ') || '(none)'}`,
    });
  });
  const batchIds = await deps.batches.submitBatchChunked(batchName, requests);
  const results: Awaited<ReturnType<typeof deps.batches.pollBatch>> = [];
  for (const batchId of batchIds) {
    results.push(...(await deps.batches.pollBatch(batchId)));
  }
  const byId = new Map(results.map((r) => [r.customId.replace(/^adj:/, ''), r]));

  for (const { a, b, scores } of fresh) {
    const id = pairId(a.ring0Hash, b.ring0Hash);
    const result = byId.get(id);
    const parsed = parseAdjudication(result?.ok === true ? result.toolInput : undefined);
    const diff = classifyDiff(a.sigText, b.sigText);
    const transcriptPath = adjudicationPath(env.firmId, env.runId, id);
    void scores;
    // Persist the full transcript (§4.3: every LLM edge stores it).
    await deps.blobs.write(
      transcriptPath,
      JSON.stringify({
        pairId: id,
        ring,
        a: { ring0Hash: a.ring0Hash, normText: a.normText },
        b: { ring0Hash: b.ring0Hash, normText: b.normText },
        scores,
        diff: { changedA: diff.changedA, changedB: diff.changedB },
        verdict: parsed.verdict,
        rationale: parsed.rationale,
        raw: result?.toolInput ?? null,
        error: result?.error ?? null,
      }),
    );
    applyAdjudication({ a, b, scores }, parsed, transcriptPath, ring, edges, summary);
  }
}

function applyAdjudication(
  pair: { a: UniqueSignature; b: UniqueSignature; scores: Record<string, number> },
  parsed: ReturnType<typeof parseAdjudication>,
  transcriptPath: string,
  ring: 1 | 2,
  edges: IdentityEdge[],
  summary: IdentitySummary,
): void {
  const diff = classifyDiff(pair.a.sigText, pair.b.sigText);
  summary.adjudicated++;
  if (parsed.verdict === 'MERGE') summary.merges++;
  else if (parsed.verdict === 'NORMALIZATION_MISS') summary.normalizationMisses++;
  else summary.separates++;
  edges.push({
    a: pair.a.ring0Hash,
    b: pair.b.ring0Hash,
    ring,
    kind: 'adjudicated',
    scores: pair.scores,
    diff: { changedA: diff.changedA, changedB: diff.changedB },
    adjudicationRef: transcriptPath,
    verdict: parsed.verdict,
    merged: parsed.verdict === 'MERGE',
  });
}

export async function runIdentity(deps: IdentityDeps, env: Env): Promise<IdentitySummary> {
  const rows = await deps.store.listDocs(filesCollection(env.firmId, env.runId));
  const segmented = rows.filter((r) => r.data.status === 'segmented');

  // Stream: parse one artifact at a time and fold it straight into the
  // signature map. Holding all 512 parsed artifacts (each carrying the full
  // document's paragraph text alongside its blocks) is what OOM-killed this
  // stage twice — the guards never even printed. Memory is logged so a
  // recurrence names its own footprint instead of dying silently.
  const map = new Map<string, UniqueSignature>();
  let loaded = 0;
  for (const row of segmented) {
    const raw = await deps.blobs.read(segmentsPath(env.firmId, env.runId, row.id));
    const artifact = JSON.parse(raw.toString('utf8')) as SegmentsArtifact;
    foldArtifact(map, artifact, artifact.structureConfidence);
    loaded++;
    if (loaded % 100 === 0) {
      console.log(
        `identity: loaded ${loaded}/${segmented.length} artifacts, ` +
          `uniques=${map.size}, heapMB=${Math.round(process.memoryUsage().heapUsed / 1048576)}`,
      );
    }
  }
  const uniques = [...map.values()].sort((a, b) => a.ring0Hash.localeCompare(b.ring0Hash));
  console.log(
    `identity: collected uniques=${uniques.length}, heapMB=${Math.round(process.memoryUsage().heapUsed / 1048576)}`,
  );
  const summary: IdentitySummary = {
    uniqueSignatures: uniques.length,
    autoMerges: 0,
    adjudicated: 0,
    merges: 0,
    separates: 0,
    normalizationMisses: 0,
    ring2Proposals: 0,
    relatedEdges: 0,
    families: 0,
  };

  // ---- Ring 1 ----------------------------------------------------------
  const plan = planRing1(uniques);
  const edges: IdentityEdge[] = [...plan.autoMergeEdges];
  summary.autoMerges = plan.autoMergeEdges.length;
  await adjudicatePairs(deps, env, 'ring1-adjudication', 1, plan.adjudicationPairs, edges, summary);

  // ---- Union-find over merged edges ------------------------------------
  const uf = new UnionFind();
  for (const u of uniques) uf.add(u.ring0Hash);
  for (const edge of edges) if (edge.merged) uf.union(edge.a, edge.b);

  // ---- Ring 2: one embedding per family representative -----------------
  const byHash = new Map(uniques.map((u) => [u.ring0Hash, u]));
  const prelimGroups = uf.groups();
  const reps: UniqueSignature[] = [];
  for (const members of prelimGroups.values()) {
    // Representative = most frequent member, deterministic tiebreak.
    const rep = members
      .map((h) => byHash.get(h) as UniqueSignature)
      .sort(
        (x, y) => y.occurrenceCount - x.occurrenceCount || x.ring0Hash.localeCompare(y.ring0Hash),
      )[0];
    if (rep.clusterSeed) reps.push(rep);
  }
  const relatedTo = new Map<string, Set<string>>();
  const addRelated = (from: string, to: string): void => {
    let set = relatedTo.get(from);
    if (set === undefined) {
      set = new Set<string>();
      relatedTo.set(from, set);
    }
    set.add(to);
  };
  if (reps.length > 1) {
    const vectors = await deps.embeddings.embedBatch(reps.map((r) => r.normText));
    const ring2Pairs: Array<{ a: UniqueSignature; b: UniqueSignature; scores: Record<string, number> }> = [];
    for (let i = 0; i < reps.length; i++) {
      for (let j = i + 1; j < reps.length; j++) {
        const sim = cosine(vectors[i], vectors[j]);
        if (sim >= config.ring2.cosinePropose) {
          summary.ring2Proposals++;
          ring2Pairs.push({ a: reps[i], b: reps[j], scores: { cosine: sim } });
        } else if (sim >= config.ring2.cosineRelated) {
          summary.relatedEdges++;
          edges.push({
            a: reps[i].ring0Hash,
            b: reps[j].ring0Hash,
            ring: 2,
            kind: 'related',
            scores: { cosine: sim },
            diff: { changedA: [], changedB: [] },
            adjudicationRef: null,
            verdict: null,
            merged: false,
          });
          const fa = uf.find(reps[i].ring0Hash);
          const fb = uf.find(reps[j].ring0Hash);
          addRelated(fa, fb);
          addRelated(fb, fa);
        }
      }
    }
    await adjudicatePairs(deps, env, 'ring2-adjudication', 2, ring2Pairs, edges, summary);
    for (const edge of edges) if (edge.ring === 2 && edge.merged) uf.union(edge.a, edge.b);
  }

  // ---- Final families --------------------------------------------------
  const families: Family[] = [];
  for (const [root, members] of uf.groups()) {
    const memberSigs = members.map((h) => byHash.get(h) as UniqueSignature);
    families.push({
      familyId: `fam_${root.slice(0, 16)}`,
      memberHashes: members,
      occurrenceCount: memberSigs.reduce((n, u) => n + u.occurrenceCount, 0),
      executionBlock: memberSigs.every((u) => u.executionBlock),
      relatedTo: [...(relatedTo.get(root) ?? [])].map((r) => `fam_${r.slice(0, 16)}`).sort(),
    });
  }
  summary.families = families.length;

  await deps.blobs.write(edgesPath(env.firmId, env.runId), JSON.stringify(edges));
  await deps.blobs.write(familiesPath(env.firmId, env.runId), JSON.stringify(families));
  await deps.store.set(runLedgerPath(env.firmId, env.runId), {
    stage: 'identity',
    status: 'completed',
    identity: { ...summary },
    updatedAt: new Date().toISOString(),
  });
  return summary;
}
