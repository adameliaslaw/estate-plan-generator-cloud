/**
 * CalendarPage.tsx
 *
 * Firm-wide calendar overview page (route: /calendar).
 *
 * Shows a summary of what the firm calendar will offer once Google Calendar
 * integration is configured, and directs staff to per-client calendars in the
 * meantime.  Individual client calendars are fully functional now and are
 * accessible from each client's dashboard → Calendar tab.
 */

import { Link } from 'react-router-dom';
import { Calendar, CheckCircle2, ArrowRight, Settings2 } from 'lucide-react';
import { ROUTES } from '@/config/constants';

// ── Appointment types the integration will support ────────────────────────────

const APPOINTMENT_TYPES = [
  {
    label: 'Consultation',
    description: 'Initial intake meeting to review the client\u2019s estate planning goals.',
    color: 'bg-blue-100 text-blue-800',
  },
  {
    label: 'Signing Ceremony',
    description: 'Formal execution of Will, POA, Living Will, and/or Trust documents.',
    color: 'bg-emerald-100 text-emerald-800',
  },
  {
    label: 'Follow-Up',
    description: 'Post-signing review, deed recording follow-up, or plan amendment meeting.',
    color: 'bg-amber-100 text-amber-800',
  },
  {
    label: 'Phone Call',
    description: 'Scheduled phone conference to discuss questionnaire responses or open items.',
    color: 'bg-purple-100 text-purple-800',
  },
] as const;

// ── Sync features planned for the integration ─────────────────────────────────

const SYNC_FEATURES = [
  'Bidirectional sync with Google Calendar — events created in either system stay in sync.',
  'Automatic attendee invitations sent to clients when appointments are booked.',
  'Pull mode — import existing Google Calendar events into the client timeline.',
  'Scheduled background sync every 5 minutes via Cloud Scheduler.',
  "Per-client calendar filtering to show only that client's appointments.",
] as const;

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  return (
    <div className="space-y-8 max-w-3xl">

      {/* Page header */}
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <Calendar className="h-7 w-7 text-[#1a365d]" strokeWidth={1.75} />
          <h1 className="text-2xl font-bold text-[#1a365d]">Firm Calendar</h1>
        </div>
        <p className="text-sm text-gray-500 leading-relaxed">
          Firm-wide calendar aggregating all client appointments.
        </p>
      </div>

      {/* Per-client calendar notice */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-5 py-4">
        <p className="text-sm font-semibold text-blue-800 mb-1">
          Per-client calendars are available now
        </p>
        <p className="text-sm text-blue-700 leading-relaxed">
          Individual client calendars are available on each client's dashboard
          (Calendar tab). You can create, edit, and push events to Google Calendar
          from any client record today.
        </p>
        <Link
          to={ROUTES.CLIENTS}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-blue-800 hover:text-blue-900 underline underline-offset-2 transition-colors"
        >
          Go to Client List
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Coming Soon card */}
      <div className="rounded-xl border border-[#1a365d]/20 bg-white shadow-sm overflow-hidden">

        {/* Card header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-[#1a365d]/[0.03]">
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 tracking-wide uppercase">
            Coming Soon
          </span>
          <p className="text-sm font-medium text-gray-700">
            Firm-wide Google Calendar Integration
          </p>
        </div>

        {/* Card body */}
        <div className="px-6 py-5 space-y-6">

          <p className="text-sm text-gray-600 leading-relaxed">
            Google Calendar integration will sync bidirectionally once configured
            in{' '}
            <Link
              to={ROUTES.SETTINGS}
              className="font-medium text-[#1a365d] underline underline-offset-2 hover:text-[#2b6cb0] transition-colors"
            >
              Settings → Integrations
            </Link>
            . When active, all client appointments will appear in a unified
            calendar view on this page.
          </p>

          {/* Planned sync features */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Planned features
            </p>
            <ul className="space-y-2">
              {SYNC_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-2.5 text-sm text-gray-700">
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-[#1a365d]/50"
                    strokeWidth={2}
                  />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Appointment types */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Appointment types supported
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {APPOINTMENT_TYPES.map(({ label, description, color }) => (
                <div
                  key={label}
                  className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 space-y-1"
                >
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${color}`}
                  >
                    {label}
                  </span>
                  <p className="text-xs text-gray-500 leading-snug">{description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* CTA to Settings */}
          <div className="pt-1">
            <Link
              to={ROUTES.SETTINGS}
              className="inline-flex items-center gap-2 rounded-lg bg-[#1a365d] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#2d4a7a] transition-colors focus:outline-none focus:ring-2 focus:ring-[#1a365d] focus:ring-offset-2"
            >
              <Settings2 className="h-4 w-4" />
              Open Settings → Integrations
            </Link>
          </div>

        </div>
      </div>

    </div>
  );
}
