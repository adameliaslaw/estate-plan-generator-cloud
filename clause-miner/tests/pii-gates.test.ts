import { describe, expect, it } from 'vitest';
import {
  AhoCorasick,
  buildPiiGateRequests,
  buildRosterSweep,
  gateOutcome,
  gateVerdict,
  sweepText,
} from '../src/pii-gates.js';

describe('AhoCorasick', () => {
  it('finds multiple overlapping terms', () => {
    const ac = new AhoCorasick(['Rizzo', 'Anthony Rizzo']);
    const matches = ac.scan('Grantor Anthony Rizzo appoints...');
    const terms = matches.map((m) => m.term).sort();
    expect(terms).toEqual(['Anthony Rizzo', 'Rizzo']);
  });

  it('enforces whole-word boundaries', () => {
    const ac = new AhoCorasick(['Rizzo']);
    expect(ac.scan('Rizzoli & Isles')).toEqual([]); // prefix of a longer word
    expect(ac.scan('the Rizzo trust')).toHaveLength(1);
    expect(ac.scan("Rizzo's estate")).toEqual([]); // apostrophe-s is word-joined
  });

  it('is case-sensitive (§5.3 FP engineering)', () => {
    const ac = new AhoCorasick(['Stern']);
    expect(ac.scan('a stern warning')).toEqual([]);
    expect(ac.scan('Mrs. Stern died')).toHaveLength(1);
  });

  it('reports match offsets', () => {
    const ac = new AhoCorasick(['Doe']);
    const matches = ac.scan('John Doe here');
    expect(matches).toEqual([{ term: 'Doe', index: 5 }]);
  });
});

describe('buildRosterSweep (§5.3)', () => {
  it('stoplisted surnames match on FULL NAME only', () => {
    const sweep = buildRosterSweep(['Robert Young', 'Marie Church']);
    // Bare stoplisted surname in ordinary legal prose: no hit.
    expect(sweepText(sweep, 'to any Young beneficiary of the Church').clean).toBe(true);
    // Full names still match.
    expect(sweepText(sweep, 'residue to Robert Young outright').clean).toBe(false);
    expect(sweepText(sweep, 'Marie Church shall serve as Trustee').clean).toBe(false);
    // Non-stoplisted given name still matches alone.
    expect(sweepText(sweep, 'the share of Marie shall lapse').clean).toBe(false);
  });

  it('reports stoplist-suppressed surnames for mandatory human review', () => {
    const sweep = buildRosterSweep(['Robert Young', 'Alice Grant', 'Bob Rizzo']);
    expect(sweep.stoplistSuppressed).toEqual(['Grant', 'Young']);
  });

  it('never puts legal vocabulary in the automaton via folder tokens', () => {
    const sweep = buildRosterSweep(['Wills Estate Planning', 'Trust Banks']);
    expect(
      sweepText(sweep, 'This Trust holds the Wills of the Banks Estate').clean,
    ).toBe(true);
  });

  it('skips short and numeric tokens', () => {
    const sweep = buildRosterSweep(['J. Q. Rizzo (2019)']);
    expect(sweepText(sweep, 'J Q 2019').clean).toBe(true);
    expect(sweepText(sweep, 'per Rizzo').clean).toBe(false);
  });
});

describe('haiku PII gate (net 3 — fail closed)', () => {
  it('builds one haiku request per text', () => {
    const requests = buildPiiGateRequests([
      { id: 'fam1:abc', text: 'clause text' },
      { id: 'fam1:def', text: 'other text' },
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[0].model).toBe('haiku');
    expect(requests[0].customId).toBe('pii:fam1:abc');
    expect(requests[0].tool?.name).toBe('report_pii');
  });

  it('blocks on a hit, on an error, and on an unparseable result', () => {
    expect(gateVerdict({ ok: true, toolInput: { pii_found: false, findings: [] } })).toBe('clean');
    expect(gateVerdict({ ok: true, toolInput: { pii_found: true, findings: ['Jane Q'] } })).toBe(
      'blocked',
    );
    expect(gateVerdict({ ok: false, toolInput: undefined })).toBe('blocked');
    expect(gateVerdict({ ok: true, toolInput: undefined })).toBe('blocked');
    expect(gateVerdict({ ok: true, toolInput: {} })).toBe('blocked'); // fail closed
  });

  it('separates "the model objected" from "the call failed", both still blocking', () => {
    // The blocking behaviour is unchanged — only the recorded reason is new.
    // Without the split, a broken batch is indistinguishable from a PII hit in
    // `piiFindings`, which is what made the pilot's 94.5% block rate
    // uninterpretable.
    expect(gateOutcome({ ok: true, toolInput: { pii_found: false, findings: [] } })).toEqual({
      verdict: 'clean',
      reason: 'clean',
    });
    expect(gateOutcome({ ok: true, toolInput: { pii_found: true, findings: ['Jane Q'] } })).toEqual({
      verdict: 'blocked',
      reason: 'flagged',
    });
    expect(gateOutcome({ ok: false, toolInput: undefined })).toEqual({
      verdict: 'blocked',
      reason: 'error',
    });
    expect(gateOutcome({ ok: true, toolInput: undefined })).toEqual({
      verdict: 'blocked',
      reason: 'error',
    });
    expect(gateOutcome({ ok: true, toolInput: {} })).toEqual({
      verdict: 'blocked',
      reason: 'flagged',
    });
  });

  it('keeps gateVerdict in agreement with gateOutcome on every input', () => {
    const cases = [
      { ok: true, toolInput: { pii_found: false, findings: [] } },
      { ok: true, toolInput: { pii_found: true, findings: ['x'] } },
      { ok: false, toolInput: undefined },
      { ok: true, toolInput: undefined },
      { ok: true, toolInput: {} },
    ];
    for (const c of cases) expect(gateVerdict(c)).toBe(gateOutcome(c).verdict);
  });
});
