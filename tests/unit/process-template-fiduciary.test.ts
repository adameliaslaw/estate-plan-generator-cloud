/**
 * tests/unit/process-template-fiduciary.test.ts
 *
 * Regression test for R5-041: fiduciary-path enforcement must only rewrite a
 * paragraph's {{fiduciaries.*}} variables when the paragraph unambiguously
 * concerns EXACTLY ONE role. The pre-fix code picked the FIRST matching role
 * and rewrote ALL fiduciary vars to it — corrupting paragraphs that name two
 * roles ("the Executor shall consult the Trustee" → both become executor).
 */

import { describe, it, expect, vi } from 'vitest';

// process-template-file registers onCall handlers at import and pulls in admin,
// mammoth, pdf-parse, and the template engine; none are touched by the pure
// enforceFiduciaryPaths helper. Stub them so import doesn't load native deps.
vi.mock('../../functions/node_modules/firebase-admin', () => ({
  storage: vi.fn(),
  firestore: Object.assign(() => ({}), { DocumentData: {} }),
  initializeApp: vi.fn(),
}));
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {},
}));
vi.mock('mammoth', () => ({ default: { convertToHtml: vi.fn(), extractRawText: vi.fn() } }));
vi.mock('pdf-parse', () => ({ PDFParse: class {} }));
vi.mock('../../functions/src/firm-secrets', () => ({ loadFirmSecrets: vi.fn() }));
vi.mock('../../functions/src/ai-client', () => ({ callAI: vi.fn(), parseAIJson: vi.fn() }));
vi.mock('../../functions/src/template-learning', () => ({
  getLearningContext: vi.fn(),
  formatLearningPrompt: vi.fn(),
  recordCorrection: vi.fn(),
  recordConfirmedVariables: vi.fn(),
}));
vi.mock('../../functions/src/template-engine', () => ({
  applyTemplateFormattingStyles: vi.fn(),
  extractTemplateVariables: vi.fn(),
}));
vi.mock('../../functions/src/template-fidelity-validator', () => ({
  compareHtmlStructure: vi.fn(),
  buildFidelityRetryInstruction: vi.fn(),
}));

import { enforceFiduciaryPaths } from '../../functions/src/process-template-file';

describe('enforceFiduciaryPaths — two-role paragraph left intact (R5-041)', () => {
  it('preserves BOTH roles when one paragraph names executor and trustee', () => {
    const html =
      '<p>The Executor shall consult the Trustee before acting. ' +
      'I appoint {{fiduciaries.executor.primary.name}} as Executor and ' +
      '{{fiduciaries.trustee.primary.name}} as Trustee.</p>';

    const { html: out, fixCount } = enforceFiduciaryPaths(html);

    // Pre-fix bug collapsed the trustee var to executor. Both must survive.
    expect(out).toContain('{{fiduciaries.executor.primary.name}}');
    expect(out).toContain('{{fiduciaries.trustee.primary.name}}');
    expect(fixCount).toBe(0);
  });

  it('still corrects a genuinely mis-pathed var in a single-role paragraph', () => {
    // Paragraph is unambiguously about the trustee, but the AI left an
    // executor-pathed var on the trustee's name — that must be corrected.
    const html =
      '<p>I appoint {{fiduciaries.executor.primary.name}} to serve as Trustee ' +
      'of my revocable trust.</p>';

    const { html: out, fixCount } = enforceFiduciaryPaths(html);

    expect(out).toContain('{{fiduciaries.trustee.primary.name}}');
    expect(out).not.toContain('{{fiduciaries.executor.primary.name}}');
    expect(fixCount).toBe(1);
  });

  it('leaves paragraphs with no fiduciary context untouched', () => {
    const html = '<p>This will is governed by the laws of New Jersey.</p>';
    const { html: out, fixCount } = enforceFiduciaryPaths(html);
    expect(out).toBe(html);
    expect(fixCount).toBe(0);
  });
});
