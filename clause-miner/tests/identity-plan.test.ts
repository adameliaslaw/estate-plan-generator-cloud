import { describe, expect, it } from 'vitest';
import {
  collectUniqueSignatures,
  cosine,
  pairId,
  planRing1,
  type UniqueSignature,
} from '../src/stages/identity.js';
import type { SegmentsArtifact } from '../src/stages/segment-normalize.js';

function sig(overrides: Partial<UniqueSignature> & { ring0Hash: string; sigText: string }): UniqueSignature {
  return {
    normText: overrides.sigText,
    itemSet: null,
    executionBlock: false,
    clusterSeed: true,
    occurrenceCount: 1,
    ...overrides,
  };
}

const BASE =
  'the trustee shall distribute the net income of the trust to the beneficiaries in equal shares ' +
  'until each beneficiary attains the age of # years at which time the share shall vest';

describe('collectUniqueSignatures', () => {
  function artifact(id: string, hashes: string[], confidence: string): { artifact: SegmentsArtifact; structureConfidence: string } {
    return {
      structureConfidence: confidence,
      artifact: {
        driveFileId: id,
        textArtifactPath: 't',
        parserVersion: 'v1',
        reflowed: false,
        flags: [],
        structureConfidence: confidence,
        segments: hashes.map((h, i) => ({
          segmentIndex: i,
          articleIndex: 1,
          sectionIndex: i,
          charSpan: [0, 1] as [number, number],
          normText: `text ${h}`,
          sigText: `text ${h}`,
          ring0Hash: h,
          structureSignal: 'style',
          executionBlock: false,
          parameters: {},
          itemSet: null,
        })),
      },
    };
  }

  it('deduplicates by hash, counts occurrences, and tracks seedability', () => {
    const uniques = collectUniqueSignatures([
      artifact('a', ['h1', 'h2'], 'ooxml'),
      artifact('b', ['h1'], 'none'),
      artifact('c', ['h3'], 'none'),
    ]);
    const byHash = new Map(uniques.map((u) => [u.ring0Hash, u]));
    expect(byHash.get('h1')?.occurrenceCount).toBe(2);
    expect(byHash.get('h1')?.clusterSeed).toBe(true); // any structured doc suffices
    expect(byHash.get('h3')?.clusterSeed).toBe(false); // 'none' never seeds (§4.2)
  });
});

