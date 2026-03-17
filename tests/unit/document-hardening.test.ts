/**
 * tests/unit/document-hardening.test.ts
 *
 * Unit tests for document generation hardening:
 * - parseAIJson handles edge cases (markdown fences, preamble, truncation)
 * - Model validation allowlist resolves correctly and falls back on unknown
 * - Content quality checks: empty content detection, unresolved variables,
 *   raw JSON leakage in generated documents
 */

import { describe, it, expect } from 'vitest';

// ============================================================================
// SECTION 1: parseAIJson robustness
// ============================================================================

// We import the function directly from the source — these are pure functions
// that don't depend on Firebase admin.
import { parseAIJson } from '../../functions/src/ai-client';

describe('parseAIJson — edge case handling', () => {
  it('parses clean JSON object', () => {
    const result = parseAIJson<{ title: string }>('{"title": "test"}');
    expect(result.title).toBe('test');
  });

  it('strips markdown json code fences', () => {
    const raw = '```json\n{"title": "fenced"}\n```';
    const result = parseAIJson<{ title: string }>(raw);
    expect(result.title).toBe('fenced');
  });

  it('strips markdown code fences without language hint', () => {
    const raw = '```\n{"title": "bare fence"}\n```';
    const result = parseAIJson<{ title: string }>(raw);
    expect(result.title).toBe('bare fence');
  });

  it('handles CRLF line endings in fences', () => {
    const raw = '```json\r\n{"title": "crlf"}\r\n```';
    const result = parseAIJson<{ title: string }>(raw);
    expect(result.title).toBe('crlf');
  });

  it('extracts JSON from preamble text', () => {
    const raw = 'Here is the document:\n\n{"title": "after preamble", "content": "<h1>Doc</h1>"}';
    const result = parseAIJson<{ title: string; content: string }>(raw);
    expect(result.title).toBe('after preamble');
    expect(result.content).toContain('<h1>');
  });

  it('throws on completely non-JSON input', () => {
    expect(() => parseAIJson('This is just plain text with no JSON at all.')).toThrow(
      /Failed to parse AI JSON/,
    );
  });

  it('throws on empty string', () => {
    expect(() => parseAIJson('')).toThrow(/Failed to parse AI JSON/);
  });

  it('handles JSON array input', () => {
    const raw = '[{"name": "item1"}, {"name": "item2"}]';
    const result = parseAIJson<Array<{ name: string }>>(raw);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('item1');
  });

  it('recovers truncated detectedVariables JSON', () => {
    // Simulate truncated AI output for template variable detection
    const raw = `{"suggestedDocType": "will", "documentSummary": "A will", "suggestedTags": ["estate"], "detectedVariables": [{"originalText": "John Doe", "suggestedVariable": "personalInfo.firstName"}, {"originalText": "Jane Doe", "suggestedVariable": "spouseInfo.firstName"}, {"originalText": "123 Main St`;
    const result = parseAIJson<{ detectedVariables: unknown[] }>(raw);
    expect(result.detectedVariables).toHaveLength(2);
  });
});

// ============================================================================
// SECTION 2: Model name validation
// ============================================================================

import { validateAndResolveModel } from '../../functions/src/ai-client';

describe('validateAndResolveModel — model allowlist', () => {
  it('accepts known OpenAI models', () => {
    expect(validateAndResolveModel('gpt-4.1', 'openai')).toBe('gpt-4.1');
    expect(validateAndResolveModel('gpt-5.4', 'openai')).toBe('gpt-5.4');
    expect(validateAndResolveModel('o3-mini', 'openai')).toBe('o3-mini');
  });

  it('accepts known Anthropic models', () => {
    expect(validateAndResolveModel('claude-sonnet-4-6', 'anthropic')).toBe('claude-sonnet-4-6');
    expect(validateAndResolveModel('claude-3.5-sonnet', 'anthropic')).toBe('claude-3.5-sonnet');
  });

  it('accepts known Gemini models', () => {
    expect(validateAndResolveModel('gemini-2.5-flash', 'gemini')).toBe('gemini-2.5-flash');
    expect(validateAndResolveModel('gemini-2.5-pro', 'gemini')).toBe('gemini-2.5-pro');
  });

  it('accepts known Perplexity models', () => {
    expect(validateAndResolveModel('sonar-pro', 'perplexity')).toBe('sonar-pro');
  });

  it('falls back on unknown OpenAI model', () => {
    const result = validateAndResolveModel('gpt-99-turbo', 'openai');
    expect(result).toBe('gpt-4.1'); // OpenAI default
  });

  it('falls back on unknown Anthropic model', () => {
    const result = validateAndResolveModel('claude-99', 'anthropic');
    expect(result).toBe('claude-sonnet-4-6'); // Anthropic default
  });

  it('falls back on unknown Gemini model', () => {
    const result = validateAndResolveModel('gemini-99', 'gemini');
    expect(result).toBe('gemini-2.5-flash'); // Gemini default
  });

  it('falls back on unknown Perplexity model', () => {
    const result = validateAndResolveModel('sonar-99', 'perplexity');
    expect(result).toBe('sonar-pro'); // Perplexity default
  });

  it('returns model as-is for unknown provider', () => {
    const result = validateAndResolveModel('some-model', 'unknown-provider');
    expect(result).toBe('some-model');
  });
});

