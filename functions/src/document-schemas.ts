/**
 * functions/src/document-schemas.ts
 *
 * JSON Schema definitions for OpenAI Structured Outputs.
 * Each schema constrains the AI response to a guaranteed-valid shape,
 * eliminating parse failures in parseAIJson().
 *
 * OpenAI Structured Outputs requires:
 *   - All fields marked "required"
 *   - "additionalProperties": false on every object
 *   - Top-level "strict": true (handled in ai-client.ts)
 *
 * @see https://platform.openai.com/docs/guides/structured-outputs
 */

// ---------------------------------------------------------------------------
// Base document schema — used by all generators (will, trust, POA, etc.)
// ---------------------------------------------------------------------------

/**
 * Standard document response: { title, content, metadata? }
 * Used by: will-generator, trust-generator, poa-generator,
 *          advance-directive-generator, deed-generator, affidavit-generator,
 *          git-rep3-generator, summary-docs-generator,
 *          pour-over-will-generator, flex-prompts
 */
export const DOCUMENT_SCHEMA = {
  name: 'legal_document',
  schema: {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string' as const,
        description: 'Display title for the document (e.g. "Last Will and Testament of John Doe")',
      },
      content: {
        type: 'string' as const,
        description: 'Complete HTML body of the document (no <html>/<body>/<head> tags)',
      },
      metadata: {
        type: 'object' as const,
        description: 'Optional document metadata',
        properties: {
          wordCount: { type: 'number' as const, description: 'Approximate word count' },
          estimatedPages: { type: 'number' as const, description: 'Estimated page count' },
          executionRequirements: {
            type: 'array' as const,
            items: { type: 'string' as const },
            description: 'List of execution requirements (signatures, witnesses, notary)',
          },
          witnessRequired: { type: 'boolean' as const },
          notarizationRequired: { type: 'boolean' as const },
        },
        required: ['wordCount', 'estimatedPages', 'executionRequirements', 'witnessRequired', 'notarizationRequired'],
        additionalProperties: false,
      },
    },
    required: ['title', 'content', 'metadata'],
    additionalProperties: false,
  },
  strict: true,
};

// ---------------------------------------------------------------------------
// Compliance check schema
// ---------------------------------------------------------------------------

/**
 * Compliance review response: { findings[], overallStatus }
 * Used by: ai-compliance-check.ts
 */
export const COMPLIANCE_CHECK_SCHEMA = {
  name: 'compliance_check',
  schema: {
    type: 'object' as const,
    properties: {
      findings: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            item: { type: 'string' as const, description: 'Name of the compliance item checked' },
            status: {
              type: 'string' as const,
              enum: ['pass', 'warning', 'fail'],
              description: 'Result of the check',
            },
            statute: { type: 'string' as const, description: 'Relevant NJ statute citation (if any)' },
            detail: { type: 'string' as const, description: 'Explanation of the finding' },
          },
          required: ['item', 'status', 'statute', 'detail'],
          additionalProperties: false,
        },
        description: 'Array of compliance findings',
      },
      overallStatus: {
        type: 'string' as const,
        enum: ['pass', 'needs_review', 'fail'],
        description: 'Overall compliance status',
      },
    },
    required: ['findings', 'overallStatus'],
    additionalProperties: false,
  },
  strict: true,
};

// ---------------------------------------------------------------------------
// Document review schema
// ---------------------------------------------------------------------------

/**
 * Document review response: { issues[], suggestions[], complianceNotes[], overallAssessment }
 * Used by: review-document.ts
 */
export const DOCUMENT_REVIEW_SCHEMA = {
  name: 'document_review',
  schema: {
    type: 'object' as const,
    properties: {
      issues: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            severity: {
              type: 'string' as const,
              enum: ['critical', 'major', 'minor', 'info'],
              description: 'Issue severity level',
            },
            location: { type: 'string' as const, description: 'Article/section where the issue was found' },
            description: { type: 'string' as const, description: 'Description of the issue' },
            suggestion: { type: 'string' as const, description: 'Specific fix or improvement suggestion' },
          },
          required: ['severity', 'location', 'description', 'suggestion'],
          additionalProperties: false,
        },
      },
      suggestions: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'General improvement suggestions',
      },
      complianceNotes: {
        type: 'array' as const,
        items: { type: 'string' as const },
        description: 'NJ statute references and compliance notes',
      },
      overallAssessment: {
        type: 'string' as const,
        description: '2-3 sentence overall assessment of the document',
      },
    },
    required: ['issues', 'suggestions', 'complianceNotes', 'overallAssessment'],
    additionalProperties: false,
  },
  strict: true,
};


// ---------------------------------------------------------------------------
// Estate document extraction schema
// ---------------------------------------------------------------------------

/**
 * Extraction response: { client_name, executor, trustee_logic }
 * Used by: generate-estate-document.ts (Vertex AI)
 */
export const ESTATE_EXTRACTION_SCHEMA = {
  name: 'estate_extraction',
  schema: {
    type: 'object' as const,
    properties: {
      client_name: {
        type: 'string' as const,
        description: 'Full legal name of the client',
      },
      executor: {
        type: 'string' as const,
        description: 'Name of the primary executor/personal representative',
      },
      trustee_logic: {
        type: 'string' as const,
        description: 'Brief description of the trustee succession or appointment logic',
      },
      is_married: {
        type: 'boolean' as const,
        description: 'Whether the client is married or has a spouse',
      },
    },
    required: ['client_name', 'executor', 'trustee_logic', 'is_married'],
    additionalProperties: false,
  },
  strict: true,
};

// ---------------------------------------------------------------------------
// Schema lookup by usage context
// ---------------------------------------------------------------------------

/** Pre-built schema map for quick lookup by generator name */
export const SCHEMAS = {
  document: DOCUMENT_SCHEMA,
  complianceCheck: COMPLIANCE_CHECK_SCHEMA,
  documentReview: DOCUMENT_REVIEW_SCHEMA,
} as const;
