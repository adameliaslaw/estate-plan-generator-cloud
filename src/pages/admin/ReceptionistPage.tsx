/**
 * ReceptionistPage.tsx
 *
 * Intake dashboard for "Carmela" — the AI receptionist.
 * Shows incoming call intakes in real time, sorted newest first.
 *
 * Data: firms/{firmId}/intakes (real-time Firestore subscription)
 */

import { useState, useEffect } from 'react';
import {
  Phone,
  PhoneIncoming,
  Clock,
  AlertTriangle,
  User,
  Mail,
  ChevronDown,
  ChevronUp,
  Copy,
  CheckCircle,
} from 'lucide-react';
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
  type Timestamp,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IntakeData {
  name?: string;
  phone?: string;
  email?: string;
  legalMatter?: string;
  description?: string;
  urgency?: 'normal' | 'high' | 'urgent';
  existingClient?: boolean;
}

interface IntakeRecord {
  id: string;
  callSid: string;
  callerPhone: string;
  firmId: string;
  intake: IntakeData;
  urgency: 'normal' | 'high' | 'urgent';
  status: 'new' | 'contacted' | 'converted';
  turnCount: number;
  createdAt: Timestamp | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const URGENCY_CONFIG = {
  urgent: {
    label: 'Urgent',
    classes: 'bg-red-100 text-red-800 border border-red-200',
    dot: 'bg-red-500',
  },
  high: {
    label: 'High',
    classes: 'bg-amber-100 text-amber-800 border border-amber-200',
    dot: 'bg-amber-500',
  },
  normal: {
    label: 'Normal',
    classes: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
    dot: 'bg-emerald-500',
  },
} as const;

const STATUS_CONFIG = {
  new: { label: 'New', classes: 'bg-blue-100 text-blue-800 border border-blue-200' },
  contacted: { label: 'Contacted', classes: 'bg-purple-100 text-purple-800 border border-purple-200' },
  converted: { label: 'Converted', classes: 'bg-emerald-100 text-emerald-800 border border-emerald-200' },
} as const;

function formatTime(ts: Timestamp | null): string {
  if (!ts) return '—';
  const d = ts.toDate();
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    const d = digits.slice(1);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error('Copy failed');
  }
}

// ---------------------------------------------------------------------------
// IntakeCard
// ---------------------------------------------------------------------------

