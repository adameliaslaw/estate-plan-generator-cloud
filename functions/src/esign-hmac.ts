/**
 * esign-hmac.ts
 *
 * Pure HMAC verification for Dropbox Sign event callbacks, split out from
 * esign-service.ts so it can be unit-tested without pulling in Puppeteer/Chromium.
 */

import * as crypto from 'crypto';

/**
 * Verify a Dropbox Sign event callback. The provider signs each event with
 * HMAC-SHA256 over (event_time + event_type) using the account's API key as the
 * secret, and delivers it as event.event_hash. Constant-time compare.
 */
export function verifyDropboxSignEventHash(
  apiKey: string,
  eventTime: string,
  eventType: string,
  eventHash: string,
): boolean {
  if (!apiKey || !eventTime || !eventType || !eventHash) return false;
  const expected = crypto
    .createHmac('sha256', apiKey)
    .update(eventTime + eventType)
    .digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(eventHash, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
