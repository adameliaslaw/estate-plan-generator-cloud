/**
 * §4.2 — attestation/jurat/notary/signature block detection.
 *
 * Execution blocks are cataloged in a separate 'execution-block' category so
 * they never pollute the operative-clause catalog. Detection runs on RAW
 * paragraph text (before normalization folds signature blanks away).
 *
 * Pure module: strings in, category out.
 */

export const EXECUTION_BLOCK_PATTERNS: readonly RegExp[] = [
  /\bIN\s+WITNESS\s+WHEREOF\b/i,
  /\bsigned,?\s+sealed,?\s+and\s+delivered\b/i,
  /\bsworn\s+to\s+and\s+subscribed\b/i,
  /\bnotary\s+public\b/i,
  /\bwitness(?:eth)?\s+as\s+to\s+signature\b/i,
];

/** A paragraph that is nothing but a signature line: "________________". */
export const SIGNATURE_LINE_RE = /^\s*_+\s*$/;

export const EXECUTION_BLOCK_CATEGORY = 'execution-block' as const;

export type ExecutionBlockCategory = typeof EXECUTION_BLOCK_CATEGORY;

/**
 * Detect an execution block: any attestation/jurat/notary pattern hit, or
 * any signature-line paragraph, categorizes the block 'execution-block'
 * (§4.2). Returns null for operative text.
 */
export function detectExecutionBlock(
  paragraphs: readonly string[] | string,
): ExecutionBlockCategory | null {
  const paras = typeof paragraphs === 'string' ? [paragraphs] : paragraphs;
  for (const para of paras) {
    if (SIGNATURE_LINE_RE.test(para)) return EXECUTION_BLOCK_CATEGORY;
    for (const re of EXECUTION_BLOCK_PATTERNS) {
      if (re.test(para)) return EXECUTION_BLOCK_CATEGORY;
    }
  }
  return null;
}

/** Convenience boolean form. */
export function isExecutionBlock(
  paragraphs: readonly string[] | string,
): boolean {
  return detectExecutionBlock(paragraphs) !== null;
}
