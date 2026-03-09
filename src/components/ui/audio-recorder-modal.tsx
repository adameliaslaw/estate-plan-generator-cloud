import { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Paperclip, X, Trash2 } from 'lucide-react';
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
    return `${m}:${s.toString().padStart(2, '0')}`;
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
    }) => Promise<void>;
    /** If provided, locks the note to this client. Otherwise shows client selector. */
    defaultClientId?: string;
    /** Pass available clients for the selector if no default is provided. */
    clients?: { id: string; name: string }[];
    isSaving?: boolean;
}

export function AudioRecorderModal({
    open,
    onOpenChange,
    onSave,
    defaultClientId,
    clients = [],
    isSaving = false,
}: AudioRecorderModalProps) {
    const [title, setTitle] = useState('');
    const [noteType, setNoteType] = useState<NoteType>('general');
    const [content, setContent] = useState('');
    const [selectedClientId, setSelectedClientId] = useState<string>(defaultClientId || '');

    const audioRecorder = useAudioRecorder();
    const audioFileInputRef = useRef<HTMLInputElement>(null);

    const { clearAudio, cancelRecording } = audioRecorder;

    useEffect(() => {
        if (open) {
            setTitle('');
            setNoteType('general');
            setContent('');
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

    const handleDone = async () => {
        if (!selectedClientId) {
            toast.error('Please select a client to save this note to.');
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
                clientId: selectedClientId,
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
                    {!defaultClientId && clients.length > 0 && (
                        <div className="space-y-1.5">
                            <Label className="text-xs font-medium text-gray-600">Client <span className="text-red-500">*</span></Label>
                            <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                                <SelectTrigger className="border-gray-200">
                                    <SelectValue placeholder="Select a client..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {clients.map(c => (
                                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
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
