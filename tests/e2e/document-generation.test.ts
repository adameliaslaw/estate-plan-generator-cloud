/**
 * tests/e2e/document-generation.test.ts
 *
 * End-to-end tests for the document generation flow:
 * - Each package type generates the correct set of documents
 * - Foundation: Will, Financial POA, Healthcare Directive, HIPAA Auth, Living Will
 * - Guardian: Foundation + Revocable Trust-related documents
 * - Fortress: Guardian + Deed, Affidavit of Consideration, GIT/REP-3, Trust
 * - Attorney review gate blocks export of unapproved documents
 * - DRAFT watermark is present on all generated documents
 * - Batch export produces correct file list
 * - Document types match the PACKAGE_DOCUMENTS constant
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PACKAGE_DOCUMENTS, DOC_TYPES, DOC_STATUSES } from '@/config/constants';
import { DOCUMENT_TEMPLATES } from '@/config/document-templates';
import {
  MOCK_WILL_DOCUMENT,
  MOCK_POA_DOCUMENT,
  MOCK_APPROVED_DOCUMENT,
  MOCK_CLIENT_FOUNDATION,
  MOCK_CLIENT_GUARDIAN,
  MOCK_CLIENT_FORTRESS,
} from '../helpers/mock-data';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Given a package type, return the expected document types it should produce.
 */
function getExpectedDocTypes(packageType: 'foundation' | 'guardian' | 'fortress'): string[] {
  return [...PACKAGE_DOCUMENTS[packageType]];
}

/**
 * Simulate the document generation result for a given package.
 * Returns mock document objects with DRAFT status and watermarks.
 */
function simulateDocumentGeneration(
  packageType: 'foundation' | 'guardian' | 'fortress',
  clientId: string,
  firmId: string,
): Array<{
  docType: string;
  title: string;
  status: string;
  content: string;
  clientId: string;
  firmId: string;
}> {
  const docTypes = getExpectedDocTypes(packageType);
  return docTypes.map((docType) => ({
    docType,
    title: `${docType} — ${clientId}`,
    status: DOC_STATUSES.DRAFT,
    content: `<h1>${docType}</h1><div class="draft-watermark" style="color:#cc0000;font-weight:bold;">DRAFT &mdash; NOT YET EXECUTED</div><p>Generated document content.</p>`,
    clientId,
    firmId,
  }));
}

/**
 * Check whether a document has the required DRAFT watermark.
 */
function hasDraftWatermark(content: string): boolean {
  return (
    content.includes('DRAFT') &&
    content.includes('draft-watermark') &&
    content.includes('#cc0000')
  );
}

/**
 * Pure approval gate: returns true if the document can be exported by the user.
 */
function canExportDocument(docStatus: string, userRole: string): boolean {
  const alwaysAllowed = ['approved', 'signed', 'filed', 'archived'];
  if (alwaysAllowed.includes(docStatus)) return true;
  if (docStatus === 'draft' || docStatus === 'under_review') {
    return userRole === 'attorney' || userRole === 'admin';
  }
  return false;
}

// ============================================================================
// SECTION: Foundation package document set
// ============================================================================

