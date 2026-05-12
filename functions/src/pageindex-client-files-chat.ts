/**
 * functions/src/pageindex-client-files-chat.ts
 *
 * RPC 1.6 — privileged endpoint for the client-files namespace only.
 *
 * Attorney-client privilege requires that client-file context is NEVER
 * mixed with reference or work-product results. This separate Cloud Function
 * guarantees isolation: it queries ONLY pageindex_docs/client-files/files
 * (firmId-scoped), uses a privilege-specific instruction prefix, and the
 * response objects are structurally separate from ragChat's responses.
 *
 * Migrated 2026-05-13 from the deprecated PageIndex retrieval API to
 * PageIndex chat-completion. The LLM call lives inside PageIndex now,
 * so the prior Anthropic/OpenAI fallback chain is removed — a PageIndex
 * chat failure surfaces as an SSE error event (a document-less answer
 * would defeat the purpose of attorney-client-privileged client-doc chat).
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

const INSTRUCTIONS =
  'You are a confidential legal assistant for Adam Elias, a New Jersey estate planning attorney. ' +
  'You are working with attorney-client privileged client files. ' +
  'Use only the provided client documents to answer questions. ' +
  'Never reference or mix in information from any other source. ' +
  'If the answer is not clearly stated in the client documents, say so. ' +
  'Never fabricate facts about a client.';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ClientFilesCitation extends PageIndexSource {
  namespace: 'client-files';
}

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
export const pageIndexClientFilesChat = onRequest(
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
    const { query } = req.body as { query?: string };
    if (!query?.trim()) {
      res.status(400).json({ error: '`query` is required' });
      return;
    }
    if (query.length > MAX_QUERY_LEN) {
      res.status(400).json({ error: `\`query\` must be ${MAX_QUERY_LEN} characters or fewer` });
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

    try {
      // ── Load client-files docs (firmId-scoped) ────────────────────────────
      const db = admin.firestore();
      const snap = await db.collection('pageindex_docs/client-files/files')
        .where('firmId', '==', callerFirmId)
        .get();
      const docs: DocSpec[] = snap.docs.map((d) => {
        const entry = d.data() as FirestoreDocEntry;
        return { docId: entry.doc_id, namespace: 'client-files', fileName: entry.fileName };
      });

      if (docs.length === 0) {
        sse(res, { type: 'citations', data: [] });
        sse(res, { type: 'chunk', text: 'No client documents have been indexed yet.' });
        sse(res, { type: 'done' });
        res.end();
        return;
      }

      // ── Build user message ────────────────────────────────────────────────
      const userMessage = `${INSTRUCTIONS}\n\n<question>${query}</question>`;

      // ── Stream PageIndex chat ─────────────────────────────────────────────
      const collected: ClientFilesCitation[] = [];
      try {
        for await (const event of streamPageIndexChat(
          docs,
          userMessage,
          pageIndexKey,
          (citation) => collected.push({ ...citation, namespace: 'client-files' }),
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
          `[clientFilesChat] PageIndex chat failed firmId=${callerFirmId} ` +
          `err=${errMsg.slice(0, 300)}`,
        );
        sse(res, {
          type: 'error',
          message: 'Client file search is temporarily unavailable. Please try again in a moment.',
        });
      }
    } catch (err) {
      console.error('[clientFilesChat] error:', err);
      sse(res, { type: 'error', message: 'An error occurred while processing your request.' });
    } finally {
      res.end();
    }
  },
);
