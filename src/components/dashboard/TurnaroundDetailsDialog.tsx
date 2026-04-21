/**
 * TurnaroundDetailsDialog.tsx
 *
 * Per-client breakdown of pipeline stage + cycle-time metrics.
 * Opens from TurnaroundTimesCard; purely presentational — all data comes
 * pre-computed from src/utils/turnaround-stats.ts.
 */

import { useMemo, useState } from 'react';
import { Timer, ArrowUpDown } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  formatDays,
  STAGE_COLORS,
  STAGE_LABELS,
  type ClientCycleRow,
  type ClientStage,
  type TurnaroundMedians,
} from '@/utils/turnaround-stats';

interface Props {
  rows: ClientCycleRow[];
  medians: TurnaroundMedians;
  onClose: () => void;
}

type SortKey =
  | 'client'
  | 'stage'
  | 'daysInStage'
  | 'daysSinceIntake'
  | 'questionnaire'
  | 'draft'
  | 'review'
  | 'signing'
  | 'fullCycle';

type SortDir = 'asc' | 'desc';

const STAGE_ORDER: Record<ClientStage, number> = {
  not_started: 0,
  questionnaire: 1,
  drafting: 2,
  review: 3,
  signing: 4,
  complete: 5,
};

// ── Sortable header helper ────────────────────────────────────────────────────

function SortHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onClick,
  align = 'left',
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  onClick: (k: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = activeKey === sortKey;
  return (
    <th
      scope="col"
      className={cn(
        'px-2 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 hover:text-[#1a365d]',
          active && 'text-[#1a365d]',
          align === 'right' && 'flex-row-reverse',
        )}
      >
        {label}
        <ArrowUpDown
          className={cn('h-3 w-3', active ? 'opacity-100' : 'opacity-30')}
        />
        {active && (
          <span className="sr-only">{dir === 'asc' ? 'ascending' : 'descending'}</span>
        )}
      </button>
    </th>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TurnaroundDetailsDialog({
  rows,
  medians,
  onClose,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('daysInStage');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [stageFilter, setStageFilter] = useState<ClientStage | 'all'>('all');

  const handleSort = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      setSortDir(k === 'client' ? 'asc' : 'desc');
    }
  };

  const sortedRows = useMemo(() => {
    const filtered = rows.filter(
      (r) => stageFilter === 'all' || r.stage === stageFilter,
    );

    const getSortValue = (r: ClientCycleRow): number | string => {
      switch (sortKey) {
        case 'client':
          return r.displayName.toLowerCase();
        case 'stage':
          return STAGE_ORDER[r.stage];
        case 'daysInStage':
          return r.daysInStage ?? -1;
        case 'daysSinceIntake':
          return r.daysSinceIntake;
        case 'questionnaire':
          return r.questionnaireDays ?? -1;
        case 'draft':
          return r.draftTurnaroundDays ?? -1;
        case 'review':
          return r.avgReviewDays ?? -1;
        case 'signing':
          return r.avgSigningDays ?? -1;
        case 'fullCycle':
          return r.fullCycleDays ?? -1;
      }
    };

    return [...filtered].sort((a, b) => {
      const av = getSortValue(a);
      const bv = getSortValue(b);
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = av as number;
      const bn = bv as number;
      return sortDir === 'asc' ? an - bn : bn - an;
    });
  }, [rows, sortKey, sortDir, stageFilter]);

  const stageCounts = useMemo(() => {
    const counts: Record<ClientStage, number> = {
      not_started: 0,
      questionnaire: 0,
      drafting: 0,
      review: 0,
      signing: 0,
      complete: 0,
    };
    for (const r of rows) counts[r.stage]++;
    return counts;
  }, [rows]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#1a365d]">
            <Timer className="h-5 w-5 text-[#2b6cb0]" />
            Turnaround Breakdown
          </DialogTitle>
          <DialogDescription>
            Per-client cycle times across the pipeline. Click a column header to sort.
          </DialogDescription>
        </DialogHeader>

        {/* Median strip */}
        <div className="grid grid-cols-5 gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          {[
            { label: 'Questionnaire', v: medians.questionnaireDays, n: medians.samples.questionnaire },
            { label: 'Draft Turnaround', v: medians.draftTurnaroundDays, n: medians.samples.draft },
            { label: 'Review', v: medians.reviewTurnaroundDays, n: medians.samples.review },
            { label: 'Signing Lag', v: medians.signingLagDays, n: medians.samples.signing },
            { label: 'Full Cycle', v: medians.fullCycleDays, n: medians.samples.fullCycle },
          ].map((m) => (
            <div key={m.label} className="flex flex-col">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                {m.label}
              </span>
              <span className="mt-0.5 text-lg font-bold text-[#1a365d] tabular-nums">
                {formatDays(m.v)}
              </span>
              <span className="text-[10px] text-gray-400">median · n={m.n}</span>
            </div>
          ))}
        </div>

        {/* Stage filter chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setStageFilter('all')}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs font-semibold',
              stageFilter === 'all'
                ? 'bg-[#1a365d] text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200',
            )}
          >
            All ({rows.length})
          </button>
          {(Object.keys(STAGE_LABELS) as ClientStage[]).map((s) => (
            <button
              key={s}
              onClick={() => setStageFilter(s)}
              disabled={stageCounts[s] === 0}
              className={cn(
                'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                stageFilter === s
                  ? 'bg-[#1a365d] text-white'
                  : `${STAGE_COLORS[s]} hover:opacity-80`,
                stageCounts[s] === 0 && 'opacity-40',
              )}
            >
              {STAGE_LABELS[s]} ({stageCounts[s]})
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto rounded-md border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <SortHeader label="Client" sortKey="client" activeKey={sortKey} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Stage" sortKey="stage" activeKey={sortKey} dir={sortDir} onClick={handleSort} />
                <SortHeader label="Days in Stage" sortKey="daysInStage" activeKey={sortKey} dir={sortDir} onClick={handleSort} align="right" />
                <SortHeader label="Since Intake" sortKey="daysSinceIntake" activeKey={sortKey} dir={sortDir} onClick={handleSort} align="right" />
                <SortHeader label="Q Dur" sortKey="questionnaire" activeKey={sortKey} dir={sortDir} onClick={handleSort} align="right" />
                <SortHeader label="Draft" sortKey="draft" activeKey={sortKey} dir={sortDir} onClick={handleSort} align="right" />
                <SortHeader label="Review" sortKey="review" activeKey={sortKey} dir={sortDir} onClick={handleSort} align="right" />
                <SortHeader label="Signing" sortKey="signing" activeKey={sortKey} dir={sortDir} onClick={handleSort} align="right" />
                <SortHeader label="Full Cycle" sortKey="fullCycle" activeKey={sortKey} dir={sortDir} onClick={handleSort} align="right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-sm text-gray-400">
                    No clients match this filter.
                  </td>
                </tr>
              ) : (
                sortedRows.map((r) => (
                  <tr key={r.clientId} className="hover:bg-gray-50">
                    <td className="px-2 py-1.5 font-medium text-[#1a365d]">
                      {r.displayName}
                    </td>
                    <td className="px-2 py-1.5">
                      <span
                        className={cn(
                          'inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold',
                          STAGE_COLORS[r.stage],
                        )}
                      >
                        {STAGE_LABELS[r.stage]}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">
                      {formatDays(r.daysInStage)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">
                      {formatDays(r.daysSinceIntake)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">
                      {formatDays(r.questionnaireDays)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">
                      {formatDays(r.draftTurnaroundDays)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">
                      {formatDays(r.avgReviewDays)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">
                      {formatDays(r.avgSigningDays)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">
                      {formatDays(r.fullCycleDays)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <p className="border-t border-gray-100 pt-2 text-[11px] italic text-gray-400">
          Days in each stage reflect elapsed time since the client entered it. Per-client metrics only populate after the relevant timestamps exist (e.g. Full Cycle requires every document signed).
        </p>
      </DialogContent>
    </Dialog>
  );
}
