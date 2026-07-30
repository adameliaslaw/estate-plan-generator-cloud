/**
 * Central threshold configuration for the clause-mining pipeline.
 *
 * Every number the design of record (docs/CLAUSE-MINING-PIPELINE.md) commits
 * to lives here, in one place, with a citation to the section that sets it.
 * Stages must read from this object — no threshold literals in stage code —
 * so a calibration-driven change (§4.3 "thresholds are calibrated, not
 * asserted") is a one-line, ledgered diff.
 */
export const config = {
  /** §4.1 Reflow pre-pass — hard-wrap detection for WP-era conversions. */
  reflow: {
    /** §4.1: median paragraph length < 90 chars ⇒ treat as hard-wrapped. */
    medianParaChars: 90,
    /** §4.1: sentence-final-punctuation rate < 40% ⇒ treat as hard-wrapped. */
    sentencePunctRate: 0.4,
  },

  /** §4.2 Segmentation — two-sided anomaly gates + grammar limits. */
  segmentation: {
    /**
     * §4.2 signal 4 / two-sided gates: fewer than 1 boundary per 4,000 chars
     * after reflow ⇒ under-segmented ⇒ flag for the haiku boundary fallback.
     */
    underSegCharsPerBoundary: 4000,
    /**
     * §4.2 two-sided gates: more than 1 boundary per 300 chars ⇒
     * over-segmented ⇒ reflow re-run, then quarantine.
     */
    overSegCharsPerBoundary: 300,
    /** §4.2 signal 3 text grammar: ALL-CAPS heading lines are ≤ 70 chars. */
    capsHeadingMaxChars: 70,
  },

  /** §4.3 Ring 1 — MinHash variant-candidate generation. */
  minhash: {
    /** §4.3 Ring 1: 128-permutation MinHash. */
    numPermutations: 128,
    /** §4.3 Ring 1: 5-gram word shingles over sigText. */
    shingleSize: 5,
    /**
     * §4.3 Ring 1 LSH banding: 32 bands × 4 rows = 128 permutations.
     * (1/32)^(1/4) ≈ 0.42 candidate threshold — deliberately generous, since
     * Ring 1 only PROPOSES pairs; the diff filter + sonnet adjudication
     * decide (§4.3: "no unadjudicated non-exact merge"). Band/row split is
     * tunable during seed calibration (§4.3, §11 P1).
     */
    lshBands: 32,
    lshRows: 4,
  },

  /** §4.2 Enumerated-list sections — item-set identity. */
  itemSet: {
    /**
     * §4.2: families of enumerated-list sections (e.g. trustee powers) match
     * on Jaccard over item-hash sets ≥ 0.7, so power lists differing by one
     * inserted item (the digital-assets power) still align.
     */
    jaccardThreshold: 0.7,
  },

  /** §4.3 Ring 2 — embedding cosine bands (candidates only, never deciders). */
  ring2: {
    /** §4.3 Ring 2: cosine ≥ 0.92 PROPOSES a cross-era merge (adjudication confirms). */
    cosinePropose: 0.92,
    /** §4.3 Ring 2: cosine 0.80–0.92 creates a `relatedTo` edge, never merged. */
    cosineRelated: 0.8,
  },

  /** §10 / §15 — spend controls (Adam-approved 2026-07-30). */
  spend: {
    /** §10, §15(8): pilot LLM spend ceiling — $350 (estimate ≈ $215). */
    pilotCeilingUsd: 350,
    /**
     * §3, §10, §15(8): daily circuit breaker — $250/day for the pilot
     * (the wills pipeline's $50/day would trip mid-run).
     */
    dailyBreakerUsd: 250,
  },
} as const;

export type ClauseMinerConfig = typeof config;
