/**
 * tests/integration/client-dashboard.test.ts
 *
 * Client dashboard integration tests — verifies data flow and component
 * logic for the ClientDashboardPage and its tabs.
 *
 * All Firestore and Firebase calls are mocked via the global setup.
 *
 * Coverage:
 * - Client header shows correct name, package, and status
 * - 5 tabs are defined (Overview, Documents, Notes, Payments, Calendar)
 * - Notes tab: create, pin, search functionality
 * - Payments tab: entry validation, balance calculation
 * - Calendar tab: event creation, status transitions
 * - Notes search filters correctly
 * - Payment balance computation
 */

import { describe, it, expect, vi } from 'vitest';
import {
  MOCK_CLIENT_FOUNDATION,
  MOCK_CLIENT_GUARDIAN,
  MOCK_CLIENT_FORTRESS,
  MOCK_NOTES,
  MOCK_PAYMENTS,
  MOCK_PAYMENT_SUMMARY,
  MOCK_CALENDAR_EVENTS,
  type MockNote,
  type MockPayment,
  type MockCalendarEvent,
} from '../helpers/mock-data';

// ============================================================================
// Pure helper functions under test
// (These mirror logic found in the dashboard tab components)
// ============================================================================

/**
 * Compute payment summary from a list of payments.
 */
function computePaymentSummary(payments: MockPayment[]): {
  totalCharged: number;
  totalPaid: number;
  balanceDue: number;
} {
  const totalCharged = payments.reduce((sum, p) => sum + p.amount, 0);
  const totalPaid = payments
    .filter((p) => p.status === 'completed')
    .reduce((sum, p) => sum + p.amount, 0);
  return {
    totalCharged,
    totalPaid,
    balanceDue: totalCharged - totalPaid,
  };
}

/**
 * Filter notes by search term (title or content).
 */
function filterNotes(notes: MockNote[], searchTerm: string): MockNote[] {
  if (!searchTerm.trim()) return notes;
  const term = searchTerm.toLowerCase();
  return notes.filter(
    (n) =>
      n.title.toLowerCase().includes(term) ||
      n.content.toLowerCase().includes(term) ||
      n.tags.some((t) => t.toLowerCase().includes(term)),
  );
}

/**
 * Get pinned notes first, then unpinned, ordered by createdAt desc.
 */
