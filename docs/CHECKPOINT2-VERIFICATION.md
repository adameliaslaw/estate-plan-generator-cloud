# Clause-Mining Pilot — Checkpoint #2 Adversarial Verification Report

## Part I — For Adam (plain prose)

### 1. Verdict on the five gate claims

**Gate 1 — "Seed recall 66/107 (61.7%), FAIL":** The arithmetic is real, but the number is **not a clean measure of pipeline quality — it is contaminated by at least three measurement artifacts.** First, the numbers don't reconcile: the gates imply 123 trust-relevant seed clauses while the seed run reports 130 — a 7-piece gap that is mathematically impossible from one consistent dataset, meaning the gates read a stale or different seed artifact (nothing in the system stamps versions, so it can't detect this itself). Second, seed pieces are cut off at signature/execution blocks while corpus segments are not, so at least 3 of the 41 "misses" (the signature-block pieces) are unmatchable by construction. Third, the candidate-proposal settings (16×8 banding) only propose a match 24–61% of the time for moderately-reworded variants, and each seed piece gets exactly one shot at adjudication. Verdict: **the FAIL stands, but treat 61.7% as a floor distorted by tooling, not a measurement of the miner.** One claimed cause was refuted: there is no seed/corpus segmenter-version mismatch in this run — but both sides were segmented under the *old* grammar with a known truncation bug, so a re-segment is still required before trusting any recall number.

**Gate 2 — "2 over-merged families, FAIL":** Contradicted in both directions. The gate measures the wrong thing (it looks at how the seed matched, never at the corpus merge that actually formed the family), it has a blind spot that makes 2 a **lower bound**, and its ground truth is likely wrong for the two flagged families anyway — DISCLAIMER WILL / (NEW) / (NEW) (JJB) are three revisions of one template file, so merging them is probably *correct* behavior flagged as a violation. Separately, a genuine over-merge path was found in code: enumerated power-lists can be silently merged despite real content differences, with no adjudication transcript. So the gate's number is unreliable, the gate's diagnosis ("tighten the whitelist") is a guess, and a real defect it should have caught exists.

**Gate 3 — "median seed divergence 1.000, PASS":** The pass is legitimate, but the headline is misleading: the reported value/threshold pair (1.0 vs 0.8) is not the actual pass rule, and the statistic covers only 16 families, not the 66 matched clauses. Honest, but over-read.

**Gate 4 — "canary recovery 9/16, FAIL":** Same contaminations as Gate 1 (denominator discrepancy, execution-block asymmetry, one-candidate matching), plus the count of 17 vs 16 canaries reconciles innocently. FAIL stands but the number is partly artifact.

**Gate 5 — "attorney precision: skipped":** Honestly reported as skipped, not passed. Confirmed.

**Bottom line:** the gates report is arithmetically honest and fails closed, but the two failing recall gates are measuring a mix of pipeline quality and measurement defects, and the purity gate is measuring the wrong mechanism against partly-wrong ground truth. Do not tune thresholds against these numbers as they stand.

### 2. What actually needs fixing, ranked

**Critical:**

1. **The PII "fail closed" promise is false.** All 281 blocked families were written to Firestore with their full clause text, readable by every attorney and paralegal in the firm. "Blocked" only stamps a flag; the only thing hiding the text is one filter in one dialog in the browser. Because 1,103 adjudications independently attested that real client names survive normalization, some of that shipped text plausibly contains real names. Exposure is firm-internal (staff can already read the source documents), so no client-facing breach — but the design promise and the security-rules comment are both currently untrue.
2. **The catalog's statistics are ~97% unvetted.** Only 10 of 4,800 tested correlations passed the significance gate, yet ~290 of the 300 trigger cards were narrated from "exploratory" rows that passed no statistical test at all — a tier so loose that 62% of all rows qualify — and the prose carries no disclaimer. An attorney reading a card cannot tell a finding from noise.
3. **Silent content merges are possible.** The enumerated-list merge path can join two clauses that differ by whole powers, with no transcript, contrary to the design's core invariant.

