/**
 * functions/src/document-structure-validator.ts
 *
 * Post-generation structural validation for AI-generated legal documents.
 *
 * PROBLEM: AI generators sometimes omit required structural elements — witness
 * attestation blocks, self-proving affidavits, notary acknowledgments, signature
 * lines — and the system blindly saves whatever the AI returns.
 *
 * SOLUTION: After generation, validate the HTML output against per-doc-type rules
 * that check for required structural elements. If validation fails, either retry
 * with specific missing-element feedback or flag the document for review.
 *
 * @see unified-generator.ts — calls validateDocumentStructure() after generation
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StructureRule {
  /** Human-readable name of the required element */
  name: string;
  /** Regex or text patterns to detect the element in HTML content */
  patterns: RegExp[];
  /** 'error' = must be present, 'warning' = recommended but not blocking */
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  /** Whether the document passed all error-severity rules */
  valid: boolean;
  /** Missing elements (failed rules) */
  missing: Array<{
    name: string;
    severity: 'error' | 'warning';
  }>;
  /** Passed rules */
  passed: string[];
  /** Minimum text length check result */
  meetsMinimumLength: boolean;
  /** Whether the content appears truncated */
  appearsTruncated: boolean;
  /** Placeholder count detected */
  placeholderCount: number;
}

// ---------------------------------------------------------------------------
// Pattern helpers (case-insensitive HTML content matching)
// ---------------------------------------------------------------------------

/** Create a case-insensitive pattern that matches common variations */
function p(text: string): RegExp {
  return new RegExp(text, 'i');
}

// ---------------------------------------------------------------------------
// Rules by document type
// ---------------------------------------------------------------------------

const WILL_RULES: StructureRule[] = [
  {
    name: 'Testator Signature Block',
    patterns: [p('signature.*testat'), p('sign.*below'), p('___.*testat'), p('testat.*sign')],
    severity: 'error',
  },
  {
    name: 'Witness Attestation (2 witnesses)',
    patterns: [p('witness'), p('attest')],
    severity: 'error',
  },
  {
    name: 'Self-Proving Affidavit',
    patterns: [p('self[- ]proving'), p('affidavit')],
    severity: 'error',
  },
  {
    name: 'Article/Section Headings',
    patterns: [p('<h[23][^>]*>.*article'), p('article\\s+[IVX1-9]')],
    severity: 'error',
  },
  {
    name: 'Executor Designation',
    patterns: [p('executor'), p('personal representative')],
    severity: 'error',
  },
  {
    name: 'Revocation of Prior Wills',
    patterns: [p('revok'), p('revoc')],
    severity: 'warning',
  },
  {
    name: 'Residuary Clause',
    patterns: [p('residu')],
    severity: 'warning',
  },
  {
    name: 'Date Reference',
    patterns: [p('day of'), p('dated.*\\d{4}'), p('date:')],
    severity: 'warning',
  },
];

const TRUST_RULES: StructureRule[] = [
  {
    name: 'Settlor/Grantor Signature Block',
    patterns: [p('settl.*sign'), p('grant.*sign'), p('___.*settl'), p('___.*grant')],
    severity: 'error',
  },
  {
    name: 'Trustee Acceptance',
    patterns: [p('trustee.*accept'), p('accept.*trustee'), p('trustee.*sign')],
    severity: 'error',
  },
  {
    name: 'Article/Section Headings',
    patterns: [p('<h[23][^>]*>.*article'), p('article\\s+[IVX1-9]')],
    severity: 'error',
  },
  {
    name: 'Schedule A Reference',
    patterns: [p('schedule\\s*a'), p('schedule.*property'), p('trust.*property.*list')],
    severity: 'error',
  },
  {
    name: 'Successor Trustee Designation',
    patterns: [p('successor.*trustee')],
    severity: 'warning',
  },
  {
    name: 'Amendment/Revocation Provisions',
    patterns: [p('amend'), p('revoc')],
    severity: 'warning',
  },
  {
    name: 'Distribution Standards',
    patterns: [p('distribut'), p('HEMS'), p('health.*education.*maintenance')],
    severity: 'warning',
  },
  {
    name: 'Notary Acknowledgment',
    patterns: [p('notar'), p('notari'), p('sworn.*before')],
    severity: 'warning',
  },
];

