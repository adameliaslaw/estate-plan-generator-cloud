# Statular package analysis — branch homework

**Scope:** a record of the 2026-08-02 DOCX forensics pass, kept beside the harness that produced
it. It does **not** replace the root `HOMEWORK.md` and its contents should not be folded into it.

> **⚠ Read this first — dated 2026-08-02, partially superseded 2026-08-06.**
>
> - **The "hard constraints" below are spent.** Rule 7 was un-suspended on 2026-08-06 (root
>   HOMEWORK B1); the calibration task that motivated the freeze is finished. Agent squash-merges
>   are live again. Never-Break changes still need Adam's sign-off, but that is the standing rule,
>   not this branch's freeze.
> - **A second, larger Statular pass has happened since** — five screen captures, 34.4 min, written
>   up in root `STATULAR-VIDEO-REVIEW.md` and as section **J** of root `HOMEWORK.md`. Where the two
>   disagree, the newer one wins: it observed the live product UI, whereas this file reasons from
>   generated `.docx` output alone.
> - **What is still uniquely here and worth keeping:** the determinism control (99.80% of paragraphs
>   byte-identical across two runs of the same answers), the engine fingerprint, the ~31%
>   boilerplate measurement, and the 8-for-8 validation of the `trust-joint.hbs` article spine. The
>   video pass produced none of those.
> - The two self-corrections in this file (the overstated TOC "defect", the retracted gap analysis)
>   are kept deliberately. They are the reason for the discipline note at the end.

---

## Objective (confirmed 2026-08-02)

**Internal tooling for Elias Counsel, benchmarked against Statular. Not a product for sale.**

Adam holds a Statular free trial and is generating document packages from it. Statular is
used as a **completeness checklist** — what does a finished NJ estate plan portfolio
contain — not as a feature-parity target.

What this rules out:

- **Multi-state / state-aware generation.** Root `BACKLOG.md` item #1 calls this "the single
  biggest product-value unlock." That framing assumed a product sold to firms in many states.
  For one NJ firm it is speculative. NJ-centric generators are correctly scoped, not a defect.
- Multi-tenancy polish, billing concerns, breadth across 50+ document types.

What this raises:

- **Correctness on instruments Adam personally signs.** Retirement-account (SECURE Act
  conduit/accumulation) drafting is malpractice exposure, not a competitive gap.
- **Determinism.** A vendor can tolerate two identical clients receiving structurally different
  trusts. The attorney reviewing and signing both cannot.
- **Trust funding.** An unfunded revocable trust is the classic failure mode.

---

## Hard constraints

