import { describe, it, expect } from 'vitest';
import {
  classifyBeneficiary,
  estimateInheritanceTax,
  renderApportionmentClause,
  buildApportionmentPromptBlock,
  APPORTIONMENT_EXPLANATIONS,
} from '../../functions/src/nj-inheritance-tax';

/**
 * New Jersey transfer inheritance tax.
 *
 * The classes and rates below are pinned to the NJ Division of Taxation's
 * published tables (verified August 2026). If Trenton changes a rate, these
 * tests are where it should break first — the whole point of the module is that
 * the numbers and citations in a client's will are reproducible, not recalled.
 */

describe('classifyBeneficiary', () => {
  it('puts the exempt relatives in Class A', () => {
    for (const r of [
      'spouse', 'husband', 'wife', 'civil union partner', 'domestic partner',
      'parent', 'mother', 'grandparent', 'child', 'son', 'daughter',
      'legally adopted child', 'mutually acknowledged child', 'grandchild',
      'great-grandchild', 'issue', 'descendant',
    ]) {
      expect(classifyBeneficiary(r), r).toBe('A');
    }
  });

  it('treats a stepchild as Class A', () => {
    expect(classifyBeneficiary('stepchild')).toBe('A');
    expect(classifyBeneficiary('step-child')).toBe('A');
    expect(classifyBeneficiary('stepson')).toBe('A');
  });

  it('treats a step-GRANDchild as Class D, which is the published carve-out', () => {
    // The Division's class list says Class A "does not include a step-grandchild
    // or great-step grandchild". They pay 15-16%; their parent pays nothing.
    expect(classifyBeneficiary('step-grandchild')).toBe('D');
    expect(classifyBeneficiary('stepgrandson')).toBe('D');
    expect(classifyBeneficiary('great-step-grandchild')).toBe('D');
  });

  it('puts siblings and children-in-law in Class C', () => {
    for (const r of ['brother', 'sister', 'sibling', 'half-brother', 'son-in-law', 'daughter-in-law']) {
      expect(classifyBeneficiary(r), r).toBe('C');
    }
  });

  it('puts collaterals and strangers in Class D', () => {
    for (const r of ['niece', 'nephew', 'cousin', 'aunt', 'uncle', 'friend', 'godchild', 'brother-in-law']) {
      expect(classifyBeneficiary(r), r).toBe('D');
    }
  });

  it('puts charities and public bodies in Class E', () => {
    for (const r of ['charity', 'religious institution', 'educational institution', 'State of New Jersey']) {
      expect(classifyBeneficiary(r), r).toBe('E');
    }
  });

  it('returns null rather than guessing at an unfamiliar relationship', () => {
    // Defaulting an unknown word to Class D would print an 11-16% tax warning
    // about a beneficiary who may owe nothing at all.
    expect(classifyBeneficiary('trusted advisor')).toBeNull();
    expect(classifyBeneficiary('')).toBeNull();
    expect(classifyBeneficiary('   ')).toBeNull();
  });

  it('is insensitive to case, spacing, and punctuation', () => {
    expect(classifyBeneficiary('  STEP CHILD ')).toBe('A');
    expect(classifyBeneficiary('Son-In-Law')).toBe('C');
  });
});

describe('estimateInheritanceTax', () => {
  it('taxes Class A and Class E at nothing', () => {
    expect(estimateInheritanceTax('A', 5_000_000)).toBe(0);
    expect(estimateInheritanceTax('E', 5_000_000)).toBe(0);
  });

  it('applies the Class C schedule: $25k exempt, then 11/13/14/16%', () => {
    expect(estimateInheritanceTax('C', 25_000)).toBe(0);
    // $25k exempt, next $75k at 11%
    expect(estimateInheritanceTax('C', 100_000)).toBeCloseTo(8_250, 2);
    // Top of the 11% band: $25k exempt + $1,075,000 at 11%
    expect(estimateInheritanceTax('C', 1_100_000)).toBeCloseTo(118_250, 2);
    // Plus the full 13% band ($300k)
    expect(estimateInheritanceTax('C', 1_400_000)).toBeCloseTo(157_250, 2);
    // Plus the full 14% band ($300k)
    expect(estimateInheritanceTax('C', 1_700_000)).toBeCloseTo(199_250, 2);
    // Plus $100k at 16%
    expect(estimateInheritanceTax('C', 1_800_000)).toBeCloseTo(215_250, 2);
  });

  it('applies the Class D schedule: 15% to $700k, 16% above', () => {
    expect(estimateInheritanceTax('D', 100_000)).toBeCloseTo(15_000, 2);
    expect(estimateInheritanceTax('D', 700_000)).toBeCloseTo(105_000, 2);
    expect(estimateInheritanceTax('D', 800_000)).toBeCloseTo(121_000, 2);
  });

  it('returns zero for a zero or negative transfer', () => {
    expect(estimateInheritanceTax('D', 0)).toBe(0);
    expect(estimateInheritanceTax('D', -5)).toBe(0);
  });

  it('shows the cost of the choice: $100k to a niece is $15k', () => {
    // This is the number that makes the apportionment choice concrete for a
    // client — it comes out of the residue or out of her gift, but it comes.
    expect(estimateInheritanceTax('D', 100_000)).toBe(15_000);
  });
});

