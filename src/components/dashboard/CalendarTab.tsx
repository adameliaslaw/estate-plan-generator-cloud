/**
 * CalendarTab.tsx
 *
 * Client-scoped calendar for the NJ Estate Plan Generator.
 *
 * Features:
 *   - Monthly / Weekly / Day (agenda) views built from scratch with date-fns
 *   - Real-time Firestore subscription filtered by clientId
 *   - Create / Edit / Delete events via dialog forms
 *   - Google Calendar sync badge
 *   - Fully responsive — defaults to Day view on mobile
 *
 * Props:
 *   firmId        — Firestore firm document ID
 *   clientId      — Client to scope events to
 *   clientName    — Client display name (pre-filled on new events)
 *   autoOpenNewEvent — When true, opens the "New Appointment" dialog immediately
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Timestamp, where, orderBy, type QueryConstraint } from 'firebase/firestore';
import {
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isToday,
  isSameDay,
  isSameMonth,
  isValid,
  parseISO,
  setHours,
  setMinutes,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from 'date-fns';
import {
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit2,
  ExternalLink,
  MapPin,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { cn, isHttpUrl } from '@/lib/utils';
import { useCollection } from '@/hooks/useFirestore';
import { createDoc, updateDoc, deleteDoc } from '@/hooks/useFirestore';
import { COLLECTIONS } from '@/config/constants';
import { sanitizeInput } from '@/utils/sanitize';
import { useAuth } from '@/hooks/useAuth';
import type { CalendarEvent, EventType, Client } from '@/types';
import { documentService } from '@/services/document-service';
import { logSystemActivity } from '@/utils/activity-logger';
import { useCreateClientRedirect } from '@/hooks/useCreateClientRedirect';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type CalendarView = 'month' | 'week' | 'day';

interface CalendarTabProps {
  firmId: string;
  clientId?: string;
  clientName?: string;
  autoOpenNewEvent?: boolean;
}

interface EventFormState {
  title: string;
  eventType: EventType;
  date: string;        // YYYY-MM-DD
  startTime: string;   // HH:MM
  endTime: string;     // HH:MM
  allDay: boolean;
  location: string;
  isVirtual: boolean;
  meetingUrl: string;
  notes: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants & helpers
// ─────────────────────────────────────────────────────────────────────────────

const EVENT_TYPE_CONFIG: Record<
  EventType,
  { label: string; color: string; bg: string; dot: string }
> = {
  consultation: {
    label: 'Consultation',
    color: 'text-[#2b6cb0]',
    bg: 'bg-blue-50 border-blue-200',
    dot: 'bg-[#2b6cb0]',
  },
  signing: {
    label: 'Signing',
    color: 'text-emerald-700',
    bg: 'bg-emerald-50 border-emerald-200',
    dot: 'bg-emerald-500',
  },
  follow_up: {
    label: 'Follow-up',
    color: 'text-amber-700',
    bg: 'bg-amber-50 border-amber-200',
    dot: 'bg-amber-500',
  },
  deadline: {
    label: 'Deadline',
    color: 'text-red-700',
    bg: 'bg-red-50 border-red-200',
    dot: 'bg-red-500',
  },
  other: {
    label: 'Other',
    color: 'text-gray-600',
    bg: 'bg-gray-50 border-gray-200',
    dot: 'bg-gray-400',
  },
};

const EVENT_TYPES: EventType[] = [
  'consultation',
  'signing',
  'follow_up',
  'deadline',
  'other',
];

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function blankForm(date: Date = new Date()): EventFormState {
  return {
    title: '',
    eventType: 'consultation',
    date: format(date, 'yyyy-MM-dd'),
    startTime: '09:00',
    endTime: '10:00',
    allDay: false,
    location: '',
    isVirtual: false,
    meetingUrl: '',
    notes: '',
  };
}

/**
 * Convert a form date + time string to a Firestore Timestamp.
 * Falls back gracefully if the combined string is invalid.
 */
function toTimestamp(dateStr: string, timeStr: string): Timestamp {
  try {
    const [h, m] = timeStr.split(':').map(Number);
    const base = parseISO(dateStr);
    if (!isValid(base)) throw new Error('invalid date');
    const d = setMinutes(setHours(base, h ?? 0), m ?? 0);
    return Timestamp.fromDate(d);
  } catch {
    return Timestamp.fromDate(new Date());
  }
}

/** Format a Firestore Timestamp for display. */
function fmtTime(ts: Timestamp | undefined): string {
  if (!ts) return '';
  try {
    return format(ts.toDate(), 'h:mm a');
  } catch {
    return '';
  }
}

function fmtDate(ts: Timestamp | undefined): string {
  if (!ts) return '';
  try {
    return format(ts.toDate(), 'MMMM d, yyyy');
  } catch {
    return '';
  }
}

