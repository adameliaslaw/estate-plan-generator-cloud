# Estate Plan Generator — Homework

Items requiring human action or decisions before the next agent session can proceed.

---

## ✅ THE ASSET/ALLOCATION MODEL — all three PRs shipped and deployed, plus the follow-ups (#213)

Read this section top to bottom: it is the work in the order it has to happen. Residue is the
foundation the other two PRs stand on, so it went first, and the schedules followed it. **Full scope:
[docs/ASSET-ALLOCATION-MODEL.md](./docs/ASSET-ALLOCATION-MODEL.md)** — kept in its own file
because this one is re-read every session, and was archived once for exactly that reason.

### 1 · Residue and the allocation model — ✅ SHIPPED 2026-07-28 (#210, merged and deployed)

**What shipped (PR 1 — model, derivation, back-compat; engine untouched, 961/961 green):**

```
Matter
  assets: Asset[]                    // the estate's property, entered ONCE
    fairMarketValue                  // the decedent's interest (Schedule A column D)
    allocations: Allocation[]        // SPECIFIC gifts only; may be absent
      beneficiaryId + fraction       // the FRACTION is stored; the amount is derived
  residuary: ResiduaryShare[]        // beneficiaryId + fraction, summing to 1
  beneficiaries[].bequests           // empty in this model — identity only
```

`functions/src/inheritance-tax/allocations.ts` holds the two directions, and nothing else knows
both shapes: `deriveEngineMatter` (allocation shape → what `computeEstate` already takes) and
`normalizeMatterToAssets` (legacy nested shape → allocation shape). They are called at the two
engine boundaries (`inheritance-tax-compute.ts`, `inheritance-tax-review.ts`). **The engine was
not touched and no gold case was edited.**

**The residuary pool is computed, never entered** — there is nowhere to type a wrong one:

```
pool = Σ(asset.fairMarketValue) − Σ(all specific allocations)
each residuary taker receives  share.fraction × pool
```

**The sum-check is a `≤`, not an `=`** — this was the correction that made the whole thing work,
because an equality check rejects every ordinary will:

