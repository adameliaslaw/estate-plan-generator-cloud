import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  ClipboardList,
  FileEdit,
  DollarSign,
  Search,
  UserPlus,
  ArrowRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  CalendarDays,
} from 'lucide-react';
import { orderBy, limit } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { useCollection } from '@/hooks/useFirestore';
import { COLLECTIONS, ROUTES } from '@/config/constants';
import { cn } from '@/lib/utils';
import type { Client } from '@/types';

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatRelativeTime(ts: { seconds: number; nanoseconds: number } | undefined): string {
  if (!ts) return '';
  const date = new Date(ts.seconds * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHrs = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffMins < 2) return 'Just now';
  if (diffMins < 60) return `${diffMins} minutes ago`;
  if (diffHrs < 24) return `${diffHrs} hour${diffHrs !== 1 ? 's' : ''} ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function clientDisplayName(client: Client): string {
  const { lastName, firstName } = client.personalInfo;
  if (!lastName && !firstName) return 'Unknown Client';
  if (!firstName) return lastName;
  return `${lastName}, ${firstName}`;
}

function formatBalanceDue(balanceDue?: number): string {
  if (balanceDue == null) return '—';
  const dollars = balanceDue / 100;
  return dollars === 0
    ? '$0.00'
    : `$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Stat card ──────────────────────────────────────────────────────────────────

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  subtitle?: string;
  subtitleMuted?: boolean;
  color: 'navy' | 'blue' | 'green' | 'amber';
  loading?: boolean;
}

const colorMap = {
  navy: {
    bg: 'bg-[#ebf4ff]',
    icon: 'text-[#1a365d]',
    value: 'text-[#1a365d]',
  },
  blue: {
    bg: 'bg-blue-50',
    icon: 'text-[#2b6cb0]',
    value: 'text-[#2b6cb0]',
  },
  green: {
    bg: 'bg-emerald-50',
    icon: 'text-emerald-600',
    value: 'text-emerald-700',
  },
  amber: {
    bg: 'bg-amber-50',
    icon: 'text-amber-600',
    value: 'text-amber-700',
  },
} as const;

function StatCard({ title, value, icon: Icon, subtitle, subtitleMuted, color, loading }: StatCardProps) {
  const colors = colorMap[color];
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">{title}</p>
          {loading ? (
            <div className="mt-2 h-8 w-16 animate-pulse rounded-md bg-gray-200" />
          ) : (
            <p className={cn('mt-2 text-3xl font-bold', colors.value)}>{value}</p>
          )}
          {subtitle && (
            <p
              className={cn(
                'mt-1 text-xs font-medium',
                subtitleMuted ? 'text-gray-400 italic' : 'text-gray-500',
              )}
            >
              {subtitle}
            </p>
          )}
        </div>
        <div className={cn('ml-4 rounded-lg p-2.5', colors.bg)}>
          <Icon className={cn('h-5 w-5', colors.icon)} />
        </div>
      </div>
    </div>
  );
}

// ── Skeleton rows ──────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 animate-pulse rounded bg-gray-200" style={{ width: `${40 + i * 10}%` }} />
        </td>
      ))}
    </tr>
  );
}

// ── Badge maps ─────────────────────────────────────────────────────────────────

const qStatusBadge: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-700',
  in_progress: 'bg-amber-100 text-amber-700',
  not_started: 'bg-gray-100 text-gray-500',
};

const qStatusLabel: Record<string, string> = {
  completed: 'Completed',
  in_progress: 'In Progress',
  not_started: 'Not Started',
};

const packageBadge: Record<string, string> = {
  foundation: 'bg-slate-100 text-slate-600',
  guardian: 'bg-[#ebf4ff] text-[#2b6cb0]',
  fortress: 'bg-indigo-50 text-indigo-700',
};

const packageLabel: Record<string, string> = {
  foundation: 'Foundation',
  guardian: 'Guardian',
  fortress: 'Fortress',
};

// ── Activity feed ──────────────────────────────────────────────────────────────

interface ActivityItem {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  iconBg: string;
  description: string;
  time: string;
}