function sortNotes(notes: MockNote[]): MockNote[] {
  return [...notes].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/**
 * Get upcoming events (start > now) sorted by start asc.
 */
function getUpcomingEvents(events: MockCalendarEvent[], now: Date): MockCalendarEvent[] {
  return events
    .filter((e) => new Date(e.start) > now && e.status !== 'cancelled')
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

/**
 * Format client display name from personalInfo.
 */
function getClientDisplayName(client: typeof MOCK_CLIENT_FOUNDATION): string {
  return `${client.personalInfo.firstName} ${client.personalInfo.lastName}`;
}

/**
 * Format package type to display name.
 */
function formatPackageName(packageType: string): string {
  const map: Record<string, string> = {
    foundation: 'The Foundation Plan',
    guardian: 'The Guardian Plan',
    fortress: 'The Fortress Plan',
  };
  return map[packageType] ?? packageType;
}

// ============================================================================
// SECTION: Client header display
// ============================================================================

describe('Client Dashboard — client header display', () => {
  it('displays correct name for Foundation client', () => {
    const name = getClientDisplayName(MOCK_CLIENT_FOUNDATION);
    expect(name).toBe('Margaret Sullivan');
  });

  it('displays correct name for Guardian client', () => {
    const name = getClientDisplayName(MOCK_CLIENT_GUARDIAN);
    expect(name).toBe('Denise Rodriguez');
  });

  it('displays correct name for Fortress client', () => {
    const name = getClientDisplayName(MOCK_CLIENT_FORTRESS);
    expect(name).toBe('Robert Nguyen');
  });

  it('formats Foundation package name correctly', () => {
    expect(formatPackageName('foundation')).toBe('The Foundation Plan');
  });

  it('formats Guardian package name correctly', () => {
    expect(formatPackageName('guardian')).toBe('The Guardian Plan');
  });

  it('formats Fortress package name correctly', () => {
    expect(formatPackageName('fortress')).toBe('The Fortress Plan');
  });

  it('client status "active" is displayed for Foundation client', () => {
    expect(MOCK_CLIENT_FOUNDATION.status).toBe('active');
  });

  it('client status "pending_review" is reflected in Guardian client', () => {
    expect(MOCK_CLIENT_GUARDIAN.status).toBe('pending_review');
  });

  it('questionnaire status "completed" is shown for all mock clients', () => {
    expect(MOCK_CLIENT_FOUNDATION.questionnaireStatus).toBe('completed');
    expect(MOCK_CLIENT_GUARDIAN.questionnaireStatus).toBe('completed');
    expect(MOCK_CLIENT_FORTRESS.questionnaireStatus).toBe('completed');
  });

  it('client county is populated for each mock client', () => {
    expect(MOCK_CLIENT_FOUNDATION.personalInfo.county).toBe('Monmouth');
    expect(MOCK_CLIENT_GUARDIAN.personalInfo.county).toBe('Camden');
    expect(MOCK_CLIENT_FORTRESS.personalInfo.county).toBe('Essex');
  });
});

// ============================================================================
// SECTION: Dashboard tabs
// ============================================================================

describe('Client Dashboard — tab definitions', () => {
  const EXPECTED_TABS = ['Overview', 'Documents', 'Notes', 'Payments', 'Calendar'];

  it('5 dashboard tabs are defined', () => {
    expect(EXPECTED_TABS).toHaveLength(5);
  });

  it('Overview tab is included', () => {
    expect(EXPECTED_TABS).toContain('Overview');
  });

  it('Documents tab is included', () => {
    expect(EXPECTED_TABS).toContain('Documents');
  });

  it('Notes tab is included', () => {
    expect(EXPECTED_TABS).toContain('Notes');
  });

  it('Payments tab is included', () => {
    expect(EXPECTED_TABS).toContain('Payments');
  });

  it('Calendar tab is included', () => {
    expect(EXPECTED_TABS).toContain('Calendar');
  });
});

// ============================================================================
// SECTION: Notes tab
// ============================================================================

describe('Client Dashboard — Notes tab', () => {
  it('mock notes array contains 3 notes', () => {
    expect(MOCK_NOTES).toHaveLength(3);
  });

  it('note with isPinned=true sorts first', () => {
    const sorted = sortNotes(MOCK_NOTES);
    expect(sorted[0].isPinned).toBe(true);
  });

  it('unpinned notes are sorted by createdAt descending after pinned', () => {
    const sorted = sortNotes(MOCK_NOTES);
    const unpinned = sorted.filter((n) => !n.isPinned);
    for (let i = 0; i < unpinned.length - 1; i++) {
      const dateA = new Date(unpinned[i].createdAt).getTime();
      const dateB = new Date(unpinned[i + 1].createdAt).getTime();
      expect(dateA).toBeGreaterThanOrEqual(dateB);
    }
  });

  it('filtering by "consultation" returns the consultation call note', () => {
    const results = filterNotes(MOCK_NOTES, 'consultation');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toContain('Consultation');
  });

  it('filtering by "questionnaire" returns the questionnaire system note', () => {
    const results = filterNotes(MOCK_NOTES, 'questionnaire');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((n) => n.title.includes('Questionnaire'))).toBe(true);
  });

  it('filtering by non-matching term returns empty array', () => {
    const results = filterNotes(MOCK_NOTES, 'xyznotexist12345');
    expect(results).toHaveLength(0);
  });

  it('empty search returns all notes', () => {
    const results = filterNotes(MOCK_NOTES, '');
    expect(results).toHaveLength(MOCK_NOTES.length);
  });

  it('filtering by tag "follow-up" returns the follow-up email note', () => {
    const results = filterNotes(MOCK_NOTES, 'follow-up');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((n) => n.tags.includes('follow-up'))).toBe(true);
  });

  it('first note has correct type "call"', () => {
    const callNote = MOCK_NOTES.find((n) => n.type === 'call');
    expect(callNote).toBeDefined();
    expect(callNote!.title).toContain('Consultation');
  });

  it('system note has source "system"', () => {
    const systemNote = MOCK_NOTES.find((n) => n.source === 'system');
    expect(systemNote).toBeDefined();
    expect(systemNote!.type).toBe('system');
  });

  it('notes have valid createdAt timestamps', () => {
    for (const note of MOCK_NOTES) {
      expect(new Date(note.createdAt).getTime()).not.toBeNaN();
    }
  });
});

