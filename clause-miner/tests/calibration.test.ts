import { describe, expect, it } from 'vitest';
import {
  generateCandidatePairs,
  sampleLabelPairs,
  scoreBanding,
  seedNegativePairs,
  tuneBanding,
  type LabeledPair,
  type TextItem,
} from '../src/calibration.js';
import { normalize } from '../src/core/normalize.js';
import { toSigText } from '../src/core/sigtext.js';

function item(id: string, text: string, seedPieceId?: string): TextItem {
  const { normText } = normalize(text, []);
  return {
    id,
    normText,
    sigText: toSigText(normText),
    ...(seedPieceId !== undefined ? { seedPieceId } : {}),
  };
}

const SPENDTHRIFT =
  'No beneficiary shall have any right or power to anticipate, pledge, assign, sell, transfer, ' +
  'alienate or encumber his or her interest in the trust estate in any way, nor shall any such ' +
  'interest be liable for the debts or obligations of such beneficiary.';

function labeled(
  pairId: string,
  aText: string,
  bText: string,
  label: 'same' | 'different',
  source: LabeledPair['source'] = 'adam',
): LabeledPair {
  const a = item('a', aText);
  const b = item('b', bText);
  return { pairId, aId: 'a', bId: 'b', aText: a.sigText, bText: b.sigText, label, source };
}

describe('scoreBanding', () => {
  it('counts an auto-merged DIFFERENT pair as a false auto-merge', () => {
    // Typography-only difference: the diff filter calls it trivial, so it
    // auto-merges. Labeled different, that is the catastrophic error.
    const pair = labeled('p', SPENDTHRIFT, SPENDTHRIFT.toUpperCase(), 'different');
    const score = scoreBanding([pair], { lshBands: 32, lshRows: 4 });
    expect(score.falseAutoMerges).toBe(1);
    expect(score.falseAutoMergeIds).toEqual(['p']);
  });

  it('does not auto-merge a one-word legal difference', () => {
    const pair = labeled(
      'p',
      SPENDTHRIFT,
      SPENDTHRIFT.replace('shall have any right', 'may have any right'),
      'same',
    );
    const score = scoreBanding([pair], { lshBands: 32, lshRows: 4 });
    // It IS a candidate (LSH proposes it) but the diff filter routes it to
    // adjudication rather than merging — so recall on auto-merge is 0 and
    // candidate recall is 1. Under-merge is the safe direction.
    expect(score.candidateRecall).toBe(1);
    expect(score.autoMergeRecall).toBe(0);
    expect(score.falseAutoMerges).toBe(0);
  });

  it('scores a clean auto-merge of a SAME pair as a true positive', () => {
    const pair = labeled('p', SPENDTHRIFT, `${SPENDTHRIFT.toUpperCase()}  `, 'same');
    const score = scoreBanding([pair], { lshBands: 32, lshRows: 4 });
    expect(score.autoMergeRecall).toBe(1);
    expect(score.autoMergePrecision).toBe(1);
    expect(score.f1).toBe(1);
  });
});

describe('tuneBanding', () => {
  it('refuses to select a split when every one auto-merges a DIFFERENT pair', () => {
    // §4.3 / §13 risk 1: over-merge is the catastrophic error, so the tuner
    // fails the calibration rather than shipping the least-bad over-merger.
    const pairs = [
      labeled('bad', SPENDTHRIFT, SPENDTHRIFT.toUpperCase(), 'different'),
      labeled('good', SPENDTHRIFT, `${SPENDTHRIFT} `, 'same'),
    ];
    const result = tuneBanding(pairs);
    expect(result.selected).toBeNull();
    expect(result.failure).toContain('catastrophic error');
    // Every split is still SCORED, so the failure is diagnosable.
    expect(result.scores).toHaveLength(3);
  });

  it('selects the highest-F1 clean split', () => {
    const pairs = [
      labeled('same1', SPENDTHRIFT, `${SPENDTHRIFT}  `, 'same'),
      labeled(
        'diff1',
        SPENDTHRIFT,
        'The Trustee may in its sole and absolute discretion distribute principal to my spouse.',
        'different',
      ),
    ];
    const result = tuneBanding(pairs);
    expect(result.selected).not.toBeNull();
    expect(result.failure).toBeNull();
    const chosen = result.scores.find(
      (s) => s.lshBands === result.selected?.lshBands,
    );
    expect(chosen?.falseAutoMerges).toBe(0);
  });

  it('refuses to select without any SAME labels — recall is unmeasurable', () => {
    const result = tuneBanding([
      labeled('d', SPENDTHRIFT, 'Something entirely different about guardians.', 'different'),
    ]);
    expect(result.selected).toBeNull();
    expect(result.failure).toContain('no SAME-labeled pairs');
  });

  it('reports where each label came from', () => {
    const result = tuneBanding([
      labeled('s', SPENDTHRIFT, `${SPENDTHRIFT} `, 'same'),
      labeled('d', SPENDTHRIFT, 'Unrelated guardianship language.', 'different', 'seed-structure'),
    ]);
    expect(result.labelCounts).toMatchObject({ same: 1, different: 1, fromAdam: 1, fromSeed: 1 });
  });
});

