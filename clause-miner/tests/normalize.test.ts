import { describe, expect, it } from 'vitest';
import {
  normalize,
  type GazetteerEntry,
} from '../src/core/normalize.js';

const gazetteer: GazetteerEntry[] = [
  { role: 'GRANTOR_NAME', names: ['JOHN DOE'] },
  { role: 'SPOUSE_NAME', names: ['JANE DOE'] },
  { role: 'CHILD_1', names: ['MICHAEL DOE'] },
  { role: 'CHILD_2', names: ['SARAH DOE'] },
  { role: 'CHILD_3', names: ['EMILY DOE'] },
];

describe('gazetteer role-typed substitution (§5.1(1))', () => {
  it('replaces full names with role placeholders', () => {
    const { normText } = normalize(
      'I, JOHN DOE, hereby declare this to be my Revocable Living Trust, and I appoint my wife, JANE DOE, as successor Trustee.',
      gazetteer,
    );
    expect(normText).toContain('{{GRANTOR_NAME}}');
    expect(normText).toContain('{{SPOUSE_NAME}}');
    expect(normText).not.toMatch(/JOHN|JANE|DOE/);
  });

  it('preserves possessives outside the placeholder', () => {
    const { normText } = normalize(
      "JOHN DOE's residuary estate shall pass to JANE DOE.",
      gazetteer,
    );
    expect(normText).toContain("{{GRANTOR_NAME}}'s residuary estate");
  });

  it('replaces unambiguous surnames, with honorific', () => {
    const { normText } = normalize(
      'Mr. Johnson shall serve as Trustee without compensation. If Johnson fails to qualify, the successor shall serve.',
      [{ role: 'TRUSTEE_1', names: ['ROBERT JOHNSON'] }],
    );
    expect(normText).toContain('{{TRUSTEE_1}} shall serve as Trustee');
    expect(normText).toContain('If {{TRUSTEE_1}} fails to qualify');
    expect(normText).not.toMatch(/Johnson/i);
  });

  it('leaves ambiguous surnames alone (shared family surname)', () => {
    const { normText } = normalize(
      'The Doe family homestead shall remain in trust.',
      gazetteer,
    );
    // 'DOE' surname maps to five roles — surname-only substitution must not fire.
    expect(normText).toContain('Doe family homestead');
  });

  it('collapses runs of >= 2 child placeholders to {{CHILDREN_LIST}} + CHILD_COUNT', () => {
    const { normText, parameters } = normalize(
      'I give the remainder of my estate to my children, MICHAEL DOE, SARAH DOE and EMILY DOE, in equal shares.',
      gazetteer,
    );
    expect(normText).toContain('{{CHILDREN_LIST}}');
    expect(normText).not.toContain('{{CHILD_1}}');
    expect(parameters.CHILD_COUNT).toEqual(['3']);
  });
});

describe('SSN hard-redaction (§5.1(2))', () => {
  it('redacts SSNs to {{REDACTED_SSN}} and never preserves the value', () => {
    const { normText, parameters } = normalize(
      'The Grantor, whose Social Security Number is 123-45-6789, declares this trust.',
    );
    expect(normText).toContain('{{REDACTED_SSN}}');
    expect(normText).not.toContain('123-45-6789');
    expect(JSON.stringify(parameters)).not.toContain('123-45-6789');
  });
});

describe('statute-citation allowlist (§5.1(4))', () => {
  it('leaves N.J.S.A., U.S.C. and I.R.C. citations untouched', () => {
    const text =
      'The Trustee shall have the powers enumerated in N.J.S.A. 3B:14-23, and the marital share shall qualify under 26 U.S.C. § 2056(b)(7) and I.R.C. § 2503.';
    const { normText } = normalize(text);
    expect(normText).toContain('N.J.S.A. 3B:14-23');
    expect(normText).toContain('26 U.S.C. § 2056(b)(7)');
    expect(normText).toContain('I.R.C. § 2503');
    // The citation numerals must not have been eaten by numeric passes.
    expect(normText).not.toContain('{{DATE}}');
    expect(normText).not.toContain('{{FRACTION}}');
  });

  it('does not turn "I.R.C. Section 2503" into an internal cross-reference', () => {
    const { normText } = normalize(
      'Gifts shall qualify for the annual exclusion under I.R.C. Section 2503(c) of the Code.',
    );
    expect(normText).toContain('I.R.C. Section 2503(c)');
    expect(normText).not.toContain('{{XREF');
  });
});

describe('internal cross-references (§5.1(4))', () => {
  it('captures Article/Section references as {{XREF:...}} preserving the target', () => {
    const { normText } = normalize(
      'The distribution shall be made as provided in Article FOURTH of this Agreement and under Section 5.2 hereof.',
    );
    expect(normText).toContain('{{XREF:Article FOURTH}}');
    expect(normText).toContain('{{XREF:Section 5.2}}');
  });

  it('does not convert an article heading at line start into an XREF', () => {
    const { normText } = normalize(
      'ARTICLE IV\nThe Trustee shall have the powers set forth in Article V.',
    );
    expect(normText.startsWith('ARTICLE IV')).toBe(true);
    expect(normText).toContain('{{XREF:Article V}}');
  });
});

