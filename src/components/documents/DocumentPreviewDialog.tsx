/**
 * DocumentPreviewDialog.tsx
 *
 * Read-only document preview for all vault document types.
 *
 * - HTML/DOCX-derived content → renders the `editorContent` field in a
 *   legal-document-style pane (same font/margin feel as the editor).
 * - PDF uploads → gets a Firebase Storage download URL and renders it in
 *   an <object> tag. NOTE: X-Frame-Options only restricts <iframe>, not
 *   <object>/<embed>, so no blob conversion is needed.
 * - Falls back gracefully if neither field is present.
 */

import { useState, useEffect } from 'react';
import { X, FileText, Loader2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { type Document } from '@/types';

// ── Helpers ────────────────────────────────────────────────────────────────────

async function getStorageDownloadUrl(storagePath: string): Promise<string> {
  const { ref, getDownloadURL } = await import('firebase/storage');
  const { storage } = await import('@/config/firebase');
  return getDownloadURL(ref(storage, storagePath));
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  doc: Document | null;
  open: boolean;
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DocumentPreviewDialog({ doc, open, onClose }: Props) {
  const [pdfDownloadUrl, setPdfDownloadUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');

  const isPdf =
    doc?.mimeType === 'application/pdf' ||
    doc?.fileName?.toLowerCase().endsWith('.pdf');

  const docWithExtra = doc as (Document & {
    editorContent?: string;
    content?: string;
  }) | null;

  const htmlContent = docWithExtra?.editorContent || docWithExtra?.content || '';

  // ── Fetch download URL when dialog opens for PDFs ──
  useEffect(() => {
    if (!open || !isPdf || !doc?.storagePath) {
      setPdfDownloadUrl(null);
      setPdfError('');
      return;
    }

    let cancelled = false;
    setPdfLoading(true);
    setPdfError('');

    getStorageDownloadUrl(doc.storagePath)
      .then((url) => { if (!cancelled) setPdfDownloadUrl(url); })
      .catch((err: unknown) => {
        console.error('[DocumentPreviewDialog] Failed to get download URL:', err);
        if (!cancelled) setPdfError('Could not load the PDF. The file may have been moved or deleted.');
      })
      .finally(() => { if (!cancelled) setPdfLoading(false); });

    return () => { cancelled = true; };
  }, [open, doc?.storagePath, isPdf]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!doc) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-full h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* ── Header ── */}
        <DialogHeader className="flex-shrink-0 flex flex-row items-center justify-between px-5 py-3 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-2.5 min-w-0">
            <FileText className="h-4 w-4 shrink-0 text-[#2b6cb0]" />
            <DialogTitle className="text-sm font-semibold text-[#1a365d] truncate">
              {doc.displayName}
            </DialogTitle>
            <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 uppercase tracking-wide">
              Preview
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {pdfDownloadUrl && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs text-gray-500 hover:text-[#2b6cb0]"
                onClick={() => window.open(pdfDownloadUrl, '_blank')}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open in tab
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-gray-400 hover:text-gray-700"
              onClick={onClose}
              aria-label="Close preview"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* ── Body ── */}
        <div className="flex-1 overflow-hidden bg-gray-100">
          {/* ── PDF preview via <object> (not subject to X-Frame-Options) ── */}
          {isPdf && (
            <>
              {pdfLoading && (
                <div className="flex h-full items-center justify-center gap-3">
                  <Loader2 className="h-6 w-6 animate-spin text-[#2b6cb0]" />
                  <span className="text-sm text-gray-500">Loading PDF…</span>
                </div>
              )}
              {pdfError && (
                <div className="flex h-full items-center justify-center">
                  <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center max-w-sm">
                    <p className="text-sm font-medium text-red-700">{pdfError}</p>
                    {doc.storagePath && (
                      <p className="text-xs text-gray-500 mt-2">
                        Use "Open in tab" to view the file directly.
                      </p>
                    )}
                  </div>
                </div>
              )}
              {pdfDownloadUrl && !pdfLoading && (
                // <object> bypasses X-Frame-Options (which only applies to <iframe>)
                <object
                  data={pdfDownloadUrl}
                  type="application/pdf"
                  className="w-full h-full"
                  aria-label={`Preview of ${doc.displayName}`}
                >
                  {/* Fallback if browser can't embed — offer the download link */}
                  <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
                    <FileText className="h-12 w-12 text-gray-300" />
                    <p className="text-sm text-gray-500 text-center">
                      Your browser can't display this PDF inline.
                    </p>
                    <Button
                      size="sm"
                      onClick={() => window.open(pdfDownloadUrl, '_blank')}
                      className="gap-1.5"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open PDF in new tab
                    </Button>
                  </div>
                </object>
              )}
            </>
          )}

          {/* ── HTML / DOCX content preview ── */}
          {!isPdf && (
            <>
              {!htmlContent ? (
                <div className="flex h-full items-center justify-center">
                  <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center max-w-sm">
                    <FileText className="mx-auto h-10 w-10 text-gray-300 mb-3" />
                    <p className="text-sm font-medium text-gray-500">No preview available</p>
                    <p className="text-xs text-gray-400 mt-1">
                      Open the document in the editor to view its contents.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="h-full overflow-y-auto py-8 px-4">
                  {/* Legal document page */}
                  <div
                    className="mx-auto bg-white shadow-lg rounded-sm"
                    style={{
                      maxWidth: '816px',
                      minHeight: '1056px',
                      padding: '96px 96px',
                      fontFamily: '"Times New Roman", Times, Georgia, serif',
                      fontSize: '12pt',
                      lineHeight: '1.6',
                      color: '#1a1a1a',
                    }}
                    dangerouslySetInnerHTML={{ __html: htmlContent }}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
