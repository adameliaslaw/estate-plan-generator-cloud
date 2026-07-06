/**
 * functions/src/summarize-pending-transcript.ts
 *
 * summarizePendingTranscript — Firestore-triggered (v2 onDocumentCreated) AI
 * summary for the "Transcripts – Pending Filing" queue.
 *
 * The external, Admin-SDK transcription pipeline writes a finished consult
 * transcript into `firms/{firmId}/pendingTranscripts/{transcriptId}` with
 * status 'pending'. This trigger fires on that create, calls Claude to produce
 * a short triage summary (overview / key points / action items / matter-type
 * hint), and writes it back onto the SAME document as additive metadata so it's
 * already waiting when staff open the queue.
 *
 * Guarantees:
 *  - Summary is additive only — never moves, deletes, or re-statuses the
 *    transcript. A summary failure is a degraded state (summaryStatus 'error'),
 *    never a lost or unfileable transcript.
 *  - Uses the firm's per-firm Anthropic key (firms/{firmId}/secrets/apiKeys),
 *    loaded via loadFirmSecrets — no new secret, no hard-coded key.
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { callAI, parseAIJson, sanitizeForPrompt, type FirmData } from './ai-client';
import { loadFirmSecrets } from './firm-secrets';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TranscriptSegment {
  speaker: string;
  text: string;
}

/** Structured summary written to the transcript's `summary` field. */
interface TranscriptSummary {
  overview: string;
  keyPoints: string[];
  actionItems: string[];
  matterTypeHint: string;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SUMMARY_SCHEMA = {
  name: 'transcript_summary',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      overview: {
        type: 'string',
        description: '2-4 sentences on what the consult was about.',
      },
      keyPoints: {
        type: 'array',
        items: { type: 'string' },
        description: 'The main points discussed, grounded in the transcript.',
      },
      actionItems: {
        type: 'array',
        items: { type: 'string' },
        description: 'Follow-ups for the firm. Empty array if none are stated.',
      },
      matterTypeHint: {
        type: 'string',
        description:
          'A brief hint at the kind of matter (e.g. will, revocable trust, SNT, ' +
          'real estate, tax), to help staff route it. Empty string if unclear.',
      },
    },
    required: ['overview', 'keyPoints', 'actionItems', 'matterTypeHint'],
  },
} as const;

const SYSTEM_PROMPT =
  'You are a legal assistant helping an estate-planning law firm triage a consult. ' +
  'You are given the transcript of a client consultation. Produce a short, factual ' +
  'summary to help staff route and file it. Stay strictly grounded in the transcript: ' +
  'do not invent client names, dates, dollar amounts, or facts that are not present, ' +
  'and do not give legal advice or recommend a legal strategy. If something is ' +
  'unclear or was not discussed, say so plainly rather than guessing. Keep it concise.';

/** Render speaker-labeled segments when transcriptText is empty. */
function formatSegments(segments: TranscriptSegment[]): string {
  return segments.map((s) => `Speaker ${s.speaker}: ${s.text}`).join('\n\n');
}

/**
 * Pick a Claude model for the summary: honor the firm's configured Claude
 * drafting model if it is one, otherwise a fast/cheap Claude default. This
 * feature is defined as "summarize with Claude", so we never route to a
 * non-Anthropic provider here.
 */
function resolveClaudeModel(firmData: FirmData): string {
  const configured = firmData.documentDraftingModel;
  if (typeof configured === 'string' && /claude|opus|sonnet|haiku/i.test(configured)) {
    return configured;
  }
  return 'claude-haiku-4-5-20251001';
}

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

export const summarizePendingTranscript = onDocumentCreated(
  {
    document: 'firms/{firmId}/pendingTranscripts/{transcriptId}',
    region: 'us-east1',
    timeoutSeconds: 120,
  },
  async (event) => {
    const { firmId, transcriptId } = event.params;
    const snap = event.data;
    if (!snap) return;

    const data = snap.data();
    if (!data) return;

    // Only summarize freshly-created, still-pending transcripts.
    if (data.status !== 'pending') {
      console.log(
        `[summarizePendingTranscript] ${transcriptId} status=${data.status ?? 'unknown'} — skipping.`,
      );
      return;
    }

    // Idempotency guard against at-least-once redelivery: if a summary is
    // already done or in flight, don't run again.
    if (data.summaryStatus === 'complete' || data.summaryStatus === 'processing') {
      console.log(
        `[summarizePendingTranscript] ${transcriptId} summaryStatus=${data.summaryStatus} — skipping.`,
      );
      return;
    }

    const ref = snap.ref;
    const now = admin.firestore.FieldValue.serverTimestamp();

    // Resolve transcript body: prefer transcriptText, fall back to segments.
    const transcriptText =
      typeof data.transcriptText === 'string' && data.transcriptText.trim()
        ? data.transcriptText
        : formatSegments((data.segments as TranscriptSegment[] | undefined) ?? []);

    if (!transcriptText.trim()) {
      // Nothing to summarize — record a non-fatal error state, leave fileable.
      await ref.update({
        summary: null,
        summaryStatus: 'error',
        summaryError: 'Transcript is empty — nothing to summarize.',
        summaryGeneratedAt: now,
      });
      return;
    }

    // Mark processing so the UI can show a loading state immediately.
    await ref.update({ summaryStatus: 'processing', summaryError: null });

    try {
      const firmSnap = await admin.firestore().collection('firms').doc(firmId).get();
      const firmData = {
        ...(firmSnap.data() ?? {}),
        ...(await loadFirmSecrets(firmId)),
      } as FirmData;

      const model = resolveClaudeModel(firmData);
      // Cap the transcript fed to the model; injection-strip the free text.
      const safeTranscript = sanitizeForPrompt(transcriptText, { maxLength: 40000 });
      const userPrompt =
        `Summarize this estate-planning consult transcript:\n\n---\n${safeTranscript}\n---`;

      const raw = await callAI(SYSTEM_PROMPT, userPrompt, firmData, {
        model,
        temperature: 0.2,
        maxTokens: 1500,
        jsonSchema: SUMMARY_SCHEMA,
      });

      const parsed = parseAIJson<Partial<TranscriptSummary>>(raw);
      const summary: TranscriptSummary = {
        overview: typeof parsed.overview === 'string' ? parsed.overview : '',
        keyPoints: Array.isArray(parsed.keyPoints)
          ? parsed.keyPoints.filter((p): p is string => typeof p === 'string')
          : [],
        actionItems: Array.isArray(parsed.actionItems)
          ? parsed.actionItems.filter((p): p is string => typeof p === 'string')
          : [],
        matterTypeHint: typeof parsed.matterTypeHint === 'string' ? parsed.matterTypeHint : '',
      };

      await ref.update({
        summary,
        summaryStatus: 'complete',
        summaryError: null,
        summaryGeneratedAt: now,
      });
      console.log(`[summarizePendingTranscript] ${transcriptId} summarized (model=${model}).`);
    } catch (err) {
      // Never fail the transcript itself — record the error, leave it fileable.
      const message = err instanceof Error ? err.message : 'Unknown summary error';
      console.error(`[summarizePendingTranscript] ${transcriptId} failed:`, err);
      await ref
        .update({
          summary: null,
          summaryStatus: 'error',
          summaryError: message.slice(0, 500),
          summaryGeneratedAt: now,
        })
        .catch((updateErr) => {
          console.error(
            `[summarizePendingTranscript] ${transcriptId} failed to write error status:`,
            updateErr,
          );
        });
    }
  },
);
