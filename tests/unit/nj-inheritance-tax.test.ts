import { describe, it, expect } from 'vitest';
import {
  njClassFor,
  toRelationship,
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

describe('njClassFor — delegates to the filing engine', () => {
  it('puts the exempt relatives in Class A', () => {
    for (const r of [
      'spouse', 'husband', 'wife', 'civil union partner', 'domestic partner',
      'parent', 'mother', 'grandparent', 'child', 'son', 'daughter',
      'legally adopted child', 'mutually acknowledged child', 'grandchild',
      'great-grandchild', 'issue', 'descendant',
    ]) {
      expect(njClassFor(r), r).toBe('A');
    }
  });

  it('treats a stepchild as Class A', () => {
    expect(njClassFor('stepchild')).toBe('A');
    expect(njClassFor('step-child')).toBe('A');
    expect(njClassFor('stepson')).toBe('A');
  });

  it('treats a step-GRANDchild as Class D, which is the published carve-out', () => {
    // The Division's class list says Class A "does not include a step-grandchild
    // or great-step grandchild". They pay 15-16%; their parent pays nothing.
    expect(njClassFor('step-grandchild')).toBe('D');
    expect(njClassFor('stepgrandson')).toBe('D');
    expect(njClassFor('great-step-grandchild')).toBe('D');
  });

  it('puts siblings and children-in-law in Class C', () => {
    for (const r of ['brother', 'sister', 'sibling', 'half-brother', 'son-in-law', 'daughter-in-law']) {
      expect(njClassFor(r), r).toBe('C');
    }
  });

  it('puts collaterals and strangers in Class D', () => {
    for (const r of ['niece', 'nephew', 'cousin', 'aunt', 'uncle', 'friend', 'godchild', 'brother-in-law']) {
      expect(njClassFor(r), r).toBe('D');
    }
  });

  it('puts charities and public bodies in Class E', () => {
    for (const r of ['charity', 'religious institution', 'educational institution', 'State of New Jersey']) {
      expect(njClassFor(r), r).toBe('E');
    }
  });

  it('puts the other step-relations in Class D, matching the filing engine', () => {
    // A stepCHILD is Class A. A stepPARENT and a stepSIBLING are not.
    // Cross-checked against inheritance-tax/engine/classify.ts on
    // feat/nj-inheritance-tax-engine so the two can never disagree about a
    // 15-16% tax while both exist.
    for (const r of ['stepparent', 'stepmother', 'step-father', 'stepbrother', 'step-sister']) {
      expect(njClassFor(r), r).toBe('D');
    }
  });

  it('puts the spouse of a stepchild in Class D, not Class C', () => {
    // N.J.A.C. 18:26-1.1. The spouse of a natural child is Class C; the spouse
    // of a stepchild is Class D. Non-obvious, and a 15% difference.
    expect(njClassFor('stepchild-in-law')).toBe('D');
    expect(njClassFor('spouse of a stepchild')).toBe('D');
    expect(njClassFor('mutually acknowledged child-in-law')).toBe('D');
    // Contrast — the natural child's spouse stays Class C.
    expect(njClassFor('son-in-law')).toBe('C');
  });

  it('puts a former spouse in Class D', () => {
    expect(njClassFor('ex-spouse')).toBe('D');
    expect(njClassFor('ex spouse')).toBe('D');
    // The current spouse is of course Class A.
    expect(njClassFor('spouse')).toBe('A');
  });

  it('returns null rather than guessing at an unfamiliar relationship', () => {
    // Defaulting an unknown word to Class D would print an 11-16% tax warning
    // about a beneficiary who may owe nothing at all.
    expect(njClassFor('trusted advisor')).toBeNull();
    expect(njClassFor('')).toBeNull();
    expect(njClassFor('   ')).toBeNull();
  });

  it('is insensitive to case, spacing, and punctuation', () => {
    expect(njClassFor('  STEP CHILD ')).toBe('A');
    expect(njClassFor('Son-In-Law')).toBe('C');
  });
});

describe('toRelationship — the bridge to the engine enum', () => {
  it('maps the step-relations onto the enum values the engine distinguishes', () => {
    expect(toRelationship('stepchild')).toBe('stepchild');
    expect(toRelationship('step-grandchild')).toBe('step_grandchild');
    expect(toRelationship('stepparent')).toBe('stepparent');
    expect(toRelationship('stepbrother')).toBe('stepbrother_stepsister');
    expect(toRelationship('stepchild-in-law')).toBe('stepchild_in_law');
  });

  it('maps a natural child\'s spouse to child_in_law, not the step form', () => {
    expect(toRelationship('son-in-law')).toBe('child_in_law');
  });

  it('returns null for anything it does not recognise', () => {
    expect(toRelationship('trusted advisor')).toBeNull();
    expect(toRelationship('')).toBeNull();
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
