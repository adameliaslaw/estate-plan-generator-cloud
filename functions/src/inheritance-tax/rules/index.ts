import type { ISODate } from '../types';
import type { RuleSet } from './ruleSet';
import { ruleSet20020101 } from './sets/2002-01-01';
import { ruleSet20170101 } from './sets/2017-01-01';
import { ruleSet20180101 } from './sets/2018-01-01';
import { ruleSet20251215 } from './sets/2025-12-15';

/**
 * All rule sets, ordered ascending by effectiveFrom.
 * Add new rule sets here as regulations change.
 */
const RULE_SETS: RuleSet[] = [
  ruleSet20020101,
  ruleSet20170101,
  ruleSet20180101,
  ruleSet20251215,
];

/**
 * Returns the rule set that governs a given date of death.
 *
 * Throws if no rule set covers the date (e.g., before 2002-01-01).
 *
 * Rule set boundaries:
 * - 2002-01-01: earliest supported date. NJ Estate Tax applies ($675k exemption).
 * - 2017-01-01: NJ Estate Tax exemption raised to $2M (P.L. 2016, c. 57, § 7).
 * - 2018-01-01: NJ Estate Tax repealed (N.J.S.A. 54:38-1(a)(4); P.L. 2016, c. 57, § 7).
 * - 2025-12-15: R.2025 d.152 (57 N.J.R. 2873(a)) readoption with amendments.
 */
export function getRuleSet(dateOfDeath: ISODate): RuleSet {
  const sorted = [...RULE_SETS].sort((a, b) =>
    b.effectiveFrom.localeCompare(a.effectiveFrom),
  );
  const match = sorted.find((rs) => dateOfDeath >= rs.effectiveFrom);
  if (!match) {
    throw new Error(
      `No rule set found for date of death ${dateOfDeath}. ` +
      `Dates before ${RULE_SETS[0]?.effectiveFrom ?? 'unknown'} are not yet supported.`,
    );
  }
  return match;
}

/**
 * Returns a rule set by its id. Throws if not found.
 * Used by form builders that have a ruleSetId from a frozen computation snapshot.
 */
export function getRuleSetById(id: string): RuleSet {
  const rs = RULE_SETS.find((r) => r.id === id);
  if (!rs) {
    throw new Error(`No rule set found with id '${id}'.`);
  }
  return rs;
}

export type { RuleSet } from './ruleSet';
