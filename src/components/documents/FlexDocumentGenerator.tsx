/**
 * FlexDocumentGenerator.tsx
 *
 * Dialog UI for generating additional / flexible documents beyond the core
 * package — engagement letters, cover letters, trust amendments, etc.
 *
 * Props:
 *   firmId      — Firestore firm ID
 *   clientId    — Firestore client ID
 *   open        — controlled open state
 *   onClose     — dismiss callback
 *   onSuccess   — called after successful generation with doc type + id
 */

import { useState, useEffect, useRef } from 'react';
import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
  Timestamp,
} from 'firebase/firestore';
import { COLLECTIONS } from '@/config/constants';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  FileText,
  Mail,
  Receipt,
  Scale,
  UserCheck,
  FilePen,
  RefreshCw,
  BookMarked,
  ListTodo,
  Pencil,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { documentService, type GenerateFlexDocumentResponse } from '@/services/document-service';
import { cn } from '@/lib/utils';

// ── Generation stage helpers ─────────────────────────────────────────────────

function getGenerationStage(elapsed: number): string {
  if (elapsed < 15) return 'Building context…';
  if (elapsed < 45) return 'Drafting with AI…';
  if (elapsed < 120) return 'Drafting with AI… (this typically takes 1–3 minutes)';
  if (elapsed < 180) return 'Reviewing and formatting…';
  return 'Finalizing… (almost there)';
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

// ── Flex document catalog ─────────────────────────────────────────────────────

interface FlexDocOption {
  docType: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  iconColor: string;
}

const FLEX_DOC_OPTIONS: FlexDocOption[] = [
  {
    docType: 'engagementLetter',
    label: 'Engagement Letter',
    description: 'Formal attorney-client engagement letter with scope, fees, and terms.',
    icon: Scale,
    iconBg: 'bg-[#ebf4ff]',
    iconColor: 'text-[#1a365d]',
  },
  {
    docType: 'coverLetter',
    label: 'Cover Letter',
    description: 'Transmittal letter accompanying the estate planning documents.',
    icon: Mail,
    iconBg: 'bg-[#ebf4ff]',
    iconColor: 'text-[#2b6cb0]',
  },
  {
    docType: 'invoice',
    label: 'Invoice / Fee Statement',
    description: 'Itemized invoice for legal services rendered.',
    icon: Receipt,
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-700',
  },
  {
    docType: 'certificationOfTrust',
    label: 'Certification of Trust',
    description: 'NJ certification of trust summary for third-party use (e.g. banks).',
    icon: BookMarked,
    iconBg: 'bg-purple-50',
    iconColor: 'text-purple-700',
  },
  {
    docType: 'beneficiaryDesignation',
    label: 'Beneficiary Designation Change Letter',
    description: 'Letter instructing financial institutions to update beneficiary designations.',
    icon: UserCheck,
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-700',
  },
  {
    docType: 'trustAmendment',
    label: 'Trust Amendment',
    description: 'Amendment to an existing revocable living trust.',
    icon: FilePen,
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-700',
  },
  {
    docType: 'trustRestatement',
    label: 'Trust Restatement',
    description: 'Full restatement of an existing trust, incorporating all prior amendments.',
    icon: RefreshCw,
    iconBg: 'bg-orange-50',
    iconColor: 'text-orange-700',
  },
  {
    docType: 'memorandumOfPersonalProp',
    label: 'Memorandum of Personal Property',
    description: 'Informal memo listing specific bequests of personal/tangible property.',
    icon: ListTodo,
    iconBg: 'bg-teal-50',
    iconColor: 'text-teal-700',
  },
  {
    docType: 'letterOfInstruction',
    label: 'Letter of Instruction',
    description: 'Non-binding letter to executor/trustee with practical guidance and wishes.',
    icon: FileText,
    iconBg: 'bg-indigo-50',
    iconColor: 'text-indigo-700',
  },
  {
    docType: 'custom',
    label: 'Custom Document',
    description: 'Generate any custom legal document using a free-form prompt.',
    icon: Pencil,
    iconBg: 'bg-gray-100',
    iconColor: 'text-gray-600',
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

type Phase = 'select' | 'configure' | 'generating' | 'success' | 'error';

interface Props {
  firmId: string;
  clientId: string;
  open: boolean;
  onClose: () => void;
  onSuccess?: (response: GenerateFlexDocumentResponse) => void;
}

export default function FlexDocumentGenerator({
  firmId,
  clientId,
  open,
  onClose,
  onSuccess,
}: Props) {
  const [phase, setPhase] = useState<Phase>('select');
  const [selected, setSelected] = useState<FlexDocOption | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [result, setResult] = useState<GenerateFlexDocumentResponse | null>(null);
  const [error, setError] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Guards against double-fire from both the httpsCallable promise and the
  // Firestore listener (whichever wins first).
  const succeededRef = useRef(false);

  useEffect(() => {
    // Deliberate synchronous reset: the elapsed timer restarts on every phase
    // change. The reset IS the effect's purpose, not derivable state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setElapsedSeconds(0);
    if (phase !== 'generating') return;
    succeededRef.current = false;
    const interval = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [phase]);

  const markSuccess = (response: GenerateFlexDocumentResponse) => {
    if (succeededRef.current) return;
    succeededRef.current = true;
    // The backend reports success:false / status:'error' when generation ran
    // but the vault save failed — route to the error phase instead of showing
    // "added to the Document Vault" for a document that wasn't saved.
    if (!response.success || response.status === 'error') {
      setError('The document was generated but could not be saved. Please try again.');
      setPhase('error');
      return;
    }
    setResult(response);
    setPhase('success');
    onSuccess?.(response);
  };

  // Firestore polling fallback: detects the saved doc even if the long-running
  // httpsCallable response is dropped silently by an intermediate proxy.
  useEffect(() => {
    if (phase !== 'generating' || !firmId || !clientId || !selected) return;
    const startMs = Timestamp.now().toMillis();
    // docType equality only (automatic single-field index); apply the
    // updatedAt >= start filter client-side to avoid a composite index.
    const q = query(
      collection(getFirestore(), COLLECTIONS.DOCUMENTS(firmId, clientId)),
      where('docType', '==', selected.docType),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const docSnap = snap.docs.find((d) => {
          const ts = d.data().updatedAt as Timestamp | undefined;
          return ts != null && ts.toMillis() >= startMs;
        });
        if (!docSnap) return;
        const data = docSnap.data();
        const status = (data.status as string) ?? 'draft';
        markSuccess({
          success: status !== 'error',
          docType: (data.docType as string) ?? selected.docType,
          title: (data.displayName as string) ?? (data.title as string) ?? selected.docType,
          documentId: docSnap.id,
          status,
        });
      },
      (err) => console.error('[FlexDocumentGenerator] poll listener error:', err),
    );
    return () => unsub();
  }, [phase, firmId, clientId, selected]);

  const handleSelect = (option: FlexDocOption) => {
    setSelected(option);
    setPhase('configure');
  };

  const handleGenerate = async () => {
    if (!selected) return;
    setPhase('generating');
    setError('');

    try {
      const response = await documentService.generateFlexDocument({
        firmId,
        clientId,
        docType: selected.docType,
        customPrompt: customPrompt.trim() || '',
      });
      markSuccess(response);
    } catch (err: unknown) {
      // If the Firestore listener already saw the saved doc, ignore the
      // late-arriving rejection.
      if (succeededRef.current) return;
      setError(
        err instanceof Error ? err.message : 'Generation failed. Please try again.',
      );
      setPhase('error');
    }
  };

  const reset = () => {
    setPhase('select');
    setSelected(null);
    setCustomPrompt('');
    setResult(null);
    setError('');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const isCustom = selected?.docType === 'custom';

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {/* ── Select phase ──────────────────────────────────────────────── */}
        {phase === 'select' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-[#1a365d]">
                <Sparkles className="h-5 w-5 text-[#2b6cb0]" />
                Generate Additional Document
              </DialogTitle>
              <DialogDescription>
                Select a document type to generate. All documents are drafts and require attorney
                review before use.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 gap-2 py-2 sm:grid-cols-2">
              {FLEX_DOC_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.docType}
                    onClick={() => handleSelect(option)}
                    className="group flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 text-left transition-all hover:border-[#2b6cb0]/50 hover:bg-[#ebf4ff]/40 hover:shadow-sm"
                  >
                    <div
                      className={cn(
                        'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                        option.iconBg,
                      )}
                    >
                      <Icon className={cn('h-4.5 w-4.5', option.iconColor)} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[#1a365d] group-hover:text-[#2b6cb0]">
                        {option.label}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500 leading-snug">
                        {option.description}
                      </p>
                    </div>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-gray-300 group-hover:text-[#2b6cb0]" />
                  </button>
                );
              })}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── Configure phase ───────────────────────────────────────────── */}
        {phase === 'configure' && selected && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-[#1a365d]">
                <selected.icon className={cn('h-5 w-5', selected.iconColor)} />
                {selected.label}
              </DialogTitle>
              <DialogDescription>{selected.description}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="customPrompt" className="text-sm font-medium text-gray-700">
                  {isCustom ? 'Document Instructions' : 'Custom Instructions'}
                  {!isCustom && (
                    <span className="ml-1 font-normal text-gray-400">(optional)</span>
                  )}
                </Label>
                <Textarea
                  id="customPrompt"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder={
                    isCustom
                      ? 'Describe the document you need in detail. Include the document type, parties, key provisions, and any specific NJ statutory requirements…'
                      : `Any specific instructions or modifications for this ${selected.label.toLowerCase()}…`
                  }
                  rows={isCustom ? 6 : 4}
                  className="resize-none text-sm"
                />
              </div>

              {isCustom && !customPrompt.trim() && (
                <Alert className="border-amber-200 bg-amber-50">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="text-xs text-amber-800">
                    Please describe the document you need before generating.
                  </AlertDescription>
                </Alert>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setPhase('select')}>
                Back
              </Button>
              <Button
                onClick={handleGenerate}
                disabled={isCustom && !customPrompt.trim()}
                className="gap-2 bg-[#1a365d] hover:bg-[#1e407a] text-white"
              >
                <Sparkles className="h-4 w-4" />
                Generate Document
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── Generating phase ──────────────────────────────────────────── */}
        {phase === 'generating' && selected && (
          <div className="flex flex-col items-center justify-center gap-5 py-10">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#ebf4ff]">
              <Loader2 className="h-8 w-8 animate-spin text-[#2b6cb0]" />
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-[#1a365d]">
                Generating {selected.label}…
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {getGenerationStage(elapsedSeconds)}
              </p>
              <p className="mt-2 text-xs tabular-nums text-gray-400">
                {formatElapsed(elapsedSeconds)} elapsed
              </p>
            </div>
          </div>
        )}

        {/* ── Success phase ─────────────────────────────────────────────── */}
        {phase === 'success' && result && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="h-5 w-5" />
                Document Generated
              </DialogTitle>
              <DialogDescription>
                Your document has been drafted and added to the Document Vault.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 py-2">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                  <FileText className="h-5 w-5 text-emerald-700" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-emerald-800">{result.title}</p>
                  <p className="text-xs text-emerald-600 capitalize">{result.status} — ready for review</p>
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2 pt-2">
              <Button variant="outline" onClick={reset}>
                Generate Another
              </Button>
              <Button
                onClick={handleClose}
                className="bg-[#1a365d] hover:bg-[#1e407a] text-white"
              >
                View in Vault
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── Error phase ───────────────────────────────────────────────── */}
        {phase === 'error' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-700">
                <AlertCircle className="h-5 w-5" />
                Generation Failed
              </DialogTitle>
            </DialogHeader>

            <Alert className="border-red-200 bg-red-50">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-sm text-red-800">{error}</AlertDescription>
            </Alert>

            <DialogFooter className="gap-2 pt-2">
              <Button variant="outline" onClick={handleClose}>
                Close
              </Button>
              <Button
                onClick={() => setPhase('configure')}
                className="gap-2 bg-[#1a365d] hover:bg-[#1e407a] text-white"
              >
                <RefreshCw className="h-4 w-4" />
                Retry
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
