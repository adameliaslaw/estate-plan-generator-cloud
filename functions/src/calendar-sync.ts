/**
 * functions/src/calendar-sync.ts
 *
 * Google Calendar API v3 integration for the NJ Estate Plan Generator.
 *
 * Three Cloud Functions:
 *
 * 1. pushEventToGoogleCalendar (onCall v2)
 *    Creates or updates a Google Calendar event from a Firestore CalendarEvent doc.
 *
 * 2. pullGoogleCalendarEvents (onCall v2)
 *    Pulls events from Google Calendar that match a client name and upserts them
 *    into Firestore CalendarEvent documents.
 *
 * 3. syncGoogleCalendar (scheduled — commented out)
 *    Bidirectional sync job intended to run every 5 minutes via Cloud Scheduler.
 *    Activate by uncommenting at deployment time.
 *
 * Firestore paths:
 *   Calendar events:  firms/{firmId}/calendarEvents/{eventId}
 *   Firm settings:    firms/{firmId}
 *     └─ googleCalendar.accessToken   (OAuth 2.0 access token)
 *     └─ googleCalendar.refreshToken  (OAuth 2.0 refresh token)
 *     └─ googleCalendar.tokenExpiry   (epoch ms)
 *
 * Google Calendar API:  https://www.googleapis.com/calendar/v3/
 *
 * NOTE: All Google API calls use fetch() rather than the googleapis npm client.
 *       The googleapis package will be added to package.json at deployment time
 *       for cleaner token handling.  See TODO comments for OAuth refresh flow.
 */

import * as functions from 'firebase-functions/v1';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';

// Typed shapes for Google OAuth token API responses
interface GoogleOAuthTokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

interface GoogleOAuthErrorResponse {
  error?: string;
  error_description?: string;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PushEventRequest {
  firmId: string;
  eventId: string;
}

interface PullEventsRequest {
  firmId: string;
  clientName: string;
  /** ISO 8601 datetime string — start of search window */
  timeMin?: string;
  /** ISO 8601 datetime string — end of search window */
  timeMax?: string;
}

/** Fields we store on a Firestore CalendarEvent document. */
interface CalendarEventDoc {
  id: string;
  firmId: string;
  clientId?: string;
  title: string;
  description?: string;
  location?: string;
  startAt: admin.firestore.Timestamp;
  endAt: admin.firestore.Timestamp;
  attendeeEmail?: string;
  attendeeName?: string;
  googleCalendarEventId?: string;
  googleCalendarSyncedAt?: admin.firestore.FieldValue;
  createdAt?: admin.firestore.FieldValue;
  updatedAt?: admin.firestore.FieldValue;
}

/** Firm-level Google Calendar OAuth token data (subset of firms/{firmId}). */
interface GoogleCalendarTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds when the access token expires. */
  tokenExpiry?: number;
}

/** Shape of a Google Calendar Event resource (relevant fields). */
interface GoogleCalendarEvent {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email: string; displayName?: string }>;
  status?: string;
  htmlLink?: string;
  updated?: string;
}

/** Shape of the Google Calendar Events.list response. */
interface GoogleCalendarEventsListResponse {
  kind?: string;
  nextPageToken?: string;
  items?: GoogleCalendarEvent[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Retrieve the Google Calendar OAuth tokens stored under a firm's Firestore doc.
 * Throws `failed-precondition` if no tokens are found.
 */
async function getGoogleCalendarTokens(
  db: admin.firestore.Firestore,
  firmId: string,
): Promise<GoogleCalendarTokens> {
  const firmSnap = await db.doc(`firms/${firmId}`).get();
  if (!firmSnap.exists) {
    throw new functions.https.HttpsError('not-found', `Firm ${firmId} not found.`);
  }

  const firmData = firmSnap.data()!;
  const tokens = firmData.googleCalendar as GoogleCalendarTokens | undefined;

  if (!tokens?.accessToken || !tokens?.refreshToken) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Google Calendar not connected. Configure OAuth in Settings → Integrations.',
    );
  }

  return tokens;
}

