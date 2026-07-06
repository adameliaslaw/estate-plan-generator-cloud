/**
 * FindReplaceDialog.tsx
 *
 * Floating find-and-replace panel for the legal document editor.
 * Not a blocking modal — stays open while the user edits.
 *
 * Features:
 *   - Find input with Next / Previous navigation
 *   - Match count indicator (e.g. "3 of 12")
 *   - Replace input with Replace / Replace All
 *   - Case-sensitive toggle
 *   - Keyboard shortcuts: Enter = next, Shift+Enter = previous, Escape = close
 *
 * Implementation note:
 *   TipTap does not ship a built-in search/highlight extension in starter-kit.
 *   We implement search by scanning the document's text content and using
 *   editor.commands to navigate. For real-time highlighting we mark matches
 *   in the editor HTML via a custom decoration approach — we apply a CSS
 *   class by temporarily focusing each match position.
 *
 *   A full custom search extension would require @tiptap/pm primitives.
 *   This component uses a pragmatic approach: build a list of match positions
 *   from the raw text, then use replaceRange on the Prosemirror transaction.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { type Editor } from '@tiptap/react';
import {
  X,
  ChevronUp,
  ChevronDown,
  Replace,
  CaseSensitive,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FindReplaceDialogProps {
  editor: Editor | null;
  open: boolean;
  onClose: () => void;
}

interface MatchPosition {
  from: number;
  to: number;
  text: string;
}

// ── Helper: find all matches in the Prosemirror doc ───────────────────────────

function findMatches(
  editor: Editor,
  query: string,
  caseSensitive: boolean,
): MatchPosition[] {
  if (!query) return [];

  const matches: MatchPosition[] = [];
  const { doc } = editor.state;
  const flags = caseSensitive ? 'g' : 'gi';

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text;
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        from: pos + match.index,
        to: pos + match.index + match[0].length,
        text: match[0],
      });
    }
  });

  return matches;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FindReplaceDialog({
  editor,
  open,
  onClose,
}: FindReplaceDialogProps) {
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matches, setMatches] = useState<MatchPosition[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [replaceCount, setReplaceCount] = useState<number | null>(null);

  const findInputRef = useRef<HTMLInputElement>(null);

  // ── Focus input on open ──
  useEffect(() => {
    if (open) {
      setTimeout(() => findInputRef.current?.focus(), 50);
      setReplaceCount(null);
    }
  }, [open]);

  // ── Recompute matches whenever query or case changes ──
  useEffect(() => {
    if (!editor || !findText) {
      setMatches([]);
      setCurrentIndex(0);
      return;
    }
    const found = findMatches(editor, findText, caseSensitive);
    setMatches(found);
    setCurrentIndex(found.length > 0 ? 0 : -1);
    setReplaceCount(null);
  }, [findText, caseSensitive, editor]);

  // ── Navigate to a specific match ──
  const navigateTo = useCallback(
    (index: number) => {
      if (!editor || matches.length === 0) return;
      const match = matches[index];
      if (!match) return;

      // Set text selection to the match position
      editor
        .chain()
        .focus()
        .setTextSelection({ from: match.from, to: match.to })
        .run();

      // Scroll the editor to show the selection
      const editorEl = editor.view.dom as HTMLElement;
      const coords = editor.view.coordsAtPos(match.from);
      const editorRect = editorEl.getBoundingClientRect();
      const scrollParent = editorEl.closest('.legal-editor-wrap');
      if (scrollParent) {
        const scrollTop = scrollParent.scrollTop + coords.top - editorRect.top - 200;
        scrollParent.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
      }
    },
    [editor, matches],
  );

  const goToNext = useCallback(() => {
    if (matches.length === 0) return;
    const next = (currentIndex + 1) % matches.length;
    setCurrentIndex(next);
    navigateTo(next);
  }, [currentIndex, matches, navigateTo]);

  const goToPrev = useCallback(() => {
    if (matches.length === 0) return;
    const prev = (currentIndex - 1 + matches.length) % matches.length;
    setCurrentIndex(prev);
    navigateTo(prev);
  }, [currentIndex, matches, navigateTo]);

  // ── Navigate to first match when matches found ──
  useEffect(() => {
    if (matches.length > 0) {
      navigateTo(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches]);

  // ── Replace current match ──
  const replaceCurrent = useCallback(() => {
    if (!editor || !findText) return;

    // Recompute against the LIVE document. The `matches` state is only refreshed
    // on query/case change, but this panel is non-modal — the user can edit the
    // document between searching and clicking Replace, which makes the cached
    // from/to offsets point at a different (possibly off-screen) span and
    // corrupts the wrong text in the legal document (R5-025).
    const fresh = findMatches(editor, findText, caseSensitive);
    if (fresh.length === 0) {
      setMatches([]);
      setCurrentIndex(-1);
      return;
    }
    const idx = currentIndex >= 0 && currentIndex < fresh.length ? currentIndex : 0;
    const match = fresh[idx];
    editor
      .chain()
      .focus()
      .setTextSelection({ from: match.from, to: match.to })
      .insertContent(replaceText)
      .run();

    setReplaceCount(null);
    // Recompute matches after replacement
    const newMatches = findMatches(editor, findText, caseSensitive);
    setMatches(newMatches);
    const nextIndex = Math.min(idx, newMatches.length - 1);
    setCurrentIndex(nextIndex);
    if (nextIndex >= 0) navigateTo(nextIndex);
  }, [editor, currentIndex, replaceText, findText, caseSensitive, navigateTo]);

  // ── Replace all matches ──
  const replaceAll = useCallback(() => {
    if (!editor || !findText) return;

    const allMatches = findMatches(editor, findText, caseSensitive);
    if (allMatches.length === 0) return;

    // Replace from end to start to preserve positions
    const sorted = [...allMatches].sort((a, b) => b.from - a.from);
    let tr = editor.state.tr;
    for (const m of sorted) {
      tr = tr.replaceWith(m.from, m.to, editor.schema.text(replaceText));
    }
    editor.view.dispatch(tr);
    editor.commands.focus();

    setReplaceCount(allMatches.length);
    setMatches([]);
    setCurrentIndex(-1);
  }, [editor, findText, replaceText, caseSensitive]);

  // ── Keyboard handling ──
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        editor?.commands.focus();
      } else if (e.key === 'Enter') {
        if (e.shiftKey) {
          goToPrev();
        } else {
          goToNext();
        }
        e.preventDefault();
      }
    },
    [onClose, editor, goToNext, goToPrev],
  );

  if (!open) return null;

  const hasQuery = findText.length > 0;
  const hasMatches = matches.length > 0;
  const noMatches = hasQuery && matches.length === 0;
  const matchLabel = hasMatches
    ? `${currentIndex + 1} of ${matches.length}`
    : noMatches
    ? 'No results'
    : '';

  return (
    <div
      className="find-replace-panel absolute right-4 top-16 z-50 w-[400px] rounded-lg border border-gray-200 bg-white shadow-xl"
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#1a365d]">
          <Search className="h-4 w-4 text-[#2b6cb0]" />
          Find & Replace
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-md hover:bg-gray-100"
          onClick={() => {
            onClose();
            editor?.commands.focus();
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-4 space-y-3">
        {/* Find row */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Input
              ref={findInputRef}
              placeholder="Find…"
              value={findText}
              onChange={(e) => setFindText(e.target.value)}
              className={cn(
                'pr-20 text-sm h-8',
                noMatches && 'border-red-300 bg-red-50 focus-visible:ring-red-300',
              )}
            />
            {/* Match count badge */}
            {hasQuery && (
              <span
                className={cn(
                  'absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium',
                  noMatches ? 'text-red-500' : 'text-gray-400',
                )}
              >
                {matchLabel}
              </span>
            )}
          </div>

          {/* Case-sensitive toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                pressed={caseSensitive}
                onPressedChange={setCaseSensitive}
                className={cn(
                  'h-8 w-8 p-0 border rounded-md',
                  caseSensitive
                    ? 'border-[#2b6cb0] bg-[#ebf4ff] text-[#2b6cb0]'
                    : 'border-gray-200 bg-white text-gray-400',
                )}
                aria-label="Case sensitive"
              >
                <CaseSensitive className="h-4 w-4" />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>Case sensitive</p>
            </TooltipContent>
          </Tooltip>

          {/* Previous */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={goToPrev}
                disabled={!hasMatches}
                aria-label="Previous match"
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>Previous (Shift+Enter)</p>
            </TooltipContent>
          </Tooltip>

          {/* Next */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={goToNext}
                disabled={!hasMatches}
                aria-label="Next match"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>Next (Enter)</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <Separator />

        {/* Replace row */}
        <div className="flex items-center gap-2">
          <Input
            placeholder="Replace with…"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            className="flex-1 text-sm h-8"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 px-3 text-xs whitespace-nowrap"
                onClick={replaceCurrent}
                disabled={!hasMatches}
              >
                <Replace className="h-3.5 w-3.5" />
                Replace
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>Replace current match</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="default"
                size="sm"
                className="h-8 gap-1.5 px-3 text-xs whitespace-nowrap bg-[#2b6cb0] hover:bg-[#1a365d]"
                onClick={replaceAll}
                disabled={!hasMatches && !hasQuery}
              >
                All
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>Replace all matches</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Replace count feedback */}
        {replaceCount !== null && (
          <div className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700 border border-emerald-200">
            <Replace className="h-3.5 w-3.5" />
            Replaced{' '}
            <Badge
              variant="secondary"
              className="h-4 px-1 text-xs bg-emerald-100 text-emerald-700"
            >
              {replaceCount}
            </Badge>{' '}
            {replaceCount === 1 ? 'occurrence' : 'occurrences'}
          </div>
        )}

        {/* Keyboard hints */}
        <div className="text-xs text-gray-400 pt-0.5">
          <kbd className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px]">Enter</kbd> next
          &nbsp;&nbsp;
          <kbd className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px]">Shift+Enter</kbd> previous
          &nbsp;&nbsp;
          <kbd className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px]">Esc</kbd> close
        </div>
      </div>
    </div>
  );
}
