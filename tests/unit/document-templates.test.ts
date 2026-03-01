/**
 * tests/unit/document-templates.test.ts
 *
 * Validates document template configuration in src/config/document-templates.ts.
 *
 * Coverage:
 * - All expected document types are defined
 * - Each template has required fields (docType, displayName, systemPrompt, etc.)
 * - NJ statutory citations are present in each template
 * - Execution blocks reference correct witness count (2 for NJ)
 * - Notary block presence where required
 * - Template variables are properly formatted (no broken {variable} references)
 * - Key NJ statutes are cited across the template corpus
 */

import { describe, it, expect } from 'vitest';
import { DOCUMENT_TEMPLATES } from '@/config/document-templates';
import type { DocumentTemplate } from '@/config/document-templates';

// ============================================================================
// Expected document types from the NJ Estate Plan Generator spec
// ============================================================================
const EXPECTED_DOC_TYPES = [
  'will',
  'pourOverWill',
  'poa',
  'livingWill',
  'trust',
  'deed',
  'affidavitOfConsideration',
  'gitRep3',
  'estatePlanSummary',
  'actionSteps',
] as const;

// Key NJ statutes that should appear across the template library
const REQUIRED_NJ_STATUTES = [
  'N.J.S.A. 3B:3',          // Wills formalities
  'N.J.S.A. 3B:11',         // NJ Trust Act
  'N.J.S.A. 46:2B',         // Durable Power of Attorney
  'N.J.S.A. 26:2H',         // Advance Directive for Healthcare
];

// Documents that require notarization under NJ law
const NOTARY_REQUIRED_DOCS = ['will', 'pourOverWill', 'poa', 'livingWill', 'deed'];

// Documents that require witness blocks
const WITNESS_REQUIRED_DOCS = ['will', 'pourOverWill'];

// ============================================================================
// Helper: get all template values as array
// ============================================================================
function getAllTemplates(): DocumentTemplate[] {
  return Object.values(DOCUMENT_TEMPLATES);
}

function getTemplate(key: string): DocumentTemplate | undefined {
  return DOCUMENT_TEMPLATES[key];
}

// ============================================================================
// SECTION: Template existence
// ============================================================================

describe('Document Templates — existence and coverage', () => {
  it('DOCUMENT_TEMPLATES is defined and non-empty', () => {
    expect(DOCUMENT_TEMPLATES).toBeDefined();
    expect(typeof DOCUMENT_TEMPLATES).toBe('object');
    expect(getAllTemplates().length).toBeGreaterThan(0);
  });

  it.each(EXPECTED_DOC_TYPES)(
    'template exists for docType: %s',
    (docType) => {
      const template = getTemplate(docType);
      expect(template).toBeDefined();
    },
  );

  it('has at least 10 document templates', () => {
    expect(getAllTemplates().length).toBeGreaterThanOrEqual(10);
  });
});

// ============================================================================
// SECTION: Required fields on each template
// ============================================================================

describe('Document Templates — required fields', () => {
  it('every template has a docType', () => {
    for (const template of getAllTemplates()) {
      expect(template.docType).toBeDefined();
      expect(typeof template.docType).toBe('string');
      expect(template.docType.length).toBeGreaterThan(0);
    }
  });

  it('every template has a displayName', () => {
    for (const template of getAllTemplates()) {
      expect(template.displayName).toBeDefined();
      expect(typeof template.displayName).toBe('string');
      expect(template.displayName.length).toBeGreaterThan(0);
    }
  });

  it('every template has a systemPrompt', () => {
    for (const template of getAllTemplates()) {
      expect(template.systemPrompt).toBeDefined();
      expect(typeof template.systemPrompt).toBe('string');
      expect(template.systemPrompt.length).toBeGreaterThan(100); // prompts are substantial
    }
  });

  it('every template has an outputStructure description', () => {
    for (const template of getAllTemplates()) {
      expect(template.outputStructure).toBeDefined();
      expect(typeof template.outputStructure).toBe('string');
      expect(template.outputStructure.length).toBeGreaterThan(10);
    }
  });

  it('every template has requiredClientFields array', () => {
    for (const template of getAllTemplates()) {
      expect(Array.isArray(template.requiredClientFields)).toBe(true);
      expect(template.requiredClientFields.length).toBeGreaterThan(0);
    }
  });

  it('every template has executionRequirements', () => {
    for (const template of getAllTemplates()) {
      expect(template.executionRequirements).toBeDefined();
      expect(typeof template.executionRequirements).toBe('string');
      expect(template.executionRequirements.length).toBeGreaterThan(10);
    }
  });

  it('every template has statutoryAuthority', () => {
    for (const template of getAllTemplates()) {
      expect(template.statutoryAuthority).toBeDefined();
      expect(typeof template.statutoryAuthority).toBe('string');
      expect(template.statutoryAuthority.length).toBeGreaterThan(5);
    }
  });
});

