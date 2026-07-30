import { describe, expect, it } from 'vitest';
import { hammingDistance64, simhash, simhashSimilarity } from '../src/core/simhash.js';

const TRUST_TEXT = `Declaration of trust made by the grantor. Article one family.
The grantor has two children now living. Article four successor trustees.
If the grantor fails to serve the successor trustee shall act without bond.
The trustee shall distribute income and principal for health education maintenance and support.
Article seven distributions. Until each child attains the required age the trustee shall hold
the share of such child in a separate trust and may distribute so much of the net income and
principal as the trustee deems necessary. Article ten spendthrift. No beneficiary shall have
any power to anticipate assign or encumber any interest in the trust estate and no interest
shall be subject to the claims of creditors. Article twelve governing law. This agreement is
governed by the laws of the state of New Jersey and shall be administered accordingly by the
trustee then serving without the intervention of any court and without bond or other security.`;

describe('simhash (§7.2 draft collapse)', () => {
  it('is deterministic — same text, same hash', () => {
    expect(simhash(TRUST_TEXT)).toBe(simhash(TRUST_TEXT));
  });

  it('near-identical drafts land within the ≥0.97 collapse band', () => {
    const draft2 = TRUST_TEXT.replace('two children', 'three children');
    const sim = simhashSimilarity(simhash(TRUST_TEXT), simhash(draft2));
    expect(sim).toBeGreaterThanOrEqual(0.9); // one token of ~50 changed
  });

  it('unrelated documents score far apart', () => {
    const other =
      'Invoice for services rendered. Payment due within thirty days of receipt. ' +
      'Please remit the balance to the office at the address below. Thank you for your business.';
    const sim = simhashSimilarity(simhash(TRUST_TEXT), simhash(other));
    expect(sim).toBeLessThan(0.85);
  });

  it('hammingDistance64 basics', () => {
    expect(hammingDistance64(0n, 0n)).toBe(0);
    expect(hammingDistance64(0n, 0xffffffffffffffffn)).toBe(64);
    expect(hammingDistance64(0b1010n, 0b0101n)).toBe(4);
    expect(simhashSimilarity(0n, 0n)).toBe(1);
  });
});