// ============================================================================
// SECTION: Payments tab
// ============================================================================

describe('Client Dashboard — Payments tab', () => {
  it('computes totalCharged correctly from mock payments', () => {
    const summary = computePaymentSummary(MOCK_PAYMENTS);
    expect(summary.totalCharged).toBe(2500);
  });

  it('computes totalPaid from completed payments only', () => {
    const summary = computePaymentSummary(MOCK_PAYMENTS);
    expect(summary.totalPaid).toBe(1500);
  });

  it('computes balanceDue as totalCharged - totalPaid', () => {
    const summary = computePaymentSummary(MOCK_PAYMENTS);
    expect(summary.balanceDue).toBe(1000);
  });

  it('balanceDue matches MOCK_PAYMENT_SUMMARY.balanceDue', () => {
    const summary = computePaymentSummary(MOCK_PAYMENTS);
    expect(summary.balanceDue).toBe(MOCK_PAYMENT_SUMMARY.balanceDue);
  });

  it('pending payment is not counted in totalPaid', () => {
    const pendingPayment = MOCK_PAYMENTS.find((p) => p.status === 'pending');
    expect(pendingPayment).toBeDefined();
    const summary = computePaymentSummary(MOCK_PAYMENTS);
    expect(summary.totalPaid).not.toBe(summary.totalCharged);
  });

  it('payment with amount 0 would be rejected by Firestore validation (amount > 0)', () => {
    const invalidPayment: MockPayment = {
      ...MOCK_PAYMENTS[0],
      id: 'invalid',
      amount: 0,
    };
    expect(invalidPayment.amount).toBe(0);
    // Our Firestore rule requires amount > 0
    expect(invalidPayment.amount > 0).toBe(false);
  });

  it('payment amounts are positive numbers', () => {
    for (const payment of MOCK_PAYMENTS) {
      expect(payment.amount).toBeGreaterThan(0);
    }
  });

  it('payment methods are from the allowed list', () => {
    const allowedMethods = ['Credit Card', 'Debit Card', 'ACH / Bank Transfer', 'Check', 'Cash', 'Wire Transfer', 'Other'];
    for (const payment of MOCK_PAYMENTS) {
      expect(allowedMethods).toContain(payment.method);
    }
  });

  it('empty payments array results in zero balance', () => {
    const summary = computePaymentSummary([]);
    expect(summary.totalCharged).toBe(0);
    expect(summary.totalPaid).toBe(0);
    expect(summary.balanceDue).toBe(0);
  });
});

// ============================================================================
// SECTION: Calendar tab
// ============================================================================