const POA_RULES: StructureRule[] = [
  {
    name: 'Principal Signature Block',
    patterns: [p('principal.*sign'), p('sign.*principal'), p('___.*principal')],
    severity: 'error',
  },
  {
    name: 'Witness Signature Lines (2)',
    patterns: [p('witness')],
    severity: 'error',
  },
  {
    name: 'Notary Block',
    // NJ POAs typically use the "ACKNOWLEDGMENT" header + "acknowledged under
    // oath" phrasing rather than the words "notary" or "sworn before me".
    // Broaden the OR-of-patterns to recognize that style.
    patterns: [
      p('notar'),
      p('notari'),
      p('acknowledgment'),
      p('sworn'),
      p('acknowledg.*oath'),
    ],
    severity: 'error',
  },
  {
    name: 'Agent Identification',
    patterns: [p('agent'), p('attorney[- ]in[- ]fact')],
    severity: 'error',
  },
  {
    name: 'Scope of Authority',
    patterns: [p('powers?.*grant'), p('authoriz'), p('scope.*authority')],
    severity: 'warning',
  },
  {
    name: 'Durable/Springing Declaration',
    patterns: [p('durable'), p('springing'), p('incapacit')],
    severity: 'warning',
  },
];

const LIVING_WILL_RULES: StructureRule[] = [
  {
    name: 'Healthcare Representative Designation',
    patterns: [p('healthcare.*representative'), p('healthcare.*proxy'), p('healthcare.*agent')],
    severity: 'error',
  },
  {
    name: 'Life-Sustaining Treatment Instructions',
    patterns: [p('life[- ]sustain'), p('life[- ]prolong')],
    severity: 'error',
  },
  {
    name: 'Witness Blocks',
    patterns: [p('witness')],
    severity: 'error',
  },
  {
    name: 'Artificial Nutrition/Hydration Instructions',
    patterns: [p('artificial.*nutri'), p('artificial.*hydra'), p('feeding.*tube')],
    severity: 'warning',
  },
  {
    name: 'Signature and Date',
    patterns: [p('sign.*date'), p('___.*date'), p('signature.*principal'), p('dated')],
    severity: 'error',
  },
];

const DEED_RULES: StructureRule[] = [
  {
    name: 'Grantor Identification',
    patterns: [p('grantor')],
    severity: 'error',
  },
  {
    name: 'Grantee Identification',
    patterns: [p('grantee')],
    severity: 'error',
  },
  {
    name: 'Legal Description or Block/Lot',
    patterns: [p('legal.*description'), p('block.*lot'), p('metes.*bounds'), p('lot\\s+\\d')],
    severity: 'error',
  },
  {
    name: 'Consideration Statement',
    patterns: [p('consideration'), p('one dollar')],
    severity: 'error',
  },
  {
    name: 'Notary Acknowledgment',
    patterns: [p('notar'), p('acknowledged.*before')],
    severity: 'error',
  },
  {
    name: 'Grantor Signature',
    patterns: [p('___.*grantor'), p('grantor.*sign'), p('sign.*grantor')],
    severity: 'error',
  },
];

const POUR_OVER_WILL_RULES: StructureRule[] = [
  // Same as will plus trust reference
  ...WILL_RULES,
  {
    name: 'Trust Reference by Name',
    patterns: [p('trust'), p('pour[- ]?over')],
    severity: 'error',
  },
];

// Minimal rules for summary/action-steps (they are informational, not legal instruments)
const SUMMARY_RULES: StructureRule[] = [
  {
    name: 'Section Headings',
    patterns: [p('<h[23]')],
    severity: 'warning',
  },
];

// ---------------------------------------------------------------------------
// Rule registry
// ---------------------------------------------------------------------------

const RULES_BY_DOC_TYPE: Record<string, StructureRule[]> = {
  will: WILL_RULES,
  trust: TRUST_RULES,
  poa: POA_RULES,
  livingWill: LIVING_WILL_RULES,
  deed: DEED_RULES,
  pourOverWill: POUR_OVER_WILL_RULES,
  affidavitOfConsideration: [
    { name: 'Grantor Reference', patterns: [p('grantor')], severity: 'error' },
    { name: 'Consideration Amount', patterns: [p('consideration'), p('\\$')], severity: 'error' },
    { name: 'Notary Block', patterns: [p('notar'), p('sworn'), p('acknowledgment'), p('acknowledg.*oath')], severity: 'error' },
  ],
  gitRep3: [
    { name: 'Seller/Transferor Identification', patterns: [p('seller'), p('transferor')], severity: 'error' },
    { name: 'Property Reference', patterns: [p('block.*lot'), p('property'), p('address')], severity: 'error' },
  ],
  estatePlanSummary: SUMMARY_RULES,
};

/** Minimum expected text length (HTML stripped) per doc type */
const MIN_TEXT_LENGTH: Record<string, number> = {
  will: 2000,
  trust: 3000,
  poa: 1500,
  livingWill: 1000,
  deed: 500,
  pourOverWill: 2000,
  affidavitOfConsideration: 300,
  gitRep3: 300,
  estatePlanSummary: 1000,
};

// ---------------------------------------------------------------------------
// Placeholder detection
// ---------------------------------------------------------------------------

const PLACEHOLDER_PATTERNS = [
  /\[INSERT[^\]]*\]/gi,
  /\[NAME[^\]]*\]/gi,
  /\[TBD[^\]]*\]/gi,
  /\[TODO[^\]]*\]/gi,
  /\[BLANK[^\]]*\]/gi,
  /\[FILL[^\]]*\]/gi,
  // Note: underscore runs (___) are NOT counted — they are legitimate
  // signature/witness blank lines in legal documents.
];

