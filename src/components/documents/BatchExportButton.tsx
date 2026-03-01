/**
 * BatchExportButton.tsx
 *
 * "Export All" dropdown button shown in the DocumentVault header toolbar.
 *
 * Allows the attorney or paralegal to export all documents for a client
 * as a single ZIP archive in PDF, DOCX, or both formats simultaneously.
 *
 * Features:
 *   - Three export options: All as PDF, All as DOCX, All as Both
 *   - Loading state with descriptive progress message
 *   - Triggers browser download of the ZIP file on completion
 *   - Displays document count and format badges
 *   - Inline error display with auto-dismiss after 6 seconds
 *   - Disabled while export is in progress to prevent duplicate requests
 *
 * Props:
 *   firmId      — Firestore firm ID
 *   clientId    — Firestore client ID
 *   docCount    — Optional: displayed in the button label (e.g. "Export 7 docs")
 *   className   — Optional additional class names for the trigger button
 */

import { useState, useRef } from 'react';
import {
  FileDown,
  FileText,
  Files,
  Loader2,
  Package,
  ChevronDown,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { documentService } from '@/services/document-service';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type BatchFormat = 'pdf' | 'docx' | 'both';

interface Props {
  firmId: string;
  clientId: string;
  /** Total number of documents — displayed in label when provided */
  docCount?: number;
  className?: string;
}

// ── Labels & icons ────────────────────────────────────────────────────────────

const FORMAT_CONFIG: Record<
  BatchFormat,
  {
    label: string;
    loadingLabel: string;
    icon: React.ElementType;
    iconClass: string;
    description: string;
  }
> = {
  pdf: {
    label: 'All as PDF (ZIP)',
    loadingLabel: 'Generating PDFs…',
    icon: FileDown,
    iconClass: 'text-red-500',
    description: 'Export every document as PDF, bundled in a ZIP.',
  },
  docx: {
    label: 'All as DOCX (ZIP)',
    loadingLabel: 'Generating DOCX files…',
    icon: FileText,
    iconClass: 'text-blue-500',
    description: 'Export every document as Word DOCX, bundled in a ZIP.',
  },
  both: {
    label: 'All as PDF + DOCX (ZIP)',
    loadingLabel: 'Generating PDF + DOCX…',
    icon: Files,
    iconClass: 'text-indigo-500',
    description: 'Export every document as both PDF and DOCX in one ZIP.',
  },
};

// ── Download helper ───────────────────────────────────────────────────────────

function triggerDownload(url: string, fileName: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BatchExportButton({
  firmId,
  clientId,
  docCount,
  className,
}: Props) {
  const [loadingFormat, setLoadingFormat] = useState<BatchFormat | null>(null);
  const [lastExported, setLastExported] = useState<{
    format: BatchFormat;
    count: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLoading = loadingFormat !== null;

  function showError(msg: string): void {
    setError(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setError(null), 6000);
  }

  async function handleBatchExport(format: BatchFormat): Promise<void> {
    if (isLoading) return;

    setLoadingFormat(format);
    setError(null);
    setLastExported(null);

    try {
      const result = await documentService.exportBatch({ firmId, clientId, format });
      triggerDownload(result.downloadUrl, result.fileName);
      setLastExported({ format, count: result.documentCount });

      // Auto-clear success banner after 8 seconds
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setLastExported(null), 8000);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : `Batch ${format.toUpperCase()} export failed. Please try again.`;
      showError(msg);
    } finally {
      setLoadingFormat(null);
    }
  }

  // ── Loading label for the trigger button ──────────────────────────────────
  const loadingLabel = loadingFormat ? FORMAT_CONFIG[loadingFormat].loadingLabel : null;

  return (
    <div className="relative inline-flex flex-col items-end gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={isLoading}
            className={cn(
              'gap-2 border-[#2b6cb0] text-[#2b6cb0] hover:bg-[#ebf4ff]',
              isLoading && 'opacity-75 cursor-not-allowed',
              className,
            )}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="hidden sm:inline">{loadingLabel}</span>
                <span className="sm:hidden">Exporting…</span>
              </>
            ) : (
              <>
                <Package className="h-4 w-4" />
                <span>
                  Export All
                  {docCount !== undefined && docCount > 0 ? ` (${docCount})` : ''}
                </span>
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </>
            )}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="text-xs font-semibold text-gray-500">
            Batch Export — All Documents
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {(Object.entries(FORMAT_CONFIG) as [BatchFormat, typeof FORMAT_CONFIG.pdf][]).map(
            ([fmt, cfg]) => {
              const Icon = cfg.icon;
              const isThisLoading = loadingFormat === fmt;

              return (
                <DropdownMenuItem
                  key={fmt}
                  onClick={() => handleBatchExport(fmt)}
                  disabled={isLoading}
                  className="cursor-pointer"
                >
                  <div className="flex items-start gap-2.5 py-0.5">
                    {isThisLoading ? (
                      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[#2b6cb0]" />
                    ) : (
                      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', cfg.iconClass)} />
                    )}
                    <div>
                      <p className="text-sm font-medium leading-tight">
                        {isThisLoading ? cfg.loadingLabel : cfg.label}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500 leading-tight">
                        {cfg.description}
                      </p>
                    </div>
                  </div>
                </DropdownMenuItem>
              );
            },
          )}

          <DropdownMenuSeparator />

          <div className="px-2 py-1.5">
            <p className="text-xs text-gray-400 leading-tight">
              Exports are packaged as a ZIP archive and include a manifest file.
              Draft documents are watermarked.
            </p>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Success banner */}
      {lastExported && !isLoading && (
        <div className="absolute top-full right-0 z-50 mt-1 flex max-w-xs items-start gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 shadow-md">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
          <p className="text-xs text-emerald-700">
            {lastExported.count} document{lastExported.count !== 1 ? 's' : ''} exported as{' '}
            {FORMAT_CONFIG[lastExported.format].label.replace(' (ZIP)', '')} — download starting.
          </p>
        </div>
      )}

      {/* Error banner */}
      {error && !isLoading && (
        <div className="absolute top-full right-0 z-50 mt-1 flex max-w-xs items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 shadow-md">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}
    </div>
  );
}
