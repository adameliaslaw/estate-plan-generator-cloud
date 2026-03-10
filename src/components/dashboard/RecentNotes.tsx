import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, FileText, Phone, Mail, Users, StickyNote, CheckSquare, Settings } from 'lucide-react';
import { where, orderBy, limit } from 'firebase/firestore';

import { useCollectionGroup } from '@/hooks/useFirestore';
import { useAuth } from '@/hooks/useAuth';
import type { Note, Client } from '@/types';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { documentService } from '@/services/document-service';
import { toast } from 'sonner';

export interface RecentNotesProps {
    clients?: Client[];
    activeClientIds?: string[];
}

function NoteTypeIcon({ type }: { type: string }) {
    switch (type) {
        case 'call': return <Phone className="h-3.5 w-3.5" />;
        case 'email': return <Mail className="h-3.5 w-3.5" />;
        case 'meeting': return <Users className="h-3.5 w-3.5" />;
        case 'task': return <CheckSquare className="h-3.5 w-3.5" />;
        case 'system': return <Settings className="h-3.5 w-3.5" />;
        default: return <StickyNote className="h-3.5 w-3.5" />;
    }
}

export function RecentNotes({ clients = [], activeClientIds = [] }: RecentNotesProps) {
    const { userProfile } = useAuth();
    const firmId = userProfile?.firmId;
    const navigate = useNavigate();

    // Query constraints for latest notes across the firm.
    // We cannot filter on isPrivate here because old notes might not have the field,
    // which causes Firestore to omit them entirely from the results.
    const queryConstraints = useMemo(() => [
        where('firmId', '==', firmId),
        orderBy('createdAt', 'desc'),
        limit(20) // Fetch a bit more to accommodate client-side filtering
    ], [firmId]);

    const { data: recentNotes, loading } = useCollectionGroup<Note>(
        firmId ? 'notes' : null,
        queryConstraints
    );

    const [summarizingNoteIds, setSummarizingNoteIds] = useState<Record<string, boolean>>({});

    const formatNoteTime = (timestamp: any) => {
        if (!timestamp) return '';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60_000);
        const diffHrs = Math.floor(diffMs / 3_600_000);
        const diffDays = Math.floor(diffMs / 86_400_000);

        if (diffMins < 60) return `${diffMins || 1}m ago`;
        if (diffHrs < 24) return `${diffHrs}h ago`;
        if (diffDays === 1) return 'Yesterday';
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    const handleSummarize = async (note: Note) => {
        if (!firmId || !note.clientId || !note.id) return;
        setSummarizingNoteIds(prev => ({ ...prev, [note.id]: true }));
        try {
            await documentService.summarizeTranscription({
                firmId,
                clientId: note.clientId,
                noteId: note.id,
            });
            toast.success('Note summary generated successfully.');
        } catch (err: any) {
            console.error('Summarize error:', err);
            toast.error(err.message || 'Failed to summarize transcription.');
        } finally {
            setSummarizingNoteIds(prev => ({ ...prev, [note.id]: false }));
        }
    };

    const clientMap = useMemo(() => {
        const map = new Map<string, string>();
        for (const c of clients) {
            const name = [c.personalInfo?.firstName, c.personalInfo?.lastName].filter(Boolean).join(' ');
            map.set(c.id, name || 'Unknown Client');
        }
        return map;
    }, [clients]);

    return (
        <div className="flex flex-col h-full rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 bg-[#1a365d]/[0.03] px-6 py-4">
                <div>
                    <h2 className="text-lg font-semibold text-gray-900">Recent Notes</h2>
                    <p className="text-sm text-gray-500">Firm-wide communications</p>
                </div>
                <div className="rounded-lg bg-[#ebf4ff] p-2.5">
                    <FileText className="h-5 w-5 text-[#1a365d]" />
                </div>
            </div>

            {/* List Area */}
            <div className="flex-1 overflow-y-auto p-2">
                {loading ? (
                    <div className="p-4 space-y-4">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="flex gap-4 p-3 rounded-xl border border-gray-100">
                                <div className="space-y-2 flex-1 pt-1">
                                    <div className="h-4 w-3/4 animate-pulse rounded bg-gray-100" />
                                    <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : recentNotes?.length === 0 ? (
                    <div className="flex h-48 flex-col items-center justify-center text-center px-4">
                        <div className="rounded-full bg-gray-50 p-4 mb-3 border border-gray-100">
                            <FileText className="h-6 w-6 text-gray-400" />
                        </div>
                        <p className="text-sm font-medium text-gray-900">No recent notes</p>
                        <p className="text-sm text-gray-500 mt-1 max-w-[200px]">Notes added to client profiles will appear here.</p>
                    </div>
                ) : (
                    <div className="space-y-3 p-3">
                        {recentNotes?.filter(note =>
                            // Client-side filtering
                            note.isPrivate !== true &&
                            (!activeClientIds.length || (note.clientId && activeClientIds.includes(note.clientId)))
                        ).slice(0, 10).map(note => {
                            const isSummarizing = summarizingNoteIds[note.id] || false;
                            const title = note.title || (note.content ? note.content.slice(0, 40) + '...' : 'Untitled Note');
                            const clientName = (note.clientId ? clientMap.get(note.clientId) : '') || 'Unknown Client';

                            return (
                                <div
                                    key={note.id}
                                    className="group flex flex-col gap-2 rounded-xl border border-gray-100 bg-white p-4 transition-all hover:border-blue-100 hover:shadow-md hover:shadow-blue-50/50"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="shrink-0 flex items-center justify-center h-6 w-6 rounded-full bg-gray-50 text-gray-500">
                                                <NoteTypeIcon type={note.noteType || 'general'} />
                                            </span>
                                            <p className="truncate font-semibold text-gray-900 text-sm">
                                                {title}
                                            </p>
                                        </div>
                                        <span className="shrink-0 whitespace-nowrap text-xs text-gray-500">
                                            {formatNoteTime(note.createdAt)}
                                        </span>
                                    </div>

                                    <p className="text-xs text-gray-600 truncate">
                                        <span className="font-medium text-gray-700">Client:</span>{' '}
                                        {note.clientId ? (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); navigate(`/clients/${note.clientId}`); }}
                                                className="text-[#2b6cb0] hover:underline font-medium"
                                            >
                                                {clientName}
                                            </button>
                                        ) : (
                                            clientName
                                        )}
                                    </p>

                                    <p className="text-sm text-gray-600 line-clamp-2 mt-1">
                                        {note.content}
                                    </p>

                                    {/* Summary Controls */}
                                    {note.transcriptionStatus === 'completed' && !note.aiSummary && (
                                        <div className="mt-2 flex items-center">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 gap-1.5 px-3 text-xs uppercase tracking-wider text-[#2b6cb0] hover:bg-blue-50/50"
                                                disabled={isSummarizing}
                                                onClick={() => void handleSummarize(note)}
                                            >
                                                <Bot className={`h-3 w-3 ${isSummarizing ? 'animate-pulse' : ''}`} />
                                                {isSummarizing ? 'Summarizing...' : 'Summarize Audio'}
                                            </Button>
                                        </div>
                                    )}

                                    {note.aiSummary && (
                                        <div className="mt-2">
                                            <Alert className="group/alert border-purple-200 bg-purple-50 py-2 px-3">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="flex gap-2 min-w-0">
                                                        <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-purple-600" />
                                                        <AlertDescription className="text-xs text-purple-800 line-clamp-3">
                                                            <span className="mr-1 font-semibold">AI Summary:</span>
                                                            {note.aiSummary}
                                                        </AlertDescription>
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-6 w-6 shrink-0 text-purple-600 opacity-0 transition-opacity hover:bg-purple-100 hover:text-purple-700 group-hover/alert:opacity-100 disabled:opacity-50"
                                                        title="Regenerate Summary"
                                                        disabled={isSummarizing}
                                                        onClick={() => void handleSummarize(note)}
                                                    >
                                                        <Bot className={`h-3 w-3 ${isSummarizing ? 'animate-spin' : ''}`} />
                                                    </Button>
                                                </div>
                                            </Alert>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
