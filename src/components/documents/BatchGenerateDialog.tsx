/**
 * BatchGenerateDialog.tsx
 *
 * Multi-client batch generation. Takes a list of "Ready to Draft" clients,
 * lets staff select which ones to generate, pick shared generation options
 * once, and runs the generations sequentially on the client side.
 *
 * Each client's packageType, trustTypes, and marital status are read from
 * their own Client doc — only the three generation-mode options are chosen
 * at batch time.
 *
 * Execution is sequential (client-side loop) so the 9-minute Cloud Function
 * timeout applies per-client, not per-batch. Failures are recorded but do
 * not stop the batch; a summary is shown at the end.
 */

import { useMemo, useState } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Layers,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { logSystemActivity } from '@/utils/activity-logger';
import { documentService } from '@/services/document-service';
import { SOFTWARE_SOURCES } from '@/config/software-sources';
import { FORMATTING_PRESET_OPTIONS } from '@/config/formatting-presets';
import type { Client } from '@/types';

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

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase = 'configuring' | 'running' | 'done';

type ClientStatus =
  | { state: 'pending' }
  | { state: 'running' }
  | { state: 'success'; docsGenerated: number }
  | { state: 'error'; error: string };

interface Props {
  open: boolean;
  onClose: () => void;
  firmId: string;
  /** Ready-to-Draft clients — questionnaire complete, zero documents generated */
  clients: Client[];
  /** Fired after batch completes so callers can refresh lists */
  onBatchComplete?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clientDisplayName(c: Client): string {
  const { lastName, firstName } = c.personalInfo;
  if (!lastName && !firstName) return 'Unknown Client';
  if (!firstName) return lastName;
  return `${lastName}, ${firstName}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BatchGenerateDialog({
  open,
  onClose,
  firmId,
  clients,
  onBatchComplete,
}: Props) {
  const { userProfile } = useAuth();

  // Only include clients with a packageType set — others can't be batched
  const batchableClients = useMemo(
    () => clients.filter((c) => !!c.packageDetails?.packageType),
    [clients],
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(batchableClients.map((c) => c.id)),
  );
  const [softwareSource, setSoftwareSource] = useState('interactivelegal');
  const [formattingPreset, setFormattingPreset] = useState('interactivelegal');
  const [generationMode, setGenerationMode] = useState('hybrid');
  const [phase, setPhase] = useState<Phase>('configuring');
  const [statusById, setStatusById] = useState<Record<string, ClientStatus>>({});
  const [currentIndex, setCurrentIndex] = useState(0);

  const selectedClients = useMemo(
    () => batchableClients.filter((c) => selectedIds.has(c.id)),
    [batchableClients, selectedIds],
  );

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === batchableClients.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(batchableClients.map((c) => c.id)));
    }
  };

  // ── Reset on close ─────────────────────────────────────────────────────────
  const handleClose = () => {
    // Don't allow closing mid-run — the dialog is uncloseable while running
    if (phase === 'running') return;
    // Reset state on close so next open is clean
    setPhase('configuring');
    setStatusById({});
    setCurrentIndex(0);
    setSelectedIds(new Set(batchableClients.map((c) => c.id)));
    onClose();
  };

  // ── Run the batch ──────────────────────────────────────────────────────────
  const runBatch = async () => {
    setPhase('running');
    const initial: Record<string, ClientStatus> = {};
    for (const c of selectedClients) initial[c.id] = { state: 'pending' };
    setStatusById(initial);

    for (let i = 0; i < selectedClients.length; i++) {
      const client = selectedClients[i];
      setCurrentIndex(i);
      setStatusById((prev) => ({ ...prev, [client.id]: { state: 'running' } }));

      try {
        const pkg = client.packageDetails?.packageType as
          | 'foundation'
          | 'guardian'
          | 'fortress';
        const trustTypes = client.trusts?.map((t) => t.trustType);

        const response = await documentService.generateAll({
          firmId,
          clientId: client.id,
          packageType: pkg,
          trustTypes,
          generationMode: generationMode as 'template' | 'ai' | 'hybrid' | 'high-fidelity',
          softwareSource: softwareSource === 'none' ? '' : softwareSource,
          formattingPreset: formattingPreset === 'none' ? '' : formattingPreset,
        });

        await logSystemActivity(firmId, userProfile, 'drafting documents', {
          clientName: clientDisplayName(client),
          packageType: pkg,
          batch: true,
        });

        setStatusById((prev) => ({
          ...prev,
          [client.id]: {
            state: 'success',
            docsGenerated: response.documentsGenerated,
          },
        }));
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Unknown error during generation';
        setStatusById((prev) => ({
          ...prev,
          [client.id]: { state: 'error', error: msg },
        }));
      }
    }

    setPhase('done');
    onBatchComplete?.();
  };

  const summary = useMemo(() => {
    let success = 0;
    let error = 0;
    let docsGenerated = 0;
    for (const s of Object.values(statusById)) {
      if (s.state === 'success') {
        success += 1;
        docsGenerated += s.docsGenerated;
      } else if (s.state === 'error') {
        error += 1;
      }
    }
    return { success, error, docsGenerated };
  }, [statusById]);

  if (batchableClients.length === 0) return null;

  const allSelected =
    selectedIds.size === batchableClients.length && batchableClients.length > 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleClose();
      }}
    >
      <DialogContent
        className={cn(
          'sm:max-w-2xl',
          phase === 'running' && '[&>button]:hidden',
        )}
      >
        {phase === 'configuring' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-[#1a365d]">
                <Layers className="h-5 w-5" />
                Batch Generate Estate Plans
              </DialogTitle>
              <DialogDescription>
                Select clients and pick shared generation options. Each client's
                package, trust types, and marital status come from their own
                record. Clients are processed one at a time.
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[65vh] space-y-4 overflow-y-auto py-2">
              {/* Client list */}
              <div>
                <div className="flex items-center justify-between pb-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                    Clients ({selectedClients.length} of{' '}
                    {batchableClients.length} selected)
                  </p>
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="text-xs font-medium text-[#2b6cb0] hover:underline"
                  >
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50/60">
                  <ul className="divide-y divide-gray-100">
                    {batchableClients.map((client) => {
                      const pkg = client.packageDetails?.packageType ?? '';
                      const checked = selectedIds.has(client.id);
                      return (
                        <li
                          key={client.id}
                          className="flex items-center gap-3 px-3 py-2 hover:bg-white"
                        >
                          <Checkbox
                            id={`batch-client-${client.id}`}
                            checked={checked}
                            onCheckedChange={() => toggleOne(client.id)}
                          />
                          <label
                            htmlFor={`batch-client-${client.id}`}
                            className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2"
                          >
                            <span className="truncate text-sm font-medium text-[#1a365d]">
                              {clientDisplayName(client)}
                            </span>
                            {pkg && (
                              <span
                                className={cn(
                                  'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                                  PACKAGE_BADGE[pkg] ?? 'bg-slate-100 text-slate-700',
                                )}
                              >
                                {PACKAGE_LABELS[pkg] ?? pkg}
                              </span>
                            )}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>

              {/* Shared options */}
              <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-3">
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
                        <SelectItem
                          key={s.value}
                          value={s.value || 'none'}
                          className="text-xs"
                        >
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
                        <SelectItem
                          key={p.value}
                          value={p.value || 'none'}
                          className="text-xs"
                        >
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="col-span-2 space-y-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                    Generation Mode
                  </label>
                  <Select value={generationMode} onValueChange={setGenerationMode}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Select mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        value="hybrid"
                        className="text-xs text-[#1a365d] font-medium"
                      >
                        Template: Enhanced (Hybrid) — Recommended
                      </SelectItem>
                      <SelectItem value="template" className="text-xs">
                        Template: Exact Fidelity
                      </SelectItem>
                      <SelectItem value="ai" className="text-xs">
                        AI Drafting (From Scratch)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Alert className="border-amber-200 bg-amber-50">
                <Clock className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-xs text-amber-800">
                  Each client takes several minutes to generate. Keep this
                  window open until the batch completes — closing it will stop
                  any clients that haven't started yet.
                </AlertDescription>
              </Alert>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={runBatch}
                disabled={selectedClients.length === 0}
                className="bg-[#1a365d] hover:bg-[#1e407a] text-white"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Generate {selectedClients.length}{' '}
                {selectedClients.length === 1 ? 'Package' : 'Packages'}
              </Button>
            </DialogFooter>
          </>
        )}

        {phase === 'running' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-[#1a365d]">
                <Loader2 className="h-5 w-5 animate-spin" />
                Generating… {currentIndex + 1} of {selectedClients.length}
              </DialogTitle>
              <DialogDescription>
                Processing clients sequentially. Do not close this window.
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[60vh] space-y-1 overflow-y-auto py-2">
              {selectedClients.map((client) => {
                const status = statusById[client.id] ?? { state: 'pending' };
                return (
                  <div
                    key={client.id}
                    className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm"
                  >
                    {status.state === 'success' ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    ) : status.state === 'error' ? (
                      <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
                    ) : status.state === 'running' ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#2b6cb0]" />
                    ) : (
                      <div className="h-4 w-4 shrink-0 rounded-full border-2 border-gray-200" />
                    )}
                    <span
                      className={cn(
                        'flex-1 truncate',
                        status.state === 'success' && 'text-gray-600',
                        status.state === 'error' && 'text-red-700',
                        status.state === 'running' &&
                          'font-medium text-[#1a365d]',
                        status.state === 'pending' && 'text-gray-400',
                      )}
                    >
                      {clientDisplayName(client)}
                    </span>
                    {status.state === 'success' && (
                      <span className="text-xs text-emerald-600">
                        {status.docsGenerated} docs
                      </span>
                    )}
                    {status.state === 'error' && (
                      <span
                        className="max-w-[40%] truncate text-xs text-red-600"
                        title={status.error}
                      >
                        {status.error}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {phase === 'done' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-[#1a365d]">
                {summary.error === 0 ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-amber-600" />
                )}
                Batch Complete
              </DialogTitle>
              <DialogDescription>
                {summary.success} of {selectedClients.length} clients generated
                successfully
                {summary.docsGenerated > 0 &&
                  ` · ${summary.docsGenerated} total documents`}
                {summary.error > 0 && ` · ${summary.error} failed`}
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[55vh] space-y-1 overflow-y-auto py-2">
              {selectedClients.map((client) => {
                const status = statusById[client.id] ?? { state: 'pending' };
                return (
                  <div
                    key={client.id}
                    className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm"
                  >
                    {status.state === 'success' ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    ) : status.state === 'error' ? (
                      <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
                    ) : (
                      <div className="h-4 w-4 shrink-0 rounded-full border-2 border-gray-200" />
                    )}
                    <span
                      className={cn(
                        'flex-1 truncate',
                        status.state === 'success' && 'text-gray-700',
                        status.state === 'error' && 'text-red-700',
                      )}
                    >
                      {clientDisplayName(client)}
                    </span>
                    {status.state === 'success' && (
                      <span className="text-xs text-emerald-600">
                        {status.docsGenerated} docs
                      </span>
                    )}
                    {status.state === 'error' && (
                      <span
                        className="max-w-[50%] truncate text-xs text-red-600"
                        title={status.error}
                      >
                        {status.error}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <DialogFooter>
              <Button
                onClick={handleClose}
                className="bg-[#1a365d] hover:bg-[#1e407a] text-white"
              >
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
