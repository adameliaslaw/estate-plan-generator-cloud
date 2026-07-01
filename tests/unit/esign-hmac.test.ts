import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { verifyDropboxSignEventHash } from '../../functions/src/esign-hmac';

// Dropbox Sign signs each event as HMAC-SHA256(event_time + event_type) keyed
// by the account API key, delivered as event.event_hash.
function sign(apiKey: string, time: string, type: string): string {
  return createHmac('sha256', apiKey).update(time + type).digest('hex');
}

describe('verifyDropboxSignEventHash', () => {
  const apiKey = 'test_api_key_abc123';
  const time = '1348177752';
  const type = 'signature_request_signed';

  it('accepts a correctly signed event', () => {
    const hash = sign(apiKey, time, type);
    expect(verifyDropboxSignEventHash(apiKey, time, type, hash)).toBe(true);
  });

  it('rejects a hash signed with the wrong key', () => {
    const hash = sign('different_key', time, type);
    expect(verifyDropboxSignEventHash(apiKey, time, type, hash)).toBe(false);
  });

  it('rejects when event_type is tampered', () => {
    const hash = sign(apiKey, time, type);
    expect(verifyDropboxSignEventHash(apiKey, time, 'signature_request_declined', hash)).toBe(false);
  });

  it('rejects when event_time is tampered', () => {
    const hash = sign(apiKey, time, type);
    expect(verifyDropboxSignEventHash(apiKey, '9999999999', type, hash)).toBe(false);
  });

  it('is order-sensitive (time+type, not type+time)', () => {
    const wrongOrder = createHmac('sha256', apiKey).update(type + time).digest('hex');
    expect(verifyDropboxSignEventHash(apiKey, time, type, wrongOrder)).toBe(false);
  });

  it('rejects empty/missing inputs', () => {
    expect(verifyDropboxSignEventHash('', time, type, 'x')).toBe(false);
    expect(verifyDropboxSignEventHash(apiKey, '', type, 'x')).toBe(false);
    expect(verifyDropboxSignEventHash(apiKey, time, type, '')).toBe(false);
  });
});
