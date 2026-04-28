/**
 * SingleDocumentGenerator.tsx
 *
 * Dialog that lets an attorney generate any single document type for a client
 * without running a full batch package generation. Uses the same unified
 * generation pipeline as batch — this just controls scope (one document).
 */

import { useState } from 'react';
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
import type { Client } from '@/types';

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
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Pull client + spouse so the spouse-role selector shows real names.
  const clientPath = firmId && clientId ? `${COLLECTIONS.CLIENTS(firmId)}/${clientId}` : null;
  const { data: client } = useDocument<Client>(clientPath);
  const clientFullName = client
    ? [client.personalInfo?.firstName, client.personalInfo?.lastName].filter(Boolean).join(' ').trim()
    : '';
  const spouseFullName = client?.spouseInfo
    ? [client.spouseInfo.firstName, client.spouseInfo.lastName].filter(Boolean).join(' ').trim()
    : '';
  const isMarried = client?.personalInfo?.maritalStatus === 'married'
    || client?.personalInfo?.maritalStatus === 'domesticPartnership'
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
      });

      setSuccessMessage(`${result.title} has been saved to the Document Vault.`);

      // Auto-close after brief delay to show success
      setTimeout(() => {
        setSelectedDocType('');
        setCustomInstructions('');
        setSpouseRole('client');
        setSuccessMessage('');
        onClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const handleClose = () => {
    if (generating) return; // Don't close while generating
    setSelectedDocType('');
    setCustomInstructions('');
    setSpouseRole('client');
    setError('');
    onClose();
  };

  const selectedDoc = STANDARD_DOC_TYPES.find((d) => d.value === selectedDocType);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#1a365d]">
            <Wand2 className="h-5 w-5 text-[#2b6cb0]" />
            Generate Individual Document
          </DialogTitle>
          <DialogDescription>
            Generate any single estate planning document for this client using
            the same engine as full package generation.
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