- Σ(an asset's specific allocations) **≤** its value — the remainder falls into residue.
- Pool > 0 ⇒ residuary shares are required, and must sum to 1.
- Pool = 0 ⇒ residuary shares must be absent or empty.
- An asset with **no allocations at all is wholly residuary** — the common case, not an error.
  It is *fully allocated with no beneficiary named against it*, which is precisely what a naive
  equality check cannot express.

**All three required cases are expressible, each with a test:** (1) whole asset to one person;
(2) whole asset into residue with no allocation entry; (3) part specific, part residue — $50,000
of a $120,000 Chase account to the niece, $70,000 into the pool.

**⚠️ Per stirpes is not computed, and the model refuses the instruction rather than ignoring it.**
`ResiduaryShare` has no `perStirpes` field and `.strict()` rejects one. The substitute taker can be
a **different tax class** — a deceased child's share to grandchildren stays Class A, a deceased
sibling's share to nieces and nephews moves **Class C → Class D**. Accepting the flag and quietly
not acting on it is the dangerous outcome: it reads as handled. **The screen must still say this**
— that part belongs to PR 3, below.

**The two smaller interactions are handled, not deferred:**
- **A charity can take residue.** A residuary share accepts an entity beneficiary (Class E,
  exempt); tested.
- **Disclaimers are refused by name, never silently.** A disclaimer can name only an asset given
  **whole** to the disclaimant — that asset derives to a bequest carrying its own id, which is the
  only id an attorney can see. A fractional share and a residuary share have no such id, and each
  gets its own error explaining why, the residuary one naming the Class C → Class D hazard.

**Proof it is right:** `tests/unit/inheritance-tax-allocations.test.ts` (31 tests) runs the same
estate — a $500,000 house split two ways plus a $40,000 account, with deductions so the Line-9
scale is live — through **both shapes** and asserts every figure matches; and round-trips a legacy
matter through `normalize → derive`, asserting the **whole computation** including the frozen form
snapshot is identical. Shares apportion in integer cents by largest remainder, so a 1/3 : 2/3 split
sums to the asset exactly. That last one is negative-controlled: swapping in naive per-part
rounding fails the three-way residue test.

**Sign-off needed before merge** — this is a data-model change to the tax engine, which the
Never-Break List puts outside auto-merge.

### 2 · Schedules render from assets — ✅ SHIPPED 2026-07-28 (#211, merged and deployed)

**The duplication is dead at its source.** `collectScheduleItems` (`engine/compute.ts`, called by
`buildFormSnapshot`) emitted one row per *bequest*; it now emits one row per **asset**, at the
decedent's whole interest, however many people take it. One change, six schedules — **A, B, B-1,
B-2, B-3 and C** — which is why the per-schedule "group the rows" patch was rejected: it would
have been written six times, each with its own notion of asset identity.

*Done, and asserted:* the $500,000 house split two ways is **one** Schedule A row at $500,000, the
split account **one** B-1 row at $40,000, and the filled IT-R reads back `500,000.00` in column D
of the first property block with the second block **empty** — that empty block is where the
duplicate row used to be. Line 1 = $500,000, Line 5 = $540,000, and each child still takes
$270,000: the row count changed, no figure did.

**Two things beyond the stated scope, both belonging here:**
- **The L-9 listed the same parcel twice** for the same reason, and a lien release is not a place
  for two half-parcels. It reads assets now. Its per-beneficiary "interest in the estate" also
  summed nested bequests, which an allocation-model matter does not have — it would have stated
  **$0 for every beneficiary** and passed the Class A eligibility check vacuously. Both fixed;
  both tested.
- **The form handlers now derive**, like the engine handlers already did (`deriveEngineMatter`
  before `buildITRFormData` / `buildL9AFormData`). PR 1 wired the two compute boundaries and left
  the two form boundaries, which was a real gap: an allocation-model matter reaching a form
  builder underived produces zeros, not an error.

*Verified:* 16 new tests, negative-controlled — 7 of them fail against PR 1's code, including both
row counts and the PDF read-back. 977/977 green, gold cases untouched.

**Still not done here — Schedule E Column D.** See below; it is real work with a real constraint,
not a loose end to tack on.

**The question this PR looked like it would have to answer was already answered — by the State.**
Checked 2026-07-28 against `it-rinst.pdf` and the blank form's own field layer, because "who is
named on a row that now has several takers" reads like a blocker and is not one.

**There is no beneficiary column on any asset schedule.** Schedule A is Column A – Description
(county · fractional or percentage interest · street · lot and block · municipality · owner(s)
name(s)/property title · mortgage lien), B – Tax Assessed Value, C – Full Market Value, D – Value
of Decedent's Interest. The only names it asks for are **owners of record**: *"Include all owners'
names listed on the property. If a previously deceased person's name(s) is still on the deed,
include the name(s), write 'Predeceased'."* Schedule B-1 is the same — Column A is *"Name of
Institution, Last Four Digits of Account Number, and Registered Owners"*, and its "registered
beneficiary(s)" is the account's own POD designation, not the will's taker.

So **one asset = one row, and the row has no beneficiary to name.** `fillScheduleA` already writes
only the State's columns and never touches `beneficiaryName`; the official L-9 filler likewise
names no beneficiary per property (the L-9's beneficiary list is its own separate schedule).
`ScheduleItem.beneficiaryName` survives in exactly two places, both ours: the HTML workpaper column
(`render.ts:71`) and the HTML L-9 "Passing to" line (`render-l9a.ts:37`). What that column shows is
a **review-aid decision with no legal constraint** — suggested: the specific takers, plus
"Residuary estate" for the rest, borrowing the State's own vocabulary.

**New work this uncovered — Schedule E Column D is literally the allocation model.** Printed
heading: **"(D) Fractional/percentage of residuary Estate and/or specific asset"**, and the
instructions spell it out:

> *"Beneficiary's Share. If the beneficiary is to receive a percentage of the residual Estate or a
> fractional share … list that share, even if they are receiving other assets. Examples: '50%
> Residue,' '1/3 of Estate,' '100% Residue.' — Specific Bequest Assets … Examples: '$5,000 cash
> bequest,' 'grandfather clock'"*

That is `residuary[].fraction` and `allocations[]` in the State's own words. **Before PR 1 this
column was unfillable in principle** — the nested model had no notion of "50% Residue" because it
had no residue.

**✅ SHIPPED 2026-07-28 (#213).** `describeBeneficiaryInterest` composes it, `buildFormSnapshot`
freezes it per beneficiary (FND-IMMUT), and `drawScheduleEColumnD` paints it. It prints the way the
State's examples print it — `1/3 Residue`, `1/4 of Chase Account; 1/3 Residue`, or a bare asset
name for a whole gift. A legacy nested matter still yields `''` and the column still prints blank
for it, which is correct: that shape cannot express a residuary fraction.

⚠️ **The constraint that made it real work, kept because it still governs Column F:** the blank
IT-R's AcroForm has **808 fields and none for Column D or Column F**. Those columns are printed but
not fillable, so filling one means DRAWING text onto the page, not writing a field. Column D's
position is derived from the form's own geometry — the gap between the tax-class dropdown and the
dollar-amount box on the same row — so it follows the fields if NJ reissues the booklet, and
`assertComplete` fails loudly first if they rename anything. Drawing runs after every field write,
so a mapping failure surfaces before a mark is made. **Column F (Age) is still blank** and is the
same class of problem; it is only required for life estates and contingent interests.

Two smaller confirmations from the same pass, worth not rediscovering:
- Schedule A Column D says *"Show this as a dollar amount (not a fraction or percentage)"* —
  which is store-the-fraction, print-the-derived-amount, exactly as decided.
- Schedule A's *"Fractional or percentage interest"* is the **decedent's ownership** share
  (tenants in common) — a different number from a beneficiary's allocation fraction. The model
  keeps them in separate fields (`realPropertyDetails.fractionalInterest` vs `Allocation.fraction`)
  and PR 2 must not merge them.

### 3 · Intake, inventory-then-allocate — ✅ SHIPPED 2026-07-28 (#212, merged and deployed)

**The screen changed shape.** Assets are their own section now, entered once at the decedent's
interest; beneficiaries are identity only; and a Residue section shows the computed pool with the
takers entered as shares. The old "add a bequest under each person" flow is gone.

*Both acceptance criteria met, each with a test:* a **1/3 : 2/3 split** is entered by typing
`1/3` and `2/3` — the share picker takes a percentage, a dollar amount or a plain fraction, stores
the fraction, and shows the dollars beside it — and an **over-allocated asset cannot be saved**.

**The per-stirpes notice is on screen**, and a test asserts the words are there rather than just
the component. It tells the attorney to enter the actual takers and says why: a deceased child's
share to grandchildren stays Class A, a deceased sibling's share to nieces and nephews moves
Class C to Class D.

**Opening an old matter normalises it** — one asset per bequest, wholly allocated to whoever it was
entered under — so there is one screen rather than two. A test computes the same estate before and
after and asserts identical figures.

**Client rules are checked against the server's own validator.** Every allocation rule asserts both
what the page reports as still needed and what `validateMatter` does with the matter the page would
send, so a client rule that drifts from the server fails on the server assertion. Same pattern as
the deduction attestations.

**✅ Adam exercised it the same day** — he entered a $1,750,000 estate (a house, three accounts,
three beneficiaries, a specific gift and a split residue) and produced a filled IT-R off it. So the
NEW-matter path is proven by a human, not just by tests.

⚠️ **One path a human still has not walked: opening a matter saved BEFORE the model changed.** It
is normalised on open — one asset per bequest, wholly allocated to whoever it was entered under —
and a test asserts the computation is identical before and after, but no human has confirmed the
screen reads correctly afterwards. That is the remaining risk on this section, and it is small.

**Why the browser pass could not be done in-session, kept because it will recur:** the environment
has no `.env.local`, so the Vite dev server cannot initialise Firebase and the page cannot be
reached logged in. Component tests type into the real inputs with `userEvent`, which is not the
same as the assembled screen. Any future UI change here lands with the same gap.

### Why this model at all — the three facts, kept because they are the justification

All reproduced against the real engine, not reasoned about. Adam's decision, 2026-07-28; I argued
against it first and was wrong.

1. **Every asset schedule prints a shared asset twice.** A $500,000 house split two ways gives a
   correct gross estate of $500,000 and **two Schedule A rows** — same address, same lot, same
   block, each showing the decedent's interest as $250,000. A bank account does the same on B-1
   (account …4821 printed twice at $40,000). It affects six schedules. That is the signal it is
   the wrong layer.
2. **It contradicts the State's instructions on the schedule that generates the tax waiver.**
   Schedule A column D is *"the value of the decedent's interest only"* and *"goes directly onto
   the tax waiver"*. Two rows at $250,000 assert the decedent held two half-interests in one house.
3. **Nothing checks that the shares sum to the asset's real value** — there is no asset, so there
   is nothing to check against. $250,000 + $250,000 against a house actually worth $600,000 files
   a return that is quietly $100,000 light. Structural, and the allocation model makes it
   impossible.

**The hard constraint, at every step: do not change the engine.** `computeEstate` keeps the shape
it takes today; per-beneficiary amounts are **derived** at the boundary. The 25 gold cases are the
only proof the figures are right. If a gold case needs editing, the derivation is wrong, not the
case.

**Answered questions, both closed 2026-07-28:** store the **fraction**, derive the amount (a
re-appraisal keeps the split intact); and residue follows the firm's own will model —
`ResidualDistribution` percentages summing to 100 — so **specific gifts off the top, residue split
by percentage**, not a general-purpose bequest algebra.

**Deliberately dropped:** the Schedule A grouping patch scoped earlier the same day. Throwaway work
covering one sixth of the problem.

---

## 🔵 SESSION — 2026-07-30 (drafting-engine assessment → the clause-mining project is scoped)

**TL;DR — Adam asked whether his docassemble / python-docx-template forks should replace the
drafting engines. Answer: neither. The assessment surfaced the real direction: make the
high-fidelity .docx path the primary drafting spine (deterministic template fill; AI moves to
intake extraction and post-assembly review), then mine Adam's Google Drive archive — thousands of
client documents — into a clause catalog with usage statistics, powering a clause recommender
("include the bloodline clause — your 6/12 note mentions the daughter's marriage"). Full analysis
is in the session transcript; nothing is built yet.**

**Two stale-doc corrections from the assessment:** (1) CLAUDE.md / README.md / MEMORY.md still say
high-fidelity mode is "planned, not implemented" — it shipped in #196/#205 (`docx-fidelity.ts`,
`docx-package-fill.ts`, docxtemplater). (2) The Export → DOCX button rebuilds from HTML and never
serves the preserved binary (`hasBinary` is written but read nowhere) — the fidelity win is lost at
the last step.

**Build order agreed:** ① Drive inventory pass (counts by doc type / format / year — needs Adam to
point at the folder) · ② engine upgrade: loops + conditional sections in the high-fidelity data map,
serve the stored binary on export · ③ pilot: mine all trusts → clause catalog with frequencies ·
④ Adam reviews the catalog · ⑤ recommender + checklist UI + full corpus run.

### ⚠️ EFFORT CHECKPOINTS — flag these when we get there (Adam's standing instruction)

Session baseline is **high** effort. At the following two steps, the agent must STOP and tell Adam
to invoke **ultracode** (multi-agent adversarial verification) before proceeding — being wrong at
these steps is expensive and hard to undo; everywhere else max effort buys nothing:

1. **Mining-pipeline design** (start of ③) — the segmentation/clustering decisions ("what counts as
   the same clause," normalization rules) silently shape everything downstream. Independent design
   proposals + adversarial checks against sample documents.
2. **Clause-catalog verification** (end of ③, before Adam's review in ④) — every "you use this
   when X" card is derived from correlation; a plausible-but-wrong card pollutes the judgment
   catalog permanently. Adversarial refutation of clause boundaries and fact-correlations against
   the source documents before Adam ever sees the catalog.

**Confidentiality note for ③:** the mining pass sends client-document text to the firm's selected
AI provider at corpus scale. Adam decides the provider and confirms retention terms before the
pilot runs. The output clause bank itself is clean boilerplate with placeholders.

**UPDATE (same day, PM):** Inventory DONE (My Drive → Everybody → Wills and Trusts: ~2,000+ folders,
est. 12–25k files, .doc/RTF majority, AAA WILL PIECES is a hand-curated clause library — full report
in session scratchpad, not committed: contains client names). Adam confirmed Anthropic as processing
provider and set claude-opus-5 as the firm drafting default (#219). Ultracode checkpoint #1 RAN
(10-agent adversarial workflow): design of record committed at
[docs/CLAUSE-MINING-PIPELINE.md](./docs/CLAUSE-MINING-PIPELINE.md). Also shipped today: export
binary/edits fix (#217), current-generation model update (#218).

**UPDATE (same day, later): DESIGN APPROVED.** Adam reviewed via guided Q&A and approved on the
five-promises basis (see design doc §15 for his 8 recorded decisions — notable: canonical text is
decided by usage data, NOT the seed library, which he disclosed was authored by his predecessors
and never evaluated; primary stats cover the whole practice; all files included). Amendments
applied to §6.2, §7.3, §11 Gate 3, Stage 0. Budget approved: $350 pilot / $250 day breaker.

**UPDATE: Never-Break PR APPROVED by Adam and merged (#222).** Rules, vector index, storage path,
and the firestore:indexes CI fix are deployed. Build underway: `clause-miner/` package landed with
the full deterministic core (sniffer, reflow, segmentation grammar, gazetteer normalization with
typed placeholders, sigText + Ring-0 hashing, MinHash/LSH Ring-1, token diff + legal-delta lexicon
hard-router, execution-block detector) — 116 unit tests, all stage entry points stubbed, dispatch-
only deploy workflow. Zero runtime deps until stages land.

**FEATURE DECISION (Adam, 2026-07-30 evening): in-questionnaire Clause Picker.** Adam found the
pattern in a competitor (Statular): a "Clause Library" button on questionnaire free-text fields
opening a searchable/filterable clause modal with preview + "Use Clause" insert. Integrate the
FEATURE (not their clause content — IP): attorney-only picker over firms/{firmId}/clauseCatalog
on questionnaire free-text fields + the document editor, folders All/My/Mined, state+category
filters, preview, insert with client-context placeholder resolution; manual "My Clauses" adds via
a staff-authed callable (catalog client-writes stay false per #222). Ships with the review UI
(shared backend/components) — folded into the gaps slice (task #6).

**UPDATE (2026-07-30, later): the calibration path and the validation gates are BUILT (#229).**
All nine pipeline stages had landed in #226; what was still missing was everything that makes the
pilot *checkable* — the curated seed, Adam's calibration session, and the §11 gates. That is now in:
`STAGE=seed`, `STAGE=calibrate`, `STAGE=gates`, plus seed-divergence wiring in canonicalize.
363 tests (up from 274), five negative controls run and reverted.

Three decisions inside it that are worth not re-deriving:

- **The curated seed leaves the corpus by construction, not by a filter.** Seed folders manifest to
  their own collection that the corpus stages never walk. Gate 4's whole value is that the canary
  was genuinely held out; a filter someone forgets to apply would make it prove nothing. The
  canary-folder list is validated at startup to be a subset of the seed folders, because a canary
  folder that is not a seed folder gets walked into the corpus *while the gate believes it is held
  out* — a silently vacuous gate.
- **Adam's own filing supplies the negative labels for free.** Two distinct pieces in his library
  are two clauses he already decided to keep apart. Every near-duplicate pair among them is a
  labeled negative at zero cost to his hour — so all 30 hand labels go to the band where the answer
  is genuinely in doubt.
- **Threshold tuning can FAIL, on purpose.** It maximizes F1 *subject to zero false auto-merges*.
  Over-merge is the catastrophic error the whole checkpoint exists for; a tuner that traded one bad
  merge for a point of F1 would contradict the design it is calibrating. When no split qualifies it
  selects nothing, records why, and leaves the configured defaults in force.

**The gates refuse to report vacuous passes**, which is the property to keep: an empty gold set
FAILS Gate 1 (0/0 is not 100%); a canary that was not actually held out FAILS Gate 4 whatever its
recovery rate; Gate 5 (template round-trip) reports **skipped**, never passed, because §6.4 assembly
is checkpoint-2 work; and `STAGE=gates` refuses to run at all without a seed-match artifact. Each of
those four is negative-controlled — flipping it green makes a test fail.

### ✅ FIRST DEPLOY COMPLETE, 2026-07-31 — preflight READY, P0.1 CLOSED

The Cloud Run Job deploys and runs. **`STAGE=preflight` reports READY.** Every P0 prerequisite is
now closed; the pipeline is unblocked and needs nothing from Adam until his calibration session.

**The values every later stage needs — recorded here so they are never re-derived:**

```
CLAUSE_MINER_ROOT_FOLDER_ID   1TuJOw7hy4xKm6EJeyFb5IYS4I6eoVk-j   ("Wills and Trusts", 920 subfolders)
CLAUSE_MINER_SEED_FOLDER_IDS  1GYk0lZsGo-TMFWNMPNIiQyiUpel6X0MA   (AAA WILL PIECES)
                              1vOS1zZMBuQAiYZkPpfG7YIy7fpd9119p   (Trust Agreements — ALSO the canary)
CLAUSE_MINER_CANARY_FOLDER_IDS 1vOS1zZMBuQAiYZkPpfG7YIy7fpd9119p
Job identity                  749324460027-compute@developer.gserviceaccount.com
FIRM_ID                       firm-001  ← Adam's decision 2026-07-31; see below
GCS_BUCKET                    estate-plan-generator.firebasestorage.app
```

**The preflight proved four things, not one:** the folder is visible and is genuinely named "Wills
and Trusts" (so the id pinned in `wills-backfill.ts` was right); 920 subfolders, matching the Drive
inventory estimate; **a real byte read off a real client file succeeded** (`ZUSS.WIL.doc`) — listing
and downloading are separate permissions and Stage 1 opens with a Range request, so a listings-only
grant would have passed everything else and died on the first file; and both seed folders resolve by
name to exactly one match each, inside the corpus tree.

⚠️ **CORRECTION 2026-08-01 (~9 PM ET): the app's LIVE firm id is `elias-counsel`, not firm-001.**
Adam's auth claims carry firmId=elias-counsel — discovered when the calibration page 404'd on its
own packet (the diagnostic error printed the path it built from his token). The mining run stays
under firm-001 (renaming would re-key every artifact); the calibration callables map staff of
either id onto the mining scope. **Before the catalog stage: catalog docs MUST be written under
elias-counsel (or the callables must map) or the UI cannot see the catalog** — the exact mismatch
the note below warned about, now proven real.

**`FIRM_ID=firm-001` is the real value — do not go looking for another one.** Asked on
2026-07-31, Adam confirmed there is no other firm id: he is the only user and the firm has not used
the product live, so no `firms` document has been created yet. `firm-001` IS the id.

Two consequences worth keeping:
- **Use it consistently.** Every artifact path and all resume state key off
  `firms/{firmId}/clauseMining/{runId}`, so a stage run under a different id silently starts a
  fresh empty run instead of resuming one.
- **When the product does go live, the firm document must be created as `firm-001`.** The catalog
  lands at `firms/firm-001/clauseCatalog` and the UI reads the catalog for the logged-in user's
  firm; a mismatch would leave the mined catalog invisible to the app and require a migration.

**What each blocker turned out to be, in order — none was guessable in advance:** IAM roles
(Artifact Registry / Cloud Run / Service Account User on the GitHub deploy SA) → the **Google Drive
API was disabled** on project 749324460027 → the corpus folder **was not shared** with the compute
service account. Adam fixed each; the last one closed it.

⚠️ **The wills Drive pipeline cannot ever have worked.** `wills-backfill.ts` reads Drive from this
project with this identity, and the Drive API was off until 2026-07-31. Out of scope for clause
mining, but it is a standing assumption in this repo that is now known false.

**Three self-inflicted detours, kept so they are not repeated:**
- A "check every permission up front" precheck reported ALL permissions missing minutes after a run
  had demonstrably used them: `gcloud projects test-iam-permissions` output was swallowed with
  `2>/dev/null || true`, so an empty result was indistinguishable from "has none". Reverted. **Any
  probe whose failure looks like a negative result must report the failure separately** — the same
  empty-means-zero mistake the §11 gates exist to avoid.
- The execute step's log fetch did not fire on the failure path twice. First the execution name was
  captured from `gcloud … --wait --format=…`, which prints nothing to stdout when the execution
  fails; then `set -uo pipefail` was assumed to clear errexit. **GitHub runs `run:` blocks as
  `bash -e {0}` — only an explicit `set +e` clears it.**
- The preflight called an unshared folder "readable but EMPTY". **Drive returns an empty listing,
  not an error, for a folder you cannot see** — so listing children cannot tell "not shared" from
  "empty". `DriveClient.getFolder` fetches the folder itself, which does fail, and the report now
  prints the folder's NAME when visible, which also proves the id points where intended.

### ✅ STEP 2 COMPLETE, 2026-07-31 PM — manifest + convert + §4.4 QA gate (run `pilot-1`)

All three runs on `ref=main`, resuming run_id `pilot-1`, no AI spend anywhere.

**Manifest (SAMPLE_LIMIT=60):** 28,496 files discovered across 4,383 folders; **word-file yield
18,311** — inside the §3 Stage-0 sanity band (8,000–18,000), at its top edge; 9,572 PDFs excluded,
174 debris, **0 folder errors, 0 share-required**. 60 corpus files manifested, 122 seed files,
4 canary files.

**Convert:** 42 soffice + 17 OOXML passthrough + 1 error = 60. **0 fallback-text, 0 unrecognized.**
Formats: 38 ole-doc, 17 docx, 2 wpd, 2 rtf.

**§4.4 QA gate — PASS, read off the new `STAGE=qa-convert` report (#236), with these findings:**

- **The 1 error is `Assets.xls`** (a spreadsheet in a client folder) — the sniff-everything
  manifest correctly carried it and the ladder correctly exhausted; not a word-processing file,
  not a fidelity problem.
- **Numbering/heading survival: good.** Every real instrument shows healthy boundary counts
  (8–132 per doc; the InteractiveLegal ILIT converted from ole-doc with 132 boundaries intact).
  The only zero-boundary file is a 676-char note ("I prepared a deed for…"), not an instrument.
- **RTF bold-run survival: PASS** — both RTF files kept their bold runs (4 and 35).
- **⚠️ The §4.1 hard-wrap heuristic over-fires: 37/59 flagged, including modern InteractiveLegal
  .docx passthroughs.** Median-paragraph-length < 90 trips on docs with many short headings,
  signature lines and address blocks. Reflow's rejoin rules are conservative (headings and
  punctuated lines never join), so the blast radius is bounded — but this is exactly what the
  calibration phase exists to tune. **Open item: tighten the trigger (e.g. skip docs with
  OOXML style boundaries) before `STAGE=segment` runs on the corpus.**
- **Schedule A / `estateSizeBand` (§7.1): evidence thin but leaning DROP.** Only 2 of 59 docs
  carry a Schedule A at all: one trust with real values, one ILIT with the "$10 and other
  property" convention. The doc-type-blind sample contains few trusts; re-check on
  triage-classified trusts before the final call.

### ✅ STEP 3 COMPLETE, 2026-07-31 PM — seed + calibrate ran; the labelling packet exists

Adam approved the spend ("Dispatch"). It took three runs, and both failures taught something
worth keeping:

- **Run 1: Anthropic 401 "API key is invalid" — the Secret Manager key was dead and had
  plausibly NEVER worked.** Adam pushed back ("if it's the key from yesterday that's
  impossible") and he was right to: his daily drafting uses the per-firm key in **Firestore firm
  settings**, not the Secret Manager copy. The Secret Manager `ANTHROPIC_API_KEY` (3 versions,
  all May 5–6) existed for the wills pipeline — which never ran — so its invalidity was
  undetectable until today. Diagnosed with a **masked** secret-version diagnostic step in the
  workflow (#238): version list + length/prefix/whitespace fingerprint, never the value. Adam
  added a working version 4. ⚠️ **The Anthropic key now lives in TWO places** (firm settings +
  Secret Manager); a rotation must update both. Versions 1–3 are safe to disable (Disable, not
  Destroy).
- **Run 2: authenticated, then `custom_id must match ^[a-zA-Z0-9_-]{1,64}$`.** Every one of the
  nine batch call sites used `prefix:id` customIds — a latent bug in ALL LLM stages, never
  surfaced because no batch had ever gotten past auth. Fixed at the single API boundary
  (#239): bijective escape on submit (`_`→`_u`, `:`→`_c`, `~`→`_t`), decode on results; encode
  throws naming the id on anything unrepresentable. Wire-format test fails against the old code.
- **Run 3: GREEN.** `seed`: 122 files (conversions all cache hits from the failed runs),
  **417 pieces → 293 operative clauses / 124 commentary, 120 trust-relevant, 19 canary pieces,
  0 unclassified**. The trust gold set is ~10× the design's "thin (~10–12 pieces)" worry.
  Spend: ~417 short haiku batch calls — under a dollar. `calibrate` (emit mode, no AI): packet
  written — 293 pieces for boundary confirmation, **30 same/different pairs** sampled from the
  candidate band for Adam's labels; threshold tuning correctly reports selected=null until
  labels exist.

### ✅ CORPUS ARC (Adam approved ~$95), 2026-08-01 — manifest + conversion + triage COMPLETE over the whole archive

- **Full manifest:** 18,628 corpus rows (18,311 word files + sniff-everything keepers), 0 folder
  errors, 0 share-required.
- **Conversion: COMPLETE.** All 18,628 rows terminal. Wall clock ~4 h across overlapping
  executions — the GitHub launcher times out at 45 min while the Cloud Run execution (6 h
  envelope) keeps working, so every "cancelled" workflow was cosmetic; per-file checkpoints made
  overlapping executions safe. Final summary pass: `skipped:18628, errors:0 new`.
- **Triage: COMPLETE.** The 07:21Z execution's batch classified all 18,628 files itself; the
  resume pass confirmed `pending:0`. Per-category totals live in the run ledger
  (`firms/firm-001/clauseMining/pilot-1.triage`); the trust count surfaces as extract's
  `submitted`.
- **Two double-billing resume gaps found and fixed before they cost anything** (#243 triage,
  extract in this PR): both stages persisted their batch id "for resumability" but never read it
  back — a resume while the batch was still processing would have re-submitted the whole stage.
  Resume now re-polls the ledgered batch and submits only uncovered rows. Negative-controlled.
- **Also this session:** the Clause Picker shipped (#241) and the calibration session page
  shipped (#242) — both deployed; Adam's 1-hour labelling session is unblocked at
  /clause-calibration.
- **✅ EXTRACT COMPLETE (2026-08-01 ~noon ET): the corpus contains 512 trust documents** —
  submitted 512 / extracted 511 / failed 1 / skipped 18,116. Cost ~$15–20, far under the $68
  budget: the trust population is ~¼ of the design's 1,500–2,500 estimate, which shrinks every
  downstream stage (adjudication projection drops well below the ~$103 budget). Two more
  bugs found+fixed on the way, each before it cost anything: extract's single batch-create body
  was terminated at the API edge (chunked submission + multi-batch resume, #245), and a $100
  credit purchase that never attached to the org stalled two attempts (Anthropic-side, Adam
  resolved).
- **✅ SEGMENT COMPLETE** (512 trusts; 497 first pass + 15 on resume after a GCS flake;
  quarantine/review tail tiny, zero LLM fallback — the §4.4 hard-wrap worry did not distort).
- **⏸ IDENTITY: PAUSED AT A CALIBRATION DECISION (2026-08-01 ~7:25 PM ET).** Seven runs. Five
  distinct OOM mechanisms found, each pinpointed by phase heap logs added along the way and each
  fixed before costing anything: Node heap cap (#247), item-set all-pairs quadratic (#248),
  ubiquitous-item mega-bucket (#250), artifact hoarding (#249), BigInt shingle storm on
  wall-of-prose sigTexts (#251). Adjudication now resumes from durable per-pair transcripts and
  submits chunked (#247/#245 pattern). Run 7 executed every phase with flat memory (~150-200 MB)
  and stopped at the honest number: **>40,000 BILLABLE adjudication pairs from 5,407 unique
  signatures, with only 131 trivial auto-merges** — the corpus is so form-uniform that untuned
  LSH banding routes nearly every candidate to paid adjudication (>$160, ceiling unknown), and
  the tiny auto-merge rate hints normalization may be leaving residual content diffs too.
- **THE DECISION PUT TO ADAM:** (1) *recommended* — do the 1-hour calibration session at
  /clause-calibration (live, packet ready): his 30 pair labels + seed-structure negatives let
  `STAGE=calibrate` (tune mode) pick banding that concentrates candidates in the genuinely
  ambiguous band, then identity re-runs free of charge to a sane billable count; or (2) approve
  a raised cap at ~$4/1k pairs with the ceiling still unknown. No identity re-run until one of
  these happens.
- **▶ NEXT after identity passes:** canonicalize → stats → catalog → gates, then Adam's catalog
  review. Standing pattern: judge stages by Cloud Run execution output; resume dispatches are
  the normal way to read a finished stage.
- ~~**▶ NEXT: `STAGE=segment`**~~ (done, above)
- **(superseded)** `STAGE=segment` (CPU + small haiku boundary fallback) → `identity` (deterministic
  rings; the sonnet adjudication of non-trivial merges is the one remaining spend decision —
  bring Adam the projected pair count × cost before dispatching identity with the secret) →
  canonicalize → stats → catalog → gates.
- ⚠️ Standing pattern for all long stages: judge by the Cloud Run execution/job output, never the
  workflow color; resume dispatches are the normal way to read a finished stage's summary.

### ✅ SEED REWORK, 2026-08-02 — Adam caught the calibration packet showing whole documents as "clauses"

**The finding (Adam's, from the live /clause-calibration page):** entries in both the pairs and the
boundary list were entire documents or not clauses at all. Diagnosis against his actual Drive files:
the "clause library" is really a mixed FORMS archive — complete will/POA templates, letters, blank
intake forms and eight subfolders alongside true single-clause files — and the seed stage ran all
of it through the library segmenter (separator rules / blank gaps), which keeps a full instrument
as one giant piece. The Trust Agreements seed folder (also the canary) is entirely full client
documents. Separately: the pairs UI was rendering **sigText** — the §5.2 fold whose own header
says "never displayed" — which is why even correct pieces read mangled.

**Adam's decisions (recorded 2026-08-02, enforced in code):**
- **POA is excluded — limited clause variation.** Was already decided, but the pair-builder never
  checked `trustRelevant`, so POA pieces reached his 30 labels anyway. Now filtered, with a test.
- **Everything goes through the instrument segmenter.** Seed and corpus now cut with the same
  grammar — which Gate 1 implicitly required all along (a seed piece can only land in a mined
  family if both sides are cut the same way).
- **The litmus test: a complete document the instrument segmenter cannot segment carries no
  minable clauses** → excluded as `unsegmentable`, named in the ledger. Enforced via seed-file
  triage (same haiku family as corpus triage: docCategory + contentKind) with scope = trust/will.
- **Single-clause excerpt files are kept** (Adam's call): a file that IS one clause passes the
  litmus as a one-clause document; `contentKind=clause-excerpt` exempts it from the
  under-segmentation exclusion.

**Also in the same pass:** execution blocks truncate at the first attestation paragraph (the last
article of a will runs straight into IN WITNESS WHEREOF and its operative text is real); three
attestation formulas added to the detector (they were surfacing as "clauses"); piece ids became
`fileId:sN` so stale ledgered batches and old boundary-mark drafts can never collide with new
pieces; both seed batches got the #243 ledgered-resume pattern; and a latent re-run bug died (the
old stage only processed `status==='converted'` rows — a completed run left none, so a re-run
would have written an empty gold set). Old draft labels/marks reference dead pair/piece ids and
are dropped by the existing staleness guards — nothing to migrate.

**Verified:** clause-miner 398/398 (up from 363), root 1056/1056, builds green. Negative controls
run and reverted: the POA-pair filter and the execution-truncation each fail their test when
removed.

**✅ RE-RAN CLEAN the same day (#257 merged, both stages green on Cloud Run):**
- **Seed:** 121 triaged / 0 failed. **54 excluded by name** — poa:26 (over a fifth of the
  "library" was POA content — Adam's exclusion fully vindicated), letter:11, livingWill:8,
  questionnaire:1, other:2, over-segmented:4, no-pieces:2. **67 in scope → 209 pieces** (194
  clause / 15 commentary, 130 trust-relevant, 17 canary), 47 execution blocks truncated,
  0 unclassified. All conversions were cache hits — spend was the small haiku batches only.
- **Calibrate (emit):** seedPieces=194, labelPairsRequested=30, boundaryDocs=5, failure=null.
  ~33 min of CPU — emit walks all 512 segmented trusts to build the candidate band.
- The 4 `over-segmented` and 2 `no-pieces` files are named in the run ledger
  (`firms/firm-001/clauseMining/pilot-1` → seed.excludedFiles) — worth a glance during Adam's
  session, not blocking.

### ✅ HEADING FIX, 2026-08-02 evening — Adam caught "FIRST:" inside clause text; it was in the HASH

**Adam's question ("is the FIRST intentional / will it be extricated?") uncovered a real identity
defect, not cosmetics:** sigText folds spelled CARDINALS ("thirty" → #) but not ordinals, so the
leading structural marker survived into Ring-0 identity — the same clause under FIRST in one will
and THIRD in another hashed DIFFERENTLY. On a form-uniform corpus where clauses drift position
across templates/eras, this fragments exact identity and inflates paid adjudication; it is a live
suspect for the "only 131 trivial auto-merges from 5,407 signatures" observation that paused
identity. Adam chose fix-first-then-label.

**The fix:** `extractLeadingHeading` (core/segment.ts) strips ONLY the marker the boundary grammar
itself fired on — "FIRST:", caps ordinal without colon, "ARTICLE IV", "Section 5.2", leading
"5.2 " — at the very start of a block, into a `heading` metadata field on SegmentRecord/SeedPiece
(packet shows it as `found under "FIRST"`). Ordinals in prose ("the first anniversary of my
death") are untouched, and a block that is ONLY a heading keeps its old text rather than hashing
empty. Negative-controlled: disabling extraction fails 2 tests, including same-clause-under-
FIRST-vs-THIRD ⇒ one ring0Hash.

**Re-runs are version-gated now, not status-hacked:** `SEGMENTER_VERSION` (seg/2) is stamped on
every row; STAGE=segment re-processes rows whose stamp is stale and still skips up-to-date rows on
a plain resume. (The seed stage got the same property earlier today via eligible statuses.)
`needs_human_review` rows stay excluded — retrying them re-submits paid boundary batches.

**Consequence:** every ring0Hash changes ⇒ corpus re-segment (CPU only) + seed + calibrate re-run
(~$1 — today's piece classifications resume from the ledgered batch since pieceIds are unchanged).
Identity has produced no durable merges yet, so nothing else invalidates.

**▶ NEXT: dispatch `STAGE=segment` (secret on — fallback possible) → `STAGE=seed` → `STAGE=calibrate`
on main, then Adam's 1-hour labelling session at /clause-calibration** (fresh packet, 30 pairs, old
draft labels/marks are stale-dropped automatically). Then `STAGE=calibrate` (tune) → identity
re-run at calibrated banding → canonicalize → stats → catalog → gates.
1. **The review UI** (task #6: calibration packet renderer + label capture + catalog queue +
   Clause Picker) — agent work, no Adam action, and it is what makes Adam's 1-hour labelling
   session possible.
2. **Corpus stages up to the next spend gate:** `triage` over the 60-file sample is possible
   now, but the real sequencing question (sample-only vs full-corpus conversion first, §10
   wall-clock plan) should be decided when dispatching.

The §4.4 open item stands: tighten the hard-wrap trigger before corpus-wide `STAGE=segment`.

**Step 2 was:** Nothing here needs Adam except the
real FIRM_ID. Sequence:

1. `STAGE=manifest` with `SAMPLE_LIMIT=60` — stratified across the attorney folders (§4.4). Seed
   folders are excluded from the corpus by construction and are never sampled.
2. `STAGE=convert` — LibreOffice ladder. **First stage that costs real money** (CPU only, no AI —
   small). This is the §4.4 / §8 QA gate: conversion fidelity, numbering survival, RTF bold/caps run
   survival, reflow correctness on pre-2000 files, and whether Schedule A carries asset values
   (which decides `estateSizeBand`'s fate, §7.1).
3. `STAGE=seed` + `STAGE=calibrate` — produces Adam's labelling packet. **First AI spend**; bring
   him the projected cost first, against the $350 pilot ceiling / $250 day breaker.

Run stages with `ref=main` now that #232 is merged. The workflow's `stage` input defaults to
`preflight`, which is always safe to re-run.

**Agent work still available with no Adam action:** the review UI (calibration packet + label
capture + the Zipf-triaged catalog queue + the Clause Picker, task #6 above), and the §12 weekly
incremental Cloud Function. Checkpoint-2 work (union-template assembly, Gate 5) stays deferred until
the catalog review begins, per §6.4.

### Working-with-Adam notes (carry into every session — distilled 2026-07-30)

- **North star, in Adam's words:** "one click estate planning drafting software drafting, or as
  close as I can to it." The firm has NOT yet used the software live; building since day one.
  Architecture serving it: deterministic template-first drafting, AI at the edges (intake
  extraction + review), clause catalog mined from the practice's own archive.
- **Communication:** plain-language breakdowns, decisions surfaced as SHORT questions with
  recommended defaults — never hand Adam a long technical document to review (the full design doc
  overwhelmed him; the five-promises summary + guided Q&A is what worked). Explain AI/token/cost
  concepts from scratch when they come up.
- **Consequential go-aheads need real confirmation.** Adam once sent "proceed with the pilot" via
  an auto-suggest he hadn't read, and retracted it. Treat terse approvals of big autonomous
  actions (spend, client-data processing, irreversible steps) as suspect — restate what's about
  to happen and get a deliberate yes.
- **Model economy:** session stays on Fable through the pilot/checkpoint-2 arc (judgment-heavy);
  mechanical subagents pinned to cheaper models; firm drafting default is claude-opus-5 (#219);
  revisit session tier after the catalog ships.
- **PR conventions settled in practice:** docs + verified non-Never-Break code auto-merge (squash)
  with confirmation to Adam; Never-Break bundles ship as annotated PRs HELD for his explicit
  words; every PR watched until merged; deploys confirmed via armed check-ins.
- **Scratchpad caveat:** the detailed Drive inventory (per-folder JSONL + report) lives only in
  the session container (client names — deliberately uncommitted) and dies with it; Stage 0 of
  the miner re-derives it properly. Summary numbers are in this file's 2026-07-30 entry.

---

## 🔵 SESSION — 2026-07-28 PM #6 (Adam's IT-R review · Schedule E column D filled · the deploy-blanks-the-site bug root-caused)

**TL;DR — Adam produced a real IT-R off the new intake and asked for an accuracy review. Every
figure reconciled. One 45c discrepancy was real and traced to the intake, not the engine. Column D
and the cache-header bug both got taken off the carried list.**

**The return checked out.** Gross $1,750,000; deductions $200,000; Line 9 $1,550,000 equal to the
sum of the three class distributions **to the cent**; classes right (child A, sibling C, cousin D);
Class C $469,523.66 at 11% = $51,647.60; Class D $560,952.23 at 15% = $84,142.83; total
**$135,790.43** as filed, re-derived independently rather than read off the form. The mortgage was
deducted on Schedule D rather than netted against Schedule A column D, which is what the
instructions require. The 8-month deadline correctly shifted off New Year's Day to 2027-01-04.

**The 45c that was not rounding.** Two beneficiaries who take equal shares came out $494,524.11 and
$494,523.66. Running the same estate through the engine with EXACT thirds gives a 3c spread — plain
cent apportionment across four assets — so 45c meant the entered shares were not equal. Cause: the
residue box only took percentages, and a third has no exact decimal. `33.33` is $167 short on a
$500,000 residue and `33.3333` is still short; something has to absorb it. **The residue block now
carries the same share-format picker the asset allocations have and opens on FRACTION**, so `1/3`
three times is exact. Adam asked for the toggle; the default is the part that fixes the figures.

**Schedule E column D — filled, and there was never a good reason not to.** The filler leaves boxes
empty where the estate record has no fact (the L-9 skips an unknown lot and block: a wrong block on
a lien release is worse than an empty one). Column D is not that case — the answer IS the
allocations. Blank was an omission, not caution. See §2 above for how it is drawn.

**"Fractional or percent interest" printed `100`, not `100%`.** The instruction is about the
notation, not just the number, and a bare figure on the schedule that generates the tax waiver
leaves the reader to supply the unit. `formatInterestNotation` restores the sign on a bare number
and passes fractions and already-signed values through untouched — it adds a symbol the State
requires, it never rewords the attorney's entry.

**🔴 THE DEPLOY WAS BLANKING THE SITE, AND HAD BEEN FOR A WHILE.** Adam reported a blank page after
a deploy. Root cause, measured rather than guessed: **Firebase matches header rules against the
REQUEST path, not the rewrite destination.** Every route rewrites to `/index.html`, so
`"source": "index.html"` only ever fired for a literal `/index.html`, which nobody visits.
Production served `/` and `/admin/inheritance-tax` at Firebase's default `max-age=3600`. A
returning browser replayed hour-old HTML naming content-hashed chunks the new release had deleted,
the dynamic import failed, `ErrorBoundary` caught it, blank page.

Proven both directions before touching anything: all 26 chunks the live site referenced returned
200 (so production was internally consistent for a cold client), serving the complete current
bundle to a real browser rendered the sign-in page, and removing one chunk reproduced the symptom
exactly — `Failed to fetch dynamically imported module`. **This was never a bug in any of the
inheritance-tax work; it would have blanked the site after any deploy.**

The new rule's glob excludes every extension the immutable rule claims, so the two can never both
match one path and precedence never decides anything. **Verified in production after deploy:** `/`,
`/admin/inheritance-tax`, `/login` and a deep route all `no-cache`; hashed `.js` and `.css` still
`public, max-age=31536000, immutable`.

⚠️ **If hosting headers are ever edited again:** they can only be verified by deploying and
re-measuring. `curl -sSI` the root AND a hashed asset. The failure worth reverting for is an asset
losing `immutable` — nothing breaks visibly, the app just quietly re-downloads ~2 MB per page load.

**Green:** 1014/1014, root + functions tsc, lint 0 errors, build. The column-D test reads the drawn
text back out of the produced PDF with a real reader and fails when the drawing pass is removed.

**▶ NEXT — see the carried-forward list below.** Nothing in the allocation model is outstanding.

---

## 🔵 SESSION — 2026-07-28 PM #5 (the card charge — root cause found in our own code, with the first reproducing test)

**TL;DR — Adam tested again and got `Cannot read properties of null (reading 'postMessage')`. The
cause is not the AffiniPay SDK and never was. It is an early `return` in our own component. Third
fix, but the first one derived from reading the code rather than hypothesising about the SDK, and
the first with a test that fails against the old code.**

**The sequence, which happens on the normal path every single time:**
1. The SDK mounts its iframes into `#af-card-number` etc., inside the main `DialogContent`.
2. Clicking **Review** sets `showConfirm`.
3. `if (showConfirm) return <Dialog>…</Dialog>` is an **early return into a different tree**, so
   React unmounts the form. The iframes leave the document, and a detached iframe has a **null
   `contentWindow`**.
4. Clicking **Confirm** called `getPaymentToken()`, which posts a message to each field iframe →
   `Cannot read properties of null (reading 'postMessage')`.

**Why #156 and #185 missed it.** #156 fixed the CSS selectors (real, necessary). #185 fixed a stale
singleton on *reopen* (also real). Neither touched the confirm-step unmount, which is the path the
attorney actually takes. Both shipped with no test.

**The fix: tokenize while the fields are still on screen.** `tokenizeCurrentFields()` is called
from Review, before `setShowConfirm(true)`; the one-time token is carried in state and the confirm
step never touches the SDK at all. The token is dropped on Back and on close, since it is
single-use and describes the card as it was.

**The test is the part that matters.** `tests/unit/charge-payment-token-ordering.test.tsx` asserts
the ordering invariant — tokenized at Review, never from confirm — and it **fails against the
pre-fix component**: 0 calls at Review, 1 call after confirming. Standing it up needed a faithful
mock, worth knowing: the component calls `resetHostedFieldsSdk()` on every open, which does
`delete window.AffiniPay` and re-adds the `<script>` tag, so the test spies on
`document.head.appendChild` and re-installs the global plus fires `onload` — the browser's own
sequence. A non-configurable global does NOT work: in an ES module `delete` then *throws*, and the
component swallows it as an SDK init error.

**Green:** 930/930, tsc, lint 0 errors, build.

**✅ VERIFIED LIVE BY ADAM, 2026-07-28 — the card charge works for the first time.** A real card
authorized $1.00: *"Payment Authorized — $1.00 was authorized on Karen K. Elias & Adam J. Elias's
account. Funds are captured on AffiniPay's next daily batch."* The diagnosis held. This bug had
been open since 2026-07-06 and survived #156 and #185.

**What this leaves.** The charge **authorizes**; AffiniPay captures on its next daily batch. So the
one remaining payments item — proving the LawPay webhook end to end (#186 replaced a signature
check 8am never sends with an Event-URL token plus a gateway re-read) — **should exercise itself
when that batch runs.** Worth checking the next day that the payment moved from Authorized to
Paid in the app without anyone touching it. If it did, the webhook is proven and that item closes
too. If it did not, the webhook is the thing to look at, not the charge.

---

## 🔴 CARRIED-FORWARD ITEMS — what they actually are

These have been repeated verbatim for weeks without saying what they mean. Written out once here.

### ❌ NOT DOING — decided, do not re-raise

Adam answered these on 2026-07-28. They kept coming back as open questions because the answers were
recorded in `docs/IT-R-FORMS-BUILD-PLAN.md` §3.0 and in this file's own 7/28 PM #3 entry, but never
in the carried-forward table — which is the part that actually gets re-read. Cost: five sessions of
re-litigating a closed decision.

| Question | Answer |
|---|---|
| Nonresident decedents (Track 3 / IT-NR)? | **No — the firm does not take them.** Track 3 is closed. |
| Pre-2018 deaths? | **Not in practice** — so the L-9(A) and both IT-Estate returns are not being built. |
| A life-insurance asset type? | **No, and it would be harmful** — it would invite entry of the *exempt* policies and over-tax the estate. |

**No code is needed for Track 3 to stay closed** — checked rather than assumed. A nonresident matter
is already refused at `computeEstate`, at `buildITRFormData` and at the L-9 builder; each message
cites N.J.A.C. 18:26-2.15 and names the correct form (IT-NR, L-9 NR); and the intake screen shows an
amber notice the moment **NJ resident** is unchecked, before any estate is entered. That is settled
behaviour, not a placeholder.

**What is actually left is four things:**

| # | Item | Blocked on |
|---|------|-----------|
| 1 | **Official filled PDFs for IT-EXT / L-9** | Nobody — real work, no decisions |
| 2 | **A real payment through the payment page** | Adam, live |
| 3 | **Open a PRE-allocation-model matter in the browser** | Adam, live — small |
| 4 | **The wills Drive pipeline — does it work at all?** | Nobody — investigation, then a scope call from Adam |

**1. Official filled PDFs for the companion forms.** IT-EXT and the L-9 render as HTML workpapers
today. Each needs its own blank form and field inventory — the same work the IT-R already had done
to it. No decision required; just not started. (The two IT-Estate returns are NOT in this item: they
are pre-2018 and were declined above.)

**4. The wills Drive pipeline.** Found 2026-07-31 while getting the clause miner's Drive access
working: **the Google Drive API was disabled on project 749324460027** until that day. Four separate
consumers authenticate through it — `wills-backfill.ts`, `wills-drive-client.ts`,
`wills-drive-watcher.ts`, `wills-pilot.ts` — all via ADC with `drive.readonly`, so all shared one
point of failure. The `STAGE=preflight` report now counts `wills_documents` and `pipeline_state`
and prints them; read that count before assuming anything.

**MEASURED 2026-07-31: `wills_documents=0`, `pipeline_state=0`.** Both collections read
successfully — this is a genuine zero, not an unreadable one. The pipeline produced no work product,
and an empty `pipeline_state` means it was never even initialized: it did not run and stop, it never
started.

**This does NOT affect clause mining**, which shares no state with it — separate manifest, separate
conversion, separate collections — and whose Drive access is now independently verified. The 7/30
Drive inventory is also unaffected: it was obtained through the Claude Drive connector
(OAuth as Adam), a different path that was never blocked by the project's disabled API.

What it needs is a scope call from Adam once the count is known: repair the wills pipeline, or
retire it if clause mining supersedes what it was for. Do not fold this into the clause-mining
pilot.

**2. A real payment through the payment page.** See item 2 below — unchanged.

**3. Opening a matter saved before the allocation model.** See §3 above. Normalisation is tested;
the screen reading correctly afterwards is not.

---

**1. ~~"The live card test on #185"~~ — ✅ DONE 2026-07-28, fixed by #207 and verified live. Kept
for the diagnosis. Nothing to do with inheritance tax.** It is the
**Charge Payment** dialog under a client's Payments tab (`ChargePaymentDialog.tsx`), which takes a
credit card through AffiniPay/LawPay Hosted Fields. It has never successfully captured a card.
Two fixes shipped blind because browser automation cannot type into a cross-origin iframe — #156
(the SDK needs CSS selectors, not bare element ids) and #185 (the SDK was being handed iframes the
component had already destroyed). **Neither has ever been confirmed by a human typing a card.**

To test: open a client → Payments → **Charge Payment** → type card `5466160519943714`, exp
`04/2029`, CVV `212`, ZIP `08831` → open the browser console and look for
`[ChargePaymentDialog] Hosted Fields state:`. Success is `length: 16, luhn: true`. If it still says
`length: 0, "Input field is empty"`, the fix did not work and the next single-variable step is
removing the innerHTML-wipe/re-init effect. **Do not click Charge until the console shows the card
captured.**

**2. "A real payment through the payment page"** — separate from the above. It proves the LawPay
webhook end to end after #186 replaced a signature check (8am never signs its callbacks, so the
old HMAC check rejected every real callback) with an Event-URL token plus a gateway re-read. The
existing "Paid" records came from Record Payment and the payment-page link, never from the card
dialog.

---

## 🔵 SESSION — 2026-07-28 PM #4 (Adam's browser pass — saved matters were unreachable; now they open)

**TL;DR — Adam tested the Inheritance Tax page end to end. Overall verdict good, with two things:
he could not retrieve an existing matter, and he wanted to know why assets can only be added under
a beneficiary. The first was a real bug and a bad one. The second is correct behaviour that the
screen never explained.**

**The bug: a saved matter was a dead end.** The page could LIST matters — and that was all. There
was no `getInheritanceMatter` callable at all: `getMatter` existed in the store and was never
exposed, the Firestore collection is closed to the client SDK by design, and the list rows were
not clickable. So you could save a matter, see it in the list forever, and never open, edit,
compute or file it. Fixed: new callable, service method, and an **Open** button per row that
restores the matter, its computation and its checkpoint.

**Two correctness traps handled while wiring it, neither obvious:**
- **A stale computation is withheld.** Editing a matter does not delete its old computation, so a
  matter saved after its last compute has figures on file that no longer describe it. Returning
  those would put an out-of-date total on screen looking exactly like a current one. The callable
  withholds them and returns `computationStale`, and the page says "recompute before requesting
  review".
- **An approved checkpoint is still returned**, because its figures are frozen and stay valid for
  rendering a form even after a later edit (FND-IMMUT). Withholding it would break the download of
  a form already signed off. `getLatestCheckpoint` also returns a *pending* checkpoint so a review
  in progress can be resumed — `getApprovedCheckpoint` remains the authority for forms.
- **The loaded matter is kept WHOLE.** It is typed as `ITRMatterInput` but at runtime carries
  fields the editor does not model (`itExtension`, `priorPayments`, `disclaimers`). The page edits
  only known keys and sends the object back intact, so reopening and re-saving cannot silently
  drop an elected extension or a recorded payment. There is a test for exactly that.

**The question, answered on screen rather than in a reply:** assets sit under a beneficiary because
this is a tax on the *inheritance*, not on the estate. The same $100,000 is taxed 0% to a child,
11–16% to a sibling, 15–16% to a friend (N.J.S.A. 54:34-2) — so an asset with no named recipient
has no rate and cannot be computed. That is now explained in the beneficiaries card, including how
to enter an asset split between people.

**Green:** 913/913, root + functions tsc, lint 0 errors, build. Two negative controls run and
reverted (latest-checkpoint sort reversed, `updatedAt` dropped). Note: the suite count jumped from
890 because a stale `functions/node_modules` after a worker restart had been preventing three
unrelated test files from running — reinstalling restored them, and they pass.

**▶ NEXT — still Adam's:** the live card test on #185 and a real payment through the payment page.
On the inheritance page, worth re-testing the Open button against a matter saved earlier.
*(Superseded — the card test closed 2026-07-28 via #207. See the carried-forward table above.)*

---

## 🔵 SESSION — 2026-07-28 PM #3 (scope closed on Adam's answers · three reporting guards shipped after primary-source research)

**TL;DR — Adam answered the two open scope questions: no nonresident decedents, and no pre-2018
filings in practice. That closes Track 3 and takes the L-9(A) and both IT-Estate returns off the
list. He then raised two things his clients actually have — out-of-state real estate and life
insurance — and asked for the IT-R treatment to be verified by research rather than assumed. Doing
that turned up a live foot-gun neither of us knew about.**

**Researched against the State's own IT-R instructions (`it-rinst.pdf`, 41 pages), not from
memory.** Three findings, each quoted in the code:

- **Out-of-state real property is excluded.** Schedule A: *"Do not report real property located
  outside New Jersey."* It never enters the gross estate.
- **Intangibles are included wherever they sit** — stock *"regardless of where the company is
  incorporated"*, a co-op *"no matter where the co-op is located"*. So the Florida brokerage
  account is taxed; the Florida condo is not.
- **The asymmetry, and the thing I did not know before researching:** Schedule D's "Do not deduct"
  list includes *"Debts secured by real or tangible property located outside of New Jersey."* The
  out-of-state property is excluded from the estate **and** its mortgage is not deductible. It
  cuts one way only, and nothing in the UI stopped an attorney claiming it — which would
  **understate** the tax on a filed return.

**On life insurance, Adam's instinct was right but the fix was not a new field.** The instructions:
proceeds to a *named beneficiary* are *"exempt"* and *"not required to be reported"*; proceeds
*payable to the Estate* *"are required to be reported"* (Schedule C Part III B). The taxable half
is **already representable** as a `transfer` with `part: 'pod_to_estate'`, and the filler's "Type
of Policy" column takes the description — verified in the code, not assumed. Adding a
life-insurance asset type would have invited entry of the *exempt* policies and over-taxed the
estate, so it was deliberately not added.

**Why this had to go on the screen rather than into the engine:** the engine taxes whatever it is
given. All three are errors of *commission* — enter the condo and the return comes back higher,
claim its mortgage and it comes back lower, both entirely self-consistent with nothing erroring
anywhere. The spec names that "the single worst failure mode for this tool".

**Shipped:** `NOT_REPORTED_ON_ITR` — a standing "do not enter" panel on the beneficiaries card
(the load-bearing part, since a note on a dropdown option is no use to someone who never selects
it) — plus per-option `note`s on the asset picker (NJ realty, transfers/life insurance) and the
deduction picker (mortgage). Every line quotes the State's instruction text. Frontend-only, no
data-model change, nothing on the Never-Break list.

**Green:** 890/890 (up from 884 — 6 new), root + functions tsc, lint 0 errors, build. Two negative
controls run and reverted (dropping the mortgage note, and adding the `life_insurance` type the
research says must not exist) — each failed exactly the assertion it should. The new test asserts
**both** the copy and the engine arithmetic that makes the copy necessary, so if the engine is ever
taught to exclude these itself the test fails and the note gets rewritten rather than left
contradicting the code.

**▶ NEXT — the form work is done and the scope is closed.** What remains needs Adam at a desk, not
a session: the live card test on #185, a real payment through the payment page, and the browser
pass on the Inheritance Tax page — now including a look at the new guidance panel, and downloading
an IT-EXT and an L-9 to open in a reader.

---

## 🔵 SESSION — 2026-07-28 PM #2 (IT-EXT and the L-9 are now filled on the State's own paper)

**TL;DR — Took the ▶ NEXT that needed no decision from Adam: official filled PDFs for the
companion forms. IT-EXT and the L-9 are done — filled from the same approved snapshot the IT-R
renders from, with a download button beside each workpaper button. The L-9(A) and both IT-Estate
returns are not, and the reason turned out to be substantive rather than "not got to it yet".**

**The scoping assumption from last session was right, and the reason is worse than expected.** The
L-9(A) is not the L-9 with an earlier date. It asks for a federal-706-style estate-composition
block (real estate / stocks / bank accounts / IRAs / pensions / insurance / transfers / other,
then gross estate and adjusted taxable gifts) that `L9AFormData` carries no figures for — mapping
bequest types onto 706 categories is a decision, not a transcription. And its AcroForm has two
defects: `undefined_16` is **one field carrying two widgets** (page 1's line M *and* page 2's phone
box), and `Lot Block` is **one field carrying both the Lot and the Block widget** — on that form
lot and block cannot be written independently at all. The L-9 blank has no shared names, which is
why it went first.

**A trap found and handled, worth knowing:** IT-EXT's Testate/Intestate pair is a radio group whose
two widgets **both export the value "Yes"** (an `/Opt` array of `["Yes","Yes"]`), so pdf-lib's
`select()` can only ever reach the first — there is no value that names the second. Under `/Opt` the
appearance state of widget *n* is the string `"n"`, so the fix is to set the field to that name.
Verified empirically by writing each index and reading `/V` and both `/AS` back out of the saved
file, not by reasoning about the spec. That is `FieldWriter.radioByIndex`, and it is the same
technique the L-9(A) will need for its shared text fields.

**Judgement calls, all the same direction as before — don't assert what the record doesn't say:**
- **IT-EXT's "Mailing Address to send all correspondence" block is left blank.** Where the Division
  should write is a *choice* — usually the preparing attorney's office — not a fact the estate
  record contains, and defaulting it to the executor would silently redirect the State's notices.
  The L-9's equivalent block *is* filled, because that form's own affidavit text makes it the
  representative ("Deponent authorizes the party listed above to act as the estate's
  representative and to receive the waiver(s) requested herein").
- **An Heir-at-law ticks none of the L-9's "Affidavit of: Executor / Administrator / Joint Tenant"**
  boxes. An unticked box says nothing; a wrong tick swears something untrue.
- **A fourth parcel is refused, not dropped.** The L-9 prints three blocks; filing three and
  silently discarding the rest would understate the land the waiver covers.
- **The notarial block, the predeceased-beneficiary schedule, the signature lines and the
  representative's SSN stay blank** — the model holds none of them.

**Also shipped:** `FieldWriter` and the identity splitters extracted from `it-r-pdf.ts` into
`forms/pdf-fields.ts` (four fillers now share them — the IT-R's 43 fill assertions prove the
extraction was clean); `L9ARealProperty` extended to carry Schedule A's county/street/lot/block/
municipality/owners, which #190's intake work already captures; `scripts/itr-field-inventory.mjs`
generalised to any blank via `--form` / `--file`. Only the two mapped blanks are committed — the
unmapped ones would be dead weight in the deploy bundle, and their URLs are in the build plan.

**Green:** 882/882 (up from 864 — 7 IT-EXT, 11 L-9), root + functions tsc, lint 0 errors, build.
Four negative controls run and reverted (L-9 lot/block swapped, L-9 two-digit year, IT-EXT
testate/intestate widgets swapped, IT-EXT correspondence block filled) — each failed exactly the
assertions it should. Every assertion reads its value back **out of the produced PDF**.

*(Superseded 2026-07-28 — Adam declined nonresident decedents; Track 3 is closed. See the ❌ NOT DOING section above. Kept for the reasoning, not as a live instruction.)*
**▶ NEXT — Track 3 (IT-NR) is still the only untouched track and still needs Adam's decision**: it
changes how tax is computed (NJ-situs property only, N.J.A.C. 18:26-2.15, its own gold cases).
Today a nonresident matter is refused cleanly at compute. The remaining form work is the L-9(A) and
the two IT-Estate returns, all three pre-2018 — scoped in
[docs/IT-R-FORMS-BUILD-PLAN.md](./docs/IT-R-FORMS-BUILD-PLAN.md) §3.1.

**Still needs Adam (unchanged):** the live card test on #185; a real payment through the payment
page; and a browser pass on the Inheritance Tax page — now also worth downloading an IT-EXT and an
L-9 and opening them in a PDF reader, since nothing but a human eye proves a value landed in the
box a human would read it from.

---

## 🔵 SESSION — 2026-07-28 PM (the attestation gap is closed — both deduction types can now be entered)

**TL;DR — Took the one unblocked item off the previous session's list. Two deduction types could
not be saved from the UI at all: the server requires an attorney attestation for
`executor_commission` (death on/after 2025-12-15, R.2025 d.152) and for
`transfer_taxes_other_states` (N.J.A.C. 18:26-7.16), and no screen collected either. Picking one
made the matter unsaveable. Both are now asked for beside the deduction they belong to.**

**Confirming the steer, since it decides the shape:** these are *single-attorney statements of
fact about the estate*, not a two-person review. The regulation makes each deduction allowable
only on those facts, so the attorney filing the return attests them alone — exactly what a solo
firm can do. Nothing here asks for a second attorney. (`approveInheritanceReview`'s refusal of a
self-approval is a different rule and is untouched.)

**Judgement call, in the same direction as the last session's:** an unticked box is a *real
answer*, not a blank field. It says the estate fails the regulation's test, so the deduction
belongs off the return — and the block says that, rather than nagging for a tick that would make
the return claim something untrue.

**Shipped:** `DeductionAttestationFields` (the questions, gated on type and date of death);
`src/lib/inheritance-tax-attestations.ts` (when each attestation is demanded, what is still
outstanding, and which stale one to drop from the payload when the attorney changes a deduction's
type or moves the date of death back before R.2025 d.152 — it stays on screen so the typing is not
lost, but a half-filled leftover must never be sent to a `.strict()` schema); the page's pre-flight
now names the attestation instead of letting a Zod path arrive in a toast.

**Green:** 864/864 (up from 847 — 12 rule tests, 5 component tests), root + functions tsc, lint 0
errors, build. Four negative controls run and reverted (wrong effective date, no-op strip, dead
checkbox, jurisdiction typed into the notes field) — each failed exactly the assertions it should.
Every rule test asserts **both** what the page reports and what the server's real `validateMatter`
does with the payload the page would send, so a client rule that drifts from the regulation fails
on the server assertion rather than agreeing with itself.

*(Superseded 2026-07-28 — Adam declined nonresident decedents; Track 3 is closed. See the ❌ NOT DOING section above. Kept for the reasoning, not as a live instruction.)*
**▶ NEXT — unchanged, and both need Adam.** Track 3 (IT-NR, nonresident decedents) is still the
only untouched track and still a product decision: it changes how tax is computed (NJ-situs
property only, N.J.A.C. 18:26-2.15, its own gold cases). Today a nonresident matter is refused
cleanly at compute, which is defensible. The smaller follow-up is an official filled **PDF** for
IT-EXT / L-9 / IT-Estate — each is a separate State form needing its own blank and inventory; they
render as HTML workpapers today.

**Still needs Adam (unchanged):** the live card test on #185; a real payment through the payment
page; and a browser pass on the Inheritance Tax page — including one deduction of each attested
type, since the component test drives the clicks in jsdom, not a browser.

---

## 🔵 SESSION — 2026-07-28 (every IT-R schedule is filled, and the three orphaned forms are reachable)

**TL;DR — Continued straight through the build plan on Adam's instruction. #189 merged (Recap,
IT-PMT, Schedule D) and deployed green. PR #190 carries the rest: §4.4 (Schedules B-1, B-2, B-3
and C), §4.5 (Schedules A and B), and Track 2 (IT-EXT, L-9/L-9(A) and IT-Estate wired to a
callable and the page). **Every schedule in the booklet is now filled**, and the three forms that
had been exported-but-called-by-nothing since the port are reachable.**

**The estate-tax research Track 2 demanded went differently than the plan expected.** The plan
said the engine does not compute NJ Estate Tax. It does: `computeNJEstateTax` carries a
Simplified-Method table cited to the State's own Form IT-Estate. The `VERIFY: rate tables not
confirmed` marker was a **stale comment on a rule-set field**, not a gap — now corrected in place.
Checked against [NJ Form O-10-C](https://www.nj.gov/treasury/taxation/pdf/other_forms/inheritance/o10c.pdf)
and the Division's own page (2026-07-28): no NJ Estate Tax for deaths on/after 2018-01-01
(P.L. 2016, c. 57); $2M exclusion for 2017 with a circular §2058 computation the State supplies a
calculator for; $675,000 before 2017 with the Simplified Method "based upon the net estate as
determined for the New Jersey Inheritance Tax". **Every figure in the rule sets matched.** No rate
table needed rewriting — what was missing was wiring.

**Judgement calls worth knowing about, all in the same direction — never assert what the record
does not say:**
- Schedule C's three "(required)" questions are ticked **Yes** when the estate reports such a
  transfer and left **unmarked** when it does not. "The attorney entered no such transfer" is not
  "the decedent made no such transfer", and only the second is what No asserts.
- Schedule B's "Is this a Family Limited Partnership?" is answered only when intake answers it.
- Schedule A's block is marked "(All fields required)" by the State. The filler writes what intake
  captured and leaves the rest blank for the attorney — the delivered PDF keeps its fields live.

**Green:** 847/847 (up from 812), functions + root tsc, lint 0 errors, build. Two negative controls
run and reverted. Every PDF assertion reads its value back out of the produced file.

*(Superseded 2026-07-28 — Adam declined nonresident decedents; Track 3 is closed. See the ❌ NOT DOING section above. Kept for the reasoning, not as a live instruction.)*
**▶ NEXT — Track 3 (IT-NR, nonresident decedents) is the only untouched track**, and it is the one
that changes how tax is computed (NJ-situs property only, N.J.A.C. 18:26-2.15, with its own gold
cases). Today a nonresident matter is refused cleanly at compute, which is defensible. Smaller
follow-ups: an official filled **PDF** for IT-EXT / L-9 / IT-Estate (each is a separate State form
needing its own blank and inventory — they render as HTML workpapers today), and the attestation
gap below.

**~~Still open~~ — the attestation gap. CLOSED the same day, see the entry above; kept for the
reasoning.** Two deduction types demand an attorney attestation the
server enforces and no screen collects: `transfer_taxes_other_states` needs
`transferTaxEligibility` (N.J.A.C. 18:26-7.16) and `executor_commission` needs
`executorCommissionEligibility` for a death on/after 2025-12-15 (R.2025 d.152). Adam's steer was
that no dual attestation is needed or practicable in a solo firm — worth confirming that this is
the same thing he meant, since these are single-attorney factual attestations the *server* rejects
the save without, not a two-person review. Until they are collected, those two deduction types
cannot be saved from the UI.

**Still needs Adam (unchanged):** the live card test on #185; a real payment through the payment
page; and a browser pass on the Inheritance Tax page.

---

## 🔵 SESSION — 2026-07-27 PM #2 (Track 1's cheap wins are all shipped — the IT-R now files every figure it computes)

**TL;DR — Took the previous session's ▶ NEXT (`docs/IT-R-FORMS-BUILD-PLAN.md`) and closed §4.1,
§4.2 and §4.3 in one PR (#189). The Schedules B1–B4 Recap, Form IT-PMT and Schedule D (Parts I,
II-A and III) are now filled from the approved snapshot. Both open questions in the plan answered
themselves from the form: the voucher's own printed line says "Amount paid with return (From IT-R
Summary Page, line 21)", and page 10's rows 1 and 2 really are mislabelled — `2 Schedule B2
Sto111ckCoops_2` is the **B-1 accounts** row. No computed figure moved: the recap's line 5 and
Schedule D's grand total are written from Lines 3 and 6 rather than re-added, so the schedules
cannot contradict the Summary Page.**

**Also fixed, found while mapping:** the deductions dropdown offered "Inheritance tax paid to
another state" as `other_state_inheritance_tax`, which the server's strict enum has never
accepted — picking it made the matter unsaveable. Now sends the server's
`transfer_taxes_other_states`.

**New intake field:** `payeeName` on a deduction ("Paid to" on the page) — Schedule D column (B),
"Name of Business/Person Paid". Optional throughout, so existing matters keep working.

**Green:** 821/821 (13 new), functions + root tsc, lint 0 errors, build. Two negative controls run
(swapping the recap rows and misrouting counsel fees both fail the suite), and every assertion
reads its value back **out of the produced PDF**.

**▶ NEXT — four decisions, none blocking, in [docs/IT-R-FORMS-BUILD-PLAN.md](./docs/IT-R-FORMS-BUILD-PLAN.md) §5.**
Decision 1 has narrowed: everything cheap is done, and what remains in Track 1 is §4.4 (a per-type
detail group on `Bequest` for Schedules B-1/B-2/B-3/C) and §4.5 (Schedules A and B — a real intake
expansion). Track 2 still needs legal research before code; Track 3 (IT-NR) is still a product
question. Stopping here is defensible: every figure the engine computes is now on the filed form.

**Known gap worth a decision of its own:** two deduction types demand an attorney attestation the
server enforces and no screen collects — `transfer_taxes_other_states` needs
`transferTaxEligibility` (N.J.A.C. 18:26-7.16), and `executor_commission` needs
`executorCommissionEligibility` for a death on or after 2025-12-15 (R.2025 d.152). Both now fail
with a clear server message rather than an opaque one, but neither can be saved from the UI.

**Still needs Adam (unchanged from below):** the live card test on #185; a real payment through the
payment page; and a browser pass on the Inheritance Tax page.

---

## 🔵 SESSION — 2026-07-27 PM (official IT-R fill shipped · deploy outage root-caused and ended)

**TL;DR — Four things shipped and are live. (1) The State's own Form IT-R is now filled from the
approved snapshot and downloadable: cover page, Summary Page lines 1–22, Schedule E and Schedule
B-4 (#184). (2) The nine-day functions-deploy outage is over — its cause was `LAWPAY_WEBHOOK_SECRET`
being bound but never created, which fails validation for the whole codebase before anything
uploads. (3) That secret should never have existed: 8am does not sign webhooks, so the HMAC check
rejected every real callback. Replaced with an Event-URL token plus a gateway re-read, and verified
against the live endpoint (#186). (4) The hosted-fields card dialog's postMessage crash was
root-caused to a singleton SDK being handed iframes we had already destroyed (#185).**

**▶ NEXT — [docs/IT-R-FORMS-BUILD-PLAN.md](./docs/IT-R-FORMS-BUILD-PLAN.md)** scopes the remaining
form work for a fresh session: three tracks, tiered by cost, with the hard-won mapping facts and
four decisions needed from Adam before starting.

**Still needs Adam:** the live card test on #185 (`length: 16, luhn: true` in the console); a real
payment through the payment page to prove the webhook end to end; and a browser pass on the
Inheritance Tax page now that the download is live.

---

## 🔴 SESSION — 2026-07-27 (7/26's four items are all closed — but EVERY functions deploy has been failing since 7/18 on a secret that was never created)

**TL;DR — Worked the 7/26 list; all four items are done, and doing them surfaced a bigger one. `LAWPAY_WEBHOOK_SECRET` does not exist in Secret Manager, so `firebase deploy --only functions` dies at secret validation before uploading anything. Every CI functions deploy since 2026-07-18 has failed this way. PR #176's security work — Google OAuth tokens moved to server-only storage, PDF-render network blocking, the webhook signature binding itself — has never reached production, and neither has #180. 87 of the 96 deployed functions were last updated 2026-07-15; the 9 inheritance-tax callables are live only because they were deployed by hand at 15:42 today.**

**▶ NEXT (needs Adam): paste the LawPay webhook signing secret.** From the LawPay/AffiniPay dashboard → webhook subscription → signing secret. Then:

```bash
printf %s '<the-secret>' | firebase functions:secrets:set LAWPAY_WEBHOOK_SECRET --data-file -
gh workflow run "Firebase Functions deploy"
```

Adam chose the real value over a random placeholder, so functions stay undeployed until this is set. Nothing is *newly* broken by waiting — the live webhook has rejected every request since it was written (the env var was never bound to the deployed revision) — but the #176 security fixes stay out of prod.

### The 7/26 list — all four closed

1. **Engine commits applied** ✅ — merged as #181; hosting deploy green.
2. **`INHERITANCE_AUDIT_KEY` set** ✅ — created 2026-07-27 14:56, version 1 enabled. Do not rotate.
3. **Firestore rules deployed** ✅ — and the note below that "Firestore rules are NOT covered by either workflow" was **wrong**: `firebase-functions-deploy.yml` releases `firestore.rules` and `storage.rules` in a step *before* the functions deploy. Both released successfully at 15:43 today even though that run failed. `/firms/{firmId}/inheritanceMatters/**` is closed to the client SDK in production right now. No manual `firebase deploy --only firestore:rules` is needed.
4. **Exposed service-account key rotated** ✅ — with two corrections to the 7/26 account. The key at risk was **not** the appspot one: `service-account.json` for `firebase-adminsdk-fbsvc@` (key `bdb5f411…cd74`) was committed in `5ee4084` (2026-03-02), deleted from the tree in `febfd72`, and left readable in the history of a **public** repo. That SA holds `firebaseauth.admin`, `storage.admin` and `iam.serviceAccountTokenCreator` — enough to mint a token for any user and read every client file. Google's scanner had already auto-disabled the key (`SERVICE_ACCOUNT_KEY_DISABLE_REASON_EXPOSED`), so the window closed before anyone acted on it. This session created a replacement (`eec904f5…`), verified it against live Firestore, and deleted the exposed key. The appspot key `c059f6a5…` named in the 7/26 note no longer exists either — that SA now has only Google-managed keys.

**Left for Adam on the key:** two other user-managed keys on `firebase-adminsdk-fbsvc@` — `4b07cda0…` (2026-05-30) and `8fbb46e4…` (2026-07-06) — are active and unaccounted for. Delete them if you don't know what holds them. And `estate-plan-generator-dc05f6c617b4.json` in the repo root is a dead key file (that key id is gone from the appspot SA); it's gitignored, safe to delete. Rewriting history for `5ee4084` is now optional — the credential in it is deleted, so the blob is inert.

**Also shipped:** #182 — the Inheritance Tax page formats the SSN as you type and names blank required fields instead of letting the server report a missing date of death as "before 2002-01-01". Green: tsc, lint 0 errors, 774/774, build; hosting deploy green.

**Still true from 7/26:** nobody has clicked through the Inheritance Tax page against live Firestore. The callables are deployed, so that browser pass is now actually possible.

---

## 📍 SESSION — 2026-07-26 (NJ inheritance-tax engine ported in from elias-estate-suite — ALL 4 ITEMS CLOSED 7/27, see above)

**TL;DR — The NJ Transfer Inheritance Tax engine now lives in this repo.** It originates in
`adameliaslaw/inheritnj`, was ported and gold-case-verified in `adameliaslaw/elias-estate-suite`
(`apps/inherit`), and was the only thing that repo had which this one lacked. That repo is now an
archive; development continues here. Three commits on branch `feat/nj-inheritance-tax-engine`:

1. **Engine** — `functions/src/inheritance-tax/` (engine, rule sets by date of death, strict
   validation, IT-R / IT-Estate / IT-EXT / L-9(A) form builders). Pure TypeScript: no Firebase, no
   Chromium. PDF rendering deliberately NOT ported — this repo already renders PDF via jspdf and
   DOCX via docxtemplater.
2. **Persistence** — `inheritance-tax-store.ts` (Firestore + HMAC audit chain, appended inside a
   transaction) and `inheritance-tax-review.ts` (save → compute → request review →
   approve/finalize → IT-R). NOT a port of the suite's Firestore adapter: that one caches in memory
   and writes behind, requiring `--max-instances=1`, which would mean stale reads and lost writes
   under Cloud Functions.
3. **Legal spec** — `docs/IT-R-SPECIFICATION.md`, the line-by-line decode of the State's IT-R
   instructions. It is *why* the figures can be trusted. Cite it by section before changing
   anything in the engine.

**Verified:** gold cases 25/25 reproducing the State's own worked examples to the cent —
**$558.71 / $191.43 / Class C $8,250**; full suite **774 passed**; `tsc --noEmit` clean in root and
`functions/`.

**Rules that must not be weakened:** the IT-R renders only from an **approved** checkpoint's frozen
snapshot (so an edit can never retroactively change a signed-off form); `approveInheritanceReview`
refuses a self-approval unconditionally, and `finalizeInheritanceReview` is a *separate*
requester-only act audited as `matter_finalized`, never `review_approved`; out-of-scope estate
structures (nonresident decedent, pre-2002 death, deductions exceeding the estate, non-pro-rata
apportionment) are **refused**, never estimated.

### ▶ ~~NEXT (needs Adam at a desk) — do these in order~~ — ALL FOUR DONE 2026-07-27; kept for the reasoning, not the instructions. Item 3's claim that the workflows don't deploy Firestore rules is wrong (see the 7/27 entry).

**1. Apply the three commits.** They are not in this repo yet — the agent session had read-only
access. Either approve the repo-push prompt in a Claude Code session, or apply the delivered bundle
from a terminal:

```bash
git fetch /path/to/nj-inheritance-tax.bundle \
  feat/nj-inheritance-tax-engine:feat/nj-inheritance-tax-engine
git checkout feat/nj-inheritance-tax-engine
npx vitest run && (cd functions && npx tsc --noEmit)   # expect 774 passed, clean
```

**2. Set the audit-chain signing key.**

```bash
firebase functions:secrets:set INHERITANCE_AUDIT_KEY
```

Any high-entropy value. The code **fails closed** without it rather than degrading to a plain
SHA-256 that anyone who can read the log could recompute. **Never rotate it once chains exist** —
a chain only verifies under the key that wrote it.

**3. Merge — then deploy the RULES by hand.**

Merging to `main` is enough for the code: `.github/workflows/firebase-functions-deploy.yml` and
`firebase-hosting-deploy.yml` auto-deploy functions and hosting on every push to `main` (CLAUDE.md
rule 5 — don't deploy those manually).

**Firestore rules are NOT covered by either workflow.** This branch closes
`/firms/{firmId}/inheritanceMatters/**` to the client SDK, and that change only takes effect when
you run:

```bash
firebase deploy --only firestore:rules
```

It matters: the stored record contains the decedent's SSN, the audit chain is append-only and
hash-linked, and a checkpoint's `status` **is** the approval gate — client write access would let a
matter approve itself.

⚠️ Because this touches `firestore.rules`, it is on the **Never-Break List** (CLAUDE.md rule 7):
it needs explicit sign-off before merging, not agent auto-merge.

**4. Rotate the exposed service-account key** *(independent of 1–3, and time-sensitive)*. Per
`AUDIT_HANDOFF.md` §1, a full GCP service-account JSON with private key was committed inside
`.gitignore` and, although `4c01354` removed it from the working tree, **history was never
rewritten** — it is still readable at commit `223bdeb`, and this repo is now public. Google Cloud
Console → IAM → Service Accounts → `estate-plan-generator@appspot.gserviceaccount.com` → Keys →
delete key id `c059f6a569611c0aa9f74fa93fe1d45707f36d21`, create a replacement. Then check that
account's usage logs, and decide whether to `git filter-repo` the history before the repo stays
public.

### It IS wired — here is what exists, and the one thing that still needs a human

**UI:** `src/pages/admin/InheritanceTaxPage.tsx`, routed at `/inheritance-tax`
(`ROUTES.INHERITANCE_TAX`), staff-only via `AppLayout allowedRoles={[...STAFF_ROLES]}`. Two ways
in: an **"Inheritance Tax" button in the dashboard header** (beside New Client) and a sidebar
entry. It walks the whole flow: decedent + flags → personal representative → beneficiaries
and bequests → deductions → **Save → Compute → Request review → Approve | Finalize → Load IT-R**,
plus the audit trail with a live chain-validity badge. Each button unlocks only when the server
would allow it, and any edit clears the computation and checkpoint — mirroring the rule that a form
renders only from a frozen, reviewed snapshot.

**Service:** `src/services/inheritance-tax-service.ts` — `httpsCallable` wrappers, following
`client-service.ts`.

**Types:** `src/types/inheritance-tax.ts` — the input shape plus the enums. The relationship picker
is **grouped by tax class** (A exempt / C $25k then 11–16% / D 15–16% no exemption / E exempt),
because that field alone determines the class under N.J.S.A. 54:34-2 and a wrong pick produces
confident wrong numbers rather than an error. Bequest types are labelled by IT-R schedule
(A, B, B-1…B-4, C) so they reconcile against the form.

**Deliberately NOT built: any mapping from the estate-planning questionnaire.** A decedent is
almost always a new intake, not a former planning client, so the two data models are kept apart.
`saveInheritanceMatter` accepts an optional `clientId` for the occasional case where a planning
client has died — an association for cross-reference, not data sharing. Do not build a
questionnaire→IT-R importer on the strength of that field.

**What still needs a human:** a browser pass. `tsc -b`, `npm run lint` (0 errors) and
`npm run build` are green, and the 774-test suite passes, but per CLAUDE.md rule 4 type-checks
prove the code, not the feature. Nobody has clicked through this page against a live Firestore.
Walk one matter whose answer you already know, end to end, before it touches a client file — and
expect the server to reject a malformed matter with a schema message rather than failing quietly.

### Where this came from — the source repo is archived

`adameliaslaw/elias-estate-suite` is **an archive as of 2026-07-26** and is no longer developed.
Do not open work there, and do not expect anyone to maintain the engine at its origin — this repo
is now the only live home for it. Its `docs/HOMEWORK.md` has the full account of what that
consolidation did and did not do (it moved one repo of four; this repo was named its centrepiece
and never opened). If the branch was delivered via that repo's `transport/nj-inheritance-tax-engine`
branch, that is why — the session that built this had read-only access here.

The engine's provenance chain is `inheritnj` → `elias-estate-suite/apps/inherit` → here, and the
gold cases came the whole way intact.

### Not carried over from the suite, on purpose
`apps/generator` (one document type — this app has 22), the standalone HTTP servers, CLI, web UIs,
the reviewer-invitation lifecycle, purge tooling, deployment manifests, `@elias/foundation` and
`@elias/canonical`. All of it was infrastructure for running the tax engine as a separate product.

---

## 📍 SESSION — 2026-07-15 (BL/BK/BM security batch + finding T shipped · #64 VALIDATED — 8.9-min functions deploy)

**TL;DR — Backlog session while the card test waits. (1) Security: PR #159 drained the round-2 leftovers — `linkClient` now requires a VERIFIED email to claim an existing client record (unverified password-signup takeover closed — same class as R5-010), checks the firm exists before minting claims, and rate-limits prospect stubs via the shared per-firm throttle; deliberate HttpsError codes rethrown (were flattened to `internal`); `getFirmBranding` only returns `googleMapsApiKey` to firm members (claim match, or linked client record for claimless anon questionnaire sessions). 9 new emulator tests (incl. the harness's first v1-callable mock), all negative-control-verified; suite 54/54. (2) **#64 validation COMPLETE:** #159 was the first `functions/src` merge since #155 — the deploy went green in 8.9 min (14:26→14:35Z), selective (only changed functions), far under the 20–40 min guess. The simplified CI path is proven end-to-end; #64 stays closed. (3) Finding T (PR #160): the OpenAI SDK path had a 5-MIN SOCKET timeout (openai 4.104 node runtime = node-fetch + agentkeepalive default agent; finding's undici-headersTimeout hypothesis was wrong, same 300s kill) — any >5-min OpenAI generation was impossible, retries died identically. `_callOpenAI` now passes a 10-min keepAlive `httpAgent`; dispatch untouched. Unit test + negative control. (4) Stale-ledger sweep: CR/CS/CW (truth-in-status trio) and DK/DP/DQ/DR/DM/H/V were ALREADY FIXED in main — rows corrected; the carry-forward list below is now accurate. Green: functions+root tsc, build, full lint 0 errors, unit 732/732, emulator 54/54.**

**Flagged residuals:** `process-ocr.ts`/`transcribe-audio.ts` still construct bare OpenAI clients (same latent 5-min cap — unobserved, fix if long Whisper jobs ever time out). BM remainder: App Check on `registerClientFromLink` (needs reCAPTCHA provisioning — Adam) + `willsDriveWebhook` channel-token model. DZ remainder: server-side `sum()` aggregation needs composite indexes (Never-Break, needs sign-off).

**▶ NEXT (needs Adam live): the card test** (see the 🔴 section below — PR #156 has been deployed since 7/09). Then: T2 browser pass (38 cases), or `willsDriveWebhook` token model, or App Check provisioning. Also: stale PR #21 (May 31 CLAUDE.md docs, fully superseded) — recommend closing unmerged.

---

## 📍 SESSION — 2026-07-09 PM #9 (JDK 21 installed · #64 root-cause fix shipped · AffiniPay selector fix shipped, AWAITING ADAM'S LIVE CARD TEST)

**TL;DR — Three items in one session. (1) JDK: Temurin 21.0.11 permanently installed via winget (machine PATH) — `npm run test:emulator` ran 45/45 locally; the portable-JRE-per-session dance is retired. (2) CI #64: read the firebase-tools 15.x hash source directly — the deploy hash is ONE sha1 over file CONTENT per codebase (mtimes never hashed; the old mtime plan was dead on arrival). Adam signed off the simplify path: PR #155 dropped the 16-batch serial convergence → rules → one full deploy → straggler pass → fail-loud gate (net −26 lines, timeout 330→120). First validating run: green in 4.2 min (workflow-only change → hash matched → all 80 skipped, proving CI-built source is hash-stable). #64 stays open until the next `functions/src` merge exercises the mass-update path (expect ~20–40 min green). (3) AffiniPay: root cause found in the official docs — `initializeFields` requires CSS selectors (`'#af-card-number'`) and we passed bare ids; iframe mounts but input never registers. PR #156 fixes all 4 selectors + gates Review on real `getState()` field errors + drops the dead `initAttempted` ref. Hypothesis-2 (wipe/re-init churn) deliberately NOT touched — one variable per live test. Green: tsc, build, full lint 0 errors, 731/731.**

**▶ NEXT (needs Adam live): test the card fix on prod** — Charge Payment → type `5466160519943714`, exp `04/2029`, CVV `212`, ZIP `08831` → watch console `[ChargePaymentDialog] Hosted Fields state:` for card `length: 16, luhn: true`. If still length 0, next single-variable iteration = remove the innerHTML-wipe/re-init effect. Then: T2 browser pass (38 cases) or close #64 after the next functions merge.

---

## 📍 SESSION — 2026-07-09 PM #8 (R6-003–006 FIXED — Round 6 fully drained, all 6 findings closed same-day)

**TL;DR — Knocked out the four Round-6 ⚪s in one batch PR (#154, frontend-only, auto-merged). R6-003: template Enhance now recomputes `isLogicTemplate` (AI-injected `{{#each}}`/`{{#if}}` no longer corrupted by the WYSIWYG round-trip on save — flips to Source view like the load path). R6-004: template preview gained a "— No client —" clear row (the Combobox swap had removed the native select's empty option). R6-005: Copy Invite Link now writes the clipboard via `ClipboardItem` with a promise payload started synchronously inside the click (Firefox/Safari reject a post-await `writeText`); a copy-only failure surfaces the minted URL for manual copy instead of the false "Failed to create invite link". R6-006: the invite-link page waits for `auth.authStateReady()` and, if a signed-in non-anonymous user opens the link, shows guidance instead of silently replacing their session + re-pointing `linkedUserId` to a throwaway anon uid. Green: tsc -b, build, FULL lint 0 errors, 731/731 unit. Round 6 is now 6/6 fixed (2 🟡 #152/#153 + 4 ⚪ #154), all same-day as the audit.**

**✅ Shipped:** `TemplatePreviewDialog.tsx`, `TemplatePreviewPanel.tsx`, `ClientListPage.tsx`, `QuestionnaireRegisterPage.tsx`; REGRESSION-TESTS 4 new T2 cases (tally 88 rows) + changelog; AUDIT-findings R6-003–006 → fixed.

**▶ NEXT:** the T2 browser pass (38 cases, needs Adam/live app); CI #64 codebase-split (needs sign-off); or card-charge (needs Adam live).

---

## 📍 SESSION — 2026-07-09 PM #7 (R6-002 FIXED — KB all-partial import no longer invisible; both Round-6 🟡s closed)

**TL;DR — Fixed the second Round-6 🟡: KB bulk import gated its only list-refresh + toast on `result.processed > 0`, but the backend's `processed` excludes `partial` files whose resources ARE persisted — so an all-partially-OCR'd batch (>15MB scans) saved everything server-side while showing nothing, inviting duplicate re-uploads. Fix: `partial > 0` → warning toast + list refresh via a new `onRefresh` prop that does NOT close the dialog (the per-file "split this PDF" warnings — the R5-051 surface — stay readable); when full successes exist, `onSaved` refreshes as before (no double fetch). Green: tsc -b, build, FULL lint 0 errors, 731/731 unit. Frontend-only → PR #153, auto-merged. R6-001's #152 hosting deploy confirmed green — both 🟡s live. Round 6 remainder: 4 ⚪s (R6-003–006).**

**✅ Shipped:** `KBBulkImportDialog.tsx` (partial branch + `onRefresh` prop), `KnowledgeBasePage.tsx` (pass `fetchResources`), REGRESSION-TESTS R6-002 T2 case + tally 84 + changelog, AUDIT-findings R6-002 → fixed.

**▶ NEXT:** R6-003–006 ⚪s (small); or the T2 browser pass (34 cases, needs Adam/live app); or CI #64 codebase-split (needs sign-off).

---

## 📍 SESSION — 2026-07-09 PM #6 (R6-001 FIXED — editor stuck force-reload after regenerate)

**TL;DR — Fixed the more complex of the two Round-6 🟡s: `DocumentEditor`'s regen success path never cleared `forceReloadRef`, so when the regenerated snapshot landed before the callable resolved (the exact race the R5-022 fix targets), the flag stayed stuck and the NEXT autosave snapshot force-reloaded the editor — cursor jump + keystrokes typed during the save round-trip reverted and marked saved. Fix: `regenBaseVersionRef` version watermark — the backend regen save transactionally bumps `currentVersion` while the pre-regen editorContent flush doesn't, so the load effect clears the flag on consuming a snapshot with a higher version even mid-regen. Baseline is the session-high (`Math.max(document.currentVersion, currentVersionRef)`) so a just-clicked manual Save's in-flight snapshot can't clear it prematurely (would've been an R5-022 redux). Failure paths also reset the watermark. Green: tsc -b, build, FULL lint 0 errors, 731/731 unit. Frontend-only, not Never-Break → PR #152, auto-merged.**

**Traced safe:** flush snapshot mid-regen keeps forcing (R5-022 intact) · regenerated snapshot mid-regen clears (the fix) · post-`finally` clear unchanged · non-regen flows identical (baseline null) · known residual: a FAILED manual save immediately followed by regen degrades to pre-fix behavior (stuck flag, self-clears on next non-regen consume) — narrow, not worse than before.

**✅ Shipped:** `DocumentEditor.tsx` (watermark ref + gate), REGRESSION-TESTS R6-001 T2 case + tally 83 rows + changelog, AUDIT-findings R6-001 → fixed.

**▶ NEXT:** R6-002 (KB bulk-import all-partial refresh gate — the remaining 🟡, small); then R6-003–006 ⚪s or the T2 browser pass.

---

## 📍 SESSION — 2026-07-09 PM #5 (context-burn fixed + audit Round 6 — frontend delta, 6 findings, 0 critical)

**TL;DR — (1) Diagnosed the fast context-burn: HOMEWORK.md had grown to 283K chars (~75K tokens) and was re-read whole every session. Archived 7/07-and-older sessions to `HOMEWORK-ARCHIVE.md` (#150, docs-only) → 21K chars, ~70K tokens reclaimed per session. Secondary tax Adam can fix: ~11 account-level claude.ai connectors (Gmail, Trellis, Firecrawl, …) cost ~8–12K tokens/session — disable unused ones in claude.ai → Settings → Connectors. (2) Ran audit Round 6 per Adam's pick: 5 adversarially-verified subagents over the 37 `src/` files changed since Round-5 baseline `c29d310` (+3 never-audited new files). Result: 6 confirmed (0 🔴 / 0 🟠 / 2 🟡 / 4 ⚪) — R6-001–006 in `docs/AUDIT-findings.md`. The R5-fix wave held up; payments + questionnaire slices fully clean. Audit-only, no fixes applied.**

**The 2 🟡 (both incomplete-fix regressions):** R6-001 `DocumentEditor` regen success path never clears `forceReloadRef` → stuck flag force-reloads the editor on the next autosave snapshot (cursor jump, round-trip keystrokes lost). R6-002 KB bulk import: an all-partial OCR batch persists resources but `processed===0` → no toast/`onSaved()` → invisible until manual reload, duplicate re-upload risk.

**Stale-note corrections:** T1 `⬜ automate` backlog is fully drained (0 remain — the "4 unwritten" note in PM #2 was stale); audit round 4 was NOT pending (rounds 4+5 both done — memory corrected; this session = Round 6).

**▶ NEXT:** fix R6-001/R6-002 (small, contained); or the T2 browser pass (32 cases, needs Adam/live app); or CI #64 codebase-split (needs sign-off).

---

## 📍 SESSION — 2026-07-09 PM #4 (R5-048/049 chat generation-intent FIXED — context-aware confirm, Adam signed off)

**TL;DR — Fixed the two chat over-eager-generation findings. Adam chose context-aware confirm. R5-048: split user-intent into EXPLICIT (generate now) vs AFFIRMATIVE (bare "yes" generates only if the assistant's prior turn offered), added a negation guard (won't match "no-contest" mid-sentence), and made the message's doc type win over the dropdown. R5-049: removed the reply-SHAPE Strategy 2/3 so a long formatted explanation is never saved as a document / never replaces the attorney's answer — deliberate generation flows only through the explicit JSON action or the explicit user request. Pure `detectUserGenerationIntent`/`detectGenerationIntent`/`docTypeFromMessage` exported + unit-tested (`chat-generation-intent.test.ts`, 11). Green: functions tsc, root tsc, full lint 0 errors, 731/731 unit. Functions change (not Never-Break) → PR #149, auto-merged.**

**Known conservative edge (flagged):** "no, draft the trust instead" is suppressed by the leading-`no` negation guard even though it's a real request — safe direction (extra turn, never a surprise save); acceptable per the conservative lean.

---

## 📍 SESSION — 2026-07-09 PM #3 (R5-047 chat-history truncation FIXED — append-only, Adam signed off)

**TL;DR — Fixed the deferred R5-047 data-integrity finding: the AI chat's `saveConversation` overwrote stored history with the caller's ~20-message prompt window every turn, permanently truncating any longer conversation. Now append-only (stable per-message id + transactional dedupe-append); the 5 chat-ai call sites pass only the new turn. No client contract change needed — the server already knows the new turn. Verified green (functions tsc, root tsc, full lint 0 errors, 720/720 unit, 45/45 emulator incl. 4 new; negative-control-verified). Functions change (not Never-Break) → auto-merged.**

**Design decision (Adam picked append-only over server-delta / client-sends-all):** message ids are server-owned (randomUUID on save); the window is still built for the prompt + memory extraction but is NOT what gets persisted — only `allMessages.slice(resolvedHistory.length)` (the new turn) is appended. Title now set once at creation (the window-derived title drifted past 20 msgs). **Tradeoff flagged:** a very long conversation's doc grows toward the 1MiB Firestore limit — acceptable vs. silent truncation, far off for real chats; if it ever bites, move messages to a subcollection.

**✅ Shipped:** `ai-memory.ts` (append-only saveConversation + `id` on ConversationMessage), `chat-ai.ts` (5 call sites), `conversation-append.test.ts` (4), AUDIT-findings R5-047→FIXED, REGRESSION-TESTS case + changelog.

---

## 📍 SESSION — 2026-07-09 PM #2 (T4 blocked rows drained — R5-055/058/059/060/061 automated, all negative-control-verified)

**TL;DR — While the deploy converged, automated the five 🚫-blocked T4 rows with injected-failure emulator tests (7 tests, 3 files; emulator suite 41/41, unit 720/720, FULL lint 0 errors, tsc clean). Every test was negative-control-verified: run against the pre-fix code (pre-#111/#112 checkouts), exactly the regression assertions fail. T4 now has one open row (R5-050 — prod smoke). Also added CLAUDE.md rule 8 (never idle while waiting). Tally 37/81 🤖.**

**✅ Shipped:**
- **R5-058/059/060** `wills-processor-failure-paths.test.ts` (4): real Pub/Sub handler vs the emulator — corrupt `.docx` (real mammoth throw) → visible error record instead of a vanished file; injected Drive outage on a `modified` event → prior classified Will record PRESERVED (and with no prior record, an error record IS written); a real generated `.docx` classified (mocked classifier) as Correspondence takes the skip path and `daily_spend_usd > 0` after the handler resolves. Only Drive fetch + classifier mocked; mammoth/docx/Firestore real.
- **R5-061** `wills-backfill-stale-running.test.ts` (2): fresh `running` progress still rejects `already-exists`; a 20-min-stale one restarts (proven by reaching an injected googleapis failure and by `backfill_progress` reset to the new caller, closed `error`). googleapis fully mocked so ambient dev ADC can never reach real Drive.
- **R5-055** `calendar-sync-watermark.test.ts` (2): real `syncGoogleCalendar` with stubbed global fetch — injected 500 on `events.list` leaves `googleCalendarLastSyncAt` untouched; clean run advances it. Future `tokenExpiry` skips the OAuth refresh path.
- **Test-authoring notes:** v2 pubsub/scheduler triggers mock like https (both `lib/esm/...mjs` + `lib/...js` paths → return raw handler); `defineSecret` mocks via `firebase-functions/lib(/esm)/params`; pdf-parse still needs the `vi.hoisted` DOMMatrix polyfill; a REAL valid .docx fixture is one `Packer.toBuffer` away via functions' own `docx` lib.

**▶ NEXT:** T2 browser click-path pass (~29 cases) is the only bulk tier left; R5-050 + the 4 secrets-smoke cases need prod; T1 has 4 unwritten unit cases. Or start draining `docs/AUDIT-findings.md` frontend round 4.

---

## 📍 SESSION — 2026-07-09 PM (Adam signed off all 3 — #121 merged, emulator tests in CI, AS automated)

**TL;DR — Adam signed off the three pending items in one go. (1) PR #121 (R5-037 firm-scoped admin rules) merged after closing its emulator gap with live rules-engine tests — negative control proved the tests fail against the pre-fix rules. (2) `npm run test:emulator` wired into `firebase-functions-deploy.yml` (setup-java JDK 21 + emulator-jar cache) — 33 emulator tests now gate every functions/rules deploy. (3) AS automated via the new `@firebase/rules-unit-testing` devDependency. T3 tier fully automated; tally 32/81 🤖.**

**✅ Shipped:**
- **#121 merged** (`78353c7`): the R5-037 rules diff (43 firm-scoped `isAdmin()` → `isFirmAdmin`) plus `tests/emulator/firestore-rules-firm-admin.test.ts` (8 live rules tests: cross-firm admin denied on reads/writes/collection-group queries, own-firm admin intact, in-firm staff collection-group reads intact, paralegal AS block). `@firebase/rules-unit-testing@^5.0.1` added to root devDependencies. Verified: emulator 33/33, unit 720/720, tsc, eslint; behavioral checklist in the 7/06 PM #17 entry all ✓. Merge triggered hosting + functions deploys (rules auto-deploy in the functions workflow — the old "rules deploy is manual" note is stale).
- **CI wiring:** emulator tests run after the unit suite and BEFORE any deploy step in `firebase-functions-deploy.yml`; `firebase-tools` global install moved up to serve both. Trigger paths unchanged (tests-only pushes still don't deploy).
- **AS** rules half automated (same test file); UI half (hidden controls) remains T2.

**🔴 FOUND + FIXED: both deploy workflows had been failing at Lint since 2026-07-07.** The T1/T4 test batches (#129–#140) shipped 34 `no-explicit-any` lint errors across 9 `tests/unit/` files — those sessions linted only their own new files, never `npm run lint` (eslint .). Every hosting AND functions deploy since failed at the Lint gate: prod hosting was stale since #119, and **#121's rules never deployed** on merge. GitHub issues #142 (hosting) and #64 (functions, stale June issue) were open but unnoticed. Fixed all 34 (types-only, no test-behavior change; 720/720 + lint 0 errors), then workflow_dispatch'd both deploys. **Session rule going forward: run FULL `npm run lint` before merging any PR, not just eslint on the files you touched.**

**▶ NEXT:**
1. **Watch the first CI run of the new emulator step** (next functions push; this workflow-file change itself triggers one). If the emulator download or Java step misbehaves, the failure lands as a GitHub issue assigned to Adam.
2. **T4 blocked rows** (R5-055 calendar-sync watermark, R5-058/059/060/061 wills) — several become reachable with injected-failure emulator tests; or the **T2 browser** click-path pass (~29 cases).
3. **Install a JDK 21+ locally** (still no system Java — sessions keep re-downloading a portable JRE).

---

## 📍 SESSION — 2026-07-09 (T3 multi-tenant batch — R5-066 + R5-010 + AP/AQ/AZ/BA/BB green on the emulator harness)

**TL;DR — Automated 3 of the 4 T3 multi-tenant cases with the emulator harness: 22 new integration tests across 3 files, emulator suite 25/25 green, default suite still 720/720, tsc + eslint clean. Tests + docs only — no deploy. Tally 27→30 🤖.**

**✅ Shipped:**
- **R5-066** `tests/emulator/wills-cross-tenant-gate.test.ts` (8, both callables): Firm B admin → `permission-denied` with kill switch on OR off (no enabled-state leak); `control.firmId` unset → `failed-precondition` (fail closed); owner-firm admin passes the firm gate and hits the kill-switch check (proves passage without Drive); non-admin denied.
- **R5-010** `tests/emulator/register-client-claim-token.test.ts` (3): tokenless registration with the victim's exact name+email creates a NEW prospect stub (victim's `linkedUserId` untouched); invalid token → `not-found`; valid attorney-minted token claims + links the session.
- **AP/AQ/AZ/BA/BB** `tests/emulator/callable-firm-scope.test.ts` (11): `createFirmUser` — attorney can't mint admin, paralegal/client can't create at all, cross-firm admin denied; `listTemplates`/`getTemplateContent`/`searchKnowledgeResources` — Firm A admin targeting seeded Firm B data denied, NO-firm-claim caller denied (both admitted by the old predicate), same-firm positive control reads its own data. Gotcha: templates live at `firms/{id}/documentTemplates` (not `templates`).
- **Docs:** REGRESSION-TESTS.md — 3 rows ⬜→🤖, per-case Test entries, T3 harness note, tally 30, changelog.

**⚙️ Java reminder:** machine still has no system Java — this session used a fresh portable Temurin JRE 21 downloaded to the session scratchpad (Adoptium API zip → `PATH`). Install a JDK 21+ for a permanent local `npm run test:emulator`.

**▶ NEXT:**
1. **CI wiring for `test:emulator` still awaits Adam** (Never-Break workflow change — see 7/07 PM #2 entry). Ditto **PR #121 (R5-037 rules fix)** — still open AWAITING SIGN-OFF.
2. **Last T3 case `AS` (paralegal billing/settings)** is a firestore.rules check — the admin SDK bypasses rules, so it needs the `@firebase/rules-unit-testing` devDependency + a rules-layer test. Small, but it adds a root dep (package.json → hosting-CI trigger), so flag it when opening that PR.
3. **T4 blocked rows** (R5-055 calendar-sync watermark, R5-058/059/060/061 wills) — several become reachable with injected-failure emulator tests; or the **T2 browser** click-path pass (~31 cases).

---

## 🔴 START HERE NEXT SESSION — Card charge (AffiniPay Hosted Fields) is BROKEN, never worked

**➡️ UPDATE 2026-07-09 PM #9: fix candidate SHIPPED (PR #156, hypothesis 1 — `#`-prefixed CSS selectors, confirmed against the official AffiniPay guide) + a Review-gate on real field state. AWAITING ADAM'S LIVE CARD TEST (see the PM #9 session entry above for the test script). If it fails, next iteration = hypothesis 2 (remove the innerHTML-wipe/re-init effect) in isolation. The diagnosis below remains the reference.**

**TL;DR — The "Charge Payment" card flow has never worked. Confirmed by live browser inspection 2026-07-06: the AffiniPay card-number hosted field displays typed digits but never registers them with the SDK, so `getPaymentToken` always sees an empty card and throws "field validation errors." This is a real integration bug in `src/components/payments/ChargePaymentDialog.tsx`, not user input. Needs a focused fix session — I can't type into the cross-origin iframe from automation, so every fix iteration needs Adam to test live.**

**File:** `src/components/payments/ChargePaymentDialog.tsx` (hosted-fields init at `initializeHostedFields`, effect ~L333, config ~L275).

**Exact confirmed diagnosis (live, on prod estate-plan-generator.web.app):**
- Adam typed a full 16-digit test card (`5466160519943714`, 04/2029, CVV 212, ZIP 08831). The digits appear in the field visually, BUT **every** SDK state event still reports `af-card-number: {"error":"Input field is empty","length":0,"card":"","luhn":false}`. The CVV then reports `"Unknown card type"` (card type undetermined because card reads empty).
- `isReady` is **never** `true` in any state event — the UI sits on "Loading secure payment form…" and/or lets you submit an empty form.
- So the field iframe renders input but never syncs it to the SDK → `getPaymentToken({...})` tokenizes an empty card → `fieldGen_1.5.3.js errorFactory` throws `Error: field validation errors` (seen in `[ChargePaymentDialog] Charge error:` console).

**Ruled OUT (don't re-chase these):**
- Public key is fine: `lawPayPublicKey` present, len 24, prefix `m_x…` (valid AffiniPay merchant public key); `lawPayApiKeySet`/`lawPayMerchantIdSet` true.
- Iframes mount correctly: `#af-card-number` and `#af-card-cvv` each contain one visible iframe (`cdn.affinipay.com/hostedfields/1.5.3/field_1.5.3.htm`), sized 411×38 / 127×38, `pointerEvents:auto`. Focus events fire (`{"type":"focus"}` postMessages from the iframe).
- `configRequest` fires once per field (not looping) — handshake initiates.
- No console errors. CSS is benign (font/color/padding).
- **Amount unit is NOT a bug** — AffiniPay uses cents and the app sends cents (verified against AffiniPay docs; the Round-5 "100× critical" R5-001 was a false positive).
- Expiry format: separately fixed & shipped (#89) — `exp_month` padded to 2 digits, `exp_year` expanded to 4, + per-field error surfacing via `getState()`. Correct and live, but NOT the blocker here. Keep it.

**Ranked fix hypotheses for next session (compare our init to AffiniPay's current guide):**
1. **Selector format.** AffiniPay's hosted-fields sample uses a CSS selector — `{ selector: '#my_card_field_id', input: { type: 'credit_card_number' } }` — while our code passes the **bare id** `'af-card-number'` (no `#`). The iframe still mounts, but a selector mismatch is the prime suspect for "mounts but never registers input." ⚠️ The SDK echoes our bare selector back in state and DID mount the iframe, so flipping to `#af-card-number` might change mounting behavior — test carefully, don't blind-ship.
2. **Re-init churn.** The `open`-effect (~L341-352) does `el.innerHTML = ''` on the containers then re-`initializeHostedFields()` on `[open, paymentType, initializeHostedFields]` changes, while React owns those divs — can detach the iframe the SDK tracks. Move to a single clean init after the container is in the DOM; don't wipe/re-init.
3. **Honor real `isReady`.** Gate the Review/Charge button on the SDK's true `isReady` (the current `anyFieldMounted` workaround at ~L317-323 flips "ready" while the card field is still empty). Disable submit until ready so an empty form can't be sent.
4. Dead `initAttempted` ref (declared, reset, never set/checked) — remove or use it to guard double-init.

**Reference docs (AffiniPay/8am):** hosted-fields guide `developers.8am.com/collect/create-payment-form-hosted-fields`; reference `developers.8am.com/reference/hosted-fields-reference` (exp_month = 2-digit 01-12, exp_year = 4-digit, postal_code required); hosted payment-page params (amount in cents) `developers.8am.com/merchant/hosted-payment-pages.html`.

**Testing constraint (important):** browser automation CANNOT type into the cross-origin AffiniPay iframe (synthetic keystrokes land in the parent doc). So the fix loop is: edit → hosting deploy (~2-3 min, clean CI) → **Adam types the test card live and reports the `[ChargePaymentDialog] Hosted Fields state:` console log** (watch for card-number `length` going to 16 + `luhn:true` + `isReady:true`). Test card: `5466160519943714`, exp `04/2029`, CVV `212`, ZIP `08831`. Do NOT click Charge until the state shows the card captured.

**Note:** the "Paid" $1.00 records in Payments history came from Record Payment / the payment-page link, NOT this hosted-fields dialog — consistent with the dialog never having worked.

---

## ✅ CI functions-deploy root-cause fix (issue #64) — RESOLVED & VALIDATED 2026-07-15

**➡️ FINAL UPDATE 2026-07-15: VALIDATION COMPLETE — section retained one cycle for the record, then delete. PR #159 was the first real `functions/src` merge since #155: the deploy ran green in 8.9 minutes (selective — only the changed functions redeployed), meeting the definition of done ("a functions merge deploys only its changed functions, finishes green in ~10 min"). #64 closed (Adam, 7/09) + validated. The guardrails below remain the standing rules — especially "never cancel a functions-deploy mid-run."**

**➡️ UPDATE 2026-07-09 PM #9: the plan below is SUPERSEDED. The mtime hypothesis was disproven by reading firebase-tools 15.x source (hash = one sha1 of file CONTENT per codebase; mtimes never hashed — the fan-out to all ~80 is intrinsic to a single codebase). Shipped instead: dropped the 16-batch serial convergence → one full deploy + straggler pass + fail-loud gate (Adam signed off; net −26 lines; timeout 330→120). First run green in 4.2 min (workflow-only change → all skipped → CI-built source is hash-stable). Guardrails below still apply — especially "never cancel a functions-deploy mid-run."**

**TL;DR — Last session (2026-07-02) shipped BV (OAuth needs-reauth, #82, live) and four CI-workflow patches (#81–#84) that tried to make the functions-deploy *survive* a symptom. Prod is healthy the whole time; the only open thing is CI-green + a 2.5h deploy that should be 10 min. STOP patching the symptom. Fix the disease.**

**The disease (diagnosed, not yet fixed):** Firebase decides redeploy-vs-skip per function by hashing the uploaded source bundle. That hash is unstable across CI runs → all ~80 functions look changed every run → we mass-deploy 80 CF v2 functions (~2.5h) → mass-deploying 80 at once trips a rotating burst of 409 "unable to queue the operation". Problem 2 is *caused by* problem 1. Fix the hash and the mass deploy, the runtime, and the 409 lottery all vanish — and PRs #81–#84's machinery (drain, straggler pass, patient retries) becomes deletable dead code.

**Prime suspect:** the source tarball firebase uploads includes file **mtimes**, and `git checkout` + `npm ci` stamp fresh mtimes every CI run → identical content, different tarball, different hash. This explains why even a plain *rerun* re-updates all 80 instead of skipping.

**Go-forward plan (investigate first, highest-leverage first):**
1. Confirm whether firebase-tools hashes source *content* or the *archive* (mtimes). Test in ONE `workflow_dispatch` run: normalize mtimes before deploy (`find functions/lib functions/src -exec touch -t 200001010000 {} +`, or `SOURCE_DATE_EPOCH`) and check the deploy reports "Skipped (No changes detected)" for unchanged functions.
2. **#1 (best):** if that stabilizes the hash, collapse the workflow back to a plain `firebase deploy --only functions` and DELETE the batch/drain/straggler/patient-retry machinery (~150 lines). Normal merges → ~10 min, only changed functions.
3. **#2 (fallback):** if the hash stays stubborn, diff-targeted deploy — compute changed functions from the git diff (map shared modules like `ai-client.ts` / `client-data-serializer.ts` to their dependents) and deploy only that set.
4. **#3 (only if forced):** split the 80 functions across multiple Firebase codebases.

**Guardrails (learned the hard way — non-negotiable):**
- Never-Break CI file → **Adam's explicit sign-off on the diff before merge.**
- **Never cancel a functions-deploy run mid-deploy** — orphans GCP ops that 409-poison later runs. `concurrency: cancel-in-progress: false` stays.
- Prod is healthy/current throughout — CI-green + speed fix only; nothing user-facing is broken.
- Verify workflow bash against the mock-harness pattern from last session before merging.
- After the first red, if the fix didn't work, **stop and re-diagnose — do not iterate retry knobs.** (That's the mistake that made last session 13 hours.)

**Definition of done:** a functions merge deploys only its changed functions, finishes green in ~10 min, issue #64 closed, this section removed.

**Meta-lesson:** after the first red deploy, the correct move was "why does everything look changed?" — not another retry knob. Ask the root-cause question first next time.

---

## 📌 SESSION 2026-08-03 — pilot-1 CORPUS MINE COMPLETE (catalog live, gates RED, review paused)

**Option 2 executed (Adam's decision):** labeled calibration skipped; manual conservative LSH banding
16×8 (~0.71 candidate threshold, code comment in `clause-miner/src/config.ts` records the assertion);
curation-by-deletion shipped instead (`removeClause` callable + Clause Picker delete UI + catalog
re-run status preservation, #264). Rule 7 suspension note: calibration is now moot by this decision —
Adam may delete the CLAUDE.md block whenever.

**Pipeline result (run pilot-1, all 10 stages executed):**
- Stages 1–5: checkpoint fast-forward over 18,628 files, $0.
- identity (#59, 2h1m): 3,889 uniques → **2,677 families**; 41,176 adjudicated (2,380 MERGE /
  37,693 SEPARATE / 1,103 normalization-miss), 41 trivial auto-merges.
- canonicalize (#60): **300 families canonicalized** (min-support ≥3), 2,377 below support,
  **281/300 PII-BLOCKED** (fail-closed gates; likely gazetteer gaps — see remediation), 0 fill failures,
  83 seed-matched, 1 seed-divergent.
- stats (#61): 337 units, 4,800 primary rows, **10 significant** trigger correlations, 300 cards.
- catalog (#62): **300 entries / 1,310 variants / 3,846 occurrences written to Firestore**
  (`firms/firm-001/clauseCatalog`), Vertex embeddings, status:'mined'.
- gates (#63): **passed=false, incomplete=true** —
  Gate 2 PURITY **FAIL** (2 families merged distinct curated pieces w/o transcript:
  `fam_7d6bc499e63d51d9`, `fam_e2bef41c53ebcd67` — tighten diff whitelist / legal-delta lexicon);
  Gate 3 fidelity **PASS** (median 1.000, 1/16 divergent);
  Gate 4 CANARY **FAIL** (9/16 = 56.25% vs ≥90%);
  Gate 1 recall: see run #63 job log (unmatched-piece list captured there);
  Gate 5 skipped (checkpoint-2). **Per design, card review does NOT begin until gates pass.**

**Ops fixes shipped en route (all merged):** #265 watcher timeout 45m→6h; #267 edge-terminated
batch-submit halving + paid-batch recovery from ledger; #268 once-only spend charging
(chargedBatches map). Firestore `clause_mining_state/control` counters were manually reset to the
real $153.86 after multi-charge inflation. Total pilot Anthropic spend ≈ **$155–165** (console is
authoritative). Live dashboard artifact (session-scoped):
https://claude.ai/code/artifact/12f31ce2-5a85-413c-9636-4aff942aff4c

### ✅ ULTRACODE CHECKPOINT #2 RAN, 2026-08-03 evening — full report in [docs/CHECKPOINT2-VERIFICATION.md](./docs/CHECKPOINT2-VERIFICATION.md)

5-lens adversarial panel + per-finding refutation over the run #59–#63 outputs and the code.
20 findings CONFIRMED, 1 refuted. The headline results, in severity order:

- **🔴 CRITICAL — the PII "fail closed" promise is FALSE.** All 281 blocked families were written
  to Firestore WITH full clause text (`catalog.ts` never consults `piiScanStatus`), readable by any
  firm attorney/paralegal; the only thing hiding it is one client-side filter in the Clause Picker
  dialog. Firm-internal exposure only (staff can already read the source docs), but the
  security-rules comment "NO raw client text by construction" is currently untrue. **Fix before
  anyone browses the catalog.**
- **🔴 ~97% of trigger cards are statistically unvetted:** ~290/300 cards were narrated from
  "exploratory" rows (lift≥2, one-sided support — 62% of ALL rows qualify) with no disclaimer in
  the prose; only 10 rows passed the BH-corrected significance gate (which itself is sound).
- **🔴 A real silent-merge path exists:** the item-set ring can merge enumerated power-lists with
  genuine content diffs, transcript-less (`identity.ts:247-262` computes `classifyDiff` but never
  checks it). Separately, the 1,103 normalization-miss verdicts were counted then DROPPED — mining
  those transcripts is the single highest-leverage fix (shrinks piiBlocked, merges fragments,
  lifts recall, ~free via transcript replay).
- **The two failing gates FAIL for partly-artifactual reasons** — do not tune thresholds against
  them: gate denominators don't reconcile with the seed run (123 vs 130 — no version stamps
  anywhere, so staleness is undetectable); seed pieces are execution-truncated while corpus
  segments are not (≥3 misses unmatchable by construction); seed matching gives each piece ONE
  candidate. Gate 2's number is a lower bound measuring the wrong mechanism, and its two flagged
  families are likely filename-versions of one template (merging them is probably correct).
- **Ring-2 bypassed the 40k adjudication cap** (the guard only covers Ring 1) — ~75% of pilot
  adjudication spend came through the uncapped loop. Guard it before any banding change.
- **Remediation ordering (report §C):** ① PII stop-ship → ② measurement fixes (version stamps,
  gate 2/3 rewrites, card-tier disclosure) → ③ free recall levers (normalization-miss mining,
  execution symmetry, item-set trivial gate, Ring-2 cap) → ④ full re-run (all mined data predates
  the seg/3 truncation fix anyway) → ⑤ paid levers only if still short.
- **Unverifiable from the sandbox** (no Firestore/GCS): report §B lists 10 items; first query next
  session: why identity saw only 371 `segmented` rows out of 512 trusts.
- **Scope question for Adam before recall targets are set:** the corpus is trusts-only but the
  seed library includes will clauses — roughly half of Gate 1's denominator may have no corpus
  counterpart *by design*.

**Also this session: ▶ NEXT item 3 SHIPPED as PR #270** (embeddings → `gemini-embedding-001`,
768-dim kept so vector indexes untouched, miner predict batch 25→1 per the model's 1-instance
cap; tsc ×3 green, 423 + 1058 tests green). **Held un-merged per suspended Rule 7.** After merge:
run both KB backfills + re-run miner `catalog` together so the space stays unmixed.

**✅ PII STOP-SHIP FIX BUILT (same session, on PR #270's branch):** `runCatalog` now redacts any
family whose `piiScanStatus` is not `'clean'` — whitelist scrub (`scrubBlockedCatalogDoc` /
`scrubBlockedVariantDoc`: no canonicalText/title/summary/switchName/placeholders/triggerCard/
embedding; variants lose normText/parameters/mergeEdge diff tokens), written with `merge:false`
so a re-run SCRUBS the text the pre-fix run already shipped, including stale variant ids no
longer in the family. Blocked text is not embedded either. approved/removed status still carries.
Negative-controlled: disabling the wiring fails 2 tests. 430/430 green. **To actually scrub prod:
merge #270, then dispatch `STAGE=catalog` on pilot-1** — that one run rewrites all 281 blocked
docs text-free. (Server-side rules hardening + durable human-clearance state remain open — report
M7.)

**✅ MEASUREMENT FIXES BUILT (remediation step ②, same day):** the gates and stats now measure
what they claim. (a) **M1 staleness:** seed-pieces and seed-match artifacts carry a
`segmenterVersion` stamp; `STAGE=gates` HARD-FAILS (throws, not a red gate) on an unstamped/
mismatched artifact or a piece-count disagreement with the seed ledger — the 123-vs-130
denominator gap can never go unnoticed again. (b) **Gate 2 rewritten:** walks the corpus merge
edges (transcript-less-edge connectivity via union-find), closing the all-exact blind spot; and
`filingKey` folds `X.doc / X (NEW).doc / X (NEW) (JJB).doc` into ONE filing — the pilot's two
"violations" were exactly this shape and will re-measure under correct ground truth. Missing
edges artifact fails closed. (c) **Gate 3** reports its actual rule (divergent share vs 0.5), the
median moves to detail. (d) **Gate 4** cross-checks canary md5s against the corpus manifest — a
byte-identical copy inside the corpus fails the gate as compromised. (e) **Stats honesty (C2/M9):**
both card tiers now require support on BOTH sides (min(nFact,nNotFact) ≥ 10); exploratory cards
get a deterministic code-prefixed disclaimer plus a narrator instruction forbidding usage-rule
phrasing; the summary splits significantCards/exploratoryCards; lift at b=0 is finite
(half-count smoothing) instead of JSON-null. Negative controls run; 447/447.
**Consequence: current pilot-1 artifacts are unstamped, so gates now REFUSE to run until
seed → canonicalize re-run — intended; all mined data predates seg/3 anyway (step ④).**

**✅ STEP ③ FREE RECALL/PURITY LEVERS BUILT (same day):** (a) **M5 symmetry, SEGMENTER_VERSION →
seg/4:** corpus segments now truncate at the first execution paragraph exactly like the seed cut —
a signature-tailed final article hashes identically to its clean twin (tested); wholly-execution
blocks keep text + flag. (b) **C3 item-set gate:** the enumerated-list path auto-merges only
TRIVIAL text diffs, same rule as the LSH path — content diffs now pay for adjudication instead of
silently merging. (c) **M2 Ring-2 cap:** ring-2 proposals count against the SHARED
maxAdjudicationPairs ceiling (the pilot's uncapped loop carried ~75% of spend). (d) **C4 mining
artifact:** identity now writes `identity/normalization-misses.json` — every NORMALIZATION_MISS
pair with its diff tokens plus a descending token histogram. **That histogram IS the gazetteer
worklist**: expand the gazetteer from the top tokens, then re-run identity (transcripts replay
free). Negative-controlled; 454/454.
**The gazetteer expansion itself needs the run data (Firestore/GCS) — first item for the
remediation re-run session, before step ④'s segment → seed → calibrate → identity sequence.**

### 🔶 REMEDIATION RE-RUN, 2026-08-03→04 overnight — 6 of 9 stages green, PAUSED one stage from
### the gates on the ANTHROPIC CONSOLE MONTHLY USAGE LIMIT (not our breaker)

**Green so far (all resumable, everything paid is durable):**
- `mine-misses` (run #64): 1,103 miss pairs → **435 names admitted** to the supplemental
  gazetteer (369 rejected not-name-shaped, 419 rejected as seed vocabulary).
- `segment` (run #65, ~5 min — checkpoint caching): roster VERIFIED in output
  (`supplemental gazetteer names=435`); 371 segmented / 202 reflowed / 3 llmFallback /
  0 needs-review / **45 quarantined** / 18,212 skipped.
- `seed` (run #66): 70 in scope → 196 pieces (190 clause/6 commentary), 129 trust-relevant,
  15 canary, 34 execution blocks truncated. `calibrate` SKIPPED — Option 2 made the packet moot.
- `identity` (run #67 tripped the $250 daily breaker mid-recovery — REAL spend, not phantom:
  same-day stacking on the pilot's $153.86; limits raised with Adam's approval in #275 —
  then run #68 GREEN, 2h27m): uniques=3831, autoMerges=70, adjudicated=38,754,
  **merges=4,018 (pilot 2,380 — +69%)**, separates=33,026, normalizationMisses=1,710 (up from
  1,103 — cleaner text surfaced more borderline pairs; ALL captured in the new
  `identity/normalization-misses.json` worklist), **families=2,537 (pilot 2,677)**.

**BLOCKED:** `canonicalize` (runs #69/#70/#71 all failed identically at $0):
`"You have reached your specified API usage limits. You will regain access on 2026-09-01"` —
the org's monthly usage-limit SETTING at console.anthropic.com. **Adam's $100 credits do NOT
bypass it; the limit value itself must be raised** (Settings → Limits). A silent $0 probe
re-dispatches canonicalize every ~2h and auto-continues canonicalize → stats → catalog → gates
the moment it clears. Remaining Anthropic spend to finish: ~$25–45.

**Spend, honestly:** Anthropic console showed **$411.58** before canonicalize (pilot ~$155 +
re-run identity ~$250 across two attempts). Both of the session's estimates missed low for the
same reason: the fixes CHANGED the compared text (name redaction + execution truncation), so
the pilot's cached adjudications largely could not replay and were re-bought. Internal brakes
now $400/day / $500 total (#275), still armed.

**Coverage note for the gates read-out:** identity operates on 371 `segmented` docs; ~141 of
the 512 trusts sit in the quarantine/review tail (45 quarantined this pass + prior tail) — the
checkpoint report's "371 vs 512" open item, now explained. A coverage decision (mine the tail
or accept it) belongs with the catalog review.

### ✅ RE-RUN COMPLETE, 2026-08-04 — all 9 stages green; GATES RED but HONEST (run #76, exit(3))

Adam raised the monthly limit to $500; the chain finished: canonicalize (run #72 exposed an
unregistered `SUPPLEMENTAL_NAME` tag → 166/302 fill-contract failures; fixed+merged #276; re-run
#73 GREEN: **302/302 labeled, 0 failures**, piiBlocked=276, seedMatched=85) → stats (run #74:
337 units, 4,832 rows, 14 significant, **cards 301 = 6 significant / 295 exploratory** — the
tier split now reported and every exploratory card carries the code-level disclaimer) → catalog
(run #75: **302 entries / 1,394 variants / 3,965 occurrences; blocked families written
TEXT-FREE**, scrubbing the pilot's leak) → gates (run #76).

**Gates (first trustworthy read — stamped artifacts, denominators reconcile at 114):**
- **Gate 1 RECALL: FAIL, 74/114 = 64.9%** (pilot's broken read: 61.7%). The 40 misses are named
  in the run #76 log. A large share are WILL clauses (the DISCLAIMER WILL family, guardianship,
  residuary-to-minors, tangible-personal-property pieces) — clauses with no counterpart in a
  trusts-only corpus BY DESIGN, plus Charitable Remainder Unitrust pieces (rare instrument,
  likely below min-support). **Recall is structurally capped until wills are mined or the
  denominator is scoped to corpus-reachable clauses — Adam's scope decision.**
- **Gate 2 PURITY: FAIL, 2 — and now REAL.** With filename-revisions correctly folded, the same
  two families remain: trustee-powers/bond-waiver boilerplate joined ACROSS genuinely different
  filings (e.g. the Wells Fargo trustee-powers piece + ETP4 + the DISCLAIMER WILL trustee
  article) without a transcript. Either tighten the diff whitelist/legal-delta lexicon, or —
  plausibly — Adam looks at them and rules they ARE the same clause reused across templates.
  A 2-item human question now, not a measurement artifact.
- **Gate 3 FIDELITY: PASS** honestly (divergent share 0.059 over 17 matched; 1 flagged for
  side-by-side).
- **Gate 4 CANARY: FAIL as COMPROMISED — the new md5 cross-check found 4 canary files with
  byte-identical copies inside the corpus tree** (named in the run #76 log; client-named files,
  not repeated here). The pilot's 56% "recovery" was partly measuring the pipeline finding
  documents it had been given. Fix is cheap: drop those 4 from the canary set (or dedupe the
  Drive tree) and re-run gates ($0) for a clean holdout read.
- **Gate 5: skipped** (checkpoint-2 scope), so `incomplete=true` stands by design.

**Spend final (console authoritative): ≈ $412 before the finish + ~$25 canonicalize/stats
labeling ≈ $435–445 total**, inside the raised $500 monthly cap and the internal $500 ceiling.

### ▶ NEXT (fresh session, in order)
1. **Adam's two 5-minute calls (both cheap to act on):**
   (a) the 2 purity families — same clause reused, or genuinely distinct? (viewable in the
   Clause Picker / run #76 log); (b) canary — drop the 4 duplicated files from
   CLAUSE_MINER_CANARY_FOLDER_IDS coverage and re-run `gates` ($0) for the clean holdout read.
2. **Recall scope decision:** exclude corpus-unreachable will clauses from Gate 1's denominator
   (measure honestly against trusts) OR treat 65% as the trust-only floor and revisit after the
   wills mine. Either unblocks the catalog review.
3. **Catalog review can arguably begin now** for the 26 clean families while the above settle —
   design says gates gate the review, but gates are now failing for SCOPE reasons (wills in the
   denominator, compromised canary), not correctness ones; Adam's call.
4. **PII over-aggression (M8):** 276/302 blocked barely moved despite 435 names redacted —
   the roster sweep/haiku gate over-block (checkpoint report predicted this). Tuning task
   before the catalog is broadly usable; blocked entries ship text-free meanwhile.
5. **Quarantine-tail coverage — PENDING (Adam, 2026-08-05: "leave it as pending").** ~141 of
   512 trusts sit in the segment quarantine/review tail and were never mined (identity ran on
   371). Options laid out for Adam: accept the gap (recommended — messiest docs, boilerplate
   likely already captured from the clean 371), chase the tail (diagnose+fix conversion, re-run
   segment/identity on recovered docs), or first pull the 141 file names from GCS ($0) to
   eyeball for known templates. No action until Adam decides.

**Shipped this session (2026-08-05, PR #278 — merged by Adam):** the approve-all half of the
curation-by-deletion decision (#264 had shipped delete only) + the firm-id bridge. New
`listClauseCatalog` / `approveAllClauses` callables; `mining-firm.ts` shared bridge
(elias-counsel → firm-001 catalog, server-side — no rules change); Clause Picker reads via
callable and shows "Approve all mined (N)". Approve-all skips tombstones and PII-blocked
entries. The mined catalog is now visible and bulk-approvable in the app.
1. ~~**Ultracode checkpoint #2**~~ — ✅ DONE, above.
1b. **(was:) Ultracode checkpoint #2 (AUTHORIZED by Adam 2026-08-03, keyword given — do not re-ask):**
   multi-agent adversarial verification over the gates report (run #63 job log) + stage summaries.
   Lenses: gate scores vs claims; over/under-merge at 16×8 given 2,380/37,693; the 2 purity
   violations (which path merged them — trivial-diff or item-set?); statistical honesty of the 10
   significant cards; 281/300 PII-block rate (over-aggression vs real leakage). Sandbox has NO
   Firestore/GCS access — list unverifiable claims explicitly; a read-only `export` stage (prints
   catalog JSON to job logs) is the proposed bridge if needed.
2. **Remediation plan** (verification findings first, then): (a) purity — tighten diff whitelist /
   legal-delta lexicon, re-run identity (cheap: transcripts + charge-once make re-runs ~free);
   (b) PII blocks — expand gazetteer from the 1,103 normalization misses, re-run canonicalize;
   (c) canary — likely downstream of (a)+(b) + min-support; re-measure after.
3. **Embedding refresh (Adam, 2026-08-03): upgrade Vertex `text-embedding-005` → current Gemini
   embedding model** via the same Vertex plumbing. Coordinated migration: re-embed KB
   (`functions-backfill`) AND clauseCatalog together — mixed spaces silently degrade findNearest.
   Cheap (~pennies at this scale). Not a blocker for anything above (embeddings are
   candidates/related-content only, never deciders).
4. Card-level review begins only after gates pass. Only status:'approved' reaches drafting.

---

## 🔴 OPEN CARRY-FORWARD (start here next session)

1. **✅ Smoke test — DONE/VERIFIED 2026-06-29.** "Test Connection" now returns **"API key is valid."** This conclusively closes **AR** and validates the full live path (migrated key → `loadFirmSecrets` merge → `testSendGridConnection`). The earlier *"not configured"* failure was NOT a data problem — the migration was fine; the live function + every email sender were frozen on **2026-06-25 pre-AR code** by the silent 409 deploy storm (see MAJOR FINDING below). Fixed by force-redeploying all stale functions from current `main` in small batches.

2. **Remaining audit items (no open criticals; ledger `docs/AUDIT-findings.md`; carry-forward list rechecked against code 2026-07-15):**
   - **T9 — mostly done (#62).** Zod length caps shipped on all 6 callables; HTML-escaping shipped on all email senders. **Deferred half:** "server-resolve email recipients" (ignore caller-supplied `to:` address, look it up from clientId server-side) — Adam chose to skip it: callable-contract + frontend change for marginal gain post-T6 staff-gating. Revisit only if that residual matters.
   - **App Check** — `registerClientFromLink` is public; rate-limit shipped, App Check still unset (needs reCAPTCHA provisioning by Adam). Plus `willsDriveWebhook` channel-token model (BM remainder).
   - **DZ remainder** — payments `sum()` aggregation needs composite indexes (Never-Break, needs sign-off).
   - ~~Truth-in-status remainder CR/CU/CS/CW~~ and ~~medium cleanups DK/DP/DQ/DR/DM/H/V/AO~~ — **all verified fixed/wontfix in current main 2026-07-15** (stale ledger rows corrected). **T fixed (#160).** BL/BK fixed (#159).
   - Never-Break gate (explicit sign-off) applies to: `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `functions/src/templates/*.hbs`, `src/types/index.ts`, CI workflows.

3. **Standing watch-item (passive):** OAuth durability alert — silence = healthy (see AUTOMATIC ALERTS section below).

---

*Sessions from 2026-07-07 back to 2026-06-16 are archived in [HOMEWORK-ARCHIVE.md](./HOMEWORK-ARCHIVE.md) (moved 2026-07-09 to keep this file small — nothing deleted, full history in git).*
