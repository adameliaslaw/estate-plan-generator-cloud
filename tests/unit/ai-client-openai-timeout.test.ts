/**
 * tests/unit/ai-client-openai-timeout.test.ts
 *
 * Regression test for finding T: the OpenAI provider path goes through the
 * openai SDK, NOT through fetchWithRetry/LONG_REQUEST_AGENT like the other
 * three providers. The SDK's Node runtime uses node-fetch with a default
 * agent whose socket-inactivity timeout is 5 minutes — a non-streaming chat
 * completion sends no bytes until the whole response is ready, so any OpenAI
 * generation slower than 5 minutes had its socket destroyed (and every SDK
 * retry died identically).
 *
 * The fix passes an explicit `httpAgent` with the same 10-minute budget as
 * the raw-fetch providers. This test exercises the real callAI provider
 * dispatch with a mocked openai module and asserts the constructor receives
 * that agent.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin', () => ({
  firestore: Object.assign(() => ({}), { DocumentData: {} }),
  initializeApp: vi.fn(),
}));

const constructorOpts = vi.hoisted(() => [] as Array<Record<string, unknown>>);

// ai-client resolves `openai` through functions/node_modules, so mock the
// resolved entry points (both module formats), not the bare specifier.
// Factories are inlined: vi.mock hoists above any const it would share.
vi.mock('../../functions/node_modules/openai/index.mjs', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: vi.fn(async () => ({
          choices: [{ message: { content: 'draft text' }, finish_reason: 'stop' }],
        })),
      },
    };
    constructor(opts: Record<string, unknown>) {
      constructorOpts.push(opts);
    }
  },
}));
vi.mock('../../functions/node_modules/openai/index.js', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: vi.fn(async () => ({
          choices: [{ message: { content: 'draft text' }, finish_reason: 'stop' }],
        })),
      },
    };
    constructor(opts: Record<string, unknown>) {
      constructorOpts.push(opts);
    }
  },
}));

import { callAI } from '../../functions/src/ai-client';

const TEN_MINUTES_MS = 10 * 60 * 1000;

describe('ai-client — OpenAI SDK long-request agent (finding T)', () => {
  it('constructs the OpenAI client with a >=10-minute socket-timeout agent', async () => {
    const result = await callAI(
      'system prompt',
      'user prompt',
      { openAiApiKey: 'test-key', activeAiProvider: 'openai' },
      {},
    );

    expect(result).toBe('draft text');
    expect(constructorOpts.length).toBeGreaterThan(0);

    const opts = constructorOpts[0];
    // Pre-fix: `new OpenAI({ apiKey })` — no httpAgent, so the SDK fell back
    // to its default 5-minute-socket-timeout keepalive agent.
    const agent = opts.httpAgent as { options?: { timeout?: number; keepAlive?: boolean } } | undefined;
    expect(agent).toBeDefined();
    expect(agent?.options?.timeout).toBeGreaterThanOrEqual(TEN_MINUTES_MS);
    expect(agent?.options?.keepAlive).toBe(true);
  });
});
