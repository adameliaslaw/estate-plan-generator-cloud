/**
 * AttorneyReviewGate.tsx
 *
 * MANDATORY attorney review checklist — must be completed in full before a
 * document can be approved for export.
 *
 * When all checkboxes are checked the "Approve Document" button becomes enabled.
 * On approval, the document status is updated in Firestore and the approval
 * metadata (reviewedAt, reviewedBy, reviewNotes) is written.
 *
 * Props:
 *   document    — the Document object being reviewed
 *   onApprove   — callback with the approved document
 *   onClose     — callback when the dialog is dismissed
 *   open        — controlled open state
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
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  FileText,
} from 'lucide-react';
import { type Document } from '@/types';
import { updateDoc } from '@/hooks/useFirestore';
import { useAuth } from '@/hooks/useAuth';
import { COLLECTIONS } from '@/config/constants';
import { cn } from '@/lib/utils';

// ── Checklist items ────────────────────────────────────────────────────────────

interface ChecklistItem {
  id: string;
  text: string;
  /** If truthy, only shown when the doc type matches */
  docTypes?: string[];
}

const BASE_CHECKLIST: ChecklistItem[] = [
  {
    id: 'reviewed_entirely',
    text: 'I have reviewed the entire document for accuracy and completeness.',
  },
  {
    id: 'client_info',
    text: 'All client information (names, addresses, dates of birth) is correct throughout the document.',
  },
  {
    id: 'fiduciary_appointments',
    text: 'All fiduciary appointments (executor, trustee, agent, guardian) are as intended by the client.',
  },
  {
    id: 'legal_language',
    text: 'All statutory citations and legal language are correct and current for New Jersey.',
  },
  {
    id: 'execution_blocks',
    text: 'Execution blocks (signature lines, witness lines, notary acknowledgment) are properly formatted for NJ law.',
  },
  {
    id: 'distribution',
    text: 'Distribution provisions and beneficiary designations match the client\'s stated wishes.',
  },
  {
    id: 'trust_provisions',
    text: 'Trust funding schedule, trustee powers, and distribution standards are complete and accurate.',
    docTypes: ['trust', 'pourOverWill'],
  },
  {
    id: 'deed_details',
    text: 'Property descriptions, block/lot numbers, municipality, and consideration are verified and correct.',
    docTypes: ['deed', 'affidavitOfConsideration', 'gitRep3'],
  },
  {
    id: 'nj_compliance',
    text: 'The document complies with the New Jersey Uniform Trust Code, Probate Act, and all applicable NJ statutes.',
  },
  {
    id: 'attorney_responsibility',
    text: 'I accept professional responsibility for this document as the attorney of record and certify it is ready for client signature.',
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  document: Document;
  open: boolean;
  onApprove: (approvedDoc: Document) => void;
  onClose: () => void;
}

export default function AttorneyReviewGate({ document, open, onApprove, onClose }: Props) {
  const { userProfile } = useAuth();

  // Build the checklist relevant to this specific doc type
  const relevantItems = BASE_CHECKLIST.filter(
    (item) => !item.docTypes || item.docTypes.includes(document.docType),
  );

  const initialChecked = Object.fromEntries(relevantItems.map((item) => [item.id, false]));

  const [checked, setChecked] = useState<Record<string, boolean>>(initialChecked);
  const [reviewNotes, setReviewNotes] = useState('');
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState('');

  const allChecked = relevantItems.every((item) => checked[item.id]);
  const checkedCount = relevantItems.filter((item) => checked[item.id]).length;

  const toggle = (id: string) =>
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));

  const handleApprove = async () => {
    if (!allChecked) return;
    setApproving(true);
    setError('');

    try {
      const docPath = `${COLLECTIONS.DOCUMENTS(document.firmId, document.clientId)}/${document.id}`;
      const updates = {
        status: 'review' as const,
        reviewedBy: userProfile?.uid ?? userProfile?.email ?? 'unknown',
        reviewNotes: reviewNotes.trim() || null,
        updatedBy: userProfile?.uid ?? userProfile?.email ?? 'unknown',
      };

      await updateDoc(docPath, updates);

      onApprove({
        ...document,
        status: 'review',
        reviewedBy: updates.reviewedBy,
        reviewNotes: updates.reviewNotes ?? undefined,
      });
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to approve the document. Please try again.',
      );
    } finally {
      setApproving(false);
    }
  };

  const handleClose = () => {
    // Reset state on close
    setChecked(initialChecked);
    setReviewNotes('');
    setError('');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#1a365d]">
            <ShieldCheck className="h-5 w-5 text-[#2b6cb0]" />
            Attorney Review Checklist
          </DialogTitle>
          <DialogDescription>
            You must verify every item below before this document can be approved for export.
            This checklist is a permanent record of your professional review.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Document identity */}
          <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <FileText className="h-5 w-5 shrink-0 text-[#2b6cb0]" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[#1a365d]">{document.displayName}</p>
              <p className="text-xs text-gray-500">{document.fileName}</p>
            </div>
            <Badge variant="outline" className="shrink-0 border-amber-200 bg-amber-50 text-amber-700">
              Draft
            </Badge>
          </div>

          {/* Progress indicator */}
          <div className="flex items-center justify-between rounded-md bg-[#ebf4ff] px-3 py-2">
            <span className="text-sm font-medium text-[#1a365d]">Review progress</span>
            <span className="text-sm font-semibold text-[#2b6cb0]">
              {checkedCount} / {relevantItems.length} items verified
            </span>
          </div>

          {/* Mandatory disclaimer */}
          <Alert className="border-amber-200 bg-amber-50">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-xs text-amber-800">
              <strong>Important:</strong> By approving this document you are certifying, as the
              attorney of record, that it is accurate, legally compliant with New Jersey law, and
              ready for client execution. Approval creates an audit record with your name and
              timestamp.
            </AlertDescription>
          </Alert>

          {/* Checklist */}
          <div className="space-y-3">
            {relevantItems.map((item, index) => (
              <div
                key={item.id}
                onClick={() => toggle(item.id)}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors',
                  checked[item.id]
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-gray-200 bg-white hover:border-[#2b6cb0]/40 hover:bg-[#ebf4ff]/30',
                )}
              >
                <Checkbox
                  id={item.id}
                  checked={checked[item.id]}
                  onCheckedChange={() => toggle(item.id)}
                  className="mt-0.5 shrink-0 data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500"
                />
                <Label
                  htmlFor={item.id}
                  className={cn(
                    'cursor-pointer text-sm leading-relaxed',
                    checked[item.id] ? 'text-emerald-800' : 'text-gray-700',
                  )}
                >
                  <span className="mr-2 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-bold text-gray-600">
                    {index + 1}
                  </span>
                  {item.text}
                </Label>
              </div>
            ))}
          </div>

          {/* Optional review notes */}
          <div className="space-y-1.5">
            <Label htmlFor="reviewNotes" className="text-sm font-medium text-gray-700">
              Review Notes{' '}
              <span className="font-normal text-gray-400">(optional)</span>
            </Label>
            <Textarea
              id="reviewNotes"
              placeholder="Any notes, caveats, or conditions noted during review…"
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              rows={3}
              className="resize-none text-sm"
            />
          </div>

          {/* Error */}
          {error && (
            <Alert className="border-red-200 bg-red-50">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-sm text-red-800">{error}</AlertDescription>
            </Alert>
          )}

          {/* All-checked confirmation */}
          {allChecked && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              All items verified — you may now approve this document.
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={handleClose} disabled={approving}>
            Cancel
          </Button>
          <Button
            onClick={handleApprove}
            disabled={!allChecked || approving}
            className={cn(
              'gap-2 transition-all',
              allChecked
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed',
            )}
          >
            {approving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Approving…
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" />
                Approve Document
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
