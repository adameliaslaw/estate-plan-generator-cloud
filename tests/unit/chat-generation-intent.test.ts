/**
 * tests/unit/chat-generation-intent.test.ts
 *
 * Regression tests for R5-048 + R5-049 — the chat's document-generation intent
 * detection, which used to fire on bare affirmatives, negations, and the mere
 * SHAPE of a formatted reply, silently saving documents the attorney didn't ask
 * for. The fix (context-aware confirm):
 *   - explicit requests generate immediately;
 *   - a bare "yes/go ahead" generates ONLY if the assistant just offered;
 *   - any negation suppresses;
 *   - the doc type named in the message overrides the dropdown;
 *   - the AI reply must EXPLICITLY signal generation (JSON) — reply shape no
 *     longer counts.
 */

import { describe, it, expect } from 'vitest';
import {
  detectUserGenerationIntent,
  detectGenerationIntent,
  docTypeFromMessage,
} from '../../functions/src/chat-ai';

const offer = [{ role: 'assistant', content: 'Want me to generate the will now?' }];
const question = [{ role: 'assistant', content: 'Should this will include a no-contest clause?' }];

describe('detectUserGenerationIntent — explicit requests (R5-048)', () => {
  it('generates on an explicit request', () => {
    expect(detectUserGenerationIntent('draft the will').shouldGenerate).toBe(true);
    expect(detectUserGenerationIntent("let's generate the trust").shouldGenerate).toBe(true);
  });

  it('carries the doc type named in the message', () => {
    expect(detectUserGenerationIntent('draft the trust')).toMatchObject({ shouldGenerate: true, docType: 'trust' });
    expect(detectUserGenerationIntent('generate a power of attorney')).toMatchObject({ shouldGenerate: true, docType: 'poa' });
  });
});

describe('detectUserGenerationIntent — bare affirmatives require an offer (R5-048)', () => {
  it('generates on "yes" only when the assistant just offered', () => {
    expect(detectUserGenerationIntent('yes', offer).shouldGenerate).toBe(true);
    expect(detectUserGenerationIntent('go ahead', offer).shouldGenerate).toBe(true);
  });

  it('does NOT generate on "yes" answering an ordinary question', () => {
    expect(detectUserGenerationIntent('yes', question).shouldGenerate).toBe(false);
  });

  it('does NOT generate on a bare affirmative with no history', () => {
    expect(detectUserGenerationIntent('yes').shouldGenerate).toBe(false);
    expect(detectUserGenerationIntent('perfect').shouldGenerate).toBe(false);
  });

  it('does NOT fire on an affirmative buried in a longer clause', () => {
    expect(detectUserGenerationIntent('yes, but change the executor first', offer).shouldGenerate).toBe(false);
  });
});

describe('detectUserGenerationIntent — negation guard (R5-048)', () => {
  it('suppresses generation on a negation', () => {
    expect(detectUserGenerationIntent("don't draft it yet").shouldGenerate).toBe(false);
    expect(detectUserGenerationIntent('not ready to draft the will').shouldGenerate).toBe(false);
    expect(detectUserGenerationIntent('no', offer).shouldGenerate).toBe(false);
  });

  it('does NOT treat "no-contest clause" mid-sentence as a negation', () => {
    expect(detectUserGenerationIntent('draft the will with a no-contest clause').shouldGenerate).toBe(true);
  });
});

describe('docTypeFromMessage — specificity ordering', () => {
  it('prefers the more specific type', () => {
    expect(docTypeFromMessage('a pour-over will')).toBe('pour-over-will');
    expect(docTypeFromMessage('the living will')).toBe('advance-directive');
    expect(docTypeFromMessage('a will')).toBe('will');
  });
});

describe('detectGenerationIntent — explicit JSON only, no shape guessing (R5-049)', () => {
  it('generates when the AI returns a structured JSON action', () => {
    expect(detectGenerationIntent('{"action":"generate","docType":"trust"}').shouldGenerate).toBe(true);
    expect(detectGenerationIntent('{"draftContent":"<p>…</p>"}').shouldGenerate).toBe(true);
  });

  it('does NOT save a long, well-formatted explanation as a document', () => {
    const markdown = `# Wills vs. Trusts\n\nHere is a walkthrough.\n\n## A Will\n\nParagraph.\n\n## A Trust\n\n${'Detail. '.repeat(200)}\n\n## Which to choose\n\nMore detail.`;
    expect(markdown.length).toBeGreaterThan(1000);
    expect(detectGenerationIntent(markdown, 'will').shouldGenerate).toBe(false);

    const html = `<h1>Overview</h1>${'<p>Explanatory paragraph.</p>'.repeat(20)}`;
    expect(detectGenerationIntent(html, 'will').shouldGenerate).toBe(false);
  });
});
