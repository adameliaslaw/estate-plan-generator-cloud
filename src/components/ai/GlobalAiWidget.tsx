/**
 * GlobalAiWidget.tsx
 *
 * Floating AI chat widget with two modes:
 *  - Chat (default): General estate planning Q&A
 *  - Draft: Conversational document drafting assistant
 *
 * Features:
 *  - Persistent conversations (survive page refresh)
 *  - Conversation history sidebar
 *  - Full client context in all modes
 *  - Memory-augmented AI responses
 *  - @mention client tagging from any page
 */

import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { Bot, X, Maximize2, Minimize2, Send, FileText, PenTool, History, Plus, ChevronLeft, Bookmark, AtSign, UserCheck, FolderOpen, Search, ExternalLink, BookOpen } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { collection, getDocs, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { cn, isHttpUrl } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { functions, db } from '@/config/firebase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { DOC_TYPES } from '@/config/constants';
import { knowledgeBaseService } from '@/services/knowledge-base-service';

interface ClientOption {
  id: string;
  name: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isDraft?: boolean;
  draftTitle?: string;
  citations?: string[];
}

interface ConversationSummary {
  id: string;
  title: string;
  lastMessage: string;
  mode: string;
  messageCount: number;
  clientId?: string;
  updatedAt: string;
}

const DOC_TYPE_SELECT = Object.entries(DOC_TYPES).map(([, value]) => ({
  value,
  label: value.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim(),
}));

const WELCOME_MSG = (mode: 'chat' | 'draft' | 'research', hasClient?: boolean): Message => ({
  id: 'welcome-' + Date.now(),
  role: 'assistant',
  content: mode === 'draft'
    ? `📝 Drafting Mode active. I'll help you draft a document. ${hasClient ? 'I can see the client context.' : 'Type **@ClientName** to connect a client, or navigate to their profile.'}\n\nSelect a document type above, then tell me what you'd like. When ready, say "generate" or "draft it" and I'll produce the document.`
    : mode === 'research'
      ? '🔍 **Research Mode** — powered by Perplexity.\n\nAsk me any legal research question and I\'ll provide grounded answers with source citations. Great for:\n• Statute lookups and case law\n• Current tax thresholds and exemptions\n• Comparative state law analysis\n• Regulatory updates and pending legislation'
      : 'Hello! I am your Estate Planning AI Assistant. I have context about your firm, clients, knowledge base, and templates.\n\n💡 **Tip:** Type **@ClientName** to connect a client from anywhere!',
  timestamp: new Date(),
});

// Collapsible citation block for research responses
function CitationBlock({ citations }: { citations: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? citations : citations.slice(0, 3);
  const hasMore = citations.length > 3;

  return (
    <div className="mt-2 border-t border-gray-100 pt-2">
      <div className="flex items-center gap-1 mb-1">
        <Search className="h-3 w-3 text-emerald-600" />
        <span className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">
          Sources ({citations.length})
        </span>
      </div>
      <div className="space-y-0.5">
        {visible.filter(isHttpUrl).map((url, i) => {
          let hostname = '';
          try {
            hostname = new URL(url).hostname.replace('www.', '');
          } catch {
            hostname = url.slice(0, 40);
          }
          return (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] text-blue-600 hover:bg-blue-50 hover:text-blue-800 transition-colors truncate"
            >
              <ExternalLink className="h-2.5 w-2.5 shrink-0" />
              <span className="font-medium">[{i + 1}]</span>
              <span className="truncate">{hostname}</span>
            </a>
          );
        })}
      </div>
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-[10px] font-medium text-gray-500 hover:text-emerald-600 transition-colors"
        >
          {expanded ? '▲ Show fewer' : `▼ Show all ${citations.length} sources`}
        </button>
      )}
    </div>
  );
}

