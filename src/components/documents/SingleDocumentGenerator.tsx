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
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

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
      });

      setSuccessMessage(`${result.title} has been saved to the Document Vault.`);

      // Auto-close after brief delay to show success
      setTimeout(() => {
        setSelectedDocType('');
        setCustomInstructions('');
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
