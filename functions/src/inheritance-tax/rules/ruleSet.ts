import type { InheritanceTaxRules, ISODate } from '../types';

export interface RuleSet {
  /** Unique, sortable identifier — YYYY-MM-DD of first effective date. */
  id: string;
  effectiveFrom: ISODate;
  /** null = currently in effect. */
  effectiveTo: ISODate | null;
  /** Primary legal citation for this rule set. */
  citation: string;
  inheritanceTax: InheritanceTaxRules;
  /**
   * Filing deadline: calendar months from date of death (verified: 8).
   * Authority: N.J.S.A. 54:35-3 (interest trigger); N.J.A.C. 18:26-9.1 (filing obligation).
   * Note: N.J.S.A. 54:35-5 is the LIEN DURATION statute (15 years), not the deadline.
   * Extensions (filing only, not payment): +4 months via IT-EXT; +2 additional months;
   * beyond that only with Director approval for exceptional circumstances (N.J.A.C. 18:26-9.1(b)).
   * Armed Forces: 8-month period begins on official notification of death to next of kin (N.J.S.A. 54:35-3).
   * Weekend/holiday shift: N.J.A.C. 18:2-4.12 advances deadlines falling on Saturdays, Sundays,
   * or NJ public holidays (N.J.S.A. 36:1-1) to the next business day; chains are resolved.
   * Applied automatically by computeFilingDeadline() via the NJ holiday calendar (holidays.ts).
   */
  filingDeadlineMonths: number;
  /**
   * NJ Estate Tax: repealed for dates of death on/after 2018-01-01.
   * Authority: N.J.S.A. 54:38-1(a)(4); P.L. 2016, c. 57, § 7 (enacted Oct. 2016).
   * The inheritance tax (N.J.S.A. 54:33-1 et seq.) was NOT repealed.
   */
  njEstateTaxApplies: boolean;
  /**
   * NJ Estate Tax unified credit exemption (gross estate threshold below which no
   * estate tax is due). Only present when njEstateTaxApplies is true.
   *
   * VERIFIED against NJ Form O-10-C, "General Information — Inheritance and Estate Tax"
   * (nj.gov/treasury/taxation/pdf/other_forms/inheritance/o10c.pdf, retrieved 2026-07-28):
   * $675,000 for deaths after Dec. 31, 2001 but before Jan. 1, 2017; $2,000,000 for deaths on or
   * after Jan. 1, 2017 but before Jan. 1, 2018; and none thereafter — "There is no New Jersey
   * Estate Tax imposed on the estates of resident decedents dying on or after Jan. 1, 2018."
   *
   * The rate schedule itself lives in `engine/estate-tax.ts`, whose Simplified Method (Column A)
   * table is verified against the State's own Form IT-Estate. For 2017 deaths the computation is
   * circular (IRC §2058) and the engine returns no figure, directing the attorney to the State's
   * official calculator rather than fabricating a rate.
   */
  njEstateTaxExemption?: number;
}
