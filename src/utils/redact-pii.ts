/**
 * src/utils/redact-pii.ts
 *
 * Best-effort regex redaction of common PII patterns before a chat message is
 * sent to a cloud LLM. Addresses the "I can't paste real client facts into AI"
 * grievance from the solo-lawyer research brief.
 *
 * SCOPE: structured patterns only (SSNs, EINs, phone numbers, email
 * addresses, dollar amounts, dates, street addresses). Name detection is
 * NOT included — reliable NER would require a model call, which defeats the
 * point. Users should still avoid pasting client names if they want full
 * anonymization.
 */

export interface RedactionResult {
  /** Message with PII replaced by placeholders */
  redacted: string;
  /** Per-pattern count of how many things were swapped */
  counts: Record<string, number>;
  /** True if anything was redacted */
  changed: boolean;
}

interface Pattern {
  label: string;
  /** Placeholder token; gets a 1-based counter appended */
  placeholder: string;
  /** Regex — must use the `g` flag */
  re: RegExp;
}

const PATTERNS: Pattern[] = [
  { label: 'ssn',     placeholder: 'SSN',     re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { label: 'ein',     placeholder: 'EIN',     re: /\b\d{2}-\d{7}\b/g },
  { label: 'email',   placeholder: 'EMAIL',   re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { label: 'phone',   placeholder: 'PHONE',   re: /\b(?:\(\d{3}\)\s*|\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/g },
  // Dollar amounts: $1,234, $1234.56, $10k, etc.
  { label: 'amount',  placeholder: 'AMOUNT',  re: /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?(?:[kKmMbB])?\b/g },
  // ISO dates and common US date formats
  { label: 'date',    placeholder: 'DATE',    re: /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/g },
  // Simple US street address line ("123 Main St", "456 Oak Avenue Apt 5")
  { label: 'address', placeholder: 'ADDRESS', re: /\b\d{1,6}\s+[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){0,4}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Pl|Place|Way|Ter|Terrace)\.?\b/g },
];

export function redactPii(input: string): RedactionResult {
  let working = input;
  const counts: Record<string, number> = {};

  for (const { label, placeholder, re } of PATTERNS) {
    const counters = { n: 0 };
    working = working.replace(re, () => {
      counters.n += 1;
      return `[${placeholder}-${counters.n}]`;
    });
    if (counters.n > 0) counts[label] = counters.n;
  }

  return {
    redacted: working,
    counts,
    changed: working !== input,
  };
}
