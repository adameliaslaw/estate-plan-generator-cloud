/**
 * Reopening a saved matter.
 *
 * Until `getInheritanceMatter` existed the page could LIST matters and nothing else — a saved
 * matter was unreachable the moment you left the screen. These cover the two things that make
 * reopening safe rather than merely possible:
 *
 *   1. **A stale computation is withheld.** Editing a matter does not delete its old computation,
 *      so a matter saved after its last compute has figures on file that no longer describe it.
 *      Handing those back would put an out-of-date total on screen looking exactly like a current
 *      one — the silent-wrong-number failure the spec calls this tool's worst.
 *   2. **An approved checkpoint still comes back.** Its figures are frozen, so it stays valid for
 *      rendering forms even after a later edit (FND-IMMUT). Withholding it would break the
 *      download of a form that was already signed off.
 */
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { createFakeFirestore } from './fake-firestore';
import {
  getLatestCheckpoint, getMatterWithMeta, saveCheckpoint, saveComputation, saveMatter,
} from '../../functions/src/inheritance-tax-store';
import { computeEstate } from '../../functions/src/inheritance-tax/engine';
import { getRuleSet } from '../../functions/src/inheritance-tax/rules';
import type {
  EstateComputation, Matter, ReviewCheckpoint,
} from '../../functions/src/inheritance-tax/types';

const FIRM = 'firm-1';

const MATTER: Matter = {
  matterId: 'reopen-1', createdAt: '2024-01-01T00:00:00.000Z',
  decedent: {
    lastName: 'Gold', firstName: 'Ada', ssn: '999-00-1234',
    dateOfDeath: '2024-03-01', countyOfResidence: 'Mercer', isNJResident: true,
  },
  willExists: true, trustExists: false, federalReturnFiled: false,
  virtualCurrencyExists: false, disclaimersExist: false,
  personalRepresentative: {
    name: 'Executor Gold', title: 'Executor',
    address: '1 Main St, Trenton, NJ 08600', phone: '609-555-0000',
  },
  beneficiaries: [{
    id: 'b1', lastName: 'Gold', firstName: 'Cass', address: '1 Main St, Trenton, NJ 08600',
    relationship: 'child',
    bequests: [{ id: 'q1', type: 'bank_account', description: 'Checking', fairMarketValue: 200_000 }],
  }],
  deductions: [],
  // Fields the browser editor does not model. They must survive a reopen.
  itExtension: { firstExtension: true },
  priorPayments: [{ id: 'p1', amount: 1_000, paidOn: '2024-09-01' }],
};

/** Mirrors the callable's rule: withhold a computation the matter has outgrown. */
function staleness(updatedAt: string, computation: EstateComputation | undefined): boolean {
  const computedAt = (computation as { computedAt?: string } | undefined)?.computedAt ?? '';
  return computation !== undefined && updatedAt !== '' && computedAt !== '' && updatedAt > computedAt;
}

describe('reopening a matter', () => {
  let db: ReturnType<typeof createFakeFirestore>;

  beforeEach(() => {
    db = createFakeFirestore();
    vi.useRealTimers();
  });

  test('returns the whole record, including fields the editor does not model', async () => {
    await saveMatter(db as never, FIRM, MATTER);
    const record = await getMatterWithMeta(db as never, FIRM, MATTER.matterId);

    expect(record).toBeDefined();
    // The browser's ITRMatterInput has no itExtension or priorPayments. If a reopen dropped
    // them, saving again would quietly delete an elected extension and a recorded payment.
    expect(record!.matter.itExtension).toEqual({ firstExtension: true });
    expect(record!.matter.priorPayments).toEqual([{ id: 'p1', amount: 1_000, paidOn: '2024-09-01' }]);
    expect(record!.matter.decedent.ssn).toBe('999-00-1234');
    expect(record!.updatedAt).not.toBe('');
  });

  test('a computation taken BEFORE the last edit is treated as stale', async () => {
    const computation = {
      ...computeEstate(MATTER, getRuleSet(MATTER.decedent.dateOfDeath)),
      computedAt: '2024-06-01T00:00:00.000Z',
    } as EstateComputation;
    await saveComputation(db as never, FIRM, MATTER.matterId, computation);
    // Saved again afterwards — the attorney edited something.
    await saveMatter(db as never, FIRM, MATTER);

    const record = await getMatterWithMeta(db as never, FIRM, MATTER.matterId);
    expect(staleness(record!.updatedAt, computation)).toBe(true);
  });

  test('a computation taken AFTER the last edit is current, and is returned', async () => {
    await saveMatter(db as never, FIRM, MATTER);
    const record = await getMatterWithMeta(db as never, FIRM, MATTER.matterId);
    const computation = {
      ...computeEstate(MATTER, getRuleSet(MATTER.decedent.dateOfDeath)),
      // Later than the save above.
      computedAt: '2099-01-01T00:00:00.000Z',
    } as EstateComputation;

    expect(staleness(record!.updatedAt, computation)).toBe(false);
  });

  test('the latest checkpoint comes back whatever its status, so a pending review resumes', async () => {
    const snapshot = computeEstate(MATTER, getRuleSet(MATTER.decedent.dateOfDeath)) as EstateComputation;
    const older: ReviewCheckpoint = {
      checkpointId: 'cp-old', matterId: MATTER.matterId,
      requestedAt: '2024-05-01T00:00:00.000Z', requestedBy: 'NJ-BAR-1',
      computationSnapshot: snapshot, status: 'approved',
      reviewedAt: '2024-05-02T00:00:00.000Z', reviewedBy: 'NJ-BAR-2',
    };
    const newer: ReviewCheckpoint = {
      checkpointId: 'cp-new', matterId: MATTER.matterId,
      requestedAt: '2024-07-01T00:00:00.000Z', requestedBy: 'NJ-BAR-1',
      computationSnapshot: snapshot, status: 'pending',
    };
    await saveCheckpoint(db as never, FIRM, older);
    await saveCheckpoint(db as never, FIRM, newer);

    const latest = await getLatestCheckpoint(db as never, FIRM, MATTER.matterId);
    // `getApprovedCheckpoint` would return the older one — correct for rendering a form, wrong
    // for restoring the screen, which has to offer Approve/Finalize on the pending review.
    expect(latest?.checkpointId).toBe('cp-new');
    expect(latest?.status).toBe('pending');
  });

  test('a matter that does not exist reads back as absent, not as an empty matter', async () => {
    expect(await getMatterWithMeta(db as never, FIRM, 'no-such-matter')).toBeUndefined();
    expect(await getLatestCheckpoint(db as never, FIRM, 'no-such-matter')).toBeUndefined();
  });
});