function countPlaceholders(html: string): number {
  let count = 0;
  for (const pat of PLACEHOLDER_PATTERNS) {
    const matches = html.match(pat);
    if (matches) count += matches.length;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Truncation detection
// ---------------------------------------------------------------------------

/** Heuristics for detecting truncated AI output */
function appearsTruncated(html: string): boolean {
  const trimmed = html.trim();
  if (!trimmed) return true;

  // Ends mid-tag
  if (/<[^>]*$/.test(trimmed)) return true;

  // Ends with an unclosed HTML element (no matching closing tag near the end)
  // Simple heuristic: last 50 chars contain an opening tag but no closing tag
  const tail = trimmed.slice(-100);
  const lastOpen = tail.lastIndexOf('<');
  const lastClose = tail.lastIndexOf('</');
  if (lastOpen > lastClose && !tail.slice(lastOpen).includes('>')) return true;

  // Ends mid-sentence (no terminal punctuation and no closing HTML tag)
  const textOnly = trimmed.replace(/<[^>]*>/g, '').trim();
  if (textOnly.length > 100) {
    const lastChar = textOnly.slice(-1);
    const isTerminal = ['.', '!', '?', '"', "'", ')', ']', ':'].includes(lastChar);
    const endsWithTag = />[^<]*$/.test(trimmed) && trimmed.slice(-1) === '>';
    if (!isTerminal && !endsWithTag) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Main validator
// ---------------------------------------------------------------------------

/**
 * Validate a generated document's HTML content against structural rules
 * for the given document type.
 *
 * @param html     The generated HTML content
 * @param docType  The document type (e.g. 'will', 'trust', 'poa')
 * @returns        ValidationResult with pass/fail details
 */
export function validateDocumentStructure(
  html: string,
  docType: string,
): ValidationResult {
  const rules = RULES_BY_DOC_TYPE[docType] ?? [];
  const minLength = MIN_TEXT_LENGTH[docType] ?? 200;

  const textOnly = html.replace(/<[^>]*>/g, '').trim();
  const meetsMinLen = textOnly.length >= minLength;
  const isTruncated = appearsTruncated(html);
  const placeholderCount = countPlaceholders(html);

  const missing: ValidationResult['missing'] = [];
  const passed: string[] = [];

  for (const rule of rules) {
    // A rule passes if ANY of its patterns match
    const matches = rule.patterns.some((pat) => pat.test(html));
    if (matches) {
      passed.push(rule.name);
    } else {
      missing.push({ name: rule.name, severity: rule.severity });
    }
  }

  // Overall validity: no error-severity items missing, meets min length, not truncated
  const hasErrors = missing.some((m) => m.severity === 'error');
  const valid = !hasErrors && meetsMinLen && !isTruncated && placeholderCount <= 3;

  return {
    valid,
    missing,
    passed,
    meetsMinimumLength: meetsMinLen,
    appearsTruncated: isTruncated,
    placeholderCount,
  };
}

/**
 * Build a re-prompt instruction telling the AI what it missed.
 * Used when the first generation attempt fails structural validation.
 *
 * @param result   The failed ValidationResult
 * @param docType  The document type
 * @returns        Instruction string to append to the user prompt on retry
 */
export function buildRetryInstruction(
  result: ValidationResult,
  docType: string,
): string {
  const lines: string[] = [
    'IMPORTANT — Your previous output was missing required structural elements. You MUST include ALL of the following in your revised output:',
    '',
  ];

  for (const m of result.missing) {
    const icon = m.severity === 'error' ? '❌ REQUIRED' : '⚠️ RECOMMENDED';
    lines.push(`  ${icon}: ${m.name}`);
  }

  if (!result.meetsMinimumLength) {
    const expected = MIN_TEXT_LENGTH[docType] ?? 200;
    lines.push(`  ❌ MINIMUM LENGTH: Document text must be at least ${expected} characters (excluding HTML tags).`);
  }

  if (result.appearsTruncated) {
    lines.push('  ❌ TRUNCATION: Your previous output was cut off. Ensure the document is complete with all closing tags and signature blocks.');
  }

  if (result.placeholderCount > 3) {
    lines.push(`  ❌ PLACEHOLDERS: Found ${result.placeholderCount} placeholder markers ([INSERT], [TBD], etc.). Replace all placeholders with actual client data from the CLIENT DATA BLOCK.`);
  }

  lines.push('');
  lines.push('Generate the COMPLETE document now with ALL required elements included.');

  return lines.join('\n');
}

/**
 * Get the list of rules for a given document type.
 * Exported for testing.
 */
export function getRulesForDocType(docType: string): StructureRule[] {
  return RULES_BY_DOC_TYPE[docType] ?? [];
}
