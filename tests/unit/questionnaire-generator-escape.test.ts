import { describe, it, expect } from 'vitest';
import { generateQuestionnaire } from '../../functions/src/generators/questionnaire-generator';

/**
 * R5-042 regression: the Questionnaire Summary is built by direct HTML string
 * interpolation of client-controlled fields and is later rendered in the
 * attorney's browser. Every such field must be HTML-escaped so a client can't
 * store script/HTML injection via a name, note, or address field.
 */
describe('generateQuestionnaire — HTML escaping (R5-042)', () => {
  const XSS = '<script>alert(1)</script>';
  const IMG = '<img src=x onerror=alert(2)>';

  it('escapes client-controlled fields across name, address, notes, and fiduciaries', async () => {
    const clientData = {
      personalInfo: {
        firstName: XSS,
        lastName: 'Smith',
        address: IMG,
        city: 'Trenton',
        state: 'NJ',
        zip: '08608',
        maritalStatus: 'single',
      },
      assets: {
        notes: XSS,
        realEstate: [{ address: IMG, city: 'Newark', state: 'NJ' }],
      },
      fiduciaries: {
        executor: { primary: { name: XSS, relationship: 'Friend', email: XSS } },
      },
    };

    const result = await generateQuestionnaire(clientData, {}, 'foundation');
    const html = result.content;

    // No raw injectable tag survives anywhere in the output — the escaped
    // forms may still contain the literal text "onerror=", but never as a live
    // element, so we check for the raw opening tags.
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    // The values are present, but escaped.
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');
  });
});
