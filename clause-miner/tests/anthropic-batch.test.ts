import { describe, expect, it } from 'vitest';
import {
  AnthropicBatchClient,
  BATCH_PRICES_PER_MTOK,
  chargeSpend,
  costUsd,
  decodeCustomId,
  encodeCustomId,
  KillSwitchError,
  MODEL_IDS,
  SpendBreakerError,
  type AnthropicLike,
} from '../src/anthropic-batch.js';
import { config } from '../src/config.js';
import { CONTROL_DOC } from '../src/paths.js';
import { FakeDocStore } from './helpers/fakes.js';

describe('costUsd (§10 batch prices)', () => {
  it('uses the 50%-discounted batch prices', () => {
    expect(BATCH_PRICES_PER_MTOK.haiku).toEqual({ input: 0.5, output: 2.5 });
    expect(BATCH_PRICES_PER_MTOK.sonnet).toEqual({ input: 1.5, output: 7.5 });
    expect(BATCH_PRICES_PER_MTOK.opus).toEqual({ input: 2.5, output: 12.5 });
    // 1M in + 1M out on sonnet = $1.50 + $7.50.
    expect(costUsd('sonnet', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(9);
    expect(costUsd('haiku', { inputTokens: 1500, outputTokens: 200 })).toBeCloseTo(
      (1500 * 0.5 + 200 * 2.5) / 1e6,
      12,
    );
  });

  it('model aliases carry no date suffixes', () => {
    expect(MODEL_IDS.haiku).toBe('claude-haiku-4-5');
    expect(MODEL_IDS.sonnet).toBe('claude-sonnet-5');
    expect(MODEL_IDS.opus).toBe('claude-opus-5');
  });
});

describe('chargeSpend (spend breaker, §10/§15(8))', () => {
  it('accumulates daily and total spend transactionally', async () => {
    const store = new FakeDocStore();
    await chargeSpend(store, 10);
    await chargeSpend(store, 5);
    const control = store.docs.get(CONTROL_DOC);
    expect(control?.daily_spend_usd).toBe(15);
    expect(control?.total_spend_usd).toBe(15);
    expect(control?.breaker_tripped).toBeUndefined();
  });

  it('trips the $250/day breaker, persists the trip, and hard-stops', async () => {
    const store = new FakeDocStore();
    await chargeSpend(store, config.spend.dailyBreakerUsd - 1);
    await expect(chargeSpend(store, 2)).rejects.toThrow(SpendBreakerError);
    const control = store.docs.get(CONTROL_DOC);
    expect(control?.breaker_tripped).toBe(true); // persisted BEFORE the throw
    expect(control?.daily_spend_usd).toBe(config.spend.dailyBreakerUsd + 1);
  });

  it('trips the $350 pilot ceiling across days', async () => {
    const store = new FakeDocStore();
    store.docs.set(CONTROL_DOC, {
      enabled: true,
      total_spend_usd: config.spend.pilotCeilingUsd - 1,
      daily_spend_usd: 0,
      daily_spend_reset_at: new Date().toISOString(),
    });
    await expect(chargeSpend(store, 2)).rejects.toThrow(/pilot ceiling/);
  });

  it('resets the daily counter on a new day but keeps the total', async () => {
    const store = new FakeDocStore();
    store.docs.set(CONTROL_DOC, {
      enabled: true,
      daily_spend_usd: 200,
      total_spend_usd: 200,
      daily_spend_reset_at: new Date('2020-01-01').toISOString(),
    });
    await chargeSpend(store, 10);
    const control = store.docs.get(CONTROL_DOC);
    expect(control?.daily_spend_usd).toBe(10); // reset
    expect(control?.total_spend_usd).toBe(210);
  });

  it('kill switch: enabled=false throws and charges nothing', async () => {
    const store = new FakeDocStore();
    store.docs.set(CONTROL_DOC, { enabled: false });
    await expect(chargeSpend(store, 1)).rejects.toThrow(KillSwitchError);
    expect(store.docs.get(CONTROL_DOC)?.daily_spend_usd).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* AnthropicBatchClient over a fake SDK                               */
/* ------------------------------------------------------------------ */

interface FakeSdkState {
  created: Array<{ requests: Array<{ custom_id: string; params: Record<string, unknown> }> }>;
  results: unknown[];
  retrieveCount: number;
}

function fakeSdk(results: unknown[]): { sdk: AnthropicLike; state: FakeSdkState } {
  const state: FakeSdkState = { created: [], results, retrieveCount: 0 };
  const sdk: AnthropicLike = {
    messages: {
      batches: {
        async create(body) {
          state.created.push(body);
          return { id: 'msgbatch_test1' };
        },
        async retrieve(_id: string) {
          state.retrieveCount++;
          // ends on the second poll to exercise the wait loop
          return { processing_status: state.retrieveCount >= 2 ? 'ended' : 'in_progress' };
        },
        async results(_id: string) {
          return (async function* () {
            for (const r of state.results) yield r;
          })();
        },
      },
    },
  };
  return { sdk, state };
}

function succeeded(customId: string, model: string, input: number, output: number): unknown {
  return {
    custom_id: customId,
    result: {
      type: 'succeeded',
      message: {
        model,
        content: [{ type: 'tool_use', input: { verdict: 'MERGE' } }, { type: 'text', text: 'hi' }],
        usage: { input_tokens: input, output_tokens: output },
      },
    },
  };
}

describe('AnthropicBatchClient', () => {
  it('submits with forced tool use and persists the batchId to the run ledger', async () => {
    const { sdk, state } = fakeSdk([]);
    const store = new FakeDocStore();
    const client = new AnthropicBatchClient(sdk, store, 'firms/f/clauseMining/r', {
      pollIntervalMs: 1,
    });
    const batchId = await client.submitBatch('triage', [
      {
        customId: 'triage:x',
        model: 'haiku',
        maxTokens: 100,
        system: 'sys',
        userText: 'text',
        tool: { name: 't', description: 'd', input_schema: { type: 'object' } },
      },
    ]);
    expect(batchId).toBe('msgbatch_test1');
    const params = state.created[0].requests[0].params;
    expect(params.model).toBe('claude-haiku-4-5');
    expect(params.tool_choice).toEqual({ type: 'tool', name: 't' });
    const ledger = store.docs.get('firms/f/clauseMining/r');
    expect((ledger?.batches as Record<string, string>).triage).toBe('msgbatch_test1');
  });

  it('polls until ended, parses results, and charges spend per request', async () => {
    const { sdk } = fakeSdk([
      succeeded('a', 'claude-haiku-4-5', 1000, 100),
      succeeded('b', 'claude-sonnet-5', 2000, 200),
      { custom_id: 'c', result: { type: 'errored', error: { message: 'bad' } } },
    ]);
    const store = new FakeDocStore();
    const client = new AnthropicBatchClient(sdk, store, 'firms/f/clauseMining/r', {
      pollIntervalMs: 1,
    });
    const results = await client.pollBatch('msgbatch_test1');
    expect(results).toHaveLength(3);
    expect(results[0].ok).toBe(true);
    expect(results[0].toolInput).toEqual({ verdict: 'MERGE' });
    expect(results[0].text).toBe('hi');
    expect(results[2].ok).toBe(false);
    expect(results[2].error).toContain('errored');
    const expected =
      costUsd('haiku', { inputTokens: 1000, outputTokens: 100 }) +
      costUsd('sonnet', { inputTokens: 2000, outputTokens: 200 });
    const control = store.docs.get(CONTROL_DOC);
    expect(control?.total_spend_usd).toBeCloseTo(expected, 12);
  });

  it('hard-stops mid-stream when the breaker trips', async () => {
    // One result whose usage alone exceeds the daily breaker.
    const hugeTokens = Math.ceil(
      ((config.spend.dailyBreakerUsd + 1) / BATCH_PRICES_PER_MTOK.opus.output) * 1e6,
    );
    const { sdk } = fakeSdk([succeeded('a', 'claude-opus-5', 0, hugeTokens)]);
    const store = new FakeDocStore();
    const client = new AnthropicBatchClient(sdk, store, 'firms/f/clauseMining/r', {
      pollIntervalMs: 1,
    });
    await expect(client.pollBatch('msgbatch_test1')).rejects.toThrow(SpendBreakerError);
  });
});

describe('custom_id encoding (Anthropic ^[a-zA-Z0-9_-]{1,64}$)', () => {
  const realShapes = [
    'seedpiece:1AbC_dEf-9:12',
    'triage:1TuJOw7hy4xKm6EJeyFb5IYS4I6eoVk-j',
    'adj:abcdef123456-bcdef1234567',
    'pii:fam_ab12:0123456789ab',
    'label:fam_ab12',
    'cal:1AbC~2DeF',
  ];

  it('round-trips every real id shape and emits only pattern-valid ids', () => {
    for (const id of realShapes) {
      const enc = encodeCustomId(id);
      expect(enc).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(decodeCustomId(enc)).toBe(id);
    }
  });

  it('escapes literal underscores so decode cannot collide', () => {
    expect(decodeCustomId(encodeCustomId('a_c'))).toBe('a_c'); // not ':'
    expect(encodeCustomId('a_c')).not.toBe(encodeCustomId('a:'));
  });

  it('throws on ids that cannot be represented, naming the id', () => {
    expect(() => encodeCustomId('bad|id')).toThrow(/bad\|id/);
    expect(() => encodeCustomId('x'.repeat(70))).toThrow(/invalid/);
  });

  it('submitBatch sends encoded ids over the wire; results decode back', async () => {
    const { sdk, state } = fakeSdk([succeeded('seedpiece_c1Ab_uC_c12', 'claude-haiku-4-5', 10, 1)]);
    const store = new FakeDocStore();
    const client = new AnthropicBatchClient(sdk, store, 'firms/f/clauseMining/r', {
      pollIntervalMs: 1,
    });
    await client.submitBatch('seed-triage', [
      {
        customId: 'seedpiece:1Ab_C:12',
        model: 'haiku',
        maxTokens: 100,
        system: 'sys',
        userText: 'text',
        tool: { name: 't', description: 'd', input_schema: { type: 'object' } },
      },
    ]);
    const wireId = state.created[0].requests[0].custom_id;
    expect(wireId).toBe('seedpiece_c1Ab_uC_c12');
    expect(wireId).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    const results = await client.pollBatch('msgbatch_test1');
    expect(results[0].customId).toBe('seedpiece:1Ab_C:12');
  });
});

describe('submitBatchChunked (oversized create bodies get 400 terminated)', () => {
  it('splits by serialized size, persists per-chunk ledger ids, keeps bare name for chunk 0', async () => {
    const { sdk, state } = fakeSdk([]);
    const store = new FakeDocStore();
    const client = new AnthropicBatchClient(sdk, store, 'firms/f/clauseMining/r', {
      pollIntervalMs: 1,
      maxBatchBytes: 1200, // tiny ceiling: forces one request per chunk below
    });
    const req = (id: string) => ({
      customId: id,
      model: 'haiku' as const,
      maxTokens: 10,
      system: 'sys',
      userText: 'x'.repeat(600),
      tool: { name: 't', description: 'd', input_schema: { type: 'object' } },
    });
    const ids = await client.submitBatchChunked('extract', [req('a'), req('b'), req('c')]);
    expect(ids).toHaveLength(3);
    expect(state.created).toHaveLength(3);
    const ledger = store.docs.get('firms/f/clauseMining/r');
    const batches = ledger?.batches as Record<string, string>;
    expect(Object.keys(batches).sort()).toEqual(['extract', 'extract-1', 'extract-2']);
  });

  it('keeps small lists in a single batch', async () => {
    const { sdk, state } = fakeSdk([]);
    const store = new FakeDocStore();
    const client = new AnthropicBatchClient(sdk, store, 'firms/f/clauseMining/r', {
      pollIntervalMs: 1,
    });
    const ids = await client.submitBatchChunked('extract', [
      {
        customId: 'a', model: 'haiku', maxTokens: 10, system: 's', userText: 'short',
        tool: { name: 't', description: 'd', input_schema: { type: 'object' } },
      },
    ]);
    expect(ids).toHaveLength(1);
    expect(state.created).toHaveLength(1);
  });
});
