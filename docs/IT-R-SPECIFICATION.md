<!--
  Ported from adameliaslaw/elias-estate-suite (docs/IT-R-SPECIFICATION.md), which is where the
  engine in functions/src/inheritance-tax/ was built and verified. That repo is now an archive;
  this is the live copy.

  Paths in this document referring to `apps/inherit/src/...` map to `functions/src/inheritance-tax/...`
  here, with two exceptions: PDF rendering was not ported (this app renders PDF via jspdf and DOCX
  via docxtemplater), and the standalone HTTP server was replaced by the callables in
  functions/src/inheritance-tax-review.ts.
-->

# NJ IT-R Transfer Inheritance Tax — Engine Specification (Phase 2)

> **Canonical legal specification** for the NJ inheritance-tax computation engine and form
> generators. Written **before** the Phase 2 correctness fixes so each fix lands against a
> failing gold/regression test that encodes this spec. Cite this document (by section) from
> code comments and tests.
>
> **Primary sources** (retrieved 2026-07, HTTP 200 from nj.gov unless noted):
> - Form IT-R (12-24) booklet — `itrbk.pdf`
> - IT-R Instructions — `it-rinst.pdf` (the interest worked examples below are decoded verbatim from it)
> - Form IT-Estate — `itestate.pdf`
> - N.J.S.A. 54:33-1 et seq.; 54:34-2; 54:35-1/-3; 54:38-1
> - N.J.A.C. 18:26 (subch. 2, 3, 7, 9, 11); 18:2-4.12
> - N.J.S.A. 36:1-1 (legal holidays) — verified against Justia mirror of the current statute
>
> This is decision-support **workpaper** output. Every rendered form carries the Phase 0
> "WORKPAPER — NOT FOR FILING" banner. Nothing here authorizes filing without attorney review.

---

## 1. Scope: supported vs. unsupported estate structures

The engine must **refuse** (raise `UnsupportedMatterError` → HTTP 422 / non-zero CLI exit) any
matter it cannot model to the exact official figures, rather than silently produce a plausible-
but-wrong return. The following table is authoritative.

### 1.1 SUPPORTED
| Structure | Notes |
|---|---|
| Resident decedent, date of death ≥ 2002-01-01 | Rule set selected by date of death. |
| Bequests mapped to Schedules A, B, B-1…B-4, C | See §3. FMV at date of death. |
| Class A/C/D/E beneficiaries | Classified from `relationship` (N.J.S.A. 54:34-2). §4. |
| Estate-level deductions (N.J.A.C. 18:26-7) distributed **pro rata** across all classes | §5. Only pro-rata apportionment is modeled. |
| Qualified disclaimers reallocating a bequest to an alternate taker | Within the 9-month deadline. §7. |
| Contingent amount (Line 8) + compromise tax (Line 15) as **attorney-supplied** figures | Engine does not compute the compromise. §6. |
| Line 18 interest, incl. dated prior payments | NJ capitalization method. §6. |
| IT-EXT filing extension (+4 / +6 months, filing only) | §8. |
| NJ Estate Tax (deaths 2002–2016, Simplified Method) | §9. 2017 → directed to NJ calculator. |

### 1.2 UNSUPPORTED — the engine must REFUSE or explicitly not compute
| Structure | Required behavior |
|---|---|
| **Nonresident decedent** (`isNJResident === false`) | Refuse IT-R/L-9 (needs IT-NR / L-9 NR). Phase 0. |
| Date of death before 2002-01-01 | Reject at validation (no rule set). |
| **Deductions exceeding the gross estate** | Refuse (do **not** silently clamp net estate to 0). §5. |
| **Non-pro-rata apportionment**: specific devises bearing their own tax, residue-only burden, mortgage burden shifted to one taker, apportionment clauses altering who bears the tax across classes | Not modeled. The engine distributes deductions **pro rata only**; a matter that needs any other apportionment is out of scope and the attorney must compute by hand. Documented here so no code path fabricates a distribution. §5. |
| **Joint / POD / TOD survivorship, life insurance, future interests, trusts requiring valuation** as first-class asset types | Not modeled. Enterable only as an ordinary Schedule bequest at attorney-supplied FMV; the engine does not apply survivorship or actuarial rules. §3. |
| Contingent **tax** interest with its own award-triggered due date | Not folded into Line 18; attorney computes separately. §6.4. |
| 2017 NJ Estate Tax | Not computed (circular §2058); attorney directed to NJ's official calculator. §9. |

> **Rule of construction:** where a structure is UNSUPPORTED, the correct engine behavior is to
> *refuse* (throw) or *leave the figure for the attorney*, never to guess. A silent default that
> produces a self-consistent but legally wrong number is the single worst failure mode for this
> tool.

---

