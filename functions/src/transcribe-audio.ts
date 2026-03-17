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
 *    and generates a concise legal-assistant summary using GPT-5.4.
 *
 * Firestore path:  firms/{firmId}/clients/{clientId}/notes/{noteId}
 * Storage path:    Provided by the caller as `storagePath` (e.g.
 *                  "firms/abc/clients/xyz/notes/note123.m4a")
 */

import * as functions from 'firebase-functions';
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
export const transcribeAudio = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '512MB',
  })
  .region('us-east1')
  .https.onCall(async (data, context) => {
    // ------------------------------------------------------------------
    // 1. Auth check
    // ------------------------------------------------------------------
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to transcribe audio.');
    }

    const { firmId, clientId, noteId, storagePath } = data as TranscribeAudioRequest;

    if (!firmId || !clientId || !noteId || !storagePath) {
      throw new functions.https.HttpsError(
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
      throw new functions.https.HttpsError('not-found', `Note ${noteId} not found.`);
    }

    // ------------------------------------------------------------------
    // 3. Mark note as processing
    // ------------------------------------------------------------------
    await ref.update({
      transcriptionStatus: 'processing',
      transcriptionStartedAt: now,
      updatedAt: now,
      updatedBy: context.auth.uid,
    });

    // ------------------------------------------------------------------
    // 3b. Fetch Firm Settings for API Key Overrides
    // ------------------------------------------------------------------
    const firmSnap = await db.collection('firms').doc(firmId).get();
    const firmData = firmSnap.data() || {};
    const customApiKey = firmData.openAiApiKey ?? firmData.settings?.openAiApiKey;

    // Transcription provider toggle — 'openai' (default) or 'assemblyai'
    const transcriptionProvider: string =
      firmData.transcriptionProvider ??
      firmData.settings?.transcriptionProvider ??
      'openai';

    try {
      // ----------------------------------------------------------------
      // 4. Download audio from Cloud Storage into a Buffer
      // ----------------------------------------------------------------
      const bucket = admin.storage().bucket(); // default bucket
      const file = bucket.file(storagePath);

      const [fileExists] = await file.exists();
      if (!fileExists) {
        throw new functions.https.HttpsError('not-found', `Audio file not found at path: ${storagePath}`);
      }

      console.log(`[transcribeAudio] Downloading audio from gs://${bucket.name}/${storagePath}`);
      const [audioBuffer] = await file.download();

      console.log(`[transcribeAudio] Audio downloaded — ${audioBuffer.length} bytes`);

      let transcriptionText: string;
      let enhancedData: Record<string, unknown> = {};

      if (transcriptionProvider === 'assemblyai') {
        // ----------------------------------------------------------------
        // 5a. AssemblyAI enhanced transcription
        // ----------------------------------------------------------------
        const { transcribeWithAssemblyAI, formatSpeakerTranscript } = await import('./assemblyai-transcribe');
        const assemblyaiKey =
          firmData.assemblyaiApiKey ??
          firmData.settings?.assemblyaiApiKey ??
          process.env.ASSEMBLYAI_API_KEY;

        if (!assemblyaiKey) {
          throw new functions.https.HttpsError(
            'internal',
            'AssemblyAI API Key is missing. Configure it in Firm Settings or set ASSEMBLYAI_API_KEY.',
          );
        }

        console.log(`[transcribeAudio] Using AssemblyAI for transcription`);
        const result = await transcribeWithAssemblyAI(audioBuffer, assemblyaiKey, {
          speakerDiarization: true,
          entityExtraction: true,
          autoSummary: true,
        });

        // Use speaker-labeled transcript if available, otherwise plain text
        transcriptionText = result.utterances.length > 0
          ? formatSpeakerTranscript(result.utterances)
          : result.text;

        enhancedData = {
          transcriptionSummary: result.summary,
          extractedEntities: result.entities,
          speakerCount: result.speakerCount,
          audioDuration: result.audioDuration,
          transcriptionConfidence: result.confidence,
          transcriptionProvider: 'assemblyai',
          assemblyaiTranscriptId: result.transcriptId,
        };

      } else {
        // ----------------------------------------------------------------
        // 5b. OpenAI Whisper (default)
        // ----------------------------------------------------------------
        const apiKey = customApiKey || process.env.OPENAI_API_KEY;
        if (!apiKey) {
          throw new functions.https.HttpsError(
            'internal',
            'OpenAI API Key is missing. Configure it in Firm Settings or environment variables.',
          );
        }
        const openai = new OpenAI({ apiKey });
        const filename = storagePath.split('/').pop() ?? 'audio.mp3';
        const mimeType = mimeTypeFromPath(storagePath);

        const audioFile = await toFile(audioBuffer, filename, { type: mimeType });

        const promptText = "This is a legal meeting or dictation for an estate planning attorney regarding a client's will, trust, beneficiaries, assets, taxes, probate, and health care directives. Please use proper punctuation, capitalization, and paragraph breaks. Accuracy is extremely important.";

        console.log(`[transcribeAudio] Sending to Whisper — model=whisper-1 mime=${mimeType}`);
        const transcriptionResponse = await openai.audio.transcriptions.create({
          model: 'whisper-1',
          file: audioFile,
          response_format: 'text',
          prompt: promptText,
        });

        transcriptionText = transcriptionResponse as unknown as string;
        enhancedData = { transcriptionProvider: 'openai' };
      }

      console.log(
        `[transcribeAudio] Transcription complete (${transcriptionProvider}) — ${transcriptionText.length} chars`,
      );

      // ----------------------------------------------------------------
      // 6. Save transcription to Firestore
      // ----------------------------------------------------------------
      await ref.update({
        transcription: transcriptionText,
        transcriptionStatus: 'completed',
        transcriptionCompletedAt: now,
        updatedAt: now,
        updatedBy: context.auth.uid,
        ...enhancedData,
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
        updatedBy: context.auth.uid,
      }).catch((updateErr) => {
        // Don't mask the original error if the status update itself fails
        console.error('[transcribeAudio] Failed to write error status:', updateErr);
      });

      // Re-throw as HttpsError so the client gets a clean error code
      if (error instanceof functions.https.HttpsError) throw error;
      throw new functions.https.HttpsError(
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
 * Reads a completed transcription from a Note document and calls GPT-5.4 to
 * produce a concise legal-assistant summary highlighting key decisions, action
 * items, and client concerns.
 *
 * Input:  { firmId, clientId, noteId }
 * Output: { success: true, summary: string }
 */
export const summarizeTranscription = functions
  .runWith({
    timeoutSeconds: 120,
    memory: '256MB',
  })
  .region('us-east1')
  .https.onCall(async (data, context) => {
    // ------------------------------------------------------------------
    // 1. Auth check
    // ------------------------------------------------------------------
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to summarize transcriptions.');
    }

    const { firmId, clientId, noteId } = data as SummarizeTranscriptionRequest;

    if (!firmId || !clientId || !noteId) {
      throw new functions.https.HttpsError('invalid-argument', 'firmId, clientId, and noteId are required.');
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
      throw new functions.https.HttpsError('not-found', `Note ${noteId} not found.`);
    }

    const noteData = noteSnap.data()!;
    const transcription = noteData.transcription as string | undefined;

    if (!transcription || transcription.trim().length === 0) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'No transcription found on this note. Run transcribeAudio first.',
      );
    }

    if (noteData.transcriptionStatus !== 'completed') {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Transcription is not yet complete (status: ${noteData.transcriptionStatus ?? 'unknown'}).`,
      );
    }

    // ------------------------------------------------------------------
    // 3. Generate AI summary via GPT-5.4
    // ------------------------------------------------------------------
    const firmSnap = await db.collection('firms').doc(firmId).get();
    const firmData = firmSnap.data() || {};

    const systemPrompt =
      'You are a legal assistant. Summarize the following transcription of a client ' +
      'meeting/call for an estate planning attorney. Be concise, highlight key decisions, ' +
      'action items, and client concerns. Do not include any legal advice.';

    const userPrompt =
      `Please summarize the following transcription:\n\n---\n${transcription.slice(0, 30000)}\n---`;

    console.log(`[summarizeTranscription] Calling GPT-5.4 — transcription length=${transcription.length}`);

    let aiSummary: string;
    try {
      aiSummary = await callAI(systemPrompt, userPrompt, firmData, {
        model: 'gpt-5.4',
        temperature: 0.2,
        maxTokens: 1024,
      });
    } catch (error) {
      console.error('[summarizeTranscription] GPT-5.4 error:', error);
      throw new functions.https.HttpsError(
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
      updatedBy: context.auth.uid,
    });

    console.log(`[summarizeTranscription] Saved summary to noteId=${noteId}`);

    return {
      success: true,
      noteId,
      summary: aiSummary,
    };
  },
  );
