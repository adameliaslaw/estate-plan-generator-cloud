/**
 * Stage QA — conversion QA report for the §4.4 calibration gate.
 *
 * Read-only over the convert stage's own outputs (Firestore rows + the
 * segments-ready artifacts in GCS): no Drive reads, no LLM calls, no writes.
 * It exists because the §4.4 checks — conversion fidelity, numbering
 * survival, RTF bold/caps run survival, reflow correctness on hard-wrapped
 * files, and whether Schedule A carries asset values — are decided from the
 * converted artifacts, which are only reachable from inside the Job's
 * identity. The report prints per-file evidence so a human can eyeball the
 * named worst files against Drive preview instead of sampling blind.
 */

import { config } from '../config.js';
import { isHardWrapped } from '../core/reflow.js';
import { isHeadingLine } from '../core/segment.js';
import { filesCollection, segmentsReadyPath } from '../paths.js';
import type { SegmentsReadyFile } from './convert.js';
import type { Env } from '../env.js';
import type { BlobStore, DocStore } from '../clients/interfaces.js';

export interface QaConvertDeps {
  store: DocStore;
  blobs: BlobStore;
}

interface FileDiag {
  fileName: string;
  attorneyFolder: string;
  sniffedFormat: string;
  via: string;
  structureConfidence: string;
  paragraphs: number;
  chars: number;
  /** §4.1 hard-wrap heuristic on the RAW converted paragraphs. */
  hardWrapped: boolean;
  /** Style, numbering, or text-grammar boundaries found. */
  boundaries: number;
  /** True when boundaries < 1 per 4,000 chars (§4.2 under-seg gate). */
  underSegmented: boolean;
  boldParagraphs: number;
  capsHeadings: number;
  scheduleA: 'absent' | 'no-values' | 'has-values';
}

export interface QaConvertReport {
  files: number;
  errors: Array<{ fileName: string; drivePath: string; error: string }>;
  unrecognized: string[];
  byVia: Record<string, number>;
  bySniffedFormat: Record<string, number>;
  /** Converted docs with zero structural boundaries — fidelity suspects. */
  noBoundaryFiles: string[];
  underSegmentedFiles: string[];
  hardWrappedFiles: string[];
  /** RTF-sniffed docs that kept zero bold runs — run-survival suspects. */
  rtfNoBoldFiles: string[];
  scheduleA: { absent: number; noValues: number; hasValues: number };
  diags: FileDiag[];
}

