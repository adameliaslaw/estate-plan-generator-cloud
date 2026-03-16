/**
 * AnalyticsWidgets.tsx
 *
 * Analytics section for the admin dashboard.
 * Shows revenue summary, package distribution, and questionnaire
 * completion funnel — all derived from the client list already
 * fetched by DashboardPage (no additional Firestore queries).
 */

import { useMemo } from 'react';
import {
  DollarSign,
  PieChart,
  TrendingUp,
  BarChart3,
  CheckCircle2,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Client } from '@/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

// ── Types ────────────────────────────────────────────────────────────────────

interface Props {
  clients: (Client & { id: string })[];
  loading?: boolean;
}

// ── Bar component ────────────────────────────────────────────────────────────

function HorizontalBar({
  label,
  value,
  total,
  color,
  displayValue,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
  displayValue?: string;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-700">{label}</span>
        <span className="tabular-nums text-gray-500">
          {displayValue ?? value}
          <span className="text-gray-400 text-xs ml-1">({Math.round(pct)}%)</span>
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={cn('h-full rounded-full transition-all duration-700', color)}
          style={{ width: `${Math.max(pct, 1)}%` }}
        />
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function AnalyticsWidgets({ clients, loading }: Props) {
  const stats = useMemo(() => {
    const active = clients.filter((c) => !c.isArchived);

    // Package distribution
    const packages: Record<string, number> = {
      foundation: 0,
      guardian: 0,
      fortress: 0,
      unset: 0,
    };
    for (const c of active) {
      const pkg = c.packageDetails?.packageType;
      if (pkg && pkg in packages) packages[pkg]++;
      else packages.unset++;
    }

    // Revenue / Balance
    let totalRevenue = 0;
    let totalBalance = 0;
    let paidCount = 0;
    for (const c of active) {
      const pd = c.packageDetails;
      if (pd?.estimatedFee) totalRevenue += pd.estimatedFee;
      if (pd?.balanceDue) totalBalance += pd.balanceDue;
      if (pd?.balanceDue === 0 && pd?.estimatedFee) paidCount++;
    }

    // Questionnaire funnel
    let qCompleted = 0;
    let qInProgress = 0;
    let qNotStarted = 0;
    for (const c of active) {
      const status = c.questionnaireProgress?.status;
      if (status === 'completed') qCompleted++;
      else if (status === 'in_progress') qInProgress++;
      else qNotStarted++;
    }

    // Client creation by month (last 6 months)
    const now = new Date();
    const months: { label: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        label: d.toLocaleDateString('en-US', { month: 'short' }),
        count: 0,
      });
    }
    for (const c of active) {
      const ts = c.createdAt as unknown as { seconds: number } | undefined;
      if (!ts?.seconds) continue;
      const created = new Date(ts.seconds * 1000);
      for (const m of months) {
        const mDate = new Date(`1 ${m.label} ${now.getFullYear()}`);
        if (
          created.getMonth() === mDate.getMonth() &&
          created.getFullYear() === mDate.getFullYear()
        ) {
          m.count++;
          break;
        }
      }
    }

    return {
      activeCount: active.length,
      packages,
      totalRevenue,
      totalBalance,
      paidCount,
      qCompleted,
      qInProgress,
      qNotStarted,
      months,
    };
  }, [clients]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-xl border border-gray-200 bg-gray-50" />
        ))}
      </div>
    );
  }

  const totalClients = stats.activeCount;
  const collectRate =
    stats.totalRevenue > 0
      ? Math.round(((stats.totalRevenue - stats.totalBalance) / stats.totalRevenue) * 100)
      : 0;

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-[#1a365d] flex items-center gap-2">
        <BarChart3 className="h-4.5 w-4.5" />
        Analytics Overview
      </h3>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Revenue Card */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Total Revenue</p>
            <div className="rounded-lg bg-emerald-50 p-2">
              <DollarSign className="h-4 w-4 text-emerald-600" />
            </div>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {formatCurrency(stats.totalRevenue)}
          </p>
          <div className="mt-2 flex items-center gap-1.5 text-xs">
            <span className={cn(
              'font-medium',
              stats.totalBalance > 0 ? 'text-amber-600' : 'text-emerald-600',
            )}>
              {formatCurrency(stats.totalBalance)} outstanding
            </span>
            <span className="text-gray-300">•</span>
            <span className="text-gray-500">{collectRate}% collected</span>
          </div>
        </div>

        {/* Package Distribution Card */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
              Package Mix
            </p>
            <div className="rounded-lg bg-indigo-50 p-2">
              <PieChart className="h-4 w-4 text-indigo-600" />
            </div>
          </div>
          <div className="space-y-2">
            <HorizontalBar
              label="Basic Estate Plan"
              value={stats.packages.foundation}
              total={totalClients}
              color="bg-slate-400"
            />
            <HorizontalBar
              label="Revocable Trust"
              value={stats.packages.guardian}
              total={totalClients}
              color="bg-[#2b6cb0]"
            />
            <HorizontalBar
              label="Irrevocable Trust"
              value={stats.packages.fortress}
              total={totalClients}
              color="bg-indigo-600"
            />
          </div>
        </div>

        {/* Questionnaire Funnel Card */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
              Questionnaires
            </p>
            <div className="rounded-lg bg-blue-50 p-2">
              <TrendingUp className="h-4 w-4 text-[#2b6cb0]" />
            </div>
          </div>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm text-gray-700">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                Completed
              </span>
              <span className="text-sm font-semibold text-emerald-700 tabular-nums">
                {stats.qCompleted}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm text-gray-700">
                <Clock className="h-3.5 w-3.5 text-amber-500" />
                In Progress
              </span>
              <span className="text-sm font-semibold text-amber-700 tabular-nums">
                {stats.qInProgress}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-sm text-gray-700">
                <AlertCircle className="h-3.5 w-3.5 text-gray-400" />
                Not Started
              </span>
              <span className="text-sm font-semibold text-gray-500 tabular-nums">
                {stats.qNotStarted}
              </span>
            </div>
          </div>
        </div>

        {/* Client Trend (mini sparkline as bars) */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
              New Clients (6mo)
            </p>
            <div className="rounded-lg bg-[#ebf4ff] p-2">
              <BarChart3 className="h-4 w-4 text-[#1a365d]" />
            </div>
          </div>
          <div className="flex items-end gap-1.5 h-16">
            {stats.months.map((m) => {
              const maxCount = Math.max(...stats.months.map((x) => x.count), 1);
              const heightPct = Math.max((m.count / maxCount) * 100, 6);
              return (
                <div key={m.label} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[9px] font-medium text-gray-500 tabular-nums">
                    {m.count > 0 ? m.count : ''}
                  </span>
                  <div
                    className="w-full rounded-t bg-gradient-to-t from-[#1a365d] to-[#2b6cb0] transition-all duration-500"
                    style={{ height: `${heightPct}%` }}
                  />
                  <span className="text-[9px] text-gray-400">{m.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
