/**
 * ClientPortalPage.tsx
 *
 * Self-service client dashboard (route: /portal/:firmId/:clientId).
 * Read-only tabbed interface showing the client's case overview,
 * documents, upcoming appointments, and payment history.
 */

import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { orderBy, where, Timestamp, type QueryConstraint } from 'firebase/firestore';
import {
  FileText,
  Calendar,
  CreditCard,
  LayoutDashboard,
  Download,
  Clock,
  CheckCircle2,
  AlertCircle,
  MapPin,
  Video,
  User,
  Scale,
  Phone,
  Mail,
} from 'lucide-react';
import { useDocument, useCollection } from '@/hooks/useFirestore';
import { COLLECTIONS, FIRM_DEFAULTS } from '@/config/constants';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import type {
  Client,
  Document,
  Payment,
  CalendarEvent,
} from '@/types';

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'appointments', label: 'Appointments', icon: Calendar },
  { id: 'payments', label: 'Payments', icon: CreditCard },
] as const;

type TabId = (typeof TABS)[number]['id'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(ts: Timestamp | string | Date | null | undefined): string {
  if (!ts) return '—';
  const d = ts instanceof Timestamp ? ts.toDate() : new Date(ts as string | number);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTime(ts: Timestamp | string | Date | null | undefined): string {
  if (!ts) return '—';
  const d = ts instanceof Timestamp ? ts.toDate() : new Date(ts as string | number);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

const DOC_STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  draft: { label: 'Draft', color: 'bg-gray-100 text-gray-700', icon: Clock },
  review: { label: 'In Review', color: 'bg-amber-100 text-amber-800', icon: AlertCircle },
  final: { label: 'Final', color: 'bg-emerald-100 text-emerald-800', icon: CheckCircle2 },
};

const PAYMENT_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-amber-100 text-amber-800' },
  paid: { label: 'Paid', color: 'bg-emerald-100 text-emerald-800' },
  partial: { label: 'Partial', color: 'bg-blue-100 text-blue-800' },
  overdue: { label: 'Overdue', color: 'bg-red-100 text-red-800' },
  refunded: { label: 'Refunded', color: 'bg-gray-100 text-gray-700' },
  voided: { label: 'Voided', color: 'bg-gray-100 text-gray-700' },
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ClientPortalPage() {
  const { firmId, clientId } = useParams<{ firmId: string; clientId: string }>();
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  // ── Fetch client data ──
  const clientPath = firmId && clientId ? `firms/${firmId}/clients/${clientId}` : null;
  const { data: client, loading: clientLoading } = useDocument<Client>(clientPath);

  // ── Fetch documents ──
  const docsPath = firmId && clientId ? COLLECTIONS.DOCUMENTS(firmId, clientId) : null;
  const docConstraints = useMemo<QueryConstraint[]>(() => [orderBy('createdAt', 'desc')], []);
  const { data: documents, loading: docsLoading } = useCollection<Document>(docsPath, docConstraints);

  // ── Fetch payments ──
  const paymentsPath = firmId && clientId ? COLLECTIONS.PAYMENTS(firmId, clientId) : null;
  const payConstraints = useMemo<QueryConstraint[]>(() => [orderBy('createdAt', 'desc')], []);
  const { data: payments, loading: paymentsLoading } = useCollection<Payment>(paymentsPath, payConstraints);

  // ── Fetch upcoming appointments ──
  const eventsPath = firmId ? COLLECTIONS.CALENDAR_EVENTS(firmId) : null;
  const eventConstraints = useMemo<QueryConstraint[]>(
    () =>
      clientId
        ? [where('clientId', '==', clientId), orderBy('startAt', 'asc')]
        : [],
    [clientId],
  );
  const { data: events, loading: eventsLoading } = useCollection<CalendarEvent>(
    eventsPath,
    eventConstraints,
  );

  // ── Loading state ──
  if (clientLoading) {
    return <LoadingSpinner fullScreen />;
  }

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500">
        <AlertCircle className="h-12 w-12 mb-4 text-gray-300" />
        <p className="text-lg font-medium">Client record not found</p>
        <p className="text-sm mt-1">Please check the link you were provided.</p>
      </div>
    );
  }

  const clientName = `${client.personalInfo?.firstName ?? ''} ${client.personalInfo?.lastName ?? ''}`.trim() || 'Client';

  // ── Questionnaire progress ──
  const qProgress = client.questionnaireProgress;
  const qPercent = qProgress?.percentComplete ?? 0;
  const qStatus = qProgress?.status ?? 'not_started';

  // Split upcoming vs past events
  const now = new Date();
  const upcomingEvents = events.filter((e) => {
    const start = e.startAt instanceof Timestamp ? e.startAt.toDate() : new Date(e.startAt as unknown as string | number);
    return start >= now;
  });

  return (
    <div className="space-y-6">
      {/* ── Welcome header ── */}
      <div className="rounded-xl bg-gradient-to-r from-[#1a365d] to-[#2b6cb0] p-6 text-white shadow-lg">
        <h1 className="text-2xl font-bold">Welcome, {client.personalInfo?.firstName ?? 'Client'}</h1>
        <p className="mt-1 text-blue-100 text-sm">
          Your estate planning portal with {FIRM_DEFAULTS.firmName}
        </p>
      </div>

      {/* ── Tab navigation ── */}
      <div className="flex gap-1 overflow-x-auto rounded-lg bg-gray-100 p-1" role="tablist">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-md px-4 py-2.5 text-sm font-medium transition-all ${
                isActive
                  ? 'bg-white text-[#1a365d] shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-white/50'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Tab content ── */}
      <div className="min-h-[400px]">
        {activeTab === 'overview' && (
          <OverviewTab
            client={client}
            clientName={clientName}
            qPercent={qPercent}
            qStatus={qStatus}
            documentCount={documents.length}
            upcomingEventCount={upcomingEvents.length}
            totalPaid={payments.filter((p) => p.status === 'paid').reduce((sum, p) => sum + p.amount, 0)}
            totalDue={payments.filter((p) => p.status !== 'paid' && p.status !== 'voided' && p.status !== 'refunded').reduce((sum, p) => sum + p.balanceDue, 0)}
          />
        )}
        {activeTab === 'documents' && (
          <DocumentsTab documents={documents} loading={docsLoading} />
        )}
        {activeTab === 'appointments' && (
          <AppointmentsTab events={upcomingEvents} loading={eventsLoading} />
        )}
        {activeTab === 'payments' && (
          <PaymentsTab payments={payments} loading={paymentsLoading} />
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Overview Tab
// ===========================================================================

interface OverviewTabProps {
  client: Client & { id: string };
  clientName: string;
  qPercent: number;
  qStatus: string;
  documentCount: number;
  upcomingEventCount: number;
  totalPaid: number;
  totalDue: number;
}

function OverviewTab({
  client,
  clientName,
  qPercent,
  qStatus,
  documentCount,
  upcomingEventCount,
  totalPaid,
  totalDue,
}: OverviewTabProps) {
  const pkg = client.packageDetails?.packageType ?? 'foundation';
  const packageLabel =
    pkg === 'fortress' ? 'Irrevocable Trust Package' : pkg === 'guardian' ? 'Revocable Trust Package' : 'Basic Estate Plan Package';

  return (
    <div className="space-y-6">
      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard icon={FileText} label="Documents" value={String(documentCount)} color="blue" />
        <StatCard icon={Calendar} label="Upcoming" value={String(upcomingEventCount)} color="purple" />
        <StatCard icon={CreditCard} label="Total Paid" value={formatCurrency(totalPaid)} color="emerald" />
        <StatCard
          icon={AlertCircle}
          label="Balance Due"
          value={formatCurrency(totalDue)}
          color={totalDue > 0 ? 'amber' : 'emerald'}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Questionnaire progress */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
            Questionnaire Progress
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">
                Status:{' '}
                <span className="font-medium text-gray-900 capitalize">
                  {qStatus.replace(/_/g, ' ')}
                </span>
              </span>
              <span className="font-semibold text-[#1a365d]">{qPercent}%</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#2b6cb0] to-[#1a365d] transition-all duration-500"
                style={{ width: `${qPercent}%` }}
              />
            </div>
            {qStatus === 'completed' && (
              <p className="text-xs text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Questionnaire completed — thank you!
              </p>
            )}
          </div>
        </div>

        {/* Case info */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-4">
            Your Estate Plan
          </h3>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1a365d]/10">
                <Scale className="h-5 w-5 text-[#1a365d]" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{packageLabel}</p>
                <p className="text-xs text-gray-500">
                  {(client.packageDetails?.documentsIncluded?.length ?? 0)} documents included
                </p>
              </div>
            </div>
            <div className="border-t border-gray-100 pt-3 space-y-2">
              <InfoRow icon={User} label="Client" value={clientName} />
              {client.personalInfo?.email && (
                <InfoRow icon={Mail} label="Email" value={client.personalInfo.email} />
              )}
              {client.personalInfo?.phone && (
                <InfoRow icon={Phone} label="Phone" value={client.personalInfo.phone} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Firm contact */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
          Your Attorney
        </h3>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#1a365d]">
            <Scale className="h-6 w-6 text-white" />
          </div>
          <div className="space-y-0.5">
            <p className="font-medium text-gray-900">{FIRM_DEFAULTS.firmName}</p>
            <p className="text-sm text-gray-500">{FIRM_DEFAULTS.firmAddress}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
              <span className="flex items-center gap-1">
                <Phone className="h-3.5 w-3.5" />
                {FIRM_DEFAULTS.firmPhone}
              </span>
              <span className="flex items-center gap-1">
                <Mail className="h-3.5 w-3.5" />
                {FIRM_DEFAULTS.firmEmail}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Documents Tab
// ===========================================================================

interface DocumentsTabProps {
  documents: (Document & { id: string })[];
  loading: boolean;
}

function DocumentsTab({ documents, loading }: DocumentsTabProps) {
  if (loading) return <LoadingSpinner />;
  if (documents.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No documents yet"
        description="Your estate planning documents will appear here once they are prepared."
      />
    );
  }

  return (
    <div className="space-y-3">
      {documents.map((doc) => {
        const cfg = DOC_STATUS_CONFIG[doc.status] ?? DOC_STATUS_CONFIG.draft;
        const StatusIcon = cfg.icon;
        return (
          <div
            key={doc.id}
            className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-4 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50">
                <FileText className="h-5 w-5 text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-gray-900 truncate">{doc.displayName}</p>
                <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                  <span>{formatDate(doc.updatedAt)}</span>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
                    <StatusIcon className="h-3 w-3" />
                    {cfg.label}
                  </span>
                </div>
              </div>
            </div>
            {doc.downloadUrl && doc.status === 'final' && (
              <a
                href={doc.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg bg-[#1a365d] px-3 py-2 text-xs font-medium text-white hover:bg-[#1a365d]/90 transition-colors shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ===========================================================================
// Appointments Tab
// ===========================================================================

interface AppointmentsTabProps {
  events: (CalendarEvent & { id: string })[];
  loading: boolean;
}

function AppointmentsTab({ events, loading }: AppointmentsTabProps) {
  if (loading) return <LoadingSpinner />;
  if (events.length === 0) {
    return (
      <EmptyState
        icon={Calendar}
        title="No upcoming appointments"
        description="Scheduled meetings and deadlines will appear here."
      />
    );
  }

  return (
    <div className="space-y-3">
      {events.map((event) => (
        <div
          key={event.id}
          className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium text-gray-900">{event.title}</p>
              {event.description && (
                <p className="text-sm text-gray-500 mt-1 line-clamp-2">{event.description}</p>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {formatDateTime(event.startAt)}
                  {event.endAt && ` — ${formatDateTime(event.endAt)}`}
                </span>
                {event.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {event.location}
                  </span>
                )}
                {event.isVirtual && event.meetingUrl && (
                  <a
                    href={event.meetingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-blue-600 hover:text-blue-700"
                  >
                    <Video className="h-3.5 w-3.5" />
                    Join Meeting
                  </a>
                )}
              </div>
            </div>
            <div className="shrink-0">
              <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 capitalize">
                {event.eventType?.replace(/_/g, ' ') ?? 'Event'}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ===========================================================================
// Payments Tab
// ===========================================================================

interface PaymentsTabProps {
  payments: (Payment & { id: string })[];
  loading: boolean;
}

function PaymentsTab({ payments, loading }: PaymentsTabProps) {
  if (loading) return <LoadingSpinner />;
  if (payments.length === 0) {
    return (
      <EmptyState
        icon={CreditCard}
        title="No payment records"
        description="Your payment history will appear here."
      />
    );
  }

  const totalPaid = payments.filter((p) => p.status === 'paid').reduce((sum, p) => sum + p.amount, 0);
  const totalDue = payments
    .filter((p) => p.status !== 'paid' && p.status !== 'voided' && p.status !== 'refunded')
    .reduce((sum, p) => sum + p.balanceDue, 0);

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex flex-wrap gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex-1 min-w-[140px]">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Total Paid</p>
          <p className="text-lg font-semibold text-emerald-700">{formatCurrency(totalPaid)}</p>
        </div>
        <div className="flex-1 min-w-[140px]">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Balance Due</p>
          <p className={`text-lg font-semibold ${totalDue > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
            {formatCurrency(totalDue)}
          </p>
        </div>
      </div>

      {/* Payment list */}
      <div className="space-y-3">
        {payments.map((payment) => {
          const cfg = PAYMENT_STATUS_CONFIG[payment.status] ?? PAYMENT_STATUS_CONFIG.pending;
          return (
            <div
              key={payment.id}
              className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="min-w-0">
                <p className="font-medium text-gray-900 truncate">{payment.description}</p>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                  <span>{formatDate(payment.createdAt)}</span>
                  {payment.invoiceNumber && <span>• #{payment.invoiceNumber}</span>}
                  {payment.paymentMethod && <span>• {payment.paymentMethod}</span>}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cfg.color}`}>
                  {cfg.label}
                </span>
                <span className="text-sm font-semibold text-gray-900 tabular-nums">
                  {formatCurrency(payment.amount)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===========================================================================
// Shared sub-components
// ===========================================================================

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof FileText;
  label: string;
  value: string;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    purple: 'bg-purple-50 text-purple-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
  };
  const iconColor = colorMap[color] ?? colorMap.blue;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconColor}`}>
          <Icon className="h-4.5 w-4.5" />
        </div>
        <div>
          <p className="text-xs text-gray-500">{label}</p>
          <p className="text-lg font-semibold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof User;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="h-3.5 w-3.5 text-gray-400 shrink-0" />
      <span className="text-gray-500">{label}:</span>
      <span className="font-medium text-gray-900 truncate">{value}</span>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof FileText;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50/50 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 mb-4">
        <Icon className="h-7 w-7 text-gray-400" />
      </div>
      <p className="text-base font-medium text-gray-700">{title}</p>
      <p className="mt-1 text-sm text-gray-500 max-w-xs">{description}</p>
    </div>
  );
}
