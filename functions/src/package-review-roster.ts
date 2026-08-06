/**
 * functions/src/package-review-roster.ts
 *
 * Builds the person roster that the roster-driven checks in package-review.ts
 * run against.
 *
 * Kept out of package-review.ts on purpose: that module is pure text-in,
 * findings-out and knows nothing about our Firestore shapes. This one owns the
 * mapping from a client record to a list of names, so the review engine stays
 * testable without a client fixture and this stays testable without documents.
 *
 * Names are read from the split fields (firstName/middleName/lastName/suffix)
 * added in the 2026-05-27 name-split refactor, falling back to the legacy
 * joined `name` for records written before it.
 */

import type { PackagePerson, PackageContext } from './package-review';
import { classifyBeneficiary } from './nj-inheritance-tax';

interface SplitName {
  firstName?: unknown;
  middleName?: unknown;
  lastName?: unknown;
  suffix?: unknown;
  name?: unknown;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Join a split name, preferring the parts over the legacy joined field.
 *
 * The legacy `name` is derived from the parts at aggregation time, so when both
 * are present they agree — but a record written before the refactor has only
 * `name`, and a record edited since may have parts the joined field has not
 * caught up with. Parts win when they exist.
 */
export function personName(src: SplitName | null | undefined): string {
  if (!src) return '';
  const parts = [str(src.firstName), str(src.middleName), str(src.lastName), str(src.suffix)]
    .filter(Boolean);
  if (parts.length >= 2) return parts.join(' ');
  return str(src.name) || parts.join(' ');
}

/**
 * Collect every named person in a client record.
 *
 * Fiduciaries are included so their names can be reported in a collision, but
 * package-review.ts excludes them from collision *detection* — a spouse serving
 * as executor is one person in two roles, not two people sharing a name.
 */
export function buildPackageContext(
  client: Record<string, unknown> | null | undefined,
): PackageContext {
  const people: PackagePerson[] = [];
  if (!client) return { people };

  const push = (
    name: string,
    role: PackagePerson['role'],
    label?: string,
    opts?: { relationship?: string; isBeneficiary?: boolean },
  ) => {
    if (!name || name.trim().split(/\s+/).length < 2) return;
    // A relationship we do not recognise stays null. Guessing "Class D" would
    // put an 11-16% tax warning on a beneficiary who may owe nothing.
    const njTaxClass = opts?.relationship ? classifyBeneficiary(opts.relationship) : undefined;
    people.push({ name, role, label, njTaxClass, isBeneficiary: opts?.isBeneficiary });
  };

  push(personName(client.personalInfo as SplitName), 'client', 'client');
  push(personName(client.spouseInfo as SplitName), 'spouse', 'spouse', {
    relationship: 'spouse',
    isBeneficiary: true,
  });

  const children = Array.isArray(client.children) ? client.children : [];
  for (const child of children) {
    const c = child as SplitName & { relationship?: unknown };
    // A stepchild is Class A; a step-grandchild is not. classifyBeneficiary
    // carries that carve-out.
    push(personName(c), 'child', 'child', {
      relationship: str(c.relationship) || 'child',
      isBeneficiary: true,
    });
  }

  // Fiduciary slots vary in shape — some hold one person, some an ordered list.
  const fiduciaries = (client.fiduciaries ?? {}) as Record<string, unknown>;
  for (const [slot, value] of Object.entries(fiduciaries)) {
    const label = slot.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const f = entry as SplitName & { relationship?: unknown };
      push(personName(f), 'fiduciary', label, { relationship: str(f.relationship) });
    }
  }

  return { people };
}
