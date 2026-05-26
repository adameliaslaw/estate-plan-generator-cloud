/**
 * DocumentReviewDialog.tsx
 *
 * Shows the AI review results after calling the reviewDocument Cloud Function.
 * Displays:
 *   - Overall assessment
 *   - Issues table (severity badge, location, description, suggestion)
 *   - Suggestions list
 *   - NJ Compliance notes list
 *
 * Props:
 *   open          — controlled open state
 *   onClose       — dismiss callback
 *   documentName  — display name shown in dialog header
 *   loading       — true while the Cloud Function call is in flight
 *   result        — the ReviewDocumentResponse (null while loading)
 *   error         — error message if the call failed
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Info,
  AlertCircle,
  ShieldCheck,
  Lightbulb,
  DollarSign,
  Clock,
} from 'lucide-react';
import { type ReviewDocumentResponse, type ReviewIssue } from '@/services/document-service';
import { cn } from '@/lib/utils';

// ── Severity helpers ──────────────────────────────────────────────────────────

type Severity = ReviewIssue['severity'];

const SEVERITY_CONFIG: Record<
  Severity,
  { label: string; icon: React.ComponentType<{ className?: string }>; classes: string }
> = {
  critical: {
    label: 'Critical',
    icon: AlertCircle,
    classes: 'bg-red-100 text-red-800 ring-red-200',
  },
  major: {
    label: 'Major',
    icon: AlertTriangle,
    classes: 'bg-orange-100 text-orange-800 ring-orange-200',
  },
  minor: {
    label: 'Minor',
    icon: Info,
    classes: 'bg-amber-100 text-amber-800 ring-amber-200',
  },
  info: {
    label: 'Info',
    icon: Info,
    classes: 'bg-blue-100 text-blue-800 ring-blue-200',
  },
};

function SeverityBadge({ severity }: { severity: Severity }) {
  const cfg = SEVERITY_CONFIG[severity];
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
        cfg.classes,
      )}
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

// ── Overall assessment sentiment ──────────────────────────────────────────────

function getAssessmentColor(issues: ReviewIssue[]) {
  if (issues.some((i) => i.severity === 'critical')) return 'text-red-700 bg-red-50 border-red-200';
  if (issues.some((i) => i.severity === 'major')) return 'text-orange-700 bg-orange-50 border-orange-200';
  if (issues.some((i) => i.severity === 'minor')) return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-emerald-700 bg-emerald-50 border-emerald-200';
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function ReviewSkeleton() {
  return (
    <div className="space-y-5 py-2">
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  documentName: string;
  loading: boolean;
  result: ReviewDocumentResponse | null;
  error?: string;
}

export default function DocumentReviewDialog({
  open,
  onClose,
  documentName,
  loading,
  result,
  error,
}: Props) {
  const criticalCount = result?.issues.filter((i) => i.severity === 'critical').length ?? 0;
  const majorCount = result?.issues.filter((i) => i.severity === 'major').length ?? 0;
  const minorCount = result?.issues.filter((i) => i.severity === 'minor').length ?? 0;
  const infoCount = result?.issues.filter((i) => i.severity === 'info').length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#1a365d]">
            <Sparkles className="h-5 w-5 text-[#2b6cb0]" />
            AI Document Review
          </DialogTitle>
          <DialogDescription>
            Automated legal review of <span className="font-medium">{documentName}</span>.
            This is an AI-generated analysis — attorney judgment is required before finalizing.
          </DialogDescription>
        </DialogHeader>

        {loading && <ReviewSkeleton />}

        {error && !loading && (
          <Alert className="border-red-200 bg-red-50 mt-2">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-sm text-red-800">{error}</AlertDescription>
          </Alert>
        )}

        {result && !loading && (
          <div className="space-y-6 py-2">
            {/* Overall assessment */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Overall Assessment
              </p>
              <div
                className={cn(
                  'rounded-lg border p-4 text-sm leading-relaxed',
                  getAssessmentColor(result.issues),
                )}
              >
                {result.overallAssessment}
              </div>
            </div>

            {/* Billable value */}
            {result.billableValue && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
                <div className="mb-3 flex items-center gap-1.5">
                  <DollarSign className="h-4 w-4 text-emerald-700" />
                  <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
                    Billable Value
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-emerald-700">
                      <Sparkles className="h-3 w-3" /> AI review
                    </p>
                    <p className="mt-0.5 text-lg font-semibold text-emerald-900">
                      {result.billableValue.aiSeconds}s
                    </p>
                  </div>
                  <div>
                    <p className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-emerald-700">
                      <Clock className="h-3 w-3" /> Manual equiv.
                    </p>
                    <p className="mt-0.5 text-lg font-semibold text-emerald-900">
                      ~{result.billableValue.manualMinutes} min
                    </p>
                  </div>
                  <div>
                    <p className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-emerald-700">
                      <DollarSign className="h-3 w-3" /> Suggested flat fee
                    </p>
                    <p className="mt-0.5 text-lg font-semibold text-emerald-900">
                      ${result.billableValue.suggestedFlatFee.toLocaleString()}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-[11px] italic text-emerald-700">
                  At ${result.billableValue.hourlyRate}/hr. Stop undercharging for work AI did in seconds.
                </p>
              </div>
            )}

            {/* Issue summary badges */}
            <div className="flex flex-wrap gap-2">
              {criticalCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-800 ring-1 ring-inset ring-red-200">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {criticalCount} Critical
                </span>
              )}
              {majorCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-800 ring-1 ring-inset ring-orange-200">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {majorCount} Major
                </span>
              )}
              {minorCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
                  <Info className="h-3.5 w-3.5" />
                  {minorCount} Minor
                </span>
              )}
              {infoCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800 ring-1 ring-inset ring-blue-200">
                  <Info className="h-3.5 w-3.5" />
                  {infoCount} Info
                </span>
              )}
              {result.issues.length === 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  No Issues Found
                </span>
              )}
            </div>

            {/* Issues table */}
            {result.issues.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Issues ({result.issues.length})
                </p>
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-100">
                    <thead className="bg-gray-50">
                      <tr>
                        {['Severity', 'Location', 'Description', 'Suggestion'].map((col) => (
                          <th
                            key={col}
                            className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {result.issues.map((issue, idx) => (
                        <tr
                          key={idx}
                          className={cn(
                            issue.severity === 'critical' && 'bg-red-50/40',
                            issue.severity === 'major' && 'bg-orange-50/40',
                          )}
                        >
                          <td className="px-4 py-3 align-top">
                            <SeverityBadge severity={issue.severity} />
                          </td>
                          <td className="px-4 py-3 align-top text-xs font-medium text-gray-600 whitespace-nowrap">
                            {issue.location}
                          </td>
                          <td className="px-4 py-3 align-top text-sm text-gray-700">
                            {issue.description}
                          </td>
                          <td className="px-4 py-3 align-top text-sm text-gray-500 italic">
                            {issue.suggestion}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Suggestions */}
            {result.suggestions.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <Lightbulb className="h-3.5 w-3.5" />
                  Suggestions
                </p>
                <ul className="space-y-2">
                  {result.suggestions.map((s, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 rounded-md bg-[#ebf4ff]/60 px-3 py-2.5 text-sm text-[#1a365d]"
                    >
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#2b6cb0] text-[10px] font-bold text-white">
                        {i + 1}
                      </span>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* NJ Compliance notes */}
            {result.complianceNotes.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  New Jersey Compliance Notes
                </p>
                <ul className="space-y-1.5">
                  {result.complianceNotes.map((note, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm text-gray-700"
                    >
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                      {note}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Reviewed at */}
            {result.reviewedAt && (
              <p className="text-right text-xs text-gray-400">
                AI review completed {new Date(result.reviewedAt).toLocaleString()}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="pt-2">
          <Button
            variant="outline"
            onClick={onClose}
            className="border-[#2b6cb0] text-[#2b6cb0] hover:bg-[#ebf4ff]"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
