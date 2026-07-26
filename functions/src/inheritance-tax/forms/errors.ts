/**
 * Typed errors for form generation.
 */

/**
 * Raised when a Matter falls outside the tool's supported scope and a form
 * therefore must not be generated (Phase 0 guardrail — see docs/CONSOLIDATION_PLAN.md).
 *
 * Current triggers:
 *  - Nonresident decedent on the IT-R / L-9 path. New Jersey requires a different
 *    return for nonresident decedents (Form IT-NR); this tool does not produce it,
 *    so generating a resident IT-R/L-9 would be the wrong official form.
 *
 * The API maps this to HTTP 422; the CLI exits non-zero with the message.
 */
export class UnsupportedMatterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedMatterError';
    Object.setPrototypeOf(this, UnsupportedMatterError.prototype);
  }
}
