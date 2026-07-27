/**
 * Integer-cents money helpers.
 *
 * Ported from `@elias/foundation` (elias-estate-suite) — the ONLY dependency the NJ
 * inheritance-tax engine had outside its own tree. Kept local so the engine stays a
 * self-contained, dependency-free module inside this repo.
 *
 * Every figure the engine computes is held in integer cents and only converted at the
 * boundary; that is what keeps the gold-case figures exact.
 */

/** Dollars → integer cents (half-up at the cent). */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Integer cents → dollars. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** Round a fractional cent amount to a whole cent (half-up). */
export function roundCents(cents: number): number {
  return Math.round(cents);
}
