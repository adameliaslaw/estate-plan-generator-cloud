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
 *   trustTypes   — optional array of trust type strings (Irrevocable Trust package)
 *   clientName   — full client display name (for confirmation dialog)
 *   disabled     — external disable flag (e.g. questionnaire incomplete)
 *   onSuccess    — callback after successful generation
 */

import { useState, useEffect } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  FileText,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { documentService, type GenerateDocumentsResponse } from '@/services/document-service';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { logSystemActivity } from '@/utils/activity-logger';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SOFTWARE_SOURCES } from '@/config/software-sources';
import { FORMATTING_PRESET_OPTIONS } from '@/config/formatting-presets';

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

// Definition for a doc within a package: human label + API docType + whether
// it's generated separately for client and spouse when married.
interface PackageDocDef {
  label: string;
  docType: string;
  perSpouse: boolean;
}

// Ordered list of documents per package — must match getDocumentsForPackage()
// in functions/src/generate-documents.ts.
const PACKAGE_DOC_DEFS: Record<string, PackageDocDef[]> = {
  foundation: [
    { label: 'Last Will and Testament',     docType: 'will',              perSpouse: true },
    { label: 'Durable Power of Attorney',   docType: 'poa',               perSpouse: true },
    { label: 'Advance Health Care Directive', docType: 'livingWill',      perSpouse: true },
    { label: 'Estate Plan Summary',         docType: 'estatePlanSummary', perSpouse: false },
  ],
  guardian: [
    { label: 'Revocable Living Trust',      docType: 'trust',             perSpouse: false },
    { label: 'Pour-Over Will',              docType: 'pourOverWill',      perSpouse: true },
    { label: 'Durable Power of Attorney',   docType: 'poa',               perSpouse: true },
    { label: 'Advance Health Care Directive', docType: 'livingWill',      perSpouse: true },
    { label: 'Estate Plan Summary',         docType: 'estatePlanSummary', perSpouse: false },
  ],
  fortress: [
    { label: 'Revocable Living Trust',      docType: 'trust',             perSpouse: false },
    { label: 'Pour-Over Will',              docType: 'pourOverWill',      perSpouse: true },
    { label: 'Durable Power of Attorney',   docType: 'poa',               perSpouse: true },
    { label: 'Advance Health Care Directive', docType: 'livingWill',      perSpouse: true },
    { label: 'Deed of Transfer',            docType: 'deed',              perSpouse: false },
    { label: 'Affidavit of Consideration',  docType: 'affidavitOfConsideration', perSpouse: false },
    { label: 'GIT/REP-3 Form',              docType: 'gitRep3',           perSpouse: false },
    { label: 'Estate Plan Summary',         docType: 'estatePlanSummary', perSpouse: false },
  ],
};

// One row in the selectable list shown in the dialog.
interface SelectableDoc {
  /** Stable key for selection state (docType for non-spouse, docType:role for spouse). */
  key: string;
  label: string;
  docType: string;
  spouseRole: 'client' | 'spouse';
}

