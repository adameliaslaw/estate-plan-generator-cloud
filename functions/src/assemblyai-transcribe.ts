/**
 * functions/src/assemblyai-transcribe.ts
 *
 * AssemblyAI enhanced transcription integration.
 *
 * Provides superior transcription features compared to Whisper:
 *   - Speaker diarization (who said what)
 *   - Entity extraction (names, dates, addresses, dollar amounts)
 *   - PII redaction (SSN, DOB, financial info)
 *   - Auto-generated summaries
 *   - Improved accuracy for legal/domain-specific content
 *
 * The entity extraction results map to questionnaire field paths,
 * enabling auto-fill of client data from dictated notes.
 */

import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TranscribeOptions {
  /** Enable speaker diarization */
  speakerDiarization?: boolean;
  /** Expected number of speakers (improves accuracy if known) */
  expectedSpeakers?: number;
  /** Enable entity extraction */
  entityExtraction?: boolean;
  /** Enable PII redaction */
  piiRedaction?: boolean;
  /** Policy for PII: 'hash' replaces with hash, 'redact' replaces with ###  */
  piiRedactionPolicy?: 'hash' | 'redact';
  /** Enable auto-generated summary */
  autoSummary?: boolean;
  /** Summary type */
  summaryType?: 'informative' | 'conversational' | 'catchy';
}

export interface SpeakerUtterance {
  speaker: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
}

export interface ExtractedEntity {
  /** The entity type (person_name, date, address, money_amount, etc.) */
  entityType: string;
  /** The entity text as found in the transcript */
  text: string;
  /** Start character offset */
  start: number;
  /** End character offset */
  end: number;
  /** Suggested questionnaire field path for auto-fill */
  fieldMapping?: string;
}

export interface EnhancedTranscript {
  /** Full transcript text */
  text: string;
  /** Speaker-labeled utterances (if diarization enabled) */
  utterances: SpeakerUtterance[];
  /** Extracted entities (if entity extraction enabled) */
  entities: ExtractedEntity[];
  /** Auto-generated summary (if enabled) */
  summary: string;
  /** PII-redacted version of the transcript (if redaction enabled) */
  redactedText: string;
  /** Number of distinct speakers detected */
  speakerCount: number;
  /** Confidence score (0-1) */
  confidence: number;
  /** Audio duration in seconds */
  audioDuration: number;
  /** AssemblyAI transcript ID for reference */
  transcriptId: string;
}

// ---------------------------------------------------------------------------
// AssemblyAI API client
// ---------------------------------------------------------------------------

const ASSEMBLYAI_BASE_URL = 'https://api.assemblyai.com/v2';

interface AssemblyAITranscriptResult {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  text?: string;
  utterances?: Array<{
    speaker: string;
    text: string;
    start: number;
    end: number;
    confidence: number;
  }>;
  entities?: Array<{
    entity_type: string;
    text: string;
    start: number;
    end: number;
  }>;
  summary?: string;
  confidence?: number;
  audio_duration?: number;
  error?: string;
}

async function _getAssemblyAIKey(firmId: string): Promise<string> {
  const db = admin.firestore();
  const firmSnap = await db.doc(`firms/${firmId}`).get();
  const firmData = firmSnap.data();

  const apiKey =
    firmData?.assemblyaiApiKey ??
    firmData?.settings?.assemblyaiApiKey ??
    process.env.ASSEMBLYAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'AssemblyAI API key not configured. Set it in firm settings or as ASSEMBLYAI_API_KEY environment variable.'
    );
  }

  return apiKey as string;
}

