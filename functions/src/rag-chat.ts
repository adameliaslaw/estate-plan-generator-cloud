/**
 * functions/src/rag-chat.ts
 *
 * RAG chat — PageIndex chat-completion → SSE stream.
 *
 * Migrated 2026-05-13 from the deprecated PageIndex retrieval API.
 * PageIndex chat-completion performs retrieval AND synthesis in one call,
 * so the prior Anthropic-Claude / OpenAI fallback chain is gone — the
 * LLM step now lives inside PageIndex. If PageIndex chat fails, we
 * surface an SSE error event (no document-less fallback: an unreferenced
 * legal answer is worse than no answer).
 */

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { streamPageIndexChat, type DocSpec, type PageIndexSource } from './pageindex-retrieval';

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------
const PAGEINDEX_API_KEY = defineSecret('PAGEINDEX_API_KEY');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_QUERY_LEN = 5_000;

const RESEARCH_NAMESPACES = ['reference', 'work-product'] as const;

const RESEARCH_INSTRUCTIONS =
  'You are an estate planning legal research assistant for Adam Elias, a New Jersey attorney. ' +
  'Use only the provided source documents to answer questions. ' +
  'If the answer is not in the sources, say so clearly. ' +
  'Always flag if an answer requires independent legal verification. ' +
  'Never fabricate citations.';

const DRAFT_INSTRUCTIONS =
  'You are a legal drafting assistant for Adam Elias, a New Jersey estate planning attorney. ' +
  'You are given excerpts from a prior work-product document as a style reference. ' +
  'Draft the requested document following the same structure, tone, and formatting as the reference. ' +
  'Produce complete, professional legal text ready for attorney review. ' +
  'Never fabricate facts or legal citations.';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type Citation = PageIndexSource;

interface FirestoreDocEntry {
  doc_id: string;
  fileName: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sse(res: { write: (chunk: string) => void }, payload: object): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------
export const ragChat = onRequest(
  {
    region: 'us-east1',
    secrets: [PAGEINDEX_API_KEY],
    timeoutSeconds: 300,
    memory: '512MiB',
    cors: true,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // ── Auth ────────────────────────────────────────────────────────────────
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
    const callerRole = decoded['role'] as string | undefined;
    if (!callerRole || !new Set(['admin', 'attorney', 'paralegal']).has(callerRole)) {
      res.status(403).json({ error: 'Forbidden: staff access only' });
      return;
    }
    const callerFirmId = decoded['firmId'] as string | undefined;
    if (!callerFirmId) {
      res.status(403).json({ error: 'Forbidden: no firm association found' });
      return;
    }

    // ── Input validation ────────────────────────────────────────────────────
    const { query, mode = 'research', sourceDocId, instructions } = req.body as {
      query?: string;
      mode?: 'research' | 'draft';
      sourceDocId?: string;
      instructions?: string;
    };

    if (!query?.trim()) {
      res.status(400).json({ error: '`query` is required' });
      return;
    }
    if (query.length > MAX_QUERY_LEN) {
      res.status(400).json({ error: `\`query\` must be ${MAX_QUERY_LEN} characters or fewer` });
      return;
    }
    if (mode === 'draft' && !sourceDocId?.trim()) {
      res.status(400).json({ error: '`sourceDocId` is required in draft mode' });
      return;
    }

    // ── SSE headers ─────────────────────────────────────────────────────────
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.flushHeaders();

    const pageIndexKey = PAGEINDEX_API_KEY.value();
    const db = admin.firestore();

    try {
      // ── Resolve documents to query ────────────────────────────────────────
      let docs: DocSpec[];

      if (mode === 'draft') {
        const docSnap = await db.collection('pageindex_docs/work-product/files')
          .where('doc_id', '==', sourceDocId!)
          .where('firmId', '==', callerFirmId)
          .limit(1)
          .get();
        if (docSnap.empty) {
          sse(res, { type: 'error', message: 'Source document not found or access denied' });
          res.end();
          return;
        }
        const entry = docSnap.docs[0].data() as FirestoreDocEntry;
        docs = [{ docId: entry.doc_id, namespace: 'work-product', fileName: entry.fileName }];
      } else {
        const namespaceDocs = await Promise.all(
          RESEARCH_NAMESPACES.map(async (ns) => {
            const snap = await db.collection(`pageindex_docs/${ns}/files`)
              .where('firmId', '==', callerFirmId)
              .get();
            return snap.docs.map((d) => {
              const entry = d.data() as FirestoreDocEntry;
              return { docId: entry.doc_id, namespace: ns, fileName: entry.fileName };
            });
          }),
        );
        docs = namespaceDocs.flat();
      }

      if (docs.length === 0) {
        sse(res, { type: 'citations', data: [] });
        sse(res, {
          type: 'chunk',
          text: 'No documents have been indexed yet. Upload documents via the Upload Document button.',
        });
        sse(res, { type: 'done' });
        res.end();
        return;
      }

      // ── Build user message (instructions + query) ─────────────────────────
      // PageIndex chat-completion API does not accept a `system` role; the
      // persona/rules live in the user message.
      const instructionsBlock = mode === 'draft' ? DRAFT_INSTRUCTIONS : RESEARCH_INSTRUCTIONS;
      const taskBlock = mode === 'draft'
        ? `<instructions>${instructions ?? query}</instructions>`
        : `<question>${query}</question>`;
      const userMessage = `${instructionsBlock}\n\n${taskBlock}`;

      // ── Stream PageIndex chat ─────────────────────────────────────────────
      const collected: Citation[] = [];
      try {
        for await (const event of streamPageIndexChat(
          docs,
          userMessage,
          pageIndexKey,
          (citation) => collected.push(citation),
        )) {
          if (event.type === 'chunk' && event.text != null) {
            sse(res, { type: 'chunk', text: event.text });
          }
        }
        sse(res, { type: 'citations', data: collected });
        sse(res, { type: 'done' });
      } catch (chatErr) {
        const errMsg = chatErr instanceof Error ? chatErr.message : String(chatErr);
        console.error(
          `[ragChat] PageIndex chat failed firmId=${callerFirmId} mode=${mode} ` +
          `err=${errMsg.slice(0, 300)}`,
        );
        sse(res, {
          type: 'error',
          message: 'Document search is temporarily unavailable. Please try again in a moment.',
        });
      }
    } catch (err) {
      console.error('[ragChat] error:', err);
      sse(res, { type: 'error', message: 'An error occurred while processing your request.' });
    } finally {
      res.end();
    }
  },
);
