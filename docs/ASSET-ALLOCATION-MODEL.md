# Assets and allocations — scope for a fresh session

Decided 2026-07-28 by Adam, after a browser pass surfaced it. The model changes from *bequests
nested under beneficiaries* to *assets held by the estate, allocated to beneficiaries*.

Read [IT-R-SPECIFICATION.md](./IT-R-SPECIFICATION.md) first — it is the legal spec and the
authority for every figure. This document is only about the shape of the input.

---

## 1. Why — and why the obvious cheaper fix was rejected

Today a `Bequest` lives inside a `Beneficiary`. An asset shared between two people is therefore
entered **twice**, once under each, at each person's share.

The totals come out right. Three things do not.

**(a) Every asset schedule prints the same asset twice.** A $500,000 house split two ways, run
through the real engine:

```
gross estate    : 500000   ✓
Line 1 (realty) : 500000   ✓
Schedule A rows : 2          ← same address, same lot 4.02, same block 117,
                               each showing the decedent's interest as 250000
```

A bank account behaves identically — account …4821 printed twice at $40,000 each on Schedule B-1.
It will do this on **A, B, B-1, B-2, B-3 and C**. A per-schedule "group the rows" patch would have
to be written six times, each with its own notion of asset identity. That was the rejected fix.

**(b) It contradicts the State's instructions, on the schedule that generates the tax waiver.**
Schedule A is one row per property, and its columns describe the *decedent's* ownership, not the
beneficiaries':

> *Column C – Full Market Value: … of the **entire property***
> *Column D – Value of Decedent's Interest: … **the value of the decedent's interest only**. If the
> decedent owned 100% of the interest, the amount will be the same as the amount in column C.*
> *The information reported on this schedule **goes directly onto the tax waiver** that is required
> to be filed with the County Clerk.*

Two rows at $250,000 assert the decedent held two separate half-interests in one house.

**(c) Nothing checks that the shares sum to the asset's real value.** There is no asset, so there
is nothing to check against. Enter $250,000 and $250,000 for a house actually worth $600,000 and
the return is quietly $100,000 light — no error, no warning. This is the failure class the spec
calls the worst this tool has, and it is **structural**: an allocation model makes it impossible,
because the value is entered once and allocated out of.

A 1/3 : 2/3 split makes the point plainly — today the attorney hand-computes $166,666.67 and
$333,333.33 and hopes they sum.

**The form's own structure agrees.** Schedules A–C are *asset* schedules; Schedule E is the
*beneficiary* schedule. The State separates them. The current model conflates them, which is why
the mismatch keeps surfacing in different places.

---

## 2. The hard constraint — do not change the engine

`computeEstate` must keep taking the shape it takes today.

The tax is per-beneficiary (the rate depends on the recipient), so the engine needs per-beneficiary
amounts. Those can be **derived** from allocations at the boundary rather than entered. Derive
them; do not re-plumb the engine.

The reason is not conservatism. The 25 gold cases are the only proof the figures are right — they
reproduce the State's own worked examples to the cent ($558.71 / $191.43 / Class C $8,250). If the
engine's input shape changes, that proof weakens at exactly the moment everything else is moving.
**Gold cases must not be edited during this work.** If one needs editing, stop: the derivation is
wrong, not the case.

---

## 3. Target shape

```
Matter
  assets: Asset[]                      // the estate's property, entered once
    id, type (BequestType), description, fairMarketValue
    realPropertyDetails? / businessDetails? / accountDetails? / …   (unchanged, moved here)
    allocations: Allocation[]          // SPECIFIC gifts only; may be absent
      beneficiaryId + fraction         // the fraction is stored, the amount derived (§7)
  residuary: ResiduaryShare[]          // beneficiaryId + fraction, summing to 1
  beneficiaries: Beneficiary[]         // identity only — bequests empty
```

- **One asset, one schedule row.** The six duplication bugs die here, not in six patches.
- **Allocations must not EXCEED the asset's value**, enforced in the Zod schema; the remainder
  falls into residue. An earlier draft said "must sum to" — that is wrong and would reject every
  ordinary will. See the residue scope in HOMEWORK.md.
- `fairMarketValue` on the asset is the **decedent's interest** — the figure that feeds Line 1 and
  Schedule A column D. `realPropertyDetails.fullMarketValue` remains the whole property (column C).
  Keep those distinct; conflating them is how column C and D end up equal on a fractional interest.