function buildActivityItems(clients: (Client & { id: string })[]): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const client of clients) {
    if (items.length >= 8) break;
    const name = clientDisplayName(client);
    const qStatus = client.questionnaireProgress?.status;
    const createdAt = client.createdAt as { seconds: number; nanoseconds: number } | undefined;
    const updatedAt = client.updatedAt as { seconds: number; nanoseconds: number } | undefined;

    // Completed questionnaire
    if (qStatus === 'completed' && client.questionnaireProgress?.completedAt) {
      const completedAt = client.questionnaireProgress.completedAt as unknown as {
        seconds: number;
        nanoseconds: number;
      };
      items.push({
        id: `q-completed-${client.id}`,
        icon: CheckCircle2,
        iconColor: 'text-emerald-600',
        iconBg: 'bg-emerald-50',
        description: `Questionnaire completed by ${name}`,
        time: formatRelativeTime(completedAt),
      });
      continue;
    }

    // In progress questionnaire
    if (qStatus === 'in_progress') {
      items.push({
        id: `q-progress-${client.id}`,
        icon: ClipboardList,
        iconColor: 'text-amber-600',
        iconBg: 'bg-amber-50',
        description: `Questionnaire in progress for ${name}`,
        time: formatRelativeTime(updatedAt),
      });
      continue;
    }

    // Outstanding balance
    const balance = client.packageDetails?.balanceDue;
    if (balance && balance > 0) {
      const dollars = (balance / 100).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      items.push({
        id: `balance-${client.id}`,
        icon: AlertCircle,
        iconColor: 'text-amber-600',
        iconBg: 'bg-amber-50',
        description: `Outstanding balance of $${dollars} on ${name} matter`,
        time: formatRelativeTime(updatedAt),
      });
      continue;
    }

    // Recently added client (fallback)
    const nowMs = Date.now();
    const createdMs = createdAt ? createdAt.seconds * 1000 : 0;
    const isRecent = nowMs - createdMs < 7 * 24 * 3600 * 1000; // within 7 days
    if (isRecent) {
      items.push({
        id: `new-${client.id}`,
        icon: UserPlus,
        iconColor: 'text-[#1a365d]',
        iconBg: 'bg-[#ebf4ff]',
        description: `New client ${name} added`,
        time: formatRelativeTime(createdAt),
      });
      continue;
    }

    // Generic updated
    items.push({
      id: `updated-${client.id}`,
      icon: FileText,
      iconColor: 'text-[#2b6cb0]',
      iconBg: 'bg-blue-50',
      description: `${name} matter updated`,
      time: formatRelativeTime(updatedAt),
    });
  }

  return items.slice(0, 8);
}

