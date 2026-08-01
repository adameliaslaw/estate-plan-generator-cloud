/**
 * Stage 2 — Triage classify (§3 Stage 2): haiku via the Batches API on
 * filename + the first ~1,500 tokens of converted text. Forced tool use
 * (wills-classifier.ts pattern) → {docCategory, instrumentKind, confidence}
 * persisted to the file rows. Pilot filter: trust docs only.
 */

import { config } from '../config.js';
import { fileDocPath, filesCollection, runLedgerPath, textPath } from '../paths.js';
import type { Env } from '../env.js';
import type {
  BatchClient,
  BatchRequest,
  BlobStore,
  DocData,
  DocStore,
} from '../clients/interfaces.js';

export const DOC_CATEGORIES = [
  'trust',
  'will',
  'poa',
  'livingWill',
  'letter',
  'questionnaire',
  'invoice',
  'other',
] as const;
export type DocCategory = (typeof DOC_CATEGORIES)[number];

export const INSTRUMENT_KINDS = ['original', 'restatement', 'amendment'] as const;
export type InstrumentKind = (typeof INSTRUMENT_KINDS)[number];

const TRIAGE_SYSTEM = `You are a fast document triager for an estate-planning law practice's drive. Classify the document into exactly one category:
- trust: any trust agreement — revocable/irrevocable living trust, amendment to a trust, or full restatement
- will: Last Will and Testament or codicil
- poa: financial or healthcare power of attorney
- livingWill: living will / advance healthcare directive
- letter: correspondence, memos, cover letters
- questionnaire: intake forms, family/asset worksheets
- invoice: bills, invoices, engagement/fee letters
- other: anything else

For TRUST documents also report instrumentKind:
- original: a trust agreement created new
- restatement: a complete amended-and-restated trust
- amendment: an amendment modifying specific articles only

A document titled "Last Will and Testament" containing a testamentary trust is a will, not a trust. Output structured JSON via the tool only.`;

export const TRIAGE_TOOL = {
  name: 'triage_document',
  description: 'Classify the document.',
  input_schema: {
    type: 'object' as const,
    properties: {
      docCategory: { type: 'string', enum: DOC_CATEGORIES as unknown as string[] },
      instrumentKind: {
        type: 'string',
        enum: INSTRUMENT_KINDS as unknown as string[],
        description: 'Only meaningful for docCategory=trust.',
      },
      confidence: { type: 'number', description: '0.0-1.0' },
    },
    required: ['docCategory', 'confidence'],
  },
};

export function buildTriageRequest(driveFileId: string, fileName: string, text: string): BatchRequest {
  return {
    customId: `triage:${driveFileId}`,
    model: 'haiku',
    maxTokens: 256,
    system: TRIAGE_SYSTEM,
    userText: `File name: ${fileName}\n\nDocument text (truncated):\n${text.slice(0, config.triage.triageChars)}`,
    tool: TRIAGE_TOOL,
  };
}

export interface TriageResult {
  docCategory: DocCategory;
  instrumentKind: InstrumentKind | null;
  confidence: number;
}

export function parseTriageResult(toolInput: DocData | undefined): TriageResult {
  const category = (DOC_CATEGORIES as readonly string[]).includes(
    toolInput?.docCategory as string,
  )
    ? (toolInput?.docCategory as DocCategory)
    : 'other';
  const kind = (INSTRUMENT_KINDS as readonly string[]).includes(
    toolInput?.instrumentKind as string,
  )
    ? (toolInput?.instrumentKind as InstrumentKind)
    : null;
  return {
    docCategory: category,
    instrumentKind: category === 'trust' ? (kind ?? 'original') : null,
    confidence: typeof toolInput?.confidence === 'number' ? toolInput.confidence : 0,
  };
}

/** Pilot filter (§3 Stage 2): trusts only. */
export function isPilotDoc(row: DocData): boolean {
  return row.docCategory === 'trust';
}

export interface TriageDeps {
  store: DocStore;
  blobs: BlobStore;
  batches: BatchClient;
}

export interface TriageSummary {
  submitted: number;
  classified: number;
  failed: number;
  trusts: number;
  skipped: number;
}

export async function runTriage(deps: TriageDeps, env: Env): Promise<TriageSummary> {
  const rows = await deps.store.listDocs(filesCollection(env.firmId, env.runId));
  const pending = rows.filter(
    (r) => r.data.status === 'converted' && r.data.docCategory === undefined,
  );
  const summary: TriageSummary = {
    submitted: 0,
    classified: 0,
    failed: 0,
    trusts: 0,
    skipped: rows.length - pending.length,
  };
  if (pending.length === 0) return summary;

  // Resume (§3): a prior execution may have SUBMITTED a batch and died (or
  // outlived its launcher) before applying results. The batchId was persisted
  // to the ledger before polling for exactly this case — re-poll THAT batch
  // first instead of resubmitting the same files, which would double-bill the
  // whole stage. Results already applied are rewritten idempotently.
  const ledger = await deps.store.get(runLedgerPath(env.firmId, env.runId));
  const priorBatchId = (ledger?.batches as Record<string, string> | undefined)?.triage;
  if (priorBatchId !== undefined) {
    const priorResults = await deps.batches.pollBatch(priorBatchId);
    const covered = new Set<string>();
    for (const result of priorResults) {
      covered.add(result.customId.replace(/^triage:/, ''));
      await applyTriageResult(deps, env, summary, result);
    }
    const stillPending = pending.filter((r) => !covered.has(r.id));
    summary.skipped += pending.length - stillPending.length;
    pending.length = 0;
    pending.push(...stillPending);
    if (pending.length === 0) {
      await writeTriageLedger(deps, env, summary);
      return summary;
    }
  }

  const requests: BatchRequest[] = [];
  for (const row of pending) {
    const text = (await deps.blobs.read(textPath(env.firmId, row.id))).toString('utf8');
    const fileName = typeof row.data.fileName === 'string' ? row.data.fileName : row.id;
    requests.push(buildTriageRequest(row.id, fileName, text));
  }
  summary.submitted = requests.length;

  const batchId = await deps.batches.submitBatch('triage', requests);
  const results = await deps.batches.pollBatch(batchId);

  for (const result of results) {
    await applyTriageResult(deps, env, summary, result);
  }

  await writeTriageLedger(deps, env, summary);
  return summary;
}

async function applyTriageResult(
  deps: TriageDeps,
  env: Env,
  summary: TriageSummary,
  result: { customId: string; ok: boolean; toolInput: DocData | undefined; error?: string },
): Promise<void> {
  const driveFileId = result.customId.replace(/^triage:/, '');
  const path = fileDocPath(env.firmId, env.runId, driveFileId);
  if (!result.ok) {
    summary.failed++;
    await deps.store.set(path, {
      docCategory: 'other',
      triageError: result.error ?? 'unknown',
      needs_human_review: true,
      needs_human_review_reasons: ['triage_failed'],
    });
    return;
  }
  const parsed = parseTriageResult(result.toolInput);
  summary.classified++;
  if (parsed.docCategory === 'trust') summary.trusts++;
  await deps.store.set(path, {
    docCategory: parsed.docCategory,
    instrumentKind: parsed.instrumentKind,
    triageConfidence: parsed.confidence,
  });
}

async function writeTriageLedger(deps: TriageDeps, env: Env, summary: TriageSummary): Promise<void> {
  await deps.store.set(runLedgerPath(env.firmId, env.runId), {
    stage: 'triage',
    status: 'completed',
    triage: { ...summary },
    updatedAt: new Date().toISOString(),
  });
}