const SCHEDULE_A_RE = /SCHEDULE\s+["'“”]?A\b/i;
/** A dollar amount of at least three digits — "$10 and other property" fails. */
const DOLLAR_VALUE_RE = /\$\s?\d[\d,]{2,}/;

function scheduleAStatus(text: string): FileDiag['scheduleA'] {
  const m = SCHEDULE_A_RE.exec(text);
  if (m === null) return 'absent';
  const window = text.slice(m.index, m.index + 4000);
  return DOLLAR_VALUE_RE.test(window) ? 'has-values' : 'no-values';
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export async function runQaConvert(deps: QaConvertDeps, env: Env): Promise<QaConvertReport> {
  const report: QaConvertReport = {
    files: 0,
    errors: [],
    unrecognized: [],
    byVia: {},
    bySniffedFormat: {},
    noBoundaryFiles: [],
    underSegmentedFiles: [],
    hardWrappedFiles: [],
    rtfNoBoldFiles: [],
    scheduleA: { absent: 0, noValues: 0, hasValues: 0 },
    diags: [],
  };

  const rows = await deps.store.listDocs(filesCollection(env.firmId, env.runId));
  report.files = rows.length;

  for (const row of rows) {
    const d = row.data;
    const fileName = typeof d.fileName === 'string' ? d.fileName : row.id;
    if (d.status === 'error') {
      report.errors.push({
        fileName,
        drivePath: typeof d.drivePath === 'string' ? d.drivePath : '',
        error: typeof d.processing_error === 'string' ? d.processing_error : 'unknown',
      });
      continue;
    }
    if (d.status === 'unrecognized-format') {
      report.unrecognized.push(fileName);
      continue;
    }
    if (d.status !== 'converted') continue;

    const raw = await deps.blobs.read(segmentsReadyPath(env.firmId, row.id));
    const segments = JSON.parse(raw.toString('utf8')) as SegmentsReadyFile;
    const texts = segments.paragraphs.map((p) => p.text);
    const text = texts.join('\n');

    let boundaries = 0;
    let boldParagraphs = 0;
    let capsHeadings = 0;
    for (const p of segments.paragraphs) {
      const styleBoundary =
        (p.styleId !== null && /^(TR_|Heading)/i.test(p.styleId)) || p.numIlvl !== null;
      const grammarBoundary = isHeadingLine(p.text);
      if (styleBoundary || grammarBoundary) boundaries++;
      if (p.bold) boldParagraphs++;
      if (grammarBoundary && !/[a-z]/.test(p.text.trim()) && p.text.trim().length > 0) {
        capsHeadings++;
      }
    }

    const diag: FileDiag = {
      fileName,
      attorneyFolder: typeof d.attorneyFolder === 'string' ? d.attorneyFolder : 'unknown',
      sniffedFormat: typeof d.sniffedFormat === 'string' ? d.sniffedFormat : 'unknown',
      via: typeof d.convertedVia === 'string' ? d.convertedVia : 'unknown',
      structureConfidence:
        typeof d.structureConfidence === 'string' ? d.structureConfidence : 'unknown',
      paragraphs: segments.paragraphs.length,
      chars: text.length,
      hardWrapped: isHardWrapped(texts),
      boundaries,
      underSegmented:
        text.length > 0 &&
        boundaries < Math.ceil(text.length / config.segmentation.underSegCharsPerBoundary),
      boldParagraphs,
      capsHeadings,
      scheduleA: scheduleAStatus(text),
    };
    report.diags.push(diag);

    bump(report.byVia, diag.via);
    bump(report.bySniffedFormat, diag.sniffedFormat);
    if (diag.boundaries === 0) report.noBoundaryFiles.push(fileName);
    if (diag.underSegmented) report.underSegmentedFiles.push(fileName);
    if (diag.hardWrapped) report.hardWrappedFiles.push(fileName);
    if (diag.sniffedFormat === 'rtf' && diag.via === 'soffice' && diag.boldParagraphs === 0) {
      report.rtfNoBoldFiles.push(fileName);
    }
    if (diag.scheduleA === 'absent') report.scheduleA.absent++;
    else if (diag.scheduleA === 'no-values') report.scheduleA.noValues++;
    else report.scheduleA.hasValues++;
  }

  return report;
}

const LINE = '═'.repeat(60);

export function formatQaConvert(report: QaConvertReport): string {
  const out: string[] = [LINE, ' CONVERSION QA — §4.4 CALIBRATION GATE EVIDENCE', LINE];
  out.push(`  files in corpus manifest: ${report.files}`);
  out.push(`  by format: ${JSON.stringify(report.bySniffedFormat)}`);
  out.push(`  by conversion route: ${JSON.stringify(report.byVia)}`);

  out.push('');
  out.push(`  ── errors (${report.errors.length}) — each needs a human read:`);
  for (const e of report.errors) {
    out.push(`     ✗ ${e.fileName}  [${e.drivePath}]`);
    out.push(`       ${e.error}`);
  }
  if (report.unrecognized.length > 0) {
    out.push(`  ── unrecognized formats: ${report.unrecognized.join(', ')}`);
  }

  out.push('');
  out.push('  ── numbering/heading survival:');
  out.push(`     zero-boundary files (${report.noBoundaryFiles.length}): ${report.noBoundaryFiles.join(', ') || '(none)'}`);
  out.push(`     under-segmented (<1 boundary/4k chars) (${report.underSegmentedFiles.length}): ${report.underSegmentedFiles.join(', ') || '(none)'}`);
  out.push('  ── reflow candidates (§4.1 hard-wrap heuristic):');
  out.push(`     ${report.hardWrappedFiles.length} file(s): ${report.hardWrappedFiles.join(', ') || '(none)'}`);
  out.push('  ── RTF bold-run survival:');
  out.push(`     rtf files via soffice with ZERO bold runs (${report.rtfNoBoldFiles.length}): ${report.rtfNoBoldFiles.join(', ') || '(none)'}`);

  out.push('');
  out.push('  ── Schedule A asset values (decides estateSizeBand, §7.1):');
  out.push(
    `     has-values ${report.scheduleA.hasValues} · schedule-without-values ${report.scheduleA.noValues} · no schedule found ${report.scheduleA.absent}`,
  );

  out.push('');
  out.push('  ── per-file detail:');
  for (const d of report.diags) {
    out.push(
      `     ${d.fileName} [${d.attorneyFolder}] ${d.sniffedFormat}/${d.via} ` +
        `paras=${d.paragraphs} chars=${d.chars} boundaries=${d.boundaries}` +
        `${d.hardWrapped ? ' HARD-WRAP' : ''}${d.underSegmented ? ' UNDER-SEG' : ''} ` +
        `bold=${d.boldParagraphs} caps=${d.capsHeadings} schedA=${d.scheduleA}`,
    );
  }
  out.push(LINE);
  return out.join('\n');
}
