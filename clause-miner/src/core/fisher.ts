/**
 * §7.3 — exact statistics for the trigger cards, dependency-free:
 *  - Fisher's exact test (two-sided) for a 2×2 table via log-factorials;
 *  - Benjamini–Hochberg correction across the whole hypothesis grid
 *    (~600 families × ~40 fact-values ≈ 24k hypotheses — uncorrected
 *    p<0.05 would hand Adam hundreds of spurious "insights").
 *
 * Pure module: numbers in, numbers out.
 */

/** log(n!) with memoization — n stays small (pilot n ≤ a few thousand). */
const logFactCache: number[] = [0, 0];

export function logFactorial(n: number): number {
  if (n < 0 || !Number.isInteger(n)) throw new Error(`logFactorial(${n})`);
  for (let i = logFactCache.length; i <= n; i++) {
    logFactCache.push(logFactCache[i - 1] + Math.log(i));
  }
  return logFactCache[n];
}

/**
 * 2×2 table:
 *   [a b]   a = clause present & fact=value,  b = clause present & fact≠value
 *   [c d]   c = clause absent  & fact=value,  d = clause absent  & fact≠value
 */
export interface Table2x2 {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** Hypergeometric log-probability of a specific table given fixed margins. */
function logHyperProb(a: number, b: number, c: number, d: number): number {
  return (
    logFactorial(a + b) +
    logFactorial(c + d) +
    logFactorial(a + c) +
    logFactorial(b + d) -
    logFactorial(a) -
    logFactorial(b) -
    logFactorial(c) -
    logFactorial(d) -
    logFactorial(a + b + c + d)
  );
}

/**
 * Two-sided Fisher exact p: sum of probabilities of all tables (with the
 * same margins) whose probability is ≤ the observed table's probability
 * (standard "sum of small p" definition, matching R's fisher.test).
 */
export function fisherExactTwoSided(t: Table2x2): number {
  const { a, b, c, d } = t;
  if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error('negative cell');
  const row1 = a + b;
  const col1 = a + c;
  const n = a + b + c + d;
  if (n === 0) return 1;
  const logPObs = logHyperProb(a, b, c, d);
  const aMin = Math.max(0, col1 - (n - row1));
  const aMax = Math.min(row1, col1);
  let p = 0;
  const EPS = 1e-9; // tolerate float noise when comparing log-probs
  for (let x = aMin; x <= aMax; x++) {
    const logPx = logHyperProb(x, row1 - x, col1 - x, n - row1 - col1 + x);
    if (logPx <= logPObs + EPS) p += Math.exp(logPx);
  }
  return Math.min(1, p);
}

/** Lift = P(clause|fact) / P(clause|¬fact); Infinity/NaN handled by caller. */
export function lift(t: Table2x2): number {
  const pGivenFact = t.a + t.c > 0 ? t.a / (t.a + t.c) : 0;
  const pGivenNotFact = t.b + t.d > 0 ? t.b / (t.b + t.d) : 0;
  if (pGivenNotFact === 0) return pGivenFact > 0 ? Infinity : 1;
  return pGivenFact / pGivenNotFact;
}

/**
 * Benjamini–Hochberg adjusted p-values across the whole grid (§7.3).
 * Returns pAdj in the ORIGINAL order of `pValues`.
 */
export function benjaminiHochberg(pValues: readonly number[]): number[] {
  const m = pValues.length;
  if (m === 0) return [];
  const indexed = pValues.map((p, i) => ({ p, i }));
  indexed.sort((x, y) => x.p - y.p);
  const adjusted = new Array<number>(m);
  let running = 1;
  for (let rank = m; rank >= 1; rank--) {
    const { p, i } = indexed[rank - 1];
    const raw = (p * m) / rank;
    running = Math.min(running, raw);
    adjusted[i] = running;
  }
  return adjusted;
}
