/**
 * DocumentDiffDialog.tsx
 *
 * Side-by-side or unified diff between any two versions of a document.
 * Opened from VersionHistoryDialog; fetches both versions' HTML content
 * via getDocumentVersionContent, strips to plain text (preserving block
 * boundaries), and word-diffs the result.
 *
 * Default picker state: oldest version on the left, most recent on the right.
 */

import { useEffect, useMemo, useState } from 'react';
import { diffWords, type Change } from 'diff';
import { ArrowRight, GitCompareArrows, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { documentService } from '@/services/document-service';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface VersionOption {
  versionNumber: number;
  createdAt: string | null;
  changeNotes: string;
}

interface Props {
  firmId: string;
  clientId: string;
  documentId: string;
  documentName: string;
  versions: VersionOption[];
  onClose: () => void;
}

type ViewMode = 'side-by-side' | 'unified';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'TR',
  'BLOCKQUOTE',
  'SECTION',
  'ARTICLE',
  'PRE',
]);

/**
 * Convert HTML content to plain text, inserting a newline after each block-level
 * tag so paragraph boundaries are preserved for the diff. Runs in the browser
 * (uses DOMParser). Returns a single string with \n separators.
 */
function htmlToPlainText(html: string): string {
  if (!html) return '';
  const parser = new DOMParser();
  const dom = parser.parseFromString(html, 'text/html');

  let out = '';
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (el.tagName === 'BR') {
      out += '\n';
      return;
    }
    for (const child of Array.from(el.childNodes)) walk(child);
    if (BLOCK_TAGS.has(el.tagName)) {
      if (!out.endsWith('\n')) out += '\n';
    }
  };
  walk(dom.body);
  // Collapse 3+ newlines into 2 and trim
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ── Render helpers ────────────────────────────────────────────────────────────

function UnchangedSpan({ text }: { text: string }) {
  return <span>{text}</span>;
}

function AddedSpan({ text }: { text: string }) {
  return (
    <span className="bg-emerald-100 text-emerald-900 rounded-sm px-0.5">{text}</span>
  );
}

function RemovedSpan({ text }: { text: string }) {
  return (
    <span className="bg-red-100 text-red-900 line-through rounded-sm px-0.5">
      {text}
    </span>
  );
}

function renderUnified(parts: Change[]) {
  return parts.map((part, i) => {
    if (part.added) return <AddedSpan key={i} text={part.value} />;
    if (part.removed) return <RemovedSpan key={i} text={part.value} />;
    return <UnchangedSpan key={i} text={part.value} />;
  });
}

function renderLeftSide(parts: Change[]) {
  // Left column = old version: keep unchanged + removed, skip added
  return parts.map((part, i) => {
    if (part.added) return null;
    if (part.removed) return <RemovedSpan key={i} text={part.value} />;
    return <UnchangedSpan key={i} text={part.value} />;
  });
}

