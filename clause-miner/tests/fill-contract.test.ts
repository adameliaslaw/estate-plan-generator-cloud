import { describe, expect, it } from 'vitest';
import {
  buildFillContract,
  extractPlaceholders,
  FillContractError,
  placeholderBase,
  type FillContractMapping,
} from '../src/fill-contract.js';

import { buildFillContract as _bfc } from '../src/fill-contract.js';

describe('SUPPLEMENTAL_NAME (mine-misses roster tag)', () => {
  it('is registered — an unregistered roster tag failed 166/302 families on 2026-08-04', () => {
    expect(() =>
      _bfc('I give to {{SUPPLEMENTAL_NAME}} my residuary estate.', new Map()),
    ).not.toThrow();
  });
});

describe('placeholderBase', () => {
  it('strips ordinal suffixes', () => {
    expect(placeholderBase('{{TRUSTEE_2}}')).toBe('TRUSTEE');
    expect(placeholderBase('{{CHILD_1}}')).toBe('CHILD');
    expect(placeholderBase('{{GRANTOR_NAME}}')).toBe('GRANTOR_NAME');
  });

  it('folds XREF targets to XREF', () => {
    expect(placeholderBase('{{XREF:Section 5.2}}')).toBe('XREF');
    expect(placeholderBase('{{XREF:Article FOURTH}}')).toBe('XREF');
  });
});

describe('extractPlaceholders', () => {
  it('deduplicates in order', () => {
    expect(
      extractPlaceholders('{{GRANTOR_NAME}} and {{TRUSTEE_1}} and {{GRANTOR_NAME}}'),
    ).toEqual(['{{GRANTOR_NAME}}', '{{TRUSTEE_1}}']);
  });
});

describe('buildFillContract (§6.3)', () => {
  it('maps registered placeholders to their contract targets', () => {
    const contract = buildFillContract(
      'The {{GRANTOR_NAME}} appoints {{TRUSTEE_1}} for {{DURATION}} in {{COUNTY}} County.',
    );
    const byTag = new Map(contract.map((m) => [m.tag, m]));
    expect(byTag.get('{{GRANTOR_NAME}}')).toMatchObject({
      fillSource: 'clientContext',
      contractField: 'clientFullName',
    });
    expect(byTag.get('{{TRUSTEE_1}}')).toMatchObject({
      fillSource: 'clientContext',
      contractField: 'trusteeName',
    });
    expect(byTag.get('{{DURATION}}')).toMatchObject({ fillSource: 'attorney', kind: 'duration' });
    expect(byTag.get('{{COUNTY}}')).toMatchObject({
      fillSource: 'clientContext',
      contractField: 'clientCounty',
    });
  });

  it('FAILS on an unregistered tag — no nullGetter blanking', () => {
    expect(() => buildFillContract('Include {{MYSTERY_TAG}} here.')).toThrow(FillContractError);
    expect(() => buildFillContract('Include {{MYSTERY_TAG}} here.')).toThrow(/MYSTERY_TAG/);
  });

  it('accepts a valid override with an indexed semantic tag', () => {
    const overrides = new Map<string, FillContractMapping>([
      [
        '{{AGE}}',
        { tag: '{{AGE}}', kind: 'age', fillSource: 'intake', contractField: 'hasMinorChildren' },
      ],
    ]);
    const contract = buildFillContract('distributes at age {{AGE}}', overrides);
    expect(contract[0]).toMatchObject({ fillSource: 'intake', contractField: 'hasMinorChildren' });
  });

  it('rejects an override targeting an unknown buildDocxTemplateData field', () => {
    const overrides = new Map<string, FillContractMapping>([
      [
        '{{AGE}}',
        { tag: '{{AGE}}', kind: 'age', fillSource: 'clientContext', contractField: 'notAField' },
      ],
    ]);
    expect(() => buildFillContract('at age {{AGE}}', overrides)).toThrow(FillContractError);
  });

  it('rejects an override targeting an unknown intake fact', () => {
    const overrides = new Map<string, FillContractMapping>([
      [
        '{{AGE}}',
        { tag: '{{AGE}}', kind: 'age', fillSource: 'intake', contractField: 'estateSizeBand' },
      ],
    ]);
    // estateSizeBand is provisional, not intake-observable — not a valid rule target.
    expect(() => buildFillContract('at age {{AGE}}', overrides)).toThrow(FillContractError);
  });

  it('handles XREF and successor-chain placeholders', () => {
    const contract = buildFillContract('per {{XREF:Article FOURTH}} then {{SUCCESSOR_CHAIN}} {{CHAIN_DEPTH}}');
    expect(contract.map((m) => m.kind)).toEqual(['xref', 'chain', 'count']);
  });
});
