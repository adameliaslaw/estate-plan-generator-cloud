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
| IT-PMT payment voucher | 3 | ⬜ unmapped |
| Schedule A — NJ real property | 4 | ⬜ needs intake |
| Schedule B — closely held business | 5 | ⬜ needs intake |
| Schedule B-1 — financial institution accounts | 6 | ⬜ needs intake |
| Schedule B-2 — stocks / co-ops | 7 | ⬜ needs intake |
| Schedule B-3 — municipal and corporate bonds | 8 | ⬜ needs intake |
| Schedule B-4 — all other property | 9 | ✅ filled (18 rows) |
| Schedules B1–B4 Recap | 10 | ⬜ **free win** — see 4.1 |
| Schedule C — transfers | 11–12 | ⬜ needs intake |
| Schedule D — deductions | 13–14 | ⬜ **mostly mappable** — see 4.2 |
| Schedule E — beneficiaries | 15 | ✅ filled (9 rows) |

Every total the unmapped schedules feed **is already on the Summary Page**, so the return's
arithmetic is complete. What is missing is the itemisation behind those totals.

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

### Track 2 — the three orphaned forms
`buildITEXTFormData`, `buildITEstateFormData`, `buildL9AFormData` and their HTML renderers are
exported from `functions/src/inheritance-tax/forms/index.ts` **and called by nothing** — no
callable, no UI. They came across in the port and have been inert since. Each needs a callable, a
UI entry point, and optionally a filled official PDF (each is a separate State form, so each needs
its own blank and its own inventory).

⚠️ **IT-Estate carries a legal gap, not just a wiring gap.** The engine does not compute NJ Estate
Tax — `ITRFormData` says so outright, and the rule sets carry `VERIFY: rate tables not confirmed
from primary source`. Wiring the form up without doing that research would produce a form with no
verified figures behind it. Treat the research as the first task, not the code.

### Track 3 — IT-NR (nonresident)
Not modelled at all. As of #187 a nonresident matter is refused at `computeEstate` rather than
quietly returning a resident-basis figure. Building it means modelling NJ-situs property
(N.J.A.C. 18:26-2.15 — NJ real and tangible personal property only), which is an engine change
with its own gold cases, plus a different official form. **Largest of the three tracks, and the
only one that changes how tax is computed.** Do not start it without deciding it is wanted.

---

## 4. Track 1, in the order I would do it

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

1. **How far to take Track 1.** Through 4.3 gets every cheap win and leaves the two expensive
   schedules alone. Through 4.4 covers most real estates. 4.5 is the completionist option.
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
