import { useState, useRef, useEffect, useMemo } from 'react';
import { Mic, MicOff, Paperclip, X, Trash2, UserPlus, Check } from 'lucide-react';
import { toast } from 'sonner';

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import type { NoteType } from '@/types';

function formatDuration(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')} `;
}

const NOTE_TYPE_OPTIONS: { value: NoteType; label: string }[] = [
    { value: 'general', label: 'General' },
    { value: 'call', label: 'Phone Call' },
    { value: 'email', label: 'Email' },
    { value: 'meeting', label: 'Meeting' },
    { value: 'task', label: 'Task' },
];

const AUDIO_ACCEPT = '.mp3,.wav,.m4a,.webm,audio/mpeg,audio/wav,audio/mp4,audio/webm';

export interface AudioRecorderModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (data: {
        title: string;
        noteType: NoteType;
        content: string;
        audioBlob: Blob | null;
        audioFileName: string;
        durationSeconds: number;
        clientId?: string;
        newClientName?: string;
    }) => Promise<void>;
    /** If provided, locks the note to this client. Otherwise shows client selector. */
    defaultClientId?: string;
    /** Pass available clients for the selector if no default is provided. */
    clients?: { id: string; name: string }[];
    isSaving?: boolean;
    onAddClient?: () => void;
}

