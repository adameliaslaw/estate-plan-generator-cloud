import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  ClipboardList,
  Search,
  UserPlus,
  ArrowRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  FileEdit,
  ChevronDown,
  ChevronUp,
  Activity,
} from 'lucide-react';
import { orderBy, limit, doc, updateDoc } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { useCollection } from '@/hooks/useFirestore';
import { db } from '@/config/firebase';
import { COLLECTIONS, ROUTES } from '@/config/constants';
import { cn } from '@/lib/utils';
import type { Client } from '@/types';
import { TasksList } from '@/components/dashboard/TasksList';
import { UpcomingAppointments } from '@/components/dashboard/UpcomingAppointments';
import { AudioRecorderModal } from '@/components/ui/audio-recorder-modal';
import { Mic } from 'lucide-react';
import { collection, setDoc, serverTimestamp } from 'firebase/firestore';
import { toast } from 'sonner';
import { uploadAudioToStorage, requestTranscription } from '@/utils/audio-helpers';

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDetailedTime(ts: { seconds: number; nanoseconds: number } | undefined): string {
  if (!ts) return '';
  const date = new Date(ts.seconds * 1000);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHrs = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  const exactTime = date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  let relative = '';
  if (diffMins < 2) relative = 'Just now';
  else if (diffMins < 60) relative = `${diffMins} minutes ago`;
  else if (diffHrs < 24) relative = `${diffHrs} hour${diffHrs !== 1 ? 's' : ''} ago`;
  else if (diffDays === 1) relative = 'Yesterday';
  else relative = `${diffDays} days ago`;

  return `${exactTime} (${relative})`;
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

// We no longer build activity items purely from clients.
// This is now handled by the true activities collection in DashboardPage.

// ── Page component ─────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, userProfile } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  // ── Persistent expansion state ──────────────────────────────────────────────
  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    return userProfile?.recentActivityExpanded ?? false;
  });

  const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);
  const [isSavingRecord, setIsSavingRecord] = useState(false);

  const toggleExpanded = async () => {
    const nextState = !isExpanded;
    setIsExpanded(nextState);
    if (user?.uid) {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, { recentActivityExpanded: nextState }).catch(console.error);
    }
  };

  const firmId = userProfile?.firmId ?? '';

  // Real-time collection queries for stats and tables
  const {
    data: recentClients,
    loading: clientsLoading,
  } = useCollection<Client>(
    firmId ? COLLECTIONS.CLIENTS(firmId) : null,
    useMemo(() => [orderBy('updatedAt', 'desc'), limit(10)], [])
  );

  const { data: allClients, loading: allLoading } = useCollection<Client>(
    firmId ? COLLECTIONS.CLIENTS(firmId) : null,
    useMemo(() => [orderBy('createdAt', 'desc'), limit(50)], []) // Grab enough to count active users
  );

  interface RawActivityItem {
    id: string;
    description: string;
    action: string;
    userName?: string;
    timestamp?: { seconds: number; nanoseconds: number };
  }

  // Real-time query for explict frontend activities
  const { data: rawActivities, loading: activitiesLoading } = useCollection<RawActivityItem>(
    firmId ? `firms/${firmId}/activities` : null,
    useMemo(() => [orderBy('timestamp', 'desc'), limit(40)], [])
  );

  const loading = clientsLoading || allLoading || activitiesLoading;

  // ── Computed stats ────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const activeCount = allClients.filter((c) => !c.isArchived).length;
    const pendingQCount = allClients.filter(
      (c) => c.questionnaireProgress?.status === 'in_progress',
    ).length;
    return { activeCount, pendingQCount };
  }, [allClients]);

  // ── Activity items ────────────────────────────────────────────────────────
  const allActivityItems = useMemo(() => {
    return rawActivities.map(a => {
      // Determine icon based on action string
      let icon = Activity;
      let iconColor = 'text-[#2b6cb0]';
      let iconBg = 'bg-blue-50';

      const action = a.action?.toLowerCase() || '';

      if (action.includes('completing questionnaire') || action.includes('completing task')) {
        icon = CheckCircle2;
        iconColor = 'text-emerald-600';
        iconBg = 'bg-emerald-50';
      } else if (action.includes('editing questionnaire')) {
        icon = ClipboardList;
        iconColor = 'text-amber-600';
        iconBg = 'bg-amber-50';
      } else if (action.includes('scheduling appointment')) {
        icon = Clock;
        iconColor = 'text-purple-600';
        iconBg = 'bg-purple-50';
      } else if (action.includes('payment')) {
        icon = AlertCircle;
        iconColor = 'text-amber-600';
        iconBg = 'bg-amber-50';
      } else if (action.includes('adding client')) {
        icon = UserPlus;
        iconColor = 'text-[#1a365d]';
        iconBg = 'bg-[#ebf4ff]';
      } else if (action.includes('drafting documents') || action.includes('editing documents')) {
        icon = FileText;
        iconColor = 'text-indigo-600';
        iconBg = 'bg-indigo-50';
      }

      const description = a.description || action;
      // Append userName if it was not auto-included and it's useful
      const finalDesc = (a.userName && !description.includes(a.userName!))
        ? `${description} by ${a.userName}`
        : description;

      return {
        id: a.id,
        icon,
        iconColor,
        iconBg,
        description: finalDesc,
        time: formatDetailedTime(a.timestamp),
      };
    });
  }, [rawActivities]);

  const displayedActivityItems = isExpanded ? allActivityItems : allActivityItems.slice(0, 5);

  // ── Search filter handler ───────────────────────────────────────────────────
  const filteredClients = useMemo(() => {
    let baseList = searchQuery ? allClients : recentClients;
    baseList = baseList.filter((c) => !c.isArchived);

    if (!searchQuery) return baseList;
    const q = searchQuery.toLowerCase();
    return baseList.filter((c) => {
      const { firstName = '', lastName = '', email = '', phone = '' } = c.personalInfo;
      return (
        firstName.toLowerCase().includes(q) ||
        lastName.toLowerCase().includes(q) ||
        email.toLowerCase().includes(q) ||
        phone.includes(q)
      );
    });
  }, [recentClients, allClients, searchQuery]);

  const showEmptyState = !clientsLoading && filteredClients.length === 0 && !searchQuery && allClients.filter(c => !c.isArchived).length === 0;

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleSaveAudioNote = async (data: any) => {
    if (!user?.uid || !firmId || !data.clientId) return;
    setIsSavingRecord(true);
    try {
      const collPath = COLLECTIONS.NOTES(firmId, data.clientId);
      const docRef = doc(collection(db, collPath));
      const activeNoteId = docRef.id;

      let audioUrl = null;
      let storagePath = null;
      let status = null;

      if (data.audioBlob) {
        const upload = await uploadAudioToStorage(data.audioBlob, firmId, data.clientId, activeNoteId);
        audioUrl = upload.url;
        storagePath = upload.fullPath;
        status = 'processing';
      }

      const newNote = {
        title: data.title || (data.audioBlob ? 'Audio Note' : 'Manual Note'),
        noteType: data.noteType,
        content: data.content,
        isPinned: false,
        isPrivate: false,
        audioUrl,
        audioStoragePath: storagePath,
        audioFileName: data.audioFileName,
        audioDurationSeconds: data.durationSeconds || undefined,
        transcriptionStatus: status,
        firmId,
        clientId: data.clientId,
        source: 'manual',
        createdBy: user.uid,
        updatedBy: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(docRef, newNote);

      if (storagePath) {
        requestTranscription(firmId, data.clientId, activeNoteId, storagePath);
        toast.success('Note saved. Audio uploading and transcription started.');
      } else {
        toast.success('Note saved successfully.');
      }
    } catch (err) {
      console.error('Failed to save audio note', err);
      toast.error('Failed to save note.');
    } finally {
      setIsSavingRecord(false);
    }
  };


  // ── Empty state ───────────────────────────────────────────────────────────
  // const showEmptyState = !loading && recentClients.length === 0; // Replaced by new showEmptyState above

  const audioModalClients = useMemo(() => {
    return allClients
      .filter((c) => !c.isArchived)
      .map((c) => ({
        id: c.id,
        name: clientDisplayName(c),
      }));
  }, [allClients]);

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-4 sm:p-6 lg:p-8">
      {/* Header row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#1a365d]">Overview</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-gray-500">
            Welcome back, {userProfile?.displayName?.split(' ')[0] ?? 'Counselor'}
            {firmId && <span className="text-gray-300">•</span>}
            {firmId && <span>Firm ID: {firmId}</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsRecordModalOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-[#2b6cb0] bg-white px-4 py-2 text-sm font-semibold text-[#2b6cb0] shadow-sm hover:bg-[#ebf4ff] transition-colors"
          >
            <Mic className="h-4 w-4" />
            Record Note
          </button>
          <button
            onClick={() => navigate(ROUTES.CLIENT_NEW)}
            className="flex items-center gap-2 rounded-lg bg-[#2b6cb0] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#1e407a] transition-colors"
          >
            <UserPlus className="h-4 w-4" />
            New Client
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                      {['Client Name', 'Package', 'Questionnaire', 'Documents', 'Balance'].map(
                        (col) => (
                          <th
                            key={col}
                            className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500"
                          >
                            {col}
                          </th>
                        ),
                      )}
                      <th className="px-4 py-3" />
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
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!firmId) return;
                                  navigate(`/questionnaire/${firmId}/${client.id}`);
                                }}
                                className="inline-flex items-center justify-center p-2 rounded hover:bg-[#ebf4ff] text-[#2b6cb0] transition-colors"
                                title={qStatus === 'completed' ? 'View Questionnaire' : qStatus === 'in_progress' ? 'Continue Questionnaire' : 'Start Questionnaire'}
                              >
                                <FileEdit className="h-4 w-4" />
                              </button>
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
          ) : displayedActivityItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-5 py-12 text-center">
              <Clock className="h-8 w-8 text-gray-300" />
              <p className="text-sm text-gray-400">No recent activity</p>
            </div>
          ) : (
            <div className={cn("flex flex-col", isExpanded && "max-h-[600px] overflow-y-auto")}>
              <ul className="divide-y divide-gray-100">
                {displayedActivityItems.map((item) => {
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

              {/* Expand/Collapse Toggle */}
              {allActivityItems.length > 5 && (
                <div className="border-t border-gray-100 p-2 text-center sticky bottom-0 bg-white/95 backdrop-blur-sm">
                  <button
                    onClick={toggleExpanded}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium text-[#2b6cb0] hover:bg-blue-50/50 transition-colors"
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="h-4 w-4" />
                        Show Less
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4" />
                        View All Activity
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Task & Calendar Row */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 h-[500px]">
        <TasksList activeClientIds={filteredClients.map(c => c.id)} />
        <UpcomingAppointments activeClientIds={filteredClients.map(c => c.id)} />
      </div>

      <AudioRecorderModal
        open={isRecordModalOpen}
        onOpenChange={setIsRecordModalOpen}
        onSave={handleSaveAudioNote}
        isSaving={isSavingRecord}
        clients={audioModalClients}
      />
    </div>
  );
}
