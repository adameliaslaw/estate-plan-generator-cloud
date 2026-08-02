# Statular package analysis — branch homework

**Branch:** `claude/statular-package-analysis`
**Scope:** this file is deliberately branch-local. It does **not** replace the root
`HOMEWORK.md`, which tracks main-line work and is being updated by the concurrent
calibration effort. Do not merge this file's contents into the root file.

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

- **No merges in the originating session.** A calibration task is running concurrently on
  `main` (see #255 calibration callables, #256 calibration-session autosave, #257 clause-miner
  seed files). Everything stays on branches.
- Root `CLAUDE.md` rule 7 tells agents to squash-merge their own PRs once verified. That rule
  is **suspended** while calibration is live. Do not auto-merge.
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

## ▶ NEXT

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