**Major:** the seven items detailed in the appendix — artifact-version stamping, the Ring-2 spend-guard bypass (75% of adjudication spend came through an uncapped path, blowing past the 40k ceiling), the dropped normalization-miss loop (1,103 known name-leaks counted and then ignored — the single highest-leverage fix, since one repair shrinks the PII block count, merges fragmented families, and lifts recall together), single-candidate seed matching, the execution-block asymmetry, Gate 2's blind spots and ground truth, and the one-sided support check on card statistics.

### 3. What cannot be verified from here

Everything below requires Firestore or GCS access and stayed undecided (deduplicated list in the appendix): the per-ring verdict split, the adjudication and PII transcripts, which artifact version the gates read, the actual text of the flagged families, the corpus segmentation stamps, actual spend vs. the ceiling, and whether any UI renders the PII/tier flags. None of the confirmed findings depend on these; several *magnitudes* do.

### 4. Recommended order of work

1. **Stop the PII exposure first** (small code change: skip or metadata-only writes for blocked families; fix before anyone browses the catalog). Independent of everything else.
2. **Fix measurement before re-mining:** version-stamp artifacts and hard-fail on mismatch; fix Gate 2 to walk merge edges and treat filename versions as one filing; fix Gate 3's reporting; add the exploratory disclaimer/tier to card prose and summary.
3. **Fix the free/cheap recall levers:** mine the 1,103 normalization-miss transcripts to repair name extraction, redact-and-rehash instead of family-blocking (replay from cached transcripts is free); symmetrize execution-block handling; require trivial classification on item-set merges; guard the Ring-2 loop.
4. **Then re-run** segment (new grammar, fixing the truncation bug) → seed → identity → canonicalize → gates. Only after that re-run do the gate numbers mean anything; expect Gate 1 and Gate 4 to move for four independent reasons, PII-blocked to drop, and family count to shrink as fragments merge.
5. **Only if recall is still short**, spend money: top-k seed adjudication (~$0.33) and, last, banding changes — after the offline 32×4 replay of the misses shows banding is actually the cause.

The interactions matter: fixing normalization touches recall, PII, and family support simultaneously; fixing gates changes what "pass" means; loosening banding before fixing Ring 2's guard would raise spend without a cap. Do them in this order.

---

## Part II — Engineering appendix

### A. Confirmed findings (severity-ranked, with mechanisms)

**CRITICAL**

| # | Finding | Mechanism |
|---|---|---|
| C1 | All 281 PII-blocked families ship full text to staff-readable Firestore | `catalog.ts:155-272` never consults `fam.piiScanStatus`; writes `canonicalText` (l.216) + every variant `normText` (l.277-292); `firestore.rules:637-648` grants firm attorney/paralegal read; rules comment at 625-627 ("NO raw client text by construction") is false. Roster-sweep blocks (`canonicalize.ts:588-593`) are literal client-name string hits in the shipped text. |
| C2 | ≥290/300 cards exploratory-only, tier tests no p-value | `stats.ts:319` `sig.length>0 ? sig : expl`; `isExploratory` (198-201) checks only lift≥2 & nFact≥10 — 2,966/4,800 (61.8%) qualify; `lift()` returns Infinity at b=0 (`fisher.ts:77`); no lift-ranking despite the §7.3 comment; summary hides the tier split. |
| C3 | Item-set path auto-merges content diffs transcript-lessly | `identity.ts:247-262`: itemSetJaccard≥0.7 gated only by `hardRoute`; `classifyDiff` result computed but `.classification` never checked (LSH path at l.151 requires `'trivial'`). Fix costs zero Gate-1 recall (seed-match has no item-set path). |
| C4 | 1,103 NORMALIZATION_MISS verdicts counted then dropped | `identity.ts:448,459`: edge stored merged:false; no re-normalize/re-hash/gazetteer feedback. Fragments support (2,377/2,677 below minSupport=3), feeds piiBlocked=281, depresses Gate 1. Transcript replay (`identity.ts:335-350`) makes the fix re-bill-free. Diff tokens on edges *are* the missed names. |

**MAJOR**

