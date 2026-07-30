/**
 * Stage 0 — Manifest (§3 Stage 0): Drive BFS from CLAUSE_MINER_ROOT_FOLDER_ID
 * (same root and same ADC drive.readonly service account as
 * functions/src/wills-backfill.ts — keep the two roots identical so both
 * pipelines see one corpus).
 *
 * Sniff-everything filter: keep every non-folder file that is not a PDF
 * (by mimeType AND extension) or known debris (core/sniff.isDebris). NO
 * extension or mimeType whitelist — byte-sniffing in Stage 1 decides format.
 *
 * Per Adam's all-included decision (§15 #6): files the service account
 * cannot read are RECORDED with status 'share-required' (the share-request
 * list) — never silently excluded.
 *
 * Resumable: files already manifested for this runId are skipped.
 * Calibration-sample mode: SAMPLE_LIMIT stratifies the manifest across
 * attorney folders (§4.4).
 */

import { isDebris } from '../core/sniff.js';
import { fileDocPath, filesCollection, runLedgerPath } from '../paths.js';
import type { Env } from '../env.js';
import type { DocData, DocStore, DriveClient, DriveFileMeta } from '../clients/interfaces.js';

export type AttorneyFolder = 'adams' | 'george' | 'jerome' | 'elizabeth' | 'legacy-root';

export const ATTORNEY_FOLDERS: readonly AttorneyFolder[] = [
  'adams',
  'george',
  'jerome',
  'elizabeth',
  'legacy-root',
];

/** Top-level folder name → attorney classification (§3 Stage 0 output). */
export function classifyAttorneyFolder(topLevelFolderName: string | null): AttorneyFolder {
  if (topLevelFolderName === null) return 'legacy-root';
  const lower = topLevelFolderName.toLowerCase();
  if (lower.includes('adam')) return 'adams';
  if (lower.includes('george')) return 'george';
  if (lower.includes('jerome')) return 'jerome';
  if (lower.includes('elizabeth')) return 'elizabeth';
  return 'legacy-root';
}

export function fileExtension(fileName: string): string {
  const m = /\.([A-Za-z0-9!~$]{1,8})$/.exec(fileName.trim());
  return m !== null ? m[1].toLowerCase() : '(none)';
}

function isPdf(meta: DriveFileMeta): boolean {
  return meta.mimeType === 'application/pdf' || fileExtension(meta.name) === 'pdf';
}

const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Extensions we EXPECT to be word-processing files (yield sanity check only —
 *  never a filter). */
const WORDISH_EXTENSIONS = new Set(['doc', 'docx', 'rtf', 'wpd', 'wp', 'wps', 'txt']);

export interface ManifestRow {
  driveFileId: string;
  drivePath: string;
  fileName: string;
  size: number;
  driveMime: string;
  md5Checksum: string | null;
  attorneyFolder: AttorneyFolder;
  externalOwner: boolean;
  status: 'manifested' | 'share-required';
}

export interface ManifestSummary {
  discovered: number;
  manifested: number;
  shareRequired: number;
  debrisSkipped: number;
  pdfExcluded: number;
  foldersVisited: number;
  folderErrors: number;
  wordFileYield: number;
}

export interface ManifestDeps {
  drive: DriveClient;
  store: DocStore;
}

/**
 * Deterministic stratified sample (§4.4 / SAMPLE_LIMIT): round-robin across
 * attorney folders, each stratum sorted by driveFileId.
 */
export function stratifiedSample(rows: ManifestRow[], limit: number): ManifestRow[] {
  const byFolder = new Map<AttorneyFolder, ManifestRow[]>();
  for (const folder of ATTORNEY_FOLDERS) byFolder.set(folder, []);
  for (const row of rows) {
    (byFolder.get(row.attorneyFolder) as ManifestRow[]).push(row);
  }
  for (const list of byFolder.values()) {
    list.sort((a, b) => a.driveFileId.localeCompare(b.driveFileId));
  }
  const out: ManifestRow[] = [];
  let added = true;
  while (out.length < limit && added) {
    added = false;
    for (const folder of ATTORNEY_FOLDERS) {
      if (out.length >= limit) break;
      const list = byFolder.get(folder) as ManifestRow[];
      const next = list.shift();
      if (next !== undefined) {
        out.push(next);
        added = true;
      }
    }
  }
  return out;
}

