import { describe, expect, it } from 'vitest';
import {
  classifyDiff,
  hardRoute,
  LEGAL_DELTA_LEXICON,
  tokenDiff,
} from '../src/core/diff.js';
import { normalize } from '../src/core/normalize.js';
import { toSigText } from '../src/core/sigtext.js';

/** Convenience: raw clause text → sigText, as the identity stage would. */
function sig(text: string): string {
  return toSigText(normalize(text).normText);
}

describe('tokenDiff', () => {
  it('returns a single equal op for identical texts', () => {
    const ops = tokenDiff('the trustee shall serve', 'the trustee shall serve');
    expect(ops).toEqual([
      { type: 'equal', tokens: ['the', 'trustee', 'shall', 'serve'] },
    ]);
  });

  it('localizes a one-token substitution', () => {
    const ops = tokenDiff(
      'distribute to my descendants per stirpes',
      'distribute to my descendants per capita',
    );
    const deleted = ops.filter((o) => o.type === 'delete').flatMap((o) => o.tokens);
    const inserted = ops.filter((o) => o.type === 'insert').flatMap((o) => o.tokens);
    expect(deleted).toEqual(['stirpes']);
    expect(inserted).toEqual(['capita']);
  });

  it('handles pure insertions', () => {
    const ops = tokenDiff('pay the income', 'pay the income and principal');
    const inserted = ops.filter((o) => o.type === 'insert').flatMap((o) => o.tokens);
    expect(inserted).toEqual(['and', 'principal']);
  });
});

describe('classifyDiff (§4.3 diff filter)', () => {
  it('classifies identical sigTexts as trivial', () => {
    const a = sig('The Trustee shall serve without bond.');
    expect(classifyDiff(a, a).classification).toBe('trivial');
  });

  it('classifies placeholder-only differences as trivial (auto-merge)', () => {
    const a = 'the trustee shall distribute the share of {{child}} upon reaching age {{age}}';
    const b = 'the trustee shall distribute the share of {{spouse}} upon reaching age {{age}}';
    const result = classifyDiff(a, b);
    expect(result.classification).toBe('trivial');
    expect(result.hardRoute).toBe(false);
  });

  it('classifies punctuation/case differences as trivial', () => {
    const result = classifyDiff(
      'the Trustee shall pay the net income, quarterly',
      'the trustee shall pay the net income quarterly',
    );
    expect(result.classification).toBe('trivial');
  });

  it('classifies any content-word difference as content — no auto-merge band', () => {
    const result = classifyDiff(
      sig('The Trustee shall pay the entire net income to the beneficiary.'),
      sig('The Trustee shall pay so much of the net income to the beneficiary.'),
    );
    expect(result.classification).toBe('content');
  });

  it('CRITICAL: per stirpes vs per capita is content AND hard-routes to adjudication', () => {
    const a = sig(
      'Upon my death, the remaining trust estate shall be distributed to my then living descendants, per stirpes.',
    );
    const b = sig(
      'Upon my death, the remaining trust estate shall be distributed to my then living descendants, per capita.',
    );
    const result = classifyDiff(a, b);
    expect(result.classification).toBe('content');
    expect(result.hardRoute).toBe(true);
    expect(hardRoute(a, b)).toBe(true);
  });
});

describe('hardRoute — legal-delta lexicon (§4.3)', () => {
  it('routes shall vs may', () => {
    expect(
      hardRoute(
        sig('The Trustee shall distribute the principal.'),
        sig('The Trustee may distribute the principal.'),
      ),
    ).toBe(true);
  });

  it('routes without bond vs with bond', () => {
    expect(
      hardRoute(
        sig('Each fiduciary shall serve without bond.'),
        sig('Each fiduciary shall serve with bond.'),
      ),
    ).toBe(true);
  });

  it('routes income vs income and principal', () => {
    expect(
      hardRoute(
        sig('The Trustee shall pay the income to my spouse.'),
        sig('The Trustee shall pay the income and principal to my spouse.'),
      ),
    ).toBe(true);
  });

  it('routes negation flips (not)', () => {
    expect(
      hardRoute(
        sig('The Trustee shall be required to account annually.'),
        sig('The Trustee shall not be required to account annually.'),
      ),
    ).toBe(true);
  });

  it('routes revocable vs irrevocable', () => {
    expect(
      hardRoute(
        sig('This trust shall be revocable during my lifetime.'),
        sig('This trust shall be irrevocable during my lifetime.'),
      ),
    ).toBe(true);
  });

  it('routes outright vs in trust', () => {
    expect(
      hardRoute(
        sig('The share of each child shall be distributed outright.'),
        sig('The share of each child shall be held in trust.'),
      ),
    ).toBe(true);
  });

  it('routes at each generation appearing in the diff region', () => {
    expect(
      hardRoute(
        sig('to my descendants, per stirpes'),
        sig('to my descendants, per stirpes at each generation'),
      ),
    ).toBe(true);
  });

  it('does NOT route a pure placeholder swap even near lexicon words', () => {
    // 'shall' appears on both sides unchanged — single-word terms only test
    // the genuinely changed tokens.
    expect(
      hardRoute(
        'the trustee shall distribute to {{child}}',
        'the trustee shall distribute to {{spouse}}',
      ),
    ).toBe(false);
  });

  it('does NOT route identical texts', () => {
    const a = sig('The Trustee may waive any accounting.');
    expect(hardRoute(a, a)).toBe(false);
  });

  it('routes HEMS-standard vs sole-discretion changes', () => {
    expect(
      hardRoute(
        sig(
          'The Trustee shall distribute principal for the health, education, maintenance and support of the beneficiary.',
        ),
        sig(
          'The Trustee shall distribute principal in the sole and absolute discretion of the Trustee.',
        ),
      ),
    ).toBe(true);
  });
});

describe('LEGAL_DELTA_LEXICON contents', () => {
  it('contains the §4.3 seed terms', () => {
    for (const term of [
      'per stirpes',
      'per capita',
      'at each generation',
      'shall',
      'may',
      'without',
      'income',
      'principal',
      'revocable',
      'irrevocable',
      'outright',
      'in trust',
      'bond',
      'lapse',
      'vest',
      'qtip',
      'disclaimer',
      'springing',
      'immediate',
    ]) {
      expect(LEGAL_DELTA_LEXICON).toContain(term);
    }
  });
});