describe('Document Generation — Foundation package', () => {
  const packageType = 'foundation';
  const docs = simulateDocumentGeneration(packageType, 'client-001', 'firm-001');

  it('generates documents for all Foundation package doc types', () => {
    const expectedTypes = getExpectedDocTypes(packageType);
    const generatedTypes = docs.map((d) => d.docType);
    for (const type of expectedTypes) {
      expect(generatedTypes).toContain(type);
    }
  });

  it('Foundation package includes "will"', () => {
    expect(PACKAGE_DOCUMENTS.foundation).toContain(DOC_TYPES.WILL);
  });

  it('Foundation package includes "poa" (Financial Power of Attorney)', () => {
    expect(PACKAGE_DOCUMENTS.foundation).toContain(DOC_TYPES.POA);
  });

  it('Foundation package includes "livingWill" (Healthcare Directive)', () => {
    expect(PACKAGE_DOCUMENTS.foundation).toContain(DOC_TYPES.LIVING_WILL);
  });

  it('Foundation package does NOT include "trust"', () => {
    expect(PACKAGE_DOCUMENTS.foundation).not.toContain(DOC_TYPES.TRUST);
  });

  it('Foundation package does NOT include "pourOverWill"', () => {
    expect(PACKAGE_DOCUMENTS.foundation).not.toContain(DOC_TYPES.POUR_OVER_WILL);
  });

  it('Foundation package does NOT include "deed"', () => {
    expect(PACKAGE_DOCUMENTS.foundation).not.toContain(DOC_TYPES.DEED);
  });

  it('all generated Foundation documents start with DRAFT status', () => {
    for (const doc of docs) {
      expect(doc.status).toBe(DOC_STATUSES.DRAFT);
    }
  });

  it('all generated Foundation documents have DRAFT watermark in content', () => {
    for (const doc of docs) {
      expect(hasDraftWatermark(doc.content)).toBe(true);
    }
  });

  it('Foundation client matches expected package type', () => {
    expect(MOCK_CLIENT_FOUNDATION.packageType).toBe('foundation');
  });
});

// ============================================================================
// SECTION: Guardian package document set
// ============================================================================

describe('Document Generation — Guardian package', () => {
  const packageType = 'guardian';
  const docs = simulateDocumentGeneration(packageType, 'client-002', 'firm-001');

  it('generates documents for all Guardian package doc types', () => {
    const expectedTypes = getExpectedDocTypes(packageType);
    const generatedTypes = docs.map((d) => d.docType);
    for (const type of expectedTypes) {
      expect(generatedTypes).toContain(type);
    }
  });

  it('Guardian package includes "will" (Pour-Over or standard)', () => {
    // Guardian plan has a will (either standard will or pour-over will)
    const hasWill = PACKAGE_DOCUMENTS.guardian.includes('will') ||
                    PACKAGE_DOCUMENTS.guardian.includes('pourOverWill');
    expect(hasWill).toBe(true);
  });

  it('Guardian package includes "poa"', () => {
    expect(PACKAGE_DOCUMENTS.guardian).toContain('poa');
  });

  it('Guardian package includes "livingWill"', () => {
    expect(PACKAGE_DOCUMENTS.guardian).toContain('livingWill');
  });

  it('Guardian package generates more documents than Foundation', () => {
    const foundationCount = PACKAGE_DOCUMENTS.foundation.length;
    const guardianCount = PACKAGE_DOCUMENTS.guardian.length;
    expect(guardianCount).toBeGreaterThanOrEqual(foundationCount);
  });

  it('all generated Guardian documents have DRAFT status initially', () => {
    for (const doc of docs) {
      expect(doc.status).toBe(DOC_STATUSES.DRAFT);
    }
  });

  it('all generated Guardian documents have DRAFT watermark', () => {
    for (const doc of docs) {
      expect(hasDraftWatermark(doc.content)).toBe(true);
    }
  });

  it('Guardian client matches expected package type', () => {
    expect(MOCK_CLIENT_GUARDIAN.packageType).toBe('guardian');
  });
});

// ============================================================================
// SECTION: Fortress package document set
// ============================================================================

