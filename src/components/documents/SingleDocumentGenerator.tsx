/**
 * SingleDocumentGenerator.tsx
 *
 * Dialog that lets an attorney generate any single document type for a client
 * without running a full batch package generation. Uses the same unified
 * generation pipeline as batch — this just controls scope (one document).
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
import { FileText, Loader2, Sparkles, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { documentService } from '@/services/document-service';
import { useDocument } from '@/hooks/useFirestore';
import { COLLECTIONS } from '@/config/constants';
import { SOFTWARE_SOURCES } from '@/config/software-sources';
import { FORMATTING_PRESET_OPTIONS } from '@/config/formatting-presets';
import type { Client } from '@/types';

type GenerationMode = 'template' | 'ai' | 'hybrid';

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

// ── Standard document types available for individual generation ───────────────

const STANDARD_DOC_TYPES = [
  { value: 'will', label: 'Last Will and Testament', description: 'Standalone simple will' },
  { value: 'pourOverWill', label: 'Pour-Over Will', description: 'Will with trust pour-over' },
  { value: 'poa', label: 'Durable Power of Attorney', description: 'Financial POA' },
  { value: 'livingWill', label: 'Advance Directive', description: 'Healthcare directive' },
  { value: 'trust', label: 'Revocable Living Trust', description: 'Revocable living trust agreement' },
  { value: 'deed', label: 'Deed', description: 'Trust transfer deed (per property)' },
  { value: 'affidavitOfConsideration', label: 'Affidavit of Consideration', description: 'NJ transfer tax affidavit' },
  { value: 'gitRep3', label: 'GIT/REP-3 Certificate', description: 'NJ income tax exemption certificate' },
  { value: 'estatePlanSummary', label: 'Estate Plan Summary', description: 'Client-facing summary with action steps checklist' },
] as const;

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  firmId: string;
  clientId: string;
  open: boolean;
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SingleDocumentGenerator({ firmId, clientId, open, onClose }: Props) {
  const [selectedDocType, setSelectedDocType] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [spouseRole, setSpouseRole] = useState<'client' | 'spouse'>('client');
  // Match the batch dialog's defaults: hybrid mode + IL formatting. Hybrid
  // is the only mode that pulls Knowledge Base context into the prompt
  // (template-only skips KB; ai-only skips templates).
  const [generationMode, setGenerationMode] = useState<GenerationMode>('hybrid');
  const [softwareSource, setSoftwareSource] = useState('interactivelegal');
  const [formattingPreset, setFormattingPreset] = useState('interactivelegal');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Guards the success path against double-fire from both the httpsCallable
  // promise resolution and the Firestore listener (whichever wins first).
  const succeededRef = useRef(false);

  useEffect(() => {
    if (!generating) {
      setElapsedSeconds(0);
      return;
    }
    succeededRef.current = false;
    setElapsedSeconds(0);
    const interval = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [generating]);

  // Firestore polling fallback: detects the saved doc even if the long-running
  // httpsCallable response is dropped silently by an intermediate proxy. Filters
  // on `updatedAt >= startTime` so prior drafts with the same docType aren't
  // matched, and so re-generations (which preserve createdAt) still trigger.
  useEffect(() => {
    if (!generating || !firmId || !clientId || !selectedDocType) return;
    const startTime = Timestamp.now();
    const q = query(
      collection(getFirestore(), COLLECTIONS.DOCUMENTS(firmId, clientId)),
      where('docType', '==', selectedDocType),
      where('updatedAt', '>=', startTime),
    );
    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) return;
      const data = snap.docs[0].data();
      const title = (data.displayName as string) || (data.title as string) || selectedDocType;
      markSuccess(title);
    });
    return () => unsub();
  }, [generating, firmId, clientId, selectedDocType]);

  const markSuccess = (title: string) => {
    if (succeededRef.current) return;
    succeededRef.current = true;
    setSuccessMessage(`${title} has been saved to the Document Vault.`);
    setGenerating(false);
    setTimeout(() => {
      setSelectedDocType('');
      setCustomInstructions('');
      setSpouseRole('client');
      setSuccessMessage('');
      onClose();
    }, 1500);
  };

  // Pull client + spouse so the spouse-role selector shows real names.
  const clientPath = firmId && clientId ? `${COLLECTIONS.CLIENTS(firmId)}/${clientId}` : null;
  const { data: client } = useDocument<Client>(clientPath);
  const clientFullName = client
    ? [client.personalInfo?.firstName, client.personalInfo?.lastName].filter(Boolean).join(' ').trim()
    : '';
  const spouseFullName = client?.spouseInfo
    ? [client.spouseInfo.firstName, client.spouseInfo.lastName].filter(Boolean).join(' ').trim()
    : '';
  const isMarried = client?.personalInfo?.maritalStatus === 'Married'
    || client?.personalInfo?.maritalStatus === 'Domestic Partnership'
    || (!!spouseFullName && spouseFullName.length > 0);
  // Per-spouse docs only make sense for personal docs (will/POA/HC/trust);
  // skip for joint/property docs that don't have a per-testator variant.
  const docTypeSupportsSpouseRole = ['will', 'pourOverWill', 'poa', 'livingWill', 'trust'].includes(selectedDocType);
  const showSpouseRole = isMarried && docTypeSupportsSpouseRole && !!spouseFullName;

  const handleGenerate = async () => {
    if (!selectedDocType) return;

    setGenerating(true);
    setError('');
    setSuccessMessage('');

    try {
      const result = await documentService.generateSingleDocument({
        firmId,
        clientId,
        docType: selectedDocType,
        customInstructions: customInstructions.trim() || undefined,
        spouseRole: showSpouseRole ? spouseRole : undefined,
        generationMode,
        softwareSource: softwareSource === 'none' ? '' : softwareSource,
        formattingPreset: formattingPreset === 'none' ? '' : formattingPreset,
      });
      markSuccess(result.title);
    } catch (err) {
      // If the Firestore listener already detected the saved doc, ignore the
      // late-arriving rejection (the connection probably dropped after the
      // server finished writing).
      if (succeededRef.current) return;
      setError(err instanceof Error ? err.message : 'Generation failed. Please try again.');
      setGenerating(false);
    }
  };

  const handleClose = () => {
    if (generating) return; // Don't close while generating
    setSelectedDocType('');
    setCustomInstructions('');
    setSpouseRole('client');
    setGenerationMode('hybrid');
    setSoftwareSource('interactivelegal');
    setFormattingPreset('interactivelegal');
    setError('');
    onClose();
  };

  const selectedDoc = STANDARD_DOC_TYPES.find((d) => d.value === selectedDocType);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#1a365d]">
            <Wand2 className="h-5 w-5 text-[#2b6cb0]" />
            Generate Custom Document
          </DialogTitle>
          <DialogDescription>
            Generate any single document — including types not in this client's
            package — with optional custom drafting instructions. For building
            the standard plan, use Generate Estate Plan Documents (where you can
            deselect documents) instead.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Document type selector */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Document Type</label>
            <Select value={selectedDocType} onValueChange={setSelectedDocType}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a document type…" />
              </SelectTrigger>
              <SelectContent>
                {STANDARD_DOC_TYPES.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    <div className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-gray-400" />
                      <span>{d.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedDoc && (
              <p className="text-xs text-gray-500">{selectedDoc.description}</p>
            )}
          </div>

          {/* Spouse-role selector — only for personal docs when client is married */}
          {showSpouseRole && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-gray-700">Whose document?</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSpouseRole('client')}
                  className={
                    'flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ' +
                    (spouseRole === 'client'
                      ? 'border-[#2b6cb0] bg-[#ebf4ff] text-[#1a365d] font-medium'
                      : 'border-gray-300 bg-white text-gray-700 hover:border-[#2b6cb0]/50')
                  }
                >
                  {clientFullName || 'Client'}
                </button>
                <button
                  type="button"
                  onClick={() => setSpouseRole('spouse')}
                  className={
                    'flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ' +
                    (spouseRole === 'spouse'
                      ? 'border-[#2b6cb0] bg-[#ebf4ff] text-[#1a365d] font-medium'
                      : 'border-gray-300 bg-white text-gray-700 hover:border-[#2b6cb0]/50')
                  }
                >
                  {spouseFullName} (spouse)
                </button>
              </div>
              <p className="text-xs text-gray-500">
                Each spouse needs their own will/POA/etc. The spouse version saves with a "_spouse" suffix.
              </p>
            </div>
          )}

          {/* Generation options — match the batch dialog so single-doc
              regenerations can pick mode/source/preset explicitly. */}
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
            <div className="col-span-2 space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                Generation Mode
              </label>
              <Select value={generationMode} onValueChange={(v) => setGenerationMode(v as GenerationMode)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Select mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hybrid" className="text-xs text-[#1a365d] font-medium">
                    Template: Enhanced (Hybrid) — Recommended
                  </SelectItem>
                  <SelectItem value="template" className="text-xs">
                    Template: Exact Fidelity
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-gray-500">
                Hybrid uses Knowledge Base context; Template skips it.
              </p>
            </div>
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
          </div>

          {/* Custom instructions (optional) */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">
              Custom Instructions{' '}
              <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <Textarea
              placeholder="e.g., Include a spendthrift provision in Article V…"
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              rows={3}
              className="resize-none text-sm"
            />
            <p className="text-xs text-gray-400">
              These instructions are treated as attorney directives and appended to the AI prompt.
            </p>
          </div>

          {generating && (
            <div className="flex items-center gap-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2.5">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#2b6cb0]" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-[#1a365d]">
                  {getGenerationStage(elapsedSeconds)}
                </p>
                <p className="text-[11px] tabular-nums text-gray-400">
                  {formatElapsed(elapsedSeconds)} elapsed
                </p>
              </div>
            </div>
          )}

          {successMessage && (
            <Alert className="border-emerald-200 bg-emerald-50">
              <AlertDescription className="text-sm text-emerald-800">✅ {successMessage}</AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert className="border-red-200 bg-red-50">
              <AlertDescription className="text-sm text-red-800">{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose} disabled={generating}>
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={!selectedDocType || generating}
            className="gap-2 bg-[#2b6cb0] text-white hover:bg-[#2c5282]"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
