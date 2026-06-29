/**
 * tests/unit/process-ocr-strip.test.ts
 *
 * Regression tests for audit finding BT: OCR extraction must not overwrite
 * existing client data with blanks. `stripEmpty` removes null/undefined/
 * empty-string values, empty arrays, and empty objects before the Firestore
 * merge, so only fields the model actually read are written.
 */

import { describe, it, expect, vi } from 'vitest';

// process-ocr imports firebase-functions/v1 + firebase-admin at module load.
vi.mock('firebase-functions/v1', () => ({
  region: () => ({ runWith: () => ({ https: { onCall: () => undefined } }) }),
  https: { HttpsError: class extends Error {} },
}));
vi.mock('firebase-admin', () => ({ firestore: () => ({}), storage: () => ({}) }));
vi.mock('openai', () => ({ OpenAI: class {} }));

import { stripEmpty } from '../../functions/src/process-ocr';

describe('stripEmpty — OCR blank-overwrite guard (BT)', () => {
  it('drops null, undefined, and empty-string scalars', () => {
    const out = stripEmpty({ firstName: 'Jane', middleName: null, suffix: '', phone: undefined });
    expect(out).toEqual({ firstName: 'Jane' });
  });

  it('removes a fully-blank nested object entirely (so it is not merged)', () => {
    const out = stripEmpty({
      personalInfo: { firstName: 'Jane', address: { street: null, city: '', state: null, zipCode: null } },
    });
    // address collapses to undefined and is dropped; only the real field remains.
    expect(out).toEqual({ personalInfo: { firstName: 'Jane' } });
  });

  it('drops empty arrays (a partial scan must not erase a populated section)', () => {
    expect(stripEmpty({ children: [] })).toBeUndefined();
    expect(stripEmpty({ firstName: 'Jane', children: [] })).toEqual({ firstName: 'Jane' });
  });

  it('keeps a populated array and strips blanks inside its elements', () => {
    const out = stripEmpty({ children: [{ fullName: 'Sam', dateOfBirth: null, specialNeeds: '' }] });
    expect(out).toEqual({ children: [{ fullName: 'Sam' }] });
  });

  it('returns undefined when the whole extraction is blank (no merge performed)', () => {
    expect(
      stripEmpty({
        personalInfo: { firstName: null, lastName: null, address: { street: null } },
        spouseInfo: { firstName: null },
        children: [],
      }),
    ).toBeUndefined();
  });

  it('preserves falsy-but-meaningful values (false, 0)', () => {
    const out = stripEmpty({ usCitizen: false, count: 0, note: null });
    expect(out).toEqual({ usCitizen: false, count: 0 });
  });
});
