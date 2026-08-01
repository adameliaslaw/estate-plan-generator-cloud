/**
 * Thin Anthropic Message Batches client (§3: all LLM stages run through the
 * Batches API — 50% price reduction, immune to ITPM limits; SDK used
 * directly, as wills-classifier.ts does, not ai-client.ts's dispatch).
 *
 * Spend accounting: every result's usage is charged transactionally against
 * clause_mining_state/control, mirroring wills-processor._chargeDailySpend
 * (functions/src/wills-processor.ts:381) — but unlike the wills pipeline the
 * breaker here HARD-STOPS the run (throws) instead of logging, per §10/§15(8):
 * $250/day breaker, $350 pilot ceiling, kill switch.
 *
 * ANTHROPIC_API_KEY comes from the environment (Cloud Run secret mount —
 * see README.md). Tests inject a fake AnthropicLike; no network.
 */

import { config } from './config.js';
import { CONTROL_DOC } from './paths.js';
import type {
  BatchClient,
  BatchModel,
  BatchRequest,
  BatchResultItem,
  BatchUsage,
  DocData,
  DocStore,
} from './clients/interfaces.js';

/** Batch (50%-discounted) prices per MTok — §10 cost table. */
export const BATCH_PRICES_PER_MTOK: Record<BatchModel, { input: number; output: number }> = {
  haiku: { input: 0.5, output: 2.5 },
  sonnet: { input: 1.5, output: 7.5 },
  opus: { input: 2.5, output: 12.5 },
};

/** Model aliases (exact IDs per the Anthropic model catalog — no date suffixes). */
export const MODEL_IDS: Record<BatchModel, string> = {
  haiku: 'claude-haiku-4-5',
  sonnet: 'claude-sonnet-5',
  opus: 'claude-opus-5',
};

export function costUsd(model: BatchModel, usage: BatchUsage): number {
  const p = BATCH_PRICES_PER_MTOK[model];
  return (usage.inputTokens * p.input + usage.outputTokens * p.output) / 1_000_000;
}

export class SpendBreakerError extends Error {}
export class KillSwitchError extends Error {}

/**
 * Transactionally charge spend against clause_mining_state/control.
 * Writes the increment (and `breaker_tripped` when a limit is crossed)
 * BEFORE throwing, so the tripped state survives the hard stop.
 */
export async function chargeSpend(store: DocStore, amountUsd: number): Promise<void> {
  let tripped: string | null = null;
  let killed = false;
  await store.transact(CONTROL_DOC, (current) => {
    const d = current ?? {};
    if (d.enabled === false) {
      killed = true;
      return d as DocData;
    }
    const now = new Date();
    const resetAtRaw = typeof d.daily_spend_reset_at === 'string' ? d.daily_spend_reset_at : null;
    const resetAt = resetAtRaw !== null ? new Date(resetAtRaw) : null;
    const isNewDay = resetAt === null || now.toDateString() !== resetAt.toDateString();
    const prevDaily = typeof d.daily_spend_usd === 'number' && !isNewDay ? d.daily_spend_usd : 0;
    const prevTotal = typeof d.total_spend_usd === 'number' ? d.total_spend_usd : 0;
    const newDaily = prevDaily + amountUsd;
    const newTotal = prevTotal + amountUsd;
    const update: DocData = {
      enabled: d.enabled ?? true,
      daily_spend_usd: newDaily,
      total_spend_usd: newTotal,
      ...(isNewDay ? { daily_spend_reset_at: now.toISOString() } : {}),
    };
    if (newDaily > config.spend.dailyBreakerUsd) {
      tripped = `daily breaker: $${newDaily.toFixed(2)} > $${config.spend.dailyBreakerUsd}/day`;
    } else if (newTotal > config.spend.pilotCeilingUsd) {
      tripped = `pilot ceiling: $${newTotal.toFixed(2)} > $${config.spend.pilotCeilingUsd}`;
    }
    if (tripped !== null) update.breaker_tripped = true;
    return update;
  });
  if (killed) {
    throw new KillSwitchError('clause_mining_state/control.enabled=false — kill switch active');
  }
  if (tripped !== null) {
    throw new SpendBreakerError(`Spend breaker tripped (${tripped}) — hard stop`);
  }
}

