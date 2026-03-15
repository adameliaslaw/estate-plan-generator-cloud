/**
 * DocumentVault.tsx
 *
 * Tab 2 of the Client Dashboard — real-time list of all generated documents
 * for a client with filtering, sorting, search, per-row actions, and the
 * Generate Documents / Generate Additional Document controls.
 *
 * Props:
 *   firmId        — Firestore firm ID
 *   clientId      — Firestore client ID
 *   clientName    — for GenerateDocumentsButton
 *   packageType   — client's selected package
 *   trustTypes    — optional array of trust types (Fortress)
 *   questionnaireComplete — whether questionnaire is done (gates generation)
 */

import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Pencil,
  Trash2,
  Sparkles,
  Upload,
  PlusCircle,
  Search,
  SlidersHorizontal,
  FileText,
  FileSignature,
  Loader2,
  AlertCircle,
  Wand2,
  History,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import { type Document, type PackageType } from '@/types';
import { useCollection, deleteDoc } from '@/hooks/useFirestore';
import { documentService, type ReviewDocumentResponse } from '@/services/document-service';
import { COLLECTIONS } from '@/config/constants';

import DocumentStatusBadge from './DocumentStatusBadge';
import GenerateDocumentsButton from './GenerateDocumentsButton';
import AttorneyReviewGate from './AttorneyReviewGate';
import DocumentReviewDialog from './DocumentReviewDialog';
import FlexDocumentGenerator from './FlexDocumentGenerator';
import SingleDocumentGenerator from './SingleDocumentGenerator';
import VersionHistoryDialog from './VersionHistoryDialog';
import ExportButton from './ExportButton';
import BatchExportButton from './BatchExportButton';
import ESignatureDialog from './ESignatureDialog';
import { cn } from '@/lib/utils';

// ── Doc type display names ────────────────────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  will: 'Will',
  poa: 'Power of Attorney',
  livingWill: 'Advance Directive',
  trust: 'Trust Agreement',
  pourOverWill: 'Pour-Over Will',
  deed: 'Deed',
  affidavitOfConsideration: 'Affidavit of Consideration',
  gitRep3: 'GIT/REP-3',
  coverLetter: 'Cover Letter',
  engagementLetter: 'Engagement Letter',
  invoice: 'Invoice',
  estatePlanSummary: 'Estate Plan Summary',
  actionSteps: 'Action Steps',
  certificationOfTrust: 'Certification of Trust',
  beneficiaryDesignationLetter: 'Beneficiary Designation Letter',
  trustAmendment: 'Trust Amendment',
  trustRestatement: 'Trust Restatement',
  memorandumOfPersonalProperty: 'Memorandum of Personal Property',
  letterOfInstruction: 'Letter of Instruction',
  custom: 'Custom Document',
};

const TYPE_BADGE: Record<string, string> = {
  will: 'bg-purple-50 text-purple-700 ring-purple-200',
  poa: 'bg-blue-50 text-blue-700 ring-blue-200',
  livingWill: 'bg-teal-50 text-teal-700 ring-teal-200',
  trust: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  pourOverWill: 'bg-violet-50 text-violet-700 ring-violet-200',
  deed: 'bg-orange-50 text-orange-700 ring-orange-200',
  affidavitOfConsideration: 'bg-amber-50 text-amber-700 ring-amber-200',
  gitRep3: 'bg-yellow-50 text-yellow-700 ring-yellow-200',
  coverLetter: 'bg-gray-100 text-gray-600 ring-gray-200',
  engagementLetter: 'bg-slate-100 text-slate-600 ring-slate-200',
  invoice: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  estatePlanSummary: 'bg-sky-50 text-sky-700 ring-sky-200',
  actionSteps: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  custom: 'bg-gray-100 text-gray-600 ring-gray-200',
};

// ── Date formatter ────────────────────────────────────────────────────────────

