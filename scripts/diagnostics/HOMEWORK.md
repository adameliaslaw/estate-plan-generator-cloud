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

The determinism test remains **unspent**: generate one package twice with identical answers.
100% paragraph similarity means deterministic template assembly and every later diff is pure
conditional logic. Any prose divergence means a model is in the loop and diffs carry sampling
noise.

Consolidated multi-document exports are sufficient — full per-document structure is extractable
by segmenting on `Title` paragraph style. Separate per-document downloads would only add
per-document `docProps` and `styles.xml`, which is archaeology about Statular's build process,
not drafting input.

---

## ▶ NEXT

1. **Await further Statular packages** from Adam. Analyse each on arrival; hold the
   cross-package synthesis until he says the collection is complete.
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
