/**
 * functions/src/wills-extractor.ts
 *
 * Metadata extraction module for the Wills ingestion pipeline.
 * Model: claude-sonnet-4-6
 * Method: Anthropic tool-use (forced) — guarantees structured JSON output.
 * Prompt caching on system prompt + schema prefix.
 * Retries once on tool-call failure; stubs record on second failure.
 *
 * IMPORTANT: Few-shot examples are PLACEHOLDERS (Section 8.3).
 * Replace before Phase 5 backfill. See HOMEWORK.md.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  DocumentType, ExtractionResult, TypeSpecificFields,
} from './wills-schema';
import {
  TRUST_STRUCTURES, BENEFICIARY_CATEGORIES, POWERS_GRANTED, DISTRIBUTION_STANDARDS,
} from './wills-schema';

// ---------------------------------------------------------------------------
// System prompt (Section 8.2 — reproduce exactly)
// ---------------------------------------------------------------------------

const EXTRACTION_SYSTEM_PROMPT = `You are an expert New Jersey estate planning paralegal extracting structured metadata from a legal document. The output of your work feeds a precedent bank and clause library used by attorneys. Accuracy on named parties, dates, and jurisdictions is paramount; aggressive pattern-matching on clause types and boolean indicators is desired.

**TIERED EXTRACTION RULES — read carefully.**

**CONSERVATIVE FIELDS** (return null if not clearly stated; do NOT guess):

- Any *_name field (testator, principal, grantor, executor, agent, trustee, witnesses, beneficiaries, guardian, notary)
- execution_date, intake_date, date_sent, referenced_will_date
- governing_law (must be explicitly stated; do not infer from client address)
- is_executed (true only if signature block + witnesses + date are all present)
- document_type (already locked from classification — do not change it)

For these fields when uncertain: set null, lower field-level confidence below 0.85, append to needs_human_review_reasons[].

**AGGRESSIVE FIELDS** (extract your best read, even on ambiguous text):

- trust_structures[], beneficiary_categories[], powers_granted[]
- All boolean clause indicators
- distribution_standard, estimated_estate_complexity
- notable_clauses[] (free-text, capture anything unusual)
- religious_or_cultural_provisions (verbatim or near-verbatim)
- nature_of_amendment[] (codicils)
- topic_summary (correspondence)

**CONTROLLED VOCABULARIES — do not invent values:**

- trust_structures: subset of [${TRUST_STRUCTURES.join(', ')}]
- beneficiary_categories: subset of [${BENEFICIARY_CATEGORIES.join(', ')}]
- powers_granted: subset of [${POWERS_GRANTED.join(', ')}]
- distribution_standard: one of [${DISTRIBUTION_STANDARDS.join(', ')}]

**DOCUMENT-SPECIFIC GUIDANCE:**

*Wills:*
- Distinguish primary executor from successors; preserve order in executor_alternates[].
- If the Will references an external trust, capture name in referenced_trust_name and set has_pour_over_provision: true.
- A testamentary trust within a Will's text is a 'Testamentary' entry in trust_structures — NOT a separate Trust document.
- Self-proving affidavit: sworn witness statements typically following the signature block.
- Holographic Wills are entirely handwritten with no witnesses. Flag if seen.

*Trusts:*
- distribution_standard: HEMS = "health, education, maintenance, support" or close variant. Ascertainable = HEMS-like with different language. Discretionary = trustee has sole discretion. Mandatory = specific amounts/percentages required.
- funded_status: 'funded' if trust references specific transferred assets (Schedule A), 'unfunded' if explicit, 'unknown' if unclear.
- ILIT = Irrevocable Life Insurance Trust. IDGT = Intentionally Defective Grantor Trust.

*POA-Financial:*
- is_durable: TRUE if document explicitly states it survives incapacity, OR uses statutory durable language. Default in NJ is durable unless stated otherwise.
- is_springing: TRUE only if explicitly activates ONLY upon a triggering event.
- nj_form_compliant: TRUE if document follows N.J.S.A. 46:2B-8.1 et seq. structure.

*Healthcare directives:*
- religious_or_cultural_provisions: capture verbatim or near-verbatim. Sensitive content — do not summarize.

*Codicils:*
- referenced_will_date: date of original Will being amended.
- nature_of_amendment[]: free-text array, one entry per substantive change.

**MULTI-LANGUAGE:** If document is in Arabic, Spanish, or mixed, extract all fields in English. Note original language in notable_clauses and append 'non-English source document' to needs_human_review_reasons.

**CONFIDENCE SCORING:** Return overall extraction_confidence (0.0–1.0) AND a per-field confidence map for high-stakes fields. Set needs_human_review: true if any of:
- Any conservative field with confidence < 0.85
- Document is non-English
- Classification flagged 'multi-document bundle'
- Document content appears truncated or unreadable
- Document doesn't match the type structure

**PRIVACY:** Do not invent or infer facts. Do not extrapolate beneficiary relationships beyond what's named. Capture only structurally relevant content.

Output: structured JSON via the provided tool. No prose, no commentary.

EXAMPLE 1 (PLACEHOLDER — to be replaced before backfill):
[Adam will provide a simple Will]

EXAMPLE 2 (PLACEHOLDER — to be replaced before backfill):
[Adam will provide a complex Will with trust structures]

EXAMPLE 3 (PLACEHOLDER — to be replaced before backfill):
[Adam will provide a POA-Financial]

EXAMPLE 4 (PLACEHOLDER — to be replaced before backfill):
[Adam will provide a Healthcare-Directive or Healthcare POA]

EXAMPLE 5 (PLACEHOLDER — to be replaced before backfill):
[Adam will provide a Trust agreement]`.trim();

// ---------------------------------------------------------------------------
// Shared confidence fields appended to every per-type tool schema
// ---------------------------------------------------------------------------

const CONFIDENCE_PROPERTIES = {
  extraction_confidence: {
    type: 'number',
    description: 'Overall extraction confidence 0.0–1.0.',
  },
  field_confidence: {
    type: 'object',
    additionalProperties: { type: 'number' },
    description: 'Per-field confidence for conservative fields. Keys are field names.',
  },
  needs_human_review: { type: 'boolean' },
  needs_human_review_reasons: {
    type: 'array',
    items: { type: 'string' },
  },
} as const;

const CONFIDENCE_REQUIRED = [
  'extraction_confidence', 'field_confidence', 'needs_human_review', 'needs_human_review_reasons',
] as const;

// nullable string / boolean helpers
const NS = { type: ['string', 'null'] as ['string', 'null'] };
const NB = { type: ['boolean', 'null'] as ['boolean', 'null'] };
const STR_ARRAY = { type: 'array' as const, items: { type: 'string' as const } };

// ---------------------------------------------------------------------------
// Per-document-type tool definitions
// ---------------------------------------------------------------------------

function makeTool(name: string, description: string, typeProps: Record<string, unknown>, typeRequired: string[]): Anthropic.Tool {
  return {
    name,
    description,
    input_schema: {
      type: 'object' as const,
      properties: { ...typeProps, ...CONFIDENCE_PROPERTIES },
      required: [...typeRequired, ...CONFIDENCE_REQUIRED],
    },
  };
}

const TOOLS: Partial<Record<DocumentType, Anthropic.Tool>> = {
  'Will': makeTool('extract_will', 'Extract metadata from a Last Will and Testament.', {
    testator_name: NS,
    executor_name: NS,
    executor_alternates: STR_ARRAY,
    witnesses: STR_ARRAY,
    execution_date: NS,
    governing_law: NS,
    is_executed: NB,
    has_self_proving_affidavit: { type: 'boolean' },
    has_no_contest_clause: { type: 'boolean' },
    has_pour_over_provision: { type: 'boolean' },
    referenced_trust_name: NS,
    referenced_trust_date: NS,
    trust_structures: { type: 'array', items: { type: 'string', enum: [...TRUST_STRUCTURES] } },
    beneficiary_categories: { type: 'array', items: { type: 'string', enum: [...BENEFICIARY_CATEGORIES] } },
    guardian_name: NS,
    is_holographic: { type: 'boolean' },
    has_residuary_clause: { type: 'boolean' },
    estimated_estate_complexity: { type: ['string', 'null'], enum: ['simple', 'moderate', 'complex', 'high-net-worth', null] },
    notable_clauses: STR_ARRAY,
  }, ['testator_name', 'executor_name', 'executor_alternates', 'witnesses', 'execution_date',
     'governing_law', 'is_executed', 'has_self_proving_affidavit', 'has_no_contest_clause',
     'has_pour_over_provision', 'referenced_trust_name', 'referenced_trust_date',
     'trust_structures', 'beneficiary_categories', 'guardian_name', 'is_holographic',
     'has_residuary_clause', 'estimated_estate_complexity', 'notable_clauses']),

  'POA-Financial': makeTool('extract_poa_financial', 'Extract metadata from a Financial Power of Attorney.', {
    principal_name: NS,
    agent_name: NS,
    agent_alternates: STR_ARRAY,
    notary_name: NS,
    execution_date: NS,
    governing_law: NS,
    is_executed: NB,
    is_durable: { type: 'boolean' },
    is_springing: { type: 'boolean' },
    nj_form_compliant: { type: 'boolean' },
    powers_granted: { type: 'array', items: { type: 'string', enum: [...POWERS_GRANTED] } },
    gift_authority: { type: 'boolean' },
    notable_clauses: STR_ARRAY,
  }, ['principal_name', 'agent_name', 'agent_alternates', 'notary_name', 'execution_date',
     'governing_law', 'is_executed', 'is_durable', 'is_springing', 'nj_form_compliant',
     'powers_granted', 'gift_authority', 'notable_clauses']),

  'POA-Healthcare': makeTool('extract_poa_healthcare', 'Extract metadata from a Healthcare Power of Attorney.', {
    principal_name: NS,
    agent_name: NS,
    agent_alternates: STR_ARRAY,
    notary_name: NS,
    execution_date: NS,
    governing_law: NS,
    is_executed: NB,
    is_durable: { type: 'boolean' },
    hipaa_authorization: { type: 'boolean' },
    religious_or_cultural_provisions: NS,
    notable_clauses: STR_ARRAY,
  }, ['principal_name', 'agent_name', 'agent_alternates', 'notary_name', 'execution_date',
     'governing_law', 'is_executed', 'is_durable', 'hipaa_authorization',
     'religious_or_cultural_provisions', 'notable_clauses']),

  'Healthcare-Directive': makeTool('extract_healthcare_directive', 'Extract metadata from a Living Will / Advance Directive.', {
    declarant_name: NS,
    healthcare_representative_name: NS,
    healthcare_representative_alternates: STR_ARRAY,
    witnesses: STR_ARRAY,
    execution_date: NS,
    governing_law: NS,
    is_executed: NB,
    life_support_choice: { type: ['string', 'null'], enum: ['withdraw', 'maintain', 'conditional', null] },
    artificial_nutrition_choice: NS,
    cpr_directive: { type: ['string', 'null'], enum: ['DNR', 'full-code', 'conditional', null] },
    organ_donation: { type: ['string', 'null'], enum: ['yes', 'no', 'partial', null] },
    hipaa_authorization: { type: 'boolean' },
    religious_or_cultural_provisions: NS,
    notable_clauses: STR_ARRAY,
  }, ['declarant_name', 'healthcare_representative_name', 'healthcare_representative_alternates',
     'witnesses', 'execution_date', 'governing_law', 'is_executed', 'life_support_choice',
     'artificial_nutrition_choice', 'cpr_directive', 'organ_donation', 'hipaa_authorization',
     'religious_or_cultural_provisions', 'notable_clauses']),

  'Trust': makeTool('extract_trust', 'Extract metadata from a Trust agreement.', {
    trust_name: NS,
    grantor_name: NS,
    trustee_name: NS,
    trustee_alternates: STR_ARRAY,
    execution_date: NS,
    governing_law: NS,
    is_executed: NB,
    trust_structures: { type: 'array', items: { type: 'string', enum: [...TRUST_STRUCTURES] } },
    beneficiary_categories: { type: 'array', items: { type: 'string', enum: [...BENEFICIARY_CATEGORIES] } },
    distribution_standard: { type: ['string', 'null'], enum: [...DISTRIBUTION_STANDARDS, null] },
    funded_status: { type: 'string', enum: ['funded', 'unfunded', 'unknown'] },
    amendment_history_referenced: { type: 'boolean' },
    spendthrift_clause: { type: 'boolean' },
    has_pour_over_provision: { type: 'boolean' },
    estimated_estate_complexity: { type: ['string', 'null'], enum: ['simple', 'moderate', 'complex', 'high-net-worth', null] },
    notable_clauses: STR_ARRAY,
  }, ['trust_name', 'grantor_name', 'trustee_name', 'trustee_alternates', 'execution_date',
     'governing_law', 'is_executed', 'trust_structures', 'beneficiary_categories',
     'distribution_standard', 'funded_status', 'amendment_history_referenced',
     'spendthrift_clause', 'has_pour_over_provision', 'estimated_estate_complexity', 'notable_clauses']),

  'Codicil': makeTool('extract_codicil', 'Extract metadata from a Codicil (Will amendment).', {
    testator_name: NS,
    witnesses: STR_ARRAY,
    execution_date: NS,
    governing_law: NS,
    is_executed: NB,
    referenced_will_date: NS,
    nature_of_amendment: STR_ARRAY,
    has_self_proving_affidavit: { type: 'boolean' },
    notable_clauses: STR_ARRAY,
  }, ['testator_name', 'witnesses', 'execution_date', 'governing_law', 'is_executed',
     'referenced_will_date', 'nature_of_amendment', 'has_self_proving_affidavit', 'notable_clauses']),

  'Correspondence': makeTool('extract_correspondence', 'Extract metadata from a letter, memo, or email.', {
    date_sent: NS,
    author_name: NS,
    recipient_name: NS,
    topic_summary: NS,
    referenced_client_name: NS,
    notable_clauses: STR_ARRAY,
  }, ['date_sent', 'author_name', 'recipient_name', 'topic_summary', 'referenced_client_name', 'notable_clauses']),

  'Intake': makeTool('extract_intake', 'Extract metadata from a client intake form or questionnaire.', {
    client_name_self_reported: NS,
    intake_date: NS,
    spouse_name: NS,
    has_minor_children: { type: 'boolean' },
    estimated_estate_complexity: { type: ['string', 'null'], enum: ['simple', 'moderate', 'complex', 'high-net-worth', null] },
    documents_requested: STR_ARRAY,
    notable_clauses: STR_ARRAY,
  }, ['client_name_self_reported', 'intake_date', 'spouse_name', 'has_minor_children',
     'estimated_estate_complexity', 'documents_requested', 'notable_clauses']),
};

// Letter-of-Instruction uses the Correspondence tool
TOOLS['Letter-of-Instruction'] = TOOLS['Correspondence'];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function extract(
  text: string,
  docType: DocumentType,
  anthropicKey: string,
): Promise<ExtractionResult> {
  const tool = TOOLS[docType];
  if (!tool) {
    return _stubResult(['no_extraction_tool_for_type']);
  }

  const client = new Anthropic({ apiKey: anthropicKey });
  return _attempt(client, text, docType, tool);
}

async function _attempt(
  client: Anthropic,
  text: string,
  docType: DocumentType,
  tool: Anthropic.Tool,
  isRetry = false,
): Promise<ExtractionResult> {
  const userPrompt = `Document type: ${docType}\n\nDocument text:\n${text.slice(0, 900_000)}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: EXTRACTION_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ] as Anthropic.TextBlockParam[],
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
    messages: [{ role: 'user', content: userPrompt }],
  });

  const toolUse = response.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');

  if (!toolUse) {
    if (!isRetry) return _attempt(client, text, docType, tool, true);
    return _stubResult(['extraction_schema_failure']);
  }

  const raw = toolUse.input as Record<string, unknown>;
  const typeFields = _stripConfidenceFields(raw) as unknown as TypeSpecificFields;

  return {
    extraction_confidence: typeof raw.extraction_confidence === 'number' ? raw.extraction_confidence : 0.5,
    field_confidence: (typeof raw.field_confidence === 'object' && raw.field_confidence !== null)
      ? (raw.field_confidence as Record<string, number>) : {},
    type_fields: typeFields,
  };
}

function _stripConfidenceFields(raw: Record<string, unknown>): Record<string, unknown> {
  const { extraction_confidence: _ec, field_confidence: _fc, needs_human_review: _nhr, needs_human_review_reasons: _nhrr, ...rest } = raw;
  return rest;
}

function _stubResult(_reasons: string[]): ExtractionResult {
  return {
    extraction_confidence: 0,
    field_confidence: {},
    type_fields: null,
  };
}

export function extractionNeedsReview(result: ExtractionResult, reasons: string[]): boolean {
  return result.extraction_confidence < 0.7 || reasons.length > 0;
}