function formatDate(ts: { seconds: number } | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts.seconds * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── Empty state ───────────────────────────────────────────────────────────────

interface EmptyStateProps {
  firmId: string;
  clientId: string;
  clientName: string;
  packageType: PackageType;
  trustTypes?: string[];
  questionnaireComplete: boolean;
}

function EmptyState({
  firmId,
  clientId,
  clientName,
  packageType,
  trustTypes,
  questionnaireComplete,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50/50 py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#ebf4ff]">
        <FileText className="h-8 w-8 text-[#2b6cb0]" />
      </div>
      <h3 className="text-base font-semibold text-[#1a365d]">No Documents Yet</h3>
      <p className="mt-1 max-w-sm text-sm text-gray-500">
        {questionnaireComplete
          ? 'Complete the questionnaire and generate your estate planning documents to get started.'
          : 'The client questionnaire must be completed before documents can be generated.'}
      </p>

      {questionnaireComplete && (
        <div className="mt-6 w-full max-w-xs">
          <GenerateDocumentsButton
            firmId={firmId}
            clientId={clientId}
            packageType={packageType}
            trustTypes={trustTypes}
            clientName={clientName}
            disabled={!questionnaireComplete}
          />
        </div>
      )}

      {!questionnaireComplete && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Complete the client questionnaire first to unlock document generation.
        </div>
      )}
    </div>
  );
}

// ── Row actions ───────────────────────────────────────────────────────────────

interface RowActionsProps {
  doc: Document;
  firmId: string;
  clientId: string;
  isStale?: boolean;
  onReview: (doc: Document) => void;
  onApprove: (doc: Document) => void;
  onDelete: (doc: Document) => void;
  onSendSignature: (doc: Document) => void;
  onEdit: (doc: Document) => void;
  onRegenerate?: (doc: Document) => void;
  onVersionHistory: (doc: Document) => void;
}

