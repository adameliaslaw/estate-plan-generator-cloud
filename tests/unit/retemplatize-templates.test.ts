/**
 * tests/unit/retemplatize-templates.test.ts
 *
 * Regression test for R5-065: force-mode retemplatization stripping must blank
 * only leaf {{variable}} placeholders. The pre-fix code blanked ALL {{...}},
 * destroying block helpers ({{#each}}/{{#if}}/{{else}}), partials, comments, and
 * loop-internal references ({{this}}/{{@index}}) — collapsing the loop/conditional
 * structure the AI can't reconstruct from underscores. stripLeafVariables must
 * preserve structure while blanking leaves.
 */

import { describe, it, expect, vi } from 'vitest';

// retemplatize-templates registers an onCall at import and pulls in admin + the
// template engine; none are touched by the pure stripLeafVariables helper.
vi.mock('../../functions/node_modules/firebase-admin', () => ({
  firestore: Object.assign(() => ({}), { DocumentData: {} }),
  initializeApp: vi.fn(),
}));
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {},
}));
vi.mock('../../functions/src/firm-secrets', () => ({ loadFirmSecrets: vi.fn() }));
vi.mock('../../functions/src/ai-client', () => ({ callAI: vi.fn() }));
vi.mock('../../functions/src/template-engine', () => ({
  applyTemplateFormattingStyles: vi.fn(),
  extractTemplateVariables: vi.fn(),
}));
vi.mock('../../functions/src/template-fidelity-validator', () => ({
  compareHtmlStructure: vi.fn(),
  buildFidelityRetryInstruction: vi.fn(),
}));

import { stripLeafVariables } from '../../functions/src/retemplatize-templates';

describe('stripLeafVariables — preserves block structure (R5-065)', () => {
  const html =
    '<h1>{{clientName}}</h1>' +
    '{{#each children}}<li>{{this.name}} ({{@index}}) — {{relationship}}</li>' +
    '{{else}}<li>none</li>{{/each}}' +
    '{{#if hasTrust}}<p>{{trustName}}</p>{{/if}}' +
    '{{! internal note }}{{> signatureBlock}}';

  const out = stripLeafVariables(html);

  it('preserves block-open/close, else, if, partials, and comments', () => {
    expect(out).toContain('{{#each children}}');
    expect(out).toContain('{{/each}}');
    expect(out).toContain('{{else}}');
    expect(out).toContain('{{#if hasTrust}}');
    expect(out).toContain('{{/if}}');
    expect(out).toContain('{{! internal note }}');
    expect(out).toContain('{{> signatureBlock}}');
  });

  it('preserves loop-internal references ({{this}}/{{@index}})', () => {
    expect(out).toContain('{{this.name}}');
    expect(out).toContain('{{@index}}');
  });

  it('blanks leaf variables — including leaves inside a loop', () => {
    expect(out).not.toContain('{{clientName}}');
    expect(out).not.toContain('{{relationship}}');
    expect(out).not.toContain('{{trustName}}');
    expect(out).toContain('_______________');
  });
});
