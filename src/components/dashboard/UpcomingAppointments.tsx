import { Calendar as CalendarIcon, MapPin, Video, Clock } from 'lucide-react';
import { where, orderBy, limit, Timestamp } from 'firebase/firestore';
import { COLLECTIONS } from '@/config/constants';
import { useCollection } from '@/hooks/useFirestore';
import { useAuth } from '@/hooks/useAuth';
import type { CalendarEvent } from '@/types';
import { cn } from '@/lib/utils';

export interface UpcomingAppointmentsProps {
    activeClientIds?: string[];
}

export function UpcomingAppointments({ activeClientIds }: UpcomingAppointmentsProps = {}) {
    const { userProfile } = useAuth();
    const firmId = userProfile?.firmId;

    // Query events that haven't happened yet, ordered by start time
    const { data: upcomingEvents, loading } = useCollection<CalendarEvent>(
        firmId ? COLLECTIONS.CALENDAR_EVENTS(firmId) : null,
        [
            where('startAt', '>=', Timestamp.now()),
            orderBy('startAt', 'asc'),
            limit(5)
        ]
    );

    const formatEventTime = (timestamp: Timestamp, allDay: boolean) => {
        const date = timestamp.toDate();
        if (allDay) {
            return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        }
        return date.toLocaleString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
    };

    const getEventBadgeColor = (type: string) => {
        switch (type) {
            case 'consultation': return 'bg-blue-100 text-blue-800';
            case 'signing': return 'bg-emerald-100 text-emerald-800';
            case 'follow_up': return 'bg-amber-100 text-amber-800';
            case 'deadline': return 'bg-red-100 text-red-800';
            default: return 'bg-purple-100 text-purple-800';
        }
    };

    return (
        <div className="flex h-full flex-col rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 bg-[#1a365d]/[0.03] px-6 py-4">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900">Upcoming Appointments</h2>
                    <p className="text-sm text-gray-500">Synced from Google Calendar</p>
                </div>
                <div className="rounded-lg bg-[#ebf4ff] p-2.5">
                    <CalendarIcon className="h-5 w-5 text-[#1a365d]" />
                </div>
            </div>

            {/* List Area */}
            <div className="flex-1 overflow-y-auto p-2">
                {loading ? (
                    <div className="p-4 space-y-4">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="flex gap-4 p-3 rounded-xl border border-gray-100">
                                <div className="h-12 w-12 animate-pulse rounded-lg bg-gray-100 shrink-0" />
                                <div className="space-y-2 flex-1 pt-1">
                                    <div className="h-4 w-3/4 animate-pulse rounded bg-gray-100" />
                                    <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : upcomingEvents?.length === 0 ? (
                    <div className="flex h-48 flex-col items-center justify-center text-center px-4">
                        <div className="rounded-full bg-gray-50 p-4 mb-3 border border-gray-100">
                            <CalendarIcon className="h-6 w-6 text-gray-400" />
                        </div>
                        <p className="text-sm font-medium text-gray-900">No upcoming appointments</p>
                        <p className="text-sm text-gray-500 mt-1 max-w-[200px]">Your schedule is clear. Check Google Calendar to ensure sync is active.</p>
                    </div>
                ) : (
                    <div className="space-y-3 p-3">
                        {upcomingEvents?.filter(event =>
                            !activeClientIds || !event.clientId || activeClientIds.includes(event.clientId)
                        ).map(event => (
                            <div
                                key={event.id}
                                className="group flex gap-4 rounded-xl border border-gray-100 bg-white p-4 transition-all hover:border-blue-100 hover:shadow-md hover:shadow-blue-50/50"
                            >
                                {/* Left: Date block */}
                                <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-lg bg-[#1a365d]/5 py-2">
                                    <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                        {event.startAt.toDate().toLocaleDateString('en-US', { month: 'short' })}
                                    </span>
                                    <span className="text-xl font-bold text-[#1a365d]">
                                        {event.startAt.toDate().getDate()}
                                    </span>
                                </div>

                                {/* Right: Details */}
                                <div className="flex flex-1 flex-col justify-center min-w-0">
                                    <div className="flex items-start justify-between gap-2">
                                        <p className="truncate font-semibold text-gray-900">
                                            {event.title}
                                        </p>
                                        <span className={cn(
                                            "shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                            getEventBadgeColor(event.eventType)
                                        )}>
                                            {event.eventType.replace('_', ' ')}
                                        </span>
                                    </div>

                                    <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-500">
                                        <Clock className="h-3.5 w-3.5" />
                                        {formatEventTime(event.startAt, event.allDay)}
                                    </p>

                                    {event.clientName && (
                                        <p className="mt-1 truncate text-sm text-gray-600">
                                            <span className="font-medium">Client:</span> {event.clientName}
                                        </p>
                                    )}

                                    {(event.location || event.isVirtual) && (
                                        <div className="mt-2 flex items-center gap-1.5 pt-2 border-t border-gray-50 text-xs text-gray-500 truncate">
                                            {event.isVirtual ? (
                                                <>
                                                    <Video className="h-3.5 w-3.5 text-blue-500" />
                                                    {event.meetingUrl ? (
                                                        <a href={event.meetingUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                                                            Video Meeting Link
                                                        </a>
                                                    ) : 'Virtual Meeting'}
                                                </>
                                            ) : (
                                                <>
                                                    <MapPin className="h-3.5 w-3.5 text-gray-400" />
                                                    <span className="truncate">{event.location}</span>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
