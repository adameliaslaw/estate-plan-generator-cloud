import { describe, it, expect } from 'vitest';
import {
  selectClausesForDocument,
  resolveClausePlaceholders,
  unresolvedPlaceholders,
  buildClausePlaceholderValues,
  buildClausePromptBlock,
  describeSelection,
  isDraftable,
  MAX_INJECTED_CLAUSES,
  type ClauseEntry,
} from '../../functions/src/clause-selection';

/**
 * Wiring the clause catalog into generation.
 *
 * The tests that matter most here are the ones asserting a clause is NOT
 * drafted with. An unapproved clause has had no attorney review, and a
 * PII-blocked clause plausibly carries a real client's name from the mining
 * corpus — putting either into a different client's will is worse than
 * generating nothing at all.
 */

const VALUES = {
  GRANTOR_NAME: 'Adam J. Elias',
  SPOUSE_NAME: 'Karen K. Elias',
  TRUSTEE: 'Karen K. Elias',
  EXECUTOR: 'Sherif Elias',
};

function entry(over: Partial<ClauseEntry> = {}): ClauseEntry {
  return {
    id: 'c1',
    title: 'Spendthrift',
    canonicalText: 'No beneficiary may assign any interest.',
    status: 'approved',
    origin: 'mined',
    piiScanStatus: 'clean',
    docType: 'will',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The draftability gate
// ---------------------------------------------------------------------------

describe('isDraftable — the safety gate', () => {
  it('accepts an approved, clean mined clause', () => {
    expect(isDraftable(entry())).toBe(true);
  });

  it('accepts an attorney-authored clause regardless of mining status', () => {
    expect(isDraftable(entry({ origin: 'manual', status: undefined }))).toBe(true);
  });

  it('REFUSES a mined clause that has not been approved', () => {
    // 'mined' means nobody has reviewed it. It must never reach a client.
    expect(isDraftable(entry({ status: 'mined' }))).toBe(false);
  });

  it('REFUSES a PII-blocked clause even when approved', () => {
    // Blocked means the text plausibly contains a real name from the source
    // corpus. Drafting with it would be a confidentiality breach.
    expect(isDraftable(entry({ status: 'approved', piiScanStatus: 'blocked' }))).toBe(false);
  });

  it('REFUSES a tombstoned clause', () => {
    expect(isDraftable(entry({ status: 'removed' }))).toBe(false);
  });
});

describe('selectClausesForDocument — exclusions', () => {
  it('drops unapproved, blocked, and removed entries from the selection', () => {
    const sel = selectClausesForDocument({
      docType: 'will',
      values: VALUES,
      entries: [
        entry({ id: 'ok' }),
        entry({ id: 'unapproved', status: 'mined' }),
        entry({ id: 'blocked', piiScanStatus: 'blocked' }),
        entry({ id: 'tombstoned', status: 'removed' }),
      ],
    });
    expect(sel.clauses.map((c) => c.id)).toEqual(['ok']);
  });

  it('does not draft a clause tagged for another docType', () => {
    const sel = selectClausesForDocument({
      docType: 'will',
      values: VALUES,
      entries: [entry({ id: 'w' }), entry({ id: 't', docType: 'trust' })],
    });
    expect(sel.clauses.map((c) => c.id)).toEqual(['w']);
    expect(sel.otherDocTypeCount).toBe(1);
  });

  it('treats an untyped clause as applying to any document', () => {
    // Manually authored entries carry no docType — the picker's add form does
    // not capture one.
    const sel = selectClausesForDocument({
      docType: 'poa',
      values: VALUES,
      entries: [entry({ id: 'manual', origin: 'manual', docType: undefined })],
    });
    expect(sel.clauses.map((c) => c.id)).toEqual(['manual']);
  });

  it('does not draft another jurisdiction\'s clause into an NJ document', () => {
    const sel = selectClausesForDocument({
      docType: 'will',
      state: 'NJ',
      values: VALUES,
      entries: [entry({ id: 'nj', state: 'NJ' }), entry({ id: 'ny', state: 'NY' })],
    });
    expect(sel.clauses.map((c) => c.id)).toEqual(['nj']);
  });

  it('skips an empty clause rather than injecting a blank', () => {
    const sel = selectClausesForDocument({
      docType: 'will',
      values: VALUES,
      entries: [entry({ id: 'empty', canonicalText: '   ' })],
    });
    expect(sel.clauses).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------

describe('placeholder handling', () => {
  it('fills known tokens and leaves unknown ones visible', () => {
    expect(resolveClausePlaceholders('I, {{GRANTOR_NAME}}, appoint {{BENEFICIARY}}.', VALUES))
      .toBe('I, Adam J. Elias, appoint {{BENEFICIARY}}.');
  });

  it('reports the tokens that did not resolve', () => {
    expect(unresolvedPlaceholders('{{GRANTOR_NAME}} and {{WITNESS}} and {{CHILD}}', VALUES))
      .toEqual(['WITNESS', 'CHILD']);
  });

  it('folds an ordinal suffix to its base', () => {
    // {{TRUSTEE_2}} is a TRUSTEE — a value for the base satisfies it.
    expect(unresolvedPlaceholders('{{TRUSTEE_2}}', VALUES)).toEqual([]);
  });

  it('treats an empty string as unresolved, not as a value', () => {
    expect(unresolvedPlaceholders('{{EXECUTOR}}', { EXECUTOR: '' })).toEqual(['EXECUTOR']);
  });

  it('injects only fully-resolved clauses, and reports the rest', () => {
    // An attorney-supplied placeholder can never resolve from client context.
    // Injecting it would emit a live {{TOKEN}} into a client document and trip
    // the unresolved-token review check at high severity.
    const sel = selectClausesForDocument({
      docType: 'will',
      values: VALUES,
      entries: [
        entry({ id: 'clean', canonicalText: 'I, {{GRANTOR_NAME}}, declare this my Will.' }),
        entry({ id: 'needs-atty', title: 'Specific Bequest', canonicalText: 'I give my ring to {{BENEFICIARY}}.' }),
      ],
    });
    expect(sel.clauses.map((c) => c.id)).toEqual(['clean']);
    expect(sel.skipped).toEqual([
      { id: 'needs-atty', title: 'Specific Bequest', unresolved: ['BENEFICIARY'] },
    ]);
  });

  it('never emits an unresolved token into an injected clause', () => {
    const sel = selectClausesForDocument({
      docType: 'will',
      values: VALUES,
      entries: [
        entry({ id: 'a', canonicalText: 'To {{SPOUSE_NAME}}.' }),
        entry({ id: 'b', canonicalText: 'To {{UNKNOWN_ROLE}}.' }),
      ],
    });
    for (const c of sel.clauses) expect(c.text).not.toMatch(/\{\{/);
  });
});

describe('buildClausePlaceholderValues', () => {
  it('maps the flat docx contract onto placeholder bases', () => {
    const v = buildClausePlaceholderValues({
      clientFullName: 'Adam J. Elias',
      spouseFullName: 'Karen K. Elias',
      trusteeName: 'Karen K. Elias',
      alternateTrusteeName: 'Roger Kondos',
      clientState: 'NJ',
    });
    expect(v.GRANTOR_NAME).toBe('Adam J. Elias');
    expect(v.SETTLOR).toBe('Adam J. Elias');
    expect(v.TESTATOR).toBe('Adam J. Elias');
    expect(v.SUCCESSOR_TRUSTEE).toBe('Roger Kondos');
    expect(v.JURISDICTION).toBe('NJ');
  });

  it('leaves attorney-supplied roles absent so their clauses get skipped', () => {
    const v = buildClausePlaceholderValues({ clientFullName: 'Adam J. Elias' });
    expect(v.BENEFICIARY).toBeUndefined();
    expect(v.WITNESS).toBeUndefined();
  });

  it('treats blank and whitespace-only context fields as absent', () => {
    const v = buildClausePlaceholderValues({ clientFullName: '   ', spouseFullName: null });
    expect(v.GRANTOR_NAME).toBeUndefined();
    expect(v.SPOUSE_NAME).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Prompt block
// ---------------------------------------------------------------------------

describe('buildClausePromptBlock', () => {
  const sel = selectClausesForDocument({
    docType: 'will',
    values: VALUES,
    entries: [entry({ id: 'sp', title: 'Spendthrift', category: 'protective' })],
  });

  it('demands verbatim use', () => {
    const block = buildClausePromptBlock(sel);
    expect(block).toContain('VERBATIM');
    expect(block).toMatch(/Do not paraphrase/);
  });

  it('forbids dropping statutory scaffolding to make room', () => {
    // The failure that would turn an improvement into an invalid instrument.
    const block = buildClausePromptBlock(sel);
    expect(block).toMatch(/Never drop a statutory provision/);
    expect(block).toMatch(/self-proving affidavit/);
  });

  it('tells the model to omit rather than adapt a clause that does not fit', () => {
    expect(buildClausePromptBlock(sel)).toMatch(/omit it entirely rather than adapting it/);
  });

  it('is empty when nothing was selected, so the prompt is unchanged', () => {
    const none = selectClausesForDocument({ docType: 'will', values: VALUES, entries: [] });
    expect(buildClausePromptBlock(none)).toBe('');
  });
});

describe('bounds and reporting', () => {
  it('caps injection and keeps the document generating', () => {
    const many = Array.from({ length: MAX_INJECTED_CLAUSES + 10 }, (_, i) =>
      entry({ id: `c${String(i).padStart(3, '0')}` }),
    );
    const sel = selectClausesForDocument({ docType: 'will', values: VALUES, entries: many });
    expect(sel.clauses).toHaveLength(MAX_INJECTED_CLAUSES);
  });

  it('orders deterministically so a regeneration produces the same document', () => {
    const es = [entry({ id: 'b', category: 'z' }), entry({ id: 'a', category: 'a' })];
    const first = selectClausesForDocument({ docType: 'will', values: VALUES, entries: es });
    const second = selectClausesForDocument({ docType: 'will', values: VALUES, entries: [...es].reverse() });
    expect(first.clauses.map((c) => c.id)).toEqual(second.clauses.map((c) => c.id));
  });

  it('names what was held back, so a skip is never silent', () => {
    const sel = selectClausesForDocument({
      docType: 'will',
      values: VALUES,
      entries: [
        entry({ id: 'ok' }),
        entry({ id: 's1', title: 'Bequest', canonicalText: 'to {{BENEFICIARY}}' }),
        entry({ id: 't1', docType: 'trust' }),
      ],
    });
    const line = describeSelection(sel);
    expect(line).toContain('1 clause(s) injected');
    expect(line).toContain('1 skipped');
    expect(line).toContain('BENEFICIARY');
    expect(line).toContain('1 for other doc types');
  });
});