describe('planRing1 (§4.3 — no unadjudicated non-exact merge)', () => {
  it('routes placeholder-only diffs to auto-merge', () => {
    const a = sig({ ring0Hash: 'a'.repeat(64), sigText: `${BASE} {{child}}` });
    const b = sig({ ring0Hash: 'b'.repeat(64), sigText: `${BASE} {{beneficiary}}` });
    const plan = planRing1([a, b]);
    expect(plan.autoMergeEdges).toHaveLength(1);
    expect(plan.autoMergeEdges[0].kind).toBe('trivial');
    expect(plan.adjudicationPairs).toHaveLength(0);
  });

  it('routes ANY content-word diff to adjudication — no auto-merge band', () => {
    const a = sig({ ring0Hash: 'a'.repeat(64), sigText: `${BASE} distributed quarterly` });
    const b = sig({ ring0Hash: 'b'.repeat(64), sigText: `${BASE} distributed annually` });
    const plan = planRing1([a, b]);
    expect(plan.autoMergeEdges).toHaveLength(0);
    expect(plan.adjudicationPairs).toHaveLength(1);
  });

  it('hard-routes legal-delta lexicon diffs (per stirpes vs per capita)', () => {
    const a = sig({ ring0Hash: 'a'.repeat(64), sigText: `${BASE} per stirpes` });
    const b = sig({ ring0Hash: 'b'.repeat(64), sigText: `${BASE} per capita` });
    const plan = planRing1([a, b]);
    expect(plan.adjudicationPairs).toHaveLength(1);
  });

  it('never seeds candidates from structureConfidence-none signatures', () => {
    const a = sig({ ring0Hash: 'a'.repeat(64), sigText: `${BASE} {{child}}`, clusterSeed: false });
    const b = sig({ ring0Hash: 'b'.repeat(64), sigText: `${BASE} {{beneficiary}}`, clusterSeed: false });
    const plan = planRing1([a, b]);
    expect(plan.autoMergeEdges).toHaveLength(0);
    expect(plan.adjudicationPairs).toHaveLength(0);
  });

  it('item-set path: ±1-item lists with a TRIVIAL text diff auto-align at Jaccard ≥ 0.7 (§4.2)', () => {
    const items = ['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7'];
    const shared = 'trustee powers enumeration with shared surrounding boilerplate text here';
    const a = sig({ ring0Hash: 'a'.repeat(64), sigText: shared, itemSet: items });
    const b = sig({
      ring0Hash: 'b'.repeat(64),
      sigText: shared,
      itemSet: [...items, 'digital-assets'], // one inserted item
    });
    const plan = planRing1([a, b]);
    // Identical sigTexts are also LSH candidates, and the seen-key gives the
    // LSH classification first claim — the property under test is that a
    // trivial diff merges FREE through some ring-1 edge, never adjudicates.
    expect(plan.adjudicationPairs).toHaveLength(0);
    expect(plan.autoMergeEdges).toHaveLength(1);
    expect(plan.autoMergeEdges[0].merged).toBe(true);
  });

  it('item-set path: a CONTENT text diff adjudicates instead of auto-merging (C3)', () => {
    // The pilot-1 defect: overlapping item hashes excused a real content diff
    // in the surrounding text — two power lists differing by whole powers
    // could merge with no transcript. Content diffs now pay for adjudication.
    const items = ['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7'];
    const a = sig({
      ring0Hash: 'a'.repeat(64),
      sigText: 'powers list version one with many many differing filler tokens here',
      itemSet: items,
    });
    const b = sig({
      ring0Hash: 'b'.repeat(64),
      sigText: 'powers enumeration variant two with entirely different filler tokens here',
      itemSet: [...items, 'digital-assets'],
    });
    const plan = planRing1([a, b]);
    expect(plan.autoMergeEdges.filter((e) => e.kind === 'item-set')).toHaveLength(0);
    expect(plan.adjudicationPairs).toHaveLength(1);
    expect(plan.adjudicationPairs[0].scores.itemJaccard).toBeCloseTo(7 / 8, 10);
  });

  it('item-set below threshold produces nothing', () => {
    const a = sig({ ring0Hash: 'a'.repeat(64), sigText: 'x one', itemSet: ['i1', 'i2'] });
    const b = sig({ ring0Hash: 'b'.repeat(64), sigText: 'y two', itemSet: ['i3', 'i4'] });
    const plan = planRing1([a, b]);
    expect(plan.autoMergeEdges).toHaveLength(0);
  });

  it('is deterministic across invocations', () => {
    const inputs = [
      sig({ ring0Hash: 'a'.repeat(64), sigText: `${BASE} {{child}}` }),
      sig({ ring0Hash: 'b'.repeat(64), sigText: `${BASE} {{beneficiary}}` }),
      sig({ ring0Hash: 'c'.repeat(64), sigText: `${BASE} per stirpes` }),
    ];
    const p1 = planRing1(inputs);
    const p2 = planRing1([...inputs].reverse());
    expect(p1.autoMergeEdges.map((e) => [e.a, e.b])).toEqual(
      p2.autoMergeEdges.map((e) => [e.a, e.b]),
    );
  });
});

describe('cosine / pairId', () => {
  it('cosine basics', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });

  it('pairId is order-independent', () => {
    expect(pairId('a'.repeat(64), 'b'.repeat(64))).toBe(pairId('b'.repeat(64), 'a'.repeat(64)));
  });
});