- **M1 Artifact staleness:** gate denominators 107+16=123 ≠ 130 seed trust-relevant (`gates.ts:84,185` vs `seed.ts:536`); no version stamps anywhere; direction unresolvable without GCS. Stamp SEGMENTER_VERSION + seed-run id; hard-fail on mismatch.
- **M2 Ring-2 spend-guard bypass:** maxAdjudicationPairs=40k enforced only in `planRing1` (`identity.ts:172-184,268-274`); Ring-2 loop (538-564) uncapped → 30,919 of 41,176 adjudications (~75%, ~$124); total breached the ceiling `config.ts:63-66` calls past the §10 envelope. relatedEdges=1.23M shows 0.80/0.92 cosine bands near-non-discriminative.
- **M3 16×8 banding under-proposal:** P(candidate)=1−(1−s⁸)¹⁶ = 24%/61% at Jaccard 0.6/0.7; seed matching inherits the default (`canonicalize.ts:302`, `minhash.ts:135`). Falsifier: offline 32×4 replay of the 48 misses (needs GCS artifacts).
- **M4 Single-candidate seed adjudication:** `seed-match.ts:105-141` keeps one best-by-Jaccard candidate; `canonicalize.ts:342` makes a SEPARATE (or NORMALIZATION_MISS) verdict terminal — while `adjudication.ts:47-49` admits Jaccard rank anti-correlates with legal sameness. Top-k=3 costs ~$0.33.
- **M5 Execution-block asymmetry:** `seed.ts:445-447` truncates (or drops, l.450) seeds at execution paragraphs; `segment-normalize.ts:235` only flags on corpus side — signature-block seeds structurally unmatchable (≥3 of 41 Gate-1 misses).
- **M6 Gate 2 measures seed-match kind, not family-forming edges** (`gates.ts:123`; never loads edges.json), has an all-exact blind spot (count of 2 is a lower bound), and its "separate file = distinct" ground truth is wrong for filename-version families (DISCLAIMER WILL trio, index pattern #8/#9/#8, #15/#16/#15).
- **M7 PII enforcement is one client-side line** (`ClauseLibraryDialog.tsx:83`); `carriedStatus` (`catalog.ts:59-61,269-270`) can hold approved+blocked; no human-clearance state survives a re-run (`PiiScanStatus` is only clean|blocked, overwritten at `catalog.ts:263`).
- **M8 281/300 blocked is structurally inflated** (any-variant family blocking, 0.53^4.4≈6.3% matches observed clean rate; recall-maximizing haiku prompt `pii-gates.ts:182`; `?? 'blocked'` default; roster admits every ≥3-char folder token) — but cannot be dismissed as over-aggression given the 1,103 name-leak attestations.
- **M9 Card support gate is one-sided** (`stats.ts:187-195` checks nFact only; nNotFact can be 7; lift unstable, Infinity at b=0) and **exploratory prose gets no hedging instruction** (`buildCardRequest` drops tier; label exists only as `triggerCard.tier` metadata, `catalog.ts:245`, rendered by nothing in this repo).

**REFUTED:** the seg/2-vs-seg/3 seed/corpus skew claim — runs #59-63 re-segmented nothing (canonicalize reads the stored seed-pieces artifact); both sides were produced under the same grammar. The residual truth: all mined data predates the seg/3 truncation fix (commit 8c8eb06), so re-segmentation is required anyway.

**MINOR:** Gate 3 reports value=medianRatio vs wrong threshold (`gates.ts:164-166`) on an n=16 subsample; per-row evidence for the 10 significant correlations unconfirmable without the stats blob.

**Verified sound:** gate arithmetic and fail-closed report mechanics; BH correction (`fisher.ts:85-99`) correct, primary-only, strata excluded; union-find edge/union counts reconcile (2,421 edges → 1,212 unions is normal clique redundancy); under-merge cannot directly cause gate misses (matching spans all 2,677 families).

### B. Consolidated unverifiable list (deduplicated; all require Firestore/GCS)

1. Which seed-pieces/seed-match artifact version the gates read (direction of the 123-vs-130 gap); whether seed was re-run between canonicalize and gates.
2. `segmentation.version` stamps on the 512 corpus rows; commit of the last STAGE=seed run.
3. edges.json: per-ring MERGE/SEPARATE/NORMALIZATION_MISS split; trivial-vs-item-set split of the 41 auto-merges; edge kinds forming fam_7d6bc499e63d51d9 / fam_e2bef41c53ebcd67.
4. Adjudication transcripts: the 1,103 normalization-miss diffs; the two gate-2 families; how many Gate-1/4 misses had any candidate or received NORMALIZATION_MISS.
5. Actual text of the gate-2 seed pieces (DISCLAIMER WILL trio, WELLS FARGO/ETP4/MTP1) — same-clause vs over-merge on the merits.
6. piiFindings distribution (roster vs haiku vs missing-result; term histogram); whether blocked normTexts contain real names right now; raw Drive folder-name strings; haiku batch completeness.
7. Stats blob: a/b/c/d and pAdj of the 10 significant rows; family distribution; 'unknown'-fact exclusion rates; 337-unit dedup correctness (identity loaded 371 artifacts vs 512 docs — denominator ambiguity).
8. Actual LLM spend vs the $350 ceiling / $250 daily breaker.
9. Whether any UI renders `triggerCard.tier` or `piiScanStatus`; whether any catalog doc carried approved onto a blocked family.
10. Canary content duplicated elsewhere in the corpus Drive tree; run #63's exit(3) contract.

### C. Remediation ordering with interactions

1. **PII stop-ship** (catalog skip/metadata-only for blocked; server-side gating; durable clearance state). No interaction with mining metrics.
2. **Measurement fixes** (version stamps + hard-fail; gate 2 edge-walking + version-family ground truth + all-exact fix; gate 3 reporting; gate 4 canary-hash cross-check precondition; stats tier split in summary + prose hedging + min(nFact,nNotFact)≥10 + b=0 lift handling). Changes what pass/fail means — must land before any rerun is interpreted.
3. **Free recall/purity fixes** (normalization-miss mining → extraction fix → redact-and-rehash → transcript replay; execution-block symmetrization or denominator exclusion; item-set trivial requirement; Ring-2 guard/cap). Interactions: normalization fix moves piiBlocked ↓, family count ↓, support ↑, Gate 1/4 ↑ simultaneously; item-set fix moves adjudication spend ↑ (bounded); Ring-2 guard must precede any banding loosening or spend is uncapped.
4. **Full re-run** segment (seg/3) → seed → identity → canonicalize → gates → stats → catalog. Read gates only after this.
5. **Paid recall levers only if still failing:** top-k=3 seed adjudication; banding change only after the offline 32×4 miss-replay implicates it.

### D. What the five lenses missed (from the evidence pack)

1. **371 vs 512:** identity loaded 371 artifacts against a corpus of 512 documents — 141 documents apparently contributed nothing to identity, unexplained by any lens; affects every denominator downstream (recall, counting units, catalog occurrence counts). Needs the segment-stage output to resolve.
2. **Corpus scope vs seed scope:** the corpus is 512 *trust* documents, but the seed library contains will-file clauses (DISCLAIMER WILL etc.); merge-tuning noted this only in passing as unverifiable. Roughly half of Gate 1's denominator may have no corpus counterpart by design — a scope decision for Adam, not a pipeline defect, and it should be resolved before recall targets are set.
3. **No lens audited the batch layer itself** (BatchClient submission/recovery semantics beyond the `?? 'blocked'` default) — the pilot's attempt-1 abort and replay behavior is only inferred; whether any of the 41,176 adjudications double-billed is open.
4. **Gate thresholds themselves were never challenged:** 0.9 recall / 0.9 canary targets against a corpus whose scope and segmentation are both unsettled; the panel debugged the measurements but no lens asked whether the pilot's pass bars are the right bars for checkpoint 3.
5. **Run #63 exit(3) semantics** — flagged unverifiable but nobody audited `main.ts`'s exit-code contract in code, which *is* in the sandbox; low stakes, but it was decidable and left undecided.
---

## Post-panel addenda (resolved in-session, 2026-08-03)

- **Run #63 exit(3) semantics — DECIDED:** `main.ts:200` sets `process.exitCode = 3` when the gates
  report has `passed=false`. Intentional; the workflow correctly treats it as a result to read.
- **371 vs 512 — mechanism found, cause still needs Firestore:** identity loads only file rows with
  `status === 'segmented'` (`identity.ts:464-465`) and never mutates per-file status itself (only the
  run ledger). So 141 of the 512 trusts sat in some other status at identity time. Which status —
  and whether their segments are silently missing from every downstream denominator — is the first
  Firestore query of the remediation session.