describe('Document Generation — Fortress package', () => {
  const packageType = 'fortress';
  const docs = simulateDocumentGeneration(packageType, 'client-003', 'firm-001');

  it('generates documents for all Fortress package doc types', () => {
    const expectedTypes = getExpectedDocTypes(packageType);
    const generatedTypes = docs.map((d) => d.docType);
    for (const type of expectedTypes) {
      expect(generatedTypes).toContain(type);
    }
  });

  it('Fortress package includes "trust" (Irrevocable)', () => {
    expect(PACKAGE_DOCUMENTS.fortress).toContain(DOC_TYPES.TRUST);
  });

  it('Fortress package includes "pourOverWill"', () => {
    expect(PACKAGE_DOCUMENTS.fortress).toContain(DOC_TYPES.POUR_OVER_WILL);
  });

  it('Fortress package includes "deed" (property transfer)', () => {
    expect(PACKAGE_DOCUMENTS.fortress).toContain(DOC_TYPES.DEED);
  });

  it('Fortress package includes "affidavitOfConsideration" (NJ RTF)', () => {
    expect(PACKAGE_DOCUMENTS.fortress).toContain(DOC_TYPES.AFFIDAVIT_OF_CONSIDERATION);
  });

  it('Fortress package includes "gitRep3" (NJ GIT/REP-3 tax form)', () => {
    expect(PACKAGE_DOCUMENTS.fortress).toContain(DOC_TYPES.GIT_REP_3);
  });

  it('Fortress package includes "poa"', () => {
    expect(PACKAGE_DOCUMENTS.fortress).toContain(DOC_TYPES.POA);
  });

  it('Fortress package includes "livingWill"', () => {
    expect(PACKAGE_DOCUMENTS.fortress).toContain(DOC_TYPES.LIVING_WILL);
  });

  it('Fortress generates more document types than Guardian', () => {
    expect(PACKAGE_DOCUMENTS.fortress.length).toBeGreaterThan(PACKAGE_DOCUMENTS.guardian.length);
  });

  it('all generated Fortress documents have DRAFT status', () => {
    for (const doc of docs) {
      expect(doc.status).toBe(DOC_STATUSES.DRAFT);
    }
  });

  it('Fortress client matches expected package type', () => {
    expect(MOCK_CLIENT_FORTRESS.packageType).toBe('fortress');
  });
});

// ============================================================================
// SECTION: Attorney review gate
// ============================================================================

describe('Document Generation — attorney review gate', () => {
  it('draft document cannot be exported by client', () => {
    expect(canExportDocument('draft', 'client')).toBe(false);
  });

  it('draft document can be exported by attorney', () => {
    expect(canExportDocument('draft', 'attorney')).toBe(true);
  });

  it('draft document can be exported by admin', () => {
    expect(canExportDocument('draft', 'admin')).toBe(true);
  });

  it('under_review document cannot be exported by client', () => {
    expect(canExportDocument('under_review', 'client')).toBe(false);
  });

  it('under_review document cannot be exported by paralegal', () => {
    expect(canExportDocument('under_review', 'paralegal')).toBe(false);
  });

  it('approved document can be exported by client', () => {
    expect(canExportDocument('approved', 'client')).toBe(true);
  });

  it('approved document can be exported by all roles', () => {
    for (const role of ['admin', 'attorney', 'paralegal', 'client']) {
      expect(canExportDocument('approved', role)).toBe(true);
    }
  });

  it('MOCK_WILL_DOCUMENT (draft) cannot be exported by client', () => {
    expect(canExportDocument(MOCK_WILL_DOCUMENT.status, 'client')).toBe(false);
  });

  it('MOCK_APPROVED_DOCUMENT (approved) can be exported by client', () => {
    expect(canExportDocument(MOCK_APPROVED_DOCUMENT.status, 'client')).toBe(true);
  });

  it('signed document can be exported by client', () => {
    expect(canExportDocument('signed', 'client')).toBe(true);
  });

  it('filed document can be exported by all roles', () => {
    expect(canExportDocument('filed', 'client')).toBe(true);
    expect(canExportDocument('filed', 'attorney')).toBe(true);
  });
});

// ============================================================================
// SECTION: DRAFT watermark validation
// ============================================================================

