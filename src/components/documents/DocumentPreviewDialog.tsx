/**
 * DocumentPreviewDialog.tsx
 *
 * Read-only preview for all vault document types.
 *
 * Strategy (avoids all CORS/CSP/X-Frame issues):
 *   - PDF  → Firebase SDK getBytes() → ArrayBuffer → PDF.js canvas rendering
 *   - DOCX → If editorContent exists, render HTML directly.
 *             If not (e.g. AI extraction failed), Firebase SDK getBytes() → mammoth.js → HTML
 *   - getBytes() is auth-aware and works cross-origin without CORS config on the bucket.
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
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// ── Firebase storage helper ────────────────────────────────────────────────────

async function getFileBytes(storagePath: string): Promise<{ bytes: ArrayBuffer; downloadUrl: string }> {
  const { ref, getBytes, getDownloadURL } = await import('firebase/storage');
  const { storage } = await import('@/config/firebase');
  const storageRef = ref(storage, storagePath);
  const [bytes, downloadUrl] = await Promise.all([
    getBytes(storageRef),
    getDownloadURL(storageRef),
  ]);
  return { bytes, downloadUrl };
}

// ── PDF canvas renderer ────────────────────────────────────────────────────────

interface PdfViewerProps {
  bytes: ArrayBuffer;
  downloadUrl: string;
  displayName: string;
}

function PdfViewer({ bytes, downloadUrl, displayName }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef = useRef<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [rendering, setRendering] = useState(true);
  const [renderError, setRenderError] = useState('');

  // Load PDF from ArrayBuffer
  useEffect(() => {
    let cancelled = false;
    setRendering(true);
    setRenderError('');

    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

        // Use data: ArrayBuffer — zero CORS issues, SDK handles auth
        const loadingTask = pdfjs.getDocument({ data: bytes });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pdfDoc: any = await loadingTask.promise;
        if (cancelled) return;

        pdfDocRef.current = pdfDoc;
        setNumPages(pdfDoc.numPages);
        setCurrentPage(1);
      } catch (err) {
        console.error('[PdfViewer] Load error:', err);
        if (!cancelled) setRenderError('Failed to render the PDF.');
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => { cancelled = true; };
  // bytes identity is stable per open — eslint exhaustive-deps not needed here
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes]);

  // Render the current page
  useEffect(() => {
    if (!pdfDocRef.current || !canvasRef.current || numPages === 0) return;

    let cancelled = false;
    setRendering(true);

    (async () => {
      try {
        const page = await pdfDocRef.current.getPage(currentPage);
        if (cancelled) return;

        const containerWidth = containerRef.current?.clientWidth ?? 800;
        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min((containerWidth - 32) / viewport.width, 2);
        const scaledViewport = page.getViewport({ scale });

        const canvas = canvasRef.current!;
        canvas.width = scaledViewport.width;
        canvas.height = scaledViewport.height;

        const ctx = canvas.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;
      } catch (err) {
        console.error('[PdfViewer] Render error:', err);
        if (!cancelled) setRenderError('Failed to render page.');
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
          <Button size="sm" className="mt-3 gap-1.5" onClick={() => window.open(downloadUrl, '_blank')}>
            <ExternalLink className="h-3.5 w-3.5" /> Open in tab
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {numPages > 1 && (
        <div className="flex items-center justify-center gap-3 py-2 border-b border-gray-200 bg-white flex-shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7"
            disabled={currentPage <= 1 || rendering}
            onClick={() => setCurrentPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-gray-500">Page {currentPage} of {numPages}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7"
            disabled={currentPage >= numPages || rendering}
            onClick={() => setCurrentPage((p) => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
      <div ref={containerRef} className="flex-1 overflow-auto bg-gray-100 flex flex-col items-center py-4 px-2 relative">
        {rendering && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100/80 z-10">
            <Loader2 className="h-6 w-6 animate-spin text-[#2b6cb0]" />
          </div>
        )}
        <canvas ref={canvasRef} className="shadow-lg bg-white" style={{ maxWidth: '100%' }}
          aria-label={`PDF preview of ${displayName}`} />
      </div>
    </div>
  );
}

// ── DOCX renderer (mammoth.js) ─────────────────────────────────────────────────

interface DocxViewerProps {
  bytes: ArrayBuffer;
}

function DocxViewer({ bytes }: DocxViewerProps) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const mammoth = await import('mammoth');
        const result = await mammoth.convertToHtml({ arrayBuffer: bytes });
        if (!cancelled) setHtml(result.value);
      } catch (err) {
        console.error('[DocxViewer] Conversion error:', err);
        if (!cancelled) setError('Could not convert this Word document for preview.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-3 bg-gray-100">
        <Loader2 className="h-6 w-6 animate-spin text-[#2b6cb0]" />
        <span className="text-sm text-gray-500">Converting document…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-100">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center max-w-sm">
          <p className="text-sm font-medium text-red-700">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-100 py-8 px-4">
      <div className="mx-auto bg-white shadow-lg rounded-sm"
        style={{
          maxWidth: '816px', minHeight: '1056px', padding: '96px 96px',
          fontFamily: '"Times New Roman", Times, Georgia, serif',
          fontSize: '12pt', lineHeight: '1.6', color: '#1a1a1a',
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  doc: Document | null;
  open: boolean;
  onClose: () => void;
}

// ── Main dialog ───────────────────────────────────────────────────────────────

export default function DocumentPreviewDialog({ doc, open, onClose }: Props) {
  const [fileBytes, setFileBytes] = useState<ArrayBuffer | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [fetchedHtml, setFetchedHtml] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const docWithExtra = doc as (Document & { editorContent?: string; content?: string }) | null;
  const isPdf = doc?.mimeType === 'application/pdf' || doc?.fileName?.toLowerCase().endsWith('.pdf');
  const isDocx = doc?.mimeType?.includes('word') || doc?.fileName?.toLowerCase().endsWith('.docx') || doc?.fileName?.toLowerCase().endsWith('.doc');
  const isHtmlFile = doc?.storagePath?.toLowerCase().endsWith('.html') || doc?.mimeType === 'text/html' || doc?.fileName?.toLowerCase().endsWith('.html');
  
  // Extract inline HTML, but ignore it if it's just a blank placeholder paragraph
  let inlineHtml = docWithExtra?.editorContent || docWithExtra?.content || '';
  const strippedHtml = inlineHtml.replace(/<[^>]*>/g, '').trim();
  if (!strippedHtml) {
    inlineHtml = ''; // Treat as empty if there's no actual text content inside the HTML tags
  }

  // Show inline HTML if we already have it (AI-extracted on upload)
  const canShowHtmlDirectly = !isPdf && !!inlineHtml;
  // Need to download bytes if it's a PDF, DOCX without extracted HTML, or HTML file without inline content BUT has a storage path
  const needsStorageDownload = !!doc?.storagePath && (isPdf || (isDocx && !canShowHtmlDirectly) || (isHtmlFile && !canShowHtmlDirectly));
  // Need to fetch full doc from Firestore if it's an HTML file, has no inline content, and NO storage path (e.g. AI generated docs from the list view)
  const needsFirestoreFetch = !isPdf && !isDocx && !inlineHtml && !doc?.storagePath && !!doc?.id && isHtmlFile;

  useEffect(() => {
    console.log('[DocumentPreviewDialog DEBUG]', {
      open,
      docId: doc?.id,
      docType: doc?.docType,
      fileName: doc?.fileName,
      storagePath: doc?.storagePath,
      hasInlineHtml: !!inlineHtml,
      needsStorageDownload,
      needsFirestoreFetch,
    });

    if (!open) {
      setFileBytes(null);
      setDownloadUrl(null);
      setFetchedHtml('');
      setLoadError('');
      return;
    }

    let cancelled = false;

    if (needsStorageDownload && doc?.storagePath) {
      setLoading(true);
      setLoadError('');

      getFileBytes(doc.storagePath)
        .then(({ bytes, downloadUrl: url }) => {
          if (cancelled) return;
          setFileBytes(bytes);
          setDownloadUrl(url);
          // If it's an HTML file, decode the bytes as text
          if (isHtmlFile) {
            const decoder = new TextDecoder('utf-8');
            setFetchedHtml(decoder.decode(bytes));
          }
        })
        .catch((err: unknown) => {
          console.error('[DocumentPreviewDialog] getFileBytes error:', err);
          if (!cancelled) setLoadError('Could not load file from storage.');
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    } else if (needsFirestoreFetch && doc) {
      // It's an AI document where the content is stored in Firestore, but the vault list
      // doesn't return the 'content' field to save bandwidth. We must fetch the single doc.
      setLoading(true);
      setLoadError('');

      import('firebase/firestore').then(({ doc: firestoreDoc, getDoc }) => {
        import('@/config/firebase').then(({ db }) => {
          // Document path: firms/{firmId}/clients/{clientId}/documents/{docId}
          // The `doc` object provided to this component usually has firmId and clientId as it comes from the vault
          const unknownDoc = doc as unknown as Record<string, unknown>;
          const firmId = typeof unknownDoc.firmId === 'string' ? unknownDoc.firmId : '';
          const clientId = typeof unknownDoc.clientId === 'string' ? unknownDoc.clientId : '';
          
          if (!firmId || !clientId) {
             if (!cancelled) {
               setLoadError('Missing firm/client ID to fetch document content.');
               setLoading(false);
             }
             return;
          }
          
          const docRef = firestoreDoc(db, 'firms', firmId, 'clients', clientId, 'documents', doc.id);
          getDoc(docRef)
            .then(snap => {
               if (cancelled) return;
               if (!snap.exists()) {
                 setLoadError('Document content not found in database.');
                 return;
               }
               const data = snap.data();
               const content = data?.editorContent || data?.content || '';
               if (!content) {
                 setLoadError('Document is empty.');
               } else {
                 setFetchedHtml(content as string);
               }
            })
            .catch(err => {
               console.error('[DocumentPreviewDialog] Fetch firestore doc error:', err);
               if (!cancelled) setLoadError('Could not load document content from database.');
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        });
      });
    }

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doc?.storagePath, needsStorageDownload, needsFirestoreFetch, doc?.id]);

  if (!doc) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        aria-describedby={undefined}
        className="max-w-4xl w-full h-[90vh] flex flex-col p-0 gap-0 overflow-hidden"
      >
        {/* Header */}
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
            {downloadUrl && (
              <Button variant="ghost" size="sm"
                className="h-7 gap-1.5 text-xs text-gray-500 hover:text-[#2b6cb0]"
                onClick={() => window.open(downloadUrl, '_blank')}>
                <ExternalLink className="h-3.5 w-3.5" /> Open in tab
              </Button>
            )}
            <Button variant="ghost" size="icon"
              className="h-7 w-7 text-gray-400 hover:text-gray-700"
              onClick={onClose} aria-label="Close preview">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="flex-1 overflow-hidden relative">
          {/* Loading state (downloading bytes) */}
          {loading && (
            <div className="flex h-full items-center justify-center gap-3 bg-gray-100">
              <Loader2 className="h-6 w-6 animate-spin text-[#2b6cb0]" />
              <span className="text-sm text-gray-500">Loading file…</span>
            </div>
          )}

          {/* Error state */}
          {loadError && !loading && (
            <div className="flex h-full items-center justify-center bg-gray-100">
              <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center max-w-sm">
                <p className="text-sm font-medium text-red-700">{loadError}</p>
              </div>
            </div>
          )}

          {/* PDF preview */}
          {!loading && !loadError && isPdf && fileBytes && (
            <PdfViewer bytes={fileBytes} downloadUrl={downloadUrl ?? ''} displayName={doc.displayName} />
          )}

          {/* HTML content — inline or fetched from storage */}
          {!loading && !loadError && !isPdf && (canShowHtmlDirectly || fetchedHtml) && (
            <div className="h-full overflow-y-auto bg-gray-100 py-8 px-4">
              <div className="mx-auto bg-white shadow-lg rounded-sm"
                style={{
                  maxWidth: '816px', minHeight: '1056px', padding: '96px 96px',
                  fontFamily: '"Times New Roman", Times, Georgia, serif',
                  fontSize: '12pt', lineHeight: '1.6', color: '#1a1a1a',
                }}
                dangerouslySetInnerHTML={{ __html: inlineHtml || fetchedHtml }}
              />
            </div>
          )}

          {/* DOCX — no extracted HTML, convert with mammoth */}
          {!loading && !loadError && !isPdf && !canShowHtmlDirectly && !fetchedHtml && isDocx && fileBytes && (
            <DocxViewer bytes={fileBytes} />
          )}

          {/* No content available fallback - only if NOT loading, NO error, NOT pdf, NO html to show, NOT a docx */}
          {!loading && !loadError && !isPdf && !canShowHtmlDirectly && !fetchedHtml && !isDocx && (
            <div className="flex h-full items-center justify-center bg-gray-100">
              <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center max-w-sm">
                <FileText className="mx-auto h-10 w-10 text-gray-300 mb-3" />
                <p className="text-sm font-medium text-gray-500">No preview available</p>
                <p className="text-xs text-gray-400 mt-1">Open the document in the editor to view its contents.</p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
