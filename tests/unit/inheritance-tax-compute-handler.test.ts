/**
 * The callable wrapper's job is to carry two engine guarantees across the RPC boundary:
 * a matter that does not validate never reaches the engine, and an estate structure the engine
 * cannot model comes back as a refusal rather than a number.
 *
 * The handler is pure, so this needs no Firebase mocking.
 */
import { describe, it, expect } from 'vitest';
import { computeInheritanceTaxHandler } from '../../functions/src/inheritance-tax-compute';

/** A minimal, valid NJ resident matter: one Class C beneficiary (sibling), one bequest. */
function validMatter(overrides: Record<string, unknown> = {}) {
  return {
    matterId: 'TEST-1',
    createdAt: '2024-03-01T10:00:00.000Z',
    decedent: {
      firstName: 'Jane',
      lastName: 'Doe',
      ssn: '123-45-6789',
      dateOfDeath: '2024-03-01',
      countyOfResidence: 'Mercer',
      isNJResident: true,
    },
    willExists: true,
    trustExists: false,
    federalReturnFiled: false,
    virtualCurrencyExists: false,
    disclaimersExist: false,
    personalRepresentative: {
      name: 'Sam Sibling',
      title: 'Executor',
      address: '1 Example Street, Trenton, NJ 08600',
      phone: '609-555-0100',
    },
    beneficiaries: [
      {
        id: 'ben-001',
        firstName: 'Sam',
        lastName: 'Sibling',
        address: '1 Example Street, Trenton, NJ 08600',
        relationship: 'sibling',
        bequests: [
          {
            id: 'beq-001',
            type: 'bank_account',
            description: 'Checking account',
            fairMarketValue: 200000,
          },
        ],
      },
    ],
    deductions: [],
    ...overrides,
  };
}

describe('computeInheritanceTaxHandler', () => {
  it('computes a valid matter and labels the result a workpaper', () => {
    const res = computeInheritanceTaxHandler({ firmId: 'FIRM-1', matter: validMatter() });
    expect(res.workpaper).toBe(true);
    expect(res.ruleSetId).toBe('2018-01-01');
    const computation = res.computation as { filingDeadline: string; totalTaxDue: number };
    // 8 months after 2024-03-01 → 2024-11-01 (a Friday, so no business-day shift).
    expect(computation.filingDeadline).toBe('2024-11-01');
    expect(typeof computation.totalTaxDue).toBe('number');
  });

  it('rejects a matter that fails validation before the engine sees it', () => {
    const bad = validMatter();
    delete (bad as Record<string, unknown>)['willExists'];
    expect(() => computeInheritanceTaxHandler({ firmId: 'FIRM-1', matter: bad }))
      .toThrowError(/Matter validation failed/);
  });

  it('refuses a nonresident decedent instead of returning a number', () => {
    // The engine models the resident IT-R only; a nonresident estate is an IT-NR.
    // NOTE: computeEstate itself will happily compute this — the refusal lives in
    // buildITRFormData upstream, so the callable has to enforce it at the boundary.
    const nonresident = validMatter({
      decedent: {
        firstName: 'Jane',
        lastName: 'Doe',
        ssn: '123-45-6789',
        dateOfDeath: '2024-03-01',
        countyOfResidence: 'Mercer',
        isNJResident: false,
      },
    });
    expect(() => computeInheritanceTaxHandler({ firmId: 'FIRM-1', matter: nonresident }))
      .toThrowError(/IT-NR/);
  });

  it('refuses a date of death before the earliest rule set', () => {
    const tooEarly = validMatter({
      decedent: {
        firstName: 'Jane',
        lastName: 'Doe',
        ssn: '123-45-6789',
        dateOfDeath: '2001-12-31',
        countyOfResidence: 'Mercer',
        isNJResident: true,
      },
    });
    expect(() => computeInheritanceTaxHandler({ firmId: 'FIRM-1', matter: tooEarly }))
      .toThrowError(/Matter validation failed/);
  });

  it('requires firmId and matter', () => {
    expect(() => computeInheritanceTaxHandler({ matter: validMatter() } as never))
      .toThrowError(/firmId is required/);
    expect(() => computeInheritanceTaxHandler({ firmId: 'FIRM-1' } as never))
      .toThrowError(/matter is required/);
  });
});