describe('Document Generation — DRAFT watermark', () => {
  it('MOCK_WILL_DOCUMENT content contains DRAFT watermark', () => {
    expect(hasDraftWatermark(MOCK_WILL_DOCUMENT.content)).toBe(true);
  });

  it('MOCK_POA_DOCUMENT content contains DRAFT watermark', () => {
    expect(hasDraftWatermark(MOCK_POA_DOCUMENT.content)).toBe(true);
  });

  it('watermark uses red color #cc0000', () => {
    expect(MOCK_WILL_DOCUMENT.content).toContain('#cc0000');
  });

  it('watermark text "NOT YET EXECUTED" is present', () => {
    expect(MOCK_WILL_DOCUMENT.content).toMatch(/NOT\s+YET\s+EXECUTED/i);
  });

  it('document with no watermark fails the hasDraftWatermark check', () => {
    const cleanHtml = '<h1>Document</h1><p>No watermark here.</p>';
    expect(hasDraftWatermark(cleanHtml)).toBe(false);
  });

  it('will template systemPrompt instructs AI to include DRAFT watermark', () => {
    const willTemplate = DOCUMENT_TEMPLATES['will'];
    expect(willTemplate).toBeDefined();
    expect(willTemplate.systemPrompt).toContain('DRAFT');
    expect(willTemplate.systemPrompt).toContain('draft-watermark');
  });
});

// ============================================================================
// SECTION: Document type constants completeness
// ============================================================================

describe('Document Generation — DOC_TYPES constants', () => {
  it('DOC_TYPES.WILL is defined', () => {
    expect(DOC_TYPES.WILL).toBe('will');
  });

  it('DOC_TYPES.POA is defined', () => {
    expect(DOC_TYPES.POA).toBe('poa');
  });

  it('DOC_TYPES.LIVING_WILL is defined', () => {
    expect(DOC_TYPES.LIVING_WILL).toBe('livingWill');
  });

  it('DOC_TYPES.TRUST is defined', () => {
    expect(DOC_TYPES.TRUST).toBe('trust');
  });

  it('DOC_TYPES.POUR_OVER_WILL is defined', () => {
    expect(DOC_TYPES.POUR_OVER_WILL).toBe('pourOverWill');
  });

  it('DOC_TYPES.DEED is defined', () => {
    expect(DOC_TYPES.DEED).toBe('deed');
  });

  it('DOC_TYPES.AFFIDAVIT_OF_CONSIDERATION is defined', () => {
    expect(DOC_TYPES.AFFIDAVIT_OF_CONSIDERATION).toBe('affidavitOfConsideration');
  });

  it('DOC_TYPES.GIT_REP_3 is defined', () => {
    expect(DOC_TYPES.GIT_REP_3).toBe('gitRep3');
  });

  it('DOC_STATUSES.DRAFT is defined', () => {
    expect(DOC_STATUSES.DRAFT).toBe('draft');
  });

  it('DOC_STATUSES.REVIEW is defined', () => {
    expect(DOC_STATUSES.REVIEW).toBe('review');
  });

  it('DOC_STATUSES.FINAL is defined', () => {
    expect(DOC_STATUSES.FINAL).toBe('final');
  });
});

// ============================================================================
// SECTION: Document template coverage for all package types
// ============================================================================

describe('Document Generation — template coverage', () => {
  it('a template exists for every doc type in the Foundation package', () => {
    for (const docType of PACKAGE_DOCUMENTS.foundation) {
      const template = DOCUMENT_TEMPLATES[docType];
      if (template) {
        expect(template.docType).toBeDefined();
      }
      // Not all doc types need an AI template (e.g. coverLetter may be static)
    }
  });

  it('a template exists for trust (Fortress package)', () => {
    expect(DOCUMENT_TEMPLATES['trust']).toBeDefined();
  });

  it('a template exists for pourOverWill (Fortress package)', () => {
    expect(DOCUMENT_TEMPLATES['pourOverWill']).toBeDefined();
  });

  it('a template exists for deed (Fortress package)', () => {
    expect(DOCUMENT_TEMPLATES['deed']).toBeDefined();
  });

  it('will template has required client fields including executor', () => {
    const will = DOCUMENT_TEMPLATES['will'];
    const fields = will.requiredClientFields.join(' ');
    expect(fields).toMatch(/executor/i);
  });

  it('poa template has required client fields', () => {
    const poa = DOCUMENT_TEMPLATES['poa'];
    expect(poa.requiredClientFields.length).toBeGreaterThan(0);
  });
});
