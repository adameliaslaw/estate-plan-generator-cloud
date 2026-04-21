/**
 * TurnaroundTimesCard.tsx
 *
 * Dashboard card showing five median turnaround-time metrics with a
 * "View breakdown" button that opens a per-client drill-in.
 *
 * All computation happens in src/utils/turnaround-stats.ts; this component
 * is presentational.
 */

import { useMemo, useState } from 'react';
import { Timer, ChevronRight } from 'lucide-react';
import type { Client, Document } from '@/types';
import {
  computeTurnaroundReport,
  formatDays,
  type TurnaroundMedians,
} from '@/utils/turnaround-stats';
import TurnaroundDetailsDialog from './TurnaroundDetailsDialog';

interface Props {
  clients: (Client & { id: string })[];
  documents: Document[];
  loading?: boolean;
}

interface MetricCellProps {
  label: string;
  value: string;
  sampleSize: number;
  subtitle: string;
}

function MetricCell({ label, value, sampleSize, subtitle }: MetricCellProps) {
  return (
    <div className="flex flex-1 flex-col">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        {label}
      </span>
      <span className="mt-0.5 text-xl font-bold text-[#1a365d] tabular-nums">
        {value}
      </span>
      <span className="text-[10px] text-gray-400">
        {sampleSize > 0 ? `median · n=${sampleSize}` : subtitle}
      </span>
    </div>
  );
}

export function TurnaroundTimesCard({ clients, documents, loading }: Props) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const { rows, medians } = useMemo(
    () => computeTurnaroundReport(clients, documents),
    [clients, documents],
  );

  if (loading) {
    return (
      <div className="h-28 animate-pulse rounded-xl border border-gray-200 bg-gray-50" />
    );
  }

  const metrics: Array<{
    key: keyof TurnaroundMedians['samples'];
    label: string;
    value: number | null;
    sampleSize: number;
  }> = [
    {
      key: 'questionnaire',
      label: 'Questionnaire',
      value: medians.questionnaireDays,
      sampleSize: medians.samples.questionnaire,
    },
    {
      key: 'draft',
      label: 'Draft Turnaround',
      value: medians.draftTurnaroundDays,
      sampleSize: medians.samples.draft,
    },
    {
      key: 'review',
      label: 'Review',
      value: medians.reviewTurnaroundDays,
      sampleSize: medians.samples.review,
    },
    {
      key: 'signing',
      label: 'Signing Lag',
      value: medians.signingLagDays,
      sampleSize: medians.samples.signing,
    },
    {
      key: 'fullCycle',
      label: 'Full Cycle',
      value: medians.fullCycleDays,
      sampleSize: medians.samples.fullCycle,
    },
  ];

  return (
    <>
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-[#ebf4ff] p-1.5">
              <Timer className="h-4 w-4 text-[#1a365d]" />
            </div>
            <h4 className="text-sm font-semibold text-[#1a365d]">Turnaround Times</h4>
            <span className="text-xs text-gray-400">
              medians across {rows.length} active clients
            </span>
          </div>
          <button
            onClick={() => setDetailsOpen(true)}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-0.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-[#1a365d] hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            View breakdown
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>

        <div className="flex gap-4 sm:gap-6">
          {metrics.map((m) => (
            <MetricCell
              key={m.key}
              label={m.label}
              value={formatDays(m.value)}
              sampleSize={m.sampleSize}
              subtitle="no data yet"
            />
          ))}
        </div>
      </div>

      {detailsOpen && (
        <TurnaroundDetailsDialog
          rows={rows}
          medians={medians}
          onClose={() => setDetailsOpen(false)}
        />
      )}
    </>
  );
}
