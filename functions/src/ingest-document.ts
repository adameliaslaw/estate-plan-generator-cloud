/**
 * functions/src/ingest-document.ts
 *
 * Callable Cloud Function — parses an uploaded PDF or DOCX, chunks the text,
 * embeds each chunk with Voyage AI voyage-law-2, and upserts the vectors to
 * Pinecone under the caller-selected namespace.
 *
 * Called from the browser upload modal in ChatPage.
 * Auth: staff only (admin | attorney | paralegal).
 */

import * as functions from 'firebase-functions/v1';
import { defineSecret } from 'firebase-functions/params';
// pdf-parse ships as CJS; cast via require to avoid default-export type mismatch.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buffer: Buffer) => Promise<{ text: string }>;
import * as mammoth from 'mammoth';
import { Pinecone } from '@pinecone-database/pinecone';

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------
const PINECONE_API_KEY    = defineSecret('PINECONE_API_KEY');
const PINECONE_INDEX_NAME = defineSecret('PINECONE_INDEX_NAME');
const VOYAGE_API_KEY      = defineSecret('VOYAGE_API_KEY');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CHUNK_SIZE    = 1500;
const CHUNK_OVERLAP = 150;
const EMBED_BATCH   = 32;
const UPSERT_BATCH  = 100;

const VALID_NAMESPACES = new Set(['reference', 'work-product', 'client-files']);
const STAFF_ROLES      = new Set(['admin', 'attorney', 'paralegal']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface IngestRequest {
  fileBase64: string;
  mimeType: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  fileName: string;
  namespace: string;
}

interface IngestResponse {
  chunksIngested: number;
  fileName: string;
}

interface VoyageEmbedResponse {
  data: Array<{ embedding: number[] }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function chunkText(text: string): string[] {
  const normalised = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const chunks: string[] = [];
  let start = 0;
  while (start < normalised.length) {
    const end = Math.min(start + CHUNK_SIZE, normalised.length);
    chunks.push(normalised.slice(start, end).trim());
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks.filter(c => c.length > 50);
}

async function embedBatch(texts: string[], apiKey: string): Promise<number[][]> {
  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'voyage-law-2', input: texts, input_type: 'document' }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Voyage AI ${response.status}: ${text}`);
  }
  const data = (await response.json()) as VoyageEmbedResponse;
  return data.data.map(d => d.embedding);
}

function safeId(filename: string, chunkIndex: number): string {
  return `${filename.replace(/[^a-zA-Z0-9-_]/g, '_')}-c${chunkIndex}`;
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------
export const ingestDocument = functions
  .runWith({ secrets: ['PINECONE_API_KEY', 'PINECONE_INDEX_NAME', 'VOYAGE_API_KEY'], timeoutSeconds: 300, memory: '1GB' })
  .https.onCall(async (data: IngestRequest, context) => {
    // ── Auth & role ─────────────────────────────────────────────────────────
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
    }
    const role = context.auth.token['role'] as string | undefined;
    if (!role || !STAFF_ROLES.has(role)) {
      throw new functions.https.HttpsError('permission-denied', 'Staff access only');
    }

    // ── Input validation ────────────────────────────────────────────────────
    const { fileBase64, mimeType, fileName, namespace } = data;

    if (!fileBase64 || !mimeType || !fileName || !namespace) {
      throw new functions.https.HttpsError('invalid-argument', 'fileBase64, mimeType, fileName, and namespace are required');
    }
    if (!VALID_NAMESPACES.has(namespace)) {
      throw new functions.https.HttpsError('invalid-argument', `namespace must be one of: ${[...VALID_NAMESPACES].join(', ')}`);
    }
    if (!['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(mimeType)) {
      throw new functions.https.HttpsError('invalid-argument', 'Only PDF and DOCX files are supported');
    }

    // ── Parse file ──────────────────────────────────────────────────────────
    const buffer = Buffer.from(fileBase64, 'base64');
    let text: string;

    try {
      if (mimeType === 'application/pdf') {
        const result = await pdfParse(buffer);
        text = result.text;
      } else {
        const result = await mammoth.extractRawText({ buffer });
        text = result.value;
      }
    } catch (err) {
      throw new functions.https.HttpsError(
        'internal',
        `Failed to parse file: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!text.trim()) {
      throw new functions.https.HttpsError('invalid-argument', 'No text could be extracted from this file');
    }

    // ── Chunk ───────────────────────────────────────────────────────────────
    const chunks = chunkText(text);
    if (chunks.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'Document produced no usable chunks');
    }

    // ── Embed ───────────────────────────────────────────────────────────────
    const voyageKey = VOYAGE_API_KEY.value();
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const embeddings = await embedBatch(batch, voyageKey);
      allEmbeddings.push(...embeddings);
    }

    // ── Upsert to Pinecone ──────────────────────────────────────────────────
    const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY.value() });
    const index = pinecone.index(PINECONE_INDEX_NAME.value());

    const vectors = chunks.map((chunk, i) => ({
      id: safeId(fileName, i),
      values: allEmbeddings[i],
      metadata: {
        text: chunk,
        source: fileName,
        namespace,
        chunkIndex: i,
        totalChunks: chunks.length,
      },
    }));

    for (let i = 0; i < vectors.length; i += UPSERT_BATCH) {
      await index.namespace(namespace).upsert({ records: vectors.slice(i, i + UPSERT_BATCH) });
    }

    return { chunksIngested: vectors.length, fileName } satisfies IngestResponse;
  });