export function GlobalAiWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([WELCOME_MSG('chat')]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Conversation persistence
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [showHistory, setShowHistory] = useState(false);
  const [pastConversations, setPastConversations] = useState<ConversationSummary[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Drafting mode state
  const [mode, setMode] = useState<'chat' | 'draft' | 'research'>('chat');
  const [draftDocType, setDraftDocType] = useState('will');

  // @mention client tagging
  const [mentionedClient, setMentionedClient] = useState<ClientOption | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [highlightedMentionIndex, setHighlightedMentionIndex] = useState(0);
  const [allClients, setAllClients] = useState<ClientOption[]>([]);
  const [clientsLoaded, setClientsLoaded] = useState(false);

  const { userProfile } = useAuth();
  const firmId = userProfile?.firmId;

  // Extract clientId from URL if on a client page
  const clientIdMatch = window.location.pathname.match(/\/clients\/([^/]+)/);
  const urlClientId = clientIdMatch?.[1] ?? undefined;
  // Effective clientId: URL takes priority, then @mention
  const clientId = urlClientId ?? mentionedClient?.id ?? undefined;

  // Auto-scroll
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, isTyping]);

  // Load client list for @mention autocomplete
  useEffect(() => {
    if (!firmId || clientsLoaded) return;
    const loadClients = async () => {
      try {
        const snap = await getDocs(collection(db, `firms/${firmId}/clients`));
        const clients: ClientOption[] = snap.docs.map((d) => {
          const data = d.data();
          const pi = data.personalInfo ?? {};
          const name = [pi.firstName, pi.lastName].filter(Boolean).join(' ') || d.id;
          return { id: d.id, name };
        }).sort((a, b) => a.name.localeCompare(b.name));
        setAllClients(clients);
        setClientsLoaded(true);
      } catch (err) {
        console.error('[GlobalAiWidget] Failed to load clients for @mention:', err);
      }
    };
    loadClients();
  }, [firmId, clientsLoaded]);

  // Filter clients based on @mention query
  const filteredClients = mentionQuery
    ? allClients.filter((c) =>
        c.name.toLowerCase().includes(mentionQuery.toLowerCase()),
      ).slice(0, 8)
    : allClients.slice(0, 8);

  // Handle @mention selection
  const selectMentionedClient = (client: ClientOption) => {
    setMentionedClient(client);
    setShowMentionDropdown(false);
    setMentionQuery('');
    // Replace @partial with @FullName in inputI
    const mentionRegex = /@[\w\s]*$/;
    const cleaned = inputValue.replace(mentionRegex, `@${client.name} `);
    setInputValue(cleaned);
    // Re-focus input
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  // Clear mentioned client
  const clearMentionedClient = () => {
    setMentionedClient(null);
  };

  // Handle input change with @mention detection
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputValue(val);

    // Detect @mention: check if there's an active @query at the cursor position
    const atMatch = val.match(/@([\w\s]*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setShowMentionDropdown(true);
      setHighlightedMentionIndex(0);
    } else {
      setShowMentionDropdown(false);
      setMentionQuery('');
      setHighlightedMentionIndex(0);
    }
  };

  // Load conversation history
  const loadHistory = useCallback(async () => {
    if (!firmId) return;
    setLoadingHistory(true);
    try {
      const fn = httpsCallable(functions, 'listAiConversations');
      const res = await fn({ firmId, clientId, limit: 20 });
      setPastConversations(res.data as ConversationSummary[]);
    } catch (err) {
      console.error('[GlobalAiWidget] Failed to load history:', err);
    } finally {
      setLoadingHistory(false);
    }
  }, [firmId, clientId]);

  // Resume a past conversation
  const resumeConversation = (conv: ConversationSummary) => {
    setConversationId(conv.id);
    setMode(conv.mode as 'chat' | 'draft');
    setMessages([{
      id: 'loading',
      role: 'assistant',
      content: `📂 Resuming conversation: "${conv.title}"...\n\nSend a message to continue.`,
      timestamp: new Date(),
    }]);
    setShowHistory(false);
  };

  // Start a new conversation
  const startNewConversation = () => {
    setConversationId(undefined);
    setMentionedClient(null);
    setMessages([WELCOME_MSG(mode, !!clientId)]);
    setShowHistory(false);
  };

  // Switch to a specific mode
  const switchMode = (newMode: 'chat' | 'draft' | 'research') => {
    if (newMode === mode) return;
    setMode(newMode);
    setConversationId(undefined);
    setMessages([WELCOME_MSG(newMode, !!clientId)]);
  };

  // Save a message as a client note
  const handleSaveAsNote = async (msg: Message) => {
    if (!firmId || !clientId) {
      toast.error('Navigate to a client profile to save notes.');
      return;
    }
    try {
      const fn = httpsCallable(functions, 'saveMessageAsNote');
      const res = await fn({
        firmId,
        clientId,
        messageContent: msg.content,
        messageRole: msg.role,
        conversationId,
      });
      const data = res.data as { title: string };
      toast.success(`Saved to Notes: ${data.title}`);
    } catch (err) {
      console.error('[GlobalAiWidget] Save as note error:', err);
      toast.error('Failed to save as note.');
    }
  };

  // Save a long AI message to the document vault
  const handleSaveToVault = async (msg: Message) => {
    if (!firmId || !clientId) {
      toast.error('Navigate to a client profile to save documents.');
      return;
    }
    if (!userProfile) {
      toast.error('You must be signed in.');
      return;
    }
    try {
      const docId = `chat_draft_${Date.now()}`;
      const docRef = doc(db, `firms/${firmId}/clients/${clientId}/documents`, docId);
      const now = serverTimestamp();

      // Use AI-provided draftTitle if available, else derive from the draft doc type,
      // and only fall back to heading extraction as a last resort.
      // Previously this grabbed the first <h1>/<h2> from the response, which often
      // pulled a "DRAFTING ISSUES" checklist heading instead of the actual document title.
      const docTypeLabel = DOC_TYPE_SELECT.find(d => d.value === draftDocType)?.label ?? draftDocType;
      const headingMatch = msg.content.match(/<h[1-2][^>]*>(.*?)<\/h[1-2]>/i)
        || msg.content.match(/^#\s+(.+)$/m);
      const extractedHeading = headingMatch?.[1]?.replace(/<[^>]*>/g, '').trim();

      // Priority: AI draftTitle > docType label > extracted heading > generic fallback
      const title = msg.draftTitle
        || (docTypeLabel !== draftDocType ? `${docTypeLabel} — ${new Date().toLocaleDateString()}` : null)
        || extractedHeading
        || `AI Draft — ${new Date().toLocaleDateString()}`;

      // Use the selected draft doc type instead of always 'custom'
      const resolvedDocType = mode === 'draft' && draftDocType ? draftDocType : 'custom';

      await setDoc(docRef, {
        id: docId,
        firmId,
        clientId,
        docType: resolvedDocType,
        displayName: title,
        status: 'draft',
        content: msg.content,
        storagePath: '',
        fileName: `${docId}.html`,
        mimeType: 'text/html',
        currentVersion: 1,
        versions: [{
          versionNumber: 1,
          storagePath: '',
          createdAt: new Date(),
          createdBy: userProfile.uid,
          changeNotes: 'Saved from AI chat conversation',
        }],
        generatedByAI: true,
        requiresSignature: false,
        notarized: false,
        tags: ['chat-draft'],
        isConfidential: true,
        createdAt: now,
        updatedAt: now,
        createdBy: userProfile.uid,
        updatedBy: userProfile.uid,
      });

      toast.success(`Saved to Document Vault: "${title}"`);
    } catch (err) {
      console.error('[GlobalAiWidget] Save to vault error:', err);
      toast.error('Failed to save to vault.');
    }
  };

  // Save a research response to the Knowledge Base
  const handleSaveToKB = async (msg: Message) => {
    if (!firmId) {
      toast.error('Firm ID is missing.');
      return;
    }
    try {
      // Extract title from first line or heading
      const titleMatch = msg.content.match(/^#+\s+(.+)$/m)
        || msg.content.match(/^\*\*(.+?)\*\*/m);
      const title = titleMatch?.[1]?.trim()
        || msg.content.split('\n')[0].slice(0, 80).trim()
        || `Research — ${new Date().toLocaleDateString()}`;

      // Append citations to the content
      let fullContent = msg.content;
      if (msg.citations && msg.citations.length > 0) {
        fullContent += '\n\n---\nSOURCES:\n' + msg.citations.map((url, i) => `[${i + 1}] ${url}`).join('\n');
      }

      const { resourceId } = await knowledgeBaseService.addResource({
        firmId,
        category: 'practice_note',
        title,
        content: fullContent,
        tags: ['ai-research', 'perplexity'],
        jurisdiction: 'NJ',
        source: 'AI Research (Perplexity)',
        sourceUrl: msg.citations?.[0],
      });

      toast.success(`Saved to Knowledge Base: "${title}"`, {
        description: `Resource ID: ${resourceId}`,
      });
    } catch (err) {
      console.error('[GlobalAiWidget] Save to KB error:', err);
      toast.error('Failed to save to Knowledge Base.');
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim()) return;

    // Strip @mention from the message text sent to the AI
    const cleanedMessage = inputValue.trim().replace(/@[\w\s]+(?=\s|$)/, '').trim();

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue.trim(), // Show original text with @mention in the UI
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setShowMentionDropdown(false);
    setIsTyping(true);

    try {
      if (!firmId) throw new Error('Firm ID missing.');

      const historyCtx = messages
        .filter((m) => !m.id.startsWith('welcome-') && m.id !== 'loading')
        .slice(-20) // Cap history to prevent unbounded prompt growth
        .map((m) => ({ role: m.role, content: m.content }));

      const chatAi = httpsCallable(functions, 'chatAi', { timeout: 300_000 }); // Match server-side 300s timeout
      const CHAT_TIMEOUT_MS = 300_000; // 300 seconds — matches server function timeout
      const response = await Promise.race([
        chatAi({
          firmId,
          clientId,
          message: cleanedMessage || inputValue.trim(),
          contextParams: {
            currentUrl: window.location.href,
            pathname: window.location.pathname,
          },
          history: historyCtx,
          mode,
          ...(mode === 'draft' ? { draftDocType } : {}),
          conversationId,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('AI response timed out. Please try again with a shorter message.')),
            CHAT_TIMEOUT_MS,
          )
        ),
      ]);

      const data = response.data as {
        reply: string;
        draftContent?: string;
        draftTitle?: string;
        conversationId?: string;
        citations?: string[];
      };

      // Persist the conversation ID
      if (data.conversationId) {
        setConversationId(data.conversationId);
      }

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.reply || 'I am sorry, I did not understand that.',
        timestamp: new Date(),
        isDraft: !!data.draftContent,
        draftTitle: data.draftTitle,
        citations: data.citations,
      };
      setMessages((prev) => [...prev, aiMessage]);

      if (data.draftContent) {
        toast.success(`Document draft saved: ${data.draftTitle ?? 'Draft'}`);
      }
    } catch (err: unknown) {
      console.error('[GlobalAiWidget] Error calling chatAi:', err);
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(msg || 'Failed to communicate with AI Assistant.');
    } finally {
      setIsTyping(false);
    }
  };

  // Auto-grow textarea height
  const autoResizeTextarea = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // Cap at ~6 lines (approx 144px)
    el.style.height = Math.min(el.scrollHeight, 144) + 'px';
  }, []);

  useLayoutEffect(() => {
    autoResizeTextarea();
  }, [inputValue, autoResizeTextarea]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // When the @mention dropdown is visible, intercept keyboard navigation
    if (showMentionDropdown && filteredClients.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedMentionIndex((prev) =>
          prev < filteredClients.length - 1 ? prev + 1 : 0,
        );
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedMentionIndex((prev) =>
          prev > 0 ? prev - 1 : filteredClients.length - 1,
        );
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        selectMentionedClient(filteredClients[highlightedMentionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowMentionDropdown(false);
        setMentionQuery('');
        return;
      }
    }

    // Enter sends the message; Shift+Enter inserts a newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-purple-600 text-white shadow-xl hover:bg-purple-700 transition-transform hover:scale-105 active:scale-95 print:hidden"
        aria-label="Open AI Assistant"
      >
        <Bot className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div
      className={cn(
        'fixed bottom-0 right-0 z-50 flex flex-col overflow-hidden bg-white shadow-2xl transition-all duration-300 ease-in-out print:hidden',
        isMaximized
          ? 'inset-x-0 bottom-0 top-0 sm:inset-4 sm:rounded-2xl'
          : 'bottom-4 right-4 h-[600px] max-h-[calc(100vh-2rem)] w-[400px] max-w-[calc(100vw-2rem)] rounded-2xl border border-gray-200',
      )}
    >
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-purple-100 bg-gradient-to-r from-purple-600 to-indigo-600 px-3 text-white gap-2">
        <div className="flex items-center gap-2 min-w-0 shrink">
          <Bot className="h-5 w-5 text-purple-100" />
          <h2 className="font-semibold truncate">AI Assistant</h2>
          {conversationId && (
            <span className="rounded bg-white/20 px-1.5 py-0.5 text-[9px] font-medium text-purple-100">
              💾 Saved
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* History toggle */}
          <button
            onClick={() => { setShowHistory(!showHistory); if (!showHistory) loadHistory(); }}
            className={cn(
              'rounded p-1.5 transition-colors',
              showHistory ? 'bg-white/30 text-white' : 'text-purple-100 hover:bg-white/20',
            )}
            title="Conversation history"
          >
            <History className="h-4 w-4" />
          </button>
          {/* New conversation */}
          <button
            onClick={startNewConversation}
            className="rounded p-1.5 text-purple-100 hover:bg-white/20 transition-colors"
            title="New conversation"
          >
            <Plus className="h-4 w-4" />
          </button>
          {/* 3-tab mode switcher */}
          <div className="flex items-center rounded-full bg-white/15 p-0.5">
            {[
              { key: 'chat' as const, icon: Bot, label: 'Chat' },
              { key: 'draft' as const, icon: PenTool, label: 'Draft' },
              { key: 'research' as const, icon: Search, label: 'Research' },
            ].map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => switchMode(key)}
                className={cn(
                  'flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium transition-all',
                  mode === key
                    ? key === 'draft'
                      ? 'bg-amber-400 text-amber-900 shadow-sm'
                      : key === 'research'
                        ? 'bg-emerald-400 text-emerald-900 shadow-sm'
                        : 'bg-white text-purple-700 shadow-sm'
                    : 'text-purple-200 hover:text-white',
                )}
                title={`Switch to ${label} mode`}
              >
                <Icon className="h-3 w-3" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className="rounded p-1.5 text-purple-100 hover:bg-white/20 transition-colors"
            aria-label={isMaximized ? 'Restore down' : 'Maximize'}
          >
            {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          {/* Divider before close */}
          <div className="mx-0.5 h-5 w-px bg-white/25" />
          <button
            onClick={() => setIsOpen(false)}
            className="rounded-lg p-1.5 text-white hover:bg-white/30 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Draft mode: doc type selector */}
      {mode === 'draft' && !showHistory && (
        <div className="flex items-center gap-2 border-b border-gray-100 bg-amber-50/50 px-4 py-2">
          <FileText className="h-4 w-4 text-amber-600" />
          <span className="text-xs font-medium text-amber-800">Document Type:</span>
          <select
            value={draftDocType}
            onChange={(e) => setDraftDocType(e.target.value)}
            className="flex-1 rounded border border-amber-200 bg-white px-2 py-1 text-xs text-gray-700 focus:border-amber-400 focus:outline-none"
            title="Select document type"
          >
            {DOC_TYPE_SELECT.map((dt) => (
              <option key={dt.value} value={dt.value}>
                {dt.label}
              </option>
            ))}
          </select>
          {clientId && (
            <span className="flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              <UserCheck className="h-3 w-3" />
              {mentionedClient ? mentionedClient.name : 'Client Connected'}
              {mentionedClient && !urlClientId && (
                <button
                  onClick={clearMentionedClient}
                  className="ml-0.5 rounded-full hover:bg-emerald-200 p-0.5"
                  title="Disconnect client"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </span>
          )}
        </div>
      )}

      {/* Conversation History Sidebar */}
      {showHistory ? (
        <div className="flex-1 overflow-y-auto bg-gray-50/80 p-3">
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => setShowHistory(false)}
              className="rounded p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              aria-label="Close conversation history"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <h3 className="text-sm font-semibold text-gray-700">Past Conversations</h3>
          </div>

          {loadingHistory ? (
            <div className="text-center py-8">
              <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-purple-300 border-t-purple-600" />
              <p className="mt-2 text-xs text-gray-500">Loading history...</p>
            </div>
          ) : pastConversations.length === 0 ? (
            <div className="text-center py-8">
              <History className="mx-auto h-8 w-8 text-gray-300" />
              <p className="mt-2 text-xs text-gray-500">No past conversations yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {pastConversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => resumeConversation(conv)}
                  className={cn(
                    'w-full rounded-lg border p-3 text-left transition-colors hover:bg-white hover:shadow-sm',
                    conv.id === conversationId
                      ? 'border-purple-300 bg-purple-50'
                      : 'border-gray-200 bg-white/60',
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {conv.mode === 'draft' ? (
                      <PenTool className="h-3 w-3 text-amber-500" />
                    ) : (
                      <Bot className="h-3 w-3 text-purple-500" />
                    )}
                    <span className="text-xs font-semibold text-gray-800 truncate">
                      {conv.title}
                    </span>
                    <span className="ml-auto text-[9px] text-gray-400">
                      {conv.messageCount} msg{conv.messageCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 truncate">{conv.lastMessage}</p>
                  {conv.updatedAt && (
                    <p className="text-[9px] text-gray-400 mt-1">
                      {new Date(conv.updatedAt).toLocaleDateString()}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Messages */
        <div className="flex-1 overflow-y-auto bg-gray-50/50 p-4">
          <div className="flex flex-col gap-4">
            {messages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={msg.id}
                  className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'relative max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-sm',
                      isUser
                        ? 'bg-purple-600 text-white rounded-tr-sm'
                        : msg.isDraft
                          ? 'bg-amber-50 border border-amber-200 text-gray-800 rounded-tl-sm'
                          : 'bg-white border border-gray-100 text-gray-800 rounded-tl-sm',
                    )}
                  >
                    {msg.isDraft && (
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 text-amber-600" />
                        <span className="text-[10px] font-semibold text-amber-700">
                          Document Draft Saved — {msg.draftTitle}
                        </span>
                      </div>
                    )}
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    {/* Citation sources (research mode) */}
                    {msg.citations && msg.citations.length > 0 && (
                      <CitationBlock citations={msg.citations} />
                    )}
                    <span
                      className={cn(
                        'mt-1 block text-[10px] opacity-60',
                        isUser ? 'text-purple-100 text-right' : 'text-gray-400',
                      )}
                    >
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {/* Save as Note button — only when client is connected */}
                    {clientId && !msg.id.startsWith('welcome-') && msg.id !== 'loading' && (
                      <div className="mt-1 flex items-center gap-3">
                        <button
                          onClick={() => handleSaveAsNote(msg)}
                          className={cn(
                            'flex items-center gap-1 text-[10px] font-medium transition-colors',
                            isUser
                              ? 'text-purple-200 hover:text-white'
                              : 'text-gray-400 hover:text-purple-600',
                          )}
                          title="Save this message as a client note"
                        >
                          <Bookmark className="h-3 w-3" />
                          Save as Note
                        </button>
                        {/* Save to Vault — for long AI messages (likely documents) */}
                        {!isUser && msg.content.length > 500 && (
                          <button
                            onClick={() => handleSaveToVault(msg)}
                            className="flex items-center gap-1 text-[10px] font-medium text-gray-400 hover:text-amber-600 transition-colors"
                            title="Save to Document Vault"
                          >
                            <FolderOpen className="h-3 w-3" />
                            Save to Vault
                          </button>
                        )}
                        {/* Save to KB — for research mode assistant messages */}
                        {!isUser && msg.citations && msg.citations.length > 0 && (
                          <button
                            onClick={() => handleSaveToKB(msg)}
                            className="flex items-center gap-1 text-[10px] font-medium text-gray-400 hover:text-emerald-600 transition-colors"
                            title="Save to Knowledge Base"
                          >
                            <BookOpen className="h-3 w-3" />
                            Save to KB
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {isTyping && (
              <div className="flex w-full justify-start">
                <div className="flex max-w-[85%] items-center gap-1.5 rounded-2xl rounded-tl-sm bg-white border border-gray-100 px-4 py-3.5 shadow-sm">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-purple-400 animation-delay-0" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-purple-400 animation-delay-150" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-purple-400 animation-delay-300" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} className="h-px w-full" />
          </div>
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 border-t border-gray-200 bg-white p-3">
        {/* @mention connected client chip */}
        {mentionedClient && !urlClientId && (
          <div className="mb-2 flex items-center gap-1.5">
            <span className="flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-medium text-emerald-700">
              <AtSign className="h-3 w-3" />
              {mentionedClient.name}
              <button
                onClick={clearMentionedClient}
                className="ml-0.5 rounded-full hover:bg-emerald-200 p-0.5 transition-colors"
                title="Disconnect client"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
            <span className="text-[10px] text-gray-400">Context connected</span>
          </div>
        )}
        <div className="flex items-end gap-2" style={{ alignItems: 'flex-end' }}>
          <div className="relative flex-1">
            {/* @mention autocomplete dropdown */}
            {showMentionDropdown && filteredClients.length > 0 && (
              <div className="absolute bottom-full left-0 right-0 mb-1 max-h-48 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg z-10">
                <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                  Select a client
                </div>
                {filteredClients.map((client, idx) => (
                  <button
                    key={client.id}
                    onClick={() => selectMentionedClient(client)}
                    onMouseEnter={() => setHighlightedMentionIndex(idx)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors',
                      idx === highlightedMentionIndex
                        ? 'bg-purple-50 text-purple-700'
                        : 'text-gray-700 hover:bg-purple-50 hover:text-purple-700',
                    )}
                  >
                    <div className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold',
                      idx === highlightedMentionIndex
                        ? 'bg-purple-100 text-purple-600'
                        : 'bg-gray-100 text-gray-500',
                    )}>
                      {client.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-medium">{client.name}</span>
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={inputRef}
              rows={1}
              placeholder={
                mode === 'draft'
                  ? 'Describe the document you need... (use @ for clients)'
                  : mode === 'research'
                    ? 'Ask a legal research question...'
                    : 'Ask anything... (use @ to tag a client)'
              }
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              className="w-full rounded-xl border border-gray-300 bg-gray-50 px-4 py-2.5 pr-10 text-sm focus:border-purple-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-purple-500 transition-colors resize-none overflow-y-auto"
              style={{ maxHeight: '144px' }}
            />
          </div>
          <Button
            onClick={handleSend}
            disabled={!inputValue.trim() || isTyping}
            className="h-10 w-10 shrink-0 rounded-full bg-purple-600 p-0 text-white shadow-sm hover:bg-purple-700 disabled:bg-purple-300"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-2 text-center text-[10px] text-gray-400 font-medium">
          {mode === 'draft'
            ? '📝 Drafting Mode — Say "generate" when ready'
            : mode === 'research'
              ? '⚖️ Research results are AI-generated from web sources. Verify all citations independently.'
              : '🧠 Memory-augmented AI Assistant'}
        </div>
      </div>
    </div>
  );
}
