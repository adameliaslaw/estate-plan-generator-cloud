import type { Matter, NJEstateTaxComputation } from '../types';
import type { RuleSet } from '../rules';
import { computeFilingDeadline } from './deadline';
import { fromCents, roundCents, toCents } from '../money';

/**
 * NJ Estate Tax — Simplified Method (Form IT-Estate, Column A) tax table.
 *
 * VERIFIED from the primary source: the official NJ Form IT-Estate, "Worksheet For
 * New Jersey Simplified Form — Column A — Line 10(a)" tax table
 * (nj.gov/treasury/taxation/pdf/other_forms/inheritance/itestate.pdf, retrieved 2026-06).
 * The table input is the "adjusted taxable estate" = taxable estate − $60,000.
 *
 * The schedule is the IRC §2011 state death tax credit (as in effect 2001-12-31) with a
 * New Jersey phase-in: $0 below $615,000, a 37% bridge from $615,000 to $667,175, and
 * thereafter the §2011 graduated rates (4.8%–16%). Cross-checked internally — at
 * $667,175 the bridge reaches $19,304 (= $18,000 + 4.8% × $27,175 under §2011).
 *
 * Each entry: tax = base + rate × (adjustedTaxableEstate − atLeast) while the value falls
 * in [atLeast, next.atLeast).
 */
interface EstateTaxBracket {
  atLeast: number;
  base: number;
  rate: number;
}

const SIMPLIFIED_METHOD_TABLE: readonly EstateTaxBracket[] = [
  { atLeast: 0, base: 0, rate: 0 },
  { atLeast: 615_000, base: 0, rate: 0.370 },
  { atLeast: 667_175, base: 19_304, rate: 0.048 },
  { atLeast: 840_000, base: 27_600, rate: 0.056 },
  { atLeast: 1_040_000, base: 38_800, rate: 0.064 },
  { atLeast: 1_540_000, base: 70_800, rate: 0.072 },
  { atLeast: 2_040_000, base: 106_800, rate: 0.080 },
  { atLeast: 2_540_000, base: 146_800, rate: 0.088 },
  { atLeast: 3_040_000, base: 190_800, rate: 0.096 },
  { atLeast: 3_540_000, base: 238_800, rate: 0.104 },
  { atLeast: 4_040_000, base: 290_800, rate: 0.112 },
  { atLeast: 5_040_000, base: 402_800, rate: 0.120 },
  { atLeast: 6_040_000, base: 522_800, rate: 0.128 },
  { atLeast: 7_040_000, base: 650_800, rate: 0.136 },
  { atLeast: 8_040_000, base: 786_800, rate: 0.144 },
  { atLeast: 9_040_000, base: 930_800, rate: 0.152 },
  { atLeast: 10_040_000, base: 1_082_800, rate: 0.160 },
];

const ESTATE_TAX_DEADLINE_MONTHS = 9; // N.J. Estate Tax: 9 months (vs. 8 for inheritance tax).
const SIMPLIFIED_EXEMPTION_REDUCTION = 60_000; // Worksheet line 2.

/** Computes the Simplified Method tax on an adjusted taxable estate (FND-MONEY: integer cents). */
function simplifiedMethodTax(adjustedTaxableEstate: number): number {
  let bracket = SIMPLIFIED_METHOD_TABLE[0]!;
  for (const b of SIMPLIFIED_METHOD_TABLE) {
    if (adjustedTaxableEstate >= b.atLeast) bracket = b;
    else break;
  }
  const adjustedCents = toCents(adjustedTaxableEstate);
  const taxCents = toCents(bracket.base) + roundCents(bracket.rate * (adjustedCents - toCents(bracket.atLeast)));
  return fromCents(taxCents);
}

const SIMPLIFIED_CITATION =
  'N.J.S.A. 54:38-1; Form IT-Estate Simplified Method (Column A) tax table ' +
  '(nj.gov/treasury/taxation/pdf/other_forms/inheritance/itestate.pdf)';