/**
 * Refresh an expired Google Calendar access token using the stored OAuth 2.0 refresh token.
 *
 * ─── OAuth 2.0 Refresh Token Flow ───────────────────────────────────────────
 *
 * When a Google OAuth access token expires (typically after 1 hour), the client
 * must exchange the long-lived refresh token for a new access token without
 * requiring the user to re-authenticate.  The exchange is a server-side POST
 * to Google's token endpoint:
 *
 *   Endpoint:  https://oauth2.googleapis.com/token
 *   Method:    POST
 *   Headers:   Content-Type: application/x-www-form-urlencoded
 *
 *   Request body fields:
 *     grant_type     (required) Must be exactly "refresh_token".
 *     client_id      (required) The OAuth 2.0 client ID from your Google Cloud
 *                               project (same value used during the initial
 *                               authorization flow).  Store in Firebase Secret
 *                               Manager as GOOGLE_CLIENT_ID.
 *     client_secret  (required) The OAuth 2.0 client secret paired with the
 *                               client_id above.  Store in Firebase Secret
 *                               Manager as GOOGLE_CLIENT_SECRET.
 *     refresh_token  (required) The refresh token previously obtained during
 *                               the OAuth consent flow and stored at
 *                               firms/{firmId}/googleCalendar.refreshToken.
 *
 *   Successful response (200 OK, application/json):
 *     {
 *       "access_token":  "ya29.new_access_token",
 *       "expires_in":    3599,          // seconds until expiry
 *       "token_type":    "Bearer",
 *       "scope":         "https://www.googleapis.com/auth/calendar"
 *     }
 *
 *   Error response (400 Bad Request):
 *     { "error": "invalid_grant", "error_description": "Token has been expired or revoked." }
 *     → When invalid_grant is returned the refresh token has been revoked and
 *       the firm owner must re-authorise via Settings → Integrations → Google Calendar.
 *
 * ─── Implementation Notes ────────────────────────────────────────────────────
 *
 *   1. After a successful refresh, persist the new access_token and updated
 *      tokenExpiry back to Firestore so subsequent calls within the same
 *      expiry window skip the round-trip:
 *        firms/{firmId}.googleCalendar.accessToken  = access_token
 *        firms/{firmId}.googleCalendar.tokenExpiry  = Date.now() + expires_in * 1000
 *
 *   2. GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be provisioned as
 *      Firebase Secret Manager secrets (not plain environment variables) to
 *      avoid leaking credentials into source control or build artefacts.
 *      Reference them in the function definition via:
 *        secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']
 *      and access at runtime via process.env.GOOGLE_CLIENT_ID etc.
 *
 *   3. The 60-second buffer on tokenExpiry prevents race conditions where a
 *      token expires between the expiry check and the downstream API call.
 *
 * ─── Configuration ───────────────────────────────────────────────────────────
 *
 *   // Configure in Settings → Integrations → Google Calendar
 *
 * @param db      — Firestore admin instance.
 * @param firmId  — Firm document ID; used to read and update token storage.
 * @param tokens  — Current tokens read from firms/{firmId}.googleCalendar.
 * @returns       The access token to use for the current API call (refreshed or
 *                still-valid existing token).
 */
async function refreshAccessTokenIfNeeded(
  db: admin.firestore.Firestore,
  firmId: string,
  tokens: GoogleCalendarTokens,
): Promise<string> {
  // Check if the current token is still valid (with a 60-second safety buffer
  // to guard against the token expiring mid-flight).
  if (tokens.tokenExpiry && Date.now() < tokens.tokenExpiry - 60_000) {
    return tokens.accessToken; // Still valid — no refresh needed.
  }

  // OAuth Refresh Flow
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';

  if (!clientId || !clientSecret) {
    console.warn('[calendar-sync] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET, unable to refresh token. Add them via Firebase secret manager.');
    throw new functions.https.HttpsError(
      'internal',
      'OAuth refresh is not fully configured. Missing client secrets in Cloud Functions.',
    );
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refreshToken,
    }),
  });

  if (!response.ok) {
    const err = (await response.json()) as GoogleOAuthErrorResponse;
    console.error('[refreshAccessTokenIfNeeded] Detailed Google API Error Payload:', JSON.stringify(err, null, 2));

    if (err.error === 'invalid_grant') {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Google Calendar authorisation has been revoked. ' +
        'Please reconnect via Settings → Integrations → Google Calendar.',
      );
    }
    throw new functions.https.HttpsError('internal', `Token refresh failed: ${err.error} - ${err.error_description || 'No description'}`);
  }

  const tokenData = (await response.json()) as GoogleOAuthTokenResponse;
  const newExpiry = Date.now() + (tokenData.expires_in ?? 3600) * 1000;
  const newAccessToken = tokenData.access_token ?? '';

  await db.doc(`firms/${firmId}`).update({
    'googleCalendar.accessToken': newAccessToken,
    'googleCalendar.tokenExpiry': newExpiry,
  });

  return newAccessToken;
}

