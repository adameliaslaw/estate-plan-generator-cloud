import { describe, expect, it } from 'vitest';
import {
  detectExecutionBlock,
  isExecutionBlock,
} from '../src/core/execution-blocks.js';

describe('detectExecutionBlock (§4.2)', () => {
  it('detects IN WITNESS WHEREOF attestation', () => {
    expect(
      detectExecutionBlock(
        'IN WITNESS WHEREOF, I have hereunto set my hand and seal this 3rd day of June, 2019.',
      ),
    ).toBe('execution-block');
  });

  it('detects signed, sealed and delivered blocks', () => {
    expect(
      detectExecutionBlock([
        'Signed, sealed and delivered by the above-named Grantor',
        'in the presence of us, who at the request of the Grantor',
        'have subscribed our names as witnesses.',
      ]),
    ).toBe('execution-block');
  });

  it('detects notary jurat blocks', () => {
    expect(
      detectExecutionBlock([
        'STATE OF NEW JERSEY, COUNTY OF BERGEN, SS.:',
        'Sworn to and subscribed before me this date.',
        'Notary Public of the State of New Jersey',
      ]),
    ).toBe('execution-block');
  });

  it('detects witnesseth-as-to-signature lines', () => {
    expect(
      detectExecutionBlock('Witnesseth as to signature of the Grantor'),
    ).toBe('execution-block');
  });

  it('detects bare signature lines', () => {
    expect(
      detectExecutionBlock(['____________________________', 'Grantor']),
    ).toBe('execution-block');
  });

  it('returns null for operative clause text', () => {
    expect(
      detectExecutionBlock(
        'The Trustee shall distribute the net income of the trust to the beneficiary in quarterly installments.',
      ),
    ).toBeNull();
    expect(
      detectExecutionBlock([
        'ARTICLE IV',
        'No beneficiary shall have the power to anticipate any interest in the trust estate.',
      ]),
    ).toBeNull();
  });

  it('does not fire on a mid-sentence underscore or blank word', () => {
    expect(detectExecutionBlock('the person named as witness herein')).toBeNull();
  });

  it('isExecutionBlock convenience form agrees', () => {
    expect(isExecutionBlock('IN WITNESS WHEREOF, the parties sign below.')).toBe(true);
    expect(isExecutionBlock('The Trustee shall invest the trust estate.')).toBe(false);
  });
});
