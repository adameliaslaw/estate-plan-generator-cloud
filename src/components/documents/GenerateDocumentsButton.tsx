/**
 * GenerateDocumentsButton.tsx
 *
 * Prominent "Generate Documents" button that walks the attorney through a
 * confirmation dialog, then shows real-time progress while the Cloud Function
 * runs, and surfaces success/error states when complete.
 *
 * Props:
 *   firmId       — Firestore firm ID
 *   clientId     — Firestore client ID
 *   packageType  — 'foundation' | 'guardian' | 'fortress'
 *   trustTypes   — optional array of trust type strings (Fortress package)
 *   clientName   — full client display name (for confirmation dialog)
 *   disabled     — external disable flag (e.g. questionnaire incomplete)
 *   onSuccess    — callback after successful generation
 */

import { useState } from 'react';
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
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  FileText,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { documentService, type GenerateDocumentsResponse } from '@/services/document-service';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { logSystemActivity } from '@/utils/activity-logger';
import type { GenerationMode } from '@/services/knowledge-base-service';
import { SOFTWARE_SOURCES, getSoftwareSourceLabel } from '@/config/software-sources';

// ── Package display helpers ───────────────────────────────────────────────────

const PACKAGE_LABELS: Record<string, string> = {
  foundation: 'Basic Estate Plan',
  guardian: 'Revocable Trust',
  fortress: 'Irrevocable Trust',
};

const PACKAGE_BADGE: Record<string, string> = {
  foundation: 'bg-slate-100 text-slate-700',
  guardian: 'bg-blue-100 text-blue-700',
  fortress: 'bg-indigo-100 text-indigo-700',
};

// Ordered list of documents per package — shown in progress indicator
const PACKAGE_DOCS: Record<string, string[]> = {
  foundation: [
    'Last Will and Testament',
    'Durable Power of Attorney',
    'Advance Health Care Directive',
    'Engagement Letter',
    'Cover Letter',
  ],
  guardian: [
    'Last Will and Testament',
    'Durable Power of Attorney',
    'Advance Health Care Directive',
    'Estate Plan Summary',
    'Action Steps Checklist',
    'Engagement Letter',
    'Cover Letter',
  ],
  fortress: [
    'Revocable Living Trust',
    'Pour-Over Will',
    'Durable Power of Attorney',
    'Advance Health Care Directive',
    'Deed of Transfer',
    'Affidavit of Consideration',
    'GIT/REP-3 Form',
    'Estate Plan Summary',
    'Action Steps Checklist',
    'Engagement Letter',
    'Cover Letter',
    'Invoice / Fee Statement',
  ],
};

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'confirming' | 'generating' | 'success' | 'error';

interface Props {
  firmId: string;
  clientId: string;
  packageType: 'foundation' | 'guardian' | 'fortress';
  trustTypes?: string[];
  clientName: string;
  disabled?: boolean;
  onSuccess?: (response: GenerateDocumentsResponse) => void;
  variant?: 'default' | 'compact';
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GenerateDocumentsButton({
  firmId,
  clientId,
  packageType,
  trustTypes,
  clientName,
  disabled = false,
  onSuccess,
  variant = 'default',
}: Props) {
  const { userProfile } = useAuth();
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [currentDoc, setCurrentDoc] = useState('');
  const [result, setResult] = useState<GenerateDocumentsResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [generationMode, setGenerationMode] = useState<GenerationMode>('template');
  const [softwareSource, setSoftwareSource] = useState('');

  const packageLabel = PACKAGE_LABELS[packageType] ?? packageType;
  const packageDocs = PACKAGE_DOCS[packageType] ?? [];

  // ── Simulate incremental progress while Cloud Function runs ────────────────
  const startProgressSimulation = () => {
    let step = 0;
    const interval = setInterval(() => {
      step += 1;
      const pct = Math.min(Math.round((step / packageDocs.length) * 90), 90);
      setProgress(pct);
      if (step < packageDocs.length) {
        setCurrentDoc(packageDocs[step - 1] ?? '');
      }
    }, 1800);
    return () => clearInterval(interval);
  };

  // ── Handle generate ────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    setPhase('generating');
    setProgress(5);
    setCurrentDoc(packageDocs[0] ?? 'Documents');

    const stopProgress = startProgressSimulation();

    try {
      const response = await documentService.generateAll({
        firmId,
        clientId,
        packageType,
        trustTypes,
        generationMode,
        ...(softwareSource ? { softwareSource } : {}),
      });

      await logSystemActivity(firmId, userProfile, 'drafting documents', {
        clientName,
        packageType,
      });

      stopProgress();
      setProgress(100);
      setCurrentDoc('');
      setResult(response);
      setPhase('success');
      onSuccess?.(response);
    } catch (err: unknown) {
      stopProgress();
      setErrorMessage(
        err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.',
      );
      setPhase('error');
    }
  };

