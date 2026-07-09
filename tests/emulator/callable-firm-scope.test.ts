/**
 * tests/emulator/callable-firm-scope.test.ts
 *
 * Regression tests for the #54 privilege/tenancy cluster (T3 multi-tenant):
 *
 *   AP — `createFirmUser` let any staff caller mint `role:'admin'` (and a
 *        rules-layer admin bypasses firm scoping → cross-tenant breach).
 *        Now only an admin may grant the admin role.
 *   AQ — `createFirmUser` was callable by any authenticated user. Now only
 *        admins/attorneys of the SAME firm may create users.
 *   AZ/BB — `listTemplates`/`getTemplateContent` used the broken predicate
 *        (`callerFirmId && callerFirmId !== firmId && role !== 'admin'`): a
 *        caller with NO firm claim passed, and any firm's admin could read
 *        another firm's templates. Now the firm claim must match.
 *   BA — same broken predicate on `searchKnowledgeResources` leaked another
 *        firm's up-to-200 KB resources. Same fix.
 *
 * Drives the REAL onCall handlers against the Firestore emulator. All of these
 * gates read `request.auth.token` claims (createFirmUser falls back to them
 * when no profile doc exists), so identities are expressed as crafted tokens.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { admin } from './_emulator';

// v2 callable — return the raw handler. A bare mock no-ops when the module
// resolves through functions/node_modules and is invoked, so mock both paths.
vi.mock('../../functions/node_modules/firebase-functions/lib/esm/v2/providers/https.mjs', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
  },
}));
vi.mock('../../functions/node_modules/firebase-functions/lib/v2/providers/https.js', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
  },
}));

import { createFirmUser } from '../../functions/src/user-management';
import { listTemplates, getTemplateContent } from '../../functions/src/seed-templates';
import { searchKnowledgeResources } from '../../functions/src/knowledge-base';

type Handler = (req: unknown) => Promise<Record<string, unknown>>;
const call = (fn: unknown, token: Record<string, unknown>, data: Record<string, unknown>, uid = 'caller-uid') =>
  (fn as Handler)({ auth: { uid, token }, data });

const FIRM_A = 'firm-scope-a';
const FIRM_B = 'firm-scope-b';

describe('createFirmUser — privilege lockdown (AP/AQ)', () => {
  const newUser = {
    firmId: FIRM_A,
    email: 'new-user@example.com',
    firstName: 'New',
    lastName: 'User',
  };

  it('an attorney cannot mint an admin (AP)', async () => {
    await expect(
      call(createFirmUser, { role: 'attorney', firmId: FIRM_A }, { ...newUser, role: 'admin' }),
    ).rejects.toMatchObject({
      code: 'permission-denied',
      message: expect.stringContaining('Only an admin can grant the admin role'),
    });
  });

  it('a paralegal cannot create users at all (AQ)', async () => {
    await expect(
      call(createFirmUser, { role: 'paralegal', firmId: FIRM_A }, { ...newUser, role: 'attorney' }),
    ).rejects.toMatchObject({
      code: 'permission-denied',
      message: expect.stringContaining('Only an admin or attorney'),
    });
  });

  it('a client cannot create users at all (AQ)', async () => {
    await expect(
      call(createFirmUser, { role: 'client', firmId: FIRM_A }, { ...newUser, role: 'attorney' }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it("another firm's admin cannot create users in this firm (AQ)", async () => {
    await expect(
      call(createFirmUser, { role: 'admin', firmId: FIRM_B }, { ...newUser, role: 'attorney' }),
    ).rejects.toMatchObject({
      code: 'permission-denied',
      message: expect.stringContaining('different firm'),
    });
  });
});

describe('template + KB callables — firm-scope predicate (AZ/BA/BB)', () => {
  beforeAll(async () => {
    const db = admin.firestore();
    // Firm B owns a template and a KB resource — the cross-tenant read targets.
    await db.doc(`firms/${FIRM_B}/documentTemplates/tpl-b`).set({
      isActive: true, docType: 'will', complexity: 1,
      name: 'Firm B Will', content: 'FIRM B CONFIDENTIAL TEMPLATE',
    });
    await db.doc(`firms/${FIRM_B}/knowledgeBase/kb-b`).set({
      isActive: true, title: 'Firm B KB', content: 'FIRM B CONFIDENTIAL RESOURCE',
      category: 'statute',
    });
  });

  const crossTenantCases: Array<[string, unknown, Record<string, unknown>]> = [
    ['listTemplates', listTemplates, { firmId: FIRM_B }],
    ['getTemplateContent', getTemplateContent, { firmId: FIRM_B, templateId: 'tpl-b' }],
    ['searchKnowledgeResources', searchKnowledgeResources, { firmId: FIRM_B }],
  ];

  it.each(crossTenantCases)(
    "%s — Firm A's ADMIN cannot read Firm B's data (old predicate admitted any admin)",
    async (_name, fn, data) => {
      await expect(
        call(fn, { role: 'admin', firmId: FIRM_A }, data),
      ).rejects.toMatchObject({
        code: 'permission-denied',
        message: expect.stringContaining('Cross-firm'),
      });
    },
  );

  it.each(crossTenantCases)(
    '%s — a caller with NO firm claim is rejected (old predicate let them through)',
    async (_name, fn, data) => {
      await expect(
        call(fn, { role: 'admin' }, data),
      ).rejects.toMatchObject({ code: 'permission-denied' });
    },
  );

  it('a same-firm caller still reads their own firm (positive control)', async () => {
    const tokenB = { role: 'attorney', firmId: FIRM_B };

    const list = await call(listTemplates, tokenB, { firmId: FIRM_B });
    expect(list.success).toBe(true);
    expect(list.count).toBe(1);

    const tpl = await call(getTemplateContent, tokenB, { firmId: FIRM_B, templateId: 'tpl-b' });
    expect((tpl.template as Record<string, unknown>).content).toBe('FIRM B CONFIDENTIAL TEMPLATE');

    const kb = await call(searchKnowledgeResources, tokenB, { firmId: FIRM_B });
    expect(kb.count).toBe(1);
  });
});
