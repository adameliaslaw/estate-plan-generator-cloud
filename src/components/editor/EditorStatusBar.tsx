/**
 * EditorStatusBar.tsx
 *
 * Bottom status bar for the legal document editor.
 *
 * Left   : word count, character count, estimated page count (250 words/page)
 * Center : auto-save status indicator (Saved / Saving... / Unsaved changes)
 * Right  : version number + "View History" button
 */

import { type Editor } from '@tiptap/react';
import { CheckCircle2, Clock, AlertCircle, History, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

interface EditorStatusBarProps {
  editor: Editor | null;
  saveStatus: SaveStatus;
  lastSavedAt: Date | null;
  currentVersion: number;
  onViewHistory: () => void;
  className?: string;
}

// ── Save status config ────────────────────────────────────────────────────────

const SAVE_STATUS_CONFIG: Record<
  SaveStatus,
  { label: string; dotClass: string; icon: React.ComponentType<{ className?: string }> }
> = {
  saved: {
    label: 'All changes saved',
    dotClass: 'bg-emerald-500',
    icon: CheckCircle2,
  },
  saving: {
    label: 'Saving…',
    dotClass: 'bg-amber-400 animate-pulse',
    icon: Clock,
  },
  unsaved: {
    label: 'Unsaved changes',
    dotClass: 'bg-orange-500',
    icon: AlertCircle,
  },
  error: {
    label: 'Save failed',
    dotClass: 'bg-red-500',
    icon: AlertCircle,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatLastSaved(date: Date | null): string {
  if (!date) return '';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);

  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getWordCount(editor: Editor | null): number {
  if (!editor) return 0;
  const text = editor.state.doc.textContent;
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

function getCharCount(editor: Editor | null): number {
  if (!editor) return 0;
  // Use CharacterCount extension if available
  try {
    return (editor.storage as { characterCount?: { characters: () => number } }).characterCount?.characters?.() ?? editor.state.doc.textContent.length;
  } catch {
    return editor.state.doc.textContent.length;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EditorStatusBar({
  editor,
  saveStatus,
  lastSavedAt,
  currentVersion,
  onViewHistory,
  className,
}: EditorStatusBarProps) {
  const wordCount = getWordCount(editor);
  const charCount = getCharCount(editor);
  const pageCount = Math.max(1, Math.ceil(wordCount / 250));
  const statusConfig = SAVE_STATUS_CONFIG[saveStatus];
  const StatusIcon = statusConfig.icon;

  return (
    <div
      className={cn(
        'editor-statusbar flex h-9 items-center justify-between border-t border-gray-200 bg-white px-4 text-xs text-gray-500 select-none',
        className,
      )}
    >
      {/* ── Left: document stats ── */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-gray-400" />
          <span className="font-medium text-gray-700">
            {wordCount.toLocaleString()}
          </span>
          <span>words</span>
        </div>
        <div className="h-3 w-px bg-gray-300" />
        <div className="flex items-center gap-1">
          <span className="font-medium text-gray-700">
            {charCount.toLocaleString()}
          </span>
          <span>characters</span>
        </div>
        <div className="h-3 w-px bg-gray-300" />
        <div className="flex items-center gap-1">
          <span>~</span>
          <span className="font-medium text-gray-700">{pageCount}</span>
          <span>{pageCount === 1 ? 'page' : 'pages'}</span>
        </div>
      </div>

      {/* ── Center: save status ── */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5">
        <div
          className={cn(
            'h-2 w-2 rounded-full flex-shrink-0',
            statusConfig.dotClass,
          )}
        />
        <StatusIcon
          className={cn(
            'h-3.5 w-3.5',
            saveStatus === 'saved' && 'text-emerald-500',
            saveStatus === 'saving' && 'text-amber-500',
            saveStatus === 'unsaved' && 'text-orange-500',
            saveStatus === 'error' && 'text-red-500',
          )}
        />
        <span
          className={cn(
            'font-medium',
            saveStatus === 'saved' && 'text-emerald-600',
            saveStatus === 'saving' && 'text-amber-600',
            saveStatus === 'unsaved' && 'text-orange-600',
            saveStatus === 'error' && 'text-red-600',
          )}
        >
          {statusConfig.label}
        </span>
        {saveStatus === 'saved' && lastSavedAt && (
          <span className="text-gray-400">· {formatLastSaved(lastSavedAt)}</span>
        )}
      </div>

      {/* ── Right: version + history ── */}
      <div className="flex items-center gap-2">
        <span className="text-gray-400">
          Version{' '}
          <span className="font-semibold text-gray-600">
            {currentVersion}
          </span>
        </span>
        <Separator orientation="vertical" className="h-4" />
        <Button
          variant="ghost"
          size="sm"
          onClick={onViewHistory}
          className="h-6 gap-1.5 px-2 text-xs text-[#2b6cb0] hover:bg-[#ebf4ff] hover:text-[#1a365d]"
        >
          <History className="h-3.5 w-3.5" />
          History
        </Button>
      </div>
    </div>
  );
}