  // ── Reset ──────────────────────────────────────────────────────────────────
  const reset = () => {
    setPhase('idle');
    setProgress(0);
    setCurrentDoc('');
    setResult(null);
    setErrorMessage('');
  };

  // ── Render trigger button ──────────────────────────────────────────────────
  const triggerButton =
    variant === 'compact' ? (
      <Button
        onClick={() => setPhase('confirming')}
        disabled={disabled}
        size="sm"
        className="gap-1.5 bg-[#1a365d] hover:bg-[#1e407a] text-white"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Generate
      </Button>
    ) : (
      <button
        onClick={() => setPhase('confirming')}
        disabled={disabled}
        className={cn(
          'group relative flex w-full items-center justify-center gap-3 rounded-xl px-6 py-4',
          'bg-gradient-to-r from-[#1a365d] to-[#2b6cb0] text-white shadow-md',
          'text-base font-semibold transition-all duration-200',
          'hover:shadow-lg hover:from-[#1e407a] hover:to-[#3182ce]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b6cb0] focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
        )}
      >
        <Sparkles className="h-5 w-5 transition-transform group-hover:scale-110" />
        Generate {packageLabel} Documents
        <span className="ml-auto rounded-lg bg-white/20 px-2 py-0.5 text-xs font-medium">
          {packageDocs.length} docs
        </span>
      </button>
    );

  return (
    <>
      {triggerButton}

      {/* ── Confirmation dialog ────────────────────────────────────────────── */}
      <Dialog open={phase === 'confirming'} onOpenChange={(o) => !o && reset()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#1a365d]">
              <FileText className="h-5 w-5" />
              Generate Estate Plan Documents
            </DialogTitle>
            <DialogDescription>
              This will use AI to draft all documents for this client. You will be able to review
              and edit each document before finalizing.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Client info */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                    Client
                  </p>
                  <p className="mt-0.5 text-base font-semibold text-[#1a365d]">{clientName}</p>
                </div>
                <span
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                    PACKAGE_BADGE[packageType],
                  )}
                >
                  {packageLabel}
                </span>
              </div>
            </div>

