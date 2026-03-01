/**
 * ExportButton.tsx
 *
 * Dropdown button for exporting a single document as PDF or DOCX.
 *
 * Features:
 *   - Dropdown with "Export as PDF" and "Export as DOCX" options
 *   - Per-format loading spinners (one format can be in-flight at a time)
 *   - Triggers browser download from the signed URL returned by the Cloud Function
 *   - Displays a toast-style error message on failure
 *   - Accessible keyboard navigation via Radix DropdownMenu
 *
 * Props:
 *   firmId        — Firestore firm ID
 *   clientId      — Firestore client ID
 *   documentId    — Firestore document ID
 *   documentName  — Human-readable document name (used in the download filename)
 *   size          — 'default' | 'sm' | 'icon'  (default: 'icon')
 */

import { useState, useRef } from 'react';
import { FileDown, FileText, Loader2, ChevronDown, AlertCircle } from 'lucide-react';
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

type ExportFormat = 'pdf' | 'docx';
type ButtonSize = 'default' | 'sm' | 'icon';

interface Props {
  firmId: string;
  clientId: string;
  documentId: string;
  documentName: string;
  /** Visual size of the trigger button. Defaults to 'icon'. */
  size?: ButtonSize;
  /** Extra class names for the trigger button. */
  className?: string;
}

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

export default function ExportButton({
  firmId,
  clientId,
  documentId,
  documentName,
  size = 'icon',
  className,
}: Props) {
  const [loadingFormat, setLoadingFormat] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Auto-dismiss error after 5 seconds
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLoading = loadingFormat !== null;

  function showError(msg: string): void {
    setError(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setError(null), 5000);
  }

  async function handleExport(format: ExportFormat): Promise<void> {
    if (isLoading) return;

    setLoadingFormat(format);
    setError(null);

    try {
      const params = { firmId, clientId, documentId };
      let result: { downloadUrl: string; fileName: string };

      if (format === 'pdf') {
        result = await documentService.exportPdf(params);
      } else {
        result = await documentService.exportDocx(params);
      }

      triggerDownload(result.downloadUrl, result.fileName);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : `Failed to export ${format.toUpperCase()}. Please try again.`;
      showError(msg);
    } finally {
      setLoadingFormat(null);
    }
  }

  return (
    <div className="relative inline-flex flex-col items-start">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {size === 'icon' ? (
            /* Icon-only trigger — used in table row actions */
            <Button
              variant="ghost"
              size="icon"
              disabled={isLoading}
              className={cn(
                'h-8 w-8 text-gray-400 hover:text-[#2b6cb0]',
                isLoading && 'opacity-60 cursor-not-allowed',
                className,
              )}
              title="Export document"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileDown className="h-4 w-4" />
              )}
            </Button>
          ) : (
            /* Labeled trigger — used in editors, detail panels, etc. */
            <Button
              variant="outline"
              size={size}
              disabled={isLoading}
              className={cn(
                'gap-2 border-[#2b6cb0] text-[#2b6cb0] hover:bg-[#ebf4ff]',
                isLoading && 'opacity-60 cursor-not-allowed',
                className,
              )}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileDown className="h-4 w-4" />
              )}
              Export
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </Button>
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel className="text-xs font-semibold text-gray-500">
            Export "{documentName.length > 24 ? documentName.substring(0, 22) + '…' : documentName}"
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {/* PDF */}
          <DropdownMenuItem
            onClick={() => handleExport('pdf')}
            disabled={isLoading}
            className="cursor-pointer gap-2"
          >
            {loadingFormat === 'pdf' ? (
              <Loader2 className="h-4 w-4 animate-spin text-[#2b6cb0]" />
            ) : (
              <FileDown className="h-4 w-4 text-red-500" />
            )}
            <span className="flex-1">
              {loadingFormat === 'pdf' ? 'Generating PDF…' : 'Export as PDF'}
            </span>
          </DropdownMenuItem>

          {/* DOCX */}
          <DropdownMenuItem
            onClick={() => handleExport('docx')}
            disabled={isLoading}
            className="cursor-pointer gap-2"
          >
            {loadingFormat === 'docx' ? (
              <Loader2 className="h-4 w-4 animate-spin text-[#2b6cb0]" />
            ) : (
              <FileText className="h-4 w-4 text-blue-500" />
            )}
            <span className="flex-1">
              {loadingFormat === 'docx' ? 'Generating DOCX…' : 'Export as DOCX'}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Inline error message */}
      {error && (
        <div className="absolute top-full left-0 z-50 mt-1 flex max-w-xs items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 shadow-md">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}
    </div>
  );
}
