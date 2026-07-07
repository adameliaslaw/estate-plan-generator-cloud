/**
 * tests/emulator/document-save-version-race.test.ts
 *
 * Regression test for R5-033: `saveDocumentToVault` did a non-transactional
 * read-modify-write. Two concurrent saves to the same deterministic docId both
 * read currentVersion=N, both wrote N+1, and both appended a versionNumber:N+1
 * summary entry — losing one save's content, dropping a version snapshot, and
 * duplicating version numbers.
 *
 * The fix wraps read + version-number computation + prior-content snapshot +
 * write in a single `runTransaction`, so Firestore's optimistic concurrency
 * serializes them. This can only be proven against a real datastore — the unit
 * suite's Firestore mock doesn't execute runTransaction callbacks — so it runs
 * against the Firestore emulator.
 */

import { describe, it, expect } from 'vitest';
import { admin, uniq } from './_emulator';
import { saveDocumentToVault } from '../../functions/src/document-save-helper';

describe('saveDocumentToVault — concurrent version bump (R5-033)', () => {
  it('two parallel saves to the same docId produce contiguous, unique versions', async () => {
    const firmId = 'firm-race';
    const clientId = 'client-race';
    const documentId = uniq('will_race');

    const base = {
      firmId,
      clientId,
      documentId,
      docType: 'will',
      displayName: 'Last Will',
      status: 'draft' as const,
      createdBy: 'staff-1',
    };

    // Fire both saves concurrently at the same brand-new deterministic docId.
    const [r1, r2] = await Promise.all([
      saveDocumentToVault({ ...base, content: '<p>content A</p>' }),
      saveDocumentToVault({ ...base, content: '<p>content B</p>' }),
    ]);

    // Each save must land on a DISTINCT version — one v1 (create), one v2 (update).
    const returnedVersions = [r1.currentVersion, r2.currentVersion].sort((a, b) => a - b);
    expect(returnedVersions).toEqual([1, 2]);
    expect([r1.isNew, r2.isNew].filter(Boolean)).toHaveLength(1); // exactly one create

    const docPath = `firms/${firmId}/clients/${clientId}/documents/${documentId}`;
    const snap = await admin.firestore().doc(docPath).get();
    const data = snap.data()!;

    // The winning main doc is at v2 (not clobbered back to v1).
    expect(data.currentVersion).toBe(2);

    // The lightweight `versions` summary array must have NO duplicate numbers.
    const versionNumbers = (data.versions as Array<{ versionNumber: number }>)
      .map((v) => v.versionNumber)
      .sort((a, b) => a - b);
    expect(versionNumbers).toEqual([1, 2]);

    // Exactly one prior-content snapshot (v1) must survive in the subcollection —
    // pre-fix, a concurrent create could drop it.
    const versionsSnap = await admin.firestore().collection(`${docPath}/versions`).get();
    expect(versionsSnap.size).toBe(1);
    expect(versionsSnap.docs[0].id).toBe('v1');
  });
});
