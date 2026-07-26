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
   * VERIFY: rate tables and phase-out schedule not yet confirmed from primary source —
   * attorney must compute NJ Estate Tax separately using Form IT-Estate.
   */
  njEstateTaxExemption?: number;
}