export async function runManifest(deps: ManifestDeps, env: Env): Promise<ManifestSummary> {
  const { drive, store } = deps;
  const summary: ManifestSummary = {
    discovered: 0,
    manifested: 0,
    shareRequired: 0,
    debrisSkipped: 0,
    pdfExcluded: 0,
    foldersVisited: 0,
    folderErrors: 0,
    wordFileYield: 0,
  };

  // Resume: skip files already manifested for this runId.
  const existing = new Set(await store.listIds(filesCollection(env.firmId, env.runId)));

  interface QueueItem {
    folderId: string;
    path: string;
    topLevelName: string | null;
  }
  const queue: QueueItem[] = [{ folderId: env.rootFolderId, path: '', topLevelName: null }];
  const rows: ManifestRow[] = [];
  const extensionCounts: Record<string, number> = {};
  const unreadableFolders: string[] = [];

  while (queue.length > 0) {
    const { folderId, path, topLevelName } = queue.shift() as QueueItem;
    summary.foldersVisited++;
    let children;
    try {
      children = await drive.listChildren(folderId);
    } catch (err: unknown) {
      // Never silent: an unreadable folder goes on the share-request list.
      summary.folderErrors++;
      unreadableFolders.push(`${path || '(root)'} [${folderId}]: ${String(err)}`);
      continue;
    }
    for (const file of children) {
      if (file.mimeType === DRIVE_FOLDER_MIME) {
        queue.push({
          folderId: file.id,
          path: path.length > 0 ? `${path}/${file.name}` : file.name,
          topLevelName: topLevelName ?? file.name,
        });
        continue;
      }
      summary.discovered++;
      if (isDebris(file.name)) {
        summary.debrisSkipped++;
        continue;
      }
      if (isPdf(file)) {
        summary.pdfExcluded++;
        continue;
      }
      const ext = fileExtension(file.name);
      extensionCounts[ext] = (extensionCounts[ext] ?? 0) + 1;
      if (WORDISH_EXTENSIONS.has(ext)) summary.wordFileYield++;
      rows.push({
        driveFileId: file.id,
        drivePath: path,
        fileName: file.name,
        size: file.size,
        driveMime: file.mimeType,
        md5Checksum: file.md5Checksum ?? null,
        attorneyFolder: classifyAttorneyFolder(topLevelName),
        externalOwner: !file.ownedByMe,
        status: file.canDownload ? 'manifested' : 'share-required',
      });
    }
  }

  const selected = env.sampleLimit !== undefined ? stratifiedSample(rows, env.sampleLimit) : rows;

  for (const row of selected) {
    if (row.status === 'share-required') summary.shareRequired++;
    else summary.manifested++;
    if (existing.has(row.driveFileId)) continue; // resumable
    await store.set(fileDocPath(env.firmId, env.runId, row.driveFileId), row as unknown as DocData);
  }

  const shareRequestList = selected
    .filter((r) => r.status === 'share-required')
    .map((r) => `${r.drivePath}/${r.fileName} [${r.driveFileId}]`);

  await store.set(runLedgerPath(env.firmId, env.runId), {
    stage: 'manifest',
    status: 'completed',
    manifest: {
      ...summary,
      sampleLimit: env.sampleLimit ?? null,
      extensionCounts,
      // Finalized by Stage 1 byte-sniffing; §3 Stage 0 exclusion visibility.
      expectedWordFileRange: '8000-18000 (±50% until this stage reports)',
      shareRequestList,
      unreadableFolders,
    },
    updatedAt: new Date().toISOString(),
  });

  return summary;
}
