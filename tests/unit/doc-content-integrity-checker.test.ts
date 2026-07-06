/**
 * tests/unit/doc-content-integrity-checker.test.ts
 *
 * Unit tests for the post-generation content-integrity checker.
 * Confirms each rule fires on bad input and stays silent on clean input.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin', () => ({
  firestore: Object.assign(() => ({}), { DocumentData: {} }),
  initializeApp: vi.fn(),
}));

import {
  checkContentIntegrity,
} from '../../functions/src/doc-content-integrity-checker';

// ===========================================================================
// Universal checks
// ===========================================================================

describe('checkContentIntegrity — universal rules', () => {
  it('passes clean HTML with no findings', () => {
    const html = `
      <h2>ARTICLE I</h2>
      <p>I, <strong>JOHN SMITH</strong>, of Trenton, New Jersey, hereby revoke all prior wills.</p>
      <p>I appoint my spouse, <strong>JANE SMITH</strong>, as Executor.</p>
    `;
    const result = checkContentIntegrity(html, 'will');
    expect(result.findings).toHaveLength(0);
    expect(result.passed).toBe(true);
  });

  it('flags unresolved Handlebars variables', () => {
    const html = `<p>I, {{personalInfo.fullName}}, of {{personalInfo.county}}.</p>`;
    const result = checkContentIntegrity(html, 'will');
    expect(result.passed).toBe(false);
    expect(result.findings.some(f => f.name === 'Unresolved Handlebars variables' && f.severity === 'error')).toBe(true);
  });

  it('flags empty fiduciary slot pattern ", , ,"', () => {
    const html = `<p>I appoint <strong>John Smith</strong>, , , to serve as Executor.</p>`;
    const result = checkContentIntegrity(html, 'will');
    expect(result.passed).toBe(false);
    expect(result.findings.some(f => f.name === 'Empty fiduciary/list slot pattern')).toBe(true);
  });

  it('flags empty appointment clause', () => {
    const html = `<p>I appoint my , , to serve as Executor.</p>`;
    const result = checkContentIntegrity(html, 'will');
    expect(result.passed).toBe(false);
    expect(result.findings.some(f => f.name === 'Empty appointment clause')).toBe(true);
  });

  it('flags trailing Oxford-list fragment', () => {
    const html = `<p>I bequeath my estate to Adam, Karen, and .</p>`;
    const result = checkContentIntegrity(html, 'will');
    expect(result.findings.some(f => f.name === 'Trailing Oxford-list fragment')).toBe(true);
  });

  it('flags double-period typo', () => {
    const html = `<p>I name <strong>Adam Elias JR..</strong> as my Executor.</p>`;
    const result = checkContentIntegrity(html, 'will');
    expect(result.findings.some(f => f.name === 'Double-period typo')).toBe(true);
  });

  it('flags empty emphasis tag', () => {
    const html = `<p>I, <strong></strong>, hereby declare.</p>`;
    const result = checkContentIntegrity(html, 'will');
    expect(result.findings.some(f => f.name === 'Empty emphasis tag')).toBe(true);
  });

  it('flags missing space after parenthesis', () => {
    const html = `<p>(050422014)Attorney for the firm.</p>`;
    const result = checkContentIntegrity(html, 'will');
    expect(result.findings.some(f => f.name === 'Missing space after parenthesis')).toBe(true);
  });

  it('does not flag legitimate signature underscore runs', () => {
    const html = `<p>Signature: ____________________ Date: __________</p><p>I, JOHN SMITH, of New Jersey.</p>`;
    const result = checkContentIntegrity(html, 'will');
    expect(result.findings).toHaveLength(0);
  });
});

// ===========================================================================
// Client-data presence checks
// ===========================================================================

describe('checkContentIntegrity — client-data rules', () => {
  // Mirrors the real ClientContext shape: joined full names live on `computed`,
  // marital status on `client.personalInfo`.
  const ctx = {
    client: {
      personalInfo: { maritalStatus: 'married' },
    },
    computed: {
      clientFullName: 'Karen K. Elias',
      spouseFullName: 'Adam J. Elias',
    },
  } as unknown as Parameters<typeof checkContentIntegrity>[2];

  it('flags missing client name', () => {
    const html = `<p>I, <strong>SOMEONE ELSE</strong>, hereby declare.</p>`;
    const result = checkContentIntegrity(html, 'will', ctx);
    expect(result.passed).toBe(false);
    expect(result.findings.some(f => f.name === 'Client name missing' && f.severity === 'error')).toBe(true);
  });

  it('flags missing spouse name for married client', () => {
    const html = `<p>I, KAREN K. ELIAS, of Monroe Township, hereby declare.</p>`;
    const result = checkContentIntegrity(html, 'will', ctx);
    expect(result.findings.some(f => f.name === 'Spouse name missing' && f.severity === 'warning')).toBe(true);
  });

  it('flags missing spouse name when maritalStatus is "Married" (capital M)', () => {
    // Real client data uses "Married" (capital M). Checker normalizes via
    // toLowerCase() before comparing, so capital-M still triggers the spouse
    // check. Without normalization, two of three real clients in the vault
    // silently dropped the warning.
    const capitalMCtx = {
      client: { personalInfo: { maritalStatus: 'Married' } },
      computed: { clientFullName: 'Karen K. Elias', spouseFullName: 'Adam J. Elias' },
    } as unknown as Parameters<typeof checkContentIntegrity>[2];
    const html = `<p>I, KAREN K. ELIAS, of Monroe Township, hereby declare.</p>`;
    const result = checkContentIntegrity(html, 'will', capitalMCtx);
    expect(result.findings.some(f => f.name === 'Spouse name missing')).toBe(true);
  });

  it('passes when both client and spouse names appear', () => {
    const html = `
      <p>I, <strong>KAREN K. ELIAS</strong>, of Monroe Township, hereby declare.</p>
      <p>I appoint my husband, <strong>ADAM J. ELIAS</strong>, as Executor.</p>
    `;
    const result = checkContentIntegrity(html, 'will', ctx);
    expect(result.findings).toHaveLength(0);
  });

  it('skips name check for estatePlanSummary doc type', () => {
    const html = `<p>This is a generic summary letter with no names.</p>`;
    const result = checkContentIntegrity(html, 'estatePlanSummary', ctx);
    expect(result.findings.filter(f => f.name === 'Client name missing')).toHaveLength(0);
  });

  it('skips name checks when no client context provided', () => {
    const html = `<p>Generic content with no names referenced.</p>`;
    const result = checkContentIntegrity(html, 'will');
    expect(result.findings.filter(f => f.name.includes('name'))).toHaveLength(0);
  });
});
