import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  UserPlus,
  Users,
  SlidersHorizontal,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  FileEdit,
  MoreVertical,
  Archive,
  Trash2,
  Upload,
} from 'lucide-react';
import { orderBy, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useCollection } from '@/hooks/useFirestore';
import { COLLECTIONS, ROUTES } from '@/config/constants';
import { logSystemActivity } from '@/utils/activity-logger';
import { clientService } from '@/services/client-service';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/usePermissions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { Client, PackageType, QuestionnaireStatus } from '@/types';
import BulkImportModal from '@/components/clients/BulkImportModal';

// ── Badge / label maps ─────────────────────────────────────────────────────────

const packageLabel: Record<PackageType, string> = {
  foundation: 'Basic Estate Plan',
  guardian: 'Revocable Trust',
  fortress: 'Irrevocable Trust',
};

const packageBadge: Record<PackageType, string> = {
  foundation: 'bg-slate-100 text-slate-600',
  guardian: 'bg-[#ebf4ff] text-[#2b6cb0]',
  fortress: 'bg-indigo-50 text-indigo-700',
};

const qLabel: Record<QuestionnaireStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  completed: 'Completed',
};

const qBadge: Record<QuestionnaireStatus, string> = {
  not_started: 'bg-gray-100 text-gray-500',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
};

// ── Sort types ─────────────────────────────────────────────────────────────────

type SortField = 'name' | 'email' | 'package' | 'questionnaire' | 'balance';
type SortDir = 'asc' | 'desc';

// ── Helpers ────────────────────────────────────────────────────────────────────

function clientDisplayName(client: Client): string {
  const { lastName, firstName } = client.personalInfo ?? {};
  if (!lastName && !firstName) return 'Unknown Client';
  if (!firstName) return lastName ?? '';
  return `${lastName}, ${firstName}`;
}

