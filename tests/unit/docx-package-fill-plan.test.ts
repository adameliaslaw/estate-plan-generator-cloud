/**
 * tests/unit/docx-package-fill-plan.test.ts
 *
 * Pure decision logic for high-fidelity package generation: which entries
 * fill the mapped firm .docx and which fall back to template mode (and why).
 */

import { describe, expect, it } from 'vitest';
import {
  DocxTemplateMapping,
  HF_EXCLUDED_DOC_TYPES,
  planHighFidelityEntry,
} from '../../functions/src/docx-package-fill';

function mapOf(...docTypes: string[]): Map<string, DocxTemplateMapping> {
  return new Map(docTypes.map((d) => [d, {
    docType: d,
    templateStoragePath: `firms/f1/templates/${d}.docx`,
  }]));
}

describe('planHighFidelityEntry', () => {
  it('fills mapped, non-property docTypes', () => {
    expect(planHighFidelityEntry('will', mapOf('will', 'poa'))).toEqual({ action: 'fill' });
    expect(planHighFidelityEntry('poa', mapOf('will', 'poa'))).toEqual({ action: 'fill' });
  });

  it('falls back with a mapping hint when no template is mapped', () => {
    const plan = planHighFidelityEntry('trust', mapOf('will'));
    expect(plan.action).toBe('fallback');
    expect(plan.fallbackReason).toContain('no firm .docx template is mapped for trust');
  });

  it('always falls back for per-property docTypes, even when mapped', () => {
    for (const docType of HF_EXCLUDED_DOC_TYPES) {
      const plan = planHighFidelityEntry(docType, mapOf(docType));
      expect(plan.action).toBe('fallback');
      expect(plan.fallbackReason).toContain('per property');
    }
  });

  it('fallback reasons are formatted as document warnings', () => {
    const plan = planHighFidelityEntry('livingWill', new Map());
    expect(plan.fallbackReason).toMatch(/^\[warning\] hf-fallback:/);
  });
});
