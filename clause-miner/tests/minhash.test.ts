import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import {
  candidatePairs,
  itemSetJaccard,
  jaccardFromSignatures,
  minhashSignature,
  shingles,
} from '../src/core/minhash.js';

const spendthrift =
  'no beneficiary shall have the power to anticipate encumber or assign any interest in the trust estate and no interest shall be subject to the claims of creditors of any beneficiary prior to actual receipt';

const spendthriftVariant =
  'no beneficiary shall have the power to anticipate encumber or assign any interest in the trust estate and no interest shall be subject to the claims of any creditor of any beneficiary prior to actual distribution';

const unrelated =
  'the trustee shall furnish an annual accounting to each income beneficiary showing all receipts disbursements and distributions of the trust during the accounting period';

describe('shingles (§4.3 Ring 1)', () => {
  it('produces 5-gram word shingles by default', () => {
    const s = shingles('a b c d e f g');
    expect(s).toEqual(new Set(['a b c d e', 'b c d e f', 'c d e f g']));
  });

  it('uses the whole text when shorter than the shingle size', () => {
    expect(shingles('short clause text')).toEqual(new Set(['short clause text']));
  });

  it('returns empty set for empty text', () => {
    expect(shingles('   ').size).toBe(0);
  });
});

describe('minhashSignature (§4.3 Ring 1)', () => {
  it('has 128 components (config.minhash.numPermutations)', () => {
    expect(minhashSignature(spendthrift)).toHaveLength(
      config.minhash.numPermutations,
    );
  });

  it('is deterministic — no Math.random anywhere', () => {
    const a = minhashSignature(spendthrift);
    const b = minhashSignature(spendthrift);
    expect([...a]).toEqual([...b]);
  });

  it('estimates Jaccard ~1 for identical texts', () => {
    const a = minhashSignature(spendthrift);
    expect(jaccardFromSignatures(a, minhashSignature(spendthrift))).toBe(1);
  });

  it('estimates Jaccard near 0 for unrelated clauses', () => {
    const a = minhashSignature(spendthrift);
    const b = minhashSignature(unrelated);
    expect(jaccardFromSignatures(a, b)).toBeLessThan(0.2);
  });

  it('estimate tracks true shingle Jaccard within 0.15', () => {
    const setA = shingles(spendthrift);
    const setB = shingles(spendthriftVariant);
    const trueJaccard = itemSetJaccard(setA, setB);
    const estimate = jaccardFromSignatures(
      minhashSignature(spendthrift),
      minhashSignature(spendthriftVariant),
    );
    expect(Math.abs(estimate - trueJaccard)).toBeLessThan(0.15);
    expect(trueJaccard).toBeGreaterThan(0.5); // sanity: these ARE near-dupes
  });
});

describe('candidatePairs (§4.3 Ring 1 LSH banding)', () => {
  it('proposes near-duplicate pairs and skips unrelated ones', () => {
    const entries = [
      { id: 'a', signature: minhashSignature(spendthrift) },
      { id: 'b', signature: minhashSignature(spendthriftVariant) },
      { id: 'c', signature: minhashSignature(unrelated) },
    ];
    const pairs = [...candidatePairs(entries)];
    expect(pairs).toContainEqual(['a', 'b']);
    expect(pairs).not.toContainEqual(['a', 'c']);
    expect(pairs).not.toContainEqual(['b', 'c']);
  });

  it('emits each pair only once across bands', () => {
    const entries = [
      { id: 'a', signature: minhashSignature(spendthrift) },
      { id: 'b', signature: minhashSignature(spendthrift) },
    ];
    const pairs = [...candidatePairs(entries)];
    expect(pairs).toEqual([['a', 'b']]);
  });
});

describe('itemSetJaccard (§4.2 enumerated-list identity)', () => {
  /** A trustee powers list, one item hash per enumerated power. */
  const powers = [
    'retain-property',
    'sell-exchange-convey',
    'invest-reinvest',
    'borrow-money',
    'lease-beyond-term',
    'vote-securities',
    'employ-agents',
    'distribute-in-kind',
    'settle-claims',
    'allocate-receipts',
  ];

  it('CRITICAL: a power list with one inserted item stays >= 0.7 (digital-assets case)', () => {
    const modern = [...powers, 'access-digital-assets'];
    const j = itemSetJaccard(powers, modern);
    expect(j).toBeCloseTo(10 / 11, 5);
    expect(j).toBeGreaterThanOrEqual(config.itemSet.jaccardThreshold);
  });

  it('a power list missing one item also stays >= 0.7', () => {
    const shorter = powers.slice(0, 9);
    expect(itemSetJaccard(powers, shorter)).toBeGreaterThanOrEqual(
      config.itemSet.jaccardThreshold,
    );
  });

  it('substantially different lists fall below the threshold', () => {
    const other = [
      'retain-property',
      'sell-exchange-convey',
      'pay-debts',
      'divide-shares',
      'terminate-small-trust',
      'merge-trusts',
      'remove-trustee',
      'appoint-successor',
    ];
    expect(itemSetJaccard(powers, other)).toBeLessThan(
      config.itemSet.jaccardThreshold,
    );
  });

  it('handles identical and empty sets', () => {
    expect(itemSetJaccard(powers, powers)).toBe(1);
    expect(itemSetJaccard([], [])).toBe(1);
    expect(itemSetJaccard(powers, [])).toBe(0);
  });
});
