/**
 * tests/unit/document-structure-validator.test.ts
 *
 * Unit tests for post-generation document structure validation.
 * Verifies that each doc type's rules detect missing elements in bad HTML,
 * and pass known-good HTML.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin', () => ({
  firestore: Object.assign(() => ({}), { DocumentData: {} }),
  initializeApp: vi.fn(),
}));

import {
  validateDocumentStructure,
  buildRetryInstruction,
  getRulesForDocType,
} from '../../functions/src/document-structure-validator';

// ===========================================================================
// Will validation
// ===========================================================================

describe('validateDocumentStructure — will', () => {
  const goodWillHtml = `
    <h2>ARTICLE I — IDENTIFICATION AND REVOCATION</h2>
    <p>I, John M Smith, of Mercer County, New Jersey, hereby revoke all prior wills and codicils.</p>
    <h2>ARTICLE II — EXECUTOR</h2>
    <p>I appoint my spouse, Jane Smith, as Executor of this Will.</p>
    <h2>ARTICLE III — RESIDUARY ESTATE</h2>
    <p>I give, devise, and bequeath all of the rest, residue, and remainder of my estate to my spouse.</p>
    <h2>SELF-PROVING AFFIDAVIT</h2>
    <p>We, the undersigned, declare under penalty of perjury...</p>
    <div class="signature-block">
      <p>Signature of Testator: ___________________________</p>
      <p>Dated this ___ day of __________, 2026</p>
    </div>
    <div class="witness-attestation">
      <p>We, the undersigned, attest and witness that the foregoing instrument was signed...</p>
      <p>Witness 1: ___________ Address: ___________</p>
      <p>Witness 2: ___________ Address: ___________</p>
    </div>
    ${Array.from({length: 50}, (_, i) => `<p>Additional statutory provision content paragraph ${i + 1} providing detailed legal language for the last will and testament document structure validation.</p>`).join('\n')}
  `;

  it('passes a well-formed will', () => {
    const result = validateDocumentStructure(goodWillHtml, 'will');
    expect(result.valid).toBe(true);
    expect(result.missing.filter(m => m.severity === 'error')).toHaveLength(0);
  });

  it('fails a will missing witness attestation', () => {
    const badHtml = goodWillHtml
      .replace(/witness/gi, '')
      .replace(/attest/gi, '');
    const result = validateDocumentStructure(badHtml, 'will');
    const errorMissing = result.missing.filter(m => m.severity === 'error');
    expect(errorMissing.some(m => m.name === 'Witness Attestation (2 witnesses)')).toBe(true);
  });

  it('fails a will missing self-proving affidavit', () => {
    const badHtml = goodWillHtml
      .replace(/self[- ]proving/gi, 'REDACTED')
      .replace(/affidavit/gi, 'REDACTED');
    const result = validateDocumentStructure(badHtml, 'will');
    expect(result.missing.some(m => m.name === 'Self-Proving Affidavit')).toBe(true);
  });

  it('fails a will missing executor designation', () => {
    const badHtml = goodWillHtml
      .replace(/executor/gi, '')
      .replace(/personal representative/gi, '');
    const result = validateDocumentStructure(badHtml, 'will');
    expect(result.missing.some(m => m.name === 'Executor Designation')).toBe(true);
  });
});

// ===========================================================================
// Trust validation
// ===========================================================================

describe('validateDocumentStructure — trust', () => {
  const goodTrustHtml = `
    <h2>ARTICLE I — NAME AND PURPOSE</h2>
    <p>This trust shall be known as The Smith Family Trust.</p>
    <h2>ARTICLE II — TRUSTEE</h2>
    <p>Jane Smith is appointed as initial Trustee. Robert Smith shall serve as successor trustee.</p>
    <p>Trustee acceptance and signature below.</p>
    <h2>ARTICLE III — TRUST PROPERTY</h2>
    <p>See Schedule A for a list of trust property.</p>
    <h2>ARTICLE IV — DISTRIBUTIONS</h2>
    <p>All distributions shall be for health, education, maintenance, and support (HEMS).</p>
    <h2>ARTICLE V — AMENDMENT AND REVOCATION</h2>
    <p>The Settlor reserves the right to amend or revoke this Trust.</p>
    <div class="signature-block">
      <p>Settlor Signature: ___________________________</p>
      <p>Trustee Signature (Acceptance): ___________________________</p>
    </div>
    <p>Notarization: Acknowledged before me this day...</p>
    ${Array.from({length: 80}, (_, i) => `<p>Trust provision paragraph ${i + 1} containing detailed language about trust administration, fiduciary duties, and beneficiary rights under applicable state law.</p>`).join('\n')}
  `;

  it('passes a well-formed trust', () => {
    const result = validateDocumentStructure(goodTrustHtml, 'trust');
    expect(result.valid).toBe(true);
  });

  it('fails a trust missing Schedule A reference', () => {
    const badHtml = goodTrustHtml.replace(/schedule\s*a/gi, 'REDACTED');
    const result = validateDocumentStructure(badHtml, 'trust');
    expect(result.missing.some(m => m.name === 'Schedule A Reference')).toBe(true);
  });
});

// ===========================================================================
// POA validation
// ===========================================================================

describe('validateDocumentStructure — poa', () => {
  const goodPoaHtml = `
    <h1>POWER OF ATTORNEY</h1>
    <p>I, John Smith, as Principal, hereby appoint Jane Smith as my agent and attorney-in-fact.</p>
    <p>This is a durable power of attorney effective upon incapacity.</p>
    <p>Powers granted include all financial matters and authorizations.</p>
    <div class="signature-block">
      <p>Principal Signature: ___________________________</p>
    </div>
    <div class="witnesses">
      <p>Witness 1: ___________________________</p>
      <p>Witness 2: ___________________________</p>
    </div>
    <div class="notary">
      <p>Notarized before me this day...</p>
    </div>
    ${Array.from({length: 40}, (_, i) => `<p>Power of attorney provision paragraph ${i + 1} specifying the scope and limitations of the agent authority granted under this durable instrument.</p>`).join('\n')}
  `;

  it('passes a well-formed POA', () => {
    const result = validateDocumentStructure(goodPoaHtml, 'poa');
    expect(result.valid).toBe(true);
  });

  it('fails a POA missing notary block', () => {
    const badHtml = goodPoaHtml
      .replace(/notar.*/gi, '')
      .replace(/sworn/gi, '')
      .replace(/acknowledged/gi, '');
    const result = validateDocumentStructure(badHtml, 'poa');
    expect(result.missing.some(m => m.name === 'Notary Block')).toBe(true);
  });
});

