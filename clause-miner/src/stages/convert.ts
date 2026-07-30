/**
 * Stage 1 — Convert + cache (§8): batched LibreOffice headless conversion.
 *
 * - Format detection is by BYTES (core/sniff), never extension/mimeType:
 *   first 8 bytes via a Drive Range request, then a full download for the
 *   conversion batch.
 * - Batches of 25 files per soffice invocation with a per-invocation
 *   -env:UserInstallation temp profile, a 60 s kill timer, and profile wipe
 *   on crash (soffice wedges on shared profiles).
 * - Explicit --infilter chosen from the sniffed format so soffice never
 *   guesses when magic disagrees with extension.
 * - Fallback ladder on failure: ole-doc → antiword; rtf → in-repo RTF text
 *   extraction (src/rtf-text.ts); wpd → wpd2text — all marked
 *   structureConfidence 'none' (frequency counts only, never cluster seeds).
 * - Whole-ladder failures produce error records mirroring the
 *   wills-processor._writeErrorRecord pattern — never silent drops.
 *
 * Outputs per file (gs://{bucket}/firms/{firmId}/clause-mining/…):
 *   converted/{id}.docx, text/{id}.txt (plaintext artifact, tagged
 *   parserVersion — all char-spans index into it), and a segments-ready
 *   JSON (paragraphs + style/numbering boundary hints from the OOXML,
 *   parsed with fflate — no mammoth).
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.js';
import { sniffFormat, type SniffedFormat } from '../core/sniff.js';
import { isOoxmlDocx, parseDocxParagraphs, type OoxmlParagraph } from '../ooxml.js';
import { rtfToText } from '../rtf-text.js';
import { fileExtension } from './manifest.js';
import {
  convertedPath,
  fileDocPath,
  filesCollection,
  runLedgerPath,
  seedFileDocPath,
  seedFilesCollection,
  segmentsReadyPath,
  textPath,
} from '../paths.js';
import type { Env } from '../env.js';
import type {
  BlobStore,
  DocData,
  DocStore,
  DriveClient,
  ShellRunner,
} from '../clients/interfaces.js';

/** Version tag on every text artifact (§3 Stage 1). */
export const PARSER_VERSION = 'clause-miner-parser/1';

/** Explicit --infilter per sniffed format (§8 — soffice never guesses). */
export const INFILTERS: Readonly<Partial<Record<SniffedFormat, string>>> = {
  rtf: 'Rich Text Format',
  'ole-doc': 'MS Word 97',
  wpd: 'WordPerfect',
};

export type StructureConfidence = 'ooxml' | 'none';

export interface SegmentsReadyFile {
  parserVersion: string;
  structureConfidence: StructureConfidence;
  paragraphs: OoxmlParagraph[];
}

export interface ConvertDeps {
  drive: DriveClient;
  store: DocStore;
  blobs: BlobStore;
  shell: ShellRunner;
  /** Overridable for tests. */
  tmpRoot?: string;
}

export interface ConvertSummary {
  converted: number;
  passthrough: number;
  fallbackText: number;
  unrecognized: number;
  errors: number;
  skipped: number;
}

/**
 * Which manifest the conversion pass walks. The corpus and the curated seed
 * (§11 P1) live in separate collections — see paths.seedFilesCollection for
 * why — but they need byte-identical conversion, or the gold set would be
 * measured through a different parser than the corpus it validates.
 */
export interface ConvertScope {
  collectionPath: string;
  docPath: (driveFileId: string) => string;
  /** Ledger key for this pass's summary. */
  ledgerKey: string;
}

export function corpusScope(env: Env): ConvertScope {
  return {
    collectionPath: filesCollection(env.firmId, env.runId),
    docPath: (id) => fileDocPath(env.firmId, env.runId, id),
    ledgerKey: 'convert',
  };
}

export function seedScope(env: Env): ConvertScope {
  return {
    collectionPath: seedFilesCollection(env.firmId, env.runId),
    docPath: (id) => seedFileDocPath(env.firmId, env.runId, id),
    ledgerKey: 'seedConvert',
  };
}

function plainParagraphs(text: string): OoxmlParagraph[] {
  return text.split(/\r?\n/).map((line) => ({
    text: line,
    styleId: null,
    numIlvl: null,
    inTable: false,
    bold: false,
    centered: false,
  }));
}

/** Mirror of wills-processor._writeErrorRecord semantics for file rows. */
async function writeErrorRecord(
  store: DocStore,
  path: string,
  current: DocData,
  error: string,
): Promise<void> {
  if (current.status === 'converted') return; // never clobber a good record
  await store.set(path, {
    status: 'error',
    processing_error: error,
    needs_human_review: true,
    needs_human_review_reasons: [error],
    updatedAt: new Date().toISOString(),
  });
}

