/**
 * Values printed the way the State's own instructions print them.
 *
 * The forms take free text in several places where the instructions are specific about the
 * notation. A bare "100" where the instruction says "enter 100%" is not wrong so much as
 * *silent*: a reader scanning a column of ownership interests reads a number and supplies the
 * unit from habit, and the one time the habit is wrong — a 50 that meant a half, a 100 that meant
 * one of a hundred units — nothing on the page contradicts them. On the schedule that generates
 * the tax waiver, the notation is part of the assertion.
 */

/**
 * A fractional or percentage interest, as Schedule A column A and Schedule B ask for it.
 *
 * > *"Report the fractional (i.e., one-half, one-third, etc.) or percentage (i.e., 50%, 33%,
 * > etc.) interest of the decedent if they owned less than 100%. … If decedent was sole owner,
 * > enter 100%."* — IT-R Instructions, Schedule A
 *
 * A bare number is a percentage that lost its sign, so the sign is restored. Everything else is
 * left exactly as the attorney wrote it: "1/2" and "one-half" are the notations the instruction
 * itself offers, and a value already carrying "%" is already right. Nothing is ever reworded —
 * this adds a symbol the instruction requires, it does not interpret.
 */
export function formatInterestNotation(raw: string | undefined): string {
  const text = (raw ?? '').trim();
  if (text === '') return '';
  // A plain number, with or without decimals: "100", "50", "33.33". Anything else — a fraction,
  // a word, a value already signed — is the attorney's own notation and is passed through.
  return /^\d+(\.\d+)?$/.test(text) ? `${text}%` : text;
}