## 2. Rule-set selection & deadlines

- Date of death selects the rule set (`rules/index.ts`): 2002-01-01, 2017-01-01, 2018-01-01,
  2025-12-15. Dates < 2002-01-01 are rejected at validation.
- **Inheritance-tax deadline = 8 calendar months** after date of death (N.J.S.A. 54:35-3;
  N.J.A.C. 18:26-9.1). This is **both** the payment deadline and (absent IT-EXT) the filing
  deadline. Interest accrues on tax unpaid after this date.
- **NJ Estate-tax deadline = 9 months** (§9).
- Month arithmetic uses JS `setUTCMonth` overflow (e.g. Jan 31 + 8 mo → Oct 1).
- **Next-business-day shift** (N.J.A.C. 18:2-4.12): if the deadline falls on a Saturday, Sunday,
  or NJ legal holiday, advance to the next day that is none of those. Chains resolve
  (Sat → Sun → Mon-holiday → Tue). Saturdays are treated as non-business days
  (N.J.S.A. 36:1-1.1).

---

## 3. Schedules → Summary lines (Lines 1–7)

| Line | Label (verbatim IT-R 12-24) | Source |
|---|---|---|
| 1 | New Jersey Real Property (Schedule A) | `nj_real_property` |
| 2 | Closely Held Businesses (Schedule B) | `closely_held_business` |
| 3 | All Other Personal Property (Schedules B-1…B-4 Recap) | B-1 `bank_account`,`retirement_account`; B-2 `securities`; B-3 `bonds`; B-4 `virtual_currency`,`other_personal_property` |
| 4 | Transfers (Schedule C) | `transfer` |
| 5 | Gross Estate = Σ Lines 1–4 | computed |
| 6 | Deductions (Schedule D) | §5 |
| 7 | Net Estate = Line 5 − Line 6 | computed, **must be ≥ 0** (§5) |

Every schedule item and its beneficiary/transferee name, and every Line 1–7 total, is **frozen
in the approved computation snapshot** and the form renders **only** from that snapshot (§10,
FND-IMMUT). The live matter is never re-read at form-generation time.

---

## 4. Beneficiary classes (N.J.S.A. 54:34-2; N.J.A.C. 18:26-1.1)

- **Class A (exempt):** spouse/CU/DP, child (incl. ART-conceived, R.2025 d.152), stepchild,
  grand/great-grandchild, parent, grandparent, mutually-acknowledged child.
- **Class C** ($25,000 per-beneficiary exemption; 11/13/14/16% on the excess): sibling,
  child-in-law (of a biological/adopted child), child's civil-union partner.
- **Class D** (no exemption; **$499 de minimis floor**; 15/16%): niece/nephew, aunt/uncle,
  cousin, step-grandchild, step-sibling, step-parent, step-child-in-law,
  mutually-acknowledged-child-in-law, ex-spouse, friend, non-certified DP, non-charitable
  corporation, other.
- **Class E (exempt):** charities, religious/educational/medical/governmental.

### 4.1 Distribution & the Line-9 scale
Deductions apply at the estate level; the Line-9 balance is distributed **proportionally**:
`deductionScale = balanceOfEstate / grossEstate`, `scaledBequeathed = totalBequeathed × scale`.
Tax brackets apply to `scaledBequeathed` (N.J.A.C. 18:26-1.1 "clear market value").

### 4.2 Class C exemption — **cap at min(scaled, 25 000)** (FND-CLASSC-EXEMPT)
The recorded exemption is `min(scaledBequeathed, 25 000)`, **not** a flat 25 000. Otherwise a
scaled bequest below $25 000 records a $25 000 exemption, and the Line-12 aggregate
`Total Taxable Amount = Total Distribution − Total Exemption` understates the true taxable base
(and disagrees with the per-beneficiary Tax Due) whenever Class C mixes below- and above-
exemption beneficiaries. Taxable amount = `max(0, scaled − min(scaled, 25 000))`.

### 4.3 Class D de minimis
If `scaledBequeathed < 500`, no tax (floor, not a deduction). If ≥ 500, the full scaled amount
is taxable. Line-13 exemption column is $0.

---

## 5. Deductions & apportionment (N.J.A.C. 18:26-7) — FND-DISTRIB

- Deductions are summed and applied at the estate level; the post-deduction Line-9 balance is
  distributed **pro rata** across all classes (§4.1). This is the **only** apportionment the
  engine models.
- **Refuse when `Σ deductions > grossEstate`.** A net estate cannot be negative; silently
  clamping to 0 hides a data or apportionment error and is prohibited (FND-VALIDATION). The
  engine raises `UnsupportedMatterError`.
