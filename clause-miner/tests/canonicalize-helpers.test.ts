import { describe, expect, it } from 'vitest';
import {
  buildLabelRequest,
  parseLabelMappings,
  selectCanonical,
  tokenLevenshteinRatio,
} from '../src/stages/canonicalize.js';
import { config } from '../src/config.js';

describe('tokenLevenshteinRatio (§6.2 / Gate 3 divergence diagnostic)', () => {
  it('identical texts → 1, disjoint texts → 0', () => {
    expect(tokenLevenshteinRatio('a b c', 'a b c')).toBe(1);
    expect(tokenLevenshteinRatio('a b c', 'x y z')).toBe(0);
    expect(tokenLevenshteinRatio('', '')).toBe(1);
  });

  it('one substitution in ten tokens ≈ 0.9', () => {
    const a = 'one two three four five six seven eight nine ten';
    const b = 'one two three four five six seven eight nine ELEVEN';
    expect(tokenLevenshteinRatio(a, b)).toBeCloseTo(0.9, 10);
  });

  it('the 0.80 seed-divergence threshold separates edits from rewrites', () => {
    const seed = 'the trustee shall serve without bond and without compensation for services';
    const lightEdit = 'the trustee shall serve without bond and without compensation for any services';
    const rewrite = 'no trustee bond is required and the trustee waives all fees entirely today';
    expect(tokenLevenshteinRatio(seed, lightEdit)).toBeGreaterThan(
      config.canonical.seedDivergenceLevenshtein,
    );
    expect(tokenLevenshteinRatio(seed, rewrite)).toBeLessThan(
      config.canonical.seedDivergenceLevenshtein,
    );
  });
});

describe('selectCanonical (§6.2 — the data decides)', () => {
  it('most frequent variant wins outright when eras tie', () => {
    const winner = selectCanonical([
      { sigHash: 'aaa', normText: 'A', occurrenceCount: 10, newestEraYear: 2020 },
      { sigHash: 'bbb', normText: 'B', occurrenceCount: 3, newestEraYear: 2020 },
    ]);
    expect(winner.sigHash).toBe('aaa');
  });

  it('newest-era weighting can overturn raw frequency', () => {
    // Old variant: 10 occurrences, pre-2015. Modern variant: 6, newest era.
    // With era weight 2 the modern variant wins (12 > 10).
    const winner = selectCanonical([
      { sigHash: 'old', normText: 'O', occurrenceCount: 10, newestEraYear: 2009 },
      { sigHash: 'new', normText: 'N', occurrenceCount: 6, newestEraYear: 2021 },
    ]);
    expect(winner.sigHash).toBe('new');
  });

  it('deterministic tiebreak by sigHash', () => {
    const winner = selectCanonical([
      { sigHash: 'zzz', normText: 'Z', occurrenceCount: 5, newestEraYear: null },
      { sigHash: 'aaa', normText: 'A', occurrenceCount: 5, newestEraYear: null },
    ]);
    expect(winner.sigHash).toBe('aaa');
  });

  it('throws on an empty family', () => {
    expect(() => selectCanonical([])).toThrow();
  });
});

describe('labeling batch plumbing', () => {
  it('buildLabelRequest is a sonnet forced-tool request', () => {
    const req = buildLabelRequest('fam_1', 'The {{GRANTOR_NAME}} may revoke this trust.');
    expect(req.model).toBe('sonnet');
    expect(req.customId).toBe('label:fam_1');
    expect(req.tool?.name).toBe('label_clause');
    expect(req.userText).toContain('{{GRANTOR_NAME}}');
  });

  it('parseLabelMappings keeps only well-formed entries', () => {
    const mappings = parseLabelMappings({
      mappings: [
        { tag: '{{AGE}}', fillSource: 'attorney', kind: 'age' },
        { tag: '{{GRANTOR_NAME}}', fillSource: 'clientContext', contractField: 'clientFullName', kind: 'party' },
        { tag: '{{BAD}}', fillSource: 'nonsense', kind: 'age' }, // dropped
        { fillSource: 'attorney', kind: 'age' }, // no tag — dropped
      ],
    });
    expect(mappings.size).toBe(2);
    expect(mappings.get('{{GRANTOR_NAME}}')?.contractField).toBe('clientFullName');
  });

  it('parseLabelMappings tolerates garbage', () => {
    expect(parseLabelMappings(undefined).size).toBe(0);
    expect(parseLabelMappings({ mappings: 'nope' }).size).toBe(0);
  });
});
