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
    /** Shingle cap per sigText — see minhashSignature. */
    maxShinglesPerText: 5_000,
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
  identity: {
    /**
     * Hard guard on Ring-1 adjudication pairs: beyond this, the run fails
     * with counts named instead of OOMing or submitting an unaffordable
     * batch (~$0.004/pair — 40k ≈ $160, already past the §10 envelope).
     */
    maxAdjudicationPairs: 40_000,
    /**
     * Item hashes shared by more than this many sections are stop-word-like
     * boilerplate: pairing every sharer is quadratic and non-discriminative.
     */
    maxItemBucket: 100,
  },

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

  /** §8 — LibreOffice conversion batching. */
  convert: {
    /** §8: bytes downloaded via Range request for magic sniffing. */
    sniffBytes: 8,
    /** §8: 25 files per soffice invocation (batched, warm profile). */
    batchSize: 25,
    /** §8: 60 s kill timer per soffice invocation; profile wipe on crash. */
    killTimerMs: 60_000,
  },

  /** §3 Stage 2 — triage classify. */
  triage: {
    /** ~1,500 tokens of text for the haiku classifier (≈4 chars/token). */
    triageChars: 6000,
  },

  /** §7.2 — counting units. */
  countingUnits: {
    /** §7.2: full-doc SimHash similarity ≥ 0.97 collapses drafts in-matter. */
    simhashCollapse: 0.97,
  },

  /** §6.2 / §11 Gate 3 — canonical selection. */
  canonical: {
    /** §7 Stage 7: min-support ≥ 3 distinct counting units per cluster. */
    minSupport: 3,
    /** §6.2: matched-seed token-Levenshtein < 0.80 flags `seed-divergent`. */
    seedDivergenceLevenshtein: 0.8,
    /** §6.2: era weighting — newest-era occurrence weight multiplier. */
    newestEraWeight: 2,
  },

  /** §11 P1 — seed calibration (clause-library segmentation + labeled pairs). */
  calibration: {
    /**
     * §11 P1(b): ~30 same/different pairs Adam labels, sampled from the
     * pilot's own candidate band (active learning — the pairs nearest the
     * decision boundary, where a threshold change actually flips an answer).
     */
    labelPairCount: 30,
    /** §11 P1(c): representative trusts spanning eras for hand-marked boundaries. */
    handMarkDocCount: 5,
    /**
     * Band the label sample is drawn from. Below this nothing is a plausible
     * merge; above it the diff filter has already decided. Pairs are ranked
     * by distance from the band midpoint.
     */
    labelBand: { low: 0.6, high: 0.98 },
    /**
     * §4.3: LSH band/row splits searched during tuning. bands × rows must
     * equal minhash.numPermutations — the signature length is fixed.
     */
    lshGrid: [
      { lshBands: 16, lshRows: 8 },
      { lshBands: 32, lshRows: 4 },
      { lshBands: 64, lshRows: 2 },
    ],
  },

  /** §11 P3 — validation gates (all must pass before Adam reviews). */
  gates: {
    /** Gate 1: ≥ 90% of trust-relevant seed clauses land in some mined family. */
    recallMin: 0.9,
    /**
     * Gate 3: divergence is a DIAGNOSTIC, not a promotion rule (§6.2 amended
     * — Adam's decision #2). The gate fails only when more than half of the
     * matched families diverge, which indicates a normalization/clustering
     * defect rather than genuine drafting drift.
     */
    seedDivergentMaxShare: 0.5,
    /** Gate 4: ≥ 90% of the excluded canary file's clauses re-derived. */
    canaryRecallMin: 0.9,
  },

  /** §7.3 — trigger-card statistics gate. */
  stats: {
    liftHigh: 2.0,
    liftLow: 0.5,
    pAdjMax: 0.01,
    minN: 10,
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
