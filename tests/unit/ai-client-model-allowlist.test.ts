/**
 * tests/unit/ai-client-model-allowlist.test.ts
 *
 * Model allowlist currency + the silent-downgrade surfacing added 2026-07-30.
 *
 * Background: validateAndResolveModel quietly substitutes the provider default
 * for any model not in KNOWN_MODELS, logging only a server-side warning. That
 * left the app pinned a full generation behind (a firm typing 'claude-sonnet-5'
 * silently got 'claude-sonnet-4-6'). These tests pin the current-generation
 * IDs into the allowlist and cover resolveRequestedModel, the pre-flight
 * helper unified-generator uses to attach a visible document warning when a
 * fallback happens.
 */

import { describe, it, expect } from 'vitest';
import {
  validateAndResolveModel,
  resolveRequestedModel,
  inferProviderFromModel,
} from '../../functions/src/ai-client';

describe('current-generation models are in the allowlist (no silent downgrade)', () => {
  const CURRENT: Array<[string, string]> = [
    // [model, provider]
    ['claude-sonnet-5', 'anthropic'],
    ['claude-opus-5', 'anthropic'],
    ['claude-fable-5', 'anthropic'],
    ['claude-haiku-4-5-20251001', 'anthropic'],
    ['gpt-5.6', 'openai'],
    ['gpt-5.6-sol', 'openai'],
    ['gpt-5.6-terra', 'openai'],
    ['gpt-5.6-luna', 'openai'],
    ['gemini-3.6-flash', 'gemini'],
    ['gemini-3.5-flash', 'gemini'],
    ['sonar-pro', 'perplexity'],
  ];

  for (const [model, provider] of CURRENT) {
    it(`${model} passes through unchanged`, () => {
      expect(validateAndResolveModel(model, provider)).toBe(model);
    });
  }

  it('previous-generation models remain valid (firms may have pinned them)', () => {
    expect(validateAndResolveModel('claude-sonnet-4-6', 'anthropic')).toBe('claude-sonnet-4-6');
    expect(validateAndResolveModel('gpt-5.4', 'openai')).toBe('gpt-5.4');
    expect(validateAndResolveModel('gemini-2.5-flash', 'gemini')).toBe('gemini-2.5-flash');
  });

  it('unknown models fall back to the current-generation defaults', () => {
    expect(validateAndResolveModel('claude-nonexistent', 'anthropic')).toBe('claude-sonnet-5');
    expect(validateAndResolveModel('gpt-99', 'openai')).toBe('gpt-5.6');
    expect(validateAndResolveModel('gemini-99', 'gemini')).toBe('gemini-3.5-flash');
  });
});

describe('inferProviderFromModel — mirrors callAI dispatch', () => {
  it('routes each family to its provider', () => {
    expect(inferProviderFromModel('claude-sonnet-5')).toBe('anthropic');
    expect(inferProviderFromModel('claude-fable-5')).toBe('anthropic');
    expect(inferProviderFromModel('gpt-5.6-terra')).toBe('openai');
    expect(inferProviderFromModel('gemini-3.5-flash')).toBe('gemini');
    expect(inferProviderFromModel('sonar-pro')).toBe('perplexity');
    expect(inferProviderFromModel('o3-mini')).toBe('openai');
  });
});

describe('resolveRequestedModel — pre-flight for the document warning', () => {
  it('reports a supported model as supported', () => {
    expect(resolveRequestedModel('claude-opus-5')).toEqual({
      provider: 'anthropic',
      resolved: 'claude-opus-5',
      supported: true,
    });
  });

  it('reports the substitution for an unsupported model', () => {
    const result = resolveRequestedModel('claude-sonnet-6-experimental');
    expect(result.supported).toBe(false);
    expect(result.provider).toBe('anthropic');
    expect(result.resolved).toBe('claude-sonnet-5');
  });
});
