/**
 * NotesTab.tsx
 *
 * Chronological notes feed for a client matter.
 *
 * Features:
 *  - Real-time Firestore subscription (pinned notes floated to top)
 *  - New note form (title, type, content, isPinned, isPrivate)
 *  - Inline edit of existing notes
 *  - Pin / unpin toggle
 *  - Delete
 *  - Client-side search by title / content
 *  - Audio recording via MediaRecorder API
 *  - Audio file upload (.mp3, .wav, .m4a, .webm)
 *  - Transcription status badge
 *  - AI summary callout
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { orderBy, doc, collection, setDoc, serverTimestamp } from 'firebase/firestore';

import {
  Bot,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Clock,
  Lock,
  Mail,
  Mic,
  MicOff,
  Paperclip,
  Phone,
  Pin,
  PinOff,
  Plus,
  Search,
  StickyNote,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

import { COLLECTIONS } from '@/config/constants';
import { useAuth } from '@/hooks/useAuth';
import {
  deleteDoc,
  updateDoc,
  useCollection,
} from '@/hooks/useFirestore';
import { db } from '@/config/firebase';
import type { Note, NoteType } from '@/types';
import { sanitizeInput } from '@/utils/sanitize';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { uploadAudioToStorage, requestTranscription } from '@/utils/audio-helpers';

// ─── Constants ────────────────────────────────────────────────────────────────

const NOTE_TYPE_OPTIONS: { value: NoteType; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'call', label: 'Phone Call' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'task', label: 'Task' },
];

const AUDIO_ACCEPT = '.mp3,.wav,.m4a,.webm,audio/mpeg,audio/wav,audio/mp4,audio/webm';

// ─── Helper utilities ─────────────────────────────────────────────────────────

function formatTimestamp(ts: { toDate?: () => Date } | Date | undefined): string {
  if (!ts) return '';
  const d = typeof (ts as { toDate?: () => Date }).toDate === 'function'
    ? (ts as { toDate: () => Date }).toDate()
    : (ts as Date);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function NoteTypeIcon({ type }: { type: NoteType }) {
  const icons: Record<NoteType, { icon: React.ReactNode; label: string }> = {
    call: { icon: <Phone className="h-3.5 w-3.5" />, label: 'Call' },
    email: { icon: <Mail className="h-3.5 w-3.5" />, label: 'Email' },
    meeting: { icon: <Users className="h-3.5 w-3.5" />, label: 'Meeting' },
    general: { icon: <StickyNote className="h-3.5 w-3.5" />, label: 'General' },
    task: { icon: <CheckSquare className="h-3.5 w-3.5" />, label: 'Task' },
    system: { icon: <Bot className="h-3.5 w-3.5" />, label: 'System' },
  };
  const cfg = icons[type] ?? icons.general;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-gray-500">
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function TranscriptionBadge({
  status,
}: {
  status: Note['transcriptionStatus'];
}) {
  if (!status) return null;

  const configs: Record<
    NonNullable<Note['transcriptionStatus']>,
    { label: string; className: string }
  > = {
    pending: {
      label: 'Pending Transcription',
      className: 'bg-amber-50 text-amber-700 border-amber-200',
    },
    processing: {
      label: 'Transcribing…',
      className: 'bg-blue-50 text-blue-700 border-blue-200',
    },
    completed: {
      label: 'Transcription Ready',
      className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
    failed: {
      label: 'Transcription Failed',
      className: 'bg-red-50 text-red-700 border-red-200',
    },
  };

  const cfg = configs[status];
  return (
    <Badge
      variant="outline"
      className={`text-xs font-medium ${cfg.className}`}
    >
      {status === 'processing' && (
        <Clock className="mr-1 h-3 w-3 animate-spin" />
      )}
      {cfg.label}
    </Badge>
  );
}

// ─── New / Edit note form state ───────────────────────────────────────────────

interface NoteFormState {
  title: string;
  noteType: NoteType;
  content: string;
  isPinned: boolean;
  isPrivate: boolean;
}

const DEFAULT_FORM: NoteFormState = {
  title: '',
  noteType: 'general',
  content: '',
  isPinned: false,
  isPrivate: false,
};

// ─── NoteForm component ───────────────────────────────────────────────────────

interface NoteFormProps {
  firmId: string;
  clientId: string;
  authorUid: string;
  onClose: () => void;
  initialData?: Partial<NoteFormState>;
  /** If provided, we're editing an existing note */
  editNoteId?: string;
  /** Automatically trigger an action on mount */
  initialAction?: 'record' | 'upload';
}