async function persistArtifacts(
  deps: ConvertDeps,
  env: Env,
  scope: ConvertScope,
  driveFileId: string,
  opts: {
    docxBytes: Buffer | null;
    paragraphs: OoxmlParagraph[];
    structureConfidence: StructureConfidence;
    sniffedFormat: SniffedFormat;
    via: string;
  },
): Promise<void> {
  const text = opts.paragraphs.map((p) => p.text).join('\n');
  if (opts.docxBytes !== null) {
    await deps.blobs.write(convertedPath(env.firmId, driveFileId), opts.docxBytes);
  }
  await deps.blobs.write(textPath(env.firmId, driveFileId), text);
  const segmentsReady: SegmentsReadyFile = {
    parserVersion: PARSER_VERSION,
    structureConfidence: opts.structureConfidence,
    paragraphs: opts.paragraphs,
  };
  await deps.blobs.write(
    segmentsReadyPath(env.firmId, driveFileId),
    JSON.stringify(segmentsReady),
  );
  await deps.store.set(scope.docPath(driveFileId), {
    status: 'converted',
    sniffedFormat: opts.sniffedFormat,
    structureConfidence: opts.structureConfidence,
    parserVersion: PARSER_VERSION,
    convertedVia: opts.via,
    textArtifactPath: textPath(env.firmId, driveFileId),
    convertedStoragePath: opts.docxBytes !== null ? convertedPath(env.firmId, driveFileId) : null,
    updatedAt: new Date().toISOString(),
  });
}

/** One soffice invocation over a batch, with kill timer + profile wipe. */
async function runSofficeBatch(
  deps: ConvertDeps,
  batchDir: string,
  outDir: string,
  profileDir: string,
  infilter: string,
  inputPaths: string[],
): Promise<{ ok: boolean; stderr: string }> {
  await mkdir(outDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });
  const result = await deps.shell.run(
    'soffice',
    [
      '--headless',
      `-env:UserInstallation=file://${profileDir}`,
      `--infilter=${infilter}`,
      '--convert-to',
      'docx',
      '--outdir',
      outDir,
      ...inputPaths,
    ],
    { timeoutMs: config.convert.killTimerMs },
  );
  if (result.timedOut || result.code !== 0) {
    // §8: profile wipe on crash — a wedged profile poisons later invocations.
    await rm(profileDir, { recursive: true, force: true });
    return { ok: false, stderr: result.timedOut ? 'soffice kill timer' : result.stderr };
  }
  void batchDir;
  return { ok: true, stderr: '' };
}

/** Fallback ladder (§8) — returns extracted TEXT or null. */
async function fallbackExtract(
  deps: ConvertDeps,
  format: SniffedFormat,
  inputPath: string,
  bytes: Buffer,
): Promise<{ text: string; via: string } | null> {
  if (format === 'rtf') {
    const text = rtfToText(bytes.toString('latin1'));
    return text.length > 0 ? { text, via: 'rtf-text' } : null;
  }
  if (format === 'ole-doc') {
    const res = await deps.shell.run('antiword', [inputPath], {
      timeoutMs: config.convert.killTimerMs,
    });
    return res.code === 0 && res.stdout.trim().length > 0
      ? { text: res.stdout, via: 'antiword' }
      : null;
  }
  if (format === 'wpd') {
    const res = await deps.shell.run('wpd2text', [inputPath], {
      timeoutMs: config.convert.killTimerMs,
    });
    return res.code === 0 && res.stdout.trim().length > 0
      ? { text: res.stdout, via: 'wpd2text' }
      : null;
  }
  return null;
}

