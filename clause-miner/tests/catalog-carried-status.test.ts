/**
 * A catalog re-run must not undo attorney decisions: 'removed' (deleted via
 * removeClause) and 'approved' (published) carry forward; everything else —
 * missing doc, first write, or pipeline-set 'mined' — gets the fresh status.
 */
import { describe, expect, it } from 'vitest';
import { carriedStatus } from '../src/stages/catalog.js';

describe('carriedStatus', () => {
  it('carries a removed tombstone so a re-run cannot resurrect the clause', () => {
    expect(carriedStatus({ status: 'removed' })).toBe('removed');
  });

  it('carries an approval so a re-run cannot unpublish the clause', () => {
    expect(carriedStatus({ status: 'approved' })).toBe('approved');
  });

  it('does not carry pipeline-set or absent statuses', () => {
    expect(carriedStatus({ status: 'mined' })).toBeNull();
    expect(carriedStatus({})).toBeNull();
    expect(carriedStatus(null)).toBeNull();
    expect(carriedStatus({ status: 42 })).toBeNull();
  });
});
