/**
 * PackageReviewPanel.tsx
 *
 * Renders the cross-document review of the last generated package, above the
 * document list in the Document Vault.
 *
 * The findings come from functions/src/package-review.ts, which runs at
 * generation time and writes them to `client.packageReview`. This component
 * only displays them — it never re-runs a check, so what an attorney sees here
 * is exactly what the pipeline recorded.
 *
 * Collapsed by default when the package is clean, so a coherent package costs
 * one line of vertical space; auto-expanded when anything is outstanding, so a
 * real finding is never a click away from being missed.
 */

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Info,
  ShieldAlert,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type {
  PackageFinding,
  PackageFindingReason,
  PackageFindingSeverity,
  PackageReview,
} from '@/types';

interface Props {
  review?: PackageReview;
  /** Doc-type → display label, so rows read the way the vault does. */
  docTypeLabels?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Presentation maps
// ---------------------------------------------------------------------------

const SEVERITY_STYLES: Record<
  PackageFindingSeverity,
  { label: string; badge: string; row: string; Icon: typeof AlertTriangle }
> = {
  high: {
    label: 'High',
    badge: 'bg-red-100 text-red-800 hover:bg-red-100',
    row: 'border-l-4 border-l-red-500',
    Icon: ShieldAlert,
  },
  medium: {
    label: 'Medium',
    badge: 'bg-amber-100 text-amber-900 hover:bg-amber-100',
    row: 'border-l-4 border-l-amber-500',
    Icon: AlertTriangle,
  },
  low: {
    label: 'Low',
    badge: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
    row: 'border-l-4 border-l-slate-300',
    Icon: Info,
  },
};

/**
 * Reason labels are written as the ACTION the attorney takes, not as the name
 * of the check that fired. "Verify against statute" tells them what to do;
 * "statutory-limit" makes them decode a taxonomy first.
 */
const REASON_LABELS: Record<PackageFindingReason, string> = {
  'blank-field': 'Missing information',
  'unresolved-token': 'Generation defect',
  'missing-instrument': 'Document not in package',
  'enclosure-mismatch': 'Enclosure list mismatch',
  'statutory-limit': 'Verify against statute',
  'inoperative-provision': 'No operative effect',
  'name-collision': 'Two people, one name',
  'suffix-dropped': 'Name inconsistency',
};

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function FindingRow({
  finding,
  docTypeLabels,
}: {
  finding: PackageFinding;
  docTypeLabels?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const style = SEVERITY_STYLES[finding.severity] ?? SEVERITY_STYLES.low;
  const docLabel = finding.title || docTypeLabels?.[finding.docType] || finding.docType;

  return (
    <li className={cn('bg-white', style.row)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
      >
        <style.Icon
          className={cn(
            'mt-0.5 h-4 w-4 shrink-0',
            finding.severity === 'high' && 'text-red-600',
            finding.severity === 'medium' && 'text-amber-600',
            finding.severity === 'low' && 'text-slate-400',
          )}
          aria-hidden
        />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">{finding.summary}</p>
          <p className="mt-0.5 truncate text-xs text-gray-500">
            {docLabel}
            <span className="mx-1.5 text-gray-300">·</span>
            {finding.location}
            <span className="mx-1.5 text-gray-300">·</span>
            {REASON_LABELS[finding.reason] ?? finding.reason}
          </p>
        </div>

        <Badge variant="secondary" className={cn('shrink-0 text-xs', style.badge)}>
          {style.label}
        </Badge>

        {open ? (
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        ) : (
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        )}
      </button>

      {open && (
        <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-3 pl-11">
          <p className="text-sm leading-relaxed text-gray-700">{finding.detail}</p>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export default function PackageReviewPanel({ review, docTypeLabels }: Props) {
  // Clients whose documents predate the review pass have no record at all.
  // Showing "0 findings" there would be a lie — nothing was ever checked — so
  // the panel renders nothing instead.
  const hasFindings = (review?.findings?.length ?? 0) > 0;
  const [expanded, setExpanded] = useState(hasFindings);

  if (!review) return null;

  const { summary, findings, truncated } = review;
  const clean = summary.total === 0;

  return (
    <section
      className={cn(
        'overflow-hidden rounded-lg border',
        clean ? 'border-green-200 bg-green-50/50' : 'border-gray-200 bg-white',
      )}
      aria-label="Package review"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        disabled={clean}
        className={cn(
          'flex w-full items-center gap-3 px-4 py-3 text-left',
          !clean && 'transition-colors hover:bg-gray-50',
          clean && 'cursor-default',
        )}
      >
        {clean ? (
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" aria-hidden />
        ) : (
          <ShieldAlert className="h-5 w-5 shrink-0 text-gray-500" aria-hidden />
        )}

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900">
            {clean
              ? 'Package review passed'
              : `${summary.total} ${summary.total === 1 ? 'finding' : 'findings'} for review`}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {clean
              ? 'No cross-document issues found in the generated set.'
              : 'Automated cross-document review of the generated set. Review before sharing with your client.'}
          </p>
        </div>

        {!clean && (
          <div className="flex shrink-0 items-center gap-1.5">
            {summary.high > 0 && (
              <Badge variant="secondary" className={SEVERITY_STYLES.high.badge}>
                {summary.high} high
              </Badge>
            )}
            {summary.medium > 0 && (
              <Badge variant="secondary" className={SEVERITY_STYLES.medium.badge}>
                {summary.medium} medium
              </Badge>
            )}
            {summary.low > 0 && (
              <Badge variant="secondary" className={SEVERITY_STYLES.low.badge}>
                {summary.low} low
              </Badge>
            )}
          </div>
        )}

        {!clean &&
          (expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
          ))}
      </button>

      {!clean && expanded && (
        <>
          <ul className="divide-y divide-gray-100 border-t border-gray-200">
            {findings.map((f, i) => (
              <FindingRow
                key={`${f.docType}-${f.reason}-${f.location}-${i}`}
                finding={f}
                docTypeLabels={docTypeLabels}
              />
            ))}
          </ul>

          {/*
            A capped list that looks complete is worse than no list — say so
            plainly rather than letting the count and the rows disagree.
          */}
          {truncated && (
            <p className="border-t border-gray-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
              Showing the {findings.length} most severe of {summary.total} findings. Resolve
              these and regenerate to see the rest.
            </p>
          )}

          <div className="border-t border-gray-200 bg-gray-50 px-4 py-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-gray-600"
              onClick={() => setExpanded(false)}
            >
              Collapse
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