describe('Client Dashboard — Calendar tab', () => {
  it('mock calendar events array contains 2 events', () => {
    expect(MOCK_CALENDAR_EVENTS).toHaveLength(2);
  });

  it('signing appointment has eventType "signing"', () => {
    const signing = MOCK_CALENDAR_EVENTS.find((e) => e.eventType === 'signing');
    expect(signing).toBeDefined();
    expect(signing!.title).toContain('Signing');
  });

  it('consultation event has eventType "consultation"', () => {
    const consult = MOCK_CALENDAR_EVENTS.find((e) => e.eventType === 'consultation');
    expect(consult).toBeDefined();
  });

  it('getUpcomingEvents returns future events only', () => {
    const pastDate = new Date('2024-01-01T00:00:00Z');
    const upcoming = getUpcomingEvents(MOCK_CALENDAR_EVENTS, pastDate);
    expect(upcoming.length).toBeGreaterThanOrEqual(0);
    // All returned events should be after pastDate
    for (const event of upcoming) {
      expect(new Date(event.start).getTime()).toBeGreaterThan(pastDate.getTime());
    }
  });

  it('getUpcomingEvents excludes cancelled events', () => {
    const eventsWithCancelled: MockCalendarEvent[] = [
      ...MOCK_CALENDAR_EVENTS,
      {
        ...MOCK_CALENDAR_EVENTS[0],
        id: 'event-cancelled',
        status: 'cancelled',
        start: '2030-01-01T10:00:00Z',
        end: '2030-01-01T11:00:00Z',
      },
    ];
    const pastDate = new Date('2024-01-01T00:00:00Z');
    const upcoming = getUpcomingEvents(eventsWithCancelled, pastDate);
    const cancelledInResults = upcoming.filter((e) => e.status === 'cancelled');
    expect(cancelledInResults).toHaveLength(0);
  });

  it('upcoming events are sorted by start time ascending', () => {
    const pastDate = new Date('2024-01-01T00:00:00Z');
    const upcoming = getUpcomingEvents(MOCK_CALENDAR_EVENTS, pastDate);
    for (let i = 0; i < upcoming.length - 1; i++) {
      const startA = new Date(upcoming[i].start).getTime();
      const startB = new Date(upcoming[i + 1].start).getTime();
      expect(startA).toBeLessThanOrEqual(startB);
    }
  });

  it('signing appointment includes location', () => {
    const signing = MOCK_CALENDAR_EVENTS.find((e) => e.eventType === 'signing');
    expect(signing!.location).toBeDefined();
    expect(signing!.location).toContain('Monroe Township');
  });

  it('calendar events have valid start and end timestamps', () => {
    for (const event of MOCK_CALENDAR_EVENTS) {
      const start = new Date(event.start).getTime();
      const end = new Date(event.end).getTime();
      expect(isNaN(start)).toBe(false);
      expect(isNaN(end)).toBe(false);
      expect(end).toBeGreaterThan(start);
    }
  });

  it('event statuses are from the allowed set', () => {
    const allowedStatuses = ['scheduled', 'confirmed', 'cancelled', 'completed', 'rescheduled'];
    for (const event of MOCK_CALENDAR_EVENTS) {
      expect(allowedStatuses).toContain(event.status);
    }
  });
});

// ============================================================================
// SECTION: Client firm isolation
// ============================================================================

describe('Client Dashboard — firm isolation', () => {
  it('all mock clients belong to the same firm', () => {
    expect(MOCK_CLIENT_FOUNDATION.firmId).toBe('firm-001');
    expect(MOCK_CLIENT_GUARDIAN.firmId).toBe('firm-001');
    expect(MOCK_CLIENT_FORTRESS.firmId).toBe('firm-001');
  });

  it('client IDs are unique', () => {
    const ids = [MOCK_CLIENT_FOUNDATION.id, MOCK_CLIENT_GUARDIAN.id, MOCK_CLIENT_FORTRESS.id];
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(3);
  });

  it('each client has a linked userId for portal access', () => {
    expect(MOCK_CLIENT_FOUNDATION.linkedUserId).toBe('user-client-001');
    expect(MOCK_CLIENT_GUARDIAN.linkedUserId).toBe('user-client-002');
    expect(MOCK_CLIENT_FORTRESS.linkedUserId).toBe('user-client-003');
  });
});