- **Spent — see the header.** The rule 7 suspension (#261) and the no-merge freeze both
  applied to the 2026-08-02 session. #258, #260, #261 and #266 have since merged.
- Branch pushes cannot deploy this repo — both Firebase workflows trigger on `push` to `main`,
  and `njsa-import` is `workflow_dispatch`. Nothing here triggers on `pull_request`, so PRs
  show zero checks. **That is expected, not a failure.** Local verification is the gate.

---

## The harness — `docx-forensics.py`

Stdlib-only Python, no install step. Deliberately not `.cjs` like its neighbours in this
directory: a Node port would need a zip dependency to do what `zipfile` gives free, and the
script is already written and verified.

```bash
# Fingerprint generated documents — engine, template lineage, templating traces
python3 scripts/diagnostics/docx-forensics.py inspect path/to/*.docx

# Clause-level diff between two generated packages
python3 scripts/diagnostics/docx-forensics.py diff pkg-a/trust.docx pkg-b/trust.docx
```

`inspect` reports the generating engine (matched against HotDocs, Contract Express, XpressDox,
docassemble, docxtemplater, Aspose, and others), `docProps` lineage, content controls,
bookmarks, field codes, tracked changes, and any leaked placeholder syntax (`{{…}}`, `«…»`,
`${…}`). PDF inputs get producer-based fingerprinting instead.

`diff` compares paragraph text and reports which clauses appear in only one document, which
blocks were rewritten, and an overall similarity percentage. Do **not** use a byte comparison
for this — timestamps and rsids differ even under pure deterministic templating.

---

## Findings so far

### Statular's engine

From the revocable trust package (`Adam_Elias_v1.docx`, 2,513 paragraphs, 34 titled segments,
33 section breaks, 8 footers):

```
creator            : Brian Kim
last_modified_by   : Benjamin Anderson
revision           : 2911
total_edit_time_min: 2746          (45.8 hours)
created            : 2024-11-03
modified           : 2026-07-14     <- BEFORE the 2026-07-30 generation date
template           : Normal.dotm
```

The file's own metadata predates its generation. Statular mutates `word/document.xml` on a
master `.docx` and rezips without touching `docProps/`. Zero content controls, zero
MERGEFIELD/DOCVARIABLE, all 88 field codes are `PAGEREF` for the table of contents.

**Not HotDocs** — unlike the `samples/interactivelegal/` files in this repo, which all carry
`template: hotdocs` / `hotdocs.dotx` with heavy bookmark anchoring.

Their moat is quantified: one master Word document, ~46 hours of human drafting, 2,911 saves.

### ✅ Determinism control — RESOLVED 2026-08-02

The revocable trust package was generated twice with identical questionnaire answers
(`Adam_Elias_v1.docx`, `Adam_Elias_v2.docx`):

```
non-empty paragraphs : 2513 in both
identical            : 2508  (99.80%)
differing            :    5  (0.20%)  — paragraphs 32..36, consecutive
location             : Cover Letter, plain-English plan narrative
```

`docProps` are identical between runs (same `revision: 2911`, same `modified: 2026-07-14`), as
are bookmark count, field-code count, and rsid count.

**Statular is deterministic template assembly with a narrow generative seam.** The five
divergent paragraphs are not merely reworded — they are **reordered and merged** between runs
(the special-needs paragraph moves after the families-of-origin paragraph in v2 and is folded
under a new "A few additional rules apply across these shares" lead-in). No template engine
reorders paragraphs. That is a model.

Substance is preserved across both runs — joint access, survivor's unrestricted access, equal
shares to the named children, special-needs conversion, families-of-origin fallback all appear
in both. The model is re-expressing a fixed fact set, not inventing.

**Every operative instrument rendered identically.** Trust, both POAs, both wills, both advance
directives, HIPAA, deed, and all funding documents are prose-identical across runs. AI touches
only non-operative client-facing narrative, where variation is cosmetic.

Two consequences:

1. **Every subsequent package diff is pure conditional logic, not sampling noise.** That was the
   point of the control. Cross-package diffs can now be read at face value.
2. **This inverts our architecture.** `trust-generator.ts` produces the trust 100% by AI at
   temperature 0.15 because no `.hbs` exists for `docType: 'trust'`. Statular's trust is 0% AI.
   We have the model where they have the template, and nothing where they have the model. Their
   split — deterministic instruments, generative client narrative — is the defensible one.

Residual risk if we build the same thing: an AI-written narrative summarising an instrument it
did not generate can drift from it. Their `Summary of Your Estate Plan` measured fully static;
the Cover Letter is their only generative surface.

### Package 2 — separate trusts (`Adam_Elias_v1_1.docx`), 2026-08-02

Generated as a **minimum-input run**: Adam answered only the questions the package required
(trustee appointments and bequest preferences) and left optional toggles unchecked. Same client
record — Adam, Karen, three children (Alina, Addison, Adam Jr.) — but a much thinner asset set.
The ASSETS table holds a single row: Real Property, 93 Old Church Road, no description, no value.

```
paragraphs : 1911   (vs 2513 joint)
titled docs:   33   (vs 34)
similarity :  48.4% against the joint package
```

**Attributable to package selection:**

- One joint trust (282 paras) becomes **two separate trusts** — Adam's (187) + Karen's (190).
  The joint instrument is larger than either individual one because it alone carries the
  first-death/second-death machinery. This is exactly the split `trust-joint.hbs` /
  `trust-single.hbs` encode.
- The funding set duplicates per trust: Comprehensive Transfer of Assets, Certification of
  Trust, Assignment of Personal Property ×2. Client Information and Fiduciary Designations
  summaries likewise ×2.
- Cross-appointment: spouse is first successor trustee, POA agent, and health care
  representative for each other; executor is "the then-acting Trustee(s) of THE ADAM J. ELIAS
  LIVING TRUST".

**NOT attributable to the package** — explained by minimum input, not package logic:

| Absent | Cause |
|---|---|
| Retirement / conduit article | no retirement accounts entered |
| Special needs provisions | no child flagged special needs |
| Bargain and Sale Deed, Notice of Revocable Trust Transfer | real property on file but no legal description or value |
| Trust Protector article | option presented, left unchecked |
| Successor Trustee Checklist, Fiduciary Role Guide, Invoice, Declaration of Capacity | unselected options (static content, so not data-suppressed — but an unchecked toggle explains it) |

### ⚠ Defect found in Statular output — TOC advertises articles the instrument lacks

Verified in **both** packages, including the fuller joint one. Counts are of paragraph
occurrences, split by paragraph style:

| Concept | TOC entries | Body headings | Body text |
|---|---|---|---|
| Trust Protector *(separate pkg, unchecked)* | 4 | 0 | **0** |
| Bypass Trust | 1–2 | 0 | **0** |
| Disclaimer Trust | 1–2 | 0 | **0** |
| Family Pot Trust | 1–8 | 0 | **0** |
| Qualified Domestic Trust | 2 | 0 | **0** |

Control: in the joint package where Trust Protector *was* selected, it appears in the TOC (2)
**and** the body (18 headings, 33 mentions). So selected articles render correctly in both
places.

**Their table of contents is emitted from the master template's full outline rather than from
the assembled document.** Conditional articles are correctly dropped from the body but remain
listed in the TOC. Every trust they ship carries a contents page naming articles the instrument
does not contain.

Relevant to us: this is precisely what `template-fidelity-validator.ts` and
`doc-content-integrity-checker.ts` exist to catch. If we build a TOC, it must be derived from
the assembled document, and the integrity check should assert TOC ⊆ body headings.

*Not a defect:* every TOC entry in both packages renders its page number as `[ ]` — 188/188 and
87/87. That is an un-updated `PAGEREF` field, normal for programmatic OOXML assembly; Word
populates it on open or F9. Do not report it as dangling.

### Package 3 — joint revocable, MAXIMAL config (`Adam_Elias_v1_2.docx`), 2026-08-02

Run 01 of the Chrome-extension sweep. Every option enabled, full asset set ($3,375,000),
Trust Protector on, special-needs flag on, both retirement accounts, block/lot and value.
2,978 paragraphs, 35 titled documents. Deed deliberately skipped (interview page 23 left empty).

**The trust grew 282 → 455 paragraphs (+61%).** The eight top-level articles are *identical*
across every configuration observed:

```
DECLARATION OF TRUST · TRUSTEESHIP · TRUSTEE POWERS · TRUST PROTECTOR
DISTRIBUTION DURING THE SETTLORS' JOINT LIVES
DISTRIBUTION ON FIRST SETTLOR'S DEATH
DISTRIBUTION ON SECOND SETTLOR'S DEATH
ADMINISTRATIVE PROVISIONS
```

**The article spine is fixed; only sections vary.** This is an 8-for-8 match with the spine in
`functions/src/templates/trust-joint.hbs` (PR #258), in the same order — independent validation
of that skeleton.

**The 13 sections that appear only at maximal config** — this is the conditional-logic map:

| Group | Sections |
|---|---|
| First-death division | Division of Trust Estate · Distribution of Deceased Settlor's Share · Survivor's Trust · Marital Trust · Disclaimer Trust |
| Children's pooled share | Family Pot Trust |
| Non-citizen / foreign | Qualified Domestic Trust Provision · U.S. Trustee for QDOT · Foreign Trust Savings Provision |
| Tax-sensitive powers | Special Trustee · Definition of Independent Trustee and Interested Trustee |
| Misc | Bond Requirement · Debts and Advancements |

### ⚠ CORRECTION — the TOC finding was overstated

An earlier entry claimed Statular's trust TOC "advertises articles the instrument lacks" as a
general defect, citing Bypass/Disclaimer/Family Pot/QDOT/Marital as TOC-only. **At maximal
config all of those render in the body** (Disclaimer 3 headings, Family Pot 4, QDOT 12, Marital
18, Special Trustee 2). The earlier packages were partial-input runs; those articles were
legitimately absent because their conditions were unmet.

What remains true, and is the correct, narrower claim: **the TOC is static across
configurations while the body is conditional.** TOC entry counts do not change between runs.
So any sub-maximal configuration — i.e. essentially every real client — ships a contents page
listing articles the instrument does not contain. Still worth encoding as a validation rule
(assert TOC ⊆ body headings), but it is a TOC-generation shortcut, not a broken engine.

Also softened: `Successor Trustee Checklist` grew 556 → 602 paragraphs between runs, so it is
not purely static boilerplate as previously recorded.

### Possible over-inclusion — QDOT for two U.S. citizens

Both settlors are recorded as `Citizenship: U.S. Citizen` on client 7236, yet maximal config
renders `Qualified Domestic Trust Provision`, `U.S. Trustee for Qualified Domestic Trust`, and
`Foreign Trust Savings Provision` (12 + headings). QDOT applies where the surviving spouse is
*not* a U.S. citizen. Charitably this is savings-clause drafting; less charitably the engine
honours the toggle without consulting a citizenship fact it already holds.

Consistent with the independent assessment that the engine is *strict about identifiers*
(refuses a life-insurance transfer without a carrier name) and *loose about substance*
(40 post-generation suggestions on one package). **Validation rule for us:** suppress or warn on
QDOT provisions when no settlor is a non-citizen.

### ⚠ Template version drift between runs

`Adam_Elias_v1.docx` (2026-07-30) and the two 2026-08-02 packages use different template
labels for the same instruments:

| v1 (July 30) | v1_1 / v1_2 (Aug 2) |
|---|---|
| Durable Power of Attorney of X | Power of Attorney of X |
| Advance Health Care Directive of X | Advance Directive of X |
| General Assignment | Comprehensive Transfer of Assets |
| The Elias Family Living Trust | The Elias Family Trust |

Sizes moved too (POA 201→225, AD 91→104). Treat v1 as a *different template generation* from
the August runs; cross-version diffs carry this as noise.

New documents at maximal config: `Estate Plan Signing Instructions` (81),
`Request for Capacity Evaluation for Estate Planning` ×2 (41, 37).

### Package composition

~31% of the portfolio is boilerplate. Measured by name-density per segment:

| Segment | Paras | Name hits |
|---|---|---|
| Successor Trustee Checklist | 556 | 3 |
| Fiduciary Role Guide | 135 | 2 |
| Summary of Trust Protector Provisions | 29 | 0 |
| Summary of Your Estate Plan | 21 | 0 |
| Notice – Advance Health Care Directive ×2 | 15 each | 0 |
| Invoice | 16 | 0 |

The single largest document in the package is a static client-education booklet. That is not
generation work — it is a Word file written once and stapled in.

### ⚠ Correction to the earlier gap analysis

An earlier pass called ~14 documents "missing" based on the ten files in
`functions/src/generators/`. **That was wrong.** Many already exist as *flex* doc types with
prompts in `functions/src/flex-prompts.ts`, routed through `generate-flex-document.ts`:

`certificationOfTrust` · `hipaaRelease` · `coverLetter` · `invoice` ·
`memorandumOfPersonalProp` · `petTrust` · `letterOfInstruction` · `beneficiaryDesignation` ·
`engagementLetter` · `trustAmendment` · `trustRestatement` · `codicil`

**Genuinely absent** (no `DocType`, no flex prompt) — verify each before building:

- General Assignment / Comprehensive Transfer of Assets
- Trust Funding Instructions
- Notice of Revocable Trust Transfer + Request for Property Insurance Endorsement
- Visitation Authorization
- Final Disposition Instructions
- Declaration of Capacity, Independent Intent, and Freedom from Influence
- Client Acknowledgment
- Consent to Dual Representation
- Summary of Fiduciary Designations
- Summary of Trust Protector Provisions
- Fiduciary Role Guide *(static booklet)*
- Successor Trustee Checklist *(static booklet)*

### Template resolution — the blocker for any `.hbs` work

`getTemplate()` (`functions/src/template-engine.ts:1335`) reads **Firestore**
(`firms/{firmId}/documentTemplates`), with fallbacks to vector search, the knowledge base, and
a legacy collection. **Nothing in `functions/src` reads `.hbs` files from disk at runtime** —
the only `readFileSync` is `inheritance-tax-review.ts:89` pulling PDFs from `assets/`.

`copy-templates.js` copies `functions/src/templates/*.hbs` into `lib/templates` on every build,
where nothing opens them. `poa-simple.hbs` and `poa-comprehensive.hbs` are reference copies,
not live templates.

Open decision, unresolved:

1. **Seed into Firestore** — matches existing architecture; per-firm copies drift.
2. **Disk fallback in `getTemplate()`** — templates become versioned code shipping with a
   deploy; firm uploads still override. Adds a fifth resolution layer to a load-bearing
   function. *Recommended, more strongly under the single-firm objective.*

---

## Upload protocol — read before analysing new packages

Adam is generating additional Statular packages and uploading them.

**Client data must be byte-identical across every package.** Same names, address, children and
ages, fiduciaries, assets, beneficiary designations. Vary only the package selection. Then every
inter-package difference is package logic rather than name-substitution noise.

The determinism test is **spent and resolved** — see the control result above. 99.80% of
paragraphs are byte-identical across runs, so package diffs are interpretable at face value.
The one generative surface is the Cover Letter narrative; discount divergence there.

Consolidated multi-document exports are sufficient — full per-document structure is extractable
by segmenting on `Title` paragraph style. Separate per-document downloads would only add
per-document `docProps` and `styles.xml`, which is archaeology about Statular's build process,
not drafting input.

---

## Reconciliation — Statular findings vs. this codebase

### The headline: the architecture is right and starving, not wrong

`unified-generator.ts:725` already routes non-`ai` modes through
`generateFromTemplate(clientContext, docType, generationMode, templateId, variant, aiGenFn, ...)`
— deterministic template first, AI as gap-filler and fallback. **That is Statular's
architecture.** It is designed and built. `getTemplate()` then finds nothing for
`docType: 'trust'`, the `aiGenFn` closure fires, and every trust is produced 100% by AI at
temperature 0.15.

Not an architecture problem. A content problem. The gap between their 455-paragraph instrument
and our 16-line prompt outline (`trust-generator.ts:51-68`) is drafting hours, not code.

### Layer by layer

| Layer | Statular | Here | Verdict |
|---|---|---|---|
| Fact/election separation | client record + matter interview | Firestore `Client` + package/mode params | level — we already have it |
| Instrument generation | 100% deterministic template | 100% AI, no `.hbs` exists | behind, pipeline already built |
| Client narrative | AI, 5 paras, Cover Letter | absent | behind; `coverLetter` flex type already wired |
| Trust article spine | 8 fixed articles | PR #258 matches 8-for-8 | level |
| Conditional sections | 13 identified | 3 drivable today | small gap, see below |
| Validation | post-generation suggestions | 5 validator modules | ahead architecturally |
| Beyond the overlap | — | NJ inheritance tax engine, KB vector search, wills OCR, e-sign, LawPay, transcription→matter | ahead |

### The conditional gap is two fields

| Their section | Driver here |
|---|---|
| Marital Trust · Disclaimer Trust · Division of Trust Estate · Survivor's Trust · Distribution of Deceased Settlor's Share | `trustOptions.taxPlanning` — added in PR #258 |
| QDOT · U.S. Trustee for QDOT · Foreign Trust Savings | `personalInfo.citizenship` — already exists (`CitizenshipStatus`) |
| Bond Requirement | `fiduciaries.trustee.bondRequired` — already exists |
| Debts and Advancements | prose only, no field |
| **Family Pot Trust** | **missing** |
| **Special Trustee / Independent vs. Interested Trustee** | **missing** |

On QDOT we can do better than they do: they render QDOT provisions for two U.S. citizens
because the toggle was on. We store `citizenship` — suppress or warn when no settlor is a
non-citizen.

### Templating the trust dissolves the truncation problem

`trust-generator.ts:219` sets `maxTokens: 32768` and the return type carries a `_truncated`
flag that fires in production. That is the cost of asking a model to emit a whole instrument.
Slot-filling does not have that ceiling.

### Package design note

Statular's packages **do not restructure the trust** — 282-paragraph and 455-paragraph runs
share the same eight articles. Packages select documents and elections. `trust-generator.ts:172`
currently branches on `packageType === 'fortress'` to flip the trust to joint irrevocable, i.e.
a package changing an instrument's fundamental nature. Worth revisiting as a `trustType`
election rather than a package side effect.

### Validation posture

`unified-generator.ts:773` skips structural validation in `template` mode on the reasoning that
an uploaded template is authoritative. Under a template-first architecture that is backwards for
completeness and cross-document consistency checks. Fiduciary-conflict and completeness rules
should run regardless of mode.

### ⚠ Discipline note — do not repeat this mistake

Several findings this session were artifacts of thin or placeholder input read as properties of
Statular's engine, and had to be retracted: the TOC "defect" (measured on partial-input runs;
at maximal config the articles render), and a notary-disqualification issue that was purely a
collision in filler data where Adam was both client and notary. A claimed statutory gap around
health-care representatives witnessing directives was repeated from a browser-session report and
never independently verified — treat it as unconfirmed.

**Rule out the test data before attributing anything to their engine.**

### Priority

1. **Make `.hbs` reachable** — nothing in `functions/src` reads disk templates; `getTemplate()`
   is Firestore-only. Blocks PR #258 and every template deliverable.
2. Fill `trust-joint.hbs` prose — spine validated, elections mapped, drafting hours.
3. Two schema fields — Family Pot Trust, Special/Independent Trustee.
4. Field-level validators, including QDOT suppression.
5. Cover-letter AI narrative — `coverLetter` flex type already exists.
6. Document inventory — Estate Plan Signing Instructions, Request for Capacity Evaluation,
   Trust Funding Instructions, Declaration of Capacity, Visitation Authorization, Final
   Disposition, Consent to Dual Representation, plus the two static booklets.

---

## Session close 2026-08-07 — what shipped

> Scope note: this section records the **templating work**, not new Statular observations.
> For the product itself the video pass (root `STATULAR-VIDEO-REVIEW.md`, section J of root
> `HOMEWORK.md`) is newer and wins on anything it covers.

Four PRs merged. `main` at `e0d2b5b`.

| PR | What |
|---|---|
| #260 | `docx-forensics.py` + this file |
| #261 | rule 7 suspension in `CLAUDE.md` (since removed by someone else) |
| #266 | `bundled-templates.ts` — disk `.hbs` reachable at runtime |
| #258 | `trust-joint.hbs`, `trust-single.hbs`, `TrustOptions`, `TrustProtector` |

### The template pipeline is now wired end to end

`getTemplate()` consults, in order: explicit `templateId` → `softwareSource` → `variant` →
firm default → vector search → knowledge base → legacy collection → **bundled**. A firm's
uploads always win; the bundled path is skipped entirely when `softwareSource` was specified.

`generateFromTemplate` derives the trust variant from marital status (`Married` + `spouseInfo`
→ joint, else single). `getTemplate` stays client-unaware. `poa`'s simple/comprehensive split
is an attorney choice and is never derived.

**Runtime behaviour is unchanged.** `loadBundledTemplate` treats any file containing
`[[DRAFT` as unavailable, so both trust skeletons are held back and trusts still route to AI
generation. Verified on merged `main`:

```
married -> joint  -> AI (skeleton held back)
single  -> single -> AI (skeleton held back)
```

### ▶ THE ONE REMAINING TASK

**Fill the `[[DRAFT: ...]]` stubs in `functions/src/templates/trust-joint.hbs` (151) and
`trust-single.hbs` (134).** Attorney drafting, not engineering.

Nothing else is required. The moment a file has no `[[DRAFT` left, the guard stops holding it
back and that trust starts rendering from the template instead of the model. There is no flag
to flip and no code to change.

Do it one article at a time and re-run `npm run test` — the guard is all-or-nothing per file,
so a partially drafted template stays held back, which is the intended behaviour.

### Structural reference

The eight-article spine matches a maximal-configuration Statular instrument 8-for-8. The 13
sections that appear only under maximal config are catalogued under *Package 3* above and are
all wired to conditionals. Do not add articles without checking that catalogue first.

### ⚠ Known issue introduced by these merges

`tests/unit/inheritance-tax-pdf-fill.test.ts` went red on 2 of 3 full-suite runs after
merging, and clean `main` beforehand was green 3 of 3.

Not a logic break. That file does real PDF rendering, passes 45/45 alone in **61 seconds**,
and takes **87–95 seconds** under full-suite load. Vitest allocates a worker per test *file*;
`tests/unit/bundled-templates.test.ts` adds one more worker on a 4-core box and tips the
CPU-bound suite past its timeout. The 12ms of assertions are irrelevant — it is the worker
slot.

**Deploys are gated on tests**, so this can abort a Firebase deploy and would present as an
inheritance-tax failure. Fix is to raise the timeout on that file. It was left alone because it
belongs to the inheritance-tax work.

**Update — it did NOT reproduce in CI.** Both deploys of the merge (`e3381c9`, `e0d2b5b`) passed
the test gate and shipped green. The GitHub runner has more headroom than the 4-core container
where this was measured, so treat the risk as latent rather than active. It is still closer to
its ceiling than before: one more test *file* could tip it in CI too.

Do **not** "fix" this by adding `// @vitest-environment node` to the bundled-templates suite.
That was tried and reverted: `tests/setup.ts:158` calls
`Object.defineProperty(window, 'matchMedia', ...)` and dies without jsdom, so the file
collects zero tests and the suite goes green by not running them.

### ▶ OUTSTANDING — prune five merged branches

Five branches from the 2026-08-07 session are merged but still on the remote:

```
claude/trust-template-schema
claude/template-disk-fallback
claude/statular-package-analysis
claude/homework-session-close
claude/suspend-automerge
```

All five are **verified safe** — each contribution was confirmed present on `main` by content,
not by ancestry (squash merges leave the branch tip a non-ancestor, so `git branch --merged`
reports nothing):

| Branch | Confirmed on `main` |
|---|---|
| `trust-template-schema` | `survivorsTrust`, `bypassTrust`, `familyPotTrust`, `specialTrustee`, `TrustProtector`, `governingState` |
| `template-disk-fallback` | `functions/src/bundled-templates.ts`, its test, `'bundled'` in `generate-documents.ts` |
| `statular-package-analysis` | `docx-forensics.py`, this file |
| `homework-session-close` | byte-identical to `main` |
| `suspend-automerge` | block deliberately removed later — its absence is correct |

```bash
git push origin --delete \
  claude/trust-template-schema \
  claude/template-disk-fallback \
  claude/statular-package-analysis \
  claude/homework-session-close \
  claude/suspend-automerge
```

**⚠ This cannot be done from a Claude Code web/remote session.** The session git proxy returns
`HTTP 403` on ref deletion — it permits creating and updating refs but not deleting them. A new
remote session will hit the same wall. Run it locally, or delete the branches in GitHub's UI.

Do **not** touch the other ~20 `claude/*` branches on the remote; they belong to other sessions.

### Unresolved — cancelled Functions deploy on `b4b480b4` (#293), 2026-08-06

Investigated 2026-08-07 and **not resolvable**: the run-level log archive is an empty 22-byte
ZIP and the job log endpoint 404s, so the logs are gone.

What the metadata rules out — the job's conclusion is `cancelled`, not `failure`, so it was not
a test or build failure; `timeout-minutes: 120` and there are no step-level timeouts, so it was
not a timeout; `cancel-in-progress: false` and it was the only run that day between 12:58 and
the next push eight hours later, so nothing superseded it.

It ran exactly 15:01 (17:35:06 → 17:50:07) against a healthy baseline of ~11.7 min. Either a
manual cancellation, or the runner was lost — the missing logs favour the latter, since GitHub
retains Actions logs for 90 days and a clean user cancellation normally preserves output.

**No action needed.** #293's changes shipped in the next Functions deploy (`8cce6f8`) anyway,
which is why it went unnoticed. If certainty is ever wanted, GitHub's UI surfaces a
cancellation actor the API does not — Actions → run `31123551307`.

### Statular trial

Expired 2026-08-06. No payment method was on file. Three packages were captured and are
analysed above; the Bypass A/B comparison run was never taken.

---

## ▶ NEXT (superseded — see Session close above)

1. **Await further Statular packages** from Adam. Analyse each on arrival; hold the
   cross-package synthesis until he says the collection is complete. The determinism control is
   done — see above — so package diffs are now interpretable at face value.
2. On arrival, produce: a **document × package matrix** for Statular, the same matrix for this
   repo's `foundation` / `guardian` / `fortress`, and pairwise clause diffs.
   `trust-generator.ts:172` already branches on `packageType === 'fortress'` to produce a joint
   irrevocable Medicaid instrument — if Statular ships an equivalent package, diffing it against
   the revocable one yields their MAPT clause set, which is NJ work and squarely in scope.
3. **Resolve the template-resolution decision above.** It blocks every `.hbs` deliverable,
   including PR #258.

---

## Related

- **PR #258** (`claude/trust-template-schema`) — `trust-joint.hbs` / `trust-single.hbs`
  skeletons plus `TrustOptions`, `TrustProtector`, `Client.governingState`,
  `Client.executionDate`. Open, unmerged, awaiting sign-off; touches two Never-Break List
  areas. Inert as committed — nothing routes `trust` to an `.hbs`. Under the confirmed
  objective `governingState` is vestigial but harmless; leave it rather than churn the PR.
- `samples/interactivelegal/` — nine HotDocs-derived DOCX files. These appear to be **real
  client matters** (named wills, POAs, trusts) committed to the repo. Worth a deliberate
  decision about whether they belong in git.
