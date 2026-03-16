/**
 * DocumentPreviewDialog.tsx
 *
 * Read-only document preview for all vault document types.
 *
 * - HTML/DOCX-derived content → renders `editorContent` in a legal-doc styled pane.
 * - PDF uploads → uses PDF.js to render each page as a <canvas> element.
 *   This approach is fully in-browser and bypasses all X-Frame-Options, CSP,
 *   and CORS restrictions that block iframe/object embedding of storage URLs.
 */

import { useState, useEffect, useRef } from 'react';
import { X, FileText, Loader2, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
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

// ── PDF Canvas Renderer ────────────────────────────────────────────────────────

interface PdfCanvasProps {
  downloadUrl: string;
}

function PdfViewer({ downloadUrl }: PdfCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfDocRef = useRef<{ numPages: number; getPage: (n: number) => Promise<unknown> } | null>(null);

  // Load the PDF document
  useEffect(() => {
    if (!downloadUrl) return;

    let cancelled = false;
    setRendering(true);
    setRenderError('');

    (async () => {
      try {
        // Lazy-load pdfjs-dist to keep initial bundle small
        const pdfjs = await import('pdfjs-dist');
        // Use a CDN worker to avoid bundling the heavy worker file
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

        const loadingTask = pdfjs.getDocument({
          url: downloadUrl,
          withCredentials: false,
        });

        const pdfDoc = await loadingTask.promise;
        if (cancelled) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pdfDocRef.current = pdfDoc as any;
        setNumPages(pdfDoc.numPages);
        setCurrentPage(1);
      } catch (err) {
        console.error('[PdfViewer] Failed to load PDF:', err);
        if (!cancelled) setRenderError('Failed to load the PDF document.');
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => { cancelled = true; };
  }, [downloadUrl]);

  // Render the current page whenever it changes
  useEffect(() => {
    if (!pdfDocRef.current || !canvasRef.current || numPages === 0) return;

    let cancelled = false;
    setRendering(true);

    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const page: any = await (pdfDocRef.current as any).getPage(currentPage);
        if (cancelled) return;

        const canvas = canvasRef.current!;
        const containerWidth = containerRef.current?.clientWidth ?? 800;
        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min((containerWidth - 32) / viewport.width, 2);
        const scaledViewport = page.getViewport({ scale });

        canvas.width = scaledViewport.width;
        canvas.height = scaledViewport.height;

        const ctx = canvas.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
      } catch (err) {
        console.error('[PdfViewer] Render error:', err);
        if (!cancelled) setRenderError('Failed to render this page.');
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => { cancelled = true; };
  }, [currentPage, numPages]);

  if (renderError) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center max-w-sm">
          <p className="text-sm font-medium text-red-700">{renderError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Page navigation */}
      {numPages > 1 && (
        <div className="flex items-center justify-center gap-3 py-2 border-b border-gray-200 bg-white flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={currentPage <= 1 || rendering}
            onClick={() => setCurrentPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-gray-500">
            Page {currentPage} of {numPages}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={currentPage >= numPages || rendering}
            onClick={() => setCurrentPage((p) => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Canvas area */}
      <div ref={containerRef} className="flex-1 overflow-auto bg-gray-100 flex flex-col items-center py-4 px-2">
        {rendering && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100/80 z-10">
            <Loader2 className="h-6 w-6 animate-spin text-[#2b6cb0]" />
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="shadow-lg bg-white"
          style={{ maxWidth: '100%' }}
        />
      </div>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  doc: Document | null;
  open: boolean;
  onClose: () => void;
}

// ── Main Dialog ───────────────────────────────────────────────────────────────

export default function DocumentPreviewDialog({ doc, open, onClose }: Props) {
  const [pdfDownloadUrl, setPdfDownloadUrl] = useState<string | null>(null);
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState('');

  const isPdf =
    doc?.mimeType === 'application/pdf' ||
    doc?.fileName?.toLowerCase().endsWith('.pdf');

  const docWithExtra = doc as (Document & {
    editorContent?: string;
    content?: string;
  }) | null;

  const htmlContent = docWithExtra?.editorContent || docWithExtra?.content || '';

  // Fetch the download URL once when dialog opens
  useEffect(() => {
    if (!open || !isPdf || !doc?.storagePath) {
      setPdfDownloadUrl(null);
      setUrlError('');
      return;
    }

    let cancelled = false;
    setUrlLoading(true);
    setUrlError('');

    getStorageDownloadUrl(doc.storagePath)
      .then((url) => { if (!cancelled) setPdfDownloadUrl(url); })
      .catch((err: unknown) => {
        console.error('[DocumentPreviewDialog] Failed to get URL:', err);
        if (!cancelled) setUrlError('Could not access the file.');
      })
      .finally(() => { if (!cancelled) setUrlLoading(false); });

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
        <div className="flex-1 overflow-hidden relative">
          {/* ── PDF preview via PDF.js canvas rendering ── */}
          {isPdf && (
            <>
              {urlLoading && (
                <div className="flex h-full items-center justify-center gap-3">
                  <Loader2 className="h-6 w-6 animate-spin text-[#2b6cb0]" />
                  <span className="text-sm text-gray-500">Loading PDF…</span>
                </div>
              )}
              {urlError && (
                <div className="flex h-full items-center justify-center">
                  <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center max-w-sm">
                    <p className="text-sm font-medium text-red-700">{urlError}</p>
                  </div>
                </div>
              )}
              {pdfDownloadUrl && !urlLoading && (
                <PdfViewer downloadUrl={pdfDownloadUrl} />
              )}
            </>
          )}

          {/* ── HTML / DOCX content preview ── */}
          {!isPdf && (
            <>
              {!htmlContent ? (
                <div className="flex h-full items-center justify-center bg-gray-100">
                  <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center max-w-sm">
                    <FileText className="mx-auto h-10 w-10 text-gray-300 mb-3" />
                    <p className="text-sm font-medium text-gray-500">No preview available</p>
                    <p className="text-xs text-gray-400 mt-1">
                      Open the document in the editor to view its contents.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="h-full overflow-y-auto bg-gray-100 py-8 px-4">
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
