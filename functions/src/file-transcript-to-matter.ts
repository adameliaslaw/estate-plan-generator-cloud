/**
 * functions/src/file-transcript-to-matter.ts
 *
 * fileTranscriptToMatter — staff-only callable that files a pending transcript
 * (written into `firms/{firmId}/pendingTranscripts` by an external, Admin-SDK
 * authenticated transcription pipeline — this repo never handles audio) into
 * a client matter. The transcript is written as a Note on the target client
 * (mirroring the audio-dictation Note convention in transcribe-audio.ts: full
 * text lives in `transcription`, not `content`), then the pending record is
 * marked 'filed' and kept as an audit trail — never deleted.
 */

import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { z } from 'zod';
import { assertStaff } from './auth-guards';

const RequestSchema = z.object({
  transcriptId: z.string().min(1).max(200),
  matterId: z.string().min(1).max(200),
});

interface TranscriptSegment {
  speaker: string;
  text: string;
}

/** Mirrors formatSpeakerTranscript() in assemblyai-transcribe.ts. */
function formatSegments(segments: TranscriptSegment[]): string {
  return segments.map((s) => `Speaker ${s.speaker}: ${s.text}`).join('\n\n');
}

export const fileTranscriptToMatter = onCall(
  { region: 'us-east1', invoker: 'public', cors: true },
  async (request: CallableRequest<unknown>) => {
    const caller = assertStaff(request);
    if (!caller.firmId) {
      throw new HttpsError('permission-denied', 'Staff account is missing a firm assignment.');
    }

    const parsed = RequestSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError('invalid-argument', 'transcriptId and matterId are required.');
    }
    const { transcriptId, matterId } = parsed.data;
    const firmId = caller.firmId;

    const db = admin.firestore();
    const transcriptRef = db
      .collection('firms').doc(firmId)
      .collection('pendingTranscripts').doc(transcriptId);
    const clientRef = db
      .collection('firms').doc(firmId)
      .collection('clients').doc(matterId);

    const [transcriptSnap, clientSnap] = await Promise.all([
      transcriptRef.get(),
      clientRef.get(),
    ]);

    if (!transcriptSnap.exists) {
      throw new HttpsError('not-found', `Pending transcript ${transcriptId} not found.`);
    }
    if (!clientSnap.exists) {
      throw new HttpsError('not-found', `Matter ${matterId} not found.`);
    }

    const transcript = transcriptSnap.data()!;
    if (transcript.status === 'filed') {
      throw new HttpsError('failed-precondition', 'This transcript has already been filed.');
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const noteRef = clientRef.collection('notes').doc();
    const sourceFilename = (transcript.sourceFilename as string | undefined) ?? 'untitled recording';
    const segments = (transcript.segments as TranscriptSegment[] | undefined) ?? [];

    // Prefer speaker-attributed segments; fall back to the flat transcriptText
    // (the canonical PendingTranscript field) so a transcript that has text but
    // empty/missing segments doesn't file an empty note marked 'completed'
    // (R5-038). Refuse to file when there is no content at all.
    const transcriptText = (transcript.transcriptText as string | undefined)?.trim() ?? '';
    const transcriptionBody = segments.length > 0 ? formatSegments(segments) : transcriptText;
    if (!transcriptionBody.trim()) {
      throw new HttpsError('failed-precondition', 'This transcript has no content to file.');
    }

    const batch = db.batch();
    batch.set(noteRef, {
      firmId,
      clientId: matterId,
      noteType: 'transcript',
      source: 'system',
      content: `Consult transcript filed — ${sourceFilename}`,
      transcription: transcriptionBody,
      transcriptionStatus: 'completed',
      audioFileName: sourceFilename,
      audioDurationSeconds: (transcript.durationSeconds as number | undefined) ?? null,
      isPinned: false,
      isPrivate: false,
      createdAt: now,
      updatedAt: now,
      createdBy: caller.uid,
      updatedBy: caller.uid,
    });
    batch.update(transcriptRef, {
      status: 'filed',
      filedToMatterId: matterId,
      filedAt: now,
      filedBy: caller.uid,
    });
    await batch.commit();

    return { success: true, noteId: noteRef.id, matterId };
  },
);
