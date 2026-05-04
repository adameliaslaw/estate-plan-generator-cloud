/**
 * src/components/chat/DraftTab.tsx
 *
 * Draft generation tab — select a prior work-product document as a style
 * reference, enter drafting instructions, and stream a new draft from Claude.
 *
 * Documents are listed from Firestore pageindex_docs/work-product/files.
 */

import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getFirestore, collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { FileEdit, AlertCircle, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { streamDraftChat } from '@/services/rag-chat-service';

interface WorkProductDoc {
  id: string;
  fileName: string;
  doc_id: string;
}

export function DraftTab() {
  const [docs, setDocs]               = useState<WorkProductDoc[]>([]);
  const [selectedId, setSelectedId]   = useState('');
  const [instructions, setInstructions] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [isStreaming, setIsStreaming]   = useState(false);
  const [error, setError]               = useState<string | null>(null);

  const bottomRef  = useRef<HTMLDivElement>(null);
  const abortRef   = useRef(false);

  // Subscribe to work-product docs from Firestore
  useEffect(() => {
    const db   = getFirestore();
    const col  = collection(db, 'pageindex_docs/work-product/files');
    const q    = query(col, orderBy('uploadedAt', 'desc'));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: WorkProductDoc[] = snap.docs.map((d) => ({
          id: d.id,
          fileName: (d.data() as { fileName: string; doc_id: string }).fileName,
          doc_id: (d.data() as { fileName: string; doc_id: string }).doc_id,
        }));
        setDocs(list);
        if (list.length > 0 && !selectedId) setSelectedId(list[0].doc_id);
      },
      (err) => console.error('[DraftTab] Firestore error:', err),
    );

    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll as draft streams in
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [draftContent]);

  async function handleGenerate() {
    if (!selectedId || !instructions.trim() || isStreaming) return;

    setDraftContent('');
    setError(null);
    setIsStreaming(true);
    abortRef.current = false;

    let accumulated = '';

    try {
      await streamDraftChat(selectedId, instructions.trim(), {
        onCitations: () => {},
        onChunk: (text) => {
          if (abortRef.current) return;
          accumulated += text;
          setDraftContent(accumulated);
        },
        onDone: () => {
          setIsStreaming(false);
        },
        onError: (message) => {
          setError(message);
          setIsStreaming(false);
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
      setIsStreaming(false);
    }
  }

  const canGenerate = !!selectedId && !!instructions.trim() && !isStreaming;

  // Empty state — no docs indexed
  if (docs.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center px-8 py-12">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-50">
          <FileEdit className="h-7 w-7 text-purple-400" />
        </div>
        <h3 className="mt-4 text-sm font-semibold text-gray-900">No work-product documents indexed</h3>
        <p className="mt-1.5 max-w-xs text-xs text-gray-500">
          Upload prior memos, briefs, or templates via the Upload Document button to use as
          drafting references.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Controls */}
      <div className="shrink-0 border-b border-gray-200 bg-white p-4 space-y-3">
        {/* Document picker */}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-gray-700">Style reference document</label>
          <div className="relative">
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              disabled={isStreaming}
              className="w-full appearance-none rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm text-gray-900 focus:border-[#2b6cb0] focus:outline-none focus:ring-1 focus:ring-[#2b6cb0] disabled:opacity-60"
            >
              {docs.map((d) => (
                <option key={d.doc_id} value={d.doc_id}>
                  {d.fileName}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-gray-400" />
          </div>
        </div>

        {/* Instructions */}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-gray-700">Drafting instructions</label>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            disabled={isStreaming}
            placeholder="e.g. Draft a revocable living trust for John and Jane Smith, married couple, two adult children…"
            rows={3}
            className="w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#2b6cb0] focus:outline-none focus:ring-1 focus:ring-[#2b6cb0] disabled:opacity-60"
          />
        </div>

        <button
          onClick={() => void handleGenerate()}
          disabled={!canGenerate}
          className={cn(
            'w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors',
            canGenerate
              ? 'bg-[#1a365d] text-white hover:bg-[#2b6cb0]'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed',
          )}
        >
          {isStreaming ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Drafting…
            </span>
          ) : (
            'Generate Draft'
          )}
        </button>
      </div>

      {/* Draft output */}
      <div className="flex-1 overflow-y-auto px-5 py-5 min-h-0">
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 mb-4">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {draftContent ? (
          <div className="prose prose-sm prose-gray max-w-none leading-relaxed rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{draftContent}</ReactMarkdown>
            {isStreaming && (
              <span className="inline-flex gap-1 mt-2">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
              </span>
            )}
          </div>
        ) : !isStreaming && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <FileEdit className="h-8 w-8 text-gray-200" />
            <p className="mt-3 text-xs text-gray-400 max-w-xs">
              Select a reference document, enter your instructions, and click Generate Draft.
            </p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {!isStreaming && draftContent && (
        <div className="shrink-0 border-t border-gray-200 px-4 py-2.5">
          <p className="text-[10px] text-gray-400">
            Draft generated from style reference. Review carefully before use — always verify legal accuracy.
          </p>
        </div>
      )}
    </div>
  );
}
