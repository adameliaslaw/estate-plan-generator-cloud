/**
 * TemplateComparePanel.tsx
 *
 * Side-by-side comparison panel that shows the pre-enhancement template
 * baseline alongside the current AI-enhanced document content.
 *
 * Architecture:
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  ← Close   Side-by-Side Comparison                      │
 *   ├──────────────────────┬───────────────────────────────────┤
 *   │   Template Draft     │   AI-Enhanced Draft               │
 *   │   (read-only HTML)   │   (read-only HTML)                │
 *   │                      │                                   │
 *   │   Synchronized       │   Synchronized                    │
 *   │   scrolling          │   scrolling                       │
 *   └──────────────────────┴───────────────────────────────────┘
 *
 * Only rendered when the document has a templateBaseline field
 * (hybrid-generated documents where AI enhancement ran).
 */

import { useRef, useCallback, useState } from 'react';
import {
  X,
  Columns,
  FileText,
  Sparkles,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TemplateComparePanelProps {
  open: boolean;
  onClose: () => void;
  templateBaseline: string;
  currentContent: string;
  documentTitle: string;
}

export default function TemplateComparePanel({
  open,
  onClose,
  templateBaseline,
  currentContent,
  documentTitle,
}: TemplateComparePanelProps) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const scrollingRef = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Synchronized scrolling
  const handleScroll = useCallback(
    (source: 'left' | 'right') => {
      if (scrollingRef.current) return;
      scrollingRef.current = true;

      const sourceEl = source === 'left' ? leftRef.current : rightRef.current;
      const targetEl = source === 'left' ? rightRef.current : leftRef.current;

      if (sourceEl && targetEl) {
        const scrollRatio =
          sourceEl.scrollTop /
          (sourceEl.scrollHeight - sourceEl.clientHeight || 1);
        targetEl.scrollTop =
          scrollRatio * (targetEl.scrollHeight - targetEl.clientHeight);
      }

      requestAnimationFrame(() => {
        scrollingRef.current = false;
      });
    },
    [],
  );

  if (!open) return null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex flex-col bg-gray-50',
        !isFullscreen && 'inset-y-0 right-0 left-0',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <Columns className="h-5 w-5 text-[#2b6cb0]" />
          <div>
            <h2 className="text-sm font-semibold text-[#1a365d]">
              Side-by-Side Comparison
            </h2>
            <p className="text-xs text-gray-500">{documentTitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-gray-500 hover:text-gray-700"
            onClick={() => setIsFullscreen((prev) => !prev)}
          >
            {isFullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-gray-500 hover:text-gray-700"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
            Close
          </Button>
        </div>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-2 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-r border-gray-200 px-5 py-2">
          <FileText className="h-4 w-4 text-amber-600" />
          <span className="text-xs font-semibold text-amber-800">
            Template Draft
          </span>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
            Before AI Enhancement
          </span>
        </div>
        <div className="flex items-center gap-2 px-5 py-2">
          <Sparkles className="h-4 w-4 text-emerald-600" />
          <span className="text-xs font-semibold text-emerald-800">
            AI-Enhanced Draft
          </span>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            Current Version
          </span>
        </div>
      </div>

      {/* Side-by-side content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Template baseline */}
        <div
          ref={leftRef}
          className="flex-1 overflow-y-auto border-r border-gray-200 bg-white"
          onScroll={() => handleScroll('left')}
        >
          <div className="legal-editor-content compare-pane mx-auto max-w-[850px] px-12 py-10">
            <div dangerouslySetInnerHTML={{ __html: templateBaseline }} />
          </div>
        </div>

        {/* Right: AI-enhanced content */}
        <div
          ref={rightRef}
          className="flex-1 overflow-y-auto bg-white"
          onScroll={() => handleScroll('right')}
        >
          <div className="legal-editor-content compare-pane mx-auto max-w-[850px] px-12 py-10">
            <div dangerouslySetInnerHTML={{ __html: currentContent }} />
          </div>
        </div>
      </div>

      {/* Footer hint */}
      <div className="border-t border-gray-200 bg-gray-50 px-5 py-2 text-center">
        <p className="text-[11px] text-gray-400">
          Scroll is synchronized between panels. The template draft shows the
          Handlebars-rendered output before AI enhancement.
        </p>
      </div>
    </div>
  );
}