export async function runConvert(
  deps: ConvertDeps,
  env: Env,
  scope: ConvertScope = corpusScope(env),
): Promise<ConvertSummary> {
  const summary: ConvertSummary = {
    converted: 0,
    passthrough: 0,
    fallbackText: 0,
    unrecognized: 0,
    errors: 0,
    skipped: 0,
  };
  const unrecognizedFormats: Record<string, number> = {};
  const rows = await deps.store.listDocs(scope.collectionPath);
  const pending = rows.filter(
    (r) => r.data.status === 'manifested', // resumable: converted/error rows skip
  );
  summary.skipped = rows.length - pending.length;

  // ---- Sniff pass: first 8 bytes per file ------------------------------
  interface Sniffed {
    id: string;
    data: DocData;
    format: SniffedFormat;
  }
  const sniffed: Sniffed[] = [];
  for (const row of pending) {
    try {
      const head = await deps.drive.downloadRange(row.id, config.convert.sniffBytes);
      sniffed.push({ id: row.id, data: row.data, format: sniffFormat(head) });
    } catch (err: unknown) {
      summary.errors++;
      await writeErrorRecord(
        deps.store,
        scope.docPath(row.id),
        row.data,
        `sniff download failed: ${String(err)}`,
      );
    }
  }

  // Unknown formats: visible in the ledger, never silently dropped (§3).
  const convertible: Sniffed[] = [];
  for (const s of sniffed) {
    if (s.format === 'unknown') {
      summary.unrecognized++;
      const ext = fileExtension(typeof s.data.fileName === 'string' ? s.data.fileName : '');
      unrecognizedFormats[ext] = (unrecognizedFormats[ext] ?? 0) + 1;
      await deps.store.set(scope.docPath(s.id), {
        status: 'unrecognized-format',
        sniffedFormat: 'unknown',
        updatedAt: new Date().toISOString(),
      });
    } else {
      convertible.push(s);
    }
  }

  const tmpRoot = deps.tmpRoot ?? join(tmpdir(), `clause-miner-${env.runId}`);
  await mkdir(tmpRoot, { recursive: true });

  // ---- ZIP/OOXML pass-through ------------------------------------------
  const needSoffice: Sniffed[] = [];
  for (const s of convertible) {
    if (s.format !== 'docx') {
      needSoffice.push(s);
      continue;
    }
    try {
      const bytes = await deps.drive.download(s.id);
      if (isOoxmlDocx(bytes)) {
        const paragraphs = parseDocxParagraphs(bytes);
        await persistArtifacts(deps, env, scope, s.id, {
          docxBytes: bytes,
          paragraphs,
          structureConfidence: 'ooxml',
          sniffedFormat: 'docx',
          via: 'passthrough',
        });
        summary.passthrough++;
      } else {
        needSoffice.push(s); // a ZIP that is not OOXML — let soffice try
      }
    } catch (err: unknown) {
      summary.errors++;
      await writeErrorRecord(
        deps.store,
        scope.docPath(s.id),
        s.data,
        `passthrough failed: ${String(err)}`,
      );
    }
  }

  // ---- Batched soffice conversion per format ---------------------------
  const byFormat = new Map<SniffedFormat, Sniffed[]>();
  for (const s of needSoffice) {
    const list = byFormat.get(s.format);
    if (list === undefined) byFormat.set(s.format, [s]);
    else list.push(s);
  }

  let batchNo = 0;
  for (const [format, files] of byFormat) {
    const infilter = INFILTERS[format] ?? 'MS Word 97';
    for (let i = 0; i < files.length; i += config.convert.batchSize) {
      const batch = files.slice(i, i + config.convert.batchSize);
      batchNo++;
      const batchDir = join(tmpRoot, `batch-${batchNo}`);
      const outDir = join(batchDir, 'out');
      const profileDir = join(batchDir, 'profile');
      await mkdir(batchDir, { recursive: true });

      // Download batch inputs. Input name = driveFileId + real extension so
      // soffice output is {driveFileId}.docx.
      const inputs: Array<{ s: Sniffed; path: string; bytes: Buffer }> = [];
      for (const s of batch) {
        try {
          const bytes = await deps.drive.download(s.id);
          const path = join(batchDir, `${s.id}.${format === 'ole-doc' ? 'doc' : format}`);
          await writeFile(path, bytes);
          inputs.push({ s, path, bytes });
        } catch (err: unknown) {
          summary.errors++;
          await writeErrorRecord(
            deps.store,
            scope.docPath(s.id),
            s.data,
            `download failed: ${String(err)}`,
          );
        }
      }
      if (inputs.length === 0) continue;

      const batchResult = await runSofficeBatch(
        deps,
        batchDir,
        outDir,
        profileDir,
        infilter,
        inputs.map((x) => x.path),
      );

      for (const { s, path, bytes } of inputs) {
        const outPath = join(outDir, `${s.id}.docx`);
        let docxBytes: Buffer | null = null;
        try {
          docxBytes = await readFile(outPath);
        } catch {
          docxBytes = null;
        }

        if (docxBytes === null && batchResult.ok) {
          // Batch succeeded but this file produced no output — one per-file retry.
          const solo = await runSofficeBatch(
            deps,
            batchDir,
            outDir,
            join(batchDir, `profile-solo-${s.id}`),
            infilter,
            [path],
          );
          if (solo.ok) {
            try {
              docxBytes = await readFile(outPath);
            } catch {
              docxBytes = null;
            }
          }
        }

        if (docxBytes !== null && isOoxmlDocx(docxBytes)) {
          const paragraphs = parseDocxParagraphs(docxBytes);
          await persistArtifacts(deps, env, scope, s.id, {
            docxBytes,
            paragraphs,
            structureConfidence: 'ooxml',
            sniffedFormat: format,
            via: 'soffice',
          });
          summary.converted++;
          continue;
        }

        // §8 fallback ladder.
        const fallback = await fallbackExtract(deps, format, path, bytes);
        if (fallback !== null) {
          await persistArtifacts(deps, env, scope, s.id, {
            docxBytes: null,
            paragraphs: plainParagraphs(fallback.text),
            structureConfidence: 'none',
            sniffedFormat: format,
            via: fallback.via,
          });
          summary.fallbackText++;
          continue;
        }

        // Whole ladder failed — error record, never silent (§8).
        summary.errors++;
        await writeErrorRecord(
          deps.store,
          scope.docPath(s.id),
          s.data,
          `conversion ladder exhausted (soffice: ${batchResult.stderr || 'no output'})`,
        );
      }
      await rm(batchDir, { recursive: true, force: true });
    }
  }

  await deps.store.set(runLedgerPath(env.firmId, env.runId), {
    stage: scope.ledgerKey,
    status: 'completed',
    [scope.ledgerKey]: { ...summary, unrecognizedFormats, parserVersion: PARSER_VERSION },
    updatedAt: new Date().toISOString(),
  });
  return summary;
}
