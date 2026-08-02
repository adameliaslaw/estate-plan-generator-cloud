import { describe, expect, it } from 'vitest';
import { isCommentaryLine } from '../src/core/seed-segment.js';

describe('isCommentaryLine (§11 P1a)', () => {
  it('catches the unambiguous drafting-note markers', () => {
    expect(isCommentaryLine('NOTE: use only for blended families.')).toBe(true);
    expect(isCommentaryLine('DRAFTING NOTE — see the SECURE Act memo.')).toBe(true);
    expect(isCommentaryLine('Use this when the client has minor children.')).toBe(true);
    expect(isCommentaryLine('OMIT IF no minor children.')).toBe(true);
    expect(isCommentaryLine('[Insert only where a corporate trustee serves]')).toBe(true);
  });

  it('never fires on operative text — a false positive deletes a clause', () => {
    expect(isCommentaryLine('The Trustee shall distribute the residue per stirpes.')).toBe(false);
    // Operative text carrying library conventions must NOT be dropped.
    expect(isCommentaryLine('I, JOHN DOE, of ____________, declare this trust.')).toBe(false);
    expect(isCommentaryLine('The Trustee shall pay income to [NAME].')).toBe(false);
    // Short bracketed fill-ins are operative, not asides.
    expect(isCommentaryLine('[NAME]')).toBe(false);
    expect(isCommentaryLine('')).toBe(false);
  });
});