/**
 * Build the Firestore reference for a CalendarEvent document.
 */
function calendarEventRef(
  db: admin.firestore.Firestore,
  firmId: string,
  eventId: string,
): admin.firestore.DocumentReference {
  return db.collection('firms').doc(firmId).collection('calendarEvents').doc(eventId);
}

/**
 * Safely convert a Firestore Timestamp to an ISO 8601 string for Google Calendar.
 */
function timestampToISO(ts: admin.firestore.Timestamp | undefined): string {
  if (!ts) return new Date().toISOString();
  return ts.toDate().toISOString();
}

// ---------------------------------------------------------------------------
// Function 1 — pushEventToGoogleCalendar (onCall)
// ---------------------------------------------------------------------------

/**
 * pushEventToGoogleCalendar
 *
 * Reads a CalendarEvent document from Firestore and creates (or updates) the
 * corresponding event on the firm's primary Google Calendar.  Stores the
 * returned Google Calendar event ID back on the Firestore doc.
 *
 * Input:  { firmId, eventId }
 * Output: { success: true, googleCalendarEventId: string, htmlLink: string }
 */
export const pushEventToGoogleCalendar = functions
  .region('us-east1')
  .runWith({
    timeoutSeconds: 60,
    memory: '256MB',
    secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  })
  .https.onCall(async (data: any, context: functions.https.CallableContext) => {
    // ------------------------------------------------------------------
    // 1. Auth check
    // ------------------------------------------------------------------
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'You must be logged in to sync calendar events.',
      );
    }

    const { firmId, eventId } = data as PushEventRequest;

    if (!firmId || !eventId) {
      throw new functions.https.HttpsError('invalid-argument', 'firmId and eventId are required.');
    }

    console.log(
      `[pushEventToGoogleCalendar] START firmId=${firmId} eventId=${eventId}`,
    );

    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();

    // ------------------------------------------------------------------
    // 2. Read the CalendarEvent document from Firestore
    // ------------------------------------------------------------------
    const eventRef = calendarEventRef(db, firmId, eventId);
    const eventSnap = await eventRef.get();

    if (!eventSnap.exists) {
      throw new functions.https.HttpsError('not-found', `CalendarEvent ${eventId} not found.`);
    }

    const eventDoc = eventSnap.data() as CalendarEventDoc;

    // ------------------------------------------------------------------
    // 3. Get Google Calendar OAuth tokens for this firm
    // ------------------------------------------------------------------
    const tokens = await getGoogleCalendarTokens(db, firmId);
    const accessToken = await refreshAccessTokenIfNeeded(db, firmId, tokens);

    // ------------------------------------------------------------------
    // 4. Build the Google Calendar event resource
    // ------------------------------------------------------------------
    const firmSnap = await db.collection('firms').doc(firmId).get();
    const firmData = firmSnap.data() || {};
    const timeZone = firmData.timeZone || 'America/New_York';

    const gcalEvent: GoogleCalendarEvent = {
      summary: eventDoc.title,
      description: eventDoc.description ?? '',
      location: eventDoc.location ?? '',
      start: {
        dateTime: timestampToISO(eventDoc.startAt),
        timeZone: timeZone,
      },
      end: {
        dateTime: timestampToISO(eventDoc.endAt),
        timeZone: timeZone,
      },
    };

    // Add client as attendee if email is available
    if (eventDoc.attendeeEmail) {
      gcalEvent.attendees = [
        {
          email: eventDoc.attendeeEmail,
          ...(eventDoc.attendeeName ? { displayName: eventDoc.attendeeName } : {}),
        },
      ];
    }

    // ------------------------------------------------------------------
    // 5. Create or update via Google Calendar API v3
    //    - If googleCalendarEventId already exists → PATCH (update)
    //    - Otherwise → POST (insert)
    // ------------------------------------------------------------------
    const calendarId = 'primary';
    const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

    let gcalResponse: GoogleCalendarEvent;
    let response: Response | undefined;
    try {
      if (eventDoc.googleCalendarEventId) {
        // Update existing event
        const updateUrl = `${baseUrl}/${encodeURIComponent(eventDoc.googleCalendarEventId)}`;
        console.log(`[pushEventToGoogleCalendar] Updating existing event — ${updateUrl}`);
        response = await fetch(updateUrl, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify(gcalEvent),
        });
      } else {
        // Create new event
        console.log(`[pushEventToGoogleCalendar] Creating new event — ${baseUrl}`);
        response = await fetch(baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify(gcalEvent),
        });
      }

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(
          `[pushEventToGoogleCalendar] Google API error ${response.status}: ${errorBody}`,
        );

        // 401 Unauthorized → tokens are invalid/expired
        if (response.status === 401) {
          throw new functions.https.HttpsError(
            'unauthenticated',
            'Google Calendar authorization expired. Please reconnect Google Calendar in Settings.',
          );
        }

        throw new functions.https.HttpsError(
          'internal',
          `Google Calendar API returned ${response.status}: ${errorBody}.`,
        );
      }

      gcalResponse = (await response.json()) as GoogleCalendarEvent;
    } catch (error) {
      if (error instanceof functions.https.HttpsError) throw error;
      console.error('[pushEventToGoogleCalendar] Fetch error:', error);
      throw new functions.https.HttpsError(
        'internal',
        `Failed to reach Google Calendar API: ${error instanceof Error ? error.message : 'Network error'}`,
      );
    }

    const googleCalendarEventId = gcalResponse.id ?? '';
    const htmlLink = gcalResponse.htmlLink ?? '';

    console.log(
      `[pushEventToGoogleCalendar] Success — googleCalendarEventId=${googleCalendarEventId}`,
    );

    // ------------------------------------------------------------------
    // 6. Persist googleCalendarEventId back to Firestore
    // ------------------------------------------------------------------
    await eventRef.update({
      googleCalendarEventId,
      googleCalendarHtmlLink: htmlLink,
      googleCalendarSyncedAt: now,
      updatedAt: now,
      updatedBy: context.auth.uid,
    });

    return {
      success: true,
      eventId,
      googleCalendarEventId,
      htmlLink,
    };
  },
  );

