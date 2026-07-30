import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';

describe('config (design-of-record thresholds)', () => {
  it('carries the §4.1 reflow thresholds', () => {
    expect(config.reflow.medianParaChars).toBe(90);
    expect(config.reflow.sentencePunctRate).toBe(0.4);
  });

  it('carries the §4.2 two-sided segmentation gates', () => {
    expect(config.segmentation.underSegCharsPerBoundary).toBe(4000);
    expect(config.segmentation.overSegCharsPerBoundary).toBe(300);
    expect(config.segmentation.capsHeadingMaxChars).toBe(70);
  });

  it('carries the §4.3 Ring 1 MinHash parameters, with consistent banding', () => {
    expect(config.minhash.numPermutations).toBe(128);
    expect(config.minhash.shingleSize).toBe(5);
    expect(config.minhash.lshBands * config.minhash.lshRows).toBe(
      config.minhash.numPermutations,
    );
  });

  it('carries the §4.2 item-set Jaccard threshold', () => {
    expect(config.itemSet.jaccardThreshold).toBe(0.7);
  });

  it('carries the §4.3 Ring 2 cosine bands', () => {
    expect(config.ring2.cosinePropose).toBe(0.92);
    expect(config.ring2.cosineRelated).toBe(0.8);
    expect(config.ring2.cosinePropose).toBeGreaterThan(config.ring2.cosineRelated);
  });

  it('carries the §10/§15 spend controls', () => {
    expect(config.spend.pilotCeilingUsd).toBe(350);
    expect(config.spend.dailyBreakerUsd).toBe(250);
  });
});
