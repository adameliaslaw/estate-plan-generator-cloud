/**
 * tests/unit/interview-settings-apply.test.ts
 *
 * D2 — the first consumer of the D1 FirmInterviewSettings record. The bridge
 * maps the interview default onto the firmData field will-generator already
 * reads (taxApportionmentMode), with the stated precedence: interview setting
 * > legacy firm field > code default. It must never fail a generation: no
 * record, an unrecognized value, or a failed read all leave firmData exactly
 * as it was.
 */
import { describe, it, expect, vi } from 'vitest';
import * as admin from 'firebase-admin';
import { applyInterviewSettingsToFirmData } from '../../functions/src/interview-settings';

function dbWithInterviewDoc(doc: { exists: boolean; fields?: Record<string, unknown> }) {
  return {
    doc: vi.fn((path: string) => {
      expect(path).toBe('firms/firm-001/interviewSettings/current');
      return {
        get: vi.fn(async () => ({
          exists: doc.exists,
          get: (field: string) => (doc.fields ?? {})[field],
        })),
      };
    }),
  } as unknown as admin.firestore.Firestore;
}

describe('applyInterviewSettingsToFirmData (D2)', () => {
  it('maps the interview apportionment default onto taxApportionmentMode, overriding the legacy field', async () => {
    const firmData: Record<string, unknown> = { taxApportionmentMode: 'residuary' };
    await applyInterviewSettingsToFirmData(
      dbWithInterviewDoc({ exists: true, fields: { trust: { apportionmentMode: 'apportioned' } } }),
      'firm-001',
      firmData,
    );
    expect(firmData.taxApportionmentMode).toBe('apportioned');
  });

  it('leaves the legacy field alone when the record has no apportionment election', async () => {
    const firmData: Record<string, unknown> = { taxApportionmentMode: 'residuary' };
    await applyInterviewSettingsToFirmData(
      dbWithInterviewDoc({ exists: true, fields: { trust: {} } }),
      'firm-001',
      firmData,
    );
    expect(firmData.taxApportionmentMode).toBe('residuary');
  });

  it('ignores an unrecognized mode value rather than writing it through', async () => {
    const firmData: Record<string, unknown> = {};
    await applyInterviewSettingsToFirmData(
      dbWithInterviewDoc({ exists: true, fields: { trust: { apportionmentMode: 'per-stirpes' } } }),
      'firm-001',
      firmData,
    );
    expect(firmData.taxApportionmentMode).toBeUndefined();
  });

  it('changes nothing when no interview record exists', async () => {
    const firmData: Record<string, unknown> = {};
    await applyInterviewSettingsToFirmData(dbWithInterviewDoc({ exists: false }), 'firm-001', firmData);
    expect(firmData).toEqual({});
  });

  it('a failed read degrades silently — firm defaults must never fail a generation', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = {
      doc: vi.fn(() => ({ get: vi.fn(async () => Promise.reject(new Error('unavailable'))) })),
    } as unknown as admin.firestore.Firestore;

    const firmData: Record<string, unknown> = { taxApportionmentMode: 'hybrid' };
    await expect(
      applyInterviewSettingsToFirmData(db, 'firm-001', firmData),
    ).resolves.toBeUndefined();
    expect(firmData.taxApportionmentMode).toBe('hybrid');

    warnSpy.mockRestore();
  });
});