describe('seedNegativePairs', () => {
  it('labels near-duplicate pairs from DIFFERENT curated pieces as different', () => {
    // Adam filed these as two pieces: that is a recorded split decision, and
    // it costs him nothing to reuse as a labeled negative.
    const items = [
      item('seed:p1', SPENDTHRIFT, 'p1'),
      item('seed:p2', SPENDTHRIFT.replace('in any way', 'in any manner'), 'p2'),
    ];
    const negatives = seedNegativePairs(items);
    expect(negatives).toHaveLength(1);
    expect(negatives[0].label).toBe('different');
    expect(negatives[0].source).toBe('seed-structure');
  });

  it('does not label a piece against itself', () => {
    const items = [item('seed:p1', SPENDTHRIFT, 'p1'), item('seed:p1b', SPENDTHRIFT, 'p1')];
    expect(seedNegativePairs(items)).toHaveLength(0);
  });

  it('ignores corpus items with no curated provenance', () => {
    const items = [item('seed:p1', SPENDTHRIFT, 'p1'), item('corpushash', SPENDTHRIFT)];
    expect(seedNegativePairs(items)).toHaveLength(0);
  });
});

describe('sampleLabelPairs', () => {
  const candidates = [0.99, 0.9, 0.79, 0.7, 0.5, 0.2].map((score, i) => ({
    pairId: `p${i}`,
    aId: 'a',
    bId: 'b',
    aText: 'a',
    bText: 'b',
    score,
    trivial: false,
  }));

  it('draws from the middle of the band, not the obvious ends', () => {
    // Band 0.60–0.98, midpoint 0.79 — Adam's hour goes to pairs where the
    // answer is genuinely in doubt, not to certain merges or certain splits.
    const sample = sampleLabelPairs(candidates, 2);
    expect(sample.map((p) => p.score)).toEqual([0.79, 0.7]);
  });

  it('excludes pairs outside the band', () => {
    const sample = sampleLabelPairs(candidates, 10);
    expect(sample.map((p) => p.score)).not.toContain(0.99);
    expect(sample.map((p) => p.score)).not.toContain(0.2);
  });

  it('is deterministic — a re-run does not re-ask a different set', () => {
    expect(sampleLabelPairs(candidates, 3)).toEqual(sampleLabelPairs(candidates, 3));
  });
});

describe('generateCandidatePairs', () => {
  it('marks the diff class so the packet shows what the pipeline would do', () => {
    const items = [
      item('a', SPENDTHRIFT),
      item('b', SPENDTHRIFT.replace('shall have any right', 'may have any right')),
    ];
    const pairs = generateCandidatePairs(items);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].trivial).toBe(false);
    expect(pairs[0].score).toBeGreaterThan(0.5);
  });

  it('honors an overridden banding', () => {
    const items = [item('a', SPENDTHRIFT), item('b', `${SPENDTHRIFT} extra sentence here.`)];
    const wide = generateCandidatePairs(items, { lshBands: 64, lshRows: 2 });
    const narrow = generateCandidatePairs(items, { lshBands: 16, lshRows: 8 });
    // More bands ⇒ looser candidate generation ⇒ never fewer candidates.
    expect(wide.length).toBeGreaterThanOrEqual(narrow.length);
  });
});
