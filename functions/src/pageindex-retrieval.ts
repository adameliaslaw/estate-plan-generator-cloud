/**
 * functions/src/pageindex-retrieval.ts
 *
 * PageIndex chat-completion helpers.
 *
 * Migrated 2026-05-13: PageIndex deprecated the `/retrieval/` endpoints
 * (they now return empty `retrieved_nodes` with a deprecation notice).
 * Replacement is `POST /chat/completions`, which performs retrieval +
 * synthesis in one call and returns BOTH a structured `citations` array
 * AND inline `<doc=file;page=N>` markers in the assistant content.
 * We use the structured array for citation surfaces and strip the inline
 * markers from the visible text.
 *
 * Two exports:
 *   - streamPageIndexChat   — async generator (single-shot today; the
 *                              generator shape is kept so re-enabling
 *                              streaming later doesn't change callers).
 *                              Used by rag-chat and pageindex-client-files-chat.
 *   - fetchPageIndexContext — non-streaming wrapper returning a synthesized
 *                              context string + sources. Used by chat-ai.ts
 *                              to inject firm-doc context into Perplexity.
 *
 * Note on streaming: the chat API does support `stream: true`, but its SSE
 * format includes tool-use chunks (`block_metadata.type === 'tool_use'`)
 * intermixed with assistant content, which a naive OpenAI-shape SSE parser
 * misreads. Non-streaming gives us the assembled answer + citations in one
 * 14–30s round trip per query. Acceptable for the chat UI; revisit if
 * latency becomes a problem.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------
export interface PageIndexSource {
  namespace: string;
  documentName: string;
  section: string;     // not surfaced by chat-completion API — empty string
  pageNumber: number;
  excerpt: string;     // not surfaced by chat-completion API — empty string
  nodeId: string;      // not surfaced by chat-completion API — empty string
}

export interface DocSpec {
  docId: string;
  namespace: string;
  fileName: string;
}

export interface StreamChunk {
  type: 'chunk' | 'done';
  text?: string;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  citations?: Array<{ document?: string; page?: number }>;
}

// Inline citation marker shape per PageIndex docs: `<doc=file.pdf;page=1>`.
const INLINE_TAG_RE = /<doc=[^;>]+;page=\d+>/g;

// ---------------------------------------------------------------------------
// Internal request
// ---------------------------------------------------------------------------
async function callPageIndexChat(
  docs: DocSpec[],
  userMessage: string,
  apiKey: string,
): Promise<ChatResponse> {
  const response = await fetch('https://api.pageindex.ai/chat/completions', {
    method: 'POST',
    headers: { api_key: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      doc_id: docs.map((d) => d.docId),
      messages: [{ role: 'user', content: userMessage }],
      stream: false,
      enable_citations: true,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`PageIndex chat ${response.status}: ${errBody.slice(0, 500)}`);
  }
  return (await response.json()) as ChatResponse;
}

function extractContent(res: ChatResponse): string {
  const content = res.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}

function mapCitations(res: ChatResponse, docs: DocSpec[]): PageIndexSource[] {
  if (!Array.isArray(res.citations) || res.citations.length === 0) return [];

  const fileMap = new Map<string, DocSpec>();
  for (const d of docs) fileMap.set(d.fileName, d);

  const seen = new Set<string>();
  const out: PageIndexSource[] = [];
  for (const c of res.citations) {
    if (!c.document || typeof c.page !== 'number') continue;
    const key = `${c.document}::${c.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const spec = fileMap.get(c.document);
    if (!spec) continue;
    out.push({
      namespace: spec.namespace,
      documentName: spec.fileName,
      section: '',
      pageNumber: c.page,
      excerpt: '',
      nodeId: '',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Streaming chat (rag-chat, client-files chat)
// ---------------------------------------------------------------------------

/**
 * Run a PageIndex chat completion and yield the assistant response as
 * SSE-friendly chunks. Citations are reported via `onCitation` before any
 * chunk is yielded. Throws on PageIndex API failure — caller decides how to
 * surface errors to the client.
 *
 * Generator shape preserved for forward compatibility: when we re-enable
 * true streaming, callers won't have to change.
 */
export async function* streamPageIndexChat(
  docs: DocSpec[],
  userMessage: string,
  apiKey: string,
  onCitation: (citation: PageIndexSource) => void,
): AsyncGenerator<StreamChunk> {
  if (docs.length === 0) {
    yield { type: 'done' };
    return;
  }

  const res = await callPageIndexChat(docs, userMessage, apiKey);

  for (const c of mapCitations(res, docs)) onCitation(c);

  const content = extractContent(res);
  const cleanText = content.replace(INLINE_TAG_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  if (cleanText) yield { type: 'chunk', text: cleanText };
  yield { type: 'done' };
}

// ---------------------------------------------------------------------------
// Non-streaming wrapper (chat-ai.ts firm-docs context block)
// ---------------------------------------------------------------------------

/**
 * Load docs from Firestore for the given namespaces and ask PageIndex to
 * summarize material relevant to `query`. Returns a synthesized context
 * string the caller can drop into a downstream prompt, plus the structured
 * citation list.
 *
 * Caller-side note: pre-migration this returned raw retrieval chunks. With
 * the chat-completion API, the returned `contextString` is itself
 * LLM-synthesized text — fine for injection into Perplexity / Claude as
 * "what our firm docs say about X," but no longer raw excerpts.
 */
export async function fetchPageIndexContext(
  namespaces: string[],
  query: string,
  apiKey: string,
  db: FirebaseFirestore.Firestore,
  _maxChunks = 8,
): Promise<{ contextString: string; sources: PageIndexSource[] }> {
  if (!apiKey) return { contextString: '', sources: [] };

  const namespaceDocs = await Promise.all(
    namespaces.map(async (ns) => {
      try {
        const snap = await db.collection(`pageindex_docs/${ns}/files`).get();
        return snap.docs.map((d) => {
          const data = d.data() as { doc_id: string; fileName: string };
          return { docId: data.doc_id, namespace: ns, fileName: data.fileName };
        });
      } catch {
        return [];
      }
    }),
  );
  const docs: DocSpec[] = namespaceDocs.flat();
  if (docs.length === 0) return { contextString: '', sources: [] };

  const userMessage =
    `Summarize the relevant firm-document content for the question below. ` +
    `Quote or paraphrase the operative language. Cite each source inline. ` +
    `If the firm documents do not address the question, say so briefly.\n\n` +
    `Question: ${query}`;

  let res: ChatResponse;
  try {
    res = await callPageIndexChat(docs, userMessage, apiKey);
  } catch (err) {
    console.warn('[pageindex] fetchPageIndexContext failed:', err);
    return { contextString: '', sources: [] };
  }

  const content = extractContent(res);
  if (!content) return { contextString: '', sources: [] };

  const contextString = content.replace(INLINE_TAG_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  const sources = mapCitations(res, docs);
  return { contextString, sources };
}
