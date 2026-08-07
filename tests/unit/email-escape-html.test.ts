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

import {
  escapeHtml,
  processCustomTemplate,
  buildEmailHtml,
  clientContactFields,
} from '../../functions/src/email-notifications';

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

describe('processCustomTemplate — R5-056 stored-XSS in custom email templates', () => {
  const template = { subject: 'Hello {{clientName}}', content: '<p>Hi {{clientName}}, {{link}}</p>' };

  it('HTML-escapes caller-supplied variables in the body', () => {
    const { bodyHtml } = processCustomTemplate(template, {
      clientName: '<script>alert(1)</script>',
      link: '',
    });
    expect(bodyHtml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(bodyHtml).not.toContain('<script>');
  });

  it('inserts explicitly-trusted HTML keys raw', () => {
    const { bodyHtml } = processCustomTemplate(template, {
      clientName: 'Karen',
      link: '<a href="https://x.test">link</a>',
    }, new Set(['link']));
    expect(bodyHtml).toContain('<a href="https://x.test">link</a>');
  });

  it('does not HTML-escape the plain-text subject', () => {
    const { subject } = processCustomTemplate(template, { clientName: 'O\'Brien & Sons', link: '' });
    expect(subject).toBe("Hello O'Brien & Sons");
  });
});

describe('buildEmailHtml — issue #166: firm branding fields are escaped too', () => {
  // Branding comes from the firm document, which attorneys edit freely in
  // Settings. The T9 fix escaped caller-supplied request fields but left these
  // interpolated raw into every outbound email.
  const branding = {
    firmName: 'Elias Law',
    firmPhone: '555-1234',
    firmEmail: 'firm@x.test',
    logoUrl: '',
    primaryColor: '#1a365d',
  };

  it('escapes a firmName carrying markup everywhere it appears', () => {
    const html = buildEmailHtml('<p>body</p>', {
      ...branding,
      firmName: '</title><script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('drops a non-http(s) logo URL instead of rendering it as an image src', () => {
    const html = buildEmailHtml('<p>body</p>', {
      ...branding,
      logoUrl: 'javascript:alert(1)',
    });
    expect(html).not.toContain('javascript:alert(1)');
    expect(html).not.toContain('<img');
  });

  it('renders an https logo with attribute-breaking characters escaped', () => {
    const html = buildEmailHtml('<p>body</p>', {
      ...branding,
      logoUrl: 'https://x.test/logo.png?a=1&b="quoted"',
    });
    expect(html).toContain('<img src="https://x.test/logo.png?a=1&amp;b=&quot;quoted&quot;"');
  });

  it('escapes a primaryColor that tries to break out of its style attribute', () => {
    const html = buildEmailHtml('<p>body</p>', {
      ...branding,
      primaryColor: '#fff" onload="alert(1)',
    });
    expect(html).not.toContain('" onload="');
  });
});

describe('clientContactFields — issue #171: welcome email reads the real field paths', () => {
  it('finds email and name under personalInfo (the Client data model shape)', () => {
    expect(clientContactFields({
      personalInfo: { firstName: 'Karen', lastName: 'Elias', email: 'karen@x.test' },
    })).toEqual({ email: 'karen@x.test', name: 'Karen Elias' });
  });

  it('still honors legacy top-level fields, which win over personalInfo', () => {
    expect(clientContactFields({
      email: 'top@x.test',
      firstName: 'Top',
      personalInfo: { firstName: 'Karen', email: 'karen@x.test' },
    })).toEqual({ email: 'top@x.test', name: 'Top' });
  });

  it('returns no email and the fallback name for an empty record', () => {
    expect(clientContactFields({})).toEqual({ email: undefined, name: 'Client' });
  });
});