function formatBalanceDue(balanceDue?: number): string {
  if (balanceDue == null) return '—';
  const dollars = balanceDue / 100;
  return `$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Skeleton rows ──────────────────────────────────────────────────────────────

function SkeletonTableRow() {
  return (
    <tr>
      {[50, 55, 30, 35, 30, 25].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div
            className="h-4 animate-pulse rounded bg-gray-200"
            style={{ width: `${w}%` }}
          />
        </td>
      ))}
      <td className="px-4 py-3">
        <div className="ml-auto h-4 w-4 animate-pulse rounded bg-gray-200" />
      </td>
    </tr>
  );
}

function SkeletonMobileCard() {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-4">
      <div className="flex-1 space-y-2">
        <div className="h-4 w-2/3 animate-pulse rounded bg-gray-200" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
        <div className="flex gap-1.5 pt-0.5">
          <div className="h-5 w-16 animate-pulse rounded-full bg-gray-200" />
          <div className="h-5 w-20 animate-pulse rounded-full bg-gray-100" />
        </div>
      </div>
      <div className="h-5 w-5 animate-pulse rounded bg-gray-200" />
    </div>
  );
}

// ── Sort icon ──────────────────────────────────────────────────────────────────

function SortIcon({
  field,
  sortField,
  sortDir,
}: {
  field: SortField;
  sortField: SortField;
  sortDir: SortDir;
}) {
  if (field !== sortField) {
    return <ChevronsUpDown className="ml-1 inline h-3.5 w-3.5 text-gray-300" />;
  }
  return sortDir === 'asc' ? (
    <ChevronUp className="ml-1 inline h-3.5 w-3.5 text-[#2b6cb0]" />
  ) : (
    <ChevronDown className="ml-1 inline h-3.5 w-3.5 text-[#2b6cb0]" />
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ClientListPage() {
  const { user, userProfile } = useAuth();
  const { canManageClients } = usePermissions();
  const navigate = useNavigate();
  const [importOpen, setImportOpen] = useState(false);

  const firmId = userProfile?.firmId ?? '';

  const { data: clients, loading } = useCollection<Client>(
    firmId ? COLLECTIONS.CLIENTS(firmId) : null,
    [orderBy('updatedAt', 'desc')],
  );

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [packageFilter, setPackageFilter] = useState<string>('all');
  const [qFilter, setQFilter] = useState<string>('all');
  const [showArchived, setShowArchived] = useState(false);

  // Archive/Delete state
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  // Sort state
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  // ── Filter + sort (client-side) ──────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = clients.filter((c) => {
      const name = clientDisplayName(c).toLowerCase();
      const email = c.personalInfo?.email?.toLowerCase() ?? '';
      const phone = c.personalInfo?.phone?.toLowerCase() ?? '';
      const q = searchQuery.toLowerCase().trim();

      const matchesSearch = !q || name.includes(q) || email.includes(q) || phone.includes(q);
      const matchesPkg =
        packageFilter === 'all' || c.packageDetails?.packageType === packageFilter;
      const matchesQ =
        qFilter === 'all' || (c.questionnaireProgress?.status ?? 'not_started') === qFilter;

      // If showArchived is false, ONLY show clients where isArchived is exactly false or undefined
      const matchesArchive = showArchived ? true : !c.isArchived;

      return matchesSearch && matchesPkg && matchesQ && matchesArchive;
    });

    // Client-side sort
    result = [...result].sort((a, b) => {
      let valA: string | number = '';
      let valB: string | number = '';

      switch (sortField) {
        case 'name':
          valA = clientDisplayName(a).toLowerCase();
          valB = clientDisplayName(b).toLowerCase();
          break;
        case 'email':
          valA = a.personalInfo?.email?.toLowerCase() ?? '';
          valB = b.personalInfo?.email?.toLowerCase() ?? '';
          break;
        case 'package':
          valA = a.packageDetails?.packageType ?? '';
          valB = b.packageDetails?.packageType ?? '';
          break;
        case 'questionnaire':
          valA = a.questionnaireProgress?.status ?? 'not_started';
          valB = b.questionnaireProgress?.status ?? 'not_started';
          break;
        case 'balance':
          valA = a.packageDetails?.balanceDue ?? 0;
          valB = b.packageDetails?.balanceDue ?? 0;
          break;
      }

      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [clients, searchQuery, packageFilter, qFilter, sortField, sortDir, showArchived]);

  const hasFilters = searchQuery.trim() !== '' || packageFilter !== 'all' || qFilter !== 'all';

  const clearFilters = () => {
    setSearchQuery('');
    setPackageFilter('all');
    setQFilter('all');
    setShowArchived(false);
  };

  // ── Actions ──────────────────────────────────────────────────────────────
  const handleArchive = async (clientId: string, isArchived: boolean) => {
    if (!firmId) return;
    try {
      await updateDoc(doc(db, COLLECTIONS.CLIENTS(firmId), clientId), {
        isArchived: !isArchived,
      });
      toast.success(isArchived ? 'Client unarchived' : 'Client archived');
    } catch (error) {
      console.error('Error changing archive status:', error);
      toast.error('Failed to update client');
    }
  };

  const handleDelete = async (clientId: string) => {
    if (!firmId) return;
    try {
      const client = clients.find(c => c.id === clientId);
      const cName = client ? clientDisplayName(client) : 'Unknown Client';
      // Server-side cascade: the client SDK's deleteDoc would orphan the
      // client's documents/notes/payments/versions + Storage files (R5-020).
      await clientService.deleteClient({ firmId, clientId });

      await logSystemActivity(firmId, userProfile, 'deleting client', {
        clientName: cName,
        clientId,
      });

      toast.success('Client permanently deleted');
    } catch (error) {
      console.error('Error deleting client:', error);
      toast.error('Failed to delete client');
    } finally {
      setIsDeleting(null);
    }
  };

  // ── Sortable column header ───────────────────────────────────────────────
  const SortableHeader = ({
    field,
    label,
    className,
  }: {
    field: SortField;
    label: string;
    className?: string;
  }) => (
    <th
      className={cn(
        'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 cursor-pointer select-none hover:text-[#1a365d] transition-colors',
        className,
      )}
      onClick={() => handleSort(field)}
    >
      {label}
      <SortIcon field={field} sortField={sortField} sortDir={sortDir} />
    </th>
  );

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#1a365d]">Clients</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            {loading ? (
              <span className="inline-block h-4 w-24 animate-pulse rounded bg-gray-200" />
            ) : (
              `${clients.length} client${clients.length !== 1 ? 's' : ''} total`
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManageClients && (
            <>
              <button
                onClick={() => setImportOpen(true)}
                className="flex items-center gap-2 rounded-lg border border-[#2b6cb0] bg-white px-4 py-2.5 text-sm font-semibold text-[#2b6cb0] shadow-sm hover:bg-[#ebf4ff] transition-colors"
              >
                <Upload className="h-4 w-4" />
                Import CSV
              </button>
              <button
                onClick={() => navigate(ROUTES.CLIENT_NEW)}
                className="flex items-center gap-2 rounded-lg bg-[#1a365d] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1e407a] transition-colors"
              >
                <UserPlus className="h-4 w-4" />
                Add Client
              </button>
            </>
          )}
        </div>
      </div>

      {/* Search & filter bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search by name, email, or phone…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="block h-10 w-full rounded-lg border border-gray-300 bg-white pl-10 pr-4 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#2b6cb0] focus:outline-none focus:ring-2 focus:ring-[#2b6cb0]/20"
          />
        </div>
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-gray-400 shrink-0" />
          <select
            value={packageFilter}
            onChange={(e) => setPackageFilter(e.target.value)}
            className="h-10 rounded-lg border border-gray-300 bg-white px-3 pr-8 text-sm text-gray-700 focus:border-[#2b6cb0] focus:outline-none focus:ring-2 focus:ring-[#2b6cb0]/20"
          >
            <option value="all">All Packages</option>
            <option value="foundation">Basic Estate Plan</option>
            <option value="guardian">Revocable Trust</option>
            <option value="fortress">Irrevocable Trust</option>
          </select>
          <select
            value={qFilter}
            onChange={(e) => setQFilter(e.target.value)}
            className="h-10 rounded-lg border border-gray-300 bg-white px-3 pr-8 text-sm text-gray-700 focus:border-[#2b6cb0] focus:outline-none focus:ring-2 focus:ring-[#2b6cb0]/20"
          >
            <option value="all">All Questionnaires</option>
            <option value="not_started">Not Started</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-700 whitespace-nowrap bg-white border border-gray-300 rounded-lg px-3 h-10 cursor-pointer hover:bg-gray-50 transition-colors">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="rounded border-gray-300 text-[#1a365d] focus:ring-[#1a365d]"
            />
            Show Archived
          </label>
        </div>
      </div>

      {/* Table card */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {/* Loading skeleton */}
        {loading ? (
          <>
            {/* Desktop skeleton */}
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50/60">
                  <tr>
                    {['Name', 'Email', 'Package', 'Questionnaire', 'Documents', 'Balance'].map(
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
                  <SkeletonTableRow />
                  <SkeletonTableRow />
                  <SkeletonTableRow />
                  <SkeletonTableRow />
                </tbody>
              </table>
            </div>
            {/* Mobile skeleton */}
            <div className="divide-y divide-gray-100 md:hidden">
              <SkeletonMobileCard />
              <SkeletonMobileCard />
              <SkeletonMobileCard />
            </div>
          </>
        ) : filtered.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center gap-4 px-6 py-20 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#ebf4ff]">
              <Users className="h-8 w-8 text-[#1a365d]" />
            </div>
            {hasFilters ? (
              <>
                <p className="text-base font-semibold text-gray-700">No clients match your search</p>
                <p className="text-sm text-gray-500">Try adjusting your search or filters.</p>
                <button
                  onClick={clearFilters}
                  className="text-sm font-medium text-[#2b6cb0] hover:underline"
                >
                  Clear filters
                </button>
              </>
            ) : (
              <>
                <p className="text-base font-semibold text-gray-700">No clients yet</p>
                <p className="text-sm text-gray-500">
                  Get started by adding your first client.
                </p>
                {canManageClients && (
                  <button
                    onClick={() => navigate(ROUTES.CLIENT_NEW)}
                    className="flex items-center gap-2 rounded-lg bg-[#1a365d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1e407a] transition-colors"
                  >
                    <UserPlus className="h-4 w-4" />
                    Add Client
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50/60">
                  <tr>
                    <SortableHeader field="name" label="Name" />
                    <SortableHeader field="email" label="Email" />
                    <SortableHeader field="package" label="Package" />
                    <SortableHeader field="questionnaire" label="Questionnaire" />
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Documents
                    </th>
                    <SortableHeader field="balance" label="Balance" />
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {filtered.map((client) => {
                    const pkg = client.packageDetails?.packageType;
                    const qStatus: QuestionnaireStatus =
                      (client.questionnaireProgress?.status as QuestionnaireStatus | undefined) ??
                      'not_started';
                    const balance = client.packageDetails?.balanceDue;
                    const isBalanceZero = !balance || balance === 0;
                    const docCount = Array.isArray(client.documents)
                      ? client.documents.length
                      : null;

                    return (
                      <tr
                        key={client.id}
                        onClick={() => navigate(ROUTES.CLIENT_DETAIL(client.id))}
                        className="cursor-pointer transition-colors hover:bg-[#ebf4ff]/40"
                      >
                        <td className="px-4 py-3 text-sm font-medium text-[#1a365d]">
                          {clientDisplayName(client)}
                          {client.isArchived && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                              Archived
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {client.personalInfo?.email ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          {pkg ? (
                            <span
                              className={cn(
                                'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                                packageBadge[pkg],
                              )}
                            >
                              {packageLabel[pkg]}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
                              qBadge[qStatus],
                            )}
                          >
                            {qLabel[qStatus]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {docCount !== null ? (
                            <span className="text-gray-700">
                              {docCount} doc{docCount !== 1 ? 's' : ''}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {isBalanceZero ? (
                            <span className="text-emerald-600 font-medium">$0.00</span>
                          ) : (
                            <span className="font-medium text-red-600">
                              {formatBalanceDue(balance)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                className="inline-flex items-center justify-center p-2 rounded hover:bg-gray-100 text-gray-500 transition-colors"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreVertical className="h-4 w-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!firmId) return;
                                  navigate(`/questionnaire/${firmId}/${client.id}`);
                                }}
                              >
                                <FileEdit className="mr-2 h-4 w-4" />
                                {qStatus === 'completed'
                                  ? 'View Questionnaire'
                                  : qStatus === 'in_progress'
                                    ? 'Continue Questionnaire'
                                    : 'Start Questionnaire'}
                              </DropdownMenuItem>
                              {canManageClients && (
                                <>
                                  <DropdownMenuItem
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleArchive(client.id, !!client.isArchived);
                                    }}
                                  >
                                    <Archive className="mr-2 h-4 w-4" />
                                    {client.isArchived ? 'Unarchive Client' : 'Archive Client'}
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-red-600 focus:bg-red-50 focus:text-red-700"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setIsDeleting(client.id);
                                    }}
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Delete Client
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <div className="divide-y divide-gray-100 md:hidden">
              {filtered.map((client) => {
                const pkg = client.packageDetails?.packageType;
                const qStatus: QuestionnaireStatus =
                  (client.questionnaireProgress?.status as QuestionnaireStatus | undefined) ??
                  'not_started';

                return (
                  <div
                    key={client.id}
                    onClick={() => navigate(ROUTES.CLIENT_DETAIL(client.id))}
                    className="flex cursor-pointer items-center justify-between gap-3 px-4 py-4 hover:bg-[#ebf4ff]/40 transition-colors"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm font-semibold text-[#1a365d]">
                        {clientDisplayName(client)}
                        {client.isArchived && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                            Archived
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-gray-500">
                        {client.personalInfo?.email ?? '—'}
                      </p>
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {pkg && (
                          <span
                            className={cn(
                              'inline-flex rounded-full px-2 py-0.5 text-xs font-semibold',
                              packageBadge[pkg],
                            )}
                          >
                            {packageLabel[pkg]}
                          </span>
                        )}
                        <span
                          className={cn(
                            'inline-flex rounded-full px-2 py-0.5 text-xs font-semibold',
                            qBadge[qStatus],
                          )}
                        >
                          {qLabel[qStatus]}
                        </span>
                      </div>
                    </div>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="inline-flex items-center justify-center p-2 rounded hover:bg-gray-100 text-gray-500 transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="h-5 w-5 shrink-0" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!firmId) return;
                            navigate(`/questionnaire/${firmId}/${client.id}`);
                          }}
                        >
                          <FileEdit className="mr-2 h-4 w-4" />
                          {qStatus === 'completed'
                            ? 'View Questionnaire'
                            : qStatus === 'in_progress'
                              ? 'Continue Questionnaire'
                              : 'Start Questionnaire'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {canManageClients && (
                          <>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleArchive(client.id, !!client.isArchived);
                              }}
                            >
                              <Archive className="mr-2 h-4 w-4" />
                              {client.isArchived ? 'Unarchive Client' : 'Archive Client'}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-red-600 focus:bg-red-50 focus:text-red-700"
                              onClick={(e) => {
                                e.stopPropagation();
                                setIsDeleting(client.id);
                              }}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete Client
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <AlertDialog open={!!isDeleting} onOpenChange={(open) => !open && setIsDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the client and remove all of their data, questionnaires, and uploaded documents from our servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => isDeleting && handleDelete(isDeleting)}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              Confirm Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BulkImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        firmId={firmId}
        userId={user?.uid ?? ''}
      />
    </div>
  );
}