// ============================================================================
// SECTION: NJ Statutory citations
// ============================================================================

describe('Document Templates — NJ statutory citations', () => {
  it('will template cites N.J.S.A. 3B:3 (Will Formalities)', () => {
    const will = getTemplate('will');
    expect(will).toBeDefined();
    expect(will!.systemPrompt).toContain('N.J.S.A. 3B:3');
  });

  it('will template cites self-proving affidavit statute (N.J.S.A. 3B:3-4)', () => {
    const will = getTemplate('will');
    expect(will!.systemPrompt).toContain('3B:3-4');
  });

  it('poa template cites N.J.S.A. 46:2B (Durable POA)', () => {
    const poa = getTemplate('poa');
    expect(poa).toBeDefined();
    expect(poa!.systemPrompt).toContain('46:2B');
  });

  it('livingWill template cites N.J.S.A. 26:2H (Advance Directive)', () => {
    const livingWill = getTemplate('livingWill');
    expect(livingWill).toBeDefined();
    expect(livingWill!.systemPrompt).toContain('26:2H');
  });

  it('trust template cites N.J.S.A. 3B:11 (NJ Trust Act)', () => {
    const trust = getTemplate('trust');
    expect(trust).toBeDefined();
    expect(trust!.systemPrompt).toContain('3B:11');
  });

  it('deed template cites N.J.S.A. 46 (real property transfer)', () => {
    const deed = getTemplate('deed');
    expect(deed).toBeDefined();
    // Deeds reference N.J.S.A. 46:4-6 (bargain-and-sale covenants) or N.J.S.A. 46:15-10 (RTF)
    expect(deed!.systemPrompt).toMatch(/N\.J\.S\.A\.\s*46/);
  });

  it('pourOverWill template cites N.J.S.A. 3B:3-14 (pour-over/incorporation by reference)', () => {
    const pow = getTemplate('pourOverWill');
    expect(pow).toBeDefined();
    expect(pow!.systemPrompt).toContain('3B:3-14');
  });

  it.each(REQUIRED_NJ_STATUTES)(
    'at least one template references: %s',
    (statute) => {
      const allPrompts = getAllTemplates().map((t) => t.systemPrompt + t.statutoryAuthority).join('\n');
      expect(allPrompts).toContain(statute);
    },
  );

  it('statutory citations are present in at least 8 templates', () => {
    const templatesWithStatutes = getAllTemplates().filter(
      (t) => t.statutoryAuthority.includes('N.J.S.A.'),
    );
    expect(templatesWithStatutes.length).toBeGreaterThanOrEqual(8);
  });
});

// ============================================================================
// SECTION: Witness count — NJ requires 2 witnesses for Wills
// ============================================================================

describe('Document Templates — NJ witness requirements', () => {
  it('will template execution requirements mention 2 witnesses', () => {
    const will = getTemplate('will');
    expect(will).toBeDefined();
    const exec = will!.executionRequirements.toLowerCase() + will!.systemPrompt.toLowerCase();
    // Should reference 2 witnesses, two witnesses, or N.J.S.A. 3B:3-2
    expect(exec).toMatch(/two\s+witnesses?|2\s+witnesses?|3b:3-2/i);
  });

  it('pourOverWill template execution requirements mention 2 witnesses', () => {
    const pow = getTemplate('pourOverWill');
    expect(pow).toBeDefined();
    const exec = pow!.executionRequirements.toLowerCase() + pow!.systemPrompt.toLowerCase();
    expect(exec).toMatch(/two\s+witnesses?|2\s+witnesses?|3b:3-2/i);
  });

  it('will systemPrompt contains a WITNESS section header', () => {
    const will = getTemplate('will');
    expect(will!.systemPrompt.toUpperCase()).toContain('WITNESS');
  });

  it('pourOverWill systemPrompt contains a WITNESS section', () => {
    const pow = getTemplate('pourOverWill');
    expect(pow!.systemPrompt.toUpperCase()).toContain('WITNESS');
  });
});

