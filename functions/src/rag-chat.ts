/**
 * functions/src/rag-chat.ts
 *
 * RAG chat — PageIndex document retrieval → Claude streaming.
 *
 * Flow (research mode):
 *   1. Verify Firebase ID token (staff-only)
 *   2. Load PageIndex doc IDs from Firestore pageindex_docs/{ns}/files
 *   3. Submit PageIndex retrievals in parallel for all docs
 *   4. Poll until all complete or timeout
 *   5. Emit citations SSE event
 *   6. Stream Claude response
 *
 * Flow (draft mode):
 *   1–2. Skip Firestore; use sourceDocId directly
 *   3–4. PageIndex retrieval on single doc
 *   5–6. Draft-optimised system prompt → Claude stream
 */

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const PAGEINDEX_API_KEY = defineSecret('PAGEINDEX_API_KEY');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MODEL          = 'claude-sonnet-4-6';
const MAX_TOKENS     = 4096;
const POLL_INTERVAL  = 1500;   // ms between poll cycles
const POLL_TIMEOUT   = 90_000; // ms before giving up on a retrieval
const TOP_CITATIONS  = 5;
const CONTEXT_CHUNKS = 8;
const MAX_QUERY_LEN  = 5_000;

const RESEARCH_NAMESPACES = ['reference', 'work-product'] as const;

const RESEARCH_SYSTEM =
  'You are an estate planning legal research assistant for Adam Elias, a New Jersey attorney. ' +
  'Use only the provided source documents to answer questions. ' +
  'If the answer is not in the sources, say so clearly. ' +
  'Always flag if an answer requires independent legal verification. ' +
  'Never fabricate citations.';

const DRAFT_SYSTEM =
  'You are a legal drafting assistant for Adam Elias, a New Jersey estate planning attorney. ' +
  'You are given excerpts from a prior work-product document as a style reference. ' +
  'Draft the requested document following the same structure, tone, and formatting as the reference. ' +
  'Produce complete, professional legal text ready for attorney review. ' +
  'Never fabricate facts or legal citations.';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface Citation {
  namespace: string;
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

interface DocSpec { docId: string; namespace: string; fileName: string }
interface RetrievalResult { namespace: string; fileName: string; nodes: PageIndexNode[] }

async function runRetrievals(docs: DocSpec[], query: string, apiKey: string): Promise<RetrievalResult[]> {
  // Submit all in parallel
  const submissions = await Promise.allSettled(
    docs.map(async (d) => ({ ...d, retrievalId: await submitRetrieval(d.docId, query, apiKey) })),
  );

  const active: Array<DocSpec & { retrievalId: string }> = [];
  for (const s of submissions) {
    if (s.status === 'fulfilled') active.push(s.value);
    else console.warn('[ragChat] submit failed:', s.reason);
  }
  if (active.length === 0) return [];

  // Poll all in parallel until complete or timeout
  const deadline = Date.now() + POLL_TIMEOUT;
  const settled = new Map<string, PageIndexNode[]>();

  while (active.some((a) => !settled.has(a.retrievalId)) && Date.now() < deadline) {
    await sleep(POLL_INTERVAL);
    const pending = active.filter((a) => !settled.has(a.retrievalId));
    const polls = await Promise.allSettled(
      pending.map(async (a) => ({ ...a, data: await pollRetrieval(a.retrievalId, apiKey) })),
    );
    for (const p of polls) {
      if (p.status === 'rejected') { console.warn('[ragChat] poll failed:', p.reason); continue; }
      const { retrievalId, data } = p.value;
      if (data.status === 'completed') settled.set(retrievalId, data.nodes ?? []);
      else if (data.status === 'failed') settled.set(retrievalId, []);
    }
  }

  return active
    .filter((a) => settled.has(a.retrievalId))
    .map((a) => ({ namespace: a.namespace, fileName: a.fileName, nodes: settled.get(a.retrievalId)! }));
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------
export const ragChat = onRequest(
  {
    region: 'us-east1',
    secrets: [ANTHROPIC_API_KEY, PAGEINDEX_API_KEY],
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

    try {
      // ── Resolve documents to query ────────────────────────────────────────
      let docs: DocSpec[];

      const db = admin.firestore();

      if (mode === 'draft') {
        // Validate sourceDocId belongs to the caller's firm before using it
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

      // ── PageIndex retrieval ───────────────────────────────────────────────
      const results = await runRetrievals(docs, query, pageIndexKey);

      // Flatten nodes, keeping top content per node
      const allNodes: Array<{
        namespace: string;
        fileName: string;
        node: PageIndexNode;
        top: { page_index: number; relevant_content: string };
      }> = [];

      for (const r of results) {
        for (const node of r.nodes) {
          const top = node.relevant_contents[0];
          if (top) allNodes.push({ namespace: r.namespace, fileName: r.fileName, node, top });
        }
      }

      // ── Citations ─────────────────────────────────────────────────────────
      const citations: Citation[] = allNodes.slice(0, TOP_CITATIONS).map(({ namespace, fileName, node, top }) => ({
        namespace,
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
        .map(({ namespace, fileName, node, top }, i) =>
          `[Source ${i + 1}] namespace="${namespace}" file="${fileName}" section="${node.title}" page=${top.page_index}\n${top.relevant_content}`,
        )
        .join('\n\n---\n\n');

      let systemPrompt: string;
      let userMessage: string;

      if (mode === 'draft') {
        systemPrompt = DRAFT_SYSTEM;
        userMessage =
          `<style_reference>\n${contextBlocks}\n</style_reference>\n\n` +
          `<instructions>${instructions ?? query}</instructions>`;
      } else {
        systemPrompt = RESEARCH_SYSTEM;
        userMessage =
          `<sources>\n${contextBlocks}\n</sources>\n\n` +
          `<question>${query}</question>`;
      }

      // ── Stream Claude ─────────────────────────────────────────────────────
      const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          sse(res, { type: 'chunk', text: event.delta.text });
        }
      }

      sse(res, { type: 'done' });
    } catch (err) {
      console.error('[ragChat] error:', err);
      sse(res, { type: 'error', message: 'An error occurred while processing your request.' });
    } finally {
      res.end();
    }
  },
);
