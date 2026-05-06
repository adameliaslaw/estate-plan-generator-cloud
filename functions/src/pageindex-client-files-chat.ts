/**
 * functions/src/pageindex-client-files-chat.ts
 *
 * RPC 1.6 — privileged endpoint for the client-files namespace only.
 *
 * Attorney-client privilege requires that client-file context is NEVER
 * mixed with reference or work-product results. This separate Cloud Function
 * guarantees isolation: it queries ONLY pageindex_docs/client-files/files,
 * issues its own Claude call with a privilege-specific system prompt, and
 * the response objects are structurally separate from ragChat's responses.
 */

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import Anthropic from '@anthropic-ai/sdk';
import { callAI, type FirmData } from './ai-client';

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const PAGEINDEX_API_KEY = defineSecret('PAGEINDEX_API_KEY');
const OPENAI_API_KEY    = defineSecret('OPENAI_API_KEY');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MODEL          = 'claude-sonnet-4-6';
const MAX_TOKENS     = 4096;
const POLL_INTERVAL  = 1500;
const POLL_TIMEOUT   = 90_000;
const TOP_CITATIONS  = 5;
const CONTEXT_CHUNKS = 8;
const MAX_QUERY_LEN  = 5_000;

const SYSTEM_PROMPT =
  'You are a confidential legal assistant for Adam Elias, a New Jersey estate planning attorney. ' +
  'You are working with attorney-client privileged client files. ' +
  'Use only the provided client documents to answer questions. ' +
  'Never reference or mix in information from any other source. ' +
  'If the answer is not clearly stated in the client documents, say so. ' +
  'Never fabricate facts about a client.';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ClientFilesCitation {
  namespace: 'client-files';
  documentName: string;
  section: string;
  pageNumber: number;
  excerpt: string;
  nodeId: string;
}

interface PageIndexNode {
  title: string;
  node_id: string;
  relevant_contents: Array<{ page_index: number; relevant_content: string }>;
}

interface PageIndexResponse {
  retrieval_id: string;
  status: 'pending' | 'completed' | 'failed';
  nodes?: PageIndexNode[];
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function submitRetrieval(docId: string, query: string, apiKey: string): Promise<string> {
  const r = await fetch('https://api.pageindex.ai/retrieval/', {
    method: 'POST',
    headers: { api_key: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc_id: docId, query }),
  });
  if (!r.ok) throw new Error(`PageIndex submit ${r.status}: ${await r.text()}`);
  return ((await r.json()) as PageIndexResponse).retrieval_id;
}