/* ------------------------------------------------------------------ */
/* Minimal structural view of the Anthropic SDK surface we use.       */
/* The real `Anthropic` client satisfies this; tests supply a fake.   */
/* ------------------------------------------------------------------ */

export interface AnthropicLike {
  messages: {
    batches: {
      create(body: {
        requests: Array<{ custom_id: string; params: Record<string, unknown> }>;
      }): Promise<{ id: string }>;
      retrieve(id: string): Promise<{ processing_status: string }>;
      results(id: string): Promise<AsyncIterable<unknown>>;
    };
  };
}

function toParams(req: BatchRequest): Record<string, unknown> {
  const params: Record<string, unknown> = {
    model: MODEL_IDS[req.model],
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [{ role: 'user', content: req.userText }],
  };
  if (req.tool !== undefined) {
    params.tools = [req.tool];
    params.tool_choice = { type: 'tool', name: req.tool.name };
  }
  return params;
}

function modelFromId(modelId: string): BatchModel {
  if (modelId.includes('haiku')) return 'haiku';
  if (modelId.includes('sonnet')) return 'sonnet';
  // Conservative default: bill unknown models at the highest tier.
  return 'opus';
}

/**
 * Anthropic requires batch custom_id to match ^[a-zA-Z0-9_-]{1,64}$. Stage
 * code uses richer ids ('seedpiece:driveId:3', pair ids with '~'), so the
 * translation lives HERE, at the one API boundary, as a bijective escape:
 * '_'→'_u', ':'→'_c', '~'→'_t'. Every literal underscore is escaped, so any
 * '_x' pair in an encoded id is unambiguously an escape — decode cannot
 * collide with real id content. Anything still outside the allowed set (or
 * over 64 chars) throws with the offending id named: a silently truncated or
 * mangled id would misroute results to the wrong document.
 */
export function encodeCustomId(id: string): string {
  const encoded = id.replace(/_/g, '_u').replace(/:/g, '_c').replace(/~/g, '_t');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(encoded)) {
    throw new Error(`customId ${JSON.stringify(id)} encodes to invalid custom_id ${JSON.stringify(encoded)}`);
  }
  return encoded;
}

export function decodeCustomId(encoded: string): string {
  return encoded.replace(/_(u|c|t)/g, (_, ch: string) =>
    ch === 'u' ? '_' : ch === 'c' ? ':' : '~',
  );
}

interface RawResultShape {
  custom_id?: unknown;
  result?: {
    type?: unknown;
    message?: {
      model?: unknown;
      content?: unknown;
      usage?: { input_tokens?: unknown; output_tokens?: unknown };
    };
    error?: unknown;
  };
}

function parseResult(raw: unknown): { item: BatchResultItem; model: BatchModel } {
  const r = raw as RawResultShape;
  const customId = typeof r.custom_id === 'string' ? decodeCustomId(r.custom_id) : '';
  const type = r.result?.type;
  if (type !== 'succeeded') {
    return {
      item: {
        customId,
        ok: false,
        toolInput: undefined,
        text: undefined,
        usage: undefined,
        error: typeof type === 'string' ? `${type}: ${JSON.stringify(r.result?.error ?? null)}` : 'unknown',
      },
      model: 'opus',
    };
  }
  const message = r.result?.message;
  const usageRaw = message?.usage;
  const usage: BatchUsage = {
    inputTokens: typeof usageRaw?.input_tokens === 'number' ? usageRaw.input_tokens : 0,
    outputTokens: typeof usageRaw?.output_tokens === 'number' ? usageRaw.output_tokens : 0,
  };
  let toolInput: DocData | undefined;
  let text: string | undefined;
  if (Array.isArray(message?.content)) {
    for (const block of message.content as Array<Record<string, unknown>>) {
      if (block.type === 'tool_use' && toolInput === undefined) {
        toolInput = (block.input ?? {}) as DocData;
      }
      if (block.type === 'text' && typeof block.text === 'string') {
        text = (text ?? '') + block.text;
      }
    }
  }
  return {
    item: { customId, ok: true, toolInput, text, usage, error: undefined },
    model: modelFromId(typeof message?.model === 'string' ? message.model : ''),
  };
}

