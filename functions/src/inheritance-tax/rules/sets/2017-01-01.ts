import type { RuleSet } from '../ruleSet';

/**
 * Rule set for dates of death: 2017-01-01 – 2017-12-31.
 *
 * NJ ESTATE TAX APPLIES for this period, with an increased $2,000,000 exemption.
 * Authority: P.L. 2016, c. 57, § 7 (enacted Oct. 14, 2016) raised the NJ Estate
 * Tax exemption from $675,000 to $2,000,000 effective for deaths on or after
 * January 1, 2017, and fully repealed the estate tax for deaths on or after
 * January 1, 2018. See N.J.S.A. 54:38-1(a)(4).
 * For 2017 deaths the NJ Estate Tax is a circular computation (IRC §2058 State Death Tax
 * Deduction applied to the taxable estate); the State requires its official 2017 Estate
 * Tax Calculator. computeNJEstateTax() does not fabricate a rate for 2017 — it reports the
 * taxable estate and directs the attorney to NJ's calculator. Primary source:
 * nj.gov/treasury/taxation/inheritance-estate/tax-rates.shtml.
 *
 * NJ INHERITANCE TAX (N.J.S.A. 54:33-1 et seq.) also applies.
 * Class C/D rates confirmed IDENTICAL to the 2018 rule set — P.L. 2016, c. 57
 * made no change to the inheritance tax rates.
 *
 * Filing deadline: 8 months per N.J.S.A. 54:35-3 (unchanged).
 */
export const ruleSet20170101: RuleSet = {
  id: '2017-01-01',
  effectiveFrom: '2017-01-01',
  effectiveTo: '2017-12-31',
  citation:
    'N.J.S.A. 54:33-1 et seq.; N.J.S.A. 54:34-2; N.J.A.C. 18:26-2.6, 18:26-2.7; ' +
    'N.J.S.A. 54:38-1(a)(4); P.L. 2016, c. 57, § 7 (NJ Estate Tax $2M exemption, eff. 2017-01-01); ' +
    'IT-R Instructions (nj.gov/treasury/taxation/pdf/other_forms/inheritance/itrins.pdf)',
  njEstateTaxApplies: true,
  // Confirmed: P.L. 2016, c. 57, § 7 raised the threshold to $2,000,000 for deaths on/after
  // 2017-01-01. The 2017 tax uses NJ's official §2058 circular calculator (see header).
  njEstateTaxExemption: 2_000_000,
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