// ── Page component ─────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { userProfile } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  const firmId = userProfile?.firmId ?? '';

  // Real-time collection queries
  const {
    data: recentClients,
    loading: clientsLoading,
  } = useCollection<Client>(
    firmId ? COLLECTIONS.CLIENTS(firmId) : null,
    [orderBy('updatedAt', 'desc'), limit(10)],
  );

  // Use a wider set for activity feed and stat computation
  const { data: allClients, loading: allLoading } = useCollection<Client>(
    firmId ? COLLECTIONS.CLIENTS(firmId) : null,
    [orderBy('updatedAt', 'desc'), limit(20)],
  );

  const loading = clientsLoading || allLoading;

  // ── Computed stats ────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const activeCount = allClients.filter((c) => !c.isArchived).length;
    const pendingQCount = allClients.filter(
      (c) => c.questionnaireProgress?.status === 'in_progress',
    ).length;
    return { activeCount, pendingQCount };
  }, [allClients]);

  // ── Activity items ────────────────────────────────────────────────────────
  const activityItems = useMemo(() => buildActivityItems(allClients), [allClients]);

  // ── Client-side search filter ─────────────────────────────────────────────
  const filteredClients = useMemo(() => {
    if (!searchQuery.trim()) return recentClients;
    const q = searchQuery.toLowerCase();
    return recentClients.filter((c) => {
      const name = clientDisplayName(c).toLowerCase();
      const email = c.personalInfo?.email?.toLowerCase() ?? '';
      return name.includes(q) || email.includes(q);
    });
  }, [recentClients, searchQuery]);

  // ── Greeting ──────────────────────────────────────────────────────────────
  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  const firstName = userProfile?.displayName?.split(' ')[0] ?? 'Counselor';

  // ── Empty state ───────────────────────────────────────────────────────────
  const showEmptyState = !loading && recentClients.length === 0;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#1a365d]">
            {greeting}, {firstName}
          </h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Here&apos;s an overview of your practice today.
          </p>
        </div>
        <button
          onClick={() => navigate(ROUTES.CLIENT_NEW)}
          className="flex items-center gap-2 rounded-lg bg-[#1a365d] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1e407a] transition-colors"
        >
          <UserPlus className="h-4 w-4" />
          New Client
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Active Clients"
          value={loading ? '…' : stats.activeCount}
          icon={Users}
          color="navy"
          loading={loading}
        />
        <StatCard
          title="Questionnaires Pending"
          value={loading ? '…' : stats.pendingQCount}
          icon={ClipboardList}
          color="amber"
          loading={loading}
        />
        <StatCard
          title="Documents in Draft"
          value="—"
          icon={FileEdit}
          subtitle="Requires cross-collection query"
          subtitleMuted
          color="blue"
        />
        <StatCard
          title="Revenue This Month"
          value="—"
          icon={DollarSign}
          subtitle="Requires cross-collection query"
          subtitleMuted
          color="green"
        />
      </div>

      {/* Main content row */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Client table — 2/3 */}
        <div className="xl:col-span-2">
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            {/* Table header */}
            <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-base font-semibold text-[#1a365d]">Recent Clients</h3>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="search"
                    placeholder="Search clients…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 w-48 rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#2b6cb0] focus:outline-none focus:ring-1 focus:ring-[#2b6cb0]/30"
                  />
                </div>
                <button
                  onClick={() => navigate(ROUTES.CLIENTS)}
                  className="flex items-center gap-1.5 text-sm font-medium text-[#2b6cb0] hover:text-[#1a365d] transition-colors"
                >
                  View all
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Table */}
            {showEmptyState ? (
              /* Empty state — no clients at all */
              <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#ebf4ff]">
                  <Users className="h-8 w-8 text-[#1a365d]" />
                </div>
                <div>
                  <p className="text-base font-semibold text-gray-700">No clients yet</p>
                  <p className="mt-1 text-sm text-gray-500">
                    Get started by adding your first client.
                  </p>
                </div>
                <button
                  onClick={() => navigate(ROUTES.CLIENT_NEW)}
                  className="flex items-center gap-2 rounded-lg bg-[#1a365d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1e407a] transition-colors"
                >
                  <UserPlus className="h-4 w-4" />
                  Add your first client
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead>
                    <tr className="bg-gray-50/60">
                      {['Client Name', 'Package', 'Questionnaire', 'Documents', 'Balance', 'Next Appt'].map(
                        (col) => (
                          <th
                            key={col}
                            className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500"
                          >
                            {col}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {loading ? (
                      <>
                        <SkeletonRow />
                        <SkeletonRow />
                        <SkeletonRow />
                      </>
                    ) : filteredClients.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                          No clients match your search.
                        </td>
                      </tr>
                    ) : (
                      filteredClients.map((client) => {
                        const qStatus = client.questionnaireProgress?.status ?? 'not_started';
                        const pkg = client.packageDetails?.packageType;
                        const docCount = Array.isArray(client.documents)
                          ? client.documents.length
                          : null;
                        const balance = formatBalanceDue(client.packageDetails?.balanceDue);
                        const isBalanceZero =
                          !client.packageDetails?.balanceDue || client.packageDetails.balanceDue === 0;

                        return (
                          <tr
                            key={client.id}
                            onClick={() => navigate(ROUTES.CLIENT_DETAIL(client.id))}
                            className="cursor-pointer transition-colors hover:bg-[#ebf4ff]/40"
                          >
                            <td className="px-4 py-3 text-sm font-medium text-[#1a365d]">
                              {clientDisplayName(client)}
                            </td>
                            <td className="px-4 py-3">
                              {pkg ? (
                                <span
                                  className={cn(
                                    'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                                    packageBadge[pkg] ?? 'bg-gray-100 text-gray-600',
                                  )}
                                >
                                  {packageLabel[pkg] ?? pkg}
                                </span>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={cn(
                                  'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                                  qStatusBadge[qStatus] ?? 'bg-gray-100 text-gray-500',
                                )}
                              >
                                {qStatusLabel[qStatus] ?? qStatus}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-500">
                              {docCount !== null ? (
                                <span className="text-gray-700">{docCount} doc{docCount !== 1 ? 's' : ''}</span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {isBalanceZero ? (
                                <span className="text-emerald-600 font-medium">$0.00</span>
                              ) : (
                                <span className="font-medium text-red-600">{balance}</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-400">
                              <span className="flex items-center gap-1">
                                <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                                —
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Recent Activity — 1/3 */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <h3 className="text-base font-semibold text-[#1a365d]">Recent Activity</h3>
            <Clock className="h-4 w-4 text-gray-400" />
          </div>

          {loading ? (
            <ul className="divide-y divide-gray-100">
              {[1, 2, 3, 4].map((i) => (
                <li key={i} className="flex gap-3 px-5 py-3.5">
                  <div className="mt-0.5 h-8 w-8 shrink-0 animate-pulse rounded-full bg-gray-200" />
                  <div className="flex-1 space-y-2 py-1">
                    <div className="h-3 animate-pulse rounded bg-gray-200" />
                    <div className="h-2.5 w-2/3 animate-pulse rounded bg-gray-100" />
                  </div>
                </li>
              ))}
            </ul>
          ) : activityItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-5 py-12 text-center">
              <Clock className="h-8 w-8 text-gray-300" />
              <p className="text-sm text-gray-400">No recent activity</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {activityItems.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.id} className="flex gap-3 px-5 py-3.5">
                    <div
                      className={cn(
                        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                        item.iconBg,
                      )}
                    >
                      <Icon className={cn('h-4 w-4', item.iconColor)} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-700 leading-snug">{item.description}</p>
                      <p className="mt-0.5 text-xs text-gray-400">{item.time}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
