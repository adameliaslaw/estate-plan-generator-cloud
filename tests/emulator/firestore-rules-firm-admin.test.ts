/**
 * tests/emulator/firestore-rules-firm-admin.test.ts
 *
 * LIVE firestore.rules tests (rules-unit-testing against the Firestore
 * emulator) — unlike tests/unit/security-rules.test.ts, which is a static
 * text-match, these evaluate the real rules engine with real auth tokens.
 *
 * R5-037 — `isAdmin()` was a bare `hasRole('admin')` OR'd into every
 * firm-scoped match block, so an admin of ANY firm could read/write EVERY
 * firm's clients, documents, notes, payments, transcripts, templates, etc.
 * The fix introduces `isFirmAdmin(firmId) = isAdmin() && belongsToFirm(firmId)`
 * and uses it at every firm-scoped site; bare `isAdmin()` survives only on the
 * global single-tenant pipeline collections.
 *
 * AS (#55) — paralegals used to hold `canManageBilling`/`canManageFirmSettings`;
 * both were removed at the rules layer (and in usePermissions.ts — the UI half
 * is a T2 check).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

const FIRM_A = 'firm-rules-a';
const FIRM_B = 'firm-rules-b';

let env: RulesTestEnvironment;

// Token shapes mirror what createFirmUser sets as custom claims.
const ctx = (role: string, firmId: string, uid = `${role}-${firmId}`) =>
  env.authenticatedContext(uid, { role, firmId }).firestore();

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  env = await initializeTestEnvironment({
    // Distinct project id so the rules loaded here never interact with the
    // admin-SDK tests (which bypass rules on demo-eplan anyway).
    projectId: 'demo-eplan-rules',
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
      host,
      port: Number(port),
    },
  });

  // Seed both firms' data with rules disabled.
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await db.doc(`firms/${FIRM_A}`).set({ name: 'Firm A' });
    await db.doc(`firms/${FIRM_B}`).set({ name: 'Firm B' });
    await db.doc(`firms/${FIRM_A}/clients/client-1`).set({
      firmId: FIRM_A,
      personalInfo: { firstName: 'Ann', lastName: 'Client', email: 'ann@example.com' },
    });
    await db.doc(`firms/${FIRM_A}/clients/client-1/notes/note-1`).set({ firmId: FIRM_A, content: 'privileged' });
    await db.doc(`firms/${FIRM_A}/clients/client-1/payments/pay-1`).set({ firmId: FIRM_A, amount: 100, status: 'paid' });
    await db.doc(`firms/${FIRM_A}/knowledgeBase/kb-1`).set({ title: 'Firm A KB' });
    await db.doc(`firms/${FIRM_A}/documentTemplates/tpl-1`).set({ name: 'Firm A Will', isActive: true });
  });
});

afterAll(async () => {
  await env.cleanup();
});

describe('firestore.rules — firm-scoped admin (R5-037, live rules engine)', () => {
  it("a cross-firm ADMIN cannot read another firm's data", async () => {
    const adminB = ctx('admin', FIRM_B);
    await assertFails(adminB.doc(`firms/${FIRM_A}`).get());
    await assertFails(adminB.doc(`firms/${FIRM_A}/clients/client-1`).get());
    await assertFails(adminB.doc(`firms/${FIRM_A}/clients/client-1/notes/note-1`).get());
    await assertFails(adminB.doc(`firms/${FIRM_A}/clients/client-1/payments/pay-1`).get());
    await assertFails(adminB.doc(`firms/${FIRM_A}/knowledgeBase/kb-1`).get());
    await assertFails(adminB.doc(`firms/${FIRM_A}/documentTemplates/tpl-1`).get());
  });

  it("a cross-firm ADMIN cannot write another firm's data", async () => {
    const adminB = ctx('admin', FIRM_B);
    await assertFails(adminB.doc(`firms/${FIRM_A}/clients/client-1`).update({ tampered: true }));
    await assertFails(adminB.doc(`firms/${FIRM_A}/clients/client-1/notes/note-2`).set({ firmId: FIRM_A, content: 'x' }));
    await assertFails(adminB.doc(`firms/${FIRM_A}/clients/client-1/payments/pay-1`).delete());
    await assertFails(adminB.doc(`firms/${FIRM_A}/documentTemplates/tpl-1`).delete());
  });

  it('an admin still fully manages their OWN firm', async () => {
    const adminA = ctx('admin', FIRM_A);
    await assertSucceeds(adminA.doc(`firms/${FIRM_A}`).get());
    await assertSucceeds(adminA.doc(`firms/${FIRM_A}/clients/client-1`).get());
    await assertSucceeds(adminA.doc(`firms/${FIRM_A}/clients/client-1/notes/note-1`).get());
    await assertSucceeds(adminA.doc(`firms/${FIRM_A}/clients/client-1`).update({ reviewedBy: 'admin' }));
    await assertSucceeds(adminA.doc(`firms/${FIRM_A}/knowledgeBase/kb-1`).get());
    // Firm-settings update path (canManageFirmSettings ∧ belongsToFirm).
    await assertSucceeds(adminA.doc(`firms/${FIRM_A}`).update({ name: 'Firm A (renamed)' }));
  });
});

describe('firestore.rules — collection-group reads stay firm-scoped (R5-037)', () => {
  // The dashboard panels query notes/payments across all clients via
  // collection-group. The fix scopes these with isFirmAdmin(resource.data.firmId),
  // so the where('firmId','==',...) clause must make the query provably in-firm.
  it('in-firm staff still read their own firm via collection-group', async () => {
    const adminA = ctx('admin', FIRM_A);
    const attorneyA = ctx('attorney', FIRM_A);
    await assertSucceeds(adminA.collectionGroup('notes').where('firmId', '==', FIRM_A).get());
    await assertSucceeds(attorneyA.collectionGroup('payments').where('firmId', '==', FIRM_A).get());
  });

  it("a cross-firm admin cannot query another firm's notes/payments via collection-group", async () => {
    const adminB = ctx('admin', FIRM_B);
    await assertFails(adminB.collectionGroup('notes').where('firmId', '==', FIRM_A).get());
    await assertFails(adminB.collectionGroup('payments').where('firmId', '==', FIRM_A).get());
  });
});

describe('firestore.rules — paralegal billing/firm-settings removal (AS, live rules engine)', () => {
  it('a paralegal cannot write firm settings', async () => {
    const paralegalA = ctx('paralegal', FIRM_A);
    await assertFails(paralegalA.doc(`firms/${FIRM_A}`).update({ name: 'hijacked' }));
  });

  it('a paralegal cannot create or modify payment records', async () => {
    const paralegalA = ctx('paralegal', FIRM_A);
    await assertFails(
      paralegalA.doc(`firms/${FIRM_A}/clients/client-1/payments/pay-2`).set({ firmId: FIRM_A, amount: 1, status: 'paid' }),
    );
    await assertFails(
      paralegalA.doc(`firms/${FIRM_A}/clients/client-1/payments/pay-1`).update({ amount: 0 }),
    );
  });

  it('a paralegal still reads payments in their firm (billing review)', async () => {
    const paralegalA = ctx('paralegal', FIRM_A);
    await assertSucceeds(paralegalA.doc(`firms/${FIRM_A}/clients/client-1/payments/pay-1`).get());
  });
});
