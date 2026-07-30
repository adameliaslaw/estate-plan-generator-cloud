/**
 * Shared loaders for the late stages (7–9): segment artifacts, docFacts,
 * occurrence index, counting units. Pure assembly over injected stores.
 */

import { simhash } from '../core/simhash.js';
import {
  deriveCountingUnits,
  type CountingUnit,
  type CountingUnitInput,
} from '../counting-units.js';
import { sanitizeFactVector, type FactVector } from '../facts-vocabulary.js';
import {
  docFactsCollection,
  filesCollection,
  segmentsPath,
  textPath,
} from '../paths.js';
import type { SegmentsArtifact } from './segment-normalize.js';
import type { Env } from '../env.js';
import type { BlobStore, DocData, DocStore } from '../clients/interfaces.js';

export interface DocFacts {
  parties: Array<{ role: string; names: string[] }>;
  executionDate: string | null;
  facts: FactVector;
  versionLabel: string | null;
}

export interface Occurrence {
  driveFileId: string;
  segmentIndex: number;
  charSpan: [number, number];
  articleIndex: number;
  sectionIndex: number;
  structureSignal: string;
  parameters: Record<string, string[]>;
  textArtifactPath: string;
  parserVersion: string;
}

export async function loadSegmentedRows(
  store: DocStore,
  env: Env,
): Promise<Array<{ id: string; data: DocData }>> {
  const rows = await store.listDocs(filesCollection(env.firmId, env.runId));
  return rows.filter((r) => r.data.status === 'segmented');
}

export async function loadArtifacts(
  blobs: BlobStore,
  env: Env,
  rows: Array<{ id: string }>,
): Promise<Map<string, SegmentsArtifact>> {
  const out = new Map<string, SegmentsArtifact>();
  for (const row of rows) {
    const raw = await blobs.read(segmentsPath(env.firmId, env.runId, row.id));
    out.set(row.id, JSON.parse(raw.toString('utf8')) as SegmentsArtifact);
  }
  return out;
}

export function buildOccurrenceIndex(
  artifacts: Map<string, SegmentsArtifact>,
): Map<string, Occurrence[]> {
  const out = new Map<string, Occurrence[]>();
  for (const [driveFileId, artifact] of artifacts) {
    for (const seg of artifact.segments) {
      const occ: Occurrence = {
        driveFileId,
        segmentIndex: seg.segmentIndex,
        charSpan: seg.charSpan,
        articleIndex: seg.articleIndex,
        sectionIndex: seg.sectionIndex,
        structureSignal: seg.structureSignal,
        parameters: seg.parameters,
        textArtifactPath: artifact.textArtifactPath,
        parserVersion: artifact.parserVersion,
      };
      const list = out.get(seg.ring0Hash);
      if (list === undefined) out.set(seg.ring0Hash, [occ]);
      else list.push(occ);
    }
  }
  return out;
}

export async function loadDocFacts(store: DocStore, env: Env): Promise<Map<string, DocFacts>> {
  const docs = await store.listDocs(docFactsCollection(env.firmId, env.runId));
  const out = new Map<string, DocFacts>();
  for (const doc of docs) {
    if (doc.data.status !== 'extracted') continue;
    const parties = Array.isArray(doc.data.parties)
      ? (doc.data.parties as Array<{ role: string; names: string[] }>)
      : [];
    out.set(doc.id, {
      parties,
      executionDate: typeof doc.data.executionDate === 'string' ? doc.data.executionDate : null,
      facts: sanitizeFactVector((doc.data.facts ?? {}) as Record<string, unknown>),
      versionLabel: typeof doc.data.versionLabel === 'string' ? doc.data.versionLabel : null,
    });
  }
  return out;
}

export function eraYear(executionDate: string | null): number | null {
  if (executionDate === null) return null;
  const year = Number(executionDate.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}

/** Immediate parent folder name — the presumptive client name (§7.2). */
export function clientFolderName(drivePath: unknown): string {
  if (typeof drivePath !== 'string' || drivePath.length === 0) return '(root)';
  const parts = drivePath.split('/').filter((p) => p.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : '(root)';
}

export interface CountingUnitsResult {
  units: CountingUnit[];
  unitByDocId: Map<string, CountingUnit>;
}

/** §7.2 counting units over the segmented pilot docs. */
export async function loadCountingUnits(
  deps: { store: DocStore; blobs: BlobStore },
  env: Env,
  rows: Array<{ id: string; data: DocData }>,
  docFacts: Map<string, DocFacts>,
): Promise<CountingUnitsResult> {
  const inputs: CountingUnitInput[] = [];
  for (const row of rows) {
    const facts = docFacts.get(row.id);
    const text = (await deps.blobs.read(textPath(env.firmId, row.id))).toString('utf8');
    inputs.push({
      driveFileId: row.id,
      clientFolderName: clientFolderName(row.data.drivePath),
      attorneyFolder:
        typeof row.data.attorneyFolder === 'string' ? row.data.attorneyFolder : 'legacy-root',
      partyNames: facts?.parties.flatMap((p) => p.names) ?? [],
      instrumentKind:
        typeof row.data.instrumentKind === 'string' ? row.data.instrumentKind : 'original',
      versionLabel: facts?.versionLabel ?? null,
      executionDate: facts?.executionDate ?? null,
      simhashHex: simhash(text).toString(16),
    });
  }
  const units = deriveCountingUnits(inputs);
  const unitByDocId = new Map<string, CountingUnit>();
  for (const unit of units) {
    for (const id of unit.memberDriveFileIds) unitByDocId.set(id, unit);
  }
  return { units, unitByDocId };
}
