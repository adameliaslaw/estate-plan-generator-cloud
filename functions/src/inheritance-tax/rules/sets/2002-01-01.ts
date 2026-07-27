import type { RuleSet } from '../ruleSet';

/**
 * Rule set for dates of death: 2002-01-01 – 2016-12-31.
 *
 * This is the earliest supported rule set. Dates before 2002-01-01 are not
 * supported — getRuleSet() will throw.
 *
 * NJ ESTATE TAX APPLIES for this period.
 * Authority: N.J.S.A. 54:38-1 (pre-P.L. 2016, c. 57 version).
 * Filing threshold: $675,000 (gross estate + adjusted taxable gifts).
 * The engine computes the estate tax via the Simplified Method (Column A) — see
 * computeNJEstateTax() in src/engine/estate-tax.ts. The graduated rate table is VERIFIED
 * from the primary source: the official Form IT-Estate Simplified Method tax table
 * (nj.gov/treasury/taxation/pdf/other_forms/inheritance/itestate.pdf, retrieved 2026-06).
 *
 * NJ INHERITANCE TAX (N.J.S.A. 54:33-1 et seq.) also applies.
 * Class C/D rates confirmed IDENTICAL to the 2018 rule set.
 * Source: Research confirms no rate change between 2002 and 2018; 50 N.J.R. 1624(a)
 * (7/16/2018) was a recodification/procedural filing, not a rate change.
 * The rate schedule in effect since at least 2002 is codified at N.J.A.C. 18:26-2.6
 * (Class C) and N.J.A.C. 18:26-2.7 (Class D).
 *
 * Filing deadline: 8 months per N.J.S.A. 54:35-3 (unchanged throughout).
 */
export const ruleSet20020101: RuleSet = {
  id: '2002-01-01',
  effectiveFrom: '2002-01-01',
  effectiveTo: '2016-12-31',
  citation:
    'N.J.S.A. 54:33-1 et seq.; N.J.S.A. 54:34-2; N.J.A.C. 18:26-2.6, 18:26-2.7; ' +
    'N.J.S.A. 54:38-1 (pre-P.L. 2016, c. 57); ' +
    'IT-R Instructions (nj.gov/treasury/taxation/pdf/other_forms/inheritance/itrins.pdf)',
  njEstateTaxApplies: true,
  // $675,000 filing threshold — confirmed from the NJ Form IT-Estate instructions
  // (a return is required when gross estate + adjusted taxable gifts exceeds $675,000).
  njEstateTaxExemption: 675_000,
  filingDeadlineMonths: 8,
  inheritanceTax: {
    classA: { exempt: true },
    classE: { exempt: true },
    classC: {
      exempt: false,
      exemptionPerBeneficiary: 25_000,
      brackets: [
        { from: 0,           to: 1_075_000,  rate: 0.11 },
        { from: 1_075_000,   to: 1_375_000,  rate: 0.13 },
        { from: 1_375_000,   to: 1_675_000,  rate: 0.14 },
        { from: 1_675_000,   to: null,        rate: 0.16 },
      ],
    },
    classD: {
      exempt: false,
      deMinimusThreshold: 499,
      brackets: [
        { from: 0,       to: 700_000,  rate: 0.15 },
        { from: 700_000, to: null,     rate: 0.16 },
      ],
    },
  },
};