// ===========================================================================
// Deed validation
// ===========================================================================

describe('validateDocumentStructure — deed', () => {
  it('passes a well-formed deed', () => {
    const goodDeed = `
      <h1>QUITCLAIM DEED</h1>
      <p>This deed conveys from John Smith (Grantor) to The Smith Family Trust (Grantee).</p>
      <p>For and in consideration of One Dollar and other good and valuable consideration.</p>
      <p>Legal description: Block 1, Lot 23, Township of Princeton.</p>
      <div class="signature-block">
        <p>Grantor Signature: ___________________________</p>
      </div>
      <p>Notarized and acknowledged before me.</p>
      ${'<p>Deed padding. '.repeat(10)}</p>
    `;
    const result = validateDocumentStructure(goodDeed, 'deed');
    expect(result.valid).toBe(true);
  });

  it('fails a deed missing legal description', () => {
    const badDeed = `
      <p>From Grantor to Grantee. Consideration paid.</p>
      <p>Grantor Signature: ___________________________</p>
      <p>Notarized.</p>
      ${'<p>Padding. '.repeat(20)}</p>
    `;
    const result = validateDocumentStructure(badDeed, 'deed');
    expect(result.missing.some(m => m.name === 'Legal Description or Block/Lot')).toBe(true);
  });
});