export function AudioRecorderModal({
    open,
    onOpenChange,
    onSave,
    defaultClientId,
    clients = [],
    isSaving = false,
    onAddClient: _onAddClient,
}: AudioRecorderModalProps) {
    const [title, setTitle] = useState('');
    const [noteType, setNoteType] = useState<NoteType>('general');
    const [content, setContent] = useState('');
    const [selectedClientId, setSelectedClientId] = useState<string>(defaultClientId || '');
    const [clientSearch, setClientSearch] = useState('');
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const clientInputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const audioRecorder = useAudioRecorder();
    const audioFileInputRef = useRef<HTMLInputElement>(null);

    const { clearAudio, cancelRecording } = audioRecorder;

    // Filter clients based on search
    const filteredClients = useMemo(() => {
        if (!clientSearch.trim()) return clients;
        const q = clientSearch.toLowerCase();
        return clients.filter(c => c.name.toLowerCase().includes(q));
    }, [clients, clientSearch]);

    // Check if the search matches an existing client exactly
    const exactMatch = useMemo(() => {
        return clients.find(c => c.name.toLowerCase() === clientSearch.trim().toLowerCase());
    }, [clients, clientSearch]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
                clientInputRef.current && !clientInputRef.current.contains(e.target as Node)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (open) {
            setTitle('');
            setNoteType('general');
            setContent('');
            setClientSearch('');
            setIsDropdownOpen(false);
            clearAudio();
            if (defaultClientId) {
                setSelectedClientId(defaultClientId);
            } else {
                setSelectedClientId('');
            }
        } else {
            cancelRecording();
        }
    }, [open, defaultClientId, clearAudio, cancelRecording]);

    const handleSelectClient = (id: string, name: string) => {
        setSelectedClientId(id);
        setClientSearch(name);
        setIsDropdownOpen(false);
    };

    const handleCreateAndSelect = () => {
        // Mark as "new client" — the parent will create it
        setSelectedClientId('__new__');
        setIsDropdownOpen(false);
    };

    const handleDone = async () => {
        const isNewClient = selectedClientId === '__new__' && clientSearch.trim();
        if (!selectedClientId && !isNewClient) {
            toast.error('Please select or enter a client name.');
            return;
        }

        try {
            await onSave({
                title: title.trim(),
                noteType,
                content: content.trim(),
                audioBlob: audioRecorder.audioBlob,
                audioFileName: audioRecorder.audioFileName,
                durationSeconds: audioRecorder.durationSeconds,
                clientId: isNewClient ? undefined : selectedClientId,
                newClientName: isNewClient ? clientSearch.trim() : undefined,
            });
            onOpenChange(false);
        } catch (err) {
            console.error('[AudioRecorderModal] save error', err);
        }
    };

    const handleAudioFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 50 * 1024 * 1024) {
            toast.error('Audio file must be under 50MB.');
            return;
        }

        audioRecorder.setUploadedAudio(file, file.name);

        if (audioFileInputRef.current) {
            audioFileInputRef.current.value = '';
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Record AI Note</DialogTitle>
                    <DialogDescription>
                        Record dictation or a client meeting. The audio will be automatically transcribed and summarized via AI.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {!defaultClientId && (
                        <div className="space-y-1.5 relative">
                            <Label className="text-xs font-medium text-gray-600">
                                Client <span className="text-red-500">*</span>
                            </Label>
                            <Input
                                ref={clientInputRef}
                                placeholder="Search or type a new client name…"
                                value={clientSearch}
                                onChange={(e) => {
                                    setClientSearch(e.target.value);
                                    setIsDropdownOpen(true);
                                    if (!e.target.value.trim()) {
                                        setSelectedClientId('');
                                    }
                                }}
                                onFocus={() => setIsDropdownOpen(true)}
                                className="border-gray-200 bg-white text-sm"
                            />
                            {selectedClientId && selectedClientId !== '__new__' && (
                                <div className="absolute right-3 top-[30px] text-emerald-500">
                                    <Check className="h-4 w-4" />
                                </div>
                            )}
                            {selectedClientId === '__new__' && (
                                <div className="absolute right-3 top-[30px] text-blue-500">
                                    <UserPlus className="h-4 w-4" />
                                </div>
                            )}
                            {isDropdownOpen && (
                                <div
                                    ref={dropdownRef}
                                    className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-48 overflow-y-auto"
                                >
                                    {filteredClients.map(c => (
                                        <button
                                            key={c.id}
                                            type="button"
                                            onClick={() => handleSelectClient(c.id, c.name)}
                                            className={`w-full text-left px-3 py-2 text-sm hover:bg-[#ebf4ff] transition-colors ${selectedClientId === c.id ? 'bg-[#ebf4ff] font-medium text-[#1a365d]' : 'text-gray-700'}`}
                                        >
                                            {c.name}
                                        </button>
                                    ))}
                                    {clientSearch.trim() && !exactMatch && (
                                        <button
                                            type="button"
                                            onClick={handleCreateAndSelect}
                                            className="w-full text-left px-3 py-2 text-sm border-t border-gray-100 text-[#2b6cb0] font-medium hover:bg-blue-50 transition-colors flex items-center gap-2"
                                        >
                                            <UserPlus className="h-3.5 w-3.5" />
                                            Create &quot;{clientSearch.trim()}&quot;
                                        </button>
                                    )}
                                    {/* Always-visible Add New Client option */}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (clientSearch.trim() && !exactMatch) {
                                                // If they've typed a name, create inline
                                                handleCreateAndSelect();
                                            } else {
                                                // Focus input so user can type a new client name inline
                                                setSelectedClientId('');
                                                setClientSearch('');
                                                setIsDropdownOpen(false);
                                                setTimeout(() => clientInputRef.current?.focus(), 50);
                                            }
                                        }}
                                        className="w-full text-left px-3 py-2.5 text-sm border-t border-gray-100 text-[#1a365d] font-semibold hover:bg-[#ebf4ff] transition-colors flex items-center gap-2"
                                    >
                                        <UserPlus className="h-4 w-4 text-[#2b6cb0]" />
                                        + Add New Client
                                    </button>
                                    {!filteredClients.length && !clientSearch.trim() && (
                                        <div className="px-3 py-2 text-center text-xs text-gray-400">
                                            Or type a name above to create one quickly.
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="note-title" className="text-xs font-medium text-gray-600">
                                Title <span className="text-gray-400">(optional)</span>
                            </Label>
                            <Input
                                id="note-title"
                                placeholder="e.g. Initial consultation call"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                className="border-gray-200 bg-white text-sm"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="note-type" className="text-xs font-medium text-gray-600">
                                Note Type
                            </Label>
                            <Select value={noteType} onValueChange={(v) => setNoteType(v as NoteType)}>
                                <SelectTrigger id="note-type" className="border-gray-200 bg-white text-sm">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {NOTE_TYPE_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="note-content" className="text-xs font-medium text-gray-600">
                            Manual Notes <span className="text-gray-400">(optional)</span>
                        </Label>
                        <Textarea
                            id="note-content"
                            placeholder="Add any manual notes here. Transcription and AI summary will be appended automatically."
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            rows={3}
                            className="resize-y border-gray-200 bg-white text-sm"
                        />
                    </div>

                    <div className="space-y-2 rounded-xl border border-gray-100 bg-gray-50/50 p-4">
                        <Label className="text-xs font-medium text-gray-600">Audio Recording</Label>
                        {!audioRecorder.isRecording && !audioRecorder.audioBlob && (
                            <div className="flex flex-wrap items-center gap-2 mt-1">
                                <Button
                                    type="button"
                                    onClick={() => void audioRecorder.startRecording()}
                                    className="gap-2 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700"
                                >
                                    <Mic className="h-4 w-4" />
                                    Start Recording
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => audioFileInputRef.current?.click()}
                                    className="gap-2 border-gray-200 text-gray-600 hover:border-[#2b6cb0] hover:text-[#2b6cb0]"
                                >
                                    <Paperclip className="h-4 w-4" />
                                    Upload Audio File
                                </Button>
                                <input
                                    ref={audioFileInputRef}
                                    type="file"
                                    accept={AUDIO_ACCEPT}
                                    className="hidden"
                                    onChange={handleAudioFileChange}
                                    aria-label="Upload audio file"
                                    title="Upload audio file"
                                />
                            </div>
                        )}

                        {audioRecorder.isRecording && (
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 mt-1">
                                <span className="flex items-center gap-2 text-sm font-medium text-red-700">
                                    <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                                    Recording… {formatDuration(audioRecorder.durationSeconds)}
                                </span>
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        size="sm"
                                        className="gap-1.5 bg-red-600 text-white hover:bg-red-700"
                                        onClick={audioRecorder.stopRecording}
                                    >
                                        <MicOff className="h-4 w-4" />
                                        Stop
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="gap-1.5 border-red-200 text-red-600 hover:bg-red-50"
                                        onClick={audioRecorder.cancelRecording}
                                    >
                                        <X className="h-4 w-4" />
                                        Cancel
                                    </Button>
                                </div>
                            </div>
                        )}

                        {audioRecorder.audioDataUri && !audioRecorder.isRecording && (
                            <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-3 mt-1 shadow-sm">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="truncate text-xs font-medium text-gray-700">
                                        {audioRecorder.audioFileName}
                                        {audioRecorder.durationSeconds > 0 && (
                                            <span className="ml-1 text-gray-400">
                                                ({formatDuration(audioRecorder.durationSeconds)})
                                            </span>
                                        )}
                                    </span>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 w-7 p-0 text-gray-400 hover:text-red-500"
                                        onClick={audioRecorder.clearAudio}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                                <audio controls src={audioRecorder.audioDataUri} className="h-8 w-full" />
                            </div>
                        )}
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleDone}
                        disabled={isSaving || (audioRecorder.isRecording) || (!content && !title && !audioRecorder.audioBlob)}
                        className="bg-[#1a365d] text-white hover:bg-[#1e407a]"
                    >
                        {isSaving ? 'Saving...' : 'Save & Process AI'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
