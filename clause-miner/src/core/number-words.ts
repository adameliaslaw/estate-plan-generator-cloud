/**
 * Shared spelled-number lexicon used by normalize.ts (typed value
 * placeholders, §5.1) and sigtext.ts (number-words → `#` folding, §5.2).
 *
 * Pure module: regex sources only.
 */

const ONES = '(?:one|two|three|four|five|six|seven|eight|nine)';
const TEENS =
  '(?:ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)';
const TENS = '(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)';
const SCALE = '(?:hundred|thousand|million)';

/** A single spelled number word ("five", "twelve", "forty", "thousand"). */
export const NUM_WORD_SOURCE = `(?:${TENS}|${TEENS}|${ONES}|${SCALE})`;

/**
 * A spelled number phrase: number words chained by hyphens/spaces
 * ("twenty-five", "one hundred twenty", "fifty thousand").
 */
export const SPELLED_NUM_SOURCE = `${NUM_WORD_SOURCE}(?:[-\\s]${NUM_WORD_SOURCE}){0,4}`;

/** Parenthetical numeral confirmation: "(30)", "( 25 )". */
export const PAREN_NUM_SOURCE = '\\(\\s*\\d+(?:\\.\\d+)?\\s*\\)';

/**
 * "Numberish": a spelled number with optional parenthetical numeral
 * ("thirty (30)", "twenty-five"), or a bare numeral ("30").
 */
export const NUMBERISH_SOURCE = `(?:${SPELLED_NUM_SOURCE}\\s*(?:${PAREN_NUM_SOURCE})?|\\d+)`;