describe('typed value placeholders (§5.1(2))', () => {
  it('CRITICAL: 30-day vs 60-day survivorship — identical normText, distinct parameters', () => {
    const a = normalize(
      'If any beneficiary shall fail to survive me by thirty (30) days, such beneficiary shall be deemed to have predeceased me.',
    );
    const b = normalize(
      'If any beneficiary shall fail to survive me by sixty (60) days, such beneficiary shall be deemed to have predeceased me.',
    );
    expect(a.normText).toBe(b.normText);
    expect(a.normText).toContain('{{DURATION}}');
    expect(a.parameters.DURATION).toEqual(['thirty (30) days']);
    expect(b.parameters.DURATION).toEqual(['sixty (60) days']);
  });

  it('replaces dates in several shapes', () => {
    const { normText, parameters } = normalize(
      'This Agreement is executed on January 15, 2019, amending the trust dated the 3rd day of June, 1998, and restated 12/31/2015.',
    );
    expect(normText).not.toMatch(/2019|1998|2015/);
    expect(parameters.DATE).toHaveLength(3);
  });

  it('replaces dollar amounts, spelled and numeric', () => {
    const { normText, parameters } = normalize(
      'I give the sum of Fifty Thousand Dollars ($50,000.00) to my brother, plus $2,500 for expenses.',
    );
    expect(normText).not.toContain('$50,000.00');
    expect(normText).not.toContain('$2,500');
    expect(parameters.AMOUNT).toEqual([
      'Fifty Thousand Dollars ($50,000.00)',
      '$2,500',
    ]);
  });

  it('replaces percentages', () => {
    const { normText, parameters } = normalize(
      'The Trustee shall distribute fifty percent (50%) of the principal, and thereafter 25% annually.',
    );
    expect(normText).not.toContain('50%');
    expect(normText).not.toContain('25%');
    expect(parameters.PERCENT).toHaveLength(2);
  });

  it('replaces ages including spelled-out forms', () => {
    const { normText, parameters } = normalize(
      'When the beneficiary attains the age of twenty-five (25) years, the Trustee shall distribute one-half (1/2) of the trust principal.',
    );
    expect(normText).toContain('age of {{AGE}} years');
    expect(parameters.AGE).toEqual(['twenty-five (25)']);
    expect(normText).toContain('{{FRACTION}}');
  });

  it('replaces "years of age" form', () => {
    const { normText, parameters } = normalize(
      'until such child shall have attained twenty-one (21) years of age.',
    );
    expect(normText).toContain('{{AGE}} years of age');
    expect(parameters.AGE).toEqual(['twenty-one (21)']);
  });

  it('replaces counts of parties ("three (3) children")', () => {
    const { normText, parameters } = normalize(
      'I am married and have three (3) children now living.',
    );
    expect(normText).toContain('{{COUNT}} children');
    expect(parameters.COUNT).toEqual(['three (3)']);
  });

  it('replaces County/State names', () => {
    const { normText, parameters } = normalize(
      'I reside in the County of Bergen, State of New Jersey.',
    );
    expect(normText).toContain('County of {{COUNTY}}');
    expect(normText).toContain('State of {{STATE}}');
    expect(parameters.COUNTY).toEqual(['Bergen']);
    expect(parameters.STATE).toEqual(['New Jersey']);
  });
});

describe('marital-deduction fraction whitelist (§5.1(2))', () => {
  it('CRITICAL: never substitutes fractions inside a marital-deduction formula sentence', () => {
    const formula =
      'The marital deduction share shall be a fractional share of the residue, the numerator of the fraction being one-half (1/2) of the adjusted gross estate as finally determined for federal estate tax purposes.';
    const { normText } = normalize(formula);
    expect(normText).toContain('one-half (1/2)');
    expect(normText).not.toContain('{{FRACTION}}');
  });

  it('still substitutes ordinary dispositive fractions', () => {
    const { normText, parameters } = normalize(
      'I give one-third (1/3) of my residuary estate to my brother.',
    );
    expect(normText).toContain('{{FRACTION}}');
    expect(normText).not.toContain('one-third');
    expect(parameters.FRACTION).toEqual(['one-third (1/3)']);
  });

  it('guards only the formula sentence, not the whole document', () => {
    const doc =
      'The marital deduction amount shall be computed as a fractional share formula under the Code. I give one-quarter (1/4) of the balance to my sister.';
    const { normText } = normalize(doc);
    expect(normText).toContain('fractional share formula');
    expect(normText).toContain('{{FRACTION}}');
    expect(normText).not.toContain('one-quarter');
  });
});

describe('blank-token folding (§5.1(3))', () => {
  it('folds execution-date blanks to {{DATE}}', () => {
    const { normText } = normalize(
      'IN WITNESS WHEREOF, I have hereunto set my hand this ____ day of ________, 20__.',
    );
    expect(normText).toContain('{{DATE}}');
    expect(normText).not.toContain('____');
  });

  it('folds dummy names to a name placeholder', () => {
    const { normText } = normalize(
      'I, JOHN DOE, of the County of ________, do hereby declare.',
    );
    expect(normText).toContain('{{NAME}}');
    expect(normText).not.toContain('JOHN DOE');
    expect(normText).toContain('{{BLANK}}');
  });
});
