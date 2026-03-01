/**
 * AiComplianceCheck.tsx
 *
 * Runs an AI-powered NJ statutory compliance review on a generated document.
 * Calls the `checkDocumentCompliance` Cloud Function and renders the results
 * as a list of findings with pass/warning/fail icons and statute references.
 *
 * Usage:
 *   <AiComplianceCheck
 *     firmId="abc"
 *     clientId="xyz"
 *     documentId="doc123"
 *     docType="will"
 *     documentTitle="Last Will and Testament"
 *   />
 */

import { useState, useCallback } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ShieldCheck,
  BookOpen,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FindingStatus = 'pass' | 'warning' | 'fail';
type OverallStatus = 'pass' | 'needs_review' | 'fail';

interface ComplianceFinding {
  item: string;
  status: FindingStatus;
  statute?: string;
  detail: string;
}

interface ComplianceResult {
  findings: ComplianceFinding[];
  overallStatus: OverallStatus;
  reviewedAt?: string;
}

interface CheckComplianceRequest {
  firmId: string;
  clientId: string;
  documentId: string;
}

interface CheckComplianceResponse {
  success: boolean;
  findings: ComplianceFinding[];
  overallStatus: OverallStatus;
  reviewedAt: string;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusIcon({ status }: { status: FindingStatus }) {
  if (status === 'pass') {
    return (
      <CheckCircle2
        className="h-4 w-4 flex-shrink-0 text-green-600"
        aria-label="Pass"
      />
    );
  }
  if (status === 'warning') {
    return (
      <AlertTriangle
        className="h-4 w-4 flex-shrink-0 text-amber-500"
        aria-label="Warning"
      />
    );
  }
  return (
    <XCircle
      className="h-4 w-4 flex-shrink-0 text-red-600"
      aria-label="Fail"
    />
  );
}

function OverallBadge({ status }: { status: OverallStatus }) {
  if (status === 'pass') {
    return (
      <Badge className="gap-1 bg-green-100 text-green-800 hover:bg-green-100 border-green-200">
        <CheckCircle2 className="h-3 w-3" />
        Compliant
      </Badge>
    );
  }
  if (status === 'needs_review') {
    return (
      <Badge className="gap-1 bg-amber-100 text-amber-800 hover:bg-amber-100 border-amber-200">
        <AlertTriangle className="h-3 w-3" />
        Needs Review
      </Badge>
    );
  }
  return (
    <Badge className="gap-1 bg-red-100 text-red-800 hover:bg-red-100 border-red-200">
      <XCircle className="h-3 w-3" />
      Issues Found
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface AiComplianceCheckProps {
  firmId: string;
  clientId: string;
  documentId: string;
  docType: string;
  documentTitle: string;
}

export default function AiComplianceCheck({
  firmId,
  clientId,
  documentId,
  documentTitle,
}: AiComplianceCheckProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ComplianceResult | null>(null);
  const [hasRun, setHasRun] = useState(false);

  const runCheck = useCallback(async () => {
    setLoading(true);
    try {
      const fn = httpsCallable<CheckComplianceRequest, CheckComplianceResponse>(
        functions,
        'checkDocumentCompliance',
      );
      const response = await fn({ firmId, clientId, documentId });
      const data = response.data;

      if (!data.success) {
        throw new Error('Compliance check returned an error.');
      }

      setResult({
        findings: data.findings,
        overallStatus: data.overallStatus,
        reviewedAt: data.reviewedAt,
      });
      setHasRun(true);

      // Toast based on overall status
      if (data.overallStatus === 'pass') {
        toast.success('Document passed all compliance checks.');
      } else if (data.overallStatus === 'needs_review') {
        toast.warning('Compliance check complete — review warnings before finalizing.');
      } else {
        toast.error('Compliance issues found — attorney review required.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Compliance check failed.';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [firmId, clientId, documentId]);

  // Counts
  const passCount = result?.findings.filter((f) => f.status === 'pass').length ?? 0;
  const warnCount = result?.findings.filter((f) => f.status === 'warning').length ?? 0;
  const failCount = result?.findings.filter((f) => f.status === 'fail').length ?? 0;

  return (
    <div className="rounded-lg border border-[#1a365d]/15 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b border-[#1a365d]/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#2b6cb0]" aria-hidden="true" />
          <span className="text-sm font-semibold text-[#1a365d]">AI Compliance Check</span>
          {result && <OverallBadge status={result.overallStatus} />}
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={runCheck}
          disabled={loading}
          className={cn(
            'gap-2 text-xs',
            'border-[#2b6cb0]/40 text-[#2b6cb0]',
            'hover:bg-[#ebf4ff] hover:border-[#2b6cb0]',
            'disabled:opacity-50',
          )}
        >
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking…
            </>
          ) : hasRun ? (
            <>
              <RefreshCw className="h-3.5 w-3.5" />
              Re-run Compliance Check
            </>
          ) : (
            <>
              <ShieldCheck className="h-3.5 w-3.5" />
              Run AI Compliance Check
            </>
          )}
        </Button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#2b6cb0]" />
          <p className="text-sm font-medium text-[#1a365d]">
            Reviewing "{documentTitle}" against NJ statutory requirements…
          </p>
          <p className="text-xs text-gray-400">
            This may take 10–20 seconds. Do not close this window.
          </p>
        </div>
      )}

      {/* Empty state — not yet run */}
      {!loading && !result && (
        <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
          <BookOpen className="h-8 w-8 text-[#1a365d]/20" aria-hidden="true" />
          <p className="text-sm text-gray-500">
            Run a compliance check to verify this document against New Jersey statutory
            requirements.
          </p>
          <p className="text-xs text-gray-400">
            Reviews Wills (N.J.S.A. 3B:3-2), POAs (N.J.S.A. 46:2B-8.9), Trusts, Advance
            Directives (N.J.S.A. 26:2H-55), and Deeds.
          </p>
        </div>
      )}

      {/* Results */}
      {!loading && result && (
        <div className="px-4 py-3">
          {/* Summary bar */}
          <div className="mb-3 flex items-center gap-4 rounded-md bg-gray-50 px-3 py-2 text-xs">
            <span className="font-medium text-gray-600">
              {result.findings.length} item
              {result.findings.length !== 1 ? 's' : ''} reviewed
            </span>
            {passCount > 0 && (
              <span className="flex items-center gap-1 text-green-700">
                <CheckCircle2 className="h-3 w-3" />
                {passCount} passed
              </span>
            )}
            {warnCount > 0 && (
              <span className="flex items-center gap-1 text-amber-600">
                <AlertTriangle className="h-3 w-3" />
                {warnCount} warning{warnCount !== 1 ? 's' : ''}
              </span>
            )}
            {failCount > 0 && (
              <span className="flex items-center gap-1 text-red-600">
                <XCircle className="h-3 w-3" />
                {failCount} failed
              </span>
            )}
            {result.reviewedAt && (
              <span className="ml-auto text-gray-400">
                Reviewed{' '}
                {new Date(result.reviewedAt).toLocaleString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
            )}
          </div>

          {/* Findings list */}
          <ul className="divide-y divide-gray-100" role="list" aria-label="Compliance findings">
            {result.findings.map((finding, idx) => (
              <li
                key={idx}
                className={cn(
                  'flex gap-3 py-2.5',
                  finding.status === 'fail' && 'bg-red-50/40 rounded',
                )}
              >
                <StatusIcon status={finding.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium text-[#1a365d]">
                      {finding.item}
                    </span>
                    {finding.statute && (
                      <span className="text-[11px] text-gray-400 font-mono">
                        {finding.statute}
                      </span>
                    )}
                  </div>
                  <p
                    className={cn(
                      'mt-0.5 text-xs leading-relaxed',
                      finding.status === 'pass' && 'text-gray-500',
                      finding.status === 'warning' && 'text-amber-700',
                      finding.status === 'fail' && 'text-red-700',
                    )}
                  >
                    {finding.detail}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          {/* Attorney disclaimer */}
          <p className="mt-3 rounded bg-[#ebf4ff] px-3 py-2 text-[11px] leading-snug text-[#1a365d]/60">
            <strong className="text-[#1a365d]">Note:</strong> This AI compliance review is an
            assistive tool only. It does not replace attorney review. All documents must be reviewed
            and approved by a licensed New Jersey attorney before execution.
          </p>
        </div>
      )}
    </div>
  );
}
