/**
 * tests/unit/email-escape-html.test.ts
 *
 * Regression tests for audit finding BJ / T9: caller-supplied request fields
 * (client/recipient names, descriptions, event details, links) are interpolated
 * into firm-branded email HTML and must be escaped to prevent HTML/content
 * injection. `escapeHtml` is the shared helper applied at every interpolation
 * site across the email senders + the createFirmUser welcome email.
 */

import { describe, it, expect, vi } from 'vitest';

// email-notifications imports firebase-functions/admin at module load (it
// registers onCall/onDocumentCreated handlers). Mock them so the pure helper
// can be imported in isolation.
vi.mock('firebase-functions/v2/https', () => ({
  onCall: () => undefined,
  HttpsError: class extends Error {},
}));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: () => undefined }));
vi.mock('firebase-functions/logger', () => ({ info: () => undefined, warn: () => undefined, error: () => undefined }));
vi.mock('firebase-admin', () => ({ firestore: () => ({}), storage: () => ({}) }));

import { escapeHtml } from '../../functions/src/email-notifications';

describe('escapeHtml', () => {
  it('neutralizes a script-tag injection', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('escapes attribute-breaking characters', () => {
    expect(escapeHtml('" onmouseover="alert(1)')).toBe(
      '&quot; onmouseover=&quot;alert(1)',
    );
    expect(escapeHtml("O'Brien & Sons")).toBe('O&#39;Brien &amp; Sons');
  });

  it('escapes ampersands in URLs for href attribute context', () => {
    expect(escapeHtml('https://x.test/q?a=1&b=2')).toBe(
      'https://x.test/q?a=1&amp;b=2',
    );
  });

  it('leaves ordinary names untouched', () => {
    expect(escapeHtml('Karen Polo')).toBe('Karen Polo');
  });

  it('returns an empty string for nullish input', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});
