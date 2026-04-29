/**
 * functions/src/rag-chat.ts
 *
 * RAG chat endpoint — Voyage AI embeddings → Pinecone retrieval → Claude streaming.
 *
 * Flow:
 *   1. Verify Firebase ID token
 *   2. Embed the query with voyage-law-2
 *   3. Query Pinecone across three namespaces in parallel (reference, work-product, client-files)
 *   4. Send citation metadata as the first SSE event
 *   5. Stream Claude's response chunk-by-chunk as subsequent SSE events
 */

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import Anthropic from '@anthropic-ai/sdk';
import { Pinecone } from '@pinecone-database/pinecone';

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------
const ANTHROPIC_API_KEY  = defineSecret('ANTHROPIC_API_KEY');
const PINECONE_API_KEY   = defineSecret('PINECONE_API_KEY');
const PINECONE_INDEX_NAME = defineSecret('PINECONE_INDEX_NAME');
const VOYAGE_API_KEY     = defineSecret('VOYAGE_API_KEY');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;
const NAMESPACES = ['reference', 'work-product', 'client-files'] as const;
const TOP_K_PER_NAMESPACE = 3; // 9 candidates total → keep top 5 for citations
const CONTEXT_CHUNKS = 8;      // send top 8 chunks as context to Claude

const SYSTEM_PROMPT =
  'You are an estate planning legal research assistant for Adam Elias, a New Jersey attorney. ' +
  'Use only the provided source documents to answer questions. ' +
  'If the answer is not in the sources, say so clearly. ' +
  'Always flag if an answer requires independent legal verification. ' +
  'Never fabricate citations.';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface Citation {
  namespace: string;
  documentName: string;
  excerpt: string;
  score: number;
}

interface VoyageEmbedResponse {
  data: Array<{ embedding: number[] }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a single SSE frame to the response. */
function sse(res: { write: (chunk: string) => void }, payload: object): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Call Voyage AI REST API directly — avoids an extra SDK dependency.
 * input_type: 'query' optimises the embedding for retrieval use.
 */
async function embedQuery(query: string, apiKey: string): Promise<number[]> {
  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'voyage-law-2',
      input: [query],
      input_type: 'query',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Voyage AI error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as VoyageEmbedResponse;
  return data.data[0].embedding;
}

/**
 * Pull a metadata field by trying multiple likely key names so the function
 * is resilient to whatever field names are used during ingestion.
 */
function meta(
  metadata: Record<string, unknown> | undefined,
  keys: string[],
  fallback = '',
): string {
  if (!metadata) return fallback;
  for (const key of keys) {
    const v = metadata[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------
export const ragChat = onRequest(
  {
    region: 'us-east1',
    secrets: [ANTHROPIC_API_KEY, PINECONE_API_KEY, PINECONE_INDEX_NAME, VOYAGE_API_KEY],
    timeoutSeconds: 120,
    memory: '512MiB',
    cors: true,
  },
  async (req, res) => {
    // ── Method guard ──────────────────────────────────────────────────────
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // ── Auth ──────────────────────────────────────────────────────────────
    const authHeader = req.headers.authorization ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Bearer token' });
      return;
    }
    let decoded: admin.auth.DecodedIdToken;
    try {
      decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    // Enforce staff-only access server-side — UI routing alone is insufficient
    // for an HTTP function that can be called directly with a valid ID token.
    const staffRoles = new Set(['admin', 'attorney', 'paralegal']);
    const callerRole = decoded['role'] as string | undefined;
    if (!callerRole || !staffRoles.has(callerRole)) {
      res.status(403).json({ error: 'Forbidden: staff access only' });
      return;
    }

    // ── Input validation ──────────────────────────────────────────────────
    const { query } = req.body as { query?: string };
    if (!query?.trim()) {
      res.status(400).json({ error: '`query` is required' });
      return;
    }

    // ── SSE headers ───────────────────────────────────────────────────────
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // cors: true on onRequest adds Access-Control-Allow-Origin automatically,
      // but we set it explicitly here for SSE streaming responses.
      'Access-Control-Allow-Origin': '*',
    });
    res.flushHeaders();

    try {
      // ── 1. Embed query ──────────────────────────────────────────────────
      const vector = await embedQuery(query, VOYAGE_API_KEY.value());

      // ── 2. Query Pinecone across all namespaces in parallel ─────────────
      const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY.value() });
      const index = pinecone.index(PINECONE_INDEX_NAME.value());

      const namespaceResults = await Promise.all(
        NAMESPACES.map(async (ns) => {
          const result = await index.namespace(ns).query({
            vector,
            topK: TOP_K_PER_NAMESPACE,
            includeMetadata: true,
          });
          return { namespace: ns, matches: result.matches };
        }),
      );

      // ── 3. Flatten + sort by score ──────────────────────────────────────
      const allMatches = namespaceResults
        .flatMap(({ namespace, matches }) =>
          matches.map((m) => ({ namespace, match: m })),
        )
        .sort((a, b) => (b.match.score ?? 0) - (a.match.score ?? 0));

      // ── 4. Build citations (top 5) ──────────────────────────────────────
      const citations: Citation[] = allMatches.slice(0, 5).map(({ namespace, match }) => ({
        namespace,
        documentName: meta(
          match.metadata as Record<string, unknown> | undefined,
          ['source', 'file_name', 'fileName', 'title', 'filename'],
          match.id,
        ),
        excerpt: meta(
          match.metadata as Record<string, unknown> | undefined,
          ['text', 'chunk', 'content', 'body', 'page_content'],
        ),
        score: Math.round((match.score ?? 0) * 1000) / 1000,
      }));

      // Send citations before the LLM response so the panel populates immediately.
      sse(res, { type: 'citations', data: citations });

      // ── 5. Build Claude prompt ──────────────────────────────────────────
      const contextBlocks = allMatches
        .slice(0, CONTEXT_CHUNKS)
        .map(({ namespace, match }, i) => {
          const text = meta(
            match.metadata as Record<string, unknown> | undefined,
            ['text', 'chunk', 'content', 'body', 'page_content'],
            '(no text)',
          );
          const source = meta(
            match.metadata as Record<string, unknown> | undefined,
            ['source', 'file_name', 'fileName', 'title', 'filename'],
            match.id,
          );
          return `[Source ${i + 1}] namespace="${namespace}" file="${source}"\n${text}`;
        })
        .join('\n\n---\n\n');

      const userMessage =
        `<sources>\n${contextBlocks}\n</sources>\n\n` +
        `<question>${query}</question>`;

      // ── 6. Stream Claude response ───────────────────────────────────────
      const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });

      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          sse(res, { type: 'chunk', text: event.delta.text });
        }
      }

      sse(res, { type: 'done' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error('[ragChat] error:', err);
      sse(res, { type: 'error', message });
    } finally {
      res.end();
    }
  },
);
