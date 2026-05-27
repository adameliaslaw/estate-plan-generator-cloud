/**
 * Aggregates "people already identified in the questionnaire" — spouse,
 * children, other dependents, and anyone already named in another
 * fiduciary slot — so the PersonPicker on each fiduciary slot can offer
 * one-click selection instead of forcing re-entry.
 *
 * Source list per the 2026-05-27 product decision:
 *   - Spouse (if hasSpouse AND spouseInfo.firstName populated)
 *   - Each named child (children array, name non-empty)
 *   - Each named other-dependent
 *   - Each named fiduciary in any OTHER slot (excludes the current target)
 *
 * Deduplication is by lowercased full name. If the same person appears
 * as both a child AND an existing fiduciary in another slot, only the
 * family-section entry is shown (richer source).
 */

import type { QuestionnaireData } from '@/types/questionnaire';

export interface AvailablePerson {
  /** Stable id for React keys + select option value. */
  id: string;
  /** Pretty label for the dropdown option, e.g. "Ibrahim Polo (Son)". */
  label: string;
  /** Provenance — surfaces the source section in a sublabel. */
  source: 'spouse' | 'child' | 'otherDependent' | 'fiduciary';
  /** Copied into the target slot when this option is picked. */
  data: {
    name: string;
    firstName?: string;
    middleName?: string;
    lastName?: string;
    suffix?: string;
    relationship?: string;
    gender?: string;
    phone?: string;
    email?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    county?: string;
  };
}

type AnyRec = Record<string, unknown>;

const FIDUCIARY_PATHS: ReadonlyArray<{ role: string; level: string; label: string }> = [
  { role: 'executor',        level: 'primary',        label: 'Executor' },
  { role: 'executor',        level: 'alternate',      label: 'Alternate Executor' },
  { role: 'executor',        level: 'successor',      label: 'Successor Executor' },
  { role: 'executor',        level: 'secondSuccessor',label: '2nd Successor Executor' },
  { role: 'trustee',         level: 'primary',        label: 'Trustee' },
  { role: 'trustee',         level: 'alternate',      label: 'Alternate Trustee' },
  { role: 'trustee',         level: 'successor',      label: 'Successor Trustee' },
  { role: 'powerOfAttorney', level: 'agent',          label: 'POA Agent' },
  { role: 'powerOfAttorney', level: 'alternateAgent', label: 'Alternate POA Agent' },
  { role: 'healthcareProxy', level: 'agent',          label: 'HC Representative' },
  { role: 'healthcareProxy', level: 'alternateAgent', label: 'Alternate HC Representative' },
  { role: 'guardian',        level: 'primary',        label: 'Guardian' },
  { role: 'guardian',        level: 'alternate',      label: 'Alternate Guardian' },
];

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cursor, key) => {
    if (cursor != null && typeof cursor === 'object' && key in (cursor as AnyRec)) {
      return (cursor as AnyRec)[key];
    }
    return undefined;
  }, obj);
}

function nonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function joinName(parts: Array<unknown>): string {
  return parts.filter(nonEmpty).map((p) => (p as string).trim()).join(' ');
}

