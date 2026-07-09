/**
 * tests/unit/unified-generator.test.ts
 *
 * Regression tests for the generateDocument() orchestrator:
 *
 *  - R5-002  packageType is taken from params (the tier the attorney selected
 *            for THIS run), falling back to the stored client doc — the batch
 *            entry point writes the requested tier only AFTER generation, so a
 *            first run must not re-derive it from the stale stored value.
 *  - R5-034  a spouse document with no spouse info on file throws
 *            failed-precondition and persists nothing (no PRIMARY duplicate in
 *            the `_spouse` slot).
 *  - R5-035  the spouse-swap gender inversion applies ONLY when the primary is
 *            'Married'; other statuses (e.g. Domestic Partnership) leave gender
 *            undefined.
 *  - R5-003  spouse title/pronouns derive from the primary's REAL gender, so a
 *            same-sex couple stays consistent instead of inverting the new
 *            testator's gender ("wife", she/her — not "husband").
 *
 * generateDocument touches Firestore, the generator registry, the template
 * engine, the serializer, and the save helper — all mocked so we can drive the
 * pure orchestration logic and capture what each collaborator received.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  clientDoc: {} as Record<string, unknown>,
  firmDoc: { firmName: 'Elias Counsel LLC' } as Record<string, unknown>,
  aggregateContext: null as unknown,
  genCalls: [] as Array<{ clientData: any; firmData: any; packageType: string; trustTypes: unknown }>,
  tmplCalls: [] as any[],
  saveCalls: [] as any[],
  genResult: { docType: 'trust', title: 'Trust', content: '<p>x</p>', status: 'draft' as const },
}));

// firebase-admin lives in functions/node_modules (no root copy) — mock by path
// so it actually intercepts the functions/src imports at runtime.
vi.mock('../../functions/node_modules/firebase-admin', () => ({
  firestore: Object.assign(
    () => ({
      doc: (path: string) => ({
        get: async () => ({
          exists: true,
          data: () => (path.includes('/clients/') ? H.clientDoc : H.firmDoc),
        }),
      }),
    }),
    { Timestamp: class {}, FieldValue: {}, DocumentData: {} },
  ),
  initializeApp: vi.fn(),
}));

vi.mock('../../functions/src/firm-secrets', () => ({
  loadFirmSecrets: vi.fn(async () => ({})),
}));
vi.mock('../../functions/src/client-context-aggregator', () => ({
  aggregateClientContext: vi.fn(async () => H.aggregateContext),
}));
vi.mock('../../functions/src/template-engine', () => ({
  generateFromTemplate: vi.fn(async (ctx: unknown) => {
    H.tmplCalls.push(ctx);
    return { ...H.genResult, resolvedMode: 'hybrid' };
  }),
}));
vi.mock('../../functions/src/generators/trust-generator', () => ({
  generateTrust: vi.fn(
    async (clientData: any, firmData: any, packageType: string, trustTypes: unknown) => {
      H.genCalls.push({ clientData, firmData, packageType, trustTypes });
      return H.genResult;
    },
  ),
}));
vi.mock('../../functions/src/document-save-helper', () => ({
  saveDocumentToVault: vi.fn(async (args: unknown) => {
    H.saveCalls.push(args);
    return { docId: 'trust', isNew: true, currentVersion: 1, storagePath: 'p' };
  }),
}));
vi.mock('../../functions/src/ai-memory', () => ({
  recordDraftHistory: vi.fn(async () => undefined),
}));
vi.mock('../../functions/src/ai-client', () => ({
  sanitizeForPrompt: (s: string) => s,
  sanitizeObject: <T>(o: T): T => o,
}));
vi.mock('../../functions/src/document-structure-validator', () => ({
  validateDocumentStructure: () => ({
    valid: true, missing: [], meetsMinimumLength: true, appearsTruncated: false, placeholderCount: 0,
  }),
  buildRetryInstruction: () => '',
}));
vi.mock('../../functions/src/doc-content-integrity-checker', () => ({
  checkContentIntegrity: () => ({ findings: [] }),
}));
vi.mock('../../functions/src/generators/summary-docs-generator', () => ({
  buildEstatePlanSummaryTemplateData: () => ({}),
  generateEstatePlanSummary: vi.fn(),
}));

import { generateDocument } from '../../functions/src/unified-generator';

const BASE = {
  firmId: 'firm-1',
  clientId: 'client-1',
  docType: 'trust',
  createdBy: 'user-1',
} as const;

beforeEach(() => {
  H.genCalls.length = 0;
  H.tmplCalls.length = 0;
  H.saveCalls.length = 0;
  H.aggregateContext = null;
});

// ===========================================================================
// R5-002 — packageType forwarding
// ===========================================================================

describe('generateDocument — packageType forwarding (R5-002)', () => {
  it('uses params.packageType over the stored client-doc value', async () => {
    H.clientDoc = { personalInfo: { firstName: 'A', lastName: 'B' }, packageDetails: { packageType: 'foundation' } };
    await generateDocument({ ...BASE, generationMode: 'ai', packageType: 'fortress' });

    expect(H.genCalls).toHaveLength(1);
    expect(H.genCalls[0].packageType).toBe('fortress');
  });

  it('falls back to the stored packageType when params omits it', async () => {
    H.clientDoc = { personalInfo: { firstName: 'A', lastName: 'B' }, packageDetails: { packageType: 'foundation' } };
    await generateDocument({ ...BASE, generationMode: 'ai' });

    expect(H.genCalls[0].packageType).toBe('foundation');
  });
});

// ===========================================================================
// R5-034 — spouse doc with no spouse info must not persist a duplicate
// ===========================================================================

describe('generateDocument — spouse-swap missing spouseInfo (R5-034)', () => {
  it('throws failed-precondition and saves nothing', async () => {
    H.clientDoc = { personalInfo: { firstName: 'A', lastName: 'B' } }; // no spouseInfo

    await expect(
      generateDocument({ ...BASE, generationMode: 'ai', spouseRole: 'spouse' }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    expect(H.saveCalls).toHaveLength(0);
    expect(H.genCalls).toHaveLength(0);
  });
});

// ===========================================================================
// R5-035 — gender inversion only for Married
// ===========================================================================

describe('generateDocument — spouse-swap gender gate (R5-035)', () => {
  it('inverts the primary gender for a Married couple', async () => {
    H.clientDoc = {
      personalInfo: { firstName: 'Primary', lastName: 'X', gender: 'female', maritalStatus: 'Married' },
      spouseInfo: { firstName: 'Spouse', lastName: 'X' }, // no gender on file
    };
    await generateDocument({ ...BASE, generationMode: 'ai', spouseRole: 'spouse' });

    // The swapped testator (the spouse) inherits the inverted primary gender.
    expect(H.genCalls[0].clientData.personalInfo.gender).toBe('male');
  });

  it('does NOT invert for a Domestic Partnership couple (gender left undefined)', async () => {
    H.clientDoc = {
      personalInfo: { firstName: 'Primary', lastName: 'X', gender: 'female', maritalStatus: 'Domestic Partnership' },
      spouseInfo: { firstName: 'Spouse', lastName: 'X' },
    };
    await generateDocument({ ...BASE, generationMode: 'ai', spouseRole: 'spouse' });

    expect(H.genCalls[0].clientData.personalInfo.gender).toBeUndefined();
  });
});

// ===========================================================================
// R5-003 — same-sex spouse title/pronouns from the primary's real gender
// ===========================================================================

describe('generateDocument — same-sex spouse title/pronouns (R5-003)', () => {
  it('derives spouse title/pronouns from the primary gender, not the inverted testator', async () => {
    // Client record: Karen (primary, female) + Anna (spouse, female), Married.
    H.clientDoc = {
      personalInfo: { firstName: 'Karen', lastName: 'Doe', gender: 'female', maritalStatus: 'Married' },
      spouseInfo: { firstName: 'Anna', lastName: 'Doe', gender: 'female' },
      fiduciaries: {},
      packageDetails: { packageType: 'guardian' },
    };
    H.aggregateContext = {
      client: {
        personalInfo: { firstName: 'Karen', lastName: 'Doe', gender: 'female', maritalStatus: 'Married' },
        spouseInfo: { firstName: 'Anna', lastName: 'Doe', gender: 'female' },
        fiduciaries: {},
      },
      computed: {
        clientFullName: 'Karen Doe',
        spouseFullName: 'Anna Doe',
        spouseTitle: 'x',
        clientTitle: 'x',
        clientPronouns: {},
        spousePronouns: {},
      },
    };

    // hybrid mode routes through the template engine, so we capture the swapped
    // clientContext handed to it.
    await generateDocument({ ...BASE, docType: 'trust', spouseRole: 'spouse' });

    expect(H.tmplCalls).toHaveLength(1);
    const ctx = H.tmplCalls[0];
    // Generating Anna's doc: the spouse is Karen (female) → "wife", she/her —
    // NOT "husband" from inverting Anna's own gender (the pre-fix bug).
    expect(ctx.computed.spouseTitle).toBe('wife');
    expect(ctx.computed.spousePronouns.subject).toBe('she');
    expect(ctx.computed.clientTitle).toBe('wife');
  });
});
