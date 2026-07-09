/**
 * tests/unit/document-save-notarized.test.ts
 *
 * Regression test for R5-031: `saveDocumentToVault` set the vaulted document's
 * `notarized` flag from the doc-type notarization *requirement*, falsely marking
 * every notarization-required fresh draft as already notarized. `notarized` means
 * "has been notarized" (it lives beside notarizedAt/notaryName) — a freshly
 * generated draft has NOT been, so it must always be false. The fix hardcodes
 * `notarized: false`.
 *
 * The write happens inside a runTransaction; the mock executes the callback (a
 * new doc → tx.set, a regeneration → tx.update) and captures the main document
 * payload so we can assert the flag. This is the document CONTENT contract, not
 * the version-bump concurrency race (R5-033, which needs the Firestore emulator).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requiresNotarization } from '../../functions/src/document-save-helper';

const state = vi.hoisted(() => ({
  existing: { exists: false } as { exists: boolean; data?: () => Record<string, unknown> },
  mainWrite: null as { op: 'set' | 'update'; data: Record<string, unknown> } | null,
}));

vi.mock('../../functions/node_modules/firebase-admin', () => {
  type MockColl = { doc: (id?: string) => MockRef };
  type MockRef = { path: string; id: string | undefined; collection: (name: string) => MockColl };
  const makeColl = (path: string): MockColl => ({ doc: (id?: string) => makeRef(`${path}/${id ?? 'auto'}`) });
  const makeRef = (path: string): MockRef => ({
    path,
    id: path.split('/').pop(),
    collection: (name: string) => makeColl(`${path}/${name}`),
  });
  const capture = (op: 'set' | 'update') => (ref: MockRef, data: Record<string, unknown>) => {
    if (!String(ref.path).includes('/versions/')) state.mainWrite = { op, data };
  };
  const db = {
    collection: (name: string) => makeColl(name),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        get: async () => state.existing,
        set: capture('set'),
        update: capture('update'),
      };
      return fn(tx);
    },
  };
  const firestore = Object.assign(() => db, {
    FieldValue: {
      serverTimestamp: () => 'ts',
      arrayUnion: (...items: unknown[]) => ({ __arrayUnion: items }),
      delete: () => '__delete',
    },
    Timestamp: { now: () => ({ __ts: true }) },
  });
  return {
    firestore,
    storage: () => ({ bucket: () => ({ file: () => ({ save: vi.fn() }) }) }),
    initializeApp: vi.fn(),
  };
});

import { saveDocumentToVault } from '../../functions/src/document-save-helper';

const baseParams = {
  firmId: 'firm-1',
  clientId: 'client-1',
  displayName: 'Power of Attorney',
  content: '<p>Power of Attorney</p>',
  status: 'draft' as const,
  createdBy: 'attorney-1',
  documentId: 'doc-1',
};

describe('saveDocumentToVault — notarized flag (R5-031)', () => {
  beforeEach(() => {
    state.existing = { exists: false };
    state.mainWrite = null;
  });

  it('sanity: the doc-type notarization REQUIREMENT is true for a POA', () => {
    // The bug was writing this requirement into `notarized`. It must not leak in.
    expect(requiresNotarization('poa')).toBe(true);
    expect(requiresNotarization('deed')).toBe(true);
    expect(requiresNotarization('will')).toBe(false);
  });

  it('saves a fresh notarization-required draft (POA) with notarized:false', async () => {
    await saveDocumentToVault({ ...baseParams, docType: 'poa' });

    expect(state.mainWrite?.op).toBe('set');
    expect(state.mainWrite?.data.notarized).toBe(false);
  });

  it('keeps notarized:false when regenerating an existing notarization-required doc', async () => {
    state.existing = { exists: true, data: () => ({ currentVersion: 2, content: 'old', tags: [] }) };
    await saveDocumentToVault({ ...baseParams, docType: 'deed' });

    expect(state.mainWrite?.op).toBe('update');
    expect(state.mainWrite?.data.notarized).toBe(false);
  });

  it('a non-notarization doc type (will) is also notarized:false', async () => {
    await saveDocumentToVault({ ...baseParams, docType: 'will' });
    expect(state.mainWrite?.data.notarized).toBe(false);
  });
});
