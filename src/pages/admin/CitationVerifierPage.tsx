/**
 * src/pages/admin/CitationVerifierPage.tsx
 *
 * Paste any AI-generated text; get a per-citation health report before filing.
 * Addresses grievance #1: hallucinated citations getting attorneys sanctioned.
 */

import { useState, useCallback } from 'react';
import { ShieldCheck, AlertTriangle, HelpCircle, ExternalLink, Loader2, Scale } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { verifyCitations, type CitationResult } from '@/services/citation-verifier-service';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: CitationResult['status'] }) {
  if (status === 'verified') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
        <ShieldCheck className="h-3 w-3" /> Verified
      </span>
    );
  }
  if (status === 'not_found') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-red-200">
        <AlertTriangle className="h-3 w-3" /> Not found
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
      <HelpCircle className="h-3 w-3" /> Check manually
    </span>
  );
}

function CitationCard({ result, rank }: { result: CitationResult; rank: number }) {
  return (
    <div
      className={cn(
        'rounded-xl border p-4 space-y-2 transition-colors',
        result.status === 'verified' && 'border-emerald-200 bg-emerald-50/30',
        result.status === 'not_found' && 'border-red-200 bg-red-50/30',
        result.status === 'error' && 'border-amber-200 bg-amber-50/30',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1a365d] text-[10px] font-bold text-white">
            {rank}
          </span>
          <code className="text-sm font-mono font-semibold text-gray-900 break-all">
            {result.raw}
          </code>
        </div>
        <StatusBadge status={result.status} />
      </div>

      {result.status === 'verified' && result.caseName && (
        <div className="pl-7 space-y-0.5">
          <p className="text-xs font-medium text-gray-800">{result.caseName}</p>
          <p className="text-[11px] text-gray-500">
            {[result.court, result.dateFiled?.slice(0, 4)].filter(Boolean).join(' · ')}
          </p>
          {result.url && (
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-[#2b6cb0] hover:underline"
            >
              View on CourtListener <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>
      )}

      {result.status === 'not_found' && (
        <p className="pl-7 text-[11px] text-red-600">
          No matching case found in CourtListener. This citation may be fabricated — verify before filing.
        </p>
      )}

      {result.status === 'error' && (
        <p className="pl-7 text-[11px] text-amber-700">
          Lookup failed. Verify this citation manually against Westlaw or Lexis.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary bar
// ---------------------------------------------------------------------------

function SummaryBar({ citations }: { citations: CitationResult[] }) {
  const verified = citations.filter((c) => c.status === 'verified').length;
  const notFound = citations.filter((c) => c.status === 'not_found').length;
  const errors = citations.filter((c) => c.status === 'error').length;
  const total = citations.length;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <span className="text-sm font-semibold text-gray-700">{total} citation{total !== 1 ? 's' : ''} found</span>
      <div className="h-4 w-px bg-gray-200" />
      <span className="text-sm text-emerald-700 font-medium">{verified} verified</span>
      {notFound > 0 && (
        <>
          <div className="h-4 w-px bg-gray-200" />
          <span className="text-sm text-red-700 font-semibold">{notFound} not found ⚠</span>
        </>
      )}
      {errors > 0 && (
        <>
          <div className="h-4 w-px bg-gray-200" />
          <span className="text-sm text-amber-700">{errors} check manually</span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CitationVerifierPage() {
  const { userProfile } = useAuth();
  const firmId = userProfile?.firmId ?? '';

  const [text, setText] = useState('');
  const [results, setResults] = useState<CitationResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleVerify = useCallback(async () => {
    if (!text.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const response = await verifyCitations(firmId, text);
      setResults(response.citations);
      if (response.citations.length === 0) {
        setError('No legal citations detected in the pasted text.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [text, firmId, loading]);

  const hasResults = results !== null && results.length > 0;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* ── Left panel — input ──────────────────────────────────────────────── */}
      <div className="flex flex-[6] flex-col min-h-0 border-r border-gray-200 bg-gray-50">
        {/* Header */}
        <div className="shrink-0 flex items-center gap-2.5 border-b border-gray-200 bg-white px-5 py-3.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1a365d]">
            <Scale className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-gray-900">Citation Verifier</h1>
            <p className="text-[11px] text-gray-500">Powered by CourtListener · Verify before you file</p>
          </div>
        </div>

        {/* Textarea */}
        <div className="flex flex-1 flex-col min-h-0 p-5 gap-4">
          <div className="flex-1 min-h-0">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`Paste AI-generated text here — briefs, memos, research output.\n\nThe verifier will extract every legal citation (e.g. 123 F.3d 456, 456 N.J. Super. 789) and check each one against CourtListener's case database.\n\nUnverified citations show a red "Not found" badge before you file.`}
              className="h-full w-full resize-none rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#2b6cb0] focus:outline-none focus:ring-1 focus:ring-[#2b6cb0]"
            />
          </div>

          <div className="shrink-0 flex items-center justify-between">
            <p className="text-xs text-gray-400">
              {text.length > 0 ? `${text.length.toLocaleString()} chars` : 'Max 50,000 characters'}
            </p>
            <button
              onClick={() => void handleVerify()}
              disabled={loading || !text.trim()}
              className={cn(
                'flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold transition-colors',
                loading || !text.trim()
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-[#1a365d] text-white hover:bg-[#2b6cb0]',
              )}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking…
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  Verify Citations
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Right panel — results ────────────────────────────────────────────── */}
      <div className="flex flex-[4] flex-col min-h-0 bg-white">
        <div className="shrink-0 flex items-center gap-2 border-b border-gray-200 px-4 py-3.5">
          <ShieldCheck className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-700">Citation Health Report</h2>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-3">
          {!hasResults && !error && !loading && (
            <div className="flex h-full flex-col items-center justify-center text-center px-6">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1a365d]/10">
                <ShieldCheck className="h-7 w-7 text-[#1a365d]" />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-gray-800">
                Verify before you file
              </h3>
              <p className="mt-1.5 max-w-xs text-xs text-gray-500">
                Paste AI-generated text on the left. Each citation is checked against CourtListener's database and tagged verified, not found, or check manually.
              </p>
              <div className="mt-5 flex flex-col gap-1.5 text-left w-full max-w-xs">
                {[
                  { label: 'Verified', color: 'bg-emerald-50 text-emerald-700', desc: 'Found in CourtListener' },
                  { label: 'Not found', color: 'bg-red-50 text-red-700', desc: 'Possible hallucination — check' },
                  { label: 'Check manually', color: 'bg-amber-50 text-amber-700', desc: 'Lookup failed, verify via Lexis/Westlaw' },
                ].map(({ label, color, desc }) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', color)}>{label}</span>
                    <span className="text-[11px] text-gray-500">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {hasResults && (
            <>
              <SummaryBar citations={results!} />
              {results!.map((r, i) => (
                <CitationCard key={r.raw} result={r} rank={i + 1} />
              ))}
              <p className="text-[10px] text-gray-400 text-center pt-1">
                Sourced from CourtListener. Always independently verify before filing.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