// ===========================================================================
// Truncation detection
// ===========================================================================

describe('validateDocumentStructure — truncation', () => {
  it('detects content ending mid-tag', () => {
    const truncated = '<h1>Will</h1><p>I, John Smith, hereby declare<p class="inc';
    const result = validateDocumentStructure(truncated, 'will');
    expect(result.appearsTruncated).toBe(true);
  });

  it('does not flag complete content as truncated', () => {
    const complete = '<h1>Title</h1><p>Complete document content.</p>';
    const result = validateDocumentStructure(complete, 'estatePlanSummary');
    expect(result.appearsTruncated).toBe(false);
  });
});

// ===========================================================================
// Placeholder detection
// ===========================================================================

describe('validateDocumentStructure — placeholders', () => {
  it('counts placeholder markers', () => {
    const html = '<p>[INSERT NAME] lives at [INSERT ADDRESS]. [TBD] will serve as [TODO].</p>' +
      '<p>' + 'Content padding. '.repeat(100) + '</p>';
    const result = validateDocumentStructure(html, 'estatePlanSummary');
    expect(result.placeholderCount).toBe(4);
  });

  it('allows up to 3 placeholders without failing', () => {
    const html = '<h2>Summary</h2><p>[INSERT] and [INSERT] and [INSERT]</p>' +
      '<p>' + 'Content padding. '.repeat(100) + '</p>';
    const result = validateDocumentStructure(html, 'estatePlanSummary');
    expect(result.placeholderCount).toBe(3);
    // Should still pass (3 is the threshold, not exceeded)
    expect(result.valid).toBe(true);
  });

  it('fails when placeholders exceed threshold', () => {
    const html = '<h2>Summary</h2><p>[INSERT] [INSERT] [INSERT] [INSERT]</p>' +
      '<p>' + 'Content padding. '.repeat(100) + '</p>';
    const result = validateDocumentStructure(html, 'estatePlanSummary');
    expect(result.placeholderCount).toBe(4);
    expect(result.valid).toBe(false);
  });
});

// ===========================================================================
// Minimum length
// ===========================================================================

describe('validateDocumentStructure — minimum length', () => {
  it('fails will content that is too short', () => {
    const shortHtml = '<h2>Article I</h2><p>Short.</p>';
    const result = validateDocumentStructure(shortHtml, 'will');
    expect(result.meetsMinimumLength).toBe(false);
    expect(result.valid).toBe(false);
  });
});

// ===========================================================================
// buildRetryInstruction
// ===========================================================================

describe('buildRetryInstruction', () => {
  it('lists all missing elements', () => {
    const result = validateDocumentStructure('<p>Empty</p>', 'will');
    const instruction = buildRetryInstruction(result, 'will');
    expect(instruction).toContain('REQUIRED');
    expect(instruction).toContain('MINIMUM LENGTH');
  });

  it('mentions truncation when detected', () => {
    const result = validateDocumentStructure('<p>Cut off mid<', 'will');
    const instruction = buildRetryInstruction(result, 'will');
    expect(instruction).toContain('TRUNCATION');
  });
});

// ===========================================================================
// getRulesForDocType
// ===========================================================================

describe('getRulesForDocType', () => {
  it('returns rules for known doc types', () => {
    expect(getRulesForDocType('will').length).toBeGreaterThan(3);
    expect(getRulesForDocType('trust').length).toBeGreaterThan(3);
    expect(getRulesForDocType('poa').length).toBeGreaterThan(3);
    expect(getRulesForDocType('deed').length).toBeGreaterThan(3);
  });

  it('returns empty array for unknown doc type', () => {
    expect(getRulesForDocType('unknownType')).toEqual([]);
  });
});
