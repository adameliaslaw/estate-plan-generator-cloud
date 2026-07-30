import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_DERIVED_FACTS,
  FACT_PARTITION,
  INTAKE_OBSERVABLE_FACTS,
  PROVISIONAL_FACTS,
  factClass,
  isCountableFactValue,
  isRuleEligible,
  sanitizeFactVector,
} from '../src/facts-vocabulary.js';

describe('fact partition (§7.1)', () => {
  it('exports the partition as data with the three classes disjoint', () => {
    const all = [
      ...FACT_PARTITION.intake,
      ...FACT_PARTITION.document,
      ...FACT_PARTITION.provisional,
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it('intake-observable facts match the design list exactly', () => {
    expect([...INTAKE_OBSERVABLE_FACTS]).toEqual([
      'married',
      'childCountBand',
      'hasMinorChildren',
      'blendedFamily',
      'specialNeedsBeneficiary',
      'charitableBeneficiary',
      'businessInterests',
      'outOfStateRealProperty',
    ]);
  });

  it('document-derived facts are the drafting outcomes', () => {
    expect([...DOCUMENT_DERIVED_FACTS]).toEqual([
      'trustStructures',
      'distributionStandard',
      'fundedStatus',
    ]);
  });

  it('estateSizeBand is provisional, not intake-observable', () => {
    expect([...PROVISIONAL_FACTS]).toEqual(['estateSizeBand']);
    expect(factClass('estateSizeBand')).toBe('provisional');
    expect(isRuleEligible('estateSizeBand')).toBe(false);
  });

  it('only intake-observable facts are rule-eligible (circularity guard)', () => {
    expect(isRuleEligible('hasMinorChildren')).toBe(true);
    expect(isRuleEligible('distributionStandard')).toBe(false); // circular
    expect(isRuleEligible('fundedStatus')).toBe(false);
    expect(isRuleEligible('nonsense')).toBe(false);
  });
});

describe("'unknown' handling (§7.1 — defined once)", () => {
  it('excludes unknown and empty from contingency cells', () => {
    expect(isCountableFactValue('true')).toBe(true);
    expect(isCountableFactValue('3+')).toBe(true);
    expect(isCountableFactValue('unknown')).toBe(false);
    expect(isCountableFactValue('')).toBe(false);
    expect(isCountableFactValue(undefined)).toBe(false);
    expect(isCountableFactValue(null)).toBe(false);
  });
});

describe('sanitizeFactVector', () => {
  it('coerces off-vocabulary values to unknown', () => {
    const v = sanitizeFactVector({
      married: 'yes', // off-vocab
      childCountBand: '2',
      hasMinorChildren: 'true',
      trustStructures: ['QTIP', 42, 'Spendthrift'],
      distributionStandard: 'HEMS',
    });
    expect(v.married).toBe('unknown');
    expect(v.childCountBand).toBe('2');
    expect(v.hasMinorChildren).toBe('true');
    expect(v.trustStructures).toEqual(['QTIP', 'Spendthrift']);
    expect(v.distributionStandard).toBe('HEMS');
    expect(v.fundedStatus).toBe('unknown');
    expect(v.estateSizeBand).toBe('unknown');
  });
});