function renderRightSide(parts: Change[]) {
  // Right column = new version: keep unchanged + added, skip removed
  return parts.map((part, i) => {
    if (part.removed) return null;
    if (part.added) return <AddedSpan key={i} text={part.value} />;
    return <UnchangedSpan key={i} text={part.value} />;
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DocumentDiffDialog({
  firmId,
  clientId,
  documentId,
  documentName,
  versions,
  onClose,
}: Props) {
  const sortedVersions = useMemo(
    () => [...versions].sort((a, b) => a.versionNumber - b.versionNumber),
    [versions],
  );

  const oldestVersion = sortedVersions[0]?.versionNumber;
  const newestVersion = sortedVersions[sortedVersions.length - 1]?.versionNumber;

  // Component mounts only when dialog opens (parent uses conditional render),
  // so these lazy initializers run once with fresh defaults per open.
  const [fromVersion, setFromVersion] = useState<number | null>(
    () => oldestVersion ?? null,
  );
  const [toVersion, setToVersion] = useState<number | null>(
    () =>
      newestVersion != null && newestVersion !== oldestVersion
        ? newestVersion
        : (newestVersion ?? null),
  );
  const [leftContent, setLeftContent] = useState<string>('');
  const [rightContent, setRightContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side');

  // Fetch both versions whenever the picks change. Uses a ref-like cancelled
  // flag so late responses for outdated picks are discarded. The initial
  // setLoading/setError writes on entry are part of this fetch's lifecycle
  // (synchronizing with the external Cloud Function call), which is the
  // recommended effect usage.
  useEffect(() => {
    if (fromVersion == null || toVersion == null) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data-fetch effect; same pattern as VersionHistoryDialog's version list fetch
    setLoading(true);
    setError('');
    Promise.all([
      documentService.getDocumentVersionContent({
        firmId,
        clientId,
        documentId,
        versionNumber: fromVersion,
      }),
      documentService.getDocumentVersionContent({
        firmId,
        clientId,
        documentId,
        versionNumber: toVersion,
      }),
    ])
      .then(([left, right]) => {
        if (cancelled) return;
        setLeftContent(left.content ?? '');
        setRightContent(right.content ?? '');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load version content.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [firmId, clientId, documentId, fromVersion, toVersion]);

  const diffParts = useMemo(() => {
    if (!leftContent && !rightContent) return [];
    const leftText = htmlToPlainText(leftContent);
    const rightText = htmlToPlainText(rightContent);
    return diffWords(leftText, rightText);
  }, [leftContent, rightContent]);

  const hasChanges = useMemo(
    () => diffParts.some((p) => p.added || p.removed),
    [diffParts],
  );

  const sameVersion =
    fromVersion != null && toVersion != null && fromVersion === toVersion;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#1a365d]">
            <GitCompareArrows className="h-5 w-5 text-[#2b6cb0]" />
            Compare Versions
          </DialogTitle>
          <DialogDescription>{documentName}</DialogDescription>
        </DialogHeader>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              From
            </label>
            <Select
              value={fromVersion != null ? String(fromVersion) : ''}
              onValueChange={(v) => setFromVersion(Number(v))}
            >
              <SelectTrigger className="h-8 w-auto text-xs">
                <SelectValue placeholder="Pick…" />
              </SelectTrigger>
              <SelectContent>
                {sortedVersions.map((v) => (
                  <SelectItem
                    key={v.versionNumber}
                    value={String(v.versionNumber)}
                    className="text-xs"
                  >
                    v{v.versionNumber} — {formatDate(v.createdAt)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ArrowRight className="h-4 w-4 text-gray-400" />

          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              To
            </label>
            <Select
              value={toVersion != null ? String(toVersion) : ''}
              onValueChange={(v) => setToVersion(Number(v))}
            >
              <SelectTrigger className="h-8 w-auto text-xs">
                <SelectValue placeholder="Pick…" />
              </SelectTrigger>
              <SelectContent>
                {sortedVersions.map((v) => (
                  <SelectItem
                    key={v.versionNumber}
                    value={String(v.versionNumber)}
                    className="text-xs"
                  >
                    v{v.versionNumber} — {formatDate(v.createdAt)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="ml-auto flex items-center gap-1 rounded-md border border-gray-200 bg-white p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('side-by-side')}
              className={cn(
                'rounded px-2 py-1 text-xs font-medium transition-colors',
                viewMode === 'side-by-side'
                  ? 'bg-[#1a365d] text-white'
                  : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              Side-by-side
            </button>
            <button
              type="button"
              onClick={() => setViewMode('unified')}
              className={cn(
                'rounded px-2 py-1 text-xs font-medium transition-colors',
                viewMode === 'unified'
                  ? 'bg-[#1a365d] text-white'
                  : 'text-gray-600 hover:bg-gray-50',
              )}
            >
              Unified
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden">
          {error && (
            <Alert className="border-red-200 bg-red-50">
              <AlertDescription className="text-sm text-red-800">{error}</AlertDescription>
            </Alert>
          )}

          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-[#2b6cb0]" />
              <span className="ml-2 text-sm text-gray-500">Loading versions…</span>
            </div>
          )}

          {!loading && !error && sameVersion && (
            <div className="py-12 text-center text-sm text-gray-500">
              Pick two different versions to compare.
            </div>
          )}

          {!loading && !error && !sameVersion && !hasChanges && diffParts.length > 0 && (
            <Alert className="border-gray-200 bg-gray-50">
              <AlertDescription className="text-sm text-gray-700">
                These two versions have identical text content.
              </AlertDescription>
            </Alert>
          )}

          {!loading && !error && !sameVersion && hasChanges && (
            <>
              {viewMode === 'side-by-side' ? (
                <div className="grid h-full grid-cols-2 gap-3 overflow-hidden">
                  <div className="flex flex-col overflow-hidden rounded-md border border-gray-200">
                    <div className="border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-600">
                      v{fromVersion}
                    </div>
                    <div className="flex-1 overflow-y-auto whitespace-pre-wrap p-3 font-mono text-xs leading-relaxed text-gray-800">
                      {renderLeftSide(diffParts)}
                    </div>
                  </div>
                  <div className="flex flex-col overflow-hidden rounded-md border border-gray-200">
                    <div className="border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-600">
                      v{toVersion}
                    </div>
                    <div className="flex-1 overflow-y-auto whitespace-pre-wrap p-3 font-mono text-xs leading-relaxed text-gray-800">
                      {renderRightSide(diffParts)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col overflow-hidden rounded-md border border-gray-200">
                  <div className="border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-600">
                    v{fromVersion} → v{toVersion}
                  </div>
                  <div className="flex-1 overflow-y-auto whitespace-pre-wrap p-3 font-mono text-xs leading-relaxed text-gray-800">
                    {renderUnified(diffParts)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Legend */}
        {!loading && !error && !sameVersion && hasChanges && (
          <div className="flex items-center gap-4 border-t border-gray-100 pt-2 text-[11px] text-gray-500">
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-emerald-100" />
              <span>Added</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-red-100" />
              <span>Removed</span>
            </div>
            <div className="ml-auto text-[11px] text-gray-400 italic">
              Diff compares text content only. Formatting changes are not shown.
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