function NoteForm({
  firmId,
  clientId,
  authorUid,
  onClose,
  initialData,
  editNoteId,
  initialAction,
}: NoteFormProps) {
  const [form, setForm] = useState<NoteFormState>({
    ...DEFAULT_FORM,
    ...initialData,
  });

  const audioRecorder = useAudioRecorder();
  const audioFileInputRef = useRef<HTMLInputElement>(null);

  const isEditing = !!editNoteId;

  // Generate an ID up-front so we can autosave to it
  const [activeNoteId] = useState<string>(() => {
    return editNoteId || doc(collection(db, COLLECTIONS.NOTES(firmId, clientId))).id;
  });

  const [lastSavedState, setLastSavedState] = useState<string>('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Trigger quick actions on mount
  useEffect(() => {
    if (initialAction === 'record') {
      audioRecorder.startRecording();
    } else if (initialAction === 'upload') {
      setTimeout(() => {
        audioFileInputRef.current?.click();
      }, 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 1. Text / options autosave
  useEffect(() => {
    const currentStateStr = JSON.stringify(form);
    if (currentStateStr === lastSavedState) return;

    // Do not create empty notes
    if (!isEditing && !form.content.trim() && !form.title.trim() && !audioRecorder.audioBlob) return;

    setSaveStatus('saving');
    const timer = setTimeout(async () => {
      try {
        const collPath = COLLECTIONS.NOTES(firmId, clientId);
        const docRef = doc(db, collPath, activeNoteId);

        const partialNote: Partial<Note> = {
          title: sanitizeInput(form.title.trim()) || undefined,
          noteType: form.noteType,
          content: sanitizeInput(form.content.trim()),
          isPinned: form.isPinned,
          isPrivate: form.isPrivate,
          updatedBy: authorUid,
          updatedAt: serverTimestamp() as any,
        };

        if (!isEditing && !lastSavedState) {
          partialNote.firmId = firmId;
          partialNote.clientId = clientId;
          partialNote.source = 'manual';
          partialNote.createdBy = authorUid;
          partialNote.createdAt = serverTimestamp() as any;
        }

        await setDoc(docRef, partialNote, { merge: true });
        setLastSavedState(currentStateStr);
        setSaveStatus('saved');
      } catch (err) {
        console.error('[NoteForm] Autosave error:', err);
        setSaveStatus('idle');
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [form, lastSavedState, isEditing, firmId, clientId, activeNoteId, authorUid, audioRecorder.audioBlob]);

  // 2. Audio autosave
  useEffect(() => {
    if (audioRecorder.audioBlob && !audioRecorder.isRecording) {
      const processAudio = async () => {
        setSaveStatus('saving');
        try {
          const { url, fullPath } = await uploadAudioToStorage(
            audioRecorder.audioBlob!,
            firmId,
            clientId,
            activeNoteId,
          );

          const collPath = COLLECTIONS.NOTES(firmId, clientId);
          const docRef = doc(db, collPath, activeNoteId);

          const audioUpdate: Partial<Note> = {
            audioUrl: url,
            audioStoragePath: fullPath,
            audioFileName: audioRecorder.audioFileName,
            audioDurationSeconds: audioRecorder.durationSeconds || undefined,
            transcriptionStatus: 'processing',
            updatedBy: authorUid,
            updatedAt: serverTimestamp() as any,
          };

          if (!isEditing && !lastSavedState) {
            audioUpdate.firmId = firmId;
            audioUpdate.clientId = clientId;
            audioUpdate.source = 'manual';
            audioUpdate.title = sanitizeInput(form.title.trim()) || 'Audio Note';
            audioUpdate.createdBy = authorUid;
            audioUpdate.createdAt = serverTimestamp() as any;
          }

          await setDoc(docRef, audioUpdate, { merge: true });
          setLastSavedState('audio_uploaded'); // Force state to skip redundant creation
          try {
            await requestTranscription(firmId, clientId, activeNoteId, fullPath);
            toast.success('Audio uploaded & transcription started');
          } catch (error) {
            console.error('[NoteForm] Transcription request error:', error);
            toast.error('Transcription request failed.');
          }
          audioRecorder.clearAudio();
          setSaveStatus('saved');
        } catch (err) {
          console.error('[NoteForm] Audio processing error:', err);
          toast.error('Failed to upload audio');
          setSaveStatus('idle');
        }
      };
      processAudio();
    }
  }, [audioRecorder.audioBlob, audioRecorder.isRecording]);

  // Flush any final changes synchronously when clicking "Done"
  const handleDone = () => {
    const currentStateStr = JSON.stringify(form);
    if (currentStateStr !== lastSavedState) {
      if (isEditing || form.content.trim() || form.title.trim()) {
        const collPath = COLLECTIONS.NOTES(firmId, clientId);
        setDoc(doc(db, collPath, activeNoteId), {
          title: sanitizeInput(form.title.trim()) || undefined,
          noteType: form.noteType,
          content: sanitizeInput(form.content.trim()),
          isPinned: form.isPinned,
          isPrivate: form.isPrivate,
          updatedBy: authorUid,
          updatedAt: serverTimestamp() as any,
        }, { merge: true }).catch(console.error);
      }
    }
    onClose();
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
    <div className="space-y-4 rounded-xl border border-[#2b6cb0]/20 bg-[#ebf4ff]/40 p-5">
      {/* Title */}
      <div className="space-y-1.5">
        <Label htmlFor="note-title" className="text-xs font-medium text-gray-600">
          Title <span className="text-gray-400">(optional)</span>
        </Label>
        <Input
          id="note-title"
          placeholder="e.g. Initial consultation call"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          className="border-gray-200 bg-white text-sm"
        />
      </div>

      {/* Type */}
      <div className="space-y-1.5">
        <Label htmlFor="note-type" className="text-xs font-medium text-gray-600">
          Note Type
        </Label>
        <Select
          value={form.noteType}
          onValueChange={(v) => setForm((f) => ({ ...f, noteType: v as NoteType }))}
        >
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

      {/* Content */}
      <div className="space-y-1.5">
        <Label htmlFor="note-content" className="text-xs font-medium text-gray-600">
          Content <span className="text-red-500">*</span>
        </Label>
        <Textarea
          id="note-content"
          placeholder="Enter note details…"
          value={form.content}
          onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
          rows={4}
          className="resize-y border-gray-200 bg-white text-sm"
        />
      </div>

      {/* ── Audio section (only shown when creating, not editing) ─────────── */}
      {!isEditing && (
        <div className="space-y-2">
          <Label className="text-xs font-medium text-gray-600">
            Audio <span className="text-gray-400">(optional)</span>
          </Label>

          {/* Buttons row */}
          {!audioRecorder.isRecording && !audioRecorder.audioBlob && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2 border-gray-200 text-gray-600 hover:border-[#2b6cb0] hover:text-[#2b6cb0]"
                onClick={() => void audioRecorder.startRecording()}
              >
                <Mic className="h-4 w-4" />
                Record Audio
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2 border-gray-200 text-gray-600 hover:border-[#2b6cb0] hover:text-[#2b6cb0]"
                onClick={() => audioFileInputRef.current?.click()}
              >
                <Paperclip className="h-4 w-4" />
                Upload Audio
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

          {/* Active recording indicator */}
          {audioRecorder.isRecording && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
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

          {/* Captured audio player */}
          {audioRecorder.audioDataUri && !audioRecorder.isRecording && (
            <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
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
              <audio
                controls
                src={audioRecorder.audioDataUri}
                className="h-8 w-full"
              />
              <p className="text-xs text-gray-400">
                Transcription will be processed after saving.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Flags row */}
      <div className="flex flex-wrap items-center gap-6">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
          <Checkbox
            checked={form.isPinned}
            onCheckedChange={(checked) =>
              setForm((f) => ({ ...f, isPinned: checked === true }))
            }
          />
          Pin this note
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
          <Checkbox
            checked={form.isPrivate}
            onCheckedChange={(checked) =>
              setForm((f) => ({ ...f, isPrivate: checked === true }))
            }
          />
          <Lock className="h-3.5 w-3.5 text-gray-400" />
          Private
        </label>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between border-t border-gray-100 pt-3">
        <div className="text-xs font-medium italic text-gray-500">
          {saveStatus === 'saving' && 'Autosaving…'}
          {saveStatus === 'saved' && 'All changes saved.'}
        </div>
        <div className="flex gap-2">
          {(!form.content.trim() && !form.title.trim() && !audioRecorder.audioBlob && !isEditing) ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDone}
            >
              Cancel
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              className="bg-[#1a365d] text-white hover:bg-[#1e407a]"
              onClick={handleDone}
            >
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Individual note card ─────────────────────────────────────────────────────

interface NoteCardProps {
  note: Note & { id: string };
  firmId: string;
  clientId: string;
  authorUid: string;
}

function NoteCard({ note, firmId, clientId, authorUid }: NoteCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [showTranscription, setShowTranscription] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pinning, setPinning] = useState(false);

  const collPath = COLLECTIONS.NOTES(firmId, clientId);
  const docPath = `${collPath}/${note.id}`;

  const handleTogglePin = async () => {
    setPinning(true);
    try {
      await updateDoc<Note>(docPath, {
        isPinned: !note.isPinned,
        updatedBy: authorUid,
      });
      toast.success(note.isPinned ? 'Note unpinned.' : 'Note pinned.');
    } catch {
      toast.error('Failed to update pin status.');
    } finally {
      setPinning(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this note? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await deleteDoc(docPath);
      toast.success('Note deleted.');
    } catch {
      toast.error('Failed to delete note.');
      setDeleting(false);
    }
  };

  const editInitial: Partial<NoteFormState> = {
    title: note.title ?? '',
    noteType: note.noteType,
    content: note.content,
    isPinned: note.isPinned,
    isPrivate: note.isPrivate,
  };

  return (
    <Card className="border-gray-200 shadow-sm transition-shadow hover:shadow-md">
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-start justify-between gap-2">
          {/* Left: type + title + meta */}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <NoteTypeIcon type={note.noteType} />
              {note.isPinned && (
                <Badge
                  variant="outline"
                  className="border-amber-200 bg-amber-50 text-xs text-amber-700"
                >
                  <Pin className="mr-1 h-2.5 w-2.5" />
                  Pinned
                </Badge>
              )}
              {note.isPrivate && (
                <Badge
                  variant="outline"
                  className="border-gray-200 bg-gray-50 text-xs text-gray-500"
                >
                  <Lock className="mr-1 h-2.5 w-2.5" />
                  Private
                </Badge>
              )}
              {note.source === 'ai' && (
                <Badge
                  variant="outline"
                  className="border-purple-200 bg-purple-50 text-xs text-purple-700"
                >
                  <Bot className="mr-1 h-2.5 w-2.5" />
                  AI
                </Badge>
              )}
            </div>

            {note.title && (
              <h3 className="text-sm font-semibold text-[#1a365d]">{note.title}</h3>
            )}

            <p className="text-xs text-gray-400">
              {formatTimestamp(note.createdAt as Parameters<typeof formatTimestamp>[0])}
              {note.createdBy && (
                <span className="ml-1.5">· {note.createdBy}</span>
              )}
            </p>
          </div>

          {/* Right: action buttons */}
          {!isEditing && (
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-gray-400 hover:text-amber-500"
                title={note.isPinned ? 'Unpin note' : 'Pin note'}
                disabled={pinning}
                onClick={() => void handleTogglePin()}
              >
                {note.isPinned ? (
                  <PinOff className="h-4 w-4" />
                ) : (
                  <Pin className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-gray-500 hover:text-[#2b6cb0]"
                onClick={() => setIsEditing(true)}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-gray-400 hover:text-red-500"
                title="Delete note"
                disabled={deleting}
                onClick={() => void handleDelete()}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 pt-0">
        {isEditing ? (
          <NoteForm
            firmId={firmId}
            clientId={clientId}
            authorUid={authorUid}
            initialData={editInitial}
            editNoteId={note.id}
            onClose={() => setIsEditing(false)}
          />
        ) : (
          <div className="space-y-3">
            {/* Note body */}
            <p className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed">
              {note.content}
            </p>

            {/* Audio player */}
            {note.audioUrl && (
              <div className="space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-gray-600">
                    {note.audioFileName ?? 'Audio recording'}
                    {note.audioDurationSeconds && note.audioDurationSeconds > 0 && (
                      <span className="ml-1 text-gray-400">
                        ({formatDuration(note.audioDurationSeconds)})
                      </span>
                    )}
                  </span>
                  <TranscriptionBadge status={note.transcriptionStatus} />
                </div>
                {/* Only render the audio element if it's a real URL (not a data URI too large to display) */}
                {note.audioUrl && (
                  <audio
                    controls
                    src={note.audioUrl}
                    className="h-8 w-full"
                  />
                )}
              </div>
            )}

            {/* Transcription section */}
            {note.transcriptionStatus === 'completed' && note.transcription && (
              <div>
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs font-medium text-[#2b6cb0] hover:underline"
                  onClick={() => setShowTranscription((v) => !v)}
                >
                  {showTranscription ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                  {showTranscription ? 'Hide transcription' : 'Show transcription'}
                </button>
                {showTranscription && (
                  <div className="mt-2 rounded-lg border border-gray-200 bg-white p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                      Transcription
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
                      {note.transcription}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* AI summary */}
            {note.aiSummary && (
              <Alert className="border-purple-200 bg-purple-50">
                <Bot className="h-4 w-4 text-purple-600" />
                <AlertDescription className="text-sm text-purple-800">
                  <span className="font-semibold">AI Summary: </span>
                  {note.aiSummary}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function NotesLoadingSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <Card key={i} className="border-gray-200 shadow-sm">
          <CardHeader className="pb-2 pt-3 px-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-7 w-20" />
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <Skeleton className="h-14 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyNotes({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50/40 py-20 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#ebf4ff]">
        <StickyNote className="h-7 w-7 text-[#2b6cb0]" />
      </div>
      <h3 className="text-base font-semibold text-[#1a365d]">No notes yet</h3>
      <p className="mt-1 max-w-sm text-sm text-gray-500">
        Add your first note to track client communications.
      </p>
      <Button
        size="sm"
        className="mt-5 gap-2 bg-[#1a365d] text-white hover:bg-[#1e407a]"
        onClick={onAdd}
      >
        <Plus className="h-4 w-4" />
        Add First Note
      </Button>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

interface NotesTabProps {
  firmId: string;
  clientId: string;
  /** When true, automatically opens the new note form (e.g. from quick-action button) */
  autoOpenNewNote?: boolean;
}

export default function NotesTab({ firmId, clientId, autoOpenNewNote = false }: NotesTabProps) {
  const { user } = useAuth();
  const authorUid = user?.uid ?? '';

  const [showNewForm, setShowNewForm] = useState(autoOpenNewNote);
  const [initialAction, setInitialAction] = useState<'record' | 'upload' | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');

  // Sync if parent toggles autoOpenNewNote dynamically
  useEffect(() => {
    if (autoOpenNewNote) setShowNewForm(true);
  }, [autoOpenNewNote]);

  // ── Firestore subscription ──────────────────────────────────────────────
  const collPath =
    firmId && clientId ? COLLECTIONS.NOTES(firmId, clientId) : null;

  const { data: notes, loading, error } = useCollection<Note>(
    collPath,
    useMemo(() => [orderBy('createdAt', 'desc')], []),
  );

  // ── Client-side search filter ───────────────────────────────────────────
  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) return notes;
    const q = searchQuery.toLowerCase();
    return notes.filter(
      (n) =>
        n.content.toLowerCase().includes(q) ||
        (n.title ?? '').toLowerCase().includes(q),
    );
  }, [notes, searchQuery]);

  // ── Separate pinned from unpinned ───────────────────────────────────────
  const pinnedNotes = useMemo(
    () => filteredNotes.filter((n) => n.isPinned),
    [filteredNotes],
  );
  const unpinnedNotes = useMemo(
    () => filteredNotes.filter((n) => !n.isPinned),
    [filteredNotes],
  );

  const hasPinned = pinnedNotes.length > 0;
  const hasAny = filteredNotes.length > 0;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Search */}
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search notes…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="border-gray-200 pl-9 text-sm"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-2 text-[#2b6cb0] border-[#2b6cb0]/20 hover:bg-blue-50"
            onClick={() => {
              setInitialAction('record');
              setShowNewForm(true);
            }}
          >
            <Mic className="h-4 w-4" />
            <span className="hidden sm:inline">Record Audio</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="gap-2 text-[#2b6cb0] border-[#2b6cb0]/20 hover:bg-blue-50"
            onClick={() => {
              setInitialAction('upload');
              setShowNewForm(true);
            }}
          >
            <Paperclip className="h-4 w-4" />
            <span className="hidden sm:inline">Upload Audio</span>
          </Button>

          {/* New note button */}
          <Button
            size="sm"
            className="gap-2 bg-[#1a365d] text-white hover:bg-[#1e407a]"
            onClick={() => {
              if (showNewForm) {
                setShowNewForm(false);
                setInitialAction(undefined);
              } else {
                setInitialAction(undefined);
                setShowNewForm(true);
              }
            }}
          >
            {showNewForm ? (
              <>
                <X className="h-4 w-4" />
                Cancel
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                New Note
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ── New note form ─────────────────────────────────────────────────── */}
      {showNewForm && (
        <NoteForm
          firmId={firmId}
          clientId={clientId}
          authorUid={authorUid}
          initialAction={initialAction}
          onClose={() => {
            setShowNewForm(false);
            setInitialAction(undefined);
          }}
        />
      )}

      {/* ── Error state ───────────────────────────────────────────────────── */}
      {error && (
        <Alert className="border-red-200 bg-red-50">
          <AlertDescription className="text-red-800">
            Failed to load notes: {error.message}
          </AlertDescription>
        </Alert>
      )}

      {/* ── Loading skeleton ──────────────────────────────────────────────── */}
      {loading && <NotesLoadingSkeleton />}

      {/* ── Empty state ───────────────────────────────────────────────────── */}
      {!loading && !error && notes.length === 0 && (
        <EmptyNotes onAdd={() => setShowNewForm(true)} />
      )}

      {/* ── No search results ─────────────────────────────────────────────── */}
      {!loading && !error && notes.length > 0 && !hasAny && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/40 py-14 text-center">
          <Search className="mx-auto mb-3 h-8 w-8 text-gray-300" />
          <p className="text-sm text-gray-500">
            No notes match <span className="font-medium">"{searchQuery}"</span>.
          </p>
          <button
            type="button"
            className="mt-2 text-xs text-[#2b6cb0] hover:underline"
            onClick={() => setSearchQuery('')}
          >
            Clear search
          </button>
        </div>
      )}

      {/* ── Notes feed ────────────────────────────────────────────────────── */}
      {!loading && !error && hasAny && (
        <div className="space-y-4">
          {/* Pinned section */}
          {hasPinned && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Pin className="h-3.5 w-3.5 text-amber-500" />
                <span className="text-xs font-semibold uppercase tracking-wider text-amber-600">
                  Pinned
                </span>
              </div>
              {pinnedNotes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  firmId={firmId}
                  clientId={clientId}
                  authorUid={authorUid}
                />
              ))}
            </div>
          )}

          {/* Divider between pinned and unpinned */}
          {hasPinned && unpinnedNotes.length > 0 && (
            <div className="flex items-center gap-2">
              <Separator className="flex-1" />
              <span className="text-xs text-gray-400">All notes</span>
              <Separator className="flex-1" />
            </div>
          )}

          {/* Unpinned (chronological) */}
          {unpinnedNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              firmId={firmId}
              clientId={clientId}
              authorUid={authorUid}
            />
          ))}
        </div>
      )}
    </div>
  );
}
