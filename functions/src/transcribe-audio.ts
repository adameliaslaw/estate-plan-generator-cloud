/**
 * functions/src/transcribe-audio.ts
 *
 * Two callable Cloud Functions for audio transcription and AI summarization:
 *
 * 1. transcribeAudio — Downloads an audio file from Cloud Storage, sends it to
 *    OpenAI Whisper (whisper-1) for transcription, and persists the result to
 *    the corresponding Note document in Firestore.
 *
 * 2. summarizeTranscription — Reads a completed transcription from a Note doc
 *    and generates a concise legal-assistant summary using GPT-4.1.
 *
 * Firestore path:  firms/{firmId}/clients/{clientId}/notes/{noteId}
 * Storage path:    Provided by the caller as `storagePath` (e.g.
 *                  "firms/abc/clients/xyz/notes/note123.m4a")
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import OpenAI, { toFile } from 'openai';
import { callAI } from './ai-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TranscribeAudioRequest {
  firmId: string;
  clientId: string;
  noteId: string;
  /** Full Cloud Storage object path, e.g. "firms/abc/clients/xyz/notes/note123.m4a" */
  storagePath: string;
}

interface SummarizeTranscriptionRequest {
  firmId: string;
  clientId: string;
  noteId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the Firestore reference for a note document.
 */
function noteRef(
  db: admin.firestore.Firestore,
  firmId: string,
  clientId: string,
  noteId: string,
): admin.firestore.DocumentReference {
  return db
    .collection('firms')
    .doc(firmId)
    .collection('clients')
    .doc(clientId)
    .collection('notes')
    .doc(noteId);
}

/**
 * Derive a MIME type from a Cloud Storage file path for Whisper's `file` param.
 * Whisper supports: flac, m4a, mp3, mp4, mpeg, mpga, oga, ogg, wav, webm.
 */
function mimeTypeFromPath(storagePath: string): string {
  const ext = storagePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    mp4: 'audio/mp4',
    mpeg: 'audio/mpeg',
    mpga: 'audio/mpeg',
    oga: 'audio/ogg',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
    webm: 'audio/webm',
  };
  return map[ext] ?? 'audio/mpeg';
}

// ---------------------------------------------------------------------------
// Function 1 — transcribeAudio
// ---------------------------------------------------------------------------

/**
 * transcribeAudio
 *
 * Downloads an audio file from Cloud Storage and sends it to OpenAI Whisper
 * for speech-to-text transcription.  The resulting text is saved back to the
 * Note document in Firestore.
 *
 * Input:  { firmId, clientId, noteId, storagePath }
 * Output: { success: true, transcription: string }
 */