function IntakeCard({
  intake,
  firmId,
}: {
  intake: IntakeRecord;
  firmId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [updating, setUpdating] = useState(false);

  const urgencyCfg = URGENCY_CONFIG[intake.urgency ?? 'normal'];
  const statusCfg = STATUS_CONFIG[intake.status ?? 'new'];
  const displayName = intake.intake.name ?? formatPhone(intake.callerPhone);
  const phone = intake.intake.phone ?? intake.callerPhone;

  async function updateStatus(newStatus: IntakeRecord['status']) {
    setUpdating(true);
    try {
      const ref = doc(db, 'firms', firmId, 'intakes', intake.id);
      await updateDoc(ref, {
        status: newStatus,
        updatedAt: serverTimestamp(),
      });
      toast.success(`Marked as ${STATUS_CONFIG[newStatus].label.toLowerCase()}`);
    } catch {
      toast.error('Failed to update status');
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div
      className={cn(
        'bg-white rounded-xl border shadow-sm transition-all',
        intake.urgency === 'urgent' && 'border-red-300 shadow-red-100',
        intake.urgency === 'high' && 'border-amber-200',
        intake.urgency === 'normal' && 'border-gray-200',
      )}
    >
      {/* Card header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          {/* Left — identity + metadata */}
          <div className="flex items-start gap-3 min-w-0">
            <div className="shrink-0 w-10 h-10 rounded-full bg-[#1a365d]/10 flex items-center justify-center">
              <User className="w-5 h-5 text-[#1a365d]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-gray-900 truncate">{displayName}</span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full',
                    urgencyCfg.classes,
                  )}
                >
                  <span className={cn('w-1.5 h-1.5 rounded-full', urgencyCfg.dot)} />
                  {urgencyCfg.label}
                </span>
                <span
                  className={cn(
                    'inline-flex text-xs font-medium px-2 py-0.5 rounded-full',
                    statusCfg.classes,
                  )}
                >
                  {statusCfg.label}
                </span>
              </div>
              {intake.intake.legalMatter && (
                <p className="text-sm text-gray-600 mt-0.5 truncate">
                  {intake.intake.legalMatter}
                </p>
              )}
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                {phone && (
                  <button
                    onClick={() => copyToClipboard(phone, 'Phone')}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors group"
                  >
                    <Phone className="w-3 h-3" />
                    <span>{formatPhone(phone)}</span>
                    <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                )}
                {intake.intake.email && (
                  <button
                    onClick={() => copyToClipboard(intake.intake.email!, 'Email')}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors group"
                  >
                    <Mail className="w-3 h-3" />
                    <span className="truncate max-w-[180px]">{intake.intake.email}</span>
                    <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right — time + expand */}
          <div className="flex flex-col items-end gap-2 shrink-0">
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <Clock className="w-3 h-3" />
              {formatTime(intake.createdAt)}
            </span>
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors"
            >
              {expanded ? (
                <>Less <ChevronUp className="w-3.5 h-3.5" /></>
              ) : (
                <>More <ChevronDown className="w-3.5 h-3.5" /></>
              )}
            </button>
          </div>
        </div>

        {/* Description preview */}
        {intake.intake.description && !expanded && (
          <p className="mt-2 text-sm text-gray-600 line-clamp-2 ml-13">
            {intake.intake.description}
          </p>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3 bg-gray-50 rounded-b-xl">
          {intake.intake.description && (
            <div>
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Situation</span>
              <p className="mt-0.5 text-sm text-gray-700">{intake.intake.description}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 text-sm">
            {intake.intake.existingClient !== undefined && (
              <div>
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Client type</span>
                <p className="mt-0.5 text-gray-700">
                  {intake.intake.existingClient ? 'Existing client' : 'New prospect'}
                </p>
              </div>
            )}
            <div>
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Call turns</span>
              <p className="mt-0.5 text-gray-700">{intake.turnCount} exchanges</p>
            </div>
            <div>
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Called from</span>
              <p className="mt-0.5 text-gray-700">{formatPhone(intake.callerPhone)}</p>
            </div>
          </div>

          {/* Status actions */}
          <div className="flex items-center gap-2 pt-1">
            {intake.status !== 'contacted' && (
              <button
                disabled={updating}
                onClick={() => updateStatus('contacted')}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Mark Contacted
              </button>
            )}
            {intake.status !== 'converted' && (
              <button
                disabled={updating}
                onClick={() => updateStatus('converted')}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Mark Converted
              </button>
            )}
            {intake.status !== 'new' && (
              <button
                disabled={updating}
                onClick={() => updateStatus('new')}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                Reset to New
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReceptionistPage
// ---------------------------------------------------------------------------

export default function ReceptionistPage() {
  const { userProfile } = useAuth();
  const [intakes, setIntakes] = useState<IntakeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'new' | 'urgent'>('all');

  const firmId = userProfile?.firmId ?? '';

  useEffect(() => {
    if (!firmId) return;

    const q = query(
      collection(db, 'firms', firmId, 'intakes'),
      orderBy('createdAt', 'desc'),
      limit(50),
    );

    const unsub = onSnapshot(
      q,
      snap => {
        const records: IntakeRecord[] = snap.docs.map(d => ({
          id: d.id,
          ...(d.data() as Omit<IntakeRecord, 'id'>),
        }));
        setIntakes(records);
        setLoading(false);
      },
      err => {
        console.error('Intakes subscription error:', err);
        setLoading(false);
      },
    );

    return unsub;
  }, [firmId]);

  const filtered = intakes.filter(i => {
    if (filter === 'new') return i.status === 'new';
    if (filter === 'urgent') return i.urgency === 'urgent' || i.urgency === 'high';
    return true;
  });

  const newCount = intakes.filter(i => i.status === 'new').length;
  const urgentCount = intakes.filter(i => i.urgency === 'urgent').length;

  if (!firmId) return null;

  return (
    <div className="max-w-3xl mx-auto space-y-6 py-2">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#1a365d] flex items-center justify-center">
              <PhoneIncoming className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">AI Receptionist</h1>
              <p className="text-sm text-gray-500">Carmela — intake &amp; screening calls</p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3">
          {urgentCount > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <span className="text-sm font-semibold text-red-700">{urgentCount} urgent</span>
            </div>
          )}
          {newCount > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200">
              <Phone className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-semibold text-blue-700">{newCount} new</span>
            </div>
          )}
        </div>
      </div>

      {/* Setup instructions (shown only when no intakes yet) */}
      {!loading && intakes.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto">
            <PhoneIncoming className="w-6 h-6 text-gray-400" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-700">No intakes yet</h3>
            <p className="text-sm text-gray-500 mt-1">
              Configure your Twilio phone number to send calls to Carmela.
            </p>
          </div>
          <div className="text-left bg-white rounded-lg border border-gray-200 p-4 text-xs font-mono text-gray-600 space-y-1 max-w-lg mx-auto">
            <p className="text-gray-400 font-sans font-medium mb-2">Twilio setup (Voice → Phone Number)</p>
            <p><span className="text-gray-400">Webhook URL:</span></p>
            <p className="break-all text-[#1a365d]">
              https://us-east1-estate-plan-generator.cloudfunctions.net/receptionistWebhook?firmId={firmId}
            </p>
            <p className="mt-2"><span className="text-gray-400">Status callback URL:</span></p>
            <p className="break-all text-[#1a365d]">
              https://us-east1-estate-plan-generator.cloudfunctions.net/receptionistStatus
            </p>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      {intakes.length > 0 && (
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {(['all', 'new', 'urgent'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-3 py-1.5 rounded-md text-sm font-medium capitalize transition-all',
                filter === f
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700',
              )}
            >
              {f}
              {f === 'new' && newCount > 0 && (
                <span className="ml-1.5 text-xs font-semibold text-blue-600">{newCount}</span>
              )}
              {f === 'urgent' && urgentCount > 0 && (
                <span className="ml-1.5 text-xs font-semibold text-red-600">{urgentCount}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(n => (
            <div key={n} className="h-24 rounded-xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      )}

      {/* Intake list */}
      {!loading && (
        <div className="space-y-3">
          {filtered.length === 0 && intakes.length > 0 && (
            <p className="text-sm text-gray-500 text-center py-8">
              No intakes match this filter.
            </p>
          )}
          {filtered.map(intake => (
            <IntakeCard key={intake.id} intake={intake} firmId={firmId} />
          ))}
        </div>
      )}
    </div>
  );
}