// ---------------------------------------------------------------------------
// Function 2 — pullGoogleCalendarEvents (onCall)
// ---------------------------------------------------------------------------

/**
 * pullGoogleCalendarEvents
 *
 * Searches the firm's Google Calendar for events whose summary contains the
 * specified client name.  New events are inserted as CalendarEvent documents in
 * Firestore; already-linked events are skipped.
 *
 * Input:  { firmId, clientName, timeMin?, timeMax? }
 * Output: { imported: number, skipped: number, events: Array<{ eventId, title }> }
 */
export const pullGoogleCalendarEvents = functions
  .region('us-east1')
  .runWith({
    timeoutSeconds: 60,
    memory: '256MB',
    secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  })
  .https.onCall(async (data: any, context: functions.https.CallableContext) => {
    // ------------------------------------------------------------------
    // 1. Auth check
    // ------------------------------------------------------------------
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'You must be logged in to pull calendar events.',
      );
    }

    const { firmId, clientName, timeMin, timeMax } =
      data as PullEventsRequest;

    if (!firmId || !clientName?.trim()) {
      throw new functions.https.HttpsError('invalid-argument', 'firmId and clientName are required.');
    }

    console.log(
      `[pullGoogleCalendarEvents] firmId=${firmId} clientName="${clientName}"`,
    );

    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();

    // ------------------------------------------------------------------
    // 2. Get OAuth tokens
    // ------------------------------------------------------------------
    const tokens = await getGoogleCalendarTokens(db, firmId);
    const accessToken = await refreshAccessTokenIfNeeded(db, firmId, tokens);

    // ------------------------------------------------------------------
    // 3. Query Google Calendar for events matching client name
    // ------------------------------------------------------------------

    // Default window: next 90 days if not specified
    const defaultTimeMin = new Date().toISOString();
    const defaultTimeMax = new Date(
      Date.now() + 90 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const params = new URLSearchParams({
      q: clientName.trim(),                        // free-text search
      timeMin: timeMin ?? defaultTimeMin,
      timeMax: timeMax ?? defaultTimeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50',
    });

    const listUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`;
    console.log(`[pullGoogleCalendarEvents] Fetching — ${listUrl}`);

    let gcalEvents: GoogleCalendarEvent[] = [];
    try {
      const response = await fetch(listUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(
          `[pullGoogleCalendarEvents] Google API error ${response.status}: ${errorBody}`,
        );
        if (response.status === 401) {
          throw new functions.https.HttpsError(
            'unauthenticated',
            'Google Calendar authorization expired. Please reconnect in Settings.',
          );
        }
        throw new functions.https.HttpsError(
          'internal',
          `Google Calendar API returned ${response.status}.`,
        );
      }

      const listResponse = (await response.json()) as GoogleCalendarEventsListResponse;
      gcalEvents = listResponse.items ?? [];
    } catch (error) {
      if (error instanceof functions.https.HttpsError) throw error;
      console.error('[pullGoogleCalendarEvents] Fetch error:', error);
      throw new functions.https.HttpsError(
        'internal',
        `Failed to reach Google Calendar API: ${error instanceof Error ? error.message : 'Network error'}`,
      );
    }

    console.log(
      `[pullGoogleCalendarEvents] Found ${gcalEvents.length} events matching "${clientName}"`,
    );

    // ------------------------------------------------------------------
    // 4. Check which Google Calendar event IDs are already in Firestore
    //    to avoid creating duplicate CalendarEvent docs.
    // ------------------------------------------------------------------
    const gcalIds = gcalEvents
      .map((e) => e.id)
      .filter((id): id is string => !!id);

    const existingSnap = await db
      .collection('firms')
      .doc(firmId)
      .collection('calendarEvents')
      .where('googleCalendarEventId', 'in', gcalIds.length > 0 ? gcalIds.slice(0, 30) : ['__none__'])
      .get();

    const alreadyLinked = new Set(
      existingSnap.docs.map((d) => d.data().googleCalendarEventId as string),
    );

    // ------------------------------------------------------------------
    // 5. Insert new CalendarEvent docs for events not yet in Firestore
    // ------------------------------------------------------------------
    const batch = db.batch();
    const imported: Array<{ eventId: string; title: string }> = [];
    let skipped = 0;

    for (const gcalEvent of gcalEvents) {
      if (!gcalEvent.id) continue;

      if (alreadyLinked.has(gcalEvent.id)) {
        skipped++;
        continue;
      }

      const newRef = db
        .collection('firms')
        .doc(firmId)
        .collection('calendarEvents')
        .doc(); // auto-ID

      const startDateTime =
        gcalEvent.start?.dateTime ?? gcalEvent.start?.date;
      const endDateTime =
        gcalEvent.end?.dateTime ?? gcalEvent.end?.date;

      const startDate = startDateTime ? new Date(startDateTime) : new Date();
      const endDate = endDateTime ? new Date(endDateTime) : new Date();

      const newEventDoc: Record<string, unknown> = {
        id: newRef.id,
        firmId,
        title: gcalEvent.summary ?? '(No Title)',
        description: gcalEvent.description ?? '',
        location: gcalEvent.location ?? '',
        startAt: admin.firestore.Timestamp.fromDate(startDate),
        endAt: admin.firestore.Timestamp.fromDate(endDate),
        googleCalendarEventId: gcalEvent.id,
        googleCalendarHtmlLink: (gcalEvent as { htmlLink?: string }).htmlLink ?? '',
        googleCalendarSyncedAt: now,
        source: 'google_calendar_pull',
        createdAt: now,
        updatedAt: now,
        createdBy: context.auth.uid,
      };

      // Capture first attendee that is NOT the firm (best-effort)
      const externalAttendee = gcalEvent.attendees?.find(
        (a) => !a.email.includes('adameliaslaw.com'),
      );
      if (externalAttendee) {
        newEventDoc['attendeeEmail'] = externalAttendee.email;
        newEventDoc['attendeeName'] = externalAttendee.displayName ?? '';
      }

      batch.set(newRef, newEventDoc);
      imported.push({ eventId: newRef.id, title: gcalEvent.summary ?? '(No Title)' });
    }

    if (imported.length > 0) {
      await batch.commit();
      console.log(
        `[pullGoogleCalendarEvents] Imported ${imported.length} new events, skipped ${skipped} already-linked`,
      );
    } else {
      console.log(
        `[pullGoogleCalendarEvents] No new events to import (${skipped} already linked)`,
      );
    }

    return {
      imported: imported.length,
      skipped,
      events: imported,
    };
  },
  );

// ---------------------------------------------------------------------------
// Function 3 — syncGoogleCalendar (scheduled)
// ---------------------------------------------------------------------------

export const syncGoogleCalendar = onSchedule(
  {
    schedule: 'every 5 minutes',
    region: 'us-east1',
    timeoutSeconds: 540,  // 9 minutes max (Cloud Scheduler allows up to 10)
    memory: '512MiB',
    secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  },
  async (_event) => {
    console.log('[syncGoogleCalendar] Starting scheduled sync...');
    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();

    // 1. Find all firms
    const firmsSnap = await db.collection('firms').get();

    let firmsProcessed = 0;
    let eventsUpdated = 0;

    for (const firmDoc of firmsSnap.docs) {
      const firmId = firmDoc.id;
      const data = firmDoc.data();
      if (!data.googleCalendar || !data.googleCalendar.accessToken) continue;

      try {
        const tokens = data.googleCalendar as GoogleCalendarTokens;
        const accessToken = await refreshAccessTokenIfNeeded(db, firmId, tokens);
        const lastSync = (data.googleCalendarLastSyncAt as admin.firestore.Timestamp)?.toDate?.()?.toISOString()
          ?? new Date(Date.now() - 5 * 60 * 1000).toISOString();

        // Fetch events updated since last sync (with pagination support)
        let pageToken: string | undefined = undefined;
        let totalItemsProcessed = 0;

        do {
          const params = new URLSearchParams({
            updatedMin: lastSync,
            showDeleted: 'true',
            singleEvents: 'true',
            maxResults: '250',
          });
          if (pageToken) {
            params.append('pageToken', pageToken);
          }

          const response = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );

          if (!response.ok) {
            console.error(`[syncGoogleCalendar] API error for firm ${firmId}: ${response.status} ${await response.text()}`);
            break;
          }

          const listData = await response.json() as GoogleCalendarEventsListResponse;
          const items = listData.items ?? [];
          pageToken = listData.nextPageToken;

          // Process each updated event (update/insert/cancel in Firestore)
          if (items.length > 0) {
            let batch = db.batch();
            let operationsCount = 0;

            for (const gcalEvent of items) {
              if (!gcalEvent.id) continue;

              // Find existing Firestore doc
              const eventQuery = await db.collection('firms').doc(firmId).collection('calendarEvents')
                .where('googleCalendarEventId', '==', gcalEvent.id).limit(1).get();

              if (!eventQuery.empty) {
                // UPDATE / DELETE existing
                const docRef = eventQuery.docs[0].ref;
                if (gcalEvent.status === 'cancelled') {
                  batch.delete(docRef);
                } else {
                  const startDateTime = gcalEvent.start?.dateTime ?? gcalEvent.start?.date;
                  const endDateTime = gcalEvent.end?.dateTime ?? gcalEvent.end?.date;
                  batch.update(docRef, {
                    title: gcalEvent.summary ?? '(No Title)',
                    description: gcalEvent.description ?? '',
                    location: gcalEvent.location ?? '',
                    startAt: startDateTime ? admin.firestore.Timestamp.fromDate(new Date(startDateTime)) : now,
                    endAt: endDateTime ? admin.firestore.Timestamp.fromDate(new Date(endDateTime)) : now,
                    updatedAt: now,
                    googleCalendarSyncedAt: now,
                  });
                }
              } else if (gcalEvent.status !== 'cancelled') {
                // INSERT new
                const newRef = db.collection('firms').doc(firmId).collection('calendarEvents').doc();
                const startDateTime = gcalEvent.start?.dateTime ?? gcalEvent.start?.date;
                const endDateTime = gcalEvent.end?.dateTime ?? gcalEvent.end?.date;
                batch.set(newRef, {
                  id: newRef.id,
                  firmId,
                  title: gcalEvent.summary ?? '(No Title)',
                  description: gcalEvent.description ?? '',
                  location: gcalEvent.location ?? '',
                  startAt: startDateTime ? admin.firestore.Timestamp.fromDate(new Date(startDateTime)) : now,
                  endAt: endDateTime ? admin.firestore.Timestamp.fromDate(new Date(endDateTime)) : now,
                  googleCalendarEventId: gcalEvent.id,
                  googleCalendarHtmlLink: gcalEvent.htmlLink ?? '',
                  googleCalendarSyncedAt: now,
                  createdAt: now,
                  updatedAt: now,
                  source: 'google_calendar_auto_sync'
                });
              }

              operationsCount++;

              // Firestore batches max out at 500 operations
              if (operationsCount === 450) {
                await batch.commit();
                batch = db.batch();
                operationsCount = 0;
              }
            }

            if (operationsCount > 0) {
              await batch.commit();
            }
          }

          totalItemsProcessed += items.length;

        } while (pageToken);

        eventsUpdated += totalItemsProcessed;

        // Update last sync watermark
        await db.doc(`firms/${firmId}`).update({ googleCalendarLastSyncAt: now });
        firmsProcessed++;
      } catch (err) {
        console.error(`[syncGoogleCalendar] Error for firmId=${firmId}:`, err);
      }
    }

    console.log(`[syncGoogleCalendar] Done — firmsProcessed=${firmsProcessed} eventsUpdated=${eventsUpdated}`);
  },
);

// ---------------------------------------------------------------------------
// Function 4 — triggerFirmCalendarSync (onCall)
// ---------------------------------------------------------------------------

/**
 * triggerFirmCalendarSync
 *
 * Exposes the exact same firm-wide pulling mechanism as the scheduled function,
 * but allows a user to initiate it immediately on-demand from the UI.
 * This is incredibly useful for instantly pulling thousands of historical events
 * without waiting for the 5-minute background tick or when first setting up the integration.
 */
export const triggerFirmCalendarSync = functions
  .region('us-east1')
  .runWith({
    timeoutSeconds: 540,
    memory: '512MB',
    secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  })
  .https.onCall(async (data: any, context: functions.https.CallableContext) => {
    // 1. Auth check
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to trigger a sync.');
    }

    const firmId = context.auth.token.firmId as string;
    if (!firmId) {
      throw new functions.https.HttpsError('permission-denied', 'No firm ID associated with user.');
    }

    console.log(`[triggerFirmCalendarSync] Manual sync started for firmId=${firmId}`);

    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();
    let eventsUpdated = 0;

    const firmDoc = await db.collection('firms').doc(firmId).get();
    if (!firmDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Firm document not found.');
    }

    const firmData = firmDoc.data()!;
    if (!firmData.googleCalendar || !firmData.googleCalendar.accessToken) {
      throw new functions.https.HttpsError('failed-precondition', 'Google Calendar not connected.');
    }

    try {
      const tokens = firmData.googleCalendar as GoogleCalendarTokens;
      const accessToken = await refreshAccessTokenIfNeeded(db, firmId, tokens);

      // For a manual forced sync, we intentionally ignore the incremental watermark and pull 
      // everything modified in the last 2 years to ensure native Google Calendar events are captured.
      const forceSyncDate = new Date();
      forceSyncDate.setFullYear(forceSyncDate.getFullYear() - 2);
      const forceSyncIso = forceSyncDate.toISOString();

      const futureSyncDate = new Date();
      futureSyncDate.setFullYear(futureSyncDate.getFullYear() + 1);
      const futureSyncIso = futureSyncDate.toISOString();

      let pageToken: string | undefined = undefined;
      let totalItemsProcessed = 0;

      do {
        const params = new URLSearchParams({
          timeMin: forceSyncIso,
          timeMax: futureSyncIso,
          showDeleted: 'true',
          singleEvents: 'true',
          maxResults: '250',
        });
        if (pageToken) {
          params.append('pageToken', pageToken);
        }

        const response = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );

        if (!response.ok) {
          throw new functions.https.HttpsError('internal', `Google API error: ${response.status} ${await response.text()}`);
        }

        const listData = await response.json() as GoogleCalendarEventsListResponse;
        const items = listData.items ?? [];
        pageToken = listData.nextPageToken;

        if (items.length > 0) {
          let batch = db.batch();
          let operationsCount = 0;

          for (const gcalEvent of items) {
            if (!gcalEvent.id) continue;

            const eventQuery = await db.collection('firms').doc(firmId).collection('calendarEvents')
              .where('googleCalendarEventId', '==', gcalEvent.id).limit(1).get();

            if (!eventQuery.empty) {
              const docRef = eventQuery.docs[0].ref;
              if (gcalEvent.status === 'cancelled') {
                batch.delete(docRef);
              } else {
                const startDateTime = gcalEvent.start?.dateTime ?? gcalEvent.start?.date;
                const endDateTime = gcalEvent.end?.dateTime ?? gcalEvent.end?.date;
                batch.update(docRef, {
                  title: gcalEvent.summary ?? '(No Title)',
                  description: gcalEvent.description ?? '',
                  location: gcalEvent.location ?? '',
                  startAt: startDateTime ? admin.firestore.Timestamp.fromDate(new Date(startDateTime)) : now,
                  endAt: endDateTime ? admin.firestore.Timestamp.fromDate(new Date(endDateTime)) : now,
                  updatedAt: now,
                  googleCalendarSyncedAt: now,
                });
              }
            } else if (gcalEvent.status !== 'cancelled') {
              const newRef = db.collection('firms').doc(firmId).collection('calendarEvents').doc();
              const startDateTime = gcalEvent.start?.dateTime ?? gcalEvent.start?.date;
              const endDateTime = gcalEvent.end?.dateTime ?? gcalEvent.end?.date;
              batch.set(newRef, {
                id: newRef.id,
                firmId,
                title: gcalEvent.summary ?? '(No Title)',
                description: gcalEvent.description ?? '',
                location: gcalEvent.location ?? '',
                startAt: startDateTime ? admin.firestore.Timestamp.fromDate(new Date(startDateTime)) : now,
                endAt: endDateTime ? admin.firestore.Timestamp.fromDate(new Date(endDateTime)) : now,
                googleCalendarEventId: gcalEvent.id,
                googleCalendarHtmlLink: gcalEvent.htmlLink ?? '',
                googleCalendarSyncedAt: now,
                createdAt: now,
                updatedAt: now,
                source: 'google_calendar_auto_sync'
              });
            }

            operationsCount++;

            if (operationsCount === 450) {
              await batch.commit();
              batch = db.batch();
              operationsCount = 0;
            }
          }

          if (operationsCount > 0) {
            await batch.commit();
          }
        }

        totalItemsProcessed += items.length;

      } while (pageToken);

      eventsUpdated += totalItemsProcessed;
      await db.doc(`firms/${firmId}`).update({ googleCalendarLastSyncAt: now });

    } catch (err) {
      console.error(`[triggerFirmCalendarSync] Error:`, err);
      if (err instanceof functions.https.HttpsError) throw err;
      throw new functions.https.HttpsError('internal', 'An unexpected error occurred during manual sync.');
    }

    console.log(`[triggerFirmCalendarSync] Manual sync done — eventsUpdated=${eventsUpdated}`);
    return { success: true, eventsUpdated };
  },
  );
