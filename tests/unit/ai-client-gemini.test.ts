/**
 * tests/unit/ai-client-gemini.test.ts
 *
 * Regression test for R5-046: _callGemini (reached via callAI's provider
 * dispatch) must
 *   (a) concatenate the text of ALL candidate parts — google_search grounding
 *       commonly splits an answer across multiple parts, so parts[0] alone
 *       silently drops the rest of the document; and
 *   (b) mirror the OpenAI/Anthropic MAX_TOKENS handling — a truncated response
 *       in JSON mode is invalid JSON downstream, so it must throw rather than
 *       return half an object.
 *
 * We exercise the real callAI (untouched provider dispatch) with a stubbed
 * global fetch standing in for the Gemini REST endpoint.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('firebase-admin', () => ({
  firestore: Object.assign(() => ({}), { DocumentData: {} }),
  initializeApp: vi.fn(),
}));

import { callAI } from '../../functions/src/ai-client';

const FIRM = { geminiApiKey: 'test-key' } as Record<string, unknown>;

function mockGeminiResponse(body: unknown) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => '',
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ai-client — Gemini multi-part / truncation (R5-046)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('concatenates all candidate text parts, not just parts[0]', async () => {
    mockGeminiResponse({
      candidates: [
        {
          content: {
            parts: [
              { text: 'ARTICLE I. ' },
              { text: 'ARTICLE II. ' },
              { text: 'ARTICLE III.' },
            ],
          },
          finishReason: 'STOP',
        },
      ],
    });

    const result = await callAI('sys', 'user', FIRM, { model: 'gemini-2.5-flash' });
    expect(result).toBe('ARTICLE I. ARTICLE II. ARTICLE III.');
  });

  it('throws on finishReason=MAX_TOKENS in JSON mode', async () => {
    mockGeminiResponse({
      candidates: [
        { content: { parts: [{ text: '{"partial":' }] }, finishReason: 'MAX_TOKENS' },
      ],
    });

    await expect(
      callAI('sys', 'user', FIRM, { model: 'gemini-2.5-flash', jsonMode: true }),
    ).rejects.toThrow(/MAX_TOKENS/);
  });

  it('does not throw on MAX_TOKENS in prose mode (returns the partial text)', async () => {
    mockGeminiResponse({
      candidates: [
        { content: { parts: [{ text: 'partial prose' }] }, finishReason: 'MAX_TOKENS' },
      ],
    });

    const result = await callAI('sys', 'user', FIRM, { model: 'gemini-2.5-flash' });
    expect(result).toBe('partial prose');
  });
});