async function assemblyAIRequest(
  endpoint: string,
  method: 'GET' | 'POST',
  apiKey: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${ASSEMBLYAI_BASE_URL}${endpoint}`, {
    method,
    headers: {
      'authorization': apiKey,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`AssemblyAI API error ${response.status}: ${errorText}`);
  }

  return response.json() as Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Upload audio to AssemblyAI
// ---------------------------------------------------------------------------

async function uploadAudioToAssemblyAI(
  audioBuffer: Buffer,
  apiKey: string,
): Promise<string> {
  const response = await fetch(`${ASSEMBLYAI_BASE_URL}/upload`, {
    method: 'POST',
    headers: {
      'authorization': apiKey,
      'content-type': 'application/octet-stream',
    },
    body: audioBuffer,
  });

  if (!response.ok) {
    throw new Error(`AssemblyAI upload failed: ${response.status}`);
  }

  const data = await response.json() as { upload_url: string };
  return data.upload_url;
}

// ---------------------------------------------------------------------------
// Core transcription function
// ---------------------------------------------------------------------------

export async function transcribeWithAssemblyAI(
  audioBuffer: Buffer,
  apiKey: string,
  options: TranscribeOptions = {},
): Promise<EnhancedTranscript> {
  // 1. Upload audio to AssemblyAI
  console.log(`[AssemblyAI] Uploading audio (${audioBuffer.length} bytes)...`);
  const audioUrl = await uploadAudioToAssemblyAI(audioBuffer, apiKey);
  console.log(`[AssemblyAI] Upload complete: ${audioUrl}`);

  // 2. Create transcription request
  const transcriptRequest: Record<string, unknown> = {
    audio_url: audioUrl,
    language_detection: true,
  };

  // Speaker diarization
  if (options.speakerDiarization !== false) {
    transcriptRequest.speaker_labels = true;
    if (options.expectedSpeakers) {
      transcriptRequest.speakers_expected = options.expectedSpeakers;
    }
  }

  // Entity extraction
  if (options.entityExtraction !== false) {
    transcriptRequest.entity_detection = true;
  }

  // PII redaction
  if (options.piiRedaction) {
    transcriptRequest.redact_pii = true;
    transcriptRequest.redact_pii_policies = [
      'person_name', 'date_of_birth', 'us_social_security_number',
      'credit_card_number', 'banking_information', 'phone_number',
      'email_address',
    ];
    transcriptRequest.redact_pii_sub = options.piiRedactionPolicy ?? 'hash';
  }

  // NOTE: AssemblyAI deprecated summarization, summary_model, summary_type.
  // Summaries should be generated post-transcription via callAI() or
  // the existing summarizeTranscription Cloud Function.

  console.log('[AssemblyAI] Creating transcription request...');
  const createResult = await assemblyAIRequest(
    '/transcript',
    'POST',
    apiKey,
    transcriptRequest,
  );

  const transcriptId = createResult.id as string;
  console.log(`[AssemblyAI] Transcript queued: ${transcriptId}`);

  // 3. Poll for completion
  let result: AssemblyAITranscriptResult;
  const maxWaitMs = 4 * 60 * 1000; // 4 min — leave buffer before Cloud Function's 5 min timeout
  const pollIntervalMs = 3000;
  const startTime = Date.now();

  while (true) {
    if (Date.now() - startTime > maxWaitMs) {
      throw new Error(`AssemblyAI transcription timed out after ${maxWaitMs / 1000}s`);
    }

    await new Promise(r => setTimeout(r, pollIntervalMs));

    result = await assemblyAIRequest(
      `/transcript/${transcriptId}`,
      'GET',
      apiKey,
    ) as unknown as AssemblyAITranscriptResult;

    if (result.status === 'completed') {
      console.log(`[AssemblyAI] Transcription complete: ${transcriptId}`);
      break;
    }
    if (result.status === 'error') {
      throw new Error(`AssemblyAI transcription failed: ${result.error}`);
    }

    console.log(`[AssemblyAI] Status: ${result.status} — polling...`);
  }

  // 4. Extract entities with field mappings
  const entities: ExtractedEntity[] = (result.entities ?? []).map((e) => ({
    entityType: e.entity_type,
    text: e.text,
    start: e.start,
    end: e.end,
    fieldMapping: mapEntityToField(e.entity_type, e.text),
  }));

  // 5. Build enhanced transcript
  return {
    text: result.text ?? '',
    utterances: (result.utterances ?? []).map((u) => ({
      speaker: u.speaker,
      text: u.text,
      start: u.start,
      end: u.end,
      confidence: u.confidence,
    })),
    entities,
    summary: result.summary ?? '',
    redactedText: options.piiRedaction ? (result.text ?? '') : '',
    speakerCount: new Set((result.utterances ?? []).map(u => u.speaker)).size,
    confidence: result.confidence ?? 0,
    audioDuration: result.audio_duration ?? 0,
    transcriptId,
  };
}

// ---------------------------------------------------------------------------
// Entity-to-field mapping
// ---------------------------------------------------------------------------

/**
 * Maps an AssemblyAI entity type to a questionnaire field path.
 * This enables auto-fill of client data from dictated notes.
 */
function mapEntityToField(entityType: string, _text: string): string | undefined {
  const mappings: Record<string, string> = {
    'person_name': 'personalInfo.firstName', // Will need disambiguation
    'date_of_birth': 'personalInfo.dateOfBirth',
    'phone_number': 'personalInfo.phone',
    'email_address': 'personalInfo.email',
    'location': 'personalInfo.address',
    'money_amount': 'assets.estimatedTotalEstate',
    'us_social_security_number': 'personalInfo.ssn',
    'date': 'personalInfo.dateOfBirth', // Generic date — needs context
    'nationality': 'personalInfo.citizenship',
    'occupation': 'personalInfo.occupation',
    'organization': 'personalInfo.employer',
  };

  return mappings[entityType];
}

// ---------------------------------------------------------------------------
// Formatter: Speaker-labeled transcript
// ---------------------------------------------------------------------------

/**
 * Format utterances into a human-readable speaker-labeled transcript.
 * Example:
 *   Speaker A: I'd like to set up a revocable trust for my estate...
 *   Speaker B: Absolutely, let's start with your personal details...
 */
export function formatSpeakerTranscript(utterances: SpeakerUtterance[]): string {
  return utterances
    .map(u => `Speaker ${u.speaker}: ${u.text}`)
    .join('\n\n');
}