- Specific-devise tax burden, residue-only burden, mortgage-burden shifting, and apportionment
  clauses that move tax between classes are **UNSUPPORTED** (§1.2). The engine neither detects
  nor applies them; such a matter is out of scope.
- Attestations: `executor_commission` (R.2025 d.152, deaths ≥ 2025-12-15) requires
  `executorCommissionEligibility`; `transfer_taxes_other_states` requires
  `transferTaxEligibility` (N.J.A.C. 18:26-7.16). Enforced at validation.

---

## 6. Tax computation summary (Lines 15–22) and interest — FND-INTEREST / FND-CONTINGENT

| Line | Meaning |
|---|---|
| 15 | Compromise tax on the Line-8 contingent amount (attorney-supplied; **no interest accrues**). |
| 16 | Contingent tax (attorney-supplied). |
| 17 | Total Tax Due = Σ Lines 10–16. |
| 18 | Interest Due (§6.1). |
| 19 | Total Amount Due = Line 17 + Line 18. |
| 20 | Payments made prior to filing (Σ dated prior payments). |
| 21/22 | Balance due / refund. |

### 6.1 Interest — N.J.S.A. 54:35-3, 10% per annum, NJ capitalization method
Interest accrues at **10%/yr on the unpaid tax** from the 8-month deadline to the payment date.
The controlling method, **verbatim from the it-rinst.pdf worked examples**, is:

1. A payment **on or before** the 8-month due date reduces the tax principal before any interest
   accrues (no interest on it).
2. For each subsequent partial payment, in date order:
   a. Accrue interest on the current balance from the last cursor date to the payment date.
   b. **Add (capitalize) that accrued interest into the balance**, *then* subtract the payment.
   c. The remaining balance (which may include unpaid interest) accrues interest going forward.
3. Accrue interest on the final balance from the last cursor to the payment date.
4. **Line 18 = the sum of every period's accrued interest, floored to cents once at the end.**
   Full precision is carried between periods; the final cent is rounded **down, in the client's
   favor** (interest is a charge against the estate, so flooring never overstates what the client
   owes) — firm/owner direction. Do not round each sub-period to cents first.

This differs from *simple interest on a declining principal* (the pre-fix engine), which does
**not** capitalize accrued interest before applying a payment and therefore under-reports.

### 6.2 GOLD CASE — official it-rinst.pdf "Example 2" → **Line 18 = $558.71**
- Date of death **2023-09-18**; 8-month due date **2024-05-18**; return filed / final payment
  **2024-07-20**; **Tax Due $68,389.70**.
- Payment #1 **2024-05-12** $16,974.56 (before due date → no interest; principal → $51,415.14).
- Payment #2 **2024-06-12** $31,927.02.
- Payment #3 **2024-07-20** $20,046.83 (with the return).

Period 5/18→6/12 (25 days): $51,415.14 × 10% × 25/365 = **$352.16** (state worksheet prints
$352.15 using 3-decimal per-day rounding). Capitalize → 51,415.14 + interest − 31,927.02 =
**$19,840.27** balance. Period 6/12→7/20 (38 days): $19,840.27 × 10% × 38/365 = **$206.56**.

