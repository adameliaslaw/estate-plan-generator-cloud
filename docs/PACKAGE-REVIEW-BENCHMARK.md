# J2 — Package-Review Engine vs. Statular's Analysis & Review (2026-08-08)

Benchmark of PR #280's deterministic `reviewPackage` engine against the four finding classes
Statular's **Analysis & Review** panel was observed catching on a generated will package
(`STATULAR-VIDEO-REVIEW.md` §7). Executable evidence: **`tests/unit/package-review-benchmark.test.ts`**,
which pins the scorecard and every fix claim below and fails if coverage changes — an
expected-miss there is a benchmark result, not an endorsement. (The two location-precision
examples further down are measured but deliberately not pinned; `locateSection`'s output on real
prose is descriptive, not contractual.)

## Method

- **Corpus:** a real will package — the three Jessica Byrnes instruments in
  `samples/interactivelegal/` (will, POA, healthcare directive; the same trio a production
  `foundation` package generates), converted DOCX → HTML with mammoth, reviewed with the real
  roster (client, spouse, three children, five fiduciaries). Real legal prose, not synthetic
  fixtures — that difference did the work: every defect found below was invisible to the
  synthetic suite.
- **Seeding:** each Statular finding was re-created verbatim in that real prose (exact-string
  anchors that throw if the samples drift), then `reviewPackage` ran and the result was scored.
- **Baseline first:** the unmodified package was reviewed before any seeding, as the
  false-positive read.

The test suite **skips (not fails) if `samples/interactivelegal/` is removed** — it must not pin
those files in place while B6 (whether they belong in git) is open.

## Scorecard

| Statular class | Their observed finding | Our engine | Evidence |
|---|---|---|---|
| **(a) Unfilled placeholders in rendered output** | Execution line "in , New Jersey" (blank municipality); literal `[SIGNING CITY]` in three documents | **CATCH — full.** `empty-substitution` catches the collapsed municipality inside the execution clause; `unresolved-token` catches `[SIGNING CITY]` in all three documents, high severity | `CATCHES a1`, `CATCHES a2` |
| **(b) Cross-party inconsistency** | One individual named with no relationship descriptor while another is "my spouse", two sections apart | **PARTIAL — identity half only.** Name-collision (two roster people under one name) and suffix-dropped (rendered name ambiguous with another person) both catch, high severity. Descriptor consistency — how a party is *introduced* — has no check and the seeded re-creation of their exact finding passes silently | `CATCHES b2` ×2, `MISSES b1` |
| **(c) Statutory conflict, with citation** | UTMA custodianship to 25; NJ caps at 21; statute cited | **CATCH — same defect, same statute.** `statutory-limit` fires citing N.J.S.A. 46:38A-1 et seq., in digit form ("reaches 25") and — after this benchmark's fix — in the form attorneys actually write ("attains the age of twenty-five (25)"). Pure-spelled with no digits anywhere is a known residual miss. Breadth caveat: UTMA is our *only* statutory-limit rule; theirs is presumably a broader rules set | `CATCHES c1`, `CATCHES c2` |
| **(d) Logical dead-ends across cross-referenced provisions** | Successor-guardian chain whose "next nominated successor guardian as set forth above" names nobody | **MISS — by design, for now.** No check reasons over a document's internal reference structure; `inoperative-provision` is scoped to the SNT pattern. Their hardest class, and the one place the deterministic engine has no answer | `MISSES d1` |

Net: **(a) full, (c) matched on the observed example, (b) half, (d) none.** The converse also
holds and is worth stating once: three of our ten checks — missing-instrument, enclosure-mismatch,
missing-apportionment — are *package-level* (they reason over the document set as a whole) and
have no equivalent in their observed panel, which reviews one document at a time; name-collision
likewise counts a name's reach across every document in the set.

## What the real corpus caught that synthetic fixtures never did

Three engine defects, all found by the baseline/seeded runs, all **fixed in this PR** with
failing-first pins:

