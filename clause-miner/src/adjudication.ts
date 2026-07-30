/**
 * §4.3 — merge adjudication request construction. EVERY non-trivial merge
 * goes to sonnet with the merge-averse rubric (quoted VERBATIM from the
 * design of record) and the legal-delta lexicon quoted in the prompt.
 * Answers: MERGE | SEPARATE | NORMALIZATION_MISS. The full transcript
 * (both texts, diff, verdict, rationale) is persisted by the caller.
 *
 * Pure module: builds request objects and parses verdicts; no I/O.
 */

import { LEGAL_DELTA_LEXICON } from './core/diff.js';
import type { BatchRequest, DocData } from './clients/interfaces.js';

/** §4.3 adjudicator rubric — VERBATIM from the design of record. */
export const ADJUDICATION_RUBRIC =
  'Same operative legal effect, differing only in style, enumeration length, or party ' +
  'structure? Answer MERGE only if a lawyer would consider them interchangeable after ' +
  'placeholder substitution; when uncertain answer SEPARATE. If the only difference looks ' +
  'like a personal name, answer NORMALIZATION_MISS.';

export type AdjudicationVerdict = 'MERGE' | 'SEPARATE' | 'NORMALIZATION_MISS';

export const ADJUDICATION_TOOL = {
  name: 'adjudicate_merge',
  description: 'Decide whether two candidate clause texts are the same clause.',
  input_schema: {
    type: 'object' as const,
    properties: {
      verdict: {
        type: 'string',
        enum: ['MERGE', 'SEPARATE', 'NORMALIZATION_MISS'],
      },
      rationale: {
        type: 'string',
        description: 'One or two sentences naming the decisive difference (or its absence).',
      },
    },
    required: ['verdict', 'rationale'],
  },
};

export function adjudicationSystemPrompt(): string {
  return [
    'You adjudicate clause-identity merges for an estate-planning clause catalog.',
    'Two candidate clause texts (already anonymized with {{PLACEHOLDER}} tokens) were',
    'proposed as the same clause by a similarity pass. Similarity CANNOT carry this',
    'decision: over-merging two legally distinct provisions is the catastrophic error,',
    'and textual closeness is anti-correlated with legal-difference salience in form',
    'documents (a one-token diff can flip per stirpes to per capita).',
    '',
    `Rubric: "${ADJUDICATION_RUBRIC}"`,
    '',
    'Pay particular attention to any difference involving these legally loaded terms',
    '(the legal-delta lexicon — a difference here is almost never a MERGE):',
    LEGAL_DELTA_LEXICON.map((t) => `- ${t}`).join('\n'),
  ].join('\n');
}

export interface AdjudicationPair {
  pairId: string;
  textA: string;
  textB: string;
  /** Human-readable diff summary included in the prompt for focus. */
  diffSummary: string;
}

export function buildAdjudicationRequest(pair: AdjudicationPair): BatchRequest {
  return {
    customId: `adj:${pair.pairId}`,
    model: 'sonnet',
    maxTokens: 512,
    system: adjudicationSystemPrompt(),
    userText: [
      'TEXT A:',
      pair.textA,
      '',
      'TEXT B:',
      pair.textB,
      '',
      'TOKEN DIFF (changed tokens only):',
      pair.diffSummary,
    ].join('\n'),
    tool: ADJUDICATION_TOOL,
  };
}

export interface ParsedAdjudication {
  verdict: AdjudicationVerdict;
  rationale: string;
}

/**
 * Merge-averse parse: anything unparseable is SEPARATE (never a silent
 * merge on a malformed response — §4.3 asymmetry).
 */
export function parseAdjudication(toolInput: DocData | undefined): ParsedAdjudication {
  const verdictRaw = toolInput?.verdict;
  const verdict: AdjudicationVerdict =
    verdictRaw === 'MERGE' || verdictRaw === 'NORMALIZATION_MISS' ? verdictRaw : 'SEPARATE';
  const rationale =
    typeof toolInput?.rationale === 'string' ? toolInput.rationale : 'unparseable response';
  return { verdict, rationale };
}
