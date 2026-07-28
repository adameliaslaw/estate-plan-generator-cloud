/**
 * The three forms that travel with an IT-R: IT-EXT, L-9/L-9(A) and IT-Estate.
 *
 * They were built and rendered but reachable by nothing until `getInheritanceCompanionForm`
 * existed. What is checked here is the part that matters legally: each renders only from an
 * approved snapshot, and each refuses — with its reason — when the estate does not meet the
 * form's own precondition. A refusal is the useful answer; a form with empty figures is not.
 *
 * The date rules below are the State's, from NJ Form O-10-C (General Information — Inheritance
 * and Estate Tax): "There is no New Jersey Estate Tax imposed on the estates of resident
 * decedents dying on or after Jan. 1, 2018" (P.L. 2016, c. 57), a $2,000,000 exemption for
 * 2017 deaths, and $675,000 for deaths after Dec. 31, 2001 but before Jan. 1, 2017.
 */
import { describe, expect, test } from 'vitest';
import { computeEstate } from '../../functions/src/inheritance-tax/engine';
import {
  buildITEXTFormData, buildITEstateFormData, buildL9AFormData,
  renderITEXTHtml, renderITEstateHtml, renderL9AHtml,
} from '../../functions/src/inheritance-tax/forms';
import { FormPreconditionError } from '../../functions/src/inheritance-tax/forms/errors';
import { getRuleSet } from '../../functions/src/inheritance-tax/rules';
import type { EstateComputation, Matter, ReviewCheckpoint } from '../../functions/src/inheritance-tax/types';

function makeMatter(overrides: Partial<Matter> = {}): Matter {
  return {
    matterId: 'companion-matter',
    createdAt: '2024-01-01T00:00:00.000Z',
    decedent: {
      lastName: 'Gold', firstName: 'Ada', ssn: '999-00-1234',
      dateOfDeath: '2023-09-18', countyOfResidence: 'Mercer',
    },
    willExists: true,
    trustExists: false,
    federalReturnFiled: true,
    virtualCurrencyExists: false,
    disclaimersExist: false,
    personalRepresentative: {
      name: 'Executor Gold', title: 'Executor',
      address: '1 Main St, Trenton, NJ 08600', phone: '609-555-0000',
    },
    beneficiaries: [{
      id: 'b1', lastName: 'Gold', firstName: 'Cass', address: '1 Main St, Trenton, NJ 08600',
      relationship: 'child',
      bequests: [{
        id: 'q1', type: 'nj_real_property', description: '12 Oak St', fairMarketValue: 300_000,
      }],
    }],
    deductions: [],
    ...overrides,
  };
}

function approvedFor(matter: Matter): ReviewCheckpoint {
  const computation = computeEstate(matter, getRuleSet(matter.decedent.dateOfDeath));
  return {
    checkpointId: 'cp-companion', matterId: matter.matterId,
    requestedAt: '2024-08-01T00:00:00.000Z', requestedBy: 'NJ-BAR-1',
    computationSnapshot: computation as EstateComputation, status: 'approved',
    reviewedAt: '2024-08-02T00:00:00.000Z', reviewedBy: 'NJ-BAR-2', notes: 'approved',
  };
}

describe('L-9 / L-9(A) — the real property tax waiver', () => {
  test('renders for an all-Class-A estate with NJ real property and no tax due', () => {
    const matter = makeMatter();
    const data = buildL9AFormData(matter, approvedFor(matter));
    // A 2023 death takes the L-9; the L-9(A) is the pre-2018 designation of the same affidavit.
    expect(data.formDesignation).toBe('L-9');
    expect(renderL9AHtml(data)).toContain('NOT FOR FILING');
  });

  test('a pre-2018 death takes the L-9(A) designation', () => {
    const matter = makeMatter({
      decedent: {
        lastName: 'Gold', firstName: 'Ada', ssn: '999-00-1234',
        dateOfDeath: '2016-03-04', countyOfResidence: 'Mercer',
      },
    });
    expect(buildL9AFormData(matter, approvedFor(matter)).formDesignation).toBe('L-9(A)');
  });

  test('refuses when tax is due, naming the beneficiary that disqualifies the estate', () => {
    // A friend is Class D: the affidavit requires every $500+ beneficiary to be Class A.
    const matter = makeMatter({
      beneficiaries: [{
        id: 'b1', lastName: 'Friend', firstName: 'Fran', address: '2 Elm St, NJ',
        relationship: 'friend',
        bequests: [{ id: 'q1', type: 'nj_real_property', description: '12 Oak St', fairMarketValue: 300_000 }],
      }],
    });
    expect(() => buildL9AFormData(matter, approvedFor(matter)))
      .toThrow(FormPreconditionError);
    expect(() => buildL9AFormData(matter, approvedFor(matter)))
      .toThrow(/Fran Friend/);
  });

  test('refuses an estate with no NJ real property — there is no lien to release', () => {
    const matter = makeMatter({
      beneficiaries: [{
        id: 'b1', lastName: 'Gold', firstName: 'Cass', address: '1 Main St, Trenton, NJ 08600',
        relationship: 'child',
        bequests: [{ id: 'q1', type: 'bank_account', description: 'Checking', fairMarketValue: 5_000 }],
      }],
    });
    expect(() => buildL9AFormData(matter, approvedFor(matter)))
      .toThrow(/no NJ real property/);
  });

  test('refuses a trust estate on the L-9(A) path', () => {
    const matter = makeMatter({
      trustExists: true,
      decedent: {
        lastName: 'Gold', firstName: 'Ada', ssn: '999-00-1234',
        dateOfDeath: '2016-03-04', countyOfResidence: 'Mercer',
      },
    });
    expect(() => buildL9AFormData(matter, approvedFor(matter))).toThrow(/trust/i);
  });
});

