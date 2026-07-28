/**
 * tests/unit/client-facts.test.ts
 *
 * Deterministic client-facts layer: minor detection from DOB, case-insensitive
 * spousal status, unified asset arithmetic, and the pre-generation
 * consistency check.
 */

import { describe, expect, it } from 'vitest';
import {
  checkClientFactConsistency,
  estimateTotalAssets,
  hasSpousalStatus,
  isMinorChild,
} from '../../functions/src/client-facts';

function isoYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

describe('isMinorChild', () => {
  it('computes from DOB at generation time', () => {
    expect(isMinorChild({ dob: isoYearsAgo(13) })).toBe(true);
    expect(isMinorChild({ dob: isoYearsAgo(25) })).toBe(false);
  });

  it('overrides a stale stored flag when DOB is present', () => {
    expect(isMinorChild({ dob: isoYearsAgo(30), isMinor: true })).toBe(false);
  });

  it('falls back to the stored flag without a parseable DOB', () => {
    expect(isMinorChild({ isMinor: true })).toBe(true);
    expect(isMinorChild({ dob: 'not-a-date', isMinor: true })).toBe(true);
    expect(isMinorChild({})).toBe(false);
  });
});

describe('hasSpousalStatus', () => {
  it('matches canonical statuses case-insensitively', () => {
    expect(hasSpousalStatus('Married')).toBe(true);
    expect(hasSpousalStatus('married')).toBe(true);
    expect(hasSpousalStatus(' MARRIED ')).toBe(true);
    expect(hasSpousalStatus('Domestic Partnership')).toBe(true);
  });

  it('rejects non-spousal statuses and non-strings', () => {
    expect(hasSpousalStatus('Single')).toBe(false);
    expect(hasSpousalStatus('Divorced')).toBe(false);
    expect(hasSpousalStatus(undefined)).toBe(false);
    expect(hasSpousalStatus(42)).toBe(false);
  });
});

describe('estimateTotalAssets', () => {
  it('sums the canonical asset shape', () => {
    expect(
      estimateTotalAssets({
        realEstate: [{ estimatedValue: 585000 }],
        bankAccounts: [{ estimatedBalance: 40000 }],
        investmentAccounts: [{ estimatedValue: 410000 }],
        retirementAccounts: [{ estimatedValue: 690000 }],
        lifeInsurance: [{ faceValue: 1000000 }],
        businessInterests: [],
        personalProperty: [{ estimatedValue: 25000 }],
      }),
    ).toBe(2750000);
  });

  it('prefers cashValue over faceValue for life insurance', () => {
    expect(
      estimateTotalAssets({ lifeInsurance: [{ cashValue: 50000, faceValue: 1000000 }] }),
    ).toBe(50000);
  });

  it('lets a manual estate total override the itemized sum', () => {
    expect(
      estimateTotalAssets({
        realEstate: [{ estimatedValue: 100 }],
        estimatedTotalEstate: 999,
      }),
    ).toBe(999);
  });

  it('handles missing/malformed input', () => {
    expect(estimateTotalAssets(undefined)).toBe(0);
    expect(estimateTotalAssets({ bankAccounts: [{ estimatedBalance: 'x' }] })).toBe(0);
  });
});

describe('checkClientFactConsistency', () => {
  const married = { personalInfo: { maritalStatus: 'Married' } };

  it('errors when married with no spouse on file', () => {
    const findings = checkClientFactConsistency(married);
    expect(findings.map((f) => f.code)).toContain('spouse-info-missing');
    expect(findings.find((f) => f.code === 'spouse-info-missing')?.severity).toBe('error');
  });

  it('warns when a spouse is on file but status is non-spousal', () => {
    const findings = checkClientFactConsistency({
      personalInfo: { maritalStatus: 'Single' },
      spouseInfo: { firstName: 'Maria', lastName: 'Carter' },
    });
    expect(findings.map((f) => f.code)).toContain('spouse-data-mismatch');
  });

  it('errors when minors exist without a primary guardian', () => {
    const findings = checkClientFactConsistency({
      ...married,
      spouseInfo: { firstName: 'Maria', lastName: 'Carter' },
      children: [{ name: 'Lucas Carter', dob: isoYearsAgo(13) }],
      fiduciaries: {},
    });
    expect(findings.map((f) => f.code)).toContain('minors-without-guardian');
  });

  it('flags stale isMinor flags and missing DOBs', () => {
    const findings = checkClientFactConsistency({
      ...married,
      spouseInfo: { firstName: 'Maria', lastName: 'Carter' },
      children: [
        { name: 'Sophia Carter', dob: isoYearsAgo(25), isMinor: true },
        { name: 'Nameless', dob: '??' },
      ],
    });
    const codes = findings.map((f) => f.code);
    expect(codes).toContain('stale-isminor-flag');
    expect(codes).toContain('child-missing-dob');
  });

  it('returns no findings for a consistent record', () => {
    const findings = checkClientFactConsistency({
      personalInfo: { maritalStatus: 'Married' },
      spouseInfo: { firstName: 'Maria', lastName: 'Carter' },
      children: [{ name: 'Lucas Carter', dob: isoYearsAgo(13) }],
      fiduciaries: { guardian: { primary: { name: 'Peter Carter' } } },
    });
    expect(findings).toEqual([]);
  });
});