1. **BM-A3 — colon-form tokens were invisible.** The real package carries ~70 InteractiveLegal
   assembly markers; the engine caught exactly 2 — the space-form `[OBJ WILL 1001]` pair — because
   the token character class had no `:`, so `[OBJ:WILL 1069]` and every sibling sailed through.
   Same gap-shape as `{{XREF:Article FOURTH}}` in the clause fill contract (HOMEWORK A2), now
   proven to matter twice. Fixed with a colon-form pattern requiring LETTER:LETTER so bracketed
   statutory citations (`[N.J.S.A. 46:38A-1]`, `[3B:3-2]`, digits against the colon) stay prose;
   the guard is pinned. *Corpus caveat: in these samples the markers are hidden text
   (`w:vanish` via the "Object" character style) that mammoth surfaces — they never print. They
   are counted as corpus artifacts, not engine false positives; in production this check reads our
   own generated HTML, which carries no such marker unless something is genuinely broken.*
2. **BM-FP1 — acknowledgment blanks were false positives.** "On December _____, 2025, before me …
   personally appeared" (POA + HC attorney acknowledgments) fired `blank-field`. Execution-date
   blanks are correct blanks; `SIGNATURE_CONTEXT` knew jurat vocabulary but not acknowledgment
   vocabulary. Fixed with `before me` / `personally appeared`; baseline now reports zero
   blank-field findings on the unmodified package. An adversarial pass on the fix rejected the
   broader `acknowledg…` stem it first carried — "I acknowledge that I have intentionally omitted
   ______" is an operative disinheritance clause whose blank must stay flagged (pinned by
   `a-guard`). Known accepted miss, named in the code: a real blank within 100 chars of "…die
   before me…" is now suppressed — the module's prefer-missing-to-inventing bias accepts that.
3. **c2 — the UTMA check missed formal drafting.** "attains the age of twenty-five (25)" — the
   way the defect is actually written — was invisible while "reaches 25" was caught. Fixed: the
   digits are matched behind one spelled number word, restricted to number words so "until
   December 25" cannot read as an age. The adversarial pass then broke the first version of the
   fix with durations — "until thirty (30) days after my death" read as age 30 — so the pattern
   now requires the spelled form to close its parenthesis and refuses a duration noun after the
   digits (pinned by `c-guard`, which also hardens the pre-existing digit form against
   "until 30 days").

## Where they are ahead (measured, not conceded)

- **Location precision.** Their locations are section-precise (`Section 2.02(c)`, `Signing
  Block`). Ours on this real package: the seeded execution-clause defect located as "ARTICLE XII"
  (the nearest all-caps heading — the No Contest article), the UTMA defect as "Jessica Byrnes"
  (the testatrix's name line out-competed the title-case heading). `locateSection` recognises
  numbered and ALL-CAPS headings; real instruments with styled title-case headings defeat it.
- **Class (b) descriptor consistency and class (d) reference reasoning** — see scorecard.
- **Panel affordances.** Theirs: sortable columns, per-document filter, per-row dismiss.
  `PackageReviewPanel`: severity badges, grouping, expandable rows — no filter, no sort, no
  dismiss. Dismissal matters most: an undismissable medium-severity row is re-read on every visit,
  which is the cry-wolf failure mode #280 itself named.

## Recommendations (proposed, not started)

Ordered by value-for-effort:

1. **R1 — descriptor-consistency check (class (b) other half).** Roster-driven, so it fits the
   existing design: for each roster person found in a document, collect the words immediately
   preceding their name ("my Husband, ", "my daughter, ", bare); flag a person introduced bare in
   one dispositive section while carrying a descriptor elsewhere in the same document. Rules, no
   AI; the FP risk is signature blocks and headings, which the existing execution-context
   machinery already identifies.
2. **R2 — per-row dismiss on `PackageReviewPanel`** (persisted on `packageReview.findings[i]`,
   e.g. a `dismissedAt`/`dismissedBy` pair). Small, and directly serves the engine's own
   false-positive philosophy.
3. **R3 — title-case heading recognition in `locateSection`**, guarded to short standalone lines
   that match known article vocabulary, so locations on real instruments stop reading as names
   and wrong articles.
4. **R4 — class (d) belongs to the AI reviewer, not the rules engine.** Successor-chain
   dead-ends require reading the document's own reference structure; a deterministic check that
   guesses at it would manufacture confident wrong findings (the failure mode rule 9 exists for).
   The existing per-document AI review (`ai-compliance-check.ts` / `grounded-review.ts`) is the
   right home for an explicit "trace every 'as set forth above/below' to its referent" prompt
   instruction — worth trying before building any rules machinery.
5. **R5 — more statutory-limit rules** as they earn their place (the NJ apportionment work is the
   pattern: each rule carries its citation and a test). Candidates surface naturally from
   practice; do not build a speculative rules engine.