export interface AnthropicBatchClientOpts {
  pollIntervalMs?: number;
  maxWaitMs?: number;
  /** Chunk ceiling for submitBatchChunked; override in tests. */
  maxBatchBytes?: number;
}

/**
 * Conservative ceiling on one batch-create body. The API's documented cap is
 * far higher, but the edge terminates very large uploads with an empty
 * '400 terminated' (observed on the corpus extract submit) — so oversized
 * request lists are split into several batches well below the edge limit.
 */
export const MAX_BATCH_BYTES = 30 * 1024 * 1024;

export class AnthropicBatchClient implements BatchClient {
  private readonly pollIntervalMs: number;
  private readonly maxWaitMs: number;
  private readonly maxBatchBytes: number;

  constructor(
    private readonly anthropic: AnthropicLike,
    private readonly store: DocStore,
    private readonly runLedgerDocPath: string,
    opts: AnthropicBatchClientOpts = {},
  ) {
    this.pollIntervalMs = opts.pollIntervalMs ?? 30_000;
    // Batches are guaranteed within 24 h (§10).
    this.maxWaitMs = opts.maxWaitMs ?? 24 * 60 * 60 * 1000;
    this.maxBatchBytes = opts.maxBatchBytes ?? MAX_BATCH_BYTES;
  }

  async submitBatch(name: string, requests: BatchRequest[]): Promise<string> {
    if (requests.length === 0) throw new Error(`submitBatch(${name}): empty request list`);
    const created = await this.anthropic.messages.batches.create({
      requests: requests.map((req) => ({ custom_id: encodeCustomId(req.customId), params: toParams(req) })),
    });
    // Persist the batchId to the run ledger before returning (§3 resumability).
    await this.store.set(this.runLedgerDocPath, { batches: { [name]: created.id } });
    return created.id;
  }

  async submitBatchChunked(name: string, requests: BatchRequest[]): Promise<string[]> {
    if (requests.length === 0) throw new Error(`submitBatchChunked(${name}): empty request list`);
    const maxBytes = this.maxBatchBytes;
    const chunks: BatchRequest[][] = [];
    let current: BatchRequest[] = [];
    let currentBytes = 0;
    for (const req of requests) {
      const bytes = JSON.stringify(toParams(req)).length + 200;
      if (current.length > 0 && currentBytes + bytes > maxBytes) {
        chunks.push(current);
        current = [];
        currentBytes = 0;
      }
      current.push(req);
      currentBytes += bytes;
    }
    if (current.length > 0) chunks.push(current);

    const ids: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      // First chunk keeps the bare name so single-batch ledgers stay readable.
      const chunkName = i === 0 ? name : `${name}-${i}`;
      ids.push(await this.submitBatch(chunkName, chunks[i]));
    }
    return ids;
  }

  async pollBatch(batchId: string): Promise<BatchResultItem[]> {
    const deadline = Date.now() + this.maxWaitMs;
    for (;;) {
      const batch = await this.anthropic.messages.batches.retrieve(batchId);
      if (batch.processing_status === 'ended') break;
      if (Date.now() > deadline) {
        throw new Error(`Batch ${batchId} did not end within ${this.maxWaitMs} ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
    const items: BatchResultItem[] = [];
    const stream = await this.anthropic.messages.batches.results(batchId);
    for await (const raw of stream) {
      const { item, model } = parseResult(raw);
      if (item.usage !== undefined) {
        // Transactional per-request spend charge; throws on breaker trip.
        await chargeSpend(this.store, costUsd(model, item.usage));
      }
      items.push(item);
    }
    return items;
  }
}