async function pollRetrieval(retrievalId: string, apiKey: string): Promise<PageIndexResponse> {
  const r = await fetch(`https://api.pageindex.ai/retrieval/${retrievalId}/`, {
    headers: { api_key: apiKey },
  });
  if (!r.ok) throw new Error(`PageIndex poll ${r.status}: ${await r.text()}`);
  return (await r.json()) as PageIndexResponse;
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------
export const pageIndexClientFilesChat = onRequest(
  {
    region: 'us-east1',
    secrets: [ANTHROPIC_API_KEY, PAGEINDEX_API_KEY, OPENAI_API_KEY],
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
      // ── Load client-files docs from Firestore ─────────────────────────────
      const db = admin.firestore();
      const snap = await db.collection('pageindex_docs/client-files/files')
        .where('firmId', '==', callerFirmId)
        .get();
      const docs = snap.docs.map((d) => {
        const entry = d.data() as FirestoreDocEntry;
        return { docId: entry.doc_id, fileName: entry.fileName };
      });

      if (docs.length === 0) {
        sse(res, { type: 'citations', data: [] });
        sse(res, { type: 'chunk', text: 'No client documents have been indexed yet.' });
        sse(res, { type: 'done' });
        res.end();
        return;
      }

      // ── Submit retrievals in parallel ─────────────────────────────────────
      const submissions = await Promise.allSettled(
        docs.map(async (d) => ({ ...d, retrievalId: await submitRetrieval(d.docId, query, pageIndexKey) })),
      );

      const active: Array<{ docId: string; fileName: string; retrievalId: string }> = [];
      for (const s of submissions) {
        if (s.status === 'fulfilled') active.push(s.value);
        else console.warn('[clientFilesChat] submit failed:', s.reason);
      }

      // ── Poll until complete ───────────────────────────────────────────────
      const deadline = Date.now() + POLL_TIMEOUT;
      const settled = new Map<string, PageIndexNode[]>();

      while (active.some((a) => !settled.has(a.retrievalId)) && Date.now() < deadline) {
        await sleep(POLL_INTERVAL);
        const pending = active.filter((a) => !settled.has(a.retrievalId));
        const polls = await Promise.allSettled(
          pending.map(async (a) => ({ ...a, data: await pollRetrieval(a.retrievalId, pageIndexKey) })),
        );
        for (const p of polls) {
          if (p.status === 'rejected') { console.warn('[clientFilesChat] poll failed:', p.reason); continue; }
          const { retrievalId, data } = p.value;
          if (data.status === 'completed') settled.set(retrievalId, data.nodes ?? []);
          else if (data.status === 'failed') settled.set(retrievalId, []);
        }
      }

      // ── Flatten nodes ─────────────────────────────────────────────────────
      const allNodes: Array<{
        fileName: string;
        node: PageIndexNode;
        top: { page_index: number; relevant_content: string };
      }> = [];

      for (const a of active) {
        for (const node of (settled.get(a.retrievalId) ?? [])) {
          const top = node.relevant_contents[0];
          if (top) allNodes.push({ fileName: a.fileName, node, top });
        }
      }

      // ── Citations ─────────────────────────────────────────────────────────
      const citations: ClientFilesCitation[] = allNodes.slice(0, TOP_CITATIONS).map(({ fileName, node, top }) => ({
        namespace: 'client-files',
        documentName: fileName,
        section: node.title,
        pageNumber: top.page_index,
        excerpt: top.relevant_content.slice(0, 400),
        nodeId: node.node_id,
      }));
      sse(res, { type: 'citations', data: citations });

      // ── Build Claude prompt ───────────────────────────────────────────────
      const contextBlocks = allNodes
        .slice(0, CONTEXT_CHUNKS)
        .map(({ fileName, node, top }, i) =>
          `[Client Doc ${i + 1}] file="${fileName}" section="${node.title}" page=${top.page_index}\n${top.relevant_content}`,
        )
        .join('\n\n---\n\n');

      const userMessage =
        `<client_documents>\n${contextBlocks}\n</client_documents>\n\n` +
        `<question>${query}</question>`;

      // ── Stream Claude (with non-streaming OpenAI fallback) ────────────────
      let chunksEmitted = 0;
      try {
        const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
        const stream = anthropic.messages.stream({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
        });

        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            sse(res, { type: 'chunk', text: event.delta.text });
            chunksEmitted++;
          }
        }

        sse(res, { type: 'done' });
      } catch (streamErr) {
        if (chunksEmitted > 0) {
          throw streamErr;
        }
        const errMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);
        console.warn(
          `[clientFilesChat-degradation] Anthropic stream failed pre-chunk; falling back to OpenAI. ` +
          `firmId=${callerFirmId} err=${errMsg.slice(0, 200)}`,
        );
        const firmSnap = await db.collection('firms').doc(callerFirmId).get();
        const firmData: FirmData = {
          ...((firmSnap.data() ?? {}) as FirmData),
        };
        firmData.openAiApiKey =
          firmData.openAiApiKey ?? firmData.settings?.openAiApiKey ?? OPENAI_API_KEY.value();

        const fallbackText = await callAI(SYSTEM_PROMPT, userMessage, firmData, {
          model: 'gpt-5.4',
          maxTokens: MAX_TOKENS,
        });
        sse(res, { type: 'chunk', text: fallbackText });
        sse(res, { type: 'done' });
        console.info(
          `[clientFilesChat-degradation] OpenAI fallback succeeded firmId=${callerFirmId} ` +
          `chars=${fallbackText.length}`,
        );
      }
    } catch (err) {
      console.error('[clientFilesChat] error:', err);
      sse(res, { type: 'error', message: 'An error occurred while processing your request.' });
    } finally {
      res.end();
    }
  },
);
