import { useState, useRef, useEffect } from 'react';
import { Bot, X, Maximize2, Minimize2, Send } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { functions } from '@/config/firebase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

export function GlobalAiWidget() {
    const [isOpen, setIsOpen] = useState(false);
    const [isMaximized, setIsMaximized] = useState(false);
    const [messages, setMessages] = useState<Message[]>([
        {
            id: 'welcome',
            role: 'assistant',
            content: 'Hello! I am your Estate Planning AI Assistant. I have context about the page you are currently viewing. How can I help you today?',
            timestamp: new Date(),
        }
    ]);
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const { userProfile } = useAuth();
    const firmId = userProfile?.firmId;

    // Auto-scroll to bottom of messages
    useEffect(() => {
        if (isOpen) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, isOpen, isTyping]);

    const handleSend = async () => {
        if (!inputValue.trim()) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: inputValue.trim(),
            timestamp: new Date(),
        };

        setMessages((prev) => [...prev, userMessage]);
        setInputValue('');
        setIsTyping(true);

        // 1. Hook up actual chatAi logic
        try {
            if (!firmId) {
                throw new Error('Firm ID missing.');
            }

            // Format history
            const historyCtx = messages
                .filter(m => m.id !== 'welcome')
                .map(m => ({ role: m.role, content: m.content }));

            const chatAi = httpsCallable(functions, 'chatAi');
            const response = await chatAi({
                firmId,
                message: inputValue.trim(),
                contextParams: {
                    currentUrl: window.location.href,
                    pathname: window.location.pathname,
                },
                history: historyCtx,
            });

            const data = response.data as { reply: string };

            const aiMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: data.reply || 'I am sorry, I did not understand that.',
                timestamp: new Date(),
            };
            setMessages((prev) => [...prev, aiMessage]);

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
                    ? 'inset-x-0 bottom-0 top-0 sm:inset-4 sm:rounded-2xl' // Full screen
                    : 'bottom-4 right-4 h-[600px] max-h-[calc(100vh-2rem)] w-[400px] max-w-[calc(100vw-2rem)] rounded-2xl border border-gray-200' // Floating window
            )}
        >
            {/* Header */}
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-purple-100 bg-gradient-to-r from-purple-600 to-indigo-600 px-4 text-white">
                <div className="flex items-center gap-2">
                    <Bot className="h-5 w-5 text-purple-100" />
                    <h2 className="font-semibold">AI Assistant</h2>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setIsMaximized(!isMaximized)}
                        className="rounded p-1.5 text-purple-100 hover:bg-white/20 transition-colors"
                        aria-label={isMaximized ? "Restore down" : "Maximize"}
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

            {/* Messages Array */}
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
                                            : 'bg-white border border-gray-100 text-gray-800 rounded-tl-sm'
                                    )}
                                >
                                    <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                                    <span
                                        className={cn(
                                            'mt-1 block text-[10px] opacity-60',
                                            isUser ? 'text-purple-100 text-right' : 'text-gray-400'
                                        )}
                                    >
                                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>
                            </div>
                        );
                    })}

                    {isTyping && (
                        <div className="flex w-full justify-start">
                            <div className="flex max-w-[85%] items-center gap-1.5 rounded-2xl rounded-tl-sm bg-white border border-gray-100 px-4 py-3.5 shadow-sm">
                                <span className="h-2 w-2 animate-bounce rounded-full bg-purple-400" style={{ animationDelay: '0ms' }} />
                                <span className="h-2 w-2 animate-bounce rounded-full bg-purple-400" style={{ animationDelay: '150ms' }} />
                                <span className="h-2 w-2 animate-bounce rounded-full bg-purple-400" style={{ animationDelay: '300ms' }} />
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} className="h-px w-full" />
                </div>
            </div>

            {/* Input Area */}
            <div className="shrink-0 border-t border-gray-200 bg-white p-3">
                <div className="flex items-end gap-2">
                    <div className="relative flex-1">
                        <input
                            type="text"
                            placeholder="Ask anything..."
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
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
                    Context-aware AI Assistant
                </div>
            </div>
        </div>
    );
}
