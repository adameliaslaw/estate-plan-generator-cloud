/**
 * PendingTranscriptsPage.tsx
 *
 * Staff-only "Transcripts – Pending Filing" queue. Consult recordings are
 * transcribed outside this app (a trusted, Admin-SDK authenticated script
 * writes the finished text transcript into `pendingTranscripts`) — this app
 * never receives, stores, or plays audio. Staff review each pending
 * transcript and file it into the correct client matter with one click.
 */

import { useMemo, useState } from 'react';
import { orderBy, where } from 'firebase/firestore';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  Info,
  Languages,
  Loader2,
  Mic,
  Sparkles,
  Users,
} from 'lucide-react';

import { useAuth } from '@/hooks/useAuth';
import { useCollection } from '@/hooks/useFirestore';
import { COLLECTIONS } from '@/config/constants';
import { pendingTranscriptService } from '@/services/pending-transcript-service';
import type { Client, PendingTranscript } from '@/types';

import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { createClientFromName } from '@/lib/create-client';

// ── Helpers ──────────────────────────────────────────────────────────────────

function clientDisplayName(client: Client): string {
  const { lastName, firstName } = client.personalInfo ?? {};
  if (!lastName && !firstName) return 'Unknown Client';
  if (!firstName) return lastName ?? '';
  return `${lastName}, ${firstName}`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatTimestamp(ts: { toDate?: () => Date } | Date | undefined): string {
  if (!ts) return '—';
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

// ── AI summary panel ─────────────────────────────────────────────────────────

/**
 * Renders the AI triage summary for a transcript. An absent status is treated
 * as loading (the trigger fires within moments of the doc landing). A failed
 * summary shows a small, unobtrusive notice — never an error dialog — and the
 * raw transcript below stays fully available.
 */
function SummaryPanel({ transcript }: { transcript: PendingTranscript }) {
  const status = transcript.summaryStatus ?? 'pending';
  const summary = transcript.summary;

  if (status === 'complete' && summary) {
    return (
      <div className="rounded-lg border border-[#2b6cb0]/20 bg-[#ebf4fb]/60 p-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#2b6cb0]">
          <Sparkles className="h-3.5 w-3.5" />
          AI Summary
          {summary.matterTypeHint && (
            <span className="ml-1 rounded-full bg-[#2b6cb0]/10 px-2 py-0.5 text-[11px] font-medium text-[#2b6cb0]">
              {summary.matterTypeHint}
            </span>
          )}
        </div>

        {summary.overview && (
          <p className="mt-2 text-sm text-gray-700">{summary.overview}</p>
        )}

        {summary.keyPoints.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold text-gray-600">Key points</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-700">
              {summary.keyPoints.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          </div>
        )}

        {summary.actionItems.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold text-gray-600">Action items</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-700">
              {summary.actionItems.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-500">
        <Info className="h-3.5 w-3.5 shrink-0" />
        AI summary unavailable for this transcript. The full transcript is below.
      </div>
    );
  }

  // pending | processing | absent → loading
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-500">
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#2b6cb0]" />
      Generating AI summary…
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PendingTranscriptsPage() {
  const { userProfile } = useAuth();
  const firmId = userProfile?.firmId ?? '';

  const { data: transcripts, loading, error } = useCollection<PendingTranscript>(
    firmId ? COLLECTIONS.PENDING_TRANSCRIPTS(firmId) : null,
    useMemo(() => [where('status', '==', 'pending'), orderBy('createdAt', 'desc')], []),
  );

  const { data: clients } = useCollection<Client>(
    firmId ? COLLECTIONS.CLIENTS(firmId) : null,
    useMemo(() => [orderBy('updatedAt', 'desc')], []),
  );

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedMatter, setSelectedMatter] = useState<Record<string, string>>({});
  const [filingId, setFilingId] = useState<string | null>(null);

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleCreateClient(name: string): Promise<ComboboxOption | null> {
    if (!firmId || !userProfile?.uid) {
      toast.error('Unable to determine your account. Please sign in again.');
      return null;
    }
    try {
      const c = await createClientFromName(firmId, userProfile.uid, name);
      toast.success(`Client "${name}" created.`);
      return { value: c.id, label: `${c.firstName} ${c.lastName}`.trim() };
    } catch (err) {
      console.error('[PendingTranscriptsPage] create client failed:', err);
      toast.error('Failed to create client.');
      return null;
    }
  }

  async function handleFile(transcript: PendingTranscript & { id: string }) {
    const matterId = selectedMatter[transcript.id];
    if (!matterId) {
      toast.error('Select a matter before filing.');
      return;
    }
    setFilingId(transcript.id);
    try {
      await pendingTranscriptService.fileTranscriptToMatter({
        transcriptId: transcript.id,
        matterId,
      });
      toast.success('Transcript filed to matter.');
    } catch (err) {
      console.error('[PendingTranscriptsPage] file error:', err);
      toast.error('Failed to file transcript.');
    } finally {
      setFilingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#1a365d]">
          Transcripts – Pending Filing
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Review consult transcripts and file each one to the correct client matter.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-amber-50 p-1.5">
              <FileText className="h-4 w-4 text-amber-600" />
            </div>
            <h3 className="text-base font-semibold text-[#1a365d]">Pending Transcripts</h3>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
              {transcripts.length}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3 p-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-100" />
            ))}
          </div>
        ) : error ? (
          // Don't render the "queue is clear" success state on a query failure —
          // an empty list from an error is not an empty queue (R5-067).
          <div className="flex flex-col items-center justify-center gap-2 px-5 py-16 text-center">
            <AlertTriangle className="h-10 w-10 text-red-300" />
            <p className="text-sm text-red-600">Couldn't load the queue. Refresh to try again.</p>
          </div>
        ) : transcripts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-5 py-16 text-center">
            <CheckCircle2 className="h-10 w-10 text-gray-300" />
            <p className="text-sm text-gray-400">Queue is clear — no transcripts awaiting filing</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {transcripts.map((t) => {
              const isExpanded = expandedIds.has(t.id);
              const isFiling = filingId === t.id;
              return (
                <li key={t.id} className="px-5 py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[#1a365d]">
                        {t.sourceFilename}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {formatTimestamp(t.createdAt)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Mic className="h-3.5 w-3.5" />
                          {formatDuration(t.durationSeconds)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          {t.speakerCount} speaker{t.speakerCount === 1 ? '' : 's'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Languages className="h-3.5 w-3.5" />
                          {t.language}
                        </span>
                      </div>
                      <button
                        onClick={() => toggleExpanded(t.id)}
                        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#2b6cb0] hover:underline"
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp className="h-3.5 w-3.5" />
                            Hide transcript
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-3.5 w-3.5" />
                            Preview transcript
                          </>
                        )}
                      </button>
                    </div>

                    <div className="flex items-center gap-2 sm:shrink-0">
                      <div className="w-56">
                        <Combobox
                          className="h-9"
                          placeholder="Select matter…"
                          emptyText="No matching client."
                          value={selectedMatter[t.id] ?? ''}
                          onChange={(v) => setSelectedMatter((prev) => ({ ...prev, [t.id]: v }))}
                          options={clients.map((c) => ({ value: c.id, label: clientDisplayName(c) }))}
                          onCreate={handleCreateClient}
                          createLabel={(name) => `Create client "${name}"`}
                        />
                      </div>
                      <Button
                        size="sm"
                        disabled={!selectedMatter[t.id] || isFiling}
                        onClick={() => handleFile(t)}
                        className="bg-[#2b6cb0] text-white hover:bg-[#2563a8]"
                      >
                        {isFiling ? 'Filing…' : 'File to Matter'}
                      </Button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 space-y-3">
                      <SummaryPanel transcript={t} />

                      <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50/60 p-3 text-sm text-gray-700 space-y-2">
                        {t.segments.length === 0 ? (
                          <p className="text-gray-400">No transcript text available.</p>
                        ) : (
                          t.segments.map((seg, i) => (
                            <p key={i}>
                              <span className="font-semibold text-[#1a365d]">Speaker {seg.speaker}:</span>{' '}
                              {seg.text}
                            </p>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
