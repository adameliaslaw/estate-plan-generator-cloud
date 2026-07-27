import { isNJHoliday } from './holidays';

/**
 * Computes a filing deadline: `months` calendar months after the date of death, advanced
 * past weekends and NJ public holidays. Used for the 8-month inheritance-tax deadline and
 * the 9-month estate-tax deadline.
 *
 * Verified: 8 months per N.J.S.A. 54:35-3 and N.J.A.C. 18:26-9.1 (inheritance); 9 months
 * for the NJ Estate Tax (nj.gov Division of Taxation).
 * Note: N.J.S.A. 54:35-5 is the lien duration statute (15 years), NOT the filing deadline.
 * Overflow: JS setUTCMonth naturally overflows to the first day of the next month
 * (e.g. Jan 31 + 8 months → Sep 31 → Oct 1), consistent with N.J.A.C. 18:26-9.1 practice.
 * Weekend/holiday authority:
 *   N.J.A.C. 18:2-4.12: if the deadline falls on a Saturday, Sunday, or legal holiday,
 *   it advances to the next day that is not a Saturday, Sunday, or legal holiday.
 *   N.J.S.A. 36:1-1.1: Saturdays are state public holidays for NJ office business.
 *   N.J.S.A. 36:1-1(b)–(c): Sunday holiday → following Monday observed.
 *   NJ public holidays from N.J.S.A. 36:1-1 applied via isNJHoliday(); chains resolved
 *   by the while loop (e.g. Sat → Sun → Mon = holiday → Tue).
 */
export function computeFilingDeadline(dateOfDeath: string, months: number): string {
  const d = new Date(dateOfDeath + 'T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  while (true) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6 || isNJHoliday(d)) {
      d.setUTCDate(d.getUTCDate() + 1);
    } else {
      break;
    }
  }
  return d.toISOString().slice(0, 10);
}
