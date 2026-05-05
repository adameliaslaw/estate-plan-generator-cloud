/**
 * src/components/chat/UploadDocumentModal.tsx
 *
 * Upload a PDF or DOCX to Pinecone via the ingestDocument Cloud Function.
 * The user selects a file and picks a namespace (reference, work-product,
 * client-files) before uploading.
 */

import { useRef, useState } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  ingestDocument,
  NAMESPACE_LABELS,
  ACCEPTED_MIME_TYPES,
  type IngestNamespace,
} from '@/services/ingest-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type UploadState = 'idle' | 'uploading' | 'success' | 'error';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const NAMESPACES: IngestNamespace[] = ['reference', 'work-product', 'client-files'];

const NS_DESCRIPTIONS: Record<IngestNamespace, string> = {
  reference:      'Statutes, regulations, case law, treatises',
  'work-product': 'Prior memos, briefs, templates, internal guides',
  'client-files': 'Client-specific documents and correspondence',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function UploadDocumentModal({ open, onOpenChange }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [namespace, setNamespace] = useState<IngestNamespace>('reference');
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [result, setResult] = useState<{ docId: string; fileName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setUploadState('idle');
    setResult(null);
    setError(null);
  }

  function handleClose(nextOpen: boolean) {
    if (!nextOpen && uploadState !== 'uploading') {
      reset();
      onOpenChange(false);
    }
  }

  function handleFileChange(selected: File | null) {
    if (!selected) return;
    if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(selected.type)) {
      setError('Only PDF files are supported.');
      return;
    }
    if (selected.size > 20 * 1024 * 1024) {
      setError('File must be under 20 MB.');
      return;
    }
    setFile(selected);
    setError(null);
    setUploadState('idle');
    setResult(null);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    handleFileChange(e.dataTransfer.files[0] ?? null);
  }

  async function handleUpload() {
    if (!file || uploadState === 'uploading') return;
    setUploadState('uploading');
    setError(null);
    setResult(null);
    try {
      const res = await ingestDocument(file, namespace);
      setResult(res);
      setUploadState('success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setError(msg);
      setUploadState('error');
    }
  }

  const isUploading = uploadState === 'uploading';
  const isSuccess   = uploadState === 'success';
  const canUpload   = !!file && !isUploading && !isSuccess;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-[#1a365d]" />
            Upload Document to PageIndex
          </DialogTitle>
          <DialogDescription>
            Uploads a PDF to PageIndex and registers it for reasoning-based RAG retrieval.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* ── File drop zone ── */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => !isUploading && fileInputRef.current?.click()}
            className={cn(
              'cursor-pointer rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors',
              isDragging
                ? 'border-[#2b6cb0] bg-blue-50'
                : file
                  ? 'border-[#2b6cb0]/40 bg-blue-50/30'
                  : 'border-gray-200 hover:border-[#2b6cb0]/40 hover:bg-gray-50',
              isUploading && 'pointer-events-none opacity-60',
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              disabled={isUploading}
            />
            {file ? (
              <div className="flex flex-col items-center gap-2">
                <FileText className="h-8 w-8 text-[#2b6cb0]" />
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-gray-900">{file.name}</span>
                  {!isUploading && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setFile(null); setUploadState('idle'); setResult(null); setError(null); }}
                      className="rounded-full text-gray-400 hover:text-gray-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <span className="text-xs text-gray-500">{(file.size / 1024).toFixed(0)} KB</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-7 w-7 text-gray-300" />
                <p className="text-sm text-gray-500">
                  Drop a file here or <span className="font-medium text-[#2b6cb0]">browse</span>
                </p>
                <p className="text-xs text-gray-400">PDF only · max 20 MB</p>
              </div>
            )}
          </div>

          {/* ── Namespace selector ── */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
              Namespace
            </label>
            <div className="space-y-2">
              {NAMESPACES.map((ns) => (
                <label
                  key={ns}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                    namespace === ns
                      ? 'border-[#2b6cb0] bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300',
                    isUploading && 'pointer-events-none opacity-60',
                  )}
                >
                  <input
                    type="radio"
                    name="namespace"
                    value={ns}
                    checked={namespace === ns}
                    onChange={() => setNamespace(ns)}
                    className="mt-0.5 accent-[#2b6cb0]"
                    disabled={isUploading}
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{NAMESPACE_LABELS[ns]}</p>
                    <p className="text-xs text-gray-500">{NS_DESCRIPTIONS[ns]}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* ── Status messages ── */}
          {isSuccess && result && (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <div>
                <p className="font-medium">{result.fileName} indexed</p>
                <p className="text-xs text-emerald-700 mt-0.5">Added to <span className="font-semibold">{namespace}</span> · doc ID: {result.docId}</p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {/* ── Actions ── */}
          <div className="flex items-center gap-2 pt-1">
            {isSuccess ? (
              <>
                <button
                  onClick={reset}
                  className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Upload Another
                </button>
                <button
                  onClick={() => handleClose(false)}
                  className="flex-1 rounded-lg bg-[#1a365d] px-4 py-2 text-sm font-medium text-white hover:bg-[#2b6cb0] transition-colors"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => handleClose(false)}
                  disabled={isUploading}
                  className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleUpload()}
                  disabled={!canUpload}
                  className={cn(
                    'flex-1 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors',
                    canUpload
                      ? 'bg-[#1a365d] hover:bg-[#2b6cb0]'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed',
                  )}
                >
                  {isUploading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Ingesting…
                    </span>
                  ) : (
                    'Upload & Ingest'
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