const CALCULATOR_2017_CITATION =
  'N.J.S.A. 54:38-1(a)(4); P.L. 2016, c. 57; NJ 2017 Estate Tax Calculator ' +
  '(state.nj.us/treasury/taxation/documents/excel/inheritance/EstateTaxCalculator.xlsx)';

/**
 * Computes the NJ Estate Tax for a matter, when it applies (pre-2018 death).
 *
 * Returns null when the rule set has no estate tax (deaths on/after 2018-01-01).
 *
 * 2002-2016: the Simplified Method (Column A) is computed from the verified table.
 * 2017: the State requires its official §2058 circular calculator; taxDue is left null
 * and the attorney is directed there — no rate schedule is fabricated for this regime.
 *
 * The taxable estate used here is the IT-R net estate (gross − deductions). Adjusted
 * taxable gifts and Schedule E-1/E-2 adjustments are not modeled; an attorney completing
 * Form IT-Estate must add them where applicable.
 */
export function computeNJEstateTax(matter: Matter, ruleSet: RuleSet): NJEstateTaxComputation | null {
  if (!ruleSet.njEstateTaxApplies) return null;
  // The NJ Estate Tax applies only to RESIDENT decedents — Form IT-Estate is the
  // "Resident Decedent Estate Tax Return," and the State requires no estate-tax return for
  // nonresident decedents (nj.gov/treasury/taxation/inheritance-estate/inheritance-taxfilerequirements).
  if (matter.decedent.isNJResident === false) return null;

  // FND-MONEY: aggregate in integer cents (matches computeEstate) so the taxable estate
  // never drifts; derive dollars at the end.
  const grossEstateCents = matter.beneficiaries
    .flatMap((b) => b.bequests)
    .reduce((sum, b) => sum + toCents(b.fairMarketValue), 0);
  const totalDeductionsCents = matter.deductions.reduce((sum, d) => sum + toCents(d.amount), 0);
  const taxableEstate = fromCents(Math.max(0, grossEstateCents - totalDeductionsCents));
  const grossEstate = fromCents(grossEstateCents);

  const exemptionThreshold = ruleSet.njEstateTaxExemption ?? 0;
  const filingRequired = grossEstate > exemptionThreshold;
  const filingDeadline = computeFilingDeadline(matter.decedent.dateOfDeath, ESTATE_TAX_DEADLINE_MONTHS);

  // 2017 regime: circular §2058 calculation — directed to NJ's official calculator.
  if (exemptionThreshold >= 2_000_000) {
    return {
      regime: '2017',
      method: 'requires_official_2017_calculator',
      exemptionThreshold,
      taxableEstate,
      filingRequired,
      filingDeadline,
      taxDue: null,
      citation: CALCULATOR_2017_CITATION,
      note:
        'For 2017 deaths the NJ Estate Tax is a circular computation (IRC §2058 State ' +
        'Death Tax Deduction applied to the taxable estate). The State requires its ' +
        'official 2017 Estate Tax Calculator; this tool does not fabricate a rate and ' +
        'leaves the tax for the attorney to compute on Form IT-Estate 2017.',
    };
  }

  // 2002-2016 regime: Simplified Method (Column A).
  const adjustedTaxableEstate = Math.max(0, taxableEstate - SIMPLIFIED_EXEMPTION_REDUCTION);
  const taxDue = simplifiedMethodTax(adjustedTaxableEstate);
  return {
    regime: '2002-2016',
    method: 'simplified_column_a',
    exemptionThreshold,
    taxableEstate,
    filingRequired,
    filingDeadline,
    taxDue,
    exemptionAmount: SIMPLIFIED_EXEMPTION_REDUCTION,
    adjustedTaxableEstate,
    citation: SIMPLIFIED_CITATION,
    note:
      'Computed with the Form IT-Estate Simplified Method (Column A). The Form 706 ' +
      'method may yield a different result for estates required to file a federal 706; ' +
      'the attorney must use whichever method the return requires. Taxable estate is the ' +
      'IT-R net estate — add adjusted taxable gifts and Schedule E-1/E-2 items if applicable.',
  };
}