// ============================================================================
// SECTION 3: Content quality validation helpers
// ============================================================================

/**
 * Checks if HTML content has meaningful text (not just empty tags).
 * Mirrors the logic added to document-save-helper.ts.
 */
function hasRealTextContent(html: string): boolean {
  const textOnly = html.replace(/<[^>]*>/g, '').trim();
  return textOnly.length > 0;
}

/**
 * Detects unresolved Handlebars variables in generated content.
 */
function hasUnresolvedVariables(html: string): boolean {
  return /\{\{[^}]+\}\}/.test(html);
}

/**
 * Detects raw JSON artifacts leaked into document content.
 * (Indicates the AI response wasn't properly parsed.)
 */
function hasRawJsonArtifact(html: string): boolean {
  // Look for JSON object patterns that shouldn't be in legal document HTML
  return /^\s*\{[\s\S]*"title"\s*:/.test(html) || /^\s*\{[\s\S]*"content"\s*:/.test(html);
}

/**
 * Checks if content meets minimum length requirements for a legal document.
 */
function meetsMinimumLength(html: string, minChars = 100): boolean {
  const textOnly = html.replace(/<[^>]*>/g, '').trim();
  return textOnly.length >= minChars;
}

describe('Content quality — hasRealTextContent', () => {
  it('detects empty string as no content', () => {
    expect(hasRealTextContent('')).toBe(false);
  });

  it('detects whitespace-only as no content', () => {
    expect(hasRealTextContent('   \n\t  ')).toBe(false);
  });

  it('detects empty HTML tags as no content', () => {
    expect(hasRealTextContent('<p></p>')).toBe(false);
    expect(hasRealTextContent('<div><p>  </p></div>')).toBe(false);
    expect(hasRealTextContent('<h1></h1><p></p>')).toBe(false);
  });

  it('accepts content with real text', () => {
    expect(hasRealTextContent('<h1>Last Will and Testament</h1><p>I, John Doe, hereby declare...</p>')).toBe(true);
  });

  it('accepts content with text but no HTML tags', () => {
    expect(hasRealTextContent('Plain text document content')).toBe(true);
  });
});

describe('Content quality — hasUnresolvedVariables', () => {
  it('detects {{variable}} patterns', () => {
    expect(hasUnresolvedVariables('<p>Dear {{personalInfo.firstName}},</p>')).toBe(true);
  });

  it('detects multiple unresolved variables', () => {
    expect(hasUnresolvedVariables('{{name}} lives at {{address}}')).toBe(true);
  });

  it('does not flag content without variables', () => {
    expect(hasUnresolvedVariables('<p>Dear John Doe,</p>')).toBe(false);
  });

  it('does not flag curly braces in CSS', () => {
    // Single curly braces (CSS) should not trigger
    expect(hasUnresolvedVariables('<style>p { margin: 0; }</style>')).toBe(false);
  });
});

describe('Content quality — hasRawJsonArtifact', () => {
  it('detects raw JSON with title field', () => {
    const raw = '{"title": "Last Will", "content": "<h1>Will</h1>"}';
    expect(hasRawJsonArtifact(raw)).toBe(true);
  });

  it('does not flag normal HTML content', () => {
    const html = '<h1>Last Will and Testament</h1><p>Article I. Identification.</p>';
    expect(hasRawJsonArtifact(html)).toBe(false);
  });

  it('does not flag HTML that mentions "title" in text', () => {
    const html = '<p>The title of this document is "Last Will".</p>';
    expect(hasRawJsonArtifact(html)).toBe(false);
  });
});

describe('Content quality — meetsMinimumLength', () => {
  it('rejects content below minimum length', () => {
    expect(meetsMinimumLength('<p>Too short</p>', 100)).toBe(false);
  });

  it('accepts content at minimum length', () => {
    const longContent = '<p>' + 'A'.repeat(100) + '</p>';
    expect(meetsMinimumLength(longContent, 100)).toBe(true);
  });

  it('strips HTML when measuring length', () => {
    // 50 chars of tags + 10 chars of text = should fail at 100 min
    const html = '<div class="very-long-attribute-name"><p>Short text</p></div>';
    expect(meetsMinimumLength(html, 100)).toBe(false);
  });

  it('uses default minimum of 100 chars', () => {
    const short = '<p>Hello</p>';
    expect(meetsMinimumLength(short)).toBe(false);
  });
});
