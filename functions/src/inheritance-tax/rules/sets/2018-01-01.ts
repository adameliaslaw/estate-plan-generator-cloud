import type { RuleSet } from '../ruleSet';

/**
 * Rule set for dates of death: 2018-01-01 – 2025-12-14.
 *
 * NJ Estate Tax repealed for deaths on/after 2018-01-01 per N.J.S.A. 54:38-1(a)(4);
 * P.L. 2016, c. 57, § 7 (enacted Oct. 2016). Note: prior code cited P.L. 2017, c. 323 —
 * the correct authority is P.L. 2016, c. 57, § 7.
 * NJ Transfer Inheritance Tax continues to apply (N.J.S.A. 54:33-1 et seq.).
 *
 * Class C rates verified against N.J.A.C. 18:26-2.6 (Cornell LII, adopted 50 N.J.R. 1624(a),
 * effective 7/16/2018). Class D rates verified against N.J.A.C. 18:26-2.7 (same source).
 * Intermediate amendment check (Jun 2026): Cornell LII "Compare" tab for both 18:26-2.6 and
 * 18:26-2.7 shows "No prior version found" — a single adoption annotation (50 N.J.R. 1624(a))
 * with no subsequent "Amended by" citations. Rates and thresholds are confirmed unchanged on
 * Cornell LII through its most recent quarterly update. LII updates quarterly and the Dec 2025
 * readoption may not yet be reflected; however, R.2025 d.152 confirmed no changes to
 * Subchapters 2, 3, or 4 (see 2025-12-15.ts).
 */
export const ruleSet20180101: RuleSet = {
  id: '2018-01-01',
  effectiveFrom: '2018-01-01',
  effectiveTo: '2025-12-14',
  citation:
    'N.J.S.A. 54:33-1 et seq.; N.J.S.A. 54:34-2; N.J.A.C. 18:26-2.6, 18:26-2.7 ' +
    '(50 N.J.R. 1624(a), eff. 7/16/2018); N.J.S.A. 54:38-1(a)(4) (P.L. 2016, c. 57, § 7); ' +
    'IT-R Instructions (nj.gov/treasury/taxation/pdf/other_forms/inheritance/itrins.pdf)',
  njEstateTaxApplies: false,
  // Verified: 8 calendar months per N.J.S.A. 54:35-3 and N.J.A.C. 18:26-9.1.
  // Note: N.J.S.A. 54:35-5 is the lien duration statute (15 years) — NOT the filing deadline.
  // Extensions of 4 + 2 months available for FILING only via Form IT-EXT (N.J.A.C. 18:26-9.1(b)).
  // Tax payment is NOT extended — still due within the original 8 months.
  // Weekend/holiday shift: N.J.A.C. 18:2-4.12 advances deadlines falling on Saturdays, Sundays,
  // or NJ public holidays (N.J.S.A. 36:1-1) to the next business day; chains are resolved.
  // Applied automatically by computeFilingDeadline() via the NJ holiday calendar (holidays.ts).
  filingDeadlineMonths: 8,
  inheritanceTax: {
    classA: { exempt: true },
    classE: { exempt: true },
    classC: {
      exempt: false,
      // Verified: $25,000 per beneficiary. Source: IT-R Instructions "Class C Beneficiary Worksheet".
      exemptionPerBeneficiary: 25_000,
      // Brackets are expressed in terms of TAXABLE AMOUNT (i.e., bequest minus $25,000 exemption).
      // Verified against IT-R Instructions "How to Calculate Class C Tax" worksheet and examples.
      // Gross bequest breakpoints: $25K–$1.1M → taxable $0–$1,075,000 @ 11%
      //                            $1.1M–$1.4M → taxable $1,075,000–$1,375,000 @ 13%
      //                            $1.4M–$1.7M → taxable $1,375,000–$1,675,000 @ 14%
      //                            > $1.7M     → taxable > $1,675,000 @ 16%
      brackets: [
        { from: 0,           to: 1_075_000,  rate: 0.11 },
        { from: 1_075_000,   to: 1_375_000,  rate: 0.13 },
        { from: 1_375_000,   to: 1_675_000,  rate: 0.14 },
        { from: 1_675_000,   to: null,        rate: 0.16 },
      ],
    },
    classD: {
      exempt: false,
      // Verified: if individual bequest < $500, no tax; if ≥ $500, full amount taxable.
      // Source: IT-R Instructions "How to Calculate Class D Tax" footnote.
      deMinimusThreshold: 499,
      // Brackets expressed in terms of total bequeathed (Class D has no exemption).
      // Verified against IT-R Instructions "Class D Beneficiary Worksheet".
      brackets: [
        { from: 0,       to: 700_000,  rate: 0.15 },
        { from: 700_000, to: null,     rate: 0.16 },
      ],
    },
  },
};
