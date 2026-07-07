/**
 * tests/unit/trust-generator-fortress.test.ts
 *
 * Regression test for R5-005: the fortress trust prompt must instruct the model
 * to generate an IRREVOCABLE trust. The pre-fix prompt injected a "JOINT
 * Revocable Living Trust" note, contradicting the Irrevocable/Medicaid-protection
 * label used everywhere else — and a revocable trust gives zero Medicaid
 * protection, defeating the entire purpose of the fortress package.
 *
 * We drive the real generateTrust() with callAI mocked so we can capture the
 * exact user prompt handed to the model and assert on the fortress branch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// firebase-admin is imported for its Timestamp/DocumentData types only.
vi.mock('firebase-admin', () => ({
  firestore: Object.assign(() => ({}), { DocumentData: {} }),
  initializeApp: vi.fn(),
}));

// generate-documents only supplies the GeneratedDoc type here.
vi.mock('../../functions/src/generate-documents', () => ({}));

// unified-generator pulls in the full generation tree (template engine, save
// helper, context aggregator, …). The trust generator only needs its pure
// buildStandardTitle helper — stub it to keep this a true unit test.
vi.mock('../../functions/src/unified-generator', () => ({
  buildStandardTitle: (_docType: string, name: string) =>
    `The ${name} Revocable Living Trust`,
}));

// Keep the real sanitize/JSON helpers; replace callAI with a capturing spy.
// vi.hoisted so the mock factory (hoisted to top) can reference it.
const { callAI } = vi.hoisted(() => ({
  callAI: vi.fn(async () => JSON.stringify({ title: 'Trust', content: '<h1>Trust</h1>' })),
}));
vi.mock('../../functions/src/ai-client', async () => {
  const actual = await vi.importActual<typeof import('../../functions/src/ai-client')>(
    '../../functions/src/ai-client',
  );
  return { ...actual, callAI };
});

import { generateTrust } from '../../functions/src/generators/trust-generator';

function trustClient() {
  return {
    personalInfo: { firstName: 'John', middleName: '', lastName: 'Smith' },
    fiduciaries: {
      trustee: { primary: { firstName: 'Jane', lastName: 'Smith', relationship: 'Spouse' } },
    },
    // Non-"Revocable" trust name so the fortress branch is the only source of
    // any revocability language in the prompt.
    distribution: { trustName: 'The Smith Family Protection Trust' },
    trusts: [],
    assets: { realEstate: [], bankAccounts: [], investmentAccounts: [] },
    specialConsiderations: {},
  };
}

function firm() {
  return { firmName: 'Elias Counsel LLC', documentDraftingModel: 'gpt-5.4' };
}

/** The user prompt is the 2nd positional arg to callAI. */
function capturedUserPrompt(): string {
  expect(callAI).toHaveBeenCalledTimes(1);
  return callAI.mock.calls[0][1] as string;
}

describe('trust-generator — fortress irrevocable prompt (R5-005)', () => {
  beforeEach(() => {
    callAI.mockClear();
  });

  it('fortress branch instructs an IRREVOCABLE trust', async () => {
    await generateTrust(trustClient(), firm(), 'fortress', [
      'Irrevocable Medicaid Asset Protection Trust',
    ]);
    const prompt = capturedUserPrompt();
    expect(prompt).toContain('IRREVOCABLE');
    expect(prompt).toContain('do NOT make it revocable');
  });

  it('fortress branch never emits the pre-fix "JOINT Revocable Living Trust" note', async () => {
    await generateTrust(trustClient(), firm(), 'fortress', [
      'Irrevocable Medicaid Asset Protection Trust',
    ]);
    const prompt = capturedUserPrompt();
    // The exact pre-fix string — a revocable fortress trust.
    expect(prompt).not.toContain('JOINT Revocable Living Trust');
  });

  it('non-fortress (foundation) branch injects no irrevocable note', async () => {
    await generateTrust(trustClient(), firm(), 'foundation');
    const prompt = capturedUserPrompt();
    expect(prompt).not.toContain('IRREVOCABLE');
    expect(prompt).not.toContain('do NOT make it revocable');
  });
});
