# NJ inheritance-tax forms — build plan

Scope for continuing the official-form work in a fresh session. Written 2026-07-27, immediately
after the first three schedules went live, while the reasoning was still fresh.

Read [IT-R-SPECIFICATION.md](./IT-R-SPECIFICATION.md) first — it is the legal spec, and the
authority for every figure. This document is only about getting those figures onto the State's
own forms.

---

## 1. What is live today

The State's blank booklet ships at `functions/assets/itr-blank.pdf` (the published `itrbk.pdf`,
15 pages, 853 widgets / 808 distinct field names). `fillITRPdf` fills it from an approved
checkpoint and `getInheritanceForm` returns it base64 when the caller passes `pdf: true`. The page
has a **Download official IT-R** button.

| Part of the booklet | Page | State |
|---|---|---|
| Cover page — estate info, the five yes/no questions, the two restated figures | 1 | ✅ filled |
| Summary Page — lines 1–22, tax-class table, total distribution | 2 | ✅ filled |
| IT-PMT payment voucher | 3 | ✅ filled (#189) |
| Schedule A — NJ real property | 4 | ⬜ needs intake |
| Schedule B — closely held business | 5 | ⬜ needs intake |
| Schedule B-1 — financial institution accounts | 6 | ⬜ needs intake |
| Schedule B-2 — stocks / co-ops | 7 | ⬜ needs intake |
| Schedule B-3 — municipal and corporate bonds | 8 | ⬜ needs intake |
| Schedule B-4 — all other property | 9 | ✅ filled (18 rows) |
| Schedules B1–B4 Recap | 10 | ✅ filled (#189) |
| Schedule C — transfers | 11–12 | ⬜ needs intake |
| Schedule D — deductions | 13–14 | ✅ filled — Parts I, II-A and III (#189) |
| Schedule E — beneficiaries | 15 | ✅ filled (9 rows) |

Every total the unmapped schedules feed **is already on the Summary Page**, so the return's
arithmetic is complete. What is missing is the itemisation behind those totals.

**Still blank inside the filled schedules**, each for a reason: Part II Section B of Schedule D
(debts tied to a sale of the decedent's real property — the model has no sale concept); the SS#
blocks beside the executor's commissions (no SSN is held for a personal representative); the
Estimated/Agreed checkboxes beside the professional fees (nothing records which a fee is); and the
eleven per-check boxes on the IT-PMT (how a remittance is split across checks is not in the estate
record).

Verified by `tests/unit/inheritance-tax-pdf-fill.test.ts`: the gold case is filled and the values
are read back **out of the produced PDF**, so the State's own $68,389.70 and $558.71 are asserted
to land in the boxes the State prints them in.

---

## 2. Facts worth not rediscovering

These cost real time to establish. A fresh session that skips this section will spend a couple of
hours re-learning them.

**The field names are garbage, and that is the whole difficulty.** `undefined_13`,
`0_2t4gsdxv0_22aa2aau65t`, `C Tax ClassName Address@@$#@@@$#@`, and one carrying the State's own
typo, `Deceaaaas1dent`. Nothing can be mapped by name. Use `scripts/itr-field-inventory.mjs`,
which pairs every widget with its position and the printed text beside it:

```bash
node scripts/itr-field-inventory.mjs                 # per-page widget counts
node scripts/itr-field-inventory.mjs --page 13       # one page, grouped into rows
node scripts/itr-field-inventory.mjs --json out.json # the lot, for generating tables
```

**Generate the row tables; never transcribe them.** `SCHEDULE_E_ROWS` and `SCHEDULE_B4_ROWS` in
`it-r-pdf.ts` were emitted by a script that walked the inventory. Hand-copying those strings is
how a row silently stops filling.

**Money boxes on the Summary Page are pairs** — a wide dollars box and a narrow cents box to its
right. `FieldWriter.money()` handles the split. Schedule columns are single boxes with a printed
`$` and `.`, so those take an inline `1,234.56` via `formatMoneyInline()`.

**Columns are identified by x-position, rows by y-position, both against the printed headers.**
That is how the tax-class table was resolved: headers sit at x112 Beneficiaries, x189
Distribution, x276 Exemption, x374 Taxable, x476 Tax; rows 10–14 at y415/397/379/361/343. Do the
same for any new schedule rather than guessing from a label that happens to be nearby.

**15 field names carry more than one widget, and all of them are benign** — radio Yes/No pairs,
plus the decedent header (`Decedents Name_4`, `Date of Death`, `Decedents Social Security Number`)
which is shared across all 12 schedule pages. Writing that header once fills every schedule page.
There are no accidental collisions between unrelated money boxes; that was checked.

**Schedule E's tax-class column is a dropdown** whose options are exactly `" "`, `A`, `C`, `D`,
`E` — the engine's `TaxClass` values. Use `FieldWriter.dropdown()`, not text.

**A missing field name is a bug, not a runtime condition.** `fillITRPdf` collects every failure
and throws with the list. If NJ reissues the form, the test fails loudly instead of producing a
return with empty boxes. Keep that property.

**Everything renders from the frozen approved snapshot (FND-IMMUT, spec §10).** Editing a matter
after approval must never change an approved form. When adding a field, it has to reach the form
through `buildFormSnapshot` → `computationSnapshot.formSnapshot`, not by re-reading the live
matter. `addressParts` is the worked example.

**Every Zod object schema is `.strict()` (FND-STRICT).** A new field on a matter must be declared
in `functions/src/inheritance-tax/validation/matter.ts` or the save is rejected. And the client
must not send a field the deployed server doesn't know — that ordering broke saving once.

**Deploy footgun, learned the hard way:** binding a secret that does not exist in Secret Manager
fails the deploy for the entire codebase at validation, before anything uploads. Create the secret
in the same change as the binding.

---

## 3. Shape of the work

Three tracks, independent of each other.

### Track 1 — finish the IT-R booklet
Mapping work, plus intake fields for the schedules whose columns the model cannot answer.

### Track 2 — the three orphaned forms ✅ WIRED

> **Done.** `getInheritanceCompanionForm` serves all three from the same approved snapshot the
> IT-R renders from, and the page has a "Companion forms" row beside the IT-R buttons. Each form's
> precondition is enforced by its builder and surfaced as `failed-precondition` with the reason —
> the builders' deliberate refusals now throw `FormPreconditionError` rather than a plain `Error`,
> so a refusal an attorney can act on never reaches the client as `internal`.
>
> **The estate-tax research this section demanded, done first — and it did not go the way the
> section expected.** The engine *does* compute NJ Estate Tax: `computeNJEstateTax` has a
> Simplified-Method (Column A) table carrying a primary-source citation to the State's own Form
> IT-Estate. The `VERIFY: rate tables not confirmed from primary source` marker is a **stale
> comment on the `njEstateTaxExemption` field in `rules/ruleSet.ts`**, not a gap in the
> computation.
>
> Checked against the State's own General Information sheet
> ([NJ Form O-10-C](https://www.nj.gov/treasury/taxation/pdf/other_forms/inheritance/o10c.pdf))
> and the Division's Inheritance and Estate Tax page, both retrieved 2026-07-28:
>
> - **"There is no New Jersey Estate Tax imposed on the estates of resident decedents dying on or
>   after Jan. 1, 2018."** (P.L. 2016, c. 57.) The 2018 rule set's `njEstateTaxApplies: false` is
>   correct, and IT-Estate is refused for any death from that date — which is every ordinary
>   matter this tool will see.
> - **2017 deaths**: $2,000,000 exclusion, tax computed on the taxable estate under the current
>   IRC at 0–16%, with a credit equal to the tax on the exclusion amount ($99,600). Circular, and
>   the State supplies its own calculator — which is why the engine returns a null tax and points
>   the attorney there instead of inventing a rate. Rule set matches.
> - **Deaths after Dec. 31, 2001 but before Jan. 1, 2017**: the $675,000 threshold, with either
>   the 2001 Form 706 method or the Simplified Method "based upon the net estate as determined for
>   the New Jersey Inheritance Tax". Rule set matches; the Simplified Method is what the engine
>   implements.
> - **Estate tax is resident-only** — "There is no Estate Tax assessed against nonresident
>   decedent's estates" — which the engine already enforces.
> - **L-9 / L-9 NR** are "a request for a real property tax waiver … for use by Class A
>   beneficiaries … if the entire estate is untaxable for Inheritance Tax purposes", and may not be
>   used if any NJ Estate Tax is payable. Exactly the preconditions `buildL9AFormData` enforces.
>
> So no rate table needed rewriting. What was missing was wiring, and that is now in place.
> **~~Left for a follow-up~~: the official filled PDFs — half done.** IT-EXT and the L-9 are
> filled from the approved snapshot and downloadable beside their workpaper button. The L-9(A)
> and both IT-Estate returns are not, for reasons that turned out to be substantive rather than
> clerical — see §3.1.

**Where the blanks live** (checked 2026-07-28 — none is at the filename you would guess, and the
State's own index page is the only reliable way to find one). Index:
<https://www.nj.gov/treasury/taxation/prntinh.shtml>. All paths are relative to
`https://www.nj.gov/treasury/taxation/pdf/other_forms/inheritance/`.

| Builder | Blank(s) | Note |
|---|---|---|
| `buildITEXTFormData` | `itext.pdf` | Application for Extension of Time to File. One form, no date split. |
| `buildL9AFormData` | `itl9a.pdf` **and** `itl9.pdf` | The builder already sets `formDesignation` to `L-9(A)` or `L-9` off `dateOfDeath < '2018-01-01'` — but those are **two separate State PDFs**, so a filled-PDF follow-up needs both blanks and both inventories. |
| `buildITEstateFormData` | `itestate.pdf` **and** `it-estate2017.pdf` | Same shape: `itestate.pdf` is "prior to January 1, 2017", `it-estate2017.pdf` is the 2017-only return. The builder covers both ranges, returning a null tax for 2017 (the State's §2058 calculator). |
| Track 3 | `itnrai.pdf` | IT-NR: nonresident return, instructions and voucher. `itnrfaq.pdf` alongside it. |

**The trap:** one builder does not mean one blank. Two of the three span a date boundary the State
answers with a different printed form, so the PDF filler must pick the blank from the date of
death — the way `getRuleSet` already picks a rule set — not from the builder's name.

Only the blanks with a filler are committed to `functions/assets/`. To inventory one that is not
mapped, download it from the URL above and pass `--file`:

```bash
node scripts/itr-field-inventory.mjs --form itext --page 1   # a committed blank
node scripts/itr-field-inventory.mjs --file /tmp/itl9a.pdf --page 1
```

### 3.0 Decisions taken 2026-07-28 — do not re-open without new information

| Question | Answer | Consequence |
|---|---|---|
| Nonresident decedents? | **No** | Track 3 closed. Refused at compute; that is the final behaviour. |
| Pre-2018 deaths? | **Not in practice** | L-9(A) and both IT-Estate returns are not being built. |
| Add a life-insurance asset type? | **No** — and it would be harmful | See below. |

**Why no life-insurance bequest type**, researched against the State's IT-R instructions
(`it-rinst.pdf`) rather than assumed:

> *Life insurance proceeds payable to named beneficiaries, or beneficiaries of an insurance trust
> established by the decedent, are **exempt** for New Jersey Inheritance Tax purposes.*
> *Note: Insurance policy proceeds **payable to the Estate**, instead of a named beneficiary, are
> includible in the Estate and are subject to tax.*

Schedule C Part III splits on exactly that line — Section A (named beneficiary) records that life
insurance there "is not required to be reported"; Section B records that policies "payable to the
decedent's Estate **are required** to be reported". The taxable half is therefore already
representable as a `transfer` with `part: 'pod_to_estate'`, and the filler's "Type of Policy"
column takes the item description. A first-class life-insurance type would add nothing and would
invite attorneys to enter the *exempt* policies, over-taxing the estate.

**Out-of-state property — the answer, and the asymmetry.** Schedule A: *"Do not report real
property located outside New Jersey."* It never enters the gross estate. But intangibles are
included wherever they sit — stock is reported *"regardless of where the company is incorporated"*,
a co-op *"no matter where the co-op is located"*. And Schedule D's "Do not deduct" list includes
*"Debts secured by real or tangible property located outside of New Jersey"* — so the out-of-state
property is excluded from the estate **and** its mortgage is not deductible. It cuts one way only.

Because the engine taxes whatever it is given, all three of these are errors of commission that no
code path can catch. They are surfaced on the intake screen instead — `NOT_REPORTED_ON_ITR` plus
per-option `note`s on the asset and deduction pickers, each quoting the instruction text, with
`tests/unit/inheritance-tax-reporting-guidance.test.ts` asserting both the copy and the engine
behaviour that makes it necessary.

### 3.1 What is filled, and what is left

| Form | Blank | State |
|---|---|---|
| IT-EXT | `itext.pdf` | ✅ filled — 1 page, 21 fields |
| L-9 (deaths on/after 2018-01-01) | `itl9.pdf` | ✅ filled — 3 pages, 78 widgets |
| L-9(A) (deaths before 2018-01-01) | `itl9a.pdf` | ⬜ not mapped — see below |
| IT-Estate (pre-2017) | `itestate.pdf` | ⬜ not mapped — 342 widgets, 14 pages |
| IT-Estate (2017 only) | `it-estate2017.pdf` | ⬜ not mapped |

`fillL9Pdf` **refuses** an L-9(A) rather than filing those figures on the L-9's paper, and the
refusal reaches the attorney as `failed-precondition` with its reason. The estate-tax returns have
no filler at all, so the callable simply returns no `pdfBase64` and the page says to hand-fill from
the workpaper. Neither case is silent.

**Why the L-9(A) is not just "the L-9 with an earlier date".** Three things, each of which has to
be solved before it can be filled:

1. **It asks for figures the model does not carry.** A federal-706-style estate-composition block —
   real estate, stocks and bonds, bank accounts, IRAs, pensions, life insurance, transfers, other
   assets, gross estate, adjusted taxable gifts, total. `L9AFormData` has none of these, and they
   are not the IT-R's schedule totals rearranged; mapping bequest types onto 706 categories is a
   decision, not a transcription.
2. **`undefined_16` is one field carrying two widgets** — page 1's line M (Total) and page 2's
   phone box. Writing either writes both.
3. **`Lot Block` is one field carrying the Lot widget AND the Block widget.** On that form, lot and
   block cannot be written independently at all. It needs per-widget writes, the same technique
   `FieldWriter.radioByIndex` uses for IT-EXT's radio pair, extended to text fields.

The L-9 blank has no shared names at all, which is why it went first.

**Two boxes on the IT-EXT are deliberately blank**, and it is worth not "fixing" them: the
representative's SSN (the model holds none for a personal representative) and the whole "Mailing
Address to send all correspondence" block. The second is a *choice* about where the Division should
write — usually the preparing attorney's office — not a fact the estate record contains, and
defaulting it to the executor would silently redirect the State's notices. The L-9's equivalent
block IS filled, because that form's own affidavit text makes it the representative: "Deponent
authorizes the party listed above to act as the estate's representative and to receive the
waiver(s) requested herein."

### Track 2 — the three orphaned forms (original scoping, kept for the record)
`buildITEXTFormData`, `buildITEstateFormData`, `buildL9AFormData` and their HTML renderers are
exported from `functions/src/inheritance-tax/forms/index.ts` **and called by nothing** — no
callable, no UI. They came across in the port and have been inert since. Each needs a callable, a
UI entry point, and optionally a filled official PDF (each is a separate State form, so each needs
its own blank and its own inventory).

⚠️ **IT-Estate carries a legal gap, not just a wiring gap.** The engine does not compute NJ Estate
Tax — `ITRFormData` says so outright, and the rule sets carry `VERIFY: rate tables not confirmed
from primary source`. Wiring the form up without doing that research would produce a form with no
verified figures behind it. Treat the research as the first task, not the code.

### Track 3 — IT-NR (nonresident) — ❌ NOT BUILDING
> **Decided 2026-07-28: Adam does not take nonresident decedents.** A nonresident matter is
> refused cleanly at `computeEstate` (#187) and that is where it stays. The scoping below is kept
> only so the decision is not re-litigated from scratch.

### Track 3 — original scoping (kept for the record)
Not modelled at all. As of #187 a nonresident matter is refused at `computeEstate` rather than
quietly returning a resident-basis figure. Building it means modelling NJ-situs property
(N.J.A.C. 18:26-2.15 — NJ real and tangible personal property only), which is an engine change
with its own gold cases, plus a different official form. **Largest of the three tracks, and the
only one that changes how tax is computed.** Do not start it without deciding it is wanted.

---

## 4. Track 1, in the order I would do it

> **4.1, 4.2 and 4.3 are done (#189).** Their entries are kept below as the record of what was
> decided and why. 4.4 and 4.5 are untouched and still need decision 1 in §5.
>
> What was learned doing them, worth keeping:
> - **Page 10's rows 1 and 2 are the trap the section warned about, and worse than expected**:
>   `2 Schedule B2 Sto111ckCoops_2` is the **B-1 accounts** row, not a B-2 row. Resolved by
>   y-position (642 vs 615) against the printed labels; a test now fills B-1, B-2 and B-3 with
>   distinct amounts so a swap cannot pass.
> - **The IT-PMT question answered itself.** Printed above the box: *"Amount paid with return
>   (From IT-R Summary Page, line 21)"*. No need to go to the instructions.
> - **Schedule D's categories are pre-printed**, so a row's meaning comes from the block it sits
>   in. Column (A) therefore carries the attorney's description in Parts I/II, and
>   `type — description` in Part III, where the page names no category.
> - **The payee field went in as `payeeName`** on `Deduction`/`ScheduleDeductionItem` — optional,
>   declared in the Zod schema, carried through `buildFormSnapshot`, with a "Paid to" box on the
>   page that drops the key when cleared. Exactly the `addressParts` pattern.
> - **Found and fixed while mapping**: the frontend offered a deduction type
>   (`other_state_inheritance_tax`) that the server's strict enum never accepted, so choosing
>   "Inheritance tax paid to another state" made the matter unsaveable. The value is now the
>   server's `transfer_taxes_other_states`. It still needed the `transferTaxEligibility`
>   attestation (N.J.A.C. 18:26-7.16), as did `executorCommissionEligibility` for a death on or
>   after 2025-12-15 — **both are now collected** (see below).

> **The attestation gap is closed.** `DeductionAttestationFields` asks for both attestations
> beside the deduction they belong to, and `src/lib/inheritance-tax-attestations.ts` carries the
> rules the page needs: when each is demanded, what is still outstanding, and which stale
> attestation to drop from the payload when the attorney changes a deduction's type or moves the
> date of death back before R.2025 d.152. The server remains the validator — every test asserts
> the client's answer *and* runs the real `validateMatter` over what the page would send, so a
> client rule that drifts from the regulation fails on the server assertion.
>
> Neither attestation is a second-attorney review. Both are statements of fact about this estate
> that the regulation makes the deduction depend on, so a sole practitioner attests them alone.
> An unticked box is a real answer — the estate fails the regulation's test and the deduction
> belongs off the return — so the UI says that rather than treating it as a missing field.

### 4.1 Schedules B1–B4 Recap (page 10) — do this first
Five boxes: the B-1, B-2, B-3 and B-4 totals, and their sum, which is Line 3. **The engine already
has all four** (`it-r.ts` sums them into `otherPersonal`). No model change, no intake change.
Half an hour including a test, and it substantiates a Summary Page line that currently appears
with nothing behind it.

One caution: two adjacent names on that page look near-identical
(`2 Schedule B2 Sto111ckCoops_2` vs `2 Schedule B2 StockCoops_2`). Resolve them by y-position, not
by reading the names.

### 4.2 Schedule D — deductions (pages 13–14)
Columns are description (x34), the name paid to (x219), and amount (x402), grouped into blocks by
category — funeral, administration, and so on — which lines up with `DeductionType`.
`ScheduleDeductionItem` already carries type, description and amount. **The only gap is the
payee name**, which is one optional string on the deduction, far smaller than what Schedule A
needs. 58 + 78 text fields across the two pages, so the row tables are the bulk of the effort.

### 4.3 IT-PMT voucher (page 3)
29 widgets. Decedent identity plus the amount being paid. Nothing new from the model — but confirm
against the instructions whether the voucher should carry Line 21 (balance due) or Line 19, and
cite the answer.

### 4.4 Schedules B-1, B-2, B-3, C — one intake field group each
Each needs a few per-item fields the model lacks:

- **B-1** accounts — institution, account number, names on the account
- **B-2** stocks — company, share count (121 widgets, the busiest page)
- **B-3** bonds — issuer, face value
- **C** transfers — transferee, date of transfer, consideration received

Pattern to follow: extend `Bequest` with an optional per-type detail object, declare it in the
Zod schema, carry it through `buildFormSnapshot`, and prefer it in the filler with the current
description as fallback. Optional throughout, so existing matters keep working — exactly how
`addressParts` was done in #184.

### 4.5 Schedule A — NJ real property, and Schedule B — closely held business
The expensive ones, left for last. Schedule A wants, per property: county, fractional interest,
street address, lot, block, municipality, owners/title, a mortgage-lien flag, assessed value, full
market value, and the decedent's interest — three property blocks per page. Schedule B wants a
comparable set of business columns. This is a real intake expansion, not a mapping job.

**Do not half-fill these.** A filed schedule with block and lot blank is worse than one the
attorney knows is theirs to complete. Either capture the fields or leave the schedule out.

---

## 5. Decisions needed before starting

1. **How far to take Track 1.** ~~Through 4.3 gets every cheap win~~ — **done (#189)**. The open
   choice is now 4.4 (a per-type detail group on `Bequest`, covering most real estates) and then
   4.5 (Schedules A and B, a real intake expansion). Stopping here is a defensible place to stop:
   every figure on the return is filed, and the two unmapped asset schedules are itemisation.
2. **Whether Track 2 is wanted at all**, given IT-Estate needs legal research before code, and
   L-9(A)/IT-EXT may be rare enough in practice to hand-fill.
3. **Whether Track 3 (IT-NR) is in the product at all.** Today a nonresident matter is refused
   cleanly, which is defensible and safe.
4. **Whether the workpaper HTML should follow.** It renders from the same `ITRFormData`, so
   anything added for the PDF can appear there too — but the two can also diverge deliberately,
   since one is a workpaper and one is a filed return.

---

## 6. Not in scope

- Changing any computed figure. The engine is gold-case verified against the State's own worked
  examples; this work is about presentation only. A mapping change must never alter a number.
- Removing the workpaper HTML or its "NOT FOR FILING" banner. It is the review surface; the PDF is
  the filing surface. Both stay.
- Flattening the filled PDF. Fields are deliberately left interactive so the attorney can correct
  a box before signing.
