import type { RuleSet } from '../ruleSet';

/**
 * Rule set for dates of death on/after 2025-12-15.
 *
 * R.2025 d.152 (57 N.J.R. 2873(a)): readoption filed November 17, 2025; published
 * December 15, 2025. Effective dates per register text: "November 17, 2025, Readoption;
 * December 15, 2025, Amendments and Repeals." Consistent with N.J.A.C. 1:30-6.4(g)(2).
 * effectiveFrom boundary '2025-12-15' is CONFIRMED CORRECT for all substantive changes.
 * Deaths November 17–December 14, 2025 fall under the 2018-01-01 rule set (unchanged
 * rates apply during that window).
 *
 * NJ Transfer Inheritance Tax continues to apply (N.J.S.A. 54:33-1 et seq.).
 *
 * ALL VERIFY STUBS RESOLVED — primary source text of 57 N.J.R. 2873(a) obtained
 * and reviewed June 2026. Findings below are confirmed from the register's full
 * "adopted amendments" text. No open items remain for this rule set.
 *
 * CONFIRMED ADOPTED REPEALS (57 N.J.R. 2873(a); both now appear as "(Reserved)"):
 *   18:26-6.3: Reserved — was a subsection of Subchapter 6 (Exemptions); subject
 *              unknown (had already been a placeholder or minor provision).
 *   18:26-11.7: Reserved — was the 10-business-day waiting period for waiver
 *               issuance, repealed as part of the waiver-scope expansion below.
 *
 * CONFIRMED SUBSTANTIVE AMENDMENTS (eff. December 15, 2025):
 *
 * 1. CLASS A DEFINITION EXPANDED — N.J.A.C. 18:26-1.1 ("Class A transferee" definition):
 *    Register text: "A Class A transferee also includes a non-biological child of a
 *    decedent where the child was the offspring of a biological parent partner conceived
 *    by the assisted reproduction of that parent during the term of a marriage, civil
 *    union, or domestic partnership with the decedent, unless it is otherwise shown that
 *    the non-biological parent had not intended to be the parent of the child."
 *    (No code change — 'child' was and remains Class A.)
 *
 * 2. FINANCIAL INSTITUTION DEFINITION ADDED — N.J.A.C. 18:26-1.1 (new definition):
 *    Register text: "'Financial institution' means any entity that holds funds or assets
 *    to the credit of a person or persons. This includes, but is not limited to, banks,
 *    trust companies, savings institutions, building and loans, savings and loan
 *    associations, brokerage houses, financial advisors, credit unions, and corporations."
 *    (No code change — supports the waiver-scope expansion in item 3.)
 *
 * 3. WAIVER SCOPE EXPANDED — N.J.A.C. 18:26-11.1(a)(1):
 *    Register text: "including any financial institution organized pursuant to the laws
 *    of New Jersey or operating in this State" (replaces prior "banking institution"
 *    scope). 18:26-11.7 (10-business-day waiting period) repealed simultaneously.
 *    (No code change — procedural / Division administration.)
 *
 * 4. EXECUTOR COMMISSION RESTRICTED — N.J.A.C. 18:26-7.10(d):
 *    Register text: "The real estate must be sold by the representative on behalf of the
 *    estate and not by or on behalf of the beneficiary or beneficiaries of specifically
 *    devised real estate in order to qualify." Three examples added to the regulation
 *    confirming: (1) beneficiary-sale of specifically devised property → no commission;
 *    (2) executor-sale of specifically devised property → no commission;
 *    (3) executor-sale of residue property → commission allowed.
 *    See DeductionType 'executor_commission' comment in src/types.ts.
 *    (No engine code change — attorney must confirm eligibility before including.)
 *
 * TECHNICAL-ONLY AMENDMENTS (gender-neutral pronoun updates; no substantive tax change):
 *    18:26-2.1, 18:26-2.11, 18:26-2.13, 18:26-2.15 and numerous other sections appear
 *    in the adopted-amendments text with only pronoun updates ("their" replacing gendered
 *    language) and minor stylistic changes. No change to tax imposition, rates, thresholds,
 *    disclaimer/renunciation rules, compromise procedures, or nonresident ratio tax formula.
 *    These sections require no code change and no special attorney review beyond ordinary
 *    matter-specific analysis.
 *
 * CLASS C/D RATE SECTIONS: 18:26-2.6 and 18:26-2.7 DO NOT APPEAR in the adopted-
 * amendments text. Rates and thresholds are CONFIRMED UNCHANGED from the 2018 adoption.
 *
 * No NJ Estate Tax applies. Subchapter 3 (estate tax): N.J.S.A. 54:38-1(a)(4) repealed
 * the estate tax for deaths on/after 2018-01-01; no regulation change needed or expected.
 * Subchapter 4 (compromises): 18:26-4.1 appears in adopted-amendments text with minor
 * pronoun/language updates only; no substantive change to compromise procedures.
 */
export const ruleSet20251215: RuleSet = {
  id: '2025-12-15',
  effectiveFrom: '2025-12-15',
  effectiveTo: null,
  citation:
    'N.J.S.A. 54:33-1 et seq.; N.J.S.A. 54:34-2; N.J.A.C. 18:26-2.6, 18:26-2.7 ' +
    '(readopted R.2025 d.152, 57 N.J.R. 2873(a), eff. Dec 15 2025); ' +
    'N.J.S.A. 54:38-1(a)(4) (P.L. 2016, c. 57, § 7); ' +
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
      // Brackets expressed in terms of TAXABLE AMOUNT (bequest minus $25,000 exemption).
      // Verified against IT-R Instructions "How to Calculate Class C Tax" worksheet and examples.
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
      brackets: [
        { from: 0,       to: 700_000,  rate: 0.15 },
        { from: 700_000, to: null,     rate: 0.16 },
      ],
    },
  },
};
