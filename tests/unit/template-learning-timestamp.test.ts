/**
 * tests/unit/template-learning-timestamp.test.ts
 *
 * Regression test for R5-017: recordCorrection() / recordConfirmedVariables()
 * must store concrete Timestamp values (admin.firestore.Timestamp.now()) inside
 * array elements — never a FieldValue.serverTimestamp() sentinel. Firestore
 * rejects a serverTimestamp sentinel nested inside an array, so the pre-fix code
 * threw on every call and the correction-memory / dictionary updates never ran.
 *
 * The firebase-admin mock mirrors that SDK rule: arrayUnion() and a batched
 * set() throw if a sentinel is found inside an array, exactly as production
 * Firestore would.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  // Distinct marker objects so tests can tell the two apart.
  const SERVER_TS_SENTINEL = { __kind: 'serverTimestampSentinel' } as const;
  const makeConcreteTs = () => ({ __kind: 'concreteTimestamp', toMillis: () => 0 });

  // Recursively reject a serverTimestamp sentinel found inside an array — the
  // real Firestore SDK throws: "FieldValue.serverTimestamp() cannot be used
  // inside of an array".
  const assertNoSentinelInArray = (value: unknown, insideArray: boolean): void => {
    if (value === SERVER_TS_SENTINEL) {
      if (insideArray) {
        throw new Error(
          'FieldValue.serverTimestamp() cannot be used inside of an array',
        );
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const el of value) assertNoSentinelInArray(el, true);
    } else if (value && typeof value === 'object') {
      for (const v of Object.values(value)) assertNoSentinelInArray(v, insideArray);
    }
  };

  const arrayUnionArgs: unknown[] = [];
  const batchSets: Array<Record<string, unknown>> = [];

  return { SERVER_TS_SENTINEL, makeConcreteTs, assertNoSentinelInArray, arrayUnionArgs, batchSets };
});

// firebase-admin resolves to functions/node_modules (there is no root copy), so
// the bare 'firebase-admin' specifier is unresolvable from a root test and the
// mock would silently no-op. Target the functions copy by path so it actually
// intercepts template-learning.ts's admin.firestore() calls at runtime.
vi.mock('../../functions/node_modules/firebase-admin', () => {
  // One fully-chainable node covers every collection()/doc() chain plus set/get.
  const node: Record<string, unknown> = {};
  node.collection = vi.fn(() => node);
  node.doc = vi.fn(() => node);
  node.set = vi.fn((data: unknown) => {
    h.assertNoSentinelInArray(data, false);
    return Promise.resolve();
  });
  node.get = vi.fn(() => Promise.resolve({ data: () => ({}) }));
  const batch = {
    set: vi.fn((_ref: unknown, data: Record<string, unknown>) => {
      h.assertNoSentinelInArray(data, false);
      h.batchSets.push(data);
    }),
    commit: vi.fn(() => Promise.resolve()),
  };
  const firestore = Object.assign(
    () => ({ collection: () => node, batch: () => batch }),
    {
      Timestamp: { now: () => h.makeConcreteTs() },
      FieldValue: {
        serverTimestamp: () => h.SERVER_TS_SENTINEL,
        arrayUnion: (entry: unknown) => {
          h.assertNoSentinelInArray(entry, true); // arrayUnion values live in an array
          h.arrayUnionArgs.push(entry);
          return { __kind: 'arrayUnion', entry };
        },
      },
      DocumentData: {},
    },
  );
  return { firestore, initializeApp: vi.fn() };
});

import { recordCorrection, recordConfirmedVariables } from '../../functions/src/template-learning';

describe('template-learning — concrete Timestamp inside arrays (R5-017)', () => {
  beforeEach(() => {
    h.arrayUnionArgs.length = 0;
    h.batchSets.length = 0;
  });

  it('recordCorrection does not throw and uses a concrete Timestamp in the array entry', async () => {
    await expect(
      recordCorrection('firm-1', {
        originalText: 'Executor Name',
        aiSuggestedVariable: 'executorName',
        userCorrectedVariable: 'fiduciaries.executor.primary.name',
        docType: 'will',
        templateName: 'Standard Will',
      }),
    ).resolves.toBeUndefined();

    // The entry appended via arrayUnion must carry a concrete Timestamp, not a
    // serverTimestamp sentinel.
    const entry = h.arrayUnionArgs[0] as { timestamp: { __kind: string } };
    expect(entry.timestamp.__kind).toBe('concreteTimestamp');
  });

  it('recordConfirmedVariables does not throw and stores concrete Timestamps in the examples array', async () => {
    await expect(
      recordConfirmedVariables('firm-1', 'Standard Will', 'will', [
        { originalText: 'Client Name', confirmedVariable: 'clientName', fieldLabel: 'Client Name' },
      ]),
    ).resolves.toBeUndefined();

    // The few-shot examples array (a Firestore array) must use a concrete
    // Timestamp for uploadedAt.
    const examplesWrite = h.batchSets.find((d) => Array.isArray(d.examples)) as
      | { examples: Array<{ uploadedAt: { __kind: string } }> }
      | undefined;
    expect(examplesWrite).toBeDefined();
    expect(examplesWrite!.examples[0].uploadedAt.__kind).toBe('concreteTimestamp');
  });
});