// ============================================================================
// SECTION: Notary block presence
// ============================================================================

describe('Document Templates — notary block requirements', () => {
  it('will template references notary acknowledgment', () => {
    const will = getTemplate('will');
    const text = will!.systemPrompt.toLowerCase() + will!.executionRequirements.toLowerCase();
    expect(text).toMatch(/notary|notarization/i);
  });

  it('poa template references notary or acknowledgment', () => {
    const poa = getTemplate('poa');
    const text = poa!.systemPrompt.toLowerCase() + poa!.executionRequirements.toLowerCase();
    expect(text).toMatch(/notary|notarization|acknowledgment/i);
  });

  it('livingWill template references witness/notary execution', () => {
    const lw = getTemplate('livingWill');
    const text = lw!.systemPrompt.toLowerCase() + lw!.executionRequirements.toLowerCase();
    expect(text).toMatch(/witness|notary/i);
  });
});

// ============================================================================
// SECTION: DRAFT watermark instruction
// ============================================================================

describe('Document Templates — DRAFT watermark', () => {
  it('will systemPrompt instructs to include DRAFT watermark', () => {
    const will = getTemplate('will');
    expect(will!.systemPrompt).toContain('DRAFT');
  });

  it('pourOverWill systemPrompt instructs to include DRAFT watermark', () => {
    const pow = getTemplate('pourOverWill');
    expect(pow!.systemPrompt).toContain('DRAFT');
  });

  it('trust systemPrompt instructs to include DRAFT watermark', () => {
    const trust = getTemplate('trust');
    expect(trust!.systemPrompt).toContain('DRAFT');
  });
});

// ============================================================================
// SECTION: Template variable format integrity
// ============================================================================

describe('Document Templates — template variable format', () => {
  it('will systemPrompt does not contain broken single-brace {variables}', () => {
    const will = getTemplate('will');
    // Legitimate variables are in [BRACKETS] in these prompts, not {curly}
    // Double-brace {{}} are used in injected template literals — detect unmatched single braces
    // that aren't part of legal content
    const singleBracePattern = /(?<!\{)\{(?![{])[^}]+\}(?!\})/g;
    const matches = will!.systemPrompt.match(singleBracePattern) ?? [];
    // Allow zero unclosed single-brace template variables (they should use [BRACKETS])
    expect(matches.length).toBe(0);
  });

  it('poa systemPrompt uses [BRACKETS] for placeholder variables', () => {
    const poa = getTemplate('poa');
    expect(poa!.systemPrompt).toMatch(/\[.+?\]/);
  });

  it('will required client fields use dot notation', () => {
    const will = getTemplate('will');
    for (const field of will!.requiredClientFields) {
      expect(field).toMatch(/^[a-zA-Z][a-zA-Z0-9.]*$/);
    }
  });

  it('trust requiredClientFields includes trustee info', () => {
    const trust = getTemplate('trust');
    const fields = trust!.requiredClientFields.join(' ');
    expect(fields).toMatch(/trustee|trust/i);
  });
});

// ============================================================================
// SECTION: Document display names
// ============================================================================

describe('Document Templates — display names', () => {
  it('will displayName contains "Will"', () => {
    const will = getTemplate('will');
    expect(will!.displayName).toContain('Will');
  });

  it('poa displayName contains "Power of Attorney"', () => {
    const poa = getTemplate('poa');
    expect(poa!.displayName).toMatch(/power of attorney/i);
  });

  it('livingWill displayName contains "Living Will" or "Advance Directive"', () => {
    const lw = getTemplate('livingWill');
    expect(lw!.displayName).toMatch(/living will|advance directive/i);
  });

  it('trust displayName contains "Trust"', () => {
    const trust = getTemplate('trust');
    expect(trust!.displayName).toContain('Trust');
  });

  it('deed displayName contains "Deed"', () => {
    const deed = getTemplate('deed');
    expect(deed!.displayName).toContain('Deed');
  });
});