function tsToDateStr(ts: Timestamp): string {
  try {
    return format(ts.toDate(), 'yyyy-MM-dd');
  } catch {
    return format(new Date(), 'yyyy-MM-dd');
  }
}

function tsToTimeStr(ts: Timestamp): string {
  try {
    return format(ts.toDate(), 'HH:mm');
  } catch {
    return '09:00';
  }
}

/** Collect all events that fall on a given calendar date. */
function eventsOnDay(
  events: (CalendarEvent & { id: string })[],
  day: Date,
): (CalendarEvent & { id: string })[] {
  return events.filter((e) => {
    try {
      return isSameDay(e.startAt.toDate(), day);
    } catch {
      return false;
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

/** Small colored pill shown inside a calendar cell. */
function EventPill({
  event,
  onClick,
}: {
  event: CalendarEvent & { id: string };
  onClick: () => void;
}) {
  const cfg = EVENT_TYPE_CONFIG[event.eventType] ?? EVENT_TYPE_CONFIG.other;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium leading-tight border transition-opacity hover:opacity-80',
        cfg.bg,
        cfg.color,
        event.isCompleted && 'opacity-50 line-through',
        event.cancelledAt && 'opacity-40 line-through',
      )}
      title={event.title}
    >
      {!event.allDay && (
        <span className="mr-1 opacity-70">{fmtTime(event.startAt)}</span>
      )}
      {event.title}
    </button>
  );
}

/** Google Calendar sync indicator badge. */
function GCalBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-white border border-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-500"
      title="Synced with Google Calendar"
    >
      <span className="font-bold text-blue-500">G</span>
      Synced
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Form
// ─────────────────────────────────────────────────────────────────────────────

function EventForm({
  form,
  onChange,
}: {
  form: EventFormState;
  onChange: (updates: Partial<EventFormState>) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Title */}
      <div className="space-y-1.5">
        <Label htmlFor="evt-title">
          Title <span className="text-red-500">*</span>
        </Label>
        <Input
          id="evt-title"
          value={form.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="e.g. Initial Consultation"
          className="border-gray-200"
          maxLength={200}
        />
      </div>

      {/* Event type */}
      <div className="space-y-1.5">
        <Label htmlFor="evt-type">Event Type</Label>
        <Select
          value={form.eventType}
          onValueChange={(v) => onChange({ eventType: v as EventType })}
        >
          <SelectTrigger id="evt-type" className="border-gray-200">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EVENT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {EVENT_TYPE_CONFIG[t].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Date */}
      <div className="space-y-1.5">
        <Label htmlFor="evt-date">Date</Label>
        <input
          id="evt-date"
          type="date"
          value={form.date}
          onChange={(e) => onChange({ date: e.target.value })}
          className="flex h-9 w-full rounded-md border border-gray-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#2b6cb0]"
        />
      </div>

      {/* All-day toggle */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="evt-allday"
          checked={form.allDay}
          onCheckedChange={(checked) =>
            onChange({ allDay: checked === true })
          }
        />
        <Label htmlFor="evt-allday" className="cursor-pointer font-normal">
          All-day event
        </Label>
      </div>

      {/* Start / End time (hidden when all-day) */}
      {!form.allDay && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="evt-start">Start Time</Label>
            <input
              id="evt-start"
              type="time"
              value={form.startTime}
              onChange={(e) => onChange({ startTime: e.target.value })}
              className="flex h-9 w-full rounded-md border border-gray-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#2b6cb0]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="evt-end">End Time</Label>
            <input
              id="evt-end"
              type="time"
              value={form.endTime}
              onChange={(e) => onChange({ endTime: e.target.value })}
              className="flex h-9 w-full rounded-md border border-gray-200 bg-white px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#2b6cb0]"
            />
          </div>
        </div>
      )}

      {/* Location */}
      <div className="space-y-1.5">
        <Label htmlFor="evt-location">Location</Label>
        <Input
          id="evt-location"
          value={form.location}
          onChange={(e) => onChange({ location: e.target.value })}
          placeholder="Office address or name"
          className="border-gray-200"
        />
      </div>

      {/* Virtual toggle */}
      <div className="flex items-center gap-2">
        <Checkbox
          id="evt-virtual"
          checked={form.isVirtual}
          onCheckedChange={(checked) =>
            onChange({ isVirtual: checked === true })
          }
        />
        <Label htmlFor="evt-virtual" className="cursor-pointer font-normal">
          Virtual meeting
        </Label>
      </div>

      {/* Meeting URL (shown when virtual) */}
      {form.isVirtual && (
        <div className="space-y-1.5">
          <Label htmlFor="evt-url">Meeting URL</Label>
          <Input
            id="evt-url"
            type="url"
            value={form.meetingUrl}
            onChange={(e) => onChange({ meetingUrl: e.target.value })}
            placeholder="https://meet.google.com/…"
            className="border-gray-200"
          />
        </div>
      )}

      {/* Notes */}
      <div className="space-y-1.5">
        <Label htmlFor="evt-notes">Notes</Label>
        <Textarea
          id="evt-notes"
          value={form.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Optional notes…"
          rows={3}
          className="border-gray-200 resize-none"
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Month view
// ─────────────────────────────────────────────────────────────────────────────

function MonthView({
  currentDate,
  events,
  onDayClick,
  onEventClick,
}: {
  currentDate: Date;
  events: (CalendarEvent & { id: string })[];
  onDayClick: (day: Date) => void;
  onEventClick: (event: CalendarEvent & { id: string }) => void;
}) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-gray-200">
        {DAY_HEADERS.map((d) => (
          <div
            key={d}
            className="py-2 text-center text-xs font-semibold uppercase tracking-wider text-gray-400"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7">
        {days.map((day, idx) => {
          const dayEvents = eventsOnDay(events, day);
          const isCurrentMonth = isSameMonth(day, currentDate);
          const isCurrentDay = isToday(day);
          const maxVisible = 3;
          const overflow = dayEvents.length - maxVisible;

          return (
            <div
              key={idx}
              onClick={() => onDayClick(day)}
              className={cn(
                'min-h-[100px] p-1.5 border-b border-r border-gray-100 cursor-pointer',
                'transition-colors hover:bg-[#ebf4ff]/40',
                !isCurrentMonth && 'bg-gray-50/50',
                // Remove right border from last column, bottom border from last row
                (idx + 1) % 7 === 0 && 'border-r-0',
                idx >= days.length - 7 && 'border-b-0',
              )}
            >
              {/* Day number */}
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full text-sm font-medium',
                    isCurrentDay
                      ? 'bg-[#2b6cb0] text-white font-semibold'
                      : isCurrentMonth
                        ? 'text-gray-700'
                        : 'text-gray-300',
                  )}
                >
                  {format(day, 'd')}
                </span>
              </div>

              {/* Event pills */}
              <div className="space-y-0.5">
                {dayEvents.slice(0, maxVisible).map((evt) => (
                  <EventPill
                    key={evt.id}
                    event={evt}
                    onClick={() => onEventClick(evt)}
                  />
                ))}
                {overflow > 0 && (
                  <button
                    className="w-full rounded px-1.5 py-0.5 text-left text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDayClick(day);
                    }}
                  >
                    +{overflow} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Week view
// ─────────────────────────────────────────────────────────────────────────────

function WeekView({
  currentDate,
  events,
  onEventClick,
}: {
  currentDate: Date;
  events: (CalendarEvent & { id: string })[];
  onEventClick: (event: CalendarEvent & { id: string }) => void;
}) {
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-gray-200">
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className={cn(
              'py-3 text-center border-r border-gray-100 last:border-r-0',
            )}
          >
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              {format(day, 'EEE')}
            </div>
            <div
              className={cn(
                'mx-auto mt-1 flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium',
                isToday(day) ? 'bg-[#2b6cb0] text-white' : 'text-gray-700',
              )}
            >
              {format(day, 'd')}
            </div>
          </div>
        ))}
      </div>

      {/* Event columns */}
      <div className="grid grid-cols-7 divide-x divide-gray-100 min-h-[200px]">
        {days.map((day) => {
          const dayEvents = eventsOnDay(events, day);
          return (
            <div
              key={day.toISOString()}
              className={cn(
                'p-1.5 space-y-1',
                isToday(day) && 'bg-[#ebf4ff]/20',
              )}
            >
              {dayEvents.length === 0 ? (
                <div className="h-full min-h-[100px]" />
              ) : (
                dayEvents.map((evt) => (
                  <EventPill
                    key={evt.id}
                    event={evt}
                    onClick={() => onEventClick(evt)}
                  />
                ))
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Day (agenda) view
// ─────────────────────────────────────────────────────────────────────────────

function DayView({
  currentDate,
  events,
  onEventClick,
}: {
  currentDate: Date;
  events: (CalendarEvent & { id: string })[];
  onEventClick: (event: CalendarEvent & { id: string }) => void;
}) {
  const dayEvents = eventsOnDay(events, currentDate).sort((a, b) => {
    try {
      return a.startAt.toDate().getTime() - b.startAt.toDate().getTime();
    } catch {
      return 0;
    }
  });

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div
        className={cn(
          'flex items-center gap-3 border-b border-gray-200 px-4 py-3',
          isToday(currentDate) && 'bg-[#ebf4ff]/30',
        )}
      >
        <div
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-full text-base font-semibold',
            isToday(currentDate)
              ? 'bg-[#2b6cb0] text-white'
              : 'bg-gray-100 text-gray-700',
          )}
        >
          {format(currentDate, 'd')}
        </div>
        <div>
          <p className="text-sm font-semibold text-[#1a365d]">
            {format(currentDate, 'EEEE')}
          </p>
          <p className="text-xs text-gray-400">
            {format(currentDate, 'MMMM yyyy')}
          </p>
        </div>
        <div className="ml-auto">
          <Badge variant="outline" className="text-xs">
            {dayEvents.length === 0
              ? 'No events'
              : `${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}`}
          </Badge>
        </div>
      </div>

      {/* Event list */}
      <div className="divide-y divide-gray-100">
        {dayEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <CalendarDays className="mb-3 h-9 w-9 text-gray-200" />
            <p className="text-sm text-gray-400">No events scheduled for this day.</p>
          </div>
        ) : (
          dayEvents.map((evt) => {
            const cfg =
              EVENT_TYPE_CONFIG[evt.eventType] ?? EVENT_TYPE_CONFIG.other;
            return (
              <button
                key={evt.id}
                onClick={() => onEventClick(evt)}
                className={cn(
                  'w-full px-4 py-3 text-left transition-colors hover:bg-gray-50',
                  evt.cancelledAt && 'opacity-50',
                )}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', cfg.dot)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'text-sm font-semibold text-gray-800',
                          evt.isCompleted && 'line-through text-gray-400',
                        )}
                      >
                        {evt.title}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn('text-[10px] px-1.5 py-0 border', cfg.bg, cfg.color)}
                      >
                        {cfg.label}
                      </Badge>
                      {evt.googleCalendarEventId && <GCalBadge />}
                      {evt.isCompleted && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 bg-emerald-50 border-emerald-200 text-emerald-700"
                        >
                          Done
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-400">
                      {!evt.allDay && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {fmtTime(evt.startAt)} – {fmtTime(evt.endAt)}
                        </span>
                      )}
                      {evt.allDay && (
                        <span className="text-xs text-gray-400">All day</span>
                      )}
                      {evt.location && (
                        <span className="flex items-center gap-1 truncate max-w-[200px]">
                          <MapPin className="h-3 w-3 shrink-0" />
                          {evt.location}
                        </span>
                      )}
                      {evt.isVirtual && evt.meetingUrl && (
                        <span className="flex items-center gap-1">
                          <Video className="h-3 w-3" />
                          Virtual
                        </span>
                      )}
                    </div>
                    {evt.description && (
                      <p className="mt-1 text-xs text-gray-500 line-clamp-2">
                        {evt.description}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Detail / Edit Dialog
// ─────────────────────────────────────────────────────────────────────────────

function EventDetailDialog({
  event,
  open,
  onClose,
  onDeleted,
  onUpdated,
  firmId,
}: {
  event: (CalendarEvent & { id: string }) | null;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
  onUpdated: () => void;
  firmId: string;
}) {
  const { userProfile } = useAuth();
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState<EventFormState>(blankForm());

  // Populate form when event changes or edit mode opens
  useEffect(() => {
    if (!event) return;
    setForm({
      title: event.title,
      eventType: event.eventType,
      date: tsToDateStr(event.startAt),
      startTime: tsToTimeStr(event.startAt),
      endTime: tsToTimeStr(event.endAt),
      allDay: event.allDay,
      location: event.location ?? '',
      isVirtual: event.isVirtual,
      meetingUrl: event.meetingUrl ?? '',
      notes: event.notes ?? '',
    });
    setEditMode(false);
    setConfirmDelete(false);
  }, [event]);

  if (!event) return null;

  const cfg = EVENT_TYPE_CONFIG[event.eventType] ?? EVENT_TYPE_CONFIG.other;

  const handleSave = async () => {
    if (!form.title.trim()) {
      toast.error('Title is required.');
      return;
    }
    if (!isValid(parseISO(form.date))) {
      toast.error('Please choose a valid date.');
      return;
    }
    setSaving(true);
    try {
      const docPath = `${COLLECTIONS.CALENDAR_EVENTS(firmId)}/${event.id}`;
      // Use the edited form.allDay, not the stale event.allDay — toggling the
      // all-day checkbox during edit must affect the saved times (R5-082).
      const startAt = form.allDay
        ? toTimestamp(form.date, '00:00')
        : toTimestamp(form.date, form.startTime);
      const endAt = form.allDay
        ? toTimestamp(form.date, '23:59')
        : toTimestamp(form.date, form.endTime);

      await updateDoc(docPath, {
        title: sanitizeInput(form.title.trim()),
        eventType: form.eventType,
        startAt,
        endAt,
        allDay: form.allDay,
        location: sanitizeInput(form.location.trim()) || null,
        isVirtual: form.isVirtual,
        meetingUrl: form.isVirtual
          ? sanitizeInput(form.meetingUrl.trim()) || null
          : null,
        notes: sanitizeInput(form.notes.trim()) || null,
        updatedBy: userProfile?.uid ?? '',
      });

      // Attempt to immediately sync changes to Google Calendar
      try {
        await documentService.pushEventToGoogleCalendar({ firmId, eventId: event.id });
      } catch (gcalErr) {
        console.error('[CalendarTab] Google Calendar sync failed:', gcalErr);
      }

      toast.success('Event updated.');
      setEditMode(false);
      onUpdated();
    } catch (err) {
      console.error('[CalendarTab] update error:', err);
      toast.error('Failed to update event.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      const docPath = `${COLLECTIONS.CALENDAR_EVENTS(firmId)}/${event.id}`;
      await deleteDoc(docPath);
      toast.success('Event deleted.');
      onDeleted();
      onClose();
    } catch (err) {
      console.error('[CalendarTab] delete error:', err);
      toast.error('Failed to delete event.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#1a365d]">
            <span
              className={cn('h-2.5 w-2.5 rounded-full shrink-0', cfg.dot)}
            />
            {editMode ? 'Edit Event' : 'Event Details'}
          </DialogTitle>
        </DialogHeader>

        {editMode ? (
          <>
            <EventForm
              form={form}
              onChange={(u) => setForm((f) => ({ ...f, ...u }))}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditMode(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-[#1a365d] hover:bg-[#1e407a] text-white"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            {/* Header badge row */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={cn('text-xs font-semibold', cfg.bg, cfg.color)}
              >
                {cfg.label}
              </Badge>
              {event.isCompleted && (
                <Badge variant="outline" className="bg-emerald-50 border-emerald-200 text-emerald-700 text-xs">
                  Completed
                </Badge>
              )}
              {event.cancelledAt && (
                <Badge variant="outline" className="bg-red-50 border-red-200 text-red-700 text-xs">
                  Cancelled
                </Badge>
              )}
              {event.googleCalendarEventId && <GCalBadge />}
            </div>

            {/* Title */}
            <h3 className="text-base font-semibold text-gray-800 leading-snug">
              {event.title}
            </h3>

            <Separator />

            {/* Details */}
            <dl className="space-y-2.5 text-sm">
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-xs font-medium uppercase tracking-wider text-gray-400 pt-0.5">
                  Date
                </dt>
                <dd className="text-gray-700">
                  {fmtDate(event.startAt)}
                  {event.allDay ? (
                    <span className="ml-2 text-xs text-gray-400">(All day)</span>
                  ) : (
                    <span className="ml-2 text-xs text-gray-400">
                      {fmtTime(event.startAt)} – {fmtTime(event.endAt)}
                    </span>
                  )}
                </dd>
              </div>

              {event.location && (
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-xs font-medium uppercase tracking-wider text-gray-400 pt-0.5">
                    Location
                  </dt>
                  <dd className="flex items-start gap-1 text-gray-700">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                    {event.location}
                  </dd>
                </div>
              )}

              {event.isVirtual && event.meetingUrl && isHttpUrl(event.meetingUrl) && (
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-xs font-medium uppercase tracking-wider text-gray-400 pt-0.5">
                    Meeting
                  </dt>
                  <dd>
                    <a
                      href={event.meetingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[#2b6cb0] hover:underline"
                    >
                      <Video className="h-3.5 w-3.5" />
                      Join Virtual Meeting
                      <ExternalLink className="h-3 w-3 opacity-60" />
                    </a>
                  </dd>
                </div>
              )}

              {event.notes && (
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-xs font-medium uppercase tracking-wider text-gray-400 pt-0.5">
                    Notes
                  </dt>
                  <dd className="text-gray-700 whitespace-pre-wrap text-sm">
                    {event.notes}
                  </dd>
                </div>
              )}

              {event.cancelledAt && event.cancellationReason && (
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 text-xs font-medium uppercase tracking-wider text-gray-400 pt-0.5">
                    Cancelled
                  </dt>
                  <dd className="text-red-600 text-sm">
                    {event.cancellationReason}
                  </dd>
                </div>
              )}
            </dl>

            <Separator />

            {/* Action buttons */}
            <div className="flex items-center justify-between gap-2">
              {userProfile?.role !== 'client' && (
                <div className="flex gap-2">
                  {!event.cancelledAt && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-gray-600"
                      onClick={() => setEditMode(true)}
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                  )}

                  {confirmDelete ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-red-600 font-medium">
                        Confirm delete?
                      </span>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleDelete}
                        disabled={deleting}
                      >
                        {deleting ? 'Deleting…' : 'Yes, delete'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmDelete(false)}
                        disabled={deleting}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-red-500 border-red-200 hover:bg-red-50"
                      onClick={() => setConfirmDelete(true)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  )}
                </div>
              )}

              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// New Event Dialog
// ─────────────────────────────────────────────────────────────────────────────

function NewEventDialog({
  open,
  onClose,
  onCreated,
  firmId,
  clientId,
  clientName,
  initialDate,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  firmId: string;
  clientId?: string;
  clientName?: string;
  initialDate: Date;
}) {
  const { userProfile } = useAuth();
  const [form, setForm] = useState<EventFormState>(() => blankForm(initialDate));
  const [saving, setSaving] = useState(false);

  // Firm-wide mode (no fixed client): let the user pick/create a client to link.
  const selectorMode = !clientId;
  const [selectedClientId, setSelectedClientId] = useState('');
  const { data: clients } = useCollection<Client>(
    selectorMode && firmId ? COLLECTIONS.CLIENTS(firmId) : null,
  );

  const clientDisplayName = (c: Client & { id: string }) => {
    const pi = c.personalInfo;
    return pi
      ? `${pi.firstName ?? ''} ${pi.lastName ?? ''}`.trim() || c.id
      : c.id;
  };

  const handleCreateClient = useCreateClientRedirect();

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setForm(blankForm(initialDate));
      setSelectedClientId('');
    }
  }, [open, initialDate]);

  const handleCreate = async () => {
    if (!form.title.trim()) {
      toast.error('Title is required.');
      return;
    }
    if (!isValid(parseISO(form.date))) {
      toast.error('Please choose a valid date.');
      return;
    }
    setSaving(true);
    try {
      const collectionPath = COLLECTIONS.CALENDAR_EVENTS(firmId);
      const startAt = form.allDay
        ? toTimestamp(form.date, '00:00')
        : toTimestamp(form.date, form.startTime);
      const endAt = form.allDay
        ? toTimestamp(form.date, '23:59')
        : toTimestamp(form.date, form.endTime);

      // Resolve the linked client from the fixed prop (client dashboard) or the
      // picker (firm-wide calendar). A firm-wide event may have no client.
      const resolvedClientId = clientId ?? selectedClientId;
      const selected = clients.find((c) => c.id === selectedClientId);
      const resolvedClientName = clientId
        ? (clientName ?? '')
        : selected
          ? clientDisplayName(selected)
          : '';

      const payload: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'> = {
        firmId,
        ...(resolvedClientId ? { clientId: resolvedClientId } : {}),
        ...(resolvedClientName ? { clientName: resolvedClientName } : {}),
        assignedTo: userProfile?.uid ? [userProfile.uid] : [],
        eventType: form.eventType,
        title: sanitizeInput(form.title.trim()),
        ...(form.location.trim() ? { location: sanitizeInput(form.location.trim()) } : {}),
        isVirtual: form.isVirtual,
        ...(form.isVirtual && form.meetingUrl.trim() ? { meetingUrl: sanitizeInput(form.meetingUrl.trim()) } : {}),
        startAt,
        endAt,
        allDay: form.allDay,
        isCompleted: false,
        ...(form.notes.trim() ? { notes: sanitizeInput(form.notes.trim()) } : {}),
        googleCalendarEventId: null,
        createdBy: userProfile?.uid ?? '',
        updatedBy: userProfile?.uid ?? '',
      };

      const eventId = await createDoc(collectionPath, payload);

      await logSystemActivity(firmId, userProfile, 'scheduling appointment', {
        clientId: resolvedClientId || undefined,
        clientName: resolvedClientName || undefined,
        appointmentTitle: form.title.trim()
      });

      // Attempt to immediately push the new event to Google Calendar
      try {
        await documentService.pushEventToGoogleCalendar({ firmId, eventId });
      } catch (gcalErr) {
        console.error('[CalendarTab] Google Calendar sync failed:', gcalErr);
      }

      toast.success('Appointment scheduled.');
      onCreated();
      onClose();
    } catch (err) {
      console.error('[CalendarTab] create error:', err);
      toast.error('Failed to create event.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[#1a365d]">
            Schedule New Appointment
          </DialogTitle>
        </DialogHeader>
        {!selectorMode && (
          <p className="text-sm text-gray-500 -mt-1">
            For <span className="font-medium text-gray-700">{clientName}</span>
          </p>
        )}
        {selectorMode && (
          <div className="space-y-1.5">
            <Label htmlFor="evt-client">Client</Label>
            <Combobox
              id="evt-client"
              placeholder="Link a client (optional)…"
              emptyText="No matching client."
              value={selectedClientId}
              onChange={setSelectedClientId}
              options={clients.map((c) => ({ value: c.id, label: clientDisplayName(c) }))}
              onCreate={handleCreateClient}
              createLabel={(name) => `Create client "${name}"`}
            />
          </div>
        )}
        <EventForm
          form={form}
          onChange={(u) => setForm((f) => ({ ...f, ...u }))}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-[#1a365d] hover:bg-[#1e407a] text-white"
            onClick={handleCreate}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Schedule Appointment'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading skeleton
// ─────────────────────────────────────────────────────────────────────────────

function CalendarSkeleton() {
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-6 w-36 rounded" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-16 rounded-md" />
          <Skeleton className="h-8 w-16 rounded-md" />
          <Skeleton className="h-8 w-16 rounded-md" />
        </div>
      </div>
      {/* Grid */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <div className="grid grid-cols-7 border-b border-gray-200">
          {DAY_HEADERS.map((d) => (
            <div key={d} className="py-2 text-center">
              <Skeleton className="mx-auto h-3 w-6 rounded" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="min-h-[80px] border-b border-r border-gray-100 p-1.5 space-y-1">
              <Skeleton className="h-5 w-5 rounded-full" />
              {i % 5 === 0 && <Skeleton className="h-4 w-full rounded" />}
              {i % 8 === 0 && <Skeleton className="h-4 w-3/4 rounded" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main CalendarTab
// ─────────────────────────────────────────────────────────────────────────────

export default function CalendarTab({
  firmId,
  clientId,
  clientName,
  autoOpenNewEvent = false,
}: CalendarTabProps) {
  const { userProfile } = useAuth();
  const [currentDate, setCurrentDate] = useState(startOfDay(new Date()));
  const [view, setView] = useState<CalendarView>('month');
  const [newEventOpen, setNewEventOpen] = useState(false);
  const [newEventDate, setNewEventDate] = useState<Date>(new Date());
  const [selectedEvent, setSelectedEvent] = useState<
    (CalendarEvent & { id: string }) | null
  >(null);

  // Auto-open on first render if requested by parent
  const autoOpenFired = useRef(false);
  useEffect(() => {
    if (autoOpenNewEvent && !autoOpenFired.current) {
      autoOpenFired.current = true;
      setNewEventDate(currentDate);
      setNewEventOpen(true);
    }
  }, [autoOpenNewEvent, currentDate]);

  // Firestore query: this client's events ordered by startAt, or all events if no clientId
  const collectionPath = firmId ? COLLECTIONS.CALENDAR_EVENTS(firmId) : null;
  const constraints = useMemo(
    () => {
      const base: QueryConstraint[] = [orderBy('startAt', 'asc')];
      if (clientId) {
        // Events are written with `clientId` (see NewEventDialog); the prior
        // `relatedClientId` filter matched no events, so per-client views were
        // always empty. The clientId+startAt composite index already exists.
        base.unshift(where('clientId', '==', clientId));
      }
      return base;
    },
    [clientId],
  );

  const {
    data: events,
    loading,
    error,
  } = useCollection<CalendarEvent>(collectionPath, constraints);

  // Whether any event has a Google Calendar sync
  const hasGCalSync = events.some((e) => e.googleCalendarEventId);

  // Navigation handlers
  const handlePrev = () => {
    if (view === 'month') setCurrentDate((d) => subMonths(d, 1));
    else if (view === 'week') setCurrentDate((d) => subWeeks(d, 1));
    else setCurrentDate((d) => new Date(d.getTime() - 86_400_000));
  };

  const handleNext = () => {
    if (view === 'month') setCurrentDate((d) => addMonths(d, 1));
    else if (view === 'week') setCurrentDate((d) => addWeeks(d, 1));
    else setCurrentDate((d) => new Date(d.getTime() + 86_400_000));
  };

  const handleToday = () => setCurrentDate(startOfDay(new Date()));

  const handleDayClick = (day: Date) => {
    setCurrentDate(day);
    setView('day');
  };

  const handleEventClick = (evt: CalendarEvent & { id: string }) => {
    setSelectedEvent(evt);
  };

  const handleOpenNewEvent = () => {
    setNewEventDate(currentDate);
    setNewEventOpen(true);
  };

  // Nav label
  let navLabel = '';
  if (view === 'month') {
    navLabel = format(currentDate, 'MMMM yyyy');
  } else if (view === 'week') {
    const ws = startOfWeek(currentDate, { weekStartsOn: 0 });
    const we = endOfWeek(currentDate, { weekStartsOn: 0 });
    navLabel =
      isSameMonth(ws, we)
        ? `${format(ws, 'MMM d')} – ${format(we, 'd, yyyy')}`
        : `${format(ws, 'MMM d')} – ${format(we, 'MMM d, yyyy')}`;
  } else {
    navLabel = format(currentDate, 'EEEE, MMMM d, yyyy');
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return <CalendarSkeleton />;

  if (error) {
    return (
      <Alert className="border-red-200 bg-red-50">
        <AlertDescription className="text-red-700 text-sm">
          Failed to load calendar events: {error.message}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* Google Calendar sync banner — shown when no events are synced */}
      {!hasGCalSync && events.length > 0 && (
        <Alert className="border-blue-200 bg-[#ebf4ff]">
          <AlertDescription className="flex items-center justify-between gap-4 text-sm text-[#2b6cb0]">
            <span>
              <span className="font-semibold">Google Calendar sync available</span> —
              configure integration in Settings to keep your calendar in sync.
            </span>
          </AlertDescription>
        </Alert>
      )}

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: nav */}
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 border-gray-200"
            onClick={handlePrev}
            aria-label="Previous"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <span className="min-w-[180px] text-center text-sm font-semibold text-[#1a365d]">
            {navLabel}
          </span>

          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 border-gray-200"
            onClick={handleNext}
            aria-label="Next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="ml-1 h-8 border-gray-200 text-xs"
            onClick={handleToday}
          >
            Today
          </Button>
        </div>

        {/* Right: view toggle + new event */}
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-md border border-gray-200 overflow-hidden">
            {(
              [
                { key: 'month', label: 'Mo' },
                { key: 'week', label: 'Wk' },
                { key: 'day', label: 'Day' },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors',
                  view === key
                    ? 'bg-[#1a365d] text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50',
                  'border-r border-gray-200 last:border-r-0',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {userProfile?.role !== 'client' && (
            <Button
              size="sm"
              className="gap-1.5 bg-[#1a365d] hover:bg-[#1e407a] text-white h-8"
              onClick={handleOpenNewEvent}
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              New Appointment
            </Button>
          )}
        </div>
      </div>

      {/* ── Empty state ────────────────────────────────────────────────────── */}
      {events.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50/40 py-16 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#ebf4ff]">
            <CalendarDays className="h-7 w-7 text-[#2b6cb0]" />
          </div>
          <h3 className="text-sm font-semibold text-[#1a365d]">No appointments scheduled</h3>
          <p className="mt-1 max-w-xs text-sm text-gray-400">
            Click &ldquo;New Appointment&rdquo; to schedule a consultation, signing, or follow-up{clientName ? ` for ${clientName}` : ''}.
          </p>
          {userProfile?.role !== 'client' && (
            <Button
              size="sm"
              className="mt-5 gap-1.5 bg-[#1a365d] hover:bg-[#1e407a] text-white"
              onClick={handleOpenNewEvent}
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              New Appointment
            </Button>
          )}
        </div>
      )}

      {/* ── Calendar views ─────────────────────────────────────────────────── */}
      {events.length > 0 && (
        <>
          {view === 'month' && (
            <MonthView
              currentDate={currentDate}
              events={events}
              onDayClick={handleDayClick}
              onEventClick={handleEventClick}
            />
          )}
          {view === 'week' && (
            <WeekView
              currentDate={currentDate}
              events={events}
              onEventClick={handleEventClick}
            />
          )}
          {view === 'day' && (
            <DayView
              currentDate={currentDate}
              events={events}
              onEventClick={handleEventClick}
            />
          )}
        </>
      )}

      {/* ── Legend ─────────────────────────────────────────────────────────── */}
      {events.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            Types:
          </span>
          {EVENT_TYPES.map((t) => {
            const cfg = EVENT_TYPE_CONFIG[t];
            return (
              <span key={t} className="flex items-center gap-1.5 text-xs text-gray-500">
                <span className={cn('h-2 w-2 rounded-full', cfg.dot)} />
                {cfg.label}
              </span>
            );
          })}
        </div>
      )}

      {/* ── New Event Dialog ───────────────────────────────────────────────── */}
      {userProfile?.role !== 'client' && (
        <NewEventDialog
          open={newEventOpen}
          onClose={() => setNewEventOpen(false)}
          onCreated={() => {/* real-time listener auto-updates */ }}
          firmId={firmId}
          clientId={clientId}
          clientName={clientName}
          initialDate={newEventDate}
        />
      )}

      {/* ── Event Detail / Edit Dialog ─────────────────────────────────────── */}
      <EventDetailDialog
        event={selectedEvent}
        open={selectedEvent !== null}
        onClose={() => setSelectedEvent(null)}
        onDeleted={() => {/* real-time listener auto-updates */ }}
        onUpdated={() => {/* real-time listener auto-updates */ }}
        firmId={firmId}
      />
    </div>
  );
}
