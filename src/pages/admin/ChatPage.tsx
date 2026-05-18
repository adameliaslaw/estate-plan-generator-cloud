/**
 * src/pages/admin/ChatPage.tsx
 *
 * Two-panel RAG research interface.
 *  Left  (70%) — Chat + streaming response
 *  Right (30%) — Citations panel with separate sections for
 *                reference/work-product and client-files (RPC 1.6)
 *
 * Document drafting lives in the Client Dashboard → Draft tab.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Bot, User, AlertCircle, BookOpen, Upload, ShieldCheck, AlertTriangle, HelpCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { streamRagChat, streamClientFilesChat, type Citation } from '@/services/rag-chat-service';
import { verifyCitations, type CitationResult } from '@/services/citation-verifier-service';
import { UploadDocumentModal } from '@/components/chat/UploadDocumentModal';
import { useAuth } from '@/hooks/useAuth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  source?: 'research' | 'client-files';
}

// ---------------------------------------------------------------------------
// Namespace badge colours
// ---------------------------------------------------------------------------
const NS_COLOURS: Record<string, string> = {
  reference:      'bg-blue-50 text-blue-700 border border-blue-200',
  'work-product': 'bg-purple-50 text-purple-700 border border-purple-200',
  'client-files': 'bg-emerald-50 text-emerald-700 border border-emerald-200',
};

function nsBadge(ns: string): string {
  return NS_COLOURS[ns] ?? 'bg-gray-100 text-gray-600 border border-gray-200';
}

// Detects common US reporter abbreviations — used to skip API call when
// the response contains no legal citations at all.
const QUICK_CITATION_RE = /\b\d{1,4}\s+(?:F\.|U\.S\.|S\.\s*Ct\.|N\.J\.|A\.\d|P\.\d|B\.R\.)/i;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LegalCitationBadge({ result }: { result: CitationResult }) {
  const statusEl =
    result.status === 'verified' ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200 shrink-0">
        <ShieldCheck className="h-2.5 w-2.5" /> Verified
      </span>
    ) : result.status === 'not_found' ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-200 shrink-0">
        <AlertTriangle className="h-2.5 w-2.5" /> Not found
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200 shrink-0">
        <HelpCircle className="h-2.5 w-2.5" /> Check
      </span>
    );

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 shadow-sm">
      <div className="min-w-0">
        <code className="block truncate text-[11px] font-mono text-gray-700">{result.raw}</code>
        {result.status === 'verified' && result.caseName && (
          <p className="truncate text-[10px] text-gray-400 mt-0.5">{result.caseName}</p>
        )}
      </div>
      {statusEl}
    </div>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end gap-3">
      <div className="max-w-[78%] rounded-2xl rounded-tr-sm bg-[#1a365d] px-4 py-3 text-sm text-white shadow-sm">
        <p className="whitespace-pre-wrap leading-relaxed">{content}</p>
      </div>
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2b6cb0] text-white">
        <User className="h-3.5 w-3.5" />
      </div>
    </div>
  );
}

function AssistantBubble({
  content,
  isStreaming,
  source = 'research',
}: {
  content: string;
  isStreaming?: boolean;
  source?: 'research' | 'client-files';
}) {
  const isClientFiles = source === 'client-files';
  return (
    <div className="flex justify-start gap-3">
      <div
        className={cn(
          'mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1',
          isClientFiles
            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
            : 'bg-gray-100 text-gray-600 ring-gray-200',
        )}
      >
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div
        className={cn(
          'max-w-[78%] rounded-2xl rounded-tl-sm border px-4 py-3 text-sm text-gray-900 shadow-sm',
          isClientFiles ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200 bg-white',
        )}
      >
        {isClientFiles && (
          <div className="mb-2 inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
            From Client Files
          </div>
        )}
        {content ? (
          <div className="prose prose-sm prose-gray max-w-none leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        ) : (
          isStreaming && (
            <span className="flex gap-1">
              <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
            </span>
          )
        )}
      </div>
    </div>
  );
}

function CitationCard({ citation, rank }: { citation: Citation; rank: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm space-y-2">
      <div className="flex items-start gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1a365d] text-[10px] font-bold text-white">
          {rank}
        </span>
        <p className="flex-1 truncate text-xs font-semibold text-gray-900" title={citation.documentName}>
          {citation.documentName || 'Untitled document'}
        </p>
        {citation.pageNumber != null && (
          <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
            p.{citation.pageNumber}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className={cn('inline-block rounded px-1.5 py-0.5 text-[10px] font-medium', nsBadge(citation.namespace))}>
          {citation.namespace}
        </span>
        {citation.section && (
          <span className="inline-block rounded bg-gray-50 border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600 truncate max-w-[140px]" title={citation.section}>
            {citation.section}
          </span>
        )}
      </div>

      {citation.excerpt && (
        <p className="line-clamp-4 text-[11px] leading-relaxed text-gray-500">
          {citation.excerpt}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function ChatPage() {
  const { userProfile } = useAuth();
  const firmId = userProfile?.firmId ?? '';

  const [messages, setMessages]                 = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [citations, setCitations]               = useState<Citation[]>([]);
  const [clientFilesCitations, setClientFilesCitations] = useState<Citation[]>([]);
  const [clientFilesStreaming, setClientFilesStreaming] = useState(false);
  const [input, setInput]                       = useState('');
  const [isStreaming, setIsStreaming]           = useState(false);
  const [error, setError]                       = useState<string | null>(null);
  const [uploadOpen, setUploadOpen]             = useState(false);
  const [legalCitationResults, setLegalCitationResults] = useState<CitationResult[] | null>(null);
  const [legalCitationsChecking, setLegalCitationsChecking] = useState(false);

  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef    = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const handleSubmit = useCallback(async () => {
    const query = input.trim();
    if (!query || isStreaming) return;

    setInput('');
    setError(null);
    setIsStreaming(true);
    setStreamingContent('');
    setClientFilesCitations([]);
    setLegalCitationResults(null);
    setLegalCitationsChecking(false);
    abortRef.current = false;

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: query };
    setMessages((prev) => [...prev, userMsg]);

    let accumulated = '';

    // Fire client-files stream in background. RPC 1.6 isolation: the answer
    // is rendered as a SEPARATE assistant bubble labeled "From Client Files"
    // so the privilege boundary stays visually explicit.
    let clientFilesAccumulated = '';
    setClientFilesStreaming(true);
    void streamClientFilesChat(query, {
      onCitations: (data) => setClientFilesCitations(data),
      onChunk: (text) => {
        clientFilesAccumulated += text;
      },
      onDone: () => {
        if (clientFilesAccumulated.trim()) {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: clientFilesAccumulated,
              source: 'client-files',
            },
          ]);
        }
        setClientFilesStreaming(false);
      },
      onError: (msg) => {
        console.warn('[clientFilesChat] failed:', msg);
        setClientFilesStreaming(false);
      },
    }).catch((err) => {
      console.warn('[clientFilesChat] stream error:', err);
      setClientFilesStreaming(false);
    });

    // Research stream drives the main chat UI
    try {
      await streamRagChat(query, {
        onCitations: (data) => setCitations(data),
        onChunk: (text) => {
          if (abortRef.current) return;
          accumulated += text;
          setStreamingContent(accumulated);
        },
        onDone: () => {
          if (abortRef.current) return;
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: 'assistant', content: accumulated },
          ]);
          setStreamingContent('');
          setIsStreaming(false);
          if (firmId && QUICK_CITATION_RE.test(accumulated)) {
            setLegalCitationsChecking(true);
            verifyCitations(firmId, accumulated)
              .then((r) => setLegalCitationResults(r.citations))
              .catch(() => {})
              .finally(() => setLegalCitationsChecking(false));
          }
        },
        onError: (message) => {
          setError(message);
          setIsStreaming(false);
          setStreamingContent('');
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unexpected error';
      setError(msg);
      setIsStreaming(false);
      setStreamingContent('');
    }
  }, [input, isStreaming, firmId]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  const isEmpty = messages.length === 0 && !isStreaming;
  const totalCitations = citations.length + clientFilesCitations.length;

  return (
    <>
      <UploadDocumentModal open={uploadOpen} onOpenChange={setUploadOpen} />
      <div className="flex h-full min-h-0 overflow-hidden">
        {/* ── Left panel ──────────────────────────────────────────────────── */}
        <div className="flex flex-[7] flex-col min-h-0 border-r border-gray-200 bg-gray-50">

          {/* Header */}
          <div className="flex items-center gap-2.5 border-b border-gray-200 bg-white px-5 py-3.5 shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1a365d]">
              <Bot className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1">
              <h1 className="text-sm font-semibold text-gray-900">Research Assistant</h1>
              <p className="text-[11px] text-gray-500">Powered by PageIndex · CourtListener</p>
            </div>
            <button
              onClick={() => setUploadOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:border-[#2b6cb0] hover:text-[#1a365d] transition-colors"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload Document
            </button>
          </div>

          {/* Messages */}
          <>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-5 py-6 space-y-5 min-h-0">
                {isEmpty && (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#1a365d]/10">
                      <Bot className="h-8 w-8 text-[#1a365d]" />
                    </div>
                    <h2 className="mt-4 text-base font-semibold text-gray-900">
                      Estate Planning Research
                    </h2>
                    <p className="mt-1.5 max-w-sm text-sm text-gray-500">
                      Ask any question about estate planning law. I'll search your reference
                      library, work product, and client files, then answer using only those
                      sources.
                    </p>
                    <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2 text-left max-w-md">
                      {[
                        'What are the NJ requirements for a valid will?',
                        'How does a pour-over will work with a revocable trust?',
                        'What is the NJ estate tax exemption amount?',
                        'Explain Medicaid look-back period rules.',
                      ].map((suggestion) => (
                        <button
                          key={suggestion}
                          onClick={() => setInput(suggestion)}
                          className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left text-xs text-gray-600 shadow-sm hover:border-[#2b6cb0] hover:text-[#1a365d] transition-colors"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((msg) =>
                  msg.role === 'user' ? (
                    <UserBubble key={msg.id} content={msg.content} />
                  ) : (
                    <AssistantBubble key={msg.id} content={msg.content} source={msg.source} />
                  ),
                )}

                {isStreaming && <AssistantBubble content={streamingContent} isStreaming />}

                {clientFilesStreaming && (
                  <AssistantBubble content="" source="client-files" isStreaming />
                )}

                {error && (
                  <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>{error}</p>
                  </div>
                )}

                <div ref={bottomRef} />
              </div>

              {/* Input bar */}
              <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3">
                <div className="flex items-end gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 shadow-sm focus-within:border-[#2b6cb0] focus-within:ring-1 focus-within:ring-[#2b6cb0] transition-shadow">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask a question… (Enter to send, Shift+Enter for new line)"
                    rows={1}
                    disabled={isStreaming}
                    className="flex-1 resize-none bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none disabled:opacity-60"
                    style={{ minHeight: '24px', maxHeight: '160px' }}
                  />
                  <button
                    onClick={() => void handleSubmit()}
                    disabled={isStreaming || !input.trim()}
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                      isStreaming || !input.trim()
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-[#1a365d] text-white hover:bg-[#2b6cb0]',
                    )}
                    aria-label="Send"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="mt-1.5 text-[10px] text-gray-400 text-center">
                  Answers are based solely on your indexed documents. Always verify independently.
                </p>
              </div>
          </>
        </div>

        {/* ── Right panel — citations (30%) ────────────────────────────────── */}
        <div className="flex flex-[3] flex-col min-h-0 bg-white">
          <div className="shrink-0 flex items-center gap-2 border-b border-gray-200 px-4 py-3.5">
            <BookOpen className="h-4 w-4 text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-700">Sources</h2>
            {totalCitations > 0 && (
              <span className="ml-auto rounded-full bg-[#1a365d] px-2 py-0.5 text-[10px] font-semibold text-white">
                {totalCitations}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4">
            {totalCitations === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <BookOpen className="h-8 w-8 text-gray-200" />
                <p className="mt-3 text-xs text-gray-400">
                  Source documents will appear here after each response, ranked by
                  relevance.
                </p>
              </div>
            ) : (
              <>
                {/* Reference + work-product citations */}
                {citations.length > 0 && (
                  <div className="space-y-3">
                    {citations.map((citation, i) => (
                      <CitationCard key={i} citation={citation} rank={i + 1} />
                    ))}
                  </div>
                )}

                {/* Client-files citations — RPC 1.6 isolated section */}
                {clientFilesCitations.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="h-px flex-1 bg-emerald-100" />
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
                        Client Files
                      </span>
                      <div className="h-px flex-1 bg-emerald-100" />
                    </div>
                    <div className="space-y-3">
                      {clientFilesCitations.map((citation, i) => (
                        <CitationCard key={i} citation={citation} rank={i + 1} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Legal citation health — auto-verified after each research response */}
            {(legalCitationsChecking || (legalCitationResults !== null && legalCitationResults.length > 0)) && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-gray-100" />
                  <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    <ShieldCheck className="h-3 w-3" />
                    Citation Health
                  </span>
                  <div className="h-px flex-1 bg-gray-100" />
                </div>
                {legalCitationsChecking ? (
                  <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Checking citations against CourtListener…
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {legalCitationResults!.map((result, i) => (
                      <LegalCitationBadge key={i} result={result} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {totalCitations > 0 && (
            <div className="shrink-0 border-t border-gray-200 px-4 py-2.5">
              <p className="text-[10px] text-gray-400">
                Scores reflect document relevance across{' '}
                <span className="font-medium">reference</span>,{' '}
                <span className="font-medium">work-product</span>, and{' '}
                <span className="font-medium text-emerald-600">client-files</span> namespaces.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
