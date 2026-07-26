/**
 * NJ Transfer Inheritance Tax + NJ Estate Tax engine.
 *
 * Ported from `adameliaslaw/elias-estate-suite` (`apps/inherit`), which is itself the port of
 * `adameliaslaw/inheritnj`. This module is **pure TypeScript**: no Firebase, no network, no
 * browser. It computes a return from a validated `Matter` and builds the form data for the
 * IT-R, IT-Estate, IT-Ext and L-9(A).
 *
 * What makes it trustworthy is `tests/unit/inheritance-tax-gold-cases.test.ts` — the official
 * worked examples from the State's own IT-R instructions, reproduced to the cent:
 *   interest example $558.71 · Example 1 $191.43 · Class C exemption $8,250.
 * Those figures are the contract. If a change moves one, the change is wrong.
 *
 * Scope is deliberately bounded: unsupported estate structures (nonresident decedent,
 * pre-2002 death, deductions exceeding the estate, non-pro-rata apportionment) **throw
 * `UnsupportedMatterError`** rather than producing a plausible-but-wrong figure.
 *
 * NOT ported: PDF rendering (it needed a headless Chromium; this repo already renders PDF via
 * jspdf and DOCX via docxtemplater) and the standalone HTTP server (superseded by callable
 * Functions here).
 */
export * from './types';
export * from './engine';
export * from './rules';
export * from './validation';
export * from './forms';
export { UnsupportedMatterError } from './forms/errors';
export { toCents, fromCents, roundCents } from './money';