Carrying full precision and flooring once: 352.1585 + 206.5563 = 558.7148 → **$558.71** (Line 18).
The pre-fix engine yields ≈ **$555.05** (no capitalization). The gold case asserts **$558.71** (the
floored total here coincides with the state worksheet's published $558.71).

### 6.3 GOLD CASE — official "Example 1" → **Line 18 = $191.43** (client-favorable)
Tax $8,125.00, 86 days late, no prior payments: 8,125 × 10% × 86/365 = 191.4384. The state worksheet
rounds to $191.44; our engine **floors in the client's favor → $191.43**. The gold case asserts
**$191.43**.

### 6.4 Contingent tax is **not** in the Line-18 base (FND-CONTINGENT)
Per it-rinst.pdf, no interest accrues on contingent tax until eight months after death, and
contingent tax carries its **own** due date (within a set period after the award/settlement) that
the engine cannot know. Therefore Line-18 interest is computed on the **direct tax only**
(`totalTaxDue`), **excluding** `contingentTax`. Compromise tax (Line 15) is likewise excluded.
Interest on a contingent tax, if any, is left for the attorney to compute from the award date.

---

## 7. Disclaimers (N.J.A.C. 18:26-2.11; I.R.C. §2518) — FND-VALIDATION

A disclaimer reallocates the disclaimed bequests to a named alternate taker before class
distribution. For the reallocation to be honored as a **qualified disclaimer** for tax purposes
it must be executed within **9 months** of the date of death (I.R.C. §2518; N.J.A.C. 18:26-2.11).
The engine **rejects at validation** any `dateDisclaimed` later than
`dateOfDeath + 9 months` (a late disclaimer is a taxable transfer from the disclaimant, which
this engine does not model). It also rejects `dateDisclaimed < dateOfDeath` and the existing
cross-reference checks (disclaimant/alternate/bequest membership).

---

## 8. IT-EXT extension (N.J.A.C. 18:26-9.1(b))
Extends the **filing** deadline only: +4 months (first) or +6 months (both). The **payment**
deadline (the original 8 months) is never extended; interest still accrues from it.

---

## 9. NJ Estate Tax (N.J.S.A. 54:38-1)
- Deaths **2002–2016**: filing threshold $675,000; Simplified Method (Form IT-Estate Column A)
  computed from the verified §2011 table; 9-month deadline.
- Deaths **2017**: threshold $2,000,000; circular §2058 computation — **not fabricated**;
  attorney directed to NJ's official 2017 calculator (`taxDue = null`).
- Deaths **≥ 2018**: repealed (P.L. 2016, c. 57, §7); no estate tax.
- Nonresident decedents: no NJ Estate Tax return (returns `null`).

---

## 10. Immutability of approved output — FND-IMMUT

An **approved** IT-R must be internally consistent: the schedules, the Class A/C/D/E buckets, the
Line-10–14 distribution table, and the Class C/D worksheets must all agree with the frozen Line
totals the attorney signed. Therefore:

- At compute time the engine **enriches the computation snapshot** with everything the form
  needs: cover-page fields, personal representative, the per-beneficiary identity
  (name/address/relationship) used to split Class A spouse-vs-other and to build the worksheets,
  the Schedule A/B/B-1…B-4/C items, the Schedule D deduction items, and the disclaimer log.
- `buildITRFormData` renders **exclusively from the snapshot**. It never re-reads the live matter
  for any figure or schedule. Post-approval edits to the matter therefore **cannot** change an
  approved form (the correct behavior is to require a fresh computation + checkpoint).
- Legacy snapshots produced before enrichment fall back to the live matter (clearly marked), so
  already-approved historical checkpoints still render.

---

## 11. NJ legal holidays (N.J.S.A. 36:1-1) — FND-HOLIDAYS

The deadline shift (§2) uses the NJ **state-office** holiday calendar. Verified list:

| Holiday | Rule |
|---|---|
| New Year's Day | Jan 1 (Sat→Fri, Sun→Mon) |
| Martin Luther King Jr. Day | 3rd Mon Jan |
| **(Lincoln's Birthday, Feb 12 — EXCLUDED)** | Legal holiday generally but **not for conducting State-government business**; a tax filing deadline is State business, so Feb 12 does **not** shift it. |
| Washington's Birthday / Presidents' Day | 3rd Mon Feb |
| **Good Friday** *(added)* | Friday before Easter Sunday (Gregorian computus). |
| Memorial Day | last Mon May |
| **Juneteenth** | **June 19** for years ≥ 2022 (P.L. 2021, c. 392), observed on the fixed calendar date with the standard weekend shift (Sat → preceding Fri, Sun → following Mon) — firm/owner direction. |
| Independence Day | Jul 4 (Sat→Fri, Sun→Mon) |
| Labor Day | 1st Mon Sep |
| Columbus Day | 2nd Mon Oct |
| Veterans Day | Nov 11 (Sat→Fri, Sun→Mon) |
| **Election Day** *(added)* | Day of the general election = first Tuesday **after** the first Monday in November (N.J.S.A. 19:1-1), every year. |
| Thanksgiving | 4th Thu Nov |
| Christmas | Dec 25 (Sat→Fri, Sun→Mon) |

---

## 12. `@elias/docgen` field logic — FND-DOCGEN

The shared DOCX renderer must satisfy all of the following (regression-tested in
`packages/docgen/test/render.test.ts`):

1. **Dotted paths render.** `{{client.name}}` with `{client:{name:'Ada'}}` outputs "Ada".
   docxtemplater's default parser resolves a tag as a single scope key; a dotted-path parser is
   installed so nested lookups (and loop-scope fallthrough) resolve, with no external dependency.
2. **Header/footer fields are inspected.** Placeholders in `word/header*.xml` / `word/footer*.xml`
   are extracted and reconciled, so a field missing from a header is caught by the missing-field
   guard instead of silently rendering blank.
3. **Boolean-section root-scope fields are not falsely rejected.** For `{{#flag}}{{x}}{{/flag}}`
   with `{flag:true, x:'v'}`, `x` resolves against the root scope; the pre-check must treat a
   truthy non-array section as pass-through to the parent scope (not report `flag.x` missing).
4. **Extraction failure fails closed.** The missing-field guard must not be silently disabled by a
   `catch { fields = [] }`; a template whose placeholders cannot be extracted raises
   `DocgenTemplateError` rather than rendering with no guard.