export const transcribeAudio = onCall(
  {
    region: 'us-east1',
    timeoutSeconds: 300, // 5 minutes — large audio files can take time
    memory: '512MiB',
  },
  async (request: any /* CallableRequest */) => {
    // ------------------------------------------------------------------
    // 1. Auth check
    // ------------------------------------------------------------------
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be logged in to transcribe audio.');
    }

    const { firmId, clientId, noteId, storagePath } =
      request.data as TranscribeAudioRequest;

    if (!firmId || !clientId || !noteId || !storagePath) {
      throw new HttpsError(
        'invalid-argument',
        'firmId, clientId, noteId, and storagePath are all required.',
      );
    }

    console.log(
      `[transcribeAudio] START firmId=${firmId} clientId=${clientId} noteId=${noteId} path=${storagePath}`,
    );

    const db = admin.firestore();
    const ref = noteRef(db, firmId, clientId, noteId);
    const now = admin.firestore.FieldValue.serverTimestamp();

    // ------------------------------------------------------------------
    // 2. Verify the Note doc exists before doing expensive work
    // ------------------------------------------------------------------
    const noteSnap = await ref.get();
    if (!noteSnap.exists) {
      throw new HttpsError('not-found', `Note ${noteId} not found.`);
    }

    // ------------------------------------------------------------------
    // 3. Mark note as processing
    // ------------------------------------------------------------------
    await ref.update({
      transcriptionStatus: 'processing',
      transcriptionStartedAt: now,
      updatedAt: now,
      updatedBy: request.auth.uid,
    });

    try {
      // ----------------------------------------------------------------
      // 4. Download audio from Cloud Storage into a Buffer
      // ----------------------------------------------------------------
      const bucket = admin.storage().bucket(); // default bucket
      const file = bucket.file(storagePath);

      const [fileExists] = await file.exists();
      if (!fileExists) {
        throw new HttpsError('not-found', `Audio file not found at path: ${storagePath}`);
      }

      console.log(`[transcribeAudio] Downloading audio from gs://${bucket.name}/${storagePath}`);
      const [audioBuffer] = await file.download();

      console.log(`[transcribeAudio] Audio downloaded — ${audioBuffer.length} bytes`);

      // ----------------------------------------------------------------
      // 5. Send to OpenAI Whisper
      //    We instantiate OpenAI directly here (same env var as ai-client.ts)
      //    because the Whisper API requires the raw client for file uploads.
      // ----------------------------------------------------------------
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new HttpsError(
          'internal',
          'OPENAI_API_KEY environment variable is not set.',
        );
      }
      const openai = new OpenAI({ apiKey });
      const filename = storagePath.split('/').pop() ?? 'audio.mp3';
      const mimeType = mimeTypeFromPath(storagePath);

      // The openai SDK's `toFile` helper wraps a Buffer/Blob as a File-like
      // object so Whisper can detect the format from the filename extension.
      const audioFile = await toFile(audioBuffer, filename, { type: mimeType });

      console.log(`[transcribeAudio] Sending to Whisper — model=whisper-1 mime=${mimeType}`);
      const transcriptionResponse = await openai.audio.transcriptions.create({
        model: 'whisper-1',
        file: audioFile,
        response_format: 'text',
      });

      // response_format: 'text' returns a plain string, not an object
      const transcriptionText = transcriptionResponse as unknown as string;

      console.log(
        `[transcribeAudio] Transcription complete — ${transcriptionText.length} chars`,
      );

      // ----------------------------------------------------------------
      // 6. Save transcription to Firestore
      // ----------------------------------------------------------------
      await ref.update({
        transcription: transcriptionText,
        transcriptionStatus: 'completed',
        transcriptionCompletedAt: now,
        updatedAt: now,
        updatedBy: request.auth.uid,
      });

      console.log(`[transcribeAudio] Saved transcription to noteId=${noteId}`);

      return {
        success: true,
        noteId,
        transcription: transcriptionText,
        charCount: transcriptionText.length,
      };
    } catch (error) {
      // ----------------------------------------------------------------
      // Error path — mark note as failed so the UI can surface a retry
      // ----------------------------------------------------------------
      console.error(`[transcribeAudio] Error for noteId=${noteId}:`, error);

      await ref.update({
        transcriptionStatus: 'failed',
        transcriptionError:
          error instanceof Error ? error.message : 'Unknown transcription error',
        updatedAt: now,
        updatedBy: request.auth.uid,
      }).catch((updateErr) => {
        // Don't mask the original error if the status update itself fails
        console.error('[transcribeAudio] Failed to write error status:', updateErr);
      });

      // Re-throw as HttpsError so the client gets a clean error code
      if (error instanceof HttpsError) throw error;
      throw new HttpsError(
        'internal',
        `Transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Function 2 — summarizeTranscription
// ---------------------------------------------------------------------------

/**
 * summarizeTranscription
 *
 * Reads a completed transcription from a Note document and calls GPT-4.1 to
 * produce a concise legal-assistant summary highlighting key decisions, action
 * items, and client concerns.
 *
 * Input:  { firmId, clientId, noteId }
 * Output: { success: true, summary: string }
 */
export const summarizeTranscription = onCall(
  {
    region: 'us-east1',
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async (request: any /* CallableRequest */) => {
    // ------------------------------------------------------------------
    // 1. Auth check
    // ------------------------------------------------------------------
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be logged in to summarize transcriptions.');
    }

    const { firmId, clientId, noteId } =
      request.data as SummarizeTranscriptionRequest;

    if (!firmId || !clientId || !noteId) {
      throw new HttpsError('invalid-argument', 'firmId, clientId, and noteId are required.');
    }

    console.log(
      `[summarizeTranscription] START firmId=${firmId} clientId=${clientId} noteId=${noteId}`,
    );

    const db = admin.firestore();
    const ref = noteRef(db, firmId, clientId, noteId);
    const now = admin.firestore.FieldValue.serverTimestamp();

    // ------------------------------------------------------------------
    // 2. Read note and validate transcription is present
    // ------------------------------------------------------------------
    const noteSnap = await ref.get();
    if (!noteSnap.exists) {
      throw new HttpsError('not-found', `Note ${noteId} not found.`);
    }

    const noteData = noteSnap.data()!;
    const transcription = noteData.transcription as string | undefined;

    if (!transcription || transcription.trim().length === 0) {
      throw new HttpsError(
        'failed-precondition',
        'No transcription found on this note. Run transcribeAudio first.',
      );
    }

    if (noteData.transcriptionStatus !== 'completed') {
      throw new HttpsError(
        'failed-precondition',
        `Transcription is not yet complete (status: ${noteData.transcriptionStatus ?? 'unknown'}).`,
      );
    }

    // ------------------------------------------------------------------
    // 3. Generate AI summary via GPT-4.1
    // ------------------------------------------------------------------
    const systemPrompt =
      'You are a legal assistant. Summarize the following transcription of a client ' +
      'meeting/call for an estate planning attorney. Be concise, highlight key decisions, ' +
      'action items, and client concerns. Do not include any legal advice.';

    const userPrompt =
      `Please summarize the following transcription:\n\n---\n${transcription.slice(0, 30000)}\n---`;

    console.log(`[summarizeTranscription] Calling GPT-4.1 — transcription length=${transcription.length}`);

    let aiSummary: string;
    try {
      aiSummary = await callAI(systemPrompt, userPrompt, {
        model: 'gpt-4.1',
        temperature: 0.2,
        maxTokens: 1024,
      });
    } catch (error) {
      console.error('[summarizeTranscription] GPT-4.1 error:', error);
      throw new HttpsError(
        'internal',
        `Summary generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    console.log(`[summarizeTranscription] Summary generated — ${aiSummary.length} chars`);

    // ------------------------------------------------------------------
    // 4. Save aiSummary to Firestore
    // ------------------------------------------------------------------
    await ref.update({
      aiSummary,
      aiSummaryGeneratedAt: now,
      updatedAt: now,
      updatedBy: request.auth.uid,
    });

    console.log(`[summarizeTranscription] Saved summary to noteId=${noteId}`);

    return {
      success: true,
      noteId,
      summary: aiSummary,
    };
  },
);