export function getAvailablePeople(
  data: QuestionnaireData,
  excludePath?: string,
): AvailablePerson[] {
  const out: AvailablePerson[] = [];
  const seenNames = new Set<string>(); // lowercase full name dedup

  const addIfNew = (person: AvailablePerson) => {
    const key = person.data.name.trim().toLowerCase();
    if (key.length === 0) return;
    if (seenNames.has(key)) return;
    seenNames.add(key);
    out.push(person);
  };

  // ── Spouse ──────────────────────────────────────────────────────────────
  const spouse = (data as unknown as AnyRec).spouseInfo as AnyRec | undefined;
  const pi = (data as unknown as AnyRec).personalInfo as AnyRec | undefined;
  const maritalStatus = typeof pi?.maritalStatus === 'string' ? pi.maritalStatus : '';
  const hasSpouse = ['Married', 'Domestic Partnership'].includes(maritalStatus);

  if (hasSpouse && spouse && nonEmpty(spouse.firstName)) {
    const spouseFullName = joinName([spouse.firstName, spouse.middleName, spouse.lastName, spouse.suffix]);
    if (spouseFullName) {
      // Spouse address: if sameAddress is true, mirror personalInfo.
      const sameAddr = spouse.sameAddress === true;
      addIfNew({
        id: 'spouse',
        label: `${spouseFullName} (Spouse)`,
        source: 'spouse',
        data: {
          name: spouseFullName,
          firstName: nonEmpty(spouse.firstName) ? spouse.firstName : undefined,
          middleName: nonEmpty(spouse.middleName) ? spouse.middleName : undefined,
          lastName: nonEmpty(spouse.lastName) ? spouse.lastName : undefined,
          suffix: nonEmpty(spouse.suffix) ? spouse.suffix : undefined,
          relationship: 'Spouse',
          gender: typeof spouse.gender === 'string' ? spouse.gender : undefined,
          phone: typeof spouse.phone === 'string' ? spouse.phone : undefined,
          email: typeof spouse.email === 'string' ? spouse.email : undefined,
          address: nonEmpty(spouse.address) ? spouse.address
            : sameAddr && nonEmpty(pi?.address) ? pi.address : undefined,
          city: nonEmpty(spouse.city) ? spouse.city
            : sameAddr && nonEmpty(pi?.city) ? pi.city : undefined,
          state: nonEmpty(spouse.state) ? spouse.state
            : sameAddr && nonEmpty(pi?.state) ? pi.state : undefined,
          zip: nonEmpty(spouse.zip) ? spouse.zip
            : sameAddr && nonEmpty(pi?.zip) ? pi.zip : undefined,
          county: nonEmpty(spouse.county) ? spouse.county
            : sameAddr && nonEmpty(pi?.county) ? pi.county : undefined,
        },
      });
    }
  }

  // ── Children ────────────────────────────────────────────────────────────
  const children = (data as unknown as AnyRec).children;
  if (Array.isArray(children)) {
    children.forEach((c, idx) => {
      const child = c as AnyRec;
      const displayName = resolveDisplayName(child);
      if (!displayName) return;
      addIfNew({
        id: `child-${idx}`,
        label: `${displayName} (Child)`,
        source: 'child',
        data: {
          name: displayName,
          firstName: nonEmpty(child.firstName) ? child.firstName : undefined,
          middleName: nonEmpty(child.middleName) ? child.middleName : undefined,
          lastName: nonEmpty(child.lastName) ? child.lastName : undefined,
          suffix: nonEmpty(child.suffix) ? child.suffix : undefined,
          relationship: typeof child.relationship === 'string' ? child.relationship : 'Child',
          gender: typeof child.gender === 'string' ? child.gender : undefined,
          phone: typeof child.phone === 'string' ? child.phone : undefined,
          email: typeof child.email === 'string' ? child.email : undefined,
          address: nonEmpty(child.address) ? child.address : undefined,
          city: nonEmpty(child.city) ? child.city : undefined,
          state: nonEmpty(child.state) ? child.state : undefined,
          zip: nonEmpty(child.zip) ? child.zip : undefined,
          county: nonEmpty(child.county) ? child.county : undefined,
        },
      });
    });
  }

  // ── Other dependents ────────────────────────────────────────────────────
  const others = (data as unknown as AnyRec).otherDependents;
  if (Array.isArray(others)) {
    others.forEach((o, idx) => {
      const dep = o as AnyRec;
      const displayName = resolveDisplayName(dep);
      if (!displayName) return;
      const rel = typeof dep.relationship === 'string' && dep.relationship.trim().length > 0
        ? dep.relationship
        : 'Other Dependent';
      addIfNew({
        id: `dep-${idx}`,
        label: `${displayName} (${rel})`,
        source: 'otherDependent',
        data: {
          name: displayName,
          firstName: nonEmpty(dep.firstName) ? dep.firstName : undefined,
          middleName: nonEmpty(dep.middleName) ? dep.middleName : undefined,
          lastName: nonEmpty(dep.lastName) ? dep.lastName : undefined,
          suffix: nonEmpty(dep.suffix) ? dep.suffix : undefined,
          relationship: rel,
          phone: typeof dep.phone === 'string' ? dep.phone : undefined,
          email: typeof dep.email === 'string' ? dep.email : undefined,
          address: nonEmpty(dep.address) ? dep.address : undefined,
          city: nonEmpty(dep.city) ? dep.city : undefined,
          state: nonEmpty(dep.state) ? dep.state : undefined,
          zip: nonEmpty(dep.zip) ? dep.zip : undefined,
          county: nonEmpty(dep.county) ? dep.county : undefined,
        },
      });
    });
  }

  // ── Other fiduciary slots (anyone already named, excluding the current target) ─
  for (const { role, level, label } of FIDUCIARY_PATHS) {
    const slotPath = `fiduciaries.${role}.${level}`;
    if (excludePath && excludePath === slotPath) continue;
    // Guardian lives at top-level guardianPrimary / guardianAlternate, not under fiduciaries
    let slot: AnyRec | undefined;
    if (role === 'guardian') {
      const topPath = level === 'primary' ? 'guardianPrimary' : 'guardianAlternate';
      if (excludePath === topPath) continue;
      slot = getPath(data, topPath) as AnyRec | undefined;
    } else {
      slot = getPath(data, slotPath) as AnyRec | undefined;
    }
    if (!slot) continue;
    const displayName = resolveDisplayName(slot);
    if (!displayName) continue;
    addIfNew({
      id: `fid-${role}-${level}`,
      label: `${displayName} (Previously named as ${label})`,
      source: 'fiduciary',
      data: {
        name: displayName,
        firstName: nonEmpty(slot.firstName) ? slot.firstName : undefined,
        middleName: nonEmpty(slot.middleName) ? slot.middleName : undefined,
        lastName: nonEmpty(slot.lastName) ? slot.lastName : undefined,
        suffix: nonEmpty(slot.suffix) ? slot.suffix : undefined,
        relationship: typeof slot.relationship === 'string' ? slot.relationship : undefined,
        gender: typeof slot.gender === 'string' ? slot.gender : undefined,
        phone: typeof slot.phone === 'string' ? slot.phone : undefined,
        email: typeof slot.email === 'string' ? slot.email : undefined,
        address: nonEmpty(slot.address) ? slot.address : undefined,
        city: nonEmpty(slot.city) ? slot.city : undefined,
        state: nonEmpty(slot.state) ? slot.state : undefined,
        zip: nonEmpty(slot.zip) ? slot.zip : undefined,
        county: nonEmpty(slot.county) ? slot.county : undefined,
      },
    });
  }

  return out;
}

/**
 * Resolves a person's display name. Prefers split parts when firstName is set
 * (mirroring the aggregator's deriveName); falls back to legacy `.name`.
 * Returns '' when neither is populated.
 */
function resolveDisplayName(p: AnyRec): string {
  if (nonEmpty(p.firstName)) {
    return joinName([p.firstName, p.middleName, p.lastName, p.suffix]);
  }
  if (nonEmpty(p.name)) return (p.name as string).trim();
  return '';
}