### Where the code lands

| Concern | File | Note |
|---|---|---|
| Schedule rows are born | `engine/compute.ts` → `collectScheduleItems`, called by `buildFormSnapshot` (~L326/386) | **The single place the duplication originates.** One row per asset here fixes all six schedules at once. |
| Tax math reads bequests | `engine/compute.ts` L75, L296, L424; `engine/estate-tax.ts` L94 | Feed these the DERIVED per-beneficiary shape. Do not rewrite them. |
| Boundary validation | `validation/matter.ts` | `.strict()` everywhere (FND-STRICT). New fields must be declared or the save is rejected. |
| Frozen snapshot | `buildFormSnapshot` → `computationSnapshot.formSnapshot` | Forms render only from here (FND-IMMUT, spec §10). Anything new must arrive through it, never by re-reading the live matter. |
| Intake | `src/pages/admin/InheritanceTaxPage.tsx`, `components/inheritance-tax/BequestDetailFields.tsx` | Inventory first, allocate second. |

---

## 4. The three PRs, in order

**PR 1 — model and derivation. ✅ BUILT 2026-07-28.** `assets` + `allocations` + `residuary` on the
matter, declared in the Zod schema with the `≤` sum-check and residue's rules;
`functions/src/inheritance-tax/allocations.ts` holds `deriveEngineMatter` (allocation shape → the
shape the engine takes today) and `normalizeMatterToAssets` (legacy nested → allocation shape),
called at the two engine boundaries. Engine untouched, gold cases untouched and green.
*Done when — met:* `tests/unit/inheritance-tax-allocations.test.ts` runs the same estate through
both shapes and asserts every figure matches, and round-trips a legacy matter asserting the whole
computation — frozen snapshot included — is identical.

**PR 2 — schedules render from assets.** `collectScheduleItems` emits one row per asset with its
allocations. This is where the six duplication bugs die.
*Done when:* the split house produces **one** Schedule A row at $500,000, the split account **one**
B-1 row, and the PDF assertions read those values back out of the produced file.

**PR 3 — intake.** Assets entered once, then allocated; a share picker that does the arithmetic
(fraction, percent or amount) and shows the unallocated remainder.
*Done when:* a 1/3 : 2/3 split is enterable without the attorney computing anything, and an
under-allocated asset cannot be saved.

Not one PR. Each is independently shippable and independently revertible.

---

## 5. Migration — existing matters are in the nested shape

There are saved matters in production. A nested `Bequest` maps cleanly to *one asset wholly
allocated to one beneficiary*, so the read path can normalise on load and nothing needs a backfill
job. Two things to get right:

- **The client must not send a field the deployed server does not know.** That ordering broke
  saving once already — ship the server's schema before the UI sends the new shape.
- **The reopen path already keeps unknown fields.** `getInheritanceMatter` returns the whole record
  and the page edits only known keys, so a matter can round-trip through an older UI without losing
  data. Preserve that property; it is what makes a staged rollout safe.

---

## 6. Not in scope

- **Changing any computed figure.** This is a change to how the estate is *described*, not taxed.
  Every gold case must be untouched and green at every step.
- **The pro-rata deduction rule.** Deductions stay estate-level and pro rata (spec §5).
- **FND-IMMUT.** Forms still render only from an approved, frozen snapshot.
- **The Schedule A grouping patch** discussed on 2026-07-28 and deliberately dropped — it would be
  throwaway work covering one sixth of the problem.

---

## 7. Answers, both closed

**Fraction or amount — ANSWERED 2026-07-28: store the fraction, derive the amount.** A re-appraised
house keeps its 1/3 : 2/3 split; the schedules print the derived figure. Show both in the UI.

**Residue — SCOPED 2026-07-28, BUILT the same day in PR 1. The scope and what it became live in
HOMEWORK.md under "▶ THE ASSET/ALLOCATION MODEL", deliberately not duplicated here** so the two
cannot drift. Build to that section, not to this paragraph.

The three things it settles, so you know whether you need to open it: the residuary pool is
computed (Σ assets − Σ specific allocations), never entered; the §3 sum-check above is a `≤` and
not an `=`; and `perStirpes` is **not** resolved by the engine, because a substitute taker can be a
different tax class — the schema rejects the field outright rather than accepting and ignoring it.
