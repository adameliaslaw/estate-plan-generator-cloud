import { describe, expect, it } from 'vitest';
import {
  ADJUDICATION_RUBRIC,
  adjudicationSystemPrompt,
  buildAdjudicationRequest,
  parseAdjudication,
} from '../src/adjudication.js';
import { LEGAL_DELTA_LEXICON } from '../src/core/diff.js';

describe('adjudication request construction (§4.3)', () => {
  it('quotes the merge-averse rubric VERBATIM from the design of record', () => {
    expect(ADJUDICATION_RUBRIC).toBe(
      'Same operative legal effect, differing only in style, enumeration length, or party ' +
        'structure? Answer MERGE only if a lawyer would consider them interchangeable after ' +
        'placeholder substitution; when uncertain answer SEPARATE. If the only difference looks ' +
        'like a personal name, answer NORMALIZATION_MISS.',
    );
    expect(adjudicationSystemPrompt()).toContain(ADJUDICATION_RUBRIC);
  });

  it('quotes EVERY legal-delta lexicon term in the prompt', () => {
    const prompt = adjudicationSystemPrompt();
    for (const term of LEGAL_DELTA_LEXICON) {
      expect(prompt).toContain(term);
    }
  });

  it('builds a sonnet request with both texts and the diff', () => {
    const req = buildAdjudicationRequest({
      pairId: 'abc-def',
      textA: 'distribute per stirpes',
      textB: 'distribute per capita',
      diffSummary: 'A-only: stirpes\nB-only: capita',
    });
    expect(req.model).toBe('sonnet');
    expect(req.customId).toBe('adj:abc-def');
    expect(req.userText).toContain('distribute per stirpes');
    expect(req.userText).toContain('distribute per capita');
    expect(req.userText).toContain('A-only: stirpes');
    expect(req.tool?.name).toBe('adjudicate_merge');
  });
});

describe('parseAdjudication — merge-averse', () => {
  it('parses the three verdicts', () => {
    expect(parseAdjudication({ verdict: 'MERGE', rationale: 'same' }).verdict).toBe('MERGE');
    expect(parseAdjudication({ verdict: 'SEPARATE', rationale: 'x' }).verdict).toBe('SEPARATE');
    expect(parseAdjudication({ verdict: 'NORMALIZATION_MISS', rationale: 'name' }).verdict).toBe(
      'NORMALIZATION_MISS',
    );
  });

  it('anything unparseable is SEPARATE — never a silent merge', () => {
    expect(parseAdjudication(undefined).verdict).toBe('SEPARATE');
    expect(parseAdjudication({}).verdict).toBe('SEPARATE');
    expect(parseAdjudication({ verdict: 'merge' }).verdict).toBe('SEPARATE'); // wrong case
    expect(parseAdjudication({ verdict: 'YES' }).verdict).toBe('SEPARATE');
  });
});
