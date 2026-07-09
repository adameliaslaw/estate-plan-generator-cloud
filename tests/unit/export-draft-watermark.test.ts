/**
 * tests/unit/export-draft-watermark.test.ts
 *
 * Regression test for R5-039: the DRAFT watermark must apply to EVERY non-final
 * document, not only status==='draft'. Pre-fix, 'review'/'needs_review'/
 * 'incomplete'/'error' documents exported as clean, final-looking legal
 * instruments. The fix gates the watermark on `status !== 'final'` at all export
 * sites. This locks the PDF exporter's pure HTML builder across statuses.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin', () => ({
  firestore: Object.assign(() => ({}), { DocumentData: {} }),
  initializeApp: vi.fn(),
  storage: () => ({}),
}));

// export-pdf registers a v1 callable at import time — stub the chained builder.
vi.mock('firebase-functions/v1', () => {
  const builder: Record<string, unknown> = {};
  builder.runWith = () => builder;
  builder.region = () => builder;
  builder.https = {
    onCall: (fn: unknown) => fn,
    HttpsError: class extends Error {},
  };
  return { ...builder, default: builder };
});

vi.mock('puppeteer-core', () => ({ default: { launch: vi.fn() } }));
vi.mock('@sparticuz/chromium', () => ({ default: {} }));

import { buildLegalDocumentHtml } from '../../functions/src/export-pdf';

// The visible watermark is the CSS `body::before` overlay — present only for a
// non-final doc. (A hidden `.draft-banner` div is always in the markup but is
// `display:none` for final, so its text is not a reliable discriminator.)
const WATERMARK_CSS = 'content: "DRAFT — NOT YET EXECUTED"';
const NON_FINAL_STATUSES = ['draft', 'review', 'needs_review', 'incomplete', 'error'];

describe('export-pdf — DRAFT watermark gate (R5-039)', () => {
  it.each(NON_FINAL_STATUSES)('applies the watermark for status="%s"', (status) => {
    const html = buildLegalDocumentHtml('Last Will', '<p>body</p>', status);
    expect(html).toContain(WATERMARK_CSS);
    // …and the visible draft banner is shown, not hidden.
    expect(html).not.toContain('.draft-banner { display: none; }');
  });

  it('omits the watermark only for status="final"', () => {
    const html = buildLegalDocumentHtml('Last Will', '<p>body</p>', 'final');
    expect(html).not.toContain(WATERMARK_CSS);
    // The banner is present in markup but hidden for a final, executed doc.
    expect(html).toContain('.draft-banner { display: none; }');
  });

  it('an unknown/empty status is treated as non-final and watermarked', () => {
    expect(buildLegalDocumentHtml('Will', '<p>x</p>', '')).toContain(WATERMARK_CSS);
    expect(buildLegalDocumentHtml('Will', '<p>x</p>', 'signed')).toContain(WATERMARK_CSS);
  });
});
