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

/**
 * Raised when the matter is in scope but the form cannot be produced from it yet — no filing
 * extension is recorded for an IT-EXT, the estate is taxable so an L-9(A) is not the right
 * filing, the death is after the estate tax was repealed.
 *
 * Distinct from {@link UnsupportedMatterError}: nothing is wrong with the matter, and the
 * attorney can usually act on the message. The API maps it to `failed-precondition` so the
 * caller sees the reason rather than an opaque `internal`.
 */
export class FormPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormPreconditionError';
    Object.setPrototypeOf(this, FormPreconditionError.prototype);
  }
}
