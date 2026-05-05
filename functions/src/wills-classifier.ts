/**
 * functions/src/wills-classifier.ts
 *
 * Document classification module for the Wills ingestion pipeline.
 * Model: claude-haiku-4-5-20251001
 * Method: Anthropic tool-use (forced) — guarantees structured JSON output.
 * Retries once on schema/tool-call failure before giving up.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ClassificationResult, DocumentType, FirmOrigin, Language } from './wills-schema';
import { DOCUMENT_TYPES } from './wills-schema';

// ---------------------------------------------------------------------------
// System prompt (Section 8.1 — reproduce exactly)
// ---------------------------------------------------------------------------

const CLASSIFICATION_SYSTEM_PROMPT = `You are a legal document classifier supporting an estate planning law practice in New Jersey. You are reading a document pulled from a law firm's case management drive. Your job is to identify what kind of document it is and extract a small set of universal metadata fields.

You are NOT performing deep extraction. A separate, more capable model handles that downstream. Your job is fast, accurate triage.

Document types you must distinguish:

- **Will** — Last Will and Testament (any state, any era)
- **POA-Financial** — Durable or springing financial power of attorney
- **POA-Healthcare** — Healthcare power of attorney / proxy / surrogate
- **Healthcare-Directive** — Living will, advance directive, instructions re: end-of-life care
- **Trust** — Any trust agreement (revocable, irrevocable, testamentary, special needs, charitable, etc.)
- **Codicil** — Amendment or supplement to an existing Will
- **Letter-of-Instruction** — Non-binding letter to family/executor explaining wishes
- **Correspondence** — Letters, emails, memos, notes — not legal instruments
- **Intake** — Client questionnaires, intake forms, family/asset worksheets
- **Other** — Anything that doesn't fit

**Disambiguation rules:**

- A document titled 'Last Will and Testament' that contains a testamentary trust IS a Will, not a Trust.
- A standalone trust agreement is a Trust, even if it's a pour-over recipient.
- A document amending a trust is a Trust (with amendment_history_referenced: true), not a Codicil. Codicils only amend Wills.
- A 'living will' is a Healthcare-Directive, not a Will.
- If a single PDF contains multiple documents bundled together, classify based on the first substantive document and flag with notable_classification_concerns: ['Multi-document bundle: contains [list]'].

**Conservative on:** document_type itself, testator/principal/grantor identification.
**Aggressive on:** language detection, is_likely_executed, firm_origin.

Output: structured JSON via the provided tool. No prose, no commentary.`.trim();

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

const CLASSIFICATION_TOOL: Anthropic.Tool = {
  name: 'classify_document',
  description: 'Classify the legal document and extract universal triage metadata.',
  input_schema: {
    type: 'object' as const,
    properties: {
      document_type: {
        type: 'string',
        enum: DOCUMENT_TYPES as unknown as string[],
        description: 'Primary document type.',
      },
      confidence: {
        type: 'number',
        description: 'Classification confidence 0.0–1.0.',
      },
      firm_origin: {
        type: 'string',
        enum: ['predecessor', 'current', 'unknown'],
        description: 'Whether this document originated from the predecessor firm or current firm.',
      },
      is_likely_executed: {
        type: 'boolean',
        description: 'True if there are clear indicators of execution (signature lines filled, notary stamps, etc.).',
      },
      language: {
        type: 'string',
        enum: ['en', 'ar', 'es', 'mixed'],
      },
      page_count: {
        type: 'integer',
        description: 'Estimated page count based on document length.',
      },
      needs_human_review: {
        type: 'boolean',
        description: 'True if classification confidence is low or the document is ambiguous.',
      },
      needs_human_review_reasons: {
        type: 'array',
        items: { type: 'string' },
        description: 'Reasons why human review is needed.',
      },
      requires_ocr: {
        type: 'boolean',
        description: 'True if the document appears to be a scanned image with no extractable text.',
      },
      notable_classification_concerns: {
        type: 'array',
        items: { type: 'string' },
        description: 'E.g. multi-document bundles, unusual format, etc.',
      },
    },
    required: [
      'document_type', 'confidence', 'firm_origin', 'is_likely_executed',
      'language', 'page_count', 'needs_human_review', 'needs_human_review_reasons',
      'requires_ocr', 'notable_classification_concerns',
    ],
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function classify(
  text: string,
  fileName: string,
  anthropicKey: string,
): Promise<ClassificationResult> {
  const client = new Anthropic({ apiKey: anthropicKey });
  return _attempt(client, text, fileName);
}

async function _attempt(
  client: Anthropic,
  text: string,
  fileName: string,
  isRetry = false,
): Promise<ClassificationResult> {
  const userPrompt = `File name: ${fileName}\n\nDocument text:\n${text.slice(0, 80_000)}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: [
      {
        type: 'text',
        text: CLASSIFICATION_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ] as Anthropic.TextBlockParam[],
    tools: [CLASSIFICATION_TOOL],
    tool_choice: { type: 'tool', name: 'classify_document' },
    messages: [{ role: 'user', content: userPrompt }],
  });

  const toolUse = response.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');

  if (!toolUse) {
    if (!isRetry) return _attempt(client, text, fileName, true);
    return _fallbackResult(fileName);
  }

  const raw = toolUse.input as Record<string, unknown>;

  const docType = DOCUMENT_TYPES.includes(raw.document_type as DocumentType)
    ? (raw.document_type as DocumentType)
    : 'Other';

  return {
    document_type: docType,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.5,
    firm_origin: (['predecessor', 'current', 'unknown'].includes(raw.firm_origin as string)
      ? raw.firm_origin : 'unknown') as FirmOrigin,
    is_likely_executed: raw.is_likely_executed === true,
    language: (['en', 'ar', 'es', 'mixed'].includes(raw.language as string)
      ? raw.language : 'en') as Language,
    page_count: typeof raw.page_count === 'number' ? Math.round(raw.page_count) : 1,
    needs_human_review: raw.needs_human_review === true,
    needs_human_review_reasons: Array.isArray(raw.needs_human_review_reasons)
      ? (raw.needs_human_review_reasons as string[]) : [],
    requires_ocr: raw.requires_ocr === true,
    notable_classification_concerns: Array.isArray(raw.notable_classification_concerns)
      ? (raw.notable_classification_concerns as string[]) : [],
  };
}

function _fallbackResult(fileName: string): ClassificationResult {
  return {
    document_type: 'Other',
    confidence: 0,
    firm_origin: 'unknown',
    is_likely_executed: false,
    language: 'en',
    page_count: 0,
    needs_human_review: true,
    needs_human_review_reasons: ['classification_tool_call_failed'],
    requires_ocr: false,
    notable_classification_concerns: [`Classification failed for: ${fileName}`],
  };
}
