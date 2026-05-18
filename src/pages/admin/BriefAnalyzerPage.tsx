/**
 * src/pages/admin/BriefAnalyzerPage.tsx
 *
 * Upload opposing counsel's brief; get structured opposition prep:
 * arguments, weaknesses, citation health, talking points.
 * Addresses grievance #9: AI slop briefs create unpaid work for litigators.
 */

import { useState, useRef, useCallback } from 'react';
import {
  Swords,
  Upload,
  FileText,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  HelpCircle,
  ExternalLink,
  Target,
  ListChecks,
  MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import {
  analyzeBrief,
  type BriefAnalysisResult,
} from '@/services/brief-analyzer-service';
import type { CitationResult } from '@/services/citation-verifier-service';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CitationRow({ result }: { result: CitationResult }) {
  const badge =
    result.status === 'verified' ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200 shrink-0">
        <ShieldCheck className="h-2.5 w-2.5" /> Verified
      </span>
    ) : result.status === 'not_found' ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-200 shrink-0">
        <AlertTriangle className="h-2.5 w-2.5" /> Not found
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200 shrink-0">
        <HelpCircle className="h-2.5 w-2.5" /> Check
      </span>
    );

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2">
      <div className="min-w-0 flex-1">
        <code className="block truncate text-[11px] font-mono text-gray-700">{result.raw}</code>
        {result.status === 'verified' && result.caseName && (
          <p className="truncate text-[10px] text-gray-500 mt-0.5">{result.caseName}</p>
        )}
        {result.status === 'verified' && result.url && (
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-[#2b6cb0] hover:underline mt-0.5"
          >
            View on CourtListener <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
      {badge}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-[#1a365d]" />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700">{title}</h3>
        {count != null && (
          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function BriefAnalyzerPage() {
  const { userProfile } = useAuth();
  const firmId = userProfile?.firmId ?? '';

  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<BriefAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File | null) => {
    if (!f) return;
    if (f.type !== 'application/pdf') {
      setError('Only PDF files are supported.');
      return;
    }
    if (f.size > 15 * 1024 * 1024) {
      setError('File exceeds 15MB limit.');
      return;
    }
    setError(null);
    setResult(null);
    setFile(f);
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!file || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await analyzeBrief(firmId, file);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [file, firmId, loading]);

  const verifiedCount = result?.citations.filter((c) => c.status === 'verified').length ?? 0;
  const notFoundCount = result?.citations.filter((c) => c.status === 'not_found').length ?? 0;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* ── Left panel — upload ─────────────────────────────────────────────── */}
      <div className="flex flex-[4] flex-col min-h-0 border-r border-gray-200 bg-gray-50">
        <div className="shrink-0 flex items-center gap-2.5 border-b border-gray-200 bg-white px-5 py-3.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1a365d]">
            <Swords className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-gray-900">Brief Analyzer</h1>
            <p className="text-[11px] text-gray-500">Opposition prep · Citation verification · Argument analysis</p>
          </div>
        </div>

        <div className="flex flex-1 flex-col min-h-0 p-5 gap-4">
          <button
            onClick={() => inputRef.current?.click()}
            className={cn(
              'flex-1 min-h-0 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed transition-colors p-8',
              file
                ? 'border-[#1a365d]/40 bg-[#1a365d]/5'
                : 'border-gray-300 bg-white hover:border-[#2b6cb0] hover:bg-blue-50/30',
            )}
          >
            {file ? (
              <>
                <FileText className="h-10 w-10 text-[#1a365d]" />
                <div className="text-center">
                  <p className="text-sm font-semibold text-gray-900">{file.name}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {(file.size / 1024 / 1024).toFixed(2)} MB · Click to replace
                  </p>
                </div>
              </>
            ) : (
              <>
                <Upload className="h-10 w-10 text-gray-400" />
                <div className="text-center">
                  <p className="text-sm font-semibold text-gray-700">Drop a brief here or click to upload</p>
                  <p className="text-[11px] text-gray-500 mt-1">PDF · max 15MB</p>
                </div>
              </>
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          <button
            onClick={() => void handleAnalyze()}
            disabled={!file || loading}
            className={cn(
              'shrink-0 flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors',
              !file || loading
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-[#1a365d] text-white hover:bg-[#2b6cb0]',
            )}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing… this may take a minute
              </>
            ) : (
              <>
                <Swords className="h-4 w-4" />
                Analyze Brief
              </>
            )}
          </button>

          <p className="text-[10px] text-gray-400 text-center">
            OCR via Gemini · arguments + weaknesses via AI · citations via CourtListener
          </p>
        </div>
      </div>

      {/* ── Right panel — report ─────────────────────────────────────────────── */}
      <div className="flex flex-[6] flex-col min-h-0 bg-white">
        <div className="shrink-0 flex items-center gap-2 border-b border-gray-200 px-4 py-3.5">
          <Target className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-700">Opposition Prep Report</h2>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-5 space-y-5">
          {!result && !loading && (
            <div className="flex h-full flex-col items-center justify-center text-center px-6">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1a365d]/10">
                <Swords className="h-7 w-7 text-[#1a365d]" />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-gray-800">Upload an opposing brief</h3>
              <p className="mt-1.5 max-w-xs text-xs text-gray-500">
                We'll extract the main arguments, flag weaknesses, verify every citation against
                CourtListener, and surface concrete talking points for your response.
              </p>
            </div>
          )}

          {loading && (
            <div className="flex h-full flex-col items-center justify-center text-center px-6">
              <Loader2 className="h-10 w-10 animate-spin text-[#1a365d]" />
              <p className="mt-4 text-sm font-medium text-gray-700">Analyzing the brief…</p>
              <p className="mt-1 text-[11px] text-gray-500">OCR → argument extraction → citation verification</p>
            </div>
          )}

          {result && (
            <>
              {/* Summary */}
              <div className="rounded-xl border border-[#1a365d]/20 bg-[#1a365d]/5 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#1a365d]">
                  Brief summary
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-gray-800">{result.summary}</p>
              </div>

              {/* Citation health */}
              <Section icon={ShieldCheck} title="Citation Health" count={result.citations.length}>
                {result.citations.length === 0 ? (
                  <p className="text-xs text-gray-500">No legal citations detected.</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 px-3 py-2 text-xs">
                      <span className="text-emerald-700 font-medium">{verifiedCount} verified</span>
                      {notFoundCount > 0 && (
                        <span className="text-red-700 font-semibold">{notFoundCount} not found ⚠</span>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {result.citations.map((c, i) => (
                        <CitationRow key={i} result={c} />
                      ))}
                    </div>
                  </>
                )}
              </Section>

              {/* Arguments */}
              <Section icon={ListChecks} title="Main Arguments" count={result.arguments.length}>
                <ol className="space-y-2.5">
                  {result.arguments.map((arg, i) => (
                    <li key={i} className="rounded-lg border border-gray-100 bg-white p-3 shadow-sm">
                      <div className="flex items-start gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1a365d] text-[10px] font-bold text-white">
                          {i + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-gray-900">{arg.title}</p>
                          <p className="mt-1 text-xs text-gray-600 leading-relaxed">{arg.summary}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </Section>

              {/* Weaknesses */}
              <Section icon={AlertTriangle} title="Weaknesses Flagged" count={result.weaknesses.length}>
                <ul className="space-y-1.5">
                  {result.weaknesses.map((w, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50/40 px-3 py-2 text-xs text-gray-800"
                    >
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-red-600" />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </Section>

              {/* Talking points */}
              <Section icon={MessageSquare} title="Talking Points" count={result.talkingPoints.length}>
                <ul className="space-y-1.5">
                  {result.talkingPoints.map((p, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50/40 px-3 py-2 text-xs text-gray-800"
                    >
                      <MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </Section>

              <p className="text-[10px] text-gray-400 text-center pt-1">
                Analyzed {result.fileName} · {new Date(result.analyzedAt).toLocaleString()} · Always verify independently before filing.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
