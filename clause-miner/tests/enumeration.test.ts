import { describe, expect, it } from 'vitest';
import { detectEnumeration, isListItem, stripItemMarker } from '../src/enumeration.js';

describe('isListItem / stripItemMarker', () => {
  it('recognizes common trustee-powers markers', () => {
    for (const line of [
      '(a) To sell any property;',
      '(1) To invest and reinvest;',
      'a. To borrow money;',
      '3. To vote securities;',
      '(iv) To employ agents;',
      '- to manage digital assets;',
    ]) {
      expect(isListItem(line), line).toBe(true);
    }
    expect(isListItem('The Trustee shall have the following powers:')).toBe(false);
  });

  it('strips the marker for item identity', () => {
    expect(stripItemMarker('(a) To sell any property;')).toBe('To sell any property;');
    expect(stripItemMarker('(iv) To employ agents;')).toBe('To employ agents;');
  });
});

describe('detectEnumeration (§4.2 — ≥70% list items)', () => {
  const powers = [
    '(a) To sell, exchange, or otherwise dispose of any property;',
    '(b) To invest and reinvest in stocks, bonds, and securities;',
    '(c) To borrow money and pledge trust assets;',
    '(d) To employ attorneys, accountants, and agents;',
    '(e) To access, manage, and control digital assets;',
  ];

  it('detects a powers article and returns marker-stripped items', () => {
    const result = detectEnumeration(powers);
    expect(result.isEnumerated).toBe(true);
    expect(result.items).toHaveLength(5);
    expect(result.items[4]).toBe('To access, manage, and control digital assets;');
  });

  it('tolerates a lead-in sentence below the 30% non-item budget', () => {
    const result = detectEnumeration([
      'in addition to powers conferred by law:',
      ...powers,
      '(f) To compromise claims;',
      '(g) To make distributions in cash or in kind;',
    ]);
    expect(result.isEnumerated).toBe(true);
    expect(result.items).toHaveLength(7);
  });

  it('rejects prose sections and tiny bodies', () => {
    expect(
      detectEnumeration([
        'The Trustee shall distribute the residue outright.',
        'No bond shall be required of any Trustee.',
        'This Article is governed by New Jersey law.',
      ]).isEnumerated,
    ).toBe(false);
    expect(detectEnumeration(['(a) one item;']).isEnumerated).toBe(false);
  });
});
