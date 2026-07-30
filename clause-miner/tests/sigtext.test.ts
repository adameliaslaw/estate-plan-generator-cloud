import { describe, expect, it } from 'vitest';
import { normalize } from '../src/core/normalize.js';
import { ring0Hash, toSigText } from '../src/core/sigtext.js';

describe('toSigText (§5.2 fold)', () => {
  it('flattens ordinal role placeholders to their role', () => {
    expect(toSigText('{{CHILD_2}} and {{TRUSTEE_3}} and {{CHILD_1}}')).toBe(
      '{{child}} and {{trustee}} and {{child}}',
    );
  });

  it('neutralizes gendered pronoun sets', () => {
    const a = toSigText(
      'He shall distribute the principal to his issue, and he may act for himself.',
    );
    const b = toSigText(
      'She shall distribute the principal to her issue, and she may act for herself.',
    );
    expect(a).toBe(b);
    expect(a).toContain('they shall distribute');
    expect(a).toContain('their issue');
    expect(a).toContain('themself');
  });

  it('folds spelled number phrases to a single #', () => {
    expect(toSigText('divide the trust into two equal shares')).toBe(
      'divide the trust into # equal shares',
    );
    expect(toSigText('twenty-five')).toBe('#');
    expect(toSigText('one hundred twenty')).toBe('#');
  });

  it('collapses punctuation and whitespace', () => {
    const a = toSigText('the trust; and   the estate.');
    const b = toSigText('the trust, and the estate');
    expect(a).toBe(b);
  });

  it('keeps placeholders intact as tokens', () => {
    const sig = toSigText('shall survive by {{DURATION}}, then {{XREF:Article V}}');
    expect(sig).toContain('{{duration}}');
    expect(sig).toContain('{{xref');
  });

  it('applies the successor-chain collapse hook first', () => {
    const hook = (t: string): string =>
      t.replace(/if .+ fails to serve.*$/i, '{{SUCCESSOR_CHAIN}}');
    const sig = toSigText(
      'I appoint {{TRUSTEE_1}}. If {{TRUSTEE_1}} fails to serve, then {{TRUSTEE_2}}; if {{TRUSTEE_2}} fails, then {{TRUSTEE_3}}.',
      { chainCollapse: hook },
    );
    expect(sig).toBe('i appoint {{trustee}} {{successor_chain}}');
  });

  it('CRITICAL: 30-day and 60-day survivorship clauses fold to IDENTICAL sigText', () => {
    const a = normalize(
      'If any beneficiary fails to survive me by thirty (30) days, such beneficiary shall be deemed to have predeceased me.',
    );
    const b = normalize(
      'If any beneficiary fails to survive me by sixty (60) days, such beneficiary shall be deemed to have predeceased me.',
    );
    const sigA = toSigText(a.normText);
    const sigB = toSigText(b.normText);
    expect(sigA).toBe(sigB);
    expect(ring0Hash(sigA)).toBe(ring0Hash(sigB));
    // …while the distinguishing values live on as parameters (§4.3 Ring 0).
    expect(a.parameters.DURATION).toEqual(['thirty (30) days']);
    expect(b.parameters.DURATION).toEqual(['sixty (60) days']);
  });

  it('makes party-arity differences collapse (CHILD_1 vs CHILD_2 references)', () => {
    const a = toSigText('the share of {{CHILD_1}} shall be held in trust');
    const b = toSigText('the share of {{CHILD_2}} shall be held in trust');
    expect(a).toBe(b);
  });
});

describe('ring0Hash (§4.3 Ring 0)', () => {
  it('returns a 64-char hex SHA-256', () => {
    expect(ring0Hash('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic and content-sensitive', () => {
    const s = toSigText('the trustee shall serve without bond');
    expect(ring0Hash(s)).toBe(ring0Hash(s));
    expect(ring0Hash(s)).not.toBe(
      ring0Hash(toSigText('the trustee shall serve with bond')),
    );
  });
});