describe('renderApportionmentClause', () => {
  it('cites the two statutes that actually govern, in every mode', () => {
    for (const mode of ['residuary', 'apportioned', 'hybrid'] as const) {
      const html = renderApportionmentClause({ mode });
      // 54:35-6 is the inheritance-tax deduction rule; 3B:24-1 is the estate-tax
      // apportionment chapter. They are not interchangeable.
      expect(html, mode).toContain('54:35-6');
      expect(html, mode).toContain('3B:24-1');
      expect(html, mode).toContain('54:33-1');
    }
  });

  it('carves generation-skipping tax out of the definition', () => {
    const html = renderApportionmentClause({ mode: 'hybrid' });
    expect(html).toContain('2603');
    expect(html).toContain('2032A');
  });

  it('residuary mode states plainly who ends up paying', () => {
    const html = renderApportionmentClause({ mode: 'residuary' });
    expect(html).toMatch(/without apportionment/);
    // The consequence must be on the page, not left as a surprise.
    expect(html).toMatch(/borne by the residuary beneficiaries/);
  });

  it('apportioned mode charges each transfer with its own tax', () => {
    const html = renderApportionmentClause({ mode: 'apportioned' });
    expect(html).toMatch(/each transfer bears its own tax/);
    expect(html).toMatch(/No beneficiary shall be entitled to contribution/);
  });

  it('hybrid mode splits Class A from Class C and D', () => {
    const html = renderApportionmentClause({ mode: 'hybrid' });
    expect(html).toMatch(/Class A/);
    expect(html).toMatch(/Class C or Class D/);
    expect(html).toContain('54:34-2');
  });

  it('uses trustee vocabulary for a trust and executor for a will', () => {
    expect(renderApportionmentClause({ mode: 'hybrid', instrument: 'trust' }))
      .toMatch(/my trustee/);
    expect(renderApportionmentClause({ mode: 'hybrid', instrument: 'will' }))
      .toMatch(/my executor/);
  });

  it('always gives the fiduciary the means to collect', () => {
    for (const mode of ['residuary', 'apportioned', 'hybrid'] as const) {
      expect(renderApportionmentClause({ mode }), mode).toMatch(/withhold from any distribution/);
    }
  });

  it('honors a caller-supplied heading', () => {
    expect(renderApportionmentClause({ mode: 'hybrid', heading: 'ARTICLE IV — TAXES' }))
      .toContain('<h2>ARTICLE IV — TAXES</h2>');
  });

  it('emits no unresolved placeholders that the review engine would flag', () => {
    for (const mode of ['residuary', 'apportioned', 'hybrid'] as const) {
      const html = renderApportionmentClause({ mode });
      expect(html, mode).not.toMatch(/\{\{|\[\[|TODO|TBD/);
    }
  });
});

describe('buildApportionmentPromptBlock', () => {
  it('tells the model to reproduce the clause rather than compose one', () => {
    const block = buildApportionmentPromptBlock({ mode: 'hybrid', instrument: 'will' });
    expect(block).toContain('VERBATIM');
    expect(block).toContain('54:35-6');
    expect(block).toMatch(/Do not reword/);
  });
});

describe('APPORTIONMENT_EXPLANATIONS', () => {
  it('names the cost of each choice, not just the mechanism', () => {
    expect(APPORTIONMENT_EXPLANATIONS.residuary).toMatch(/11–16%/);
    expect(APPORTIONMENT_EXPLANATIONS.apportioned).toMatch(/reduced/);
    expect(APPORTIONMENT_EXPLANATIONS.hybrid).toMatch(/rarely drafted/);
  });
});
