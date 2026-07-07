/**
 * tests/unit/wills-extractor-validation.test.ts
 *
 * Regression test for R5-062: the wills-extractor stored the model's tool output
 * with ZERO validation. A max_tokens truncation yields partial/invalid tool
 * input, yet it was persisted as a valid extraction — and despite a "Step 9:
 * Validate schema" header, required fields were never checked.
 *
 * The fix guards three failure modes in `_attempt`, each retrying ONCE and then
 * stubbing (a stub = extraction_confidence 0 + type_fields null, which
 * extractionNeedsReview flags for a human):
 *   1. response.stop_reason === 'max_tokens'  (truncated)
 *   2. no tool_use block in the response      (schema failure)
 *   3. a declared required field is missing    (incomplete input)
 *
 * The Anthropic SDK is mocked so each test queues the exact responses the
 * handler should see across its (up to two) attempts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  responses: [] as unknown[],
  calls: 0,
}));

vi.mock('../../functions/node_modules/@anthropic-ai/sdk', () => ({
  default: class {
    constructor(_opts: unknown) {}
    messages = {
      create: async () => {
        state.calls++;
        if (state.responses.length === 0) throw new Error('no queued Anthropic response');
        return state.responses.shift();
      },
    };
  },
}));

import { extract, extractionNeedsReview } from '../../functions/src/wills-extractor';

// Every field the 'Will' tool declares required (type fields + the four shared
// confidence fields). Validation checks PRESENCE only, so null/[]/false satisfy it.
const FULL_WILL_INPUT: Record<string, unknown> = {
  testator_name: 'Jane Doe',
  executor_name: 'John Doe',
  executor_alternates: [],
  witnesses: [],
  execution_date: null,
  governing_law: 'New Jersey',
  is_executed: true,
  has_self_proving_affidavit: false,
  has_no_contest_clause: false,
  has_pour_over_provision: false,
  referenced_trust_name: null,
  referenced_trust_date: null,
  trust_structures: [],
  beneficiary_categories: [],
  guardian_name: null,
  is_holographic: false,
  has_residuary_clause: true,
  estimated_estate_complexity: 'simple',
  notable_clauses: [],
  extraction_confidence: 0.9,
  field_confidence: { testator_name: 0.95 },
  needs_human_review: false,
  needs_human_review_reasons: [],
};

const truncated = () => ({ stop_reason: 'max_tokens', content: [] });
const noToolUse = () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'sorry' }] });
const toolUse = (input: Record<string, unknown>) => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', name: 'extract_will', input }],
});

describe('wills-extractor extract() — validates tool output before storing (R5-062)', () => {
  beforeEach(() => {
    state.responses = [];
    state.calls = 0;
  });

  it('a complete first-attempt extraction is stored without a retry', async () => {
    state.responses = [toolUse(FULL_WILL_INPUT)];
    const result = await extract('will text', 'Will', 'key');

    expect(state.calls).toBe(1);
    expect(result.type_fields).not.toBeNull();
    expect((result.type_fields as Record<string, unknown>).testator_name).toBe('Jane Doe');
    expect(result.extraction_confidence).toBe(0.9);
    // Confidence fields are stripped from the stored type-specific payload.
    expect('extraction_confidence' in (result.type_fields as object)).toBe(false);
  });

  it('a max_tokens truncation retries once, then stubs → needs human review', async () => {
    state.responses = [truncated(), truncated()];
    const result = await extract('will text', 'Will', 'key');

    expect(state.calls).toBe(2);
    expect(result.type_fields).toBeNull();
    expect(result.extraction_confidence).toBe(0);
    expect(extractionNeedsReview(result, [])).toBe(true);
  });

  it('a truncation that succeeds on retry returns the retry’s extraction', async () => {
    state.responses = [truncated(), toolUse(FULL_WILL_INPUT)];
    const result = await extract('will text', 'Will', 'key');

    expect(state.calls).toBe(2);
    expect(result.type_fields).not.toBeNull();
    expect(result.extraction_confidence).toBe(0.9);
  });

  it('tool output missing a required field retries once, then stubs', async () => {
    const missing = { ...FULL_WILL_INPUT };
    delete missing.executor_name;
    state.responses = [toolUse(missing), toolUse(missing)];
    const result = await extract('will text', 'Will', 'key');

    expect(state.calls).toBe(2);
    expect(result.type_fields).toBeNull();
    expect(result.extraction_confidence).toBe(0);
  });

  it('a missing required field is recovered when the retry returns a complete object', async () => {
    const missing = { ...FULL_WILL_INPUT };
    delete missing.executor_name;
    state.responses = [toolUse(missing), toolUse(FULL_WILL_INPUT)];
    const result = await extract('will text', 'Will', 'key');

    expect(state.calls).toBe(2);
    expect(result.type_fields).not.toBeNull();
  });

  it('a response with no tool_use block retries once, then stubs', async () => {
    state.responses = [noToolUse(), noToolUse()];
    const result = await extract('will text', 'Will', 'key');

    expect(state.calls).toBe(2);
    expect(result.type_fields).toBeNull();
    expect(result.extraction_confidence).toBe(0);
  });
});