function RowActions({ doc, firmId, clientId, isStale, onReview, onApprove, onDelete, onSendSignature, onEdit, onRegenerate, onVersionHistory }: RowActionsProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1">
        {/* Edit — Phase 4 placeholder */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-gray-400 hover:text-[#2b6cb0]"
              onClick={() => onEdit(doc)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit document</TooltipContent>
        </Tooltip>

        {/* Export PDF / DOCX — live ExportButton */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <ExportButton
                firmId={firmId}
                clientId={clientId}
                documentId={doc.id}
                documentName={doc.displayName}
                size="icon"
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>Export PDF / DOCX</TooltipContent>
        </Tooltip>

        {/* Send for E-Signature */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-gray-400 hover:text-blue-600"
              onClick={() => onSendSignature(doc)}
            >
              <FileSignature className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Send for E-Signature</TooltipContent>
        </Tooltip>

        {/* AI Review */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-gray-400 hover:text-purple-600"
              onClick={() => onReview(doc)}
            >
              <Sparkles className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>AI review</TooltipContent>
        </Tooltip>

        {/* Version History */}
        {doc.currentVersion > 1 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-gray-400 hover:text-[#2b6cb0]"
                onClick={() => onVersionHistory(doc)}
              >
                <History className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Version history</TooltipContent>
          </Tooltip>
        )}

        {/* Regenerate (stale drafts only) */}
        {isStale && doc.status === 'draft' && onRegenerate && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-orange-500 hover:text-orange-700 hover:bg-orange-50"
                onClick={() => onRegenerate(doc)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                  <path d="M16 21h5v-5" />
                </svg>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Regenerate with updated data</TooltipContent>
          </Tooltip>
        )}

        {/* Approve for export (only drafts) */}
        {doc.status === 'draft' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-gray-400 hover:text-emerald-600"
                onClick={() => onApprove(doc)}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <polyline points="9 12 11 14 15 10" />
                </svg>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Approve for export</TooltipContent>
          </Tooltip>
        )}

        {/* Delete */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-gray-400 hover:text-red-600"
              onClick={() => onDelete(doc)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete document</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  firmId: string;
  clientId: string;
  clientName: string;
  packageType: PackageType;
  trustTypes?: string[];
  questionnaireComplete: boolean;
  clientUpdatedAt?: { seconds: number } | null;
}

export default function DocumentVault({
  firmId,
  clientId,
  clientName,
  packageType,
  trustTypes,
  questionnaireComplete,
  clientUpdatedAt,
}: Props) {
  // ── Firestore ────────────────────────────────────────────────────────────
  const { data: documents, loading, error: loadError } = useCollection<Document>(
    COLLECTIONS.DOCUMENTS(firmId, clientId),
  );

  const navigate = useNavigate();

  // ── Filter / sort state ──────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'date' | 'name' | 'status'>('date');

  // ── Dialog state ─────────────────────────────────────────────────────────
  const [reviewDoc, setReviewDoc] = useState<Document | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewResult, setReviewResult] = useState<ReviewDocumentResponse | null>(null);
  const [reviewError, setReviewError] = useState('');

  const [approveDoc, setApproveDoc] = useState<Document | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [signDoc, setSignDoc] = useState<Document | null>(null);

  const [showFlexGen, setShowFlexGen] = useState(false);
  const [showSingleGen, setShowSingleGen] = useState(false);
  const [versionHistoryDoc, setVersionHistoryDoc] = useState<Document | null>(null);

  // ── Derived / filtered list ──────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...documents];

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (d) =>
          d.displayName.toLowerCase().includes(q) ||
          d.fileName.toLowerCase().includes(q) ||
          (DOC_TYPE_LABELS[d.docType] ?? '').toLowerCase().includes(q),
      );
    }
    if (filterStatus !== 'all') list = list.filter((d) => d.status === filterStatus);
    if (filterType !== 'all') list = list.filter((d) => d.docType === filterType);

    list.sort((a, b) => {
      if (sortBy === 'date') {
        const at = a.updatedAt?.seconds ?? 0;
        const bt = b.updatedAt?.seconds ?? 0;
        return bt - at;
      }
      if (sortBy === 'name') return a.displayName.localeCompare(b.displayName);
      if (sortBy === 'status') return a.status.localeCompare(b.status);
      return 0;
    });

    return list;
  }, [documents, search, filterStatus, filterType, sortBy]);

  // ── Unique doc types for filter dropdown ─────────────────────────────────
  const docTypes = useMemo(() => {
    const types = new Set(documents.map((d) => d.docType));
    return Array.from(types).sort();
  }, [documents]);

  // ── AI Review handler ────────────────────────────────────────────────────
  const handleAiReview = async (doc: Document) => {
    setReviewDoc(doc);
    setReviewLoading(true);
    setReviewResult(null);
    setReviewError('');

    try {
      const res = await documentService.reviewDocument({
        firmId,
        clientId,
        documentId: doc.id,
      });
      setReviewResult(res);
    } catch (err: unknown) {
      setReviewError(
        err instanceof Error ? err.message : 'Review failed. Please try again.',
      );
    } finally {
      setReviewLoading(false);
    }
  };

  // ── Delete handler ───────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteDoc(
        `${COLLECTIONS.DOCUMENTS(firmId, clientId)}/${deleteTarget.id}`,
      );
      setDeleteTarget(null);
    } catch (err: unknown) {
      setDeleteError(
        err instanceof Error ? err.message : 'Failed to delete document.',
      );
    } finally {
      setDeleting(false);
    }
  };

  // ── Loading / error states ───────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-[#2b6cb0]" />
      </div>
    );
  }

  if (loadError) {
    return (
      <Alert className="border-red-200 bg-red-50">
        <AlertCircle className="h-4 w-4 text-red-600" />
        <AlertDescription className="text-sm text-red-800">
          Failed to load documents: {loadError.message}
        </AlertDescription>
      </Alert>
    );
  }

  // ── Empty state ──────────────────────────────────────────────────────────
  if (documents.length === 0) {
    return (
      <>
        <EmptyState
          firmId={firmId}
          clientId={clientId}
          clientName={clientName}
          packageType={packageType}
          trustTypes={trustTypes}
          questionnaireComplete={questionnaireComplete}
        />

        {/* Flex doc generator still available */}
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-[#2b6cb0] text-[#2b6cb0] hover:bg-[#ebf4ff]"
            onClick={() => setShowSingleGen(true)}
          >
            <Wand2 className="h-4 w-4" />
            Generate Individual Document
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-[#2b6cb0] text-[#2b6cb0] hover:bg-[#ebf4ff]"
            onClick={() => setShowFlexGen(true)}
          >
            <PlusCircle className="h-4 w-4" />
            Generate Supplementary Document
          </Button>
        </div>

        <FlexDocumentGenerator
          firmId={firmId}
          clientId={clientId}
          open={showFlexGen}
          onClose={() => setShowFlexGen(false)}
        />
        <SingleDocumentGenerator
          firmId={firmId}
          clientId={clientId}
          open={showSingleGen}
          onClose={() => setShowSingleGen(false)}
        />
      </>
    );
  }

  // ── Main vault ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Top toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Left: search + filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search documents…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-52 pl-9 text-sm"
            />
          </div>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-9 w-36 text-sm">
              <SlidersHorizontal className="mr-2 h-3.5 w-3.5 text-gray-400" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="review">In Review</SelectItem>
              <SelectItem value="final">Final</SelectItem>
            </SelectContent>
          </Select>

          {docTypes.length > 1 && (
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="h-9 w-44 text-sm">
                <SelectValue placeholder="Document type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {docTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {DOC_TYPE_LABELS[t] ?? t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
            <SelectTrigger className="h-9 w-36 text-sm">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">Sort: Date</SelectItem>
              <SelectItem value="name">Sort: Name</SelectItem>
              <SelectItem value="status">Sort: Status</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Right: action buttons */}
        <div className="flex items-center gap-2">
          {/* Upload external doc — Phase 4 placeholder */}
          <Button
            variant="outline"
            size="sm"
            className="gap-2 text-gray-600"
            onClick={() => {
              // Phase 4: upload external document
            }}
          >
            <Upload className="h-4 w-4" />
            Upload
          </Button>

          {/* Batch export */}
          <BatchExportButton
            firmId={firmId}
            clientId={clientId}
            docCount={documents.length}
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-[#2b6cb0] text-[#2b6cb0] hover:bg-[#ebf4ff]"
              >
                <PlusCircle className="h-4 w-4" />
                Additional Document
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setShowSingleGen(true)}>
                <Wand2 className="mr-2 h-4 w-4 text-[#2b6cb0]" />
                Generate Standard Document
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowFlexGen(true)}>
                <Sparkles className="mr-2 h-4 w-4 text-[#2b6cb0]" />
                Generate Supplementary Document
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  // Phase 4: upload external
                }}
              >
                <Upload className="mr-2 h-4 w-4 text-gray-500" />
                Upload external document
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {questionnaireComplete && (
            <GenerateDocumentsButton
              firmId={firmId}
              clientId={clientId}
              packageType={packageType}
              trustTypes={trustTypes}
              clientName={clientName}
              variant="compact"
            />
          )}
        </div>
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          {filtered.length} of {documents.length} document{documents.length !== 1 ? 's' : ''}
        </p>
        {(search || filterStatus !== 'all' || filterType !== 'all') && (
          <button
            onClick={() => {
              setSearch('');
              setFilterStatus('all');
              setFilterType('all');
            }}
            className="text-xs text-[#2b6cb0] hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Document table */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 py-12 text-center">
          <p className="text-sm text-gray-400">No documents match your current filters.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  {['Document Name', 'Type', 'Status', 'Last Modified', 'Actions'].map((col) => (
                    <th
                      key={col}
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((doc) => (
                  <tr
                    key={doc.id}
                    className="group transition-colors hover:bg-[#ebf4ff]/30"
                  >
                    {/* Document name */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-100">
                          <FileText className="h-4 w-4 text-gray-500" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-[#1a365d]">
                            {doc.displayName}
                          </p>
                          <p className="text-xs text-gray-400">{doc.fileName}</p>
                        </div>
                      </div>
                    </td>

                    {/* Type badge */}
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset',
                          TYPE_BADGE[doc.docType] ?? 'bg-gray-100 text-gray-600 ring-gray-200',
                        )}
                      >
                        {DOC_TYPE_LABELS[doc.docType] ?? doc.docType}
                      </span>
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-3">
                      <DocumentStatusBadge
                        status={doc.status}
                        isStale={
                          doc.status === 'draft' &&
                          !!clientUpdatedAt &&
                          !!(doc.createdAt as { seconds: number } | undefined)?.seconds &&
                          clientUpdatedAt.seconds > (doc.createdAt as { seconds: number }).seconds
                        }
                      />
                    </td>

                    {/* Last modified */}
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                      {formatDate(doc.updatedAt as { seconds: number } | null)}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <RowActions
                        doc={doc}
                        firmId={firmId}
                        clientId={clientId}
                        isStale={
                          doc.status === 'draft' &&
                          !!clientUpdatedAt &&
                          !!(doc.createdAt as { seconds: number } | undefined)?.seconds &&
                          clientUpdatedAt.seconds > (doc.createdAt as { seconds: number }).seconds
                        }
                        onReview={handleAiReview}
                        onApprove={(d) => setApproveDoc(d)}
                        onDelete={(d) => setDeleteTarget(d)}
                        onSendSignature={(d) => setSignDoc(d)}
                        onEdit={(d) => navigate(`/clients/${clientId}/documents/${d.id}/edit`)}
                        onVersionHistory={(d) => setVersionHistoryDoc(d)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── AI Review Dialog ────────────────────────────────────────────────── */}
      <DocumentReviewDialog
        open={!!reviewDoc}
        onClose={() => {
          setReviewDoc(null);
          setReviewResult(null);
          setReviewError('');
        }}
        documentName={reviewDoc?.displayName ?? ''}
        loading={reviewLoading}
        result={reviewResult}
        error={reviewError}
      />

      {/* ── Attorney Review Gate ────────────────────────────────────────────── */}
      {approveDoc && (
        <AttorneyReviewGate
          document={approveDoc}
          open={!!approveDoc}
          onApprove={() => setApproveDoc(null)}
          onClose={() => setApproveDoc(null)}
        />
      )}

      {/* ── Delete Confirmation Dialog ───────────────────────────────────────── */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-700">Delete Document</DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete{' '}
              <strong>{deleteTarget?.displayName}</strong>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {deleteError && (
            <Alert className="border-red-200 bg-red-50">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-sm text-red-800">{deleteError}</AlertDescription>
            </Alert>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteError('');
              }}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={deleting}
              className="gap-2 bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Flex Document Generator ──────────────────────────────────────────── */}
      <FlexDocumentGenerator
        firmId={firmId}
        clientId={clientId}
        open={showFlexGen}
        onClose={() => setShowFlexGen(false)}
      />

      {/* ── E-Signature Dialog ──────────────────────────────────────────────── */}
      {signDoc && (
        <ESignatureDialog
          open={!!signDoc}
          onClose={() => setSignDoc(null)}
          firmId={firmId}
          clientId={clientId}
          documentId={signDoc.id}
          documentName={signDoc.displayName}
        />
      )}

      {/* ── Version History Dialog ──────────────────────────────────────────── */}
      {versionHistoryDoc && (
        <VersionHistoryDialog
          firmId={firmId}
          clientId={clientId}
          documentId={versionHistoryDoc.id}
          documentName={versionHistoryDoc.displayName}
          currentVersion={versionHistoryDoc.currentVersion}
          open={!!versionHistoryDoc}
          onClose={() => setVersionHistoryDoc(null)}
        />
      )}
    </div>
  );
}
