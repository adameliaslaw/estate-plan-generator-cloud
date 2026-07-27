// NJ public holidays per N.J.S.A. 36:1-1.
// Used by computeFilingDeadline() to implement the N.J.A.C. 18:2-4.12 next-business-day rule:
// if a filing deadline falls on a Saturday, Sunday, or legal holiday, the deadline advances
// to the next day that is not a Saturday, Sunday, or legal holiday.
//
// Fixed-date holidays (Jan 1, Jun 19, Jul 4, Nov 11, Dec 25):
//   Sat → observed preceding Friday; Sun → observed following Monday.
// Floating holidays (nth weekday of month, last Monday of May):
//   Always land on a specific weekday — no observation shift needed.

function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  // Returns YYYY-MM-DD for the nth occurrence of weekday (0=Sun,1=Mon,...,6=Sat) in month (1-indexed).
  const d = new Date(Date.UTC(year, month - 1, 1));
  const off = (weekday - d.getUTCDay() + 7) % 7;
  d.setUTCDate(1 + off + (n - 1) * 7);
  return d.toISOString().slice(0, 10);
}

function lastMondayOfMonth(year: number, month: number): string {
  // Returns YYYY-MM-DD for the last Monday of month (1-indexed).
  const d = new Date(Date.UTC(year, month, 0)); // day 0 of next month = last day of month
  const off = (d.getUTCDay() - 1 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - off);
  return d.toISOString().slice(0, 10);
}

/**
 * Gregorian (Western) Easter Sunday for `year` — the anonymous computus.
 * Good Friday (an NJ legal holiday, N.J.S.A. 36:1-1) is the Friday two days before.
 */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function goodFriday(year: number): string {
  const easter = easterSunday(year);
  const d = new Date(Date.UTC(year, easter.month - 1, easter.day));
  d.setUTCDate(d.getUTCDate() - 2); // Friday before Easter Sunday
  return d.toISOString().slice(0, 10);
}

function electionDay(year: number): string {
  // General Election Day (N.J.S.A. 19:1-1): the first Tuesday AFTER the first
  // Monday in November — i.e. the first Tuesday falling on Nov 2–8.
  const firstMonday = nthWeekday(year, 11, 1, 1); // 1 = Monday
  const d = new Date(firstMonday + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1); // the Tuesday after the first Monday
  return d.toISOString().slice(0, 10);
}

function addFixed(year: number, month: number, day: number, h: Set<string>): void {
  // Adds a fixed-date holiday with Sat/Sun observation shift per N.J.S.A. 36:1-1(b)–(c).
  const d = new Date(Date.UTC(year, month - 1, day));
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(d.getUTCDate() - 1); // Sat → preceding Fri
  else if (dow === 0) d.setUTCDate(d.getUTCDate() + 1); // Sun → following Mon
  h.add(d.toISOString().slice(0, 10));
}

const HOLIDAY_CACHE = new Map<number, Set<string>>();

function getNJHolidays(year: number): Set<string> {
  const cached = HOLIDAY_CACHE.get(year);
  if (cached !== undefined) return cached;

  const h = new Set<string>();

  // New Year's Day — January 1 (N.J.S.A. 36:1-1)
  addFixed(year, 1, 1, h);
  // Martin Luther King Jr. Day — 3rd Monday of January
  h.add(nthWeekday(year, 1, 1, 3));
  // Presidents' Day (Washington's Birthday) — 3rd Monday of February
  h.add(nthWeekday(year, 2, 1, 3));
  // Good Friday — Friday before Easter Sunday (N.J.S.A. 36:1-1). Floating; no observation shift.
  h.add(goodFriday(year));
  // Memorial Day — last Monday of May
  h.add(lastMondayOfMonth(year, 5));
  // Juneteenth National Independence Day — June 19 for years ≥ 2022 (P.L. 2021, c. 392).
  // Observed on the fixed calendar date June 19 (per firm/owner direction), with the
  // standard weekend observation shift (Sat → preceding Fri, Sun → following Mon).
  if (year >= 2022) {
    addFixed(year, 6, 19, h);
  }
  // Independence Day — July 4
  addFixed(year, 7, 4, h);
  // Labor Day — 1st Monday of September
  h.add(nthWeekday(year, 9, 1, 1));
  // Columbus Day — 2nd Monday of October (N.J.S.A. 36:1-1; NJ state offices observe)
  h.add(nthWeekday(year, 10, 1, 2));
  // Veterans Day — November 11
  addFixed(year, 11, 11, h);
  // Election Day — general election day (first Tuesday after the first Monday of
  // November), an NJ legal holiday for State offices (N.J.S.A. 36:1-1). Floating — no shift.
  h.add(electionDay(year));
  // Thanksgiving Day — 4th Thursday of November
  h.add(nthWeekday(year, 11, 4, 4));
  // Christmas Day — December 25
  addFixed(year, 12, 25, h);
  // NOTE: Lincoln's Birthday (Feb 12) is a legal holiday under N.J.S.A. 36:1-1 but is
  // expressly NOT a public holiday "for the purposes of conducting State government
  // business." A tax filing deadline is State business, so Feb 12 is deliberately
  // excluded from this deadline-shift calendar (see docs/IT-R-SPECIFICATION.md §11).

  HOLIDAY_CACHE.set(year, h);
  return h;
}

export function isNJHoliday(date: Date): boolean {
  return getNJHolidays(date.getUTCFullYear()).has(date.toISOString().slice(0, 10));
}
