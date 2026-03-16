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

import { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, X, Maximize2, Minimize2, Send, FileText, PenTool, History, Plus, ChevronLeft, Bookmark, AtSign, UserCheck, FolderOpen } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { collection, getDocs, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { functions, db } from '@/config/firebase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { DOC_TYPES } from '@/config/constants';

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

const WELCOME_MSG = (mode: 'chat' | 'draft', hasClient?: boolean): Message => ({
  id: 'welcome-' + Date.now(),
  role: 'assistant',
  content: mode === 'draft'
    ? `📝 Drafting Mode active. I'll help you draft a document. ${hasClient ? 'I can see the client context.' : 'Type **@ClientName** to connect a client, or navigate to their profile.'}\n\nSelect a document type above, then tell me what you'd like. When ready, say "generate" or "draft it" and I'll produce the document.`
    : 'Hello! I am your Estate Planning AI Assistant. I have context about your firm, clients, knowledge base, and templates.\n\n💡 **Tip:** Type **@ClientName** to connect a client from anywhere!',
  timestamp: new Date(),
});

export function GlobalAiWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([WELCOME_MSG('chat')]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Conversation persistence
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [showHistory, setShowHistory] = useState(false);
  const [pastConversations, setPastConversations] = useState<ConversationSummary[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Drafting mode state
  const [mode, setMode] = useState<'chat' | 'draft'>('chat');
  const [draftDocType, setDraftDocType] = useState('will');

  // @mention client tagging
  const [mentionedClient, setMentionedClient] = useState<ClientOption | null>(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
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
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);

    // Detect @mention: check if there's an active @query at the cursor position
    const atMatch = val.match(/@([\w\s]*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
      setShowMentionDropdown(true);
    } else {
      setShowMentionDropdown(false);
      setMentionQuery('');
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

  // Reset messages when switching modes
  const toggleMode = () => {
    const newMode = mode === 'chat' ? 'draft' : 'chat';
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

      // Extract title from first heading or first line
      const titleMatch = msg.content.match(/<h[1-2][^>]*>(.*?)<\/h[1-2]>/i)
        || msg.content.match(/^#\s+(.+)$/m);
      const title = titleMatch?.[1]?.replace(/<[^>]*>/g, '').trim() || `AI Draft — ${new Date().toLocaleDateString()}`;

      await setDoc(docRef, {
        id: docId,
        firmId,
        clientId,
        docType: 'custom',
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-purple-100 bg-gradient-to-r from-purple-600 to-indigo-600 px-4 text-white">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-purple-100" />
          <h2 className="font-semibold">AI Assistant</h2>
          {conversationId && (
            <span className="rounded bg-white/20 px-1.5 py-0.5 text-[9px] font-medium text-purple-100">
              💾 Saved
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
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
          {/* Mode toggle */}
          <button
            onClick={toggleMode}
            className={cn(
              'flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
              mode === 'draft'
                ? 'bg-amber-400 text-amber-900'
                : 'bg-white/20 text-purple-100 hover:bg-white/30',
            )}
            title={mode === 'draft' ? 'Switch to Chat mode' : 'Switch to Drafting mode'}
          >
            {mode === 'draft' ? (
              <>
                <PenTool className="h-3 w-3" /> Draft
              </>
            ) : (
              <>
                <Bot className="h-3 w-3" /> Chat
              </>
            )}
          </button>
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className="rounded p-1.5 text-purple-100 hover:bg-white/20 transition-colors"
            aria-label={isMaximized ? 'Restore down' : 'Maximize'}
          >
            {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="rounded p-1.5 text-purple-100 hover:bg-white/20 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
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
        <div className="flex items-end gap-2">
          <div className="relative flex-1">
            {/* @mention autocomplete dropdown */}
            {showMentionDropdown && filteredClients.length > 0 && (
              <div className="absolute bottom-full left-0 right-0 mb-1 max-h-48 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg z-10">
                <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                  Select a client
                </div>
                {filteredClients.map((client) => (
                  <button
                    key={client.id}
                    onClick={() => selectMentionedClient(client)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700 transition-colors"
                  >
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-500">
                      {client.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-medium">{client.name}</span>
                  </button>
                ))}
              </div>
            )}
            <input
              ref={inputRef}
              type="text"
              placeholder={mode === 'draft' ? 'Describe the document you need... (use @ for clients)' : 'Ask anything... (use @ to tag a client)'}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              className="w-full rounded-xl border border-gray-300 bg-gray-50 px-4 py-2.5 pr-10 text-sm focus:border-purple-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-purple-500 transition-colors"
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
          {mode === 'draft' ? '📝 Drafting Mode — Say "generate" when ready' : '🧠 Memory-augmented AI Assistant'}
        </div>
      </div>
    </div>
  );
}
