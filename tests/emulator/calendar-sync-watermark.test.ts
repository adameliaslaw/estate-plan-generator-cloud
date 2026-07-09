/**
 * tests/emulator/calendar-sync-watermark.test.ts
 *
 * Regression test for R5-055 (#111, T4): the scheduled Google Calendar sync
 * advanced the firm's `googleCalendarLastSyncAt` watermark even when a
 * mid-run `events.list` fetch failed — permanently dropping the un-fetched
 * changes (the next run's `updatedMin` skipped past them). The fix tracks
 * `syncHadError` and only advances the watermark on a fully clean run;
 * re-processing is idempotent (upsert by googleCalendarEventId).
 *
 * Drives the REAL onSchedule handler against the Firestore emulator with a
 * stubbed global fetch (the module talks to Google via plain fetch). The
 * seeded token has a future expiry, so the OAuth refresh path is never hit.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { admin } from './_emulator';

// v2 scheduler trigger — return the raw handler (both resolvable paths).
vi.mock('../../functions/node_modules/firebase-functions/lib/esm/v2/providers/scheduler.mjs', () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}));
vi.mock('../../functions/node_modules/firebase-functions/lib/v2/providers/scheduler.js', () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}));

import { syncGoogleCalendar } from '../../functions/src/calendar-sync';

type Handler = (event: unknown) => Promise<void>;
const handler = syncGoogleCalendar as unknown as Handler;

const FIRM_ID = 'firm-calendar-sync';
const firmRef = () => admin.firestore().doc(`firms/${FIRM_ID}`);
const SEEDED_SYNC_AT = admin.firestore.Timestamp.fromDate(new Date('2026-07-01T00:00:00Z'));

const jsonResponse = (body: unknown) => ({
  ok: true, status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const errorResponse = { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' };

/** Stub fetch: calendarList always succeeds; events.list behavior is injected. */
function stubFetch(eventsFails: boolean) {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.includes('/users/me/calendarList')) {
      return jsonResponse({ items: [{ id: 'cal-1', summary: 'Main', selected: true }] });
    }
    if (u.includes('/calendars/')) {
      return eventsFails ? errorResponse : jsonResponse({ items: [] });
    }
    throw new Error(`unexpected fetch in test: ${u}`);
  }));
}

describe('syncGoogleCalendar — watermark survives a failed fetch (R5-055)', () => {
  beforeEach(async () => {
    await firmRef().set({
      name: 'Calendar Firm',
      googleCalendar: {
        accessToken: 'test-token',
        refreshToken: 'test-refresh',
        tokenExpiry: Date.now() + 60 * 60 * 1000, // future — refresh path skipped
      },
      googleCalendarLastSyncAt: SEEDED_SYNC_AT,
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    // Remove the googleCalendar config so this firm can't affect other suites.
    await firmRef().delete();
  });

  it('a failed events.list fetch does NOT advance the watermark', async () => {
    stubFetch(true);

    await handler({});

    const after = (await firmRef().get()).get('googleCalendarLastSyncAt') as FirebaseFirestore.Timestamp;
    // Pre-fix this advanced anyway, permanently dropping the un-fetched window.
    expect(after.isEqual(SEEDED_SYNC_AT)).toBe(true);
  });

  it('a clean run advances the watermark (positive control)', async () => {
    stubFetch(false);

    await handler({});

    const after = (await firmRef().get()).get('googleCalendarLastSyncAt') as FirebaseFirestore.Timestamp;
    expect(after.toMillis()).toBeGreaterThan(SEEDED_SYNC_AT.toMillis());
  });
});