/** Expand a package definition into one selectable row per generated artifact. */
function getSelectableDocs(packageType: string, isMarried: boolean): SelectableDoc[] {
  const defs = PACKAGE_DOC_DEFS[packageType] ?? [];
  const out: SelectableDoc[] = [];
  for (const def of defs) {
    if (isMarried && def.perSpouse) {
      out.push({ key: `${def.docType}:client`, label: `${def.label} — Client`, docType: def.docType, spouseRole: 'client' });
      out.push({ key: `${def.docType}:spouse`, label: `${def.label} — Spouse`, docType: def.docType, spouseRole: 'spouse' });
    } else {
      out.push({ key: def.docType, label: def.label, docType: def.docType, spouseRole: 'client' });
    }
  }
  return out;
}

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
  /** When true, expands per-spouse doc types to show client + spouse entries */
  isMarried?: boolean;
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
  isMarried = false,
}: Props) {
  const { userProfile } = useAuth();
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [currentDoc, setCurrentDoc] = useState('');
  const [result, setResult] = useState<GenerateDocumentsResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [softwareSource, setSoftwareSource] = useState('interactivelegal');
  const [formattingPreset, setFormattingPreset] = useState('interactivelegal');
  const [generationMode, setGenerationMode] = useState('hybrid');

  const packageLabel = PACKAGE_LABELS[packageType] ?? packageType;
  const selectableDocs = getSelectableDocs(packageType, isMarried);
  const packageDocs = selectableDocs.map((d) => d.label);

  // Selection state — defaults to all docs selected. Re-initialized whenever
  // the package or marital status changes (e.g. user re-opens the dialog
  // after switching client).
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set(selectableDocs.map((d) => d.key)),
  );
  useEffect(() => {
    setSelectedKeys(new Set(selectableDocs.map((d) => d.key)));
    // Intentionally re-run only when packageType / isMarried change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packageType, isMarried]);

  const allSelected = selectedKeys.size === selectableDocs.length && selectableDocs.length > 0;
  const noneSelected = selectedKeys.size === 0;

  const toggleOne = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const selectAll = () => setSelectedKeys(new Set(selectableDocs.map((d) => d.key)));
  const clearAll = () => setSelectedKeys(new Set());

  // ── Simulate incremental progress while Cloud Function runs ────────────────
  const startProgressSimulation = (totalSteps: number, labels: string[]) => {
    let step = 0;
    const denom = Math.max(totalSteps, 1);
    const interval = setInterval(() => {
      step += 1;
      const pct = Math.min(Math.round((step / denom) * 90), 90);
      setProgress(pct);
      if (step <= labels.length) {
        setCurrentDoc(labels[step - 1] ?? '');
      }
    }, 1800);
    return () => clearInterval(interval);
  };

  // ── Handle generate ────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (noneSelected) return;

    setPhase('generating');
    setProgress(5);

    const selectedDocs = selectableDocs.filter((d) => selectedKeys.has(d.key));
    setCurrentDoc(selectedDocs[0]?.label ?? 'Documents');

    const stopProgress = startProgressSimulation(
      selectedDocs.length,
      selectedDocs.map((d) => d.label),
    );

    try {
      let response: GenerateDocumentsResponse;

      if (allSelected) {
        // Full package — single round trip via generateAll. The server-side
        // generator handles per-property doc expansion (deeds for fortress)
        // and any cross-doc context sharing.
        response = await documentService.generateAll({
          firmId,
          clientId,
          packageType,
          trustTypes,
          generationMode: generationMode as 'template' | 'ai' | 'hybrid',
          softwareSource: softwareSource === 'none' ? '' : softwareSource,
          formattingPreset: formattingPreset === 'none' ? '' : formattingPreset,
        });
      } else {
        // Subset — call generateSingleDocument once per selected doc. Per-
        // property docs (deed/affidavit/gitRep3) are generated against the
        // first property only when invoked this way; for full per-property
        // expansion the user should leave them all selected and route to
        // generateAll above.
        const docResults: GenerateDocumentsResponse['results'] = [];
        let successCount = 0;
        for (const sel of selectedDocs) {
          setCurrentDoc(sel.label);
          try {
            const single = await documentService.generateSingleDocument({
              firmId,
              clientId,
              docType: sel.docType,
              spouseRole: sel.spouseRole,
              generationMode: generationMode as 'template' | 'ai' | 'hybrid',
              softwareSource: softwareSource === 'none' ? '' : softwareSource,
              formattingPreset: formattingPreset === 'none' ? '' : formattingPreset,
            });
            docResults.push({
              docType: sel.docType,
              title: single.title,
              status: single.status,
            });
            if (single.status !== 'error') successCount += 1;
          } catch (innerErr) {
            console.error('[GenerateDocumentsButton] subset doc failed', sel.docType, innerErr);
            docResults.push({
              docType: sel.docType,
              title: sel.label,
              status: 'error',
            });
          }
        }
        response = {
          success: successCount === docResults.length,
          documentsGenerated: successCount,
          results: docResults,
        };
      }

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
              This will generate all estate plan documents for this client using your selected
              generation mode. Your formatting and legal standards will be maintained.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[65vh] space-y-3 overflow-y-auto py-2">
            {/* Client info */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
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

            {/* Document selection list */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Documents to generate ({selectedKeys.size} of {selectableDocs.length})
                </p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={selectAll}
                    disabled={allSelected}
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#2b6cb0] hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={clearAll}
                    disabled={noneSelected}
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <ul className={cn(
                'gap-x-4 gap-y-0.5',
                selectableDocs.length > 4 ? 'grid grid-cols-2' : 'space-y-1',
              )}>
                {selectableDocs.map((doc) => {
                  const checked = selectedKeys.has(doc.key);
                  return (
                    <li key={doc.key} className="flex items-center gap-2 py-0.5 text-[13px] leading-tight text-gray-700">
                      <Checkbox
                        id={`gen-doc-${doc.key}`}
                        checked={checked}
                        onCheckedChange={() => toggleOne(doc.key)}
                        className="h-3.5 w-3.5"
                      />
                      <label
                        htmlFor={`gen-doc-${doc.key}`}
                        className="flex cursor-pointer items-center gap-1.5"
                      >
                        <FileText className="h-3 w-3 shrink-0 text-gray-400" />
                        {doc.label}
                      </label>
                    </li>
                  );
                })}
                {trustTypes && trustTypes.length > 0 && (
                  <li className="flex items-center gap-1.5 pl-[22px] text-[13px] leading-tight text-gray-500 italic">
                    <FileText className="h-3 w-3 shrink-0 text-gray-400" />
                    + {trustTypes.length} trust agreement{trustTypes.length > 1 ? 's' : ''} (full package only)
                  </li>
                )}
              </ul>
            </div>

            {/* Source & Formatting Selectors */}
            <div className="grid grid-cols-2 gap-3 pb-2 pt-1">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Template Source
                </label>
                <Select value={softwareSource} onValueChange={setSoftwareSource}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select source" />
                  </SelectTrigger>
                  <SelectContent>
                    {SOFTWARE_SOURCES.map((s) => (
                      <SelectItem key={s.value} value={s.value || 'none'} className="text-xs">
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Formatting Style
                </label>
                <Select value={formattingPreset} onValueChange={setFormattingPreset}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select format" />
                  </SelectTrigger>
                  <SelectContent>
                    {FORMATTING_PRESET_OPTIONS.map((p) => (
                      <SelectItem key={p.value} value={p.value || 'none'} className="text-xs">
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5 col-span-2 mt-1 border-t border-gray-100 pt-3">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Generation Mode
                </label>
                <Select value={generationMode} onValueChange={setGenerationMode}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hybrid" className="text-xs text-[#1a365d] font-medium">Template: Enhanced (Hybrid) — Recommended</SelectItem>
                    <SelectItem value="template" className="text-xs">Template: Exact Fidelity</SelectItem>
                    <SelectItem value="ai" className="text-xs">AI Drafting (From Scratch)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[10px] text-gray-400">
                  Hybrid mode fills your template with client data then uses AI to enhance any unresolved fields.
                </p>
              </div>
            </div>

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
              disabled={noneSelected}
              className="bg-[#1a365d] hover:bg-[#1e407a] text-white"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {noneSelected
                ? 'Select at least one document'
                : allSelected
                ? 'Generate All Documents'
                : `Generate ${selectedKeys.size} Document${selectedKeys.size === 1 ? '' : 's'}`}
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
                    <div className="flex items-center gap-1.5">
                      {r._contextFailed && (
                        <span
                          className="flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5"
                          title="Client context unavailable — generated in AI-only mode. Review carefully."
                        >
                          <AlertTriangle className="h-3 w-3" />
                          AI only
                        </span>
                      )}
                      <Badge
                        variant="outline"
                        className="border-amber-200 bg-amber-50 text-amber-700 text-xs"
                      >
                        {r.status}
                      </Badge>
                    </div>
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
