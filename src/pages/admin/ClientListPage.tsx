import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  UserPlus,
  ChevronRight,
  Users,
  SlidersHorizontal,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from 'lucide-react';
import { orderBy } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import { useCollection } from '@/hooks/useFirestore';
import { COLLECTIONS, ROUTES } from '@/config/constants';
import { cn } from '@/lib/utils';
import type { Client, PackageType, QuestionnaireStatus } from '@/types';

// ── Badge / label maps ─────────────────────────────────────────────────────────

const packageLabel: Record<PackageType, string> = {
  foundation: 'Foundation',
  guardian: 'Guardian',
  fortress: 'Fortress',
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
  const { userProfile } = useAuth();
  const navigate = useNavigate();

  const firmId = userProfile?.firmId ?? '';

  const { data: clients, loading } = useCollection<Client>(
    firmId ? COLLECTIONS.CLIENTS(firmId) : null,
    [orderBy('updatedAt', 'desc')],
  );

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [packageFilter, setPackageFilter] = useState<string>('all');
  const [qFilter, setQFilter] = useState<string>('all');

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

      return matchesSearch && matchesPkg && matchesQ;
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
  }, [clients, searchQuery, packageFilter, qFilter, sortField, sortDir]);

  const hasFilters = searchQuery.trim() !== '' || packageFilter !== 'all' || qFilter !== 'all';

  const clearFilters = () => {
    setSearchQuery('');
    setPackageFilter('all');
    setQFilter('all');
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
        <button
          onClick={() => navigate(ROUTES.CLIENT_NEW)}
          className="flex items-center gap-2 rounded-lg bg-[#1a365d] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1e407a] transition-colors"
        >
          <UserPlus className="h-4 w-4" />
          Add Client
        </button>
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
            <option value="foundation">Foundation</option>
            <option value="guardian">Guardian</option>
            <option value="fortress">Fortress</option>
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
                <button
                  onClick={() => navigate(ROUTES.CLIENT_NEW)}
                  className="flex items-center gap-2 rounded-lg bg-[#1a365d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1e407a] transition-colors"
                >
                  <UserPlus className="h-4 w-4" />
                  Add Client
                </button>
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
                          <ChevronRight className="ml-auto h-4 w-4 text-gray-400" />
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
                    <ChevronRight className="h-5 w-5 shrink-0 text-gray-400" />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