describe('IT-Estate — only while the NJ Estate Tax existed', () => {
  test('refuses a death on or after 2018-01-01, when the tax was repealed', () => {
    const matter = makeMatter();  // 2023 death
    expect(() => buildITEstateFormData(matter, approvedFor(matter)))
      .toThrow(FormPreconditionError);
    expect(() => buildITEstateFormData(matter, approvedFor(matter)))
      .toThrow(/repealed for deaths on or after 2018-01-01/);
  });

  test('a 2016 death computes the Simplified Method tax and credits the inheritance tax', () => {
    const matter = makeMatter({
      decedent: {
        lastName: 'Gold', firstName: 'Ada', ssn: '999-00-1234',
        dateOfDeath: '2016-03-04', countyOfResidence: 'Mercer',
      },
      beneficiaries: [{
        id: 'b1', lastName: 'Gold', firstName: 'Cass', address: '1 Main St, Trenton, NJ 08600',
        relationship: 'child',
        bequests: [{ id: 'q1', type: 'nj_real_property', description: '12 Oak St', fairMarketValue: 1_000_000 }],
      }],
    });
    const data = buildITEstateFormData(matter, approvedFor(matter));
    // Adjusted taxable estate = 1,000,000 − 60,000 = 940,000, which falls in the $840,000
    // bracket: 27,600 + 5.6% × 100,000 = 33,200.
    expect(data.tentativeTax).toBeCloseTo(33_200, 2);
    // The estate passes entirely to a child (Class A, exempt), so nothing is credited.
    expect(data.inheritanceTaxCredit).toBe(0);
    expect(data.netEstateTaxDue).toBeCloseTo(33_200, 2);
    expect(renderITEstateHtml(data)).toContain('NOT FOR FILING');
  });

  test('a 2017 death is left to the State’s own calculator rather than given a fabricated rate', () => {
    const matter = makeMatter({
      decedent: {
        lastName: 'Gold', firstName: 'Ada', ssn: '999-00-1234',
        dateOfDeath: '2017-06-01', countyOfResidence: 'Mercer',
      },
      beneficiaries: [{
        id: 'b1', lastName: 'Gold', firstName: 'Cass', address: '1 Main St, Trenton, NJ 08600',
        relationship: 'child',
        bequests: [{ id: 'q1', type: 'nj_real_property', description: '12 Oak St', fairMarketValue: 3_000_000 }],
      }],
    });
    const data = buildITEstateFormData(matter, approvedFor(matter));
    expect(data.tentativeTax).toBeNull();
    expect(data.netEstateTaxDue).toBeNull();
  });
});

describe('IT-EXT — the extension application', () => {
  test('refuses when no filing extension is recorded on the approved computation', () => {
    const matter = makeMatter();
    expect(() => buildITEXTFormData(matter, approvedFor(matter)))
      .toThrow(FormPreconditionError);
    expect(() => buildITEXTFormData(matter, approvedFor(matter)))
      .toThrow(/no filing extension is recorded/);
  });

  test('renders once an extension is recorded, carrying the extended deadline', () => {
    const matter = makeMatter({ itExtension: { firstExtension: true, reason: 'Awaiting appraisal' } });
    const data = buildITEXTFormData(matter, approvedFor(matter));
    expect(data.extendedFilingDeadline).toBeTruthy();
    expect(renderITEXTHtml(data)).toContain('NOT FOR FILING');
  });
});