            {/* Document list preview */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Documents to be generated ({packageDocs.length})
              </p>
              <ul className="space-y-1">
                {packageDocs.map((doc) => (
                  <li key={doc} className="flex items-center gap-2 text-sm text-gray-700">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    {doc}
                  </li>
                ))}
                {trustTypes && trustTypes.length > 0 && (
                  <li className="flex items-center gap-2 text-sm text-gray-500 italic">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    + {trustTypes.length} trust agreement{trustTypes.length > 1 ? 's' : ''}
                  </li>
                )}
              </ul>
            </div>

            {/* Generation Mode Selector */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Generation Mode
              </p>
              <div className="space-y-2">
                {[
                  { value: 'template' as GenerationMode, label: 'Template', desc: 'Fast, consistent. Uses your uploaded templates with client data.', badge: 'Recommended' },
                  { value: 'ai' as GenerationMode, label: 'AI', desc: 'Full AI generation from scratch (current behavior).', badge: '' },
                  { value: 'hybrid' as GenerationMode, label: 'Hybrid', desc: 'Template base, enhanced by AI using Knowledge Base resources.', badge: '' },
                ].map((mode) => (
                  <label
                    key={mode.value}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                      generationMode === mode.value
                        ? 'border-[#2b6cb0] bg-blue-50/50'
                        : 'border-gray-200 hover:bg-gray-50',
                    )}
                  >
                    <input
                      type="radio"
                      name="generationMode"
                      value={mode.value}
                      checked={generationMode === mode.value}
                      onChange={() => setGenerationMode(mode.value)}
                      className="mt-0.5 text-[#2b6cb0] focus:ring-[#2b6cb0]"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{mode.label}</span>
                        {mode.badge && (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                            {mode.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">{mode.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Software Source Selector */}
            {generationMode !== 'ai' && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Template Source
                </p>
                <select
                  title="Software Source"
                  value={softwareSource}
                  onChange={(e) => setSoftwareSource(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#2b6cb0] focus:outline-none"
                >
                  {SOFTWARE_SOURCES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                {softwareSource && (
                  <p className="mt-1 text-[10px] text-gray-400">
                    Templates from {getSoftwareSourceLabel(softwareSource)} will be used. Falls back to any available template if none match.
                  </p>
                )}
              </div>
            )}

            <Alert className="border-amber-200 bg-amber-50">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-xs text-amber-800">
                All generated documents are drafts. Attorney review and approval are required before
                documents can be finalized or exported.
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={reset}>
              Cancel
            </Button>
            <Button
              onClick={handleGenerate}
              className="bg-[#1a365d] hover:bg-[#1e407a] text-white"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Generate Documents
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Generating progress dialog ─────────────────────────────────────── */}
      <Dialog open={phase === 'generating'}>
        <DialogContent className="sm:max-w-md [&>button]:hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[#1a365d]">
              <Loader2 className="h-5 w-5 animate-spin" />
              Generating Documents…
            </DialogTitle>
            <DialogDescription>
              This may take a few minutes. Please do not close this window.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <Progress value={progress} className="h-2" />

            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>{currentDoc ? `Drafting: ${currentDoc}` : 'Finalizing…'}</span>
              <span>{progress}%</span>
            </div>

            {/* Progress steps */}
            <div className="space-y-1.5">
              {packageDocs.map((doc, i) => {
                const stepPct = Math.round((i / packageDocs.length) * 90);
                const isDone = progress > stepPct + 10;
                const isActive = progress > stepPct && !isDone;
                return (
                  <div key={doc} className="flex items-center gap-2.5 text-sm">
                    {isDone ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    ) : isActive ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#2b6cb0]" />
                    ) : (
                      <div className="h-4 w-4 shrink-0 rounded-full border-2 border-gray-200" />
                    )}
                    <span
                      className={cn(
                        isDone && 'text-gray-400 line-through',
                        isActive && 'font-medium text-[#1a365d]',
                        !isDone && !isActive && 'text-gray-400',
                      )}
                    >
                      {doc}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Success dialog ────────────────────────────────────────────────── */}
      <Dialog open={phase === 'success'} onOpenChange={(o) => !o && reset()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
              Documents Generated
            </DialogTitle>
            <DialogDescription>
              All documents have been drafted and are ready for attorney review.
            </DialogDescription>
          </DialogHeader>

          {result && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center">
                <p className="text-3xl font-bold text-emerald-700">{result.documentsGenerated}</p>
                <p className="mt-0.5 text-sm text-emerald-600">documents generated successfully</p>
              </div>

              <div className="space-y-1.5">
                {result.results.map((r) => (
                  <div
                    key={r.docType}
                    className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2 text-sm"
                  >
                    <span className="text-gray-700">{r.title}</span>
                    <Badge
                      variant="outline"
                      className="border-amber-200 bg-amber-50 text-amber-700 text-xs"
                    >
                      {r.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              onClick={reset}
              className="bg-[#1a365d] hover:bg-[#1e407a] text-white"
            >
              View Document Vault
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Error dialog ──────────────────────────────────────────────────── */}
      <Dialog open={phase === 'error'} onOpenChange={(o) => !o && reset()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <AlertCircle className="h-5 w-5" />
              Generation Failed
            </DialogTitle>
            <DialogDescription className="sr-only">
              Details about why document generation failed.
            </DialogDescription>
          </DialogHeader>

          <Alert className="border-red-200 bg-red-50">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-sm text-red-800">{errorMessage}</AlertDescription>
          </Alert>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={reset}>
              Close
            </Button>
            <Button
              onClick={() => setPhase('confirming')}
              className="gap-2 bg-[#1a365d] hover:bg-[#1e407a] text-white"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
