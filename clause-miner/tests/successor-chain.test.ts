import { describe, expect, it } from 'vitest';
import { collapseSuccessorChains } from '../src/successor-chain.js';

describe('collapseSuccessorChains (§4.2)', () => {
  it('collapses a single-link chain', () => {
    const { text, depths } = collapseSuccessorChains(
      'If {{TRUSTEE_1}} fails to serve, then {{SUCCESSOR_TRUSTEE_1}} shall serve as Trustee.',
    );
    expect(text).toContain('{{SUCCESSOR_CHAIN}} {{CHAIN_DEPTH}}');
    expect(text).not.toContain('{{TRUSTEE_1}}');
    expect(depths).toEqual([1]);
  });

  it('collapses a multi-link chain to ONE token with depth preserved', () => {
    const { text, depths } = collapseSuccessorChains(
      'If {{TRUSTEE_1}} fails to serve, then {{SUCCESSOR_TRUSTEE_1}} shall serve; ' +
        'if {{SUCCESSOR_TRUSTEE_1}} is unable to serve, {{SUCCESSOR_TRUSTEE_2}} shall serve.',
    );
    expect(text.match(/\{\{SUCCESSOR_CHAIN\}\}/g)).toHaveLength(1);
    expect(depths).toEqual([2]);
  });

  it('chain-depth variants fold to the SAME collapsed text (one family)', () => {
    const two = collapseSuccessorChains(
      'If {{TRUSTEE_1}} ceases to act, {{SUCCESSOR_TRUSTEE_1}} shall act; ' +
        'if {{SUCCESSOR_TRUSTEE_1}} ceases to act, {{SUCCESSOR_TRUSTEE_2}} shall act.',
    ).text;
    const one = collapseSuccessorChains(
      'If {{TRUSTEE_1}} ceases to act, {{SUCCESSOR_TRUSTEE_1}} shall act.',
    ).text;
    expect(two).toBe(one);
  });

  it('leaves non-chain text untouched', () => {
    const input = 'The Trustee shall distribute income to {{CHILD_1}} at age {{AGE}}.';
    const { text, depths } = collapseSuccessorChains(input);
    expect(text).toBe(input);
    expect(depths).toEqual([]);
  });
});
