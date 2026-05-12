/**
 * functions/src/pageindex-retrieval.ts
 *
 * PageIndex chat-completion helpers.
 *
 * Migrated 2026-05-13: PageIndex deprecated the `/retrieval/` endpoints
 * (they now return empty `retrieved_nodes` with a deprecation notice).
 * Replacement is `POST /chat/completions`, which performs retrieval +
 * synthesis in one call and emits inline `<doc=file;page=N>` citation
 * markers. We strip those markers from the visible text and surface them
 * as structured citation objects via the same SSE event shape the
 * frontend already understands.
 *
 * Two exports:
 *   - streamPageIndexChat   — async generator for SSE handlers (rag-chat,
 *                              pageindex-client-files-chat). Yields text
 *                              chunks; citations come via onCitation cb.
 *   - fetchPageIndexContext — non-streaming wrapper that returns a
 *                              synthesized context string + sources, for
 *                              callers (chat-ai.ts) that inject firm-doc
 *                              context into a downstream prompt.
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

// ---------------------------------------------------------------------------
// Internal: citation tag parser
// ---------------------------------------------------------------------------
// Tag shape per PageIndex docs: `<doc=file.pdf;page=1>`.
const CITATION_TAG_RE = /<doc=([^;>]+);page=(\d+)>/g;

interface ExtractResult {
  cleanText: string;
  citations: Array<{ docName: string; page: number }>;
  remaining: string;
}

/**
 * Scan a streamed-text buffer for complete `<doc=...;page=N>` tags. Returns:
 *   - cleanText: text with complete tags removed, safe to emit downstream
 *   - citations: each complete tag found, in order
 *   - remaining: trailing fragment that might still be growing into a tag
 *                (caller must prepend on the next chunk)
 *
 * The split point is the position of the last unclosed `<` if such a `<` is
 * recent enough to plausibly be the start of a citation tag. This keeps us
 * from emitting half-tags into the user-visible stream.
 */
function extractCitations(text: string): ExtractResult {
  const lastOpen = text.lastIndexOf('<');
  const lastClose = text.lastIndexOf('>');

  // If there's an unclosed `<` after the last `>` and its tail length is
  // short enough to plausibly be a growing tag, hold from that point.
  let scanEnd = text.length;
  if (lastOpen > lastClose) {
    const tailLen = text.length - lastOpen;
    if (tailLen < 80) scanEnd = lastOpen;
  }

  const scannable = text.slice(0, scanEnd);
  const remaining = text.slice(scanEnd);

  const citations: Array<{ docName: string; page: number }> = [];
  const cleanText = scannable.replace(CITATION_TAG_RE, (_match, docName: string, pageStr: string) => {
    citations.push({ docName, page: parseInt(pageStr, 10) });
    return '';
  });

  return { cleanText, citations, remaining };
}

// ---------------------------------------------------------------------------
// Streaming chat (rag-chat, client-files chat)
// ---------------------------------------------------------------------------

/**
 * Stream a PageIndex chat completion. Yields text chunks with citation tags
 * already stripped; structured citations are delivered via `onCitation` as
 * they're parsed. Throws on PageIndex API failure — caller decides how to
 * surface errors over SSE.
 *
 * Sources are not isolated per-namespace by PageIndex — the caller must
 * pre-filter `docs` to the namespaces the calling endpoint is allowed to
 * access (e.g. client-files chat passes only client-files docs).
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

  const docMap = new Map<string, DocSpec>();
  for (const d of docs) docMap.set(d.fileName, d);

  const response = await fetch('https://api.pageindex.ai/chat/completions', {
    method: 'POST',
    headers: { api_key: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      doc_id: docs.map((d) => d.docId),
      messages: [{ role: 'user', content: userMessage }],
      stream: true,
      enable_citations: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`PageIndex chat ${response.status}: ${await response.text()}`);
  }
  if (!response.body) {
    throw new Error('PageIndex chat returned no response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const seen = new Set<string>();
  let sseBuffer = '';
  let textBuffer = '';

  const emitCitation = (docName: string, page: number): void => {
    const key = `${docName}::${page}`;
    if (seen.has(key)) return;
    seen.add(key);
    const spec = docMap.get(docName);
    if (!spec) return;
    onCitation({
      namespace: spec.namespace,
      documentName: spec.fileName,
      section: '',
      pageNumber: page,
      excerpt: '',
      nodeId: '',
    });
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });

    let blank: number;
    while ((blank = sseBuffer.indexOf('\n\n')) >= 0) {
      const rawEvent = sseBuffer.slice(0, blank);
      sseBuffer = sseBuffer.slice(blank + 2);

      for (const line of rawEvent.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;

        let json: unknown;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }

        const delta = extractDelta(json);
        if (!delta) continue;

        textBuffer += delta;
        const { cleanText, citations, remaining } = extractCitations(textBuffer);
        textBuffer = remaining;
        for (const c of citations) emitCitation(c.docName, c.page);
        if (cleanText) yield { type: 'chunk', text: cleanText };
      }
    }
  }

  // Flush any trailing buffer (no more chunks → no more tag growth possible)
  if (textBuffer) {
    const flushed = textBuffer.replace(CITATION_TAG_RE, (_m, docName: string, pageStr: string) => {
      emitCitation(docName, parseInt(pageStr, 10));
      return '';
    });
    if (flushed) yield { type: 'chunk', text: flushed };
  }

  yield { type: 'done' };
}

function extractDelta(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const choices = (json as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as { delta?: { content?: unknown }; message?: { content?: unknown } };
  const content = first.delta?.content ?? first.message?.content;
  return typeof content === 'string' ? content : null;
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

  const docMap = new Map<string, DocSpec>();
  for (const d of docs) docMap.set(d.fileName, d);

  const userMessage =
    `Summarize the relevant firm-document content for the question below. ` +
    `Quote or paraphrase the operative language. Cite each source inline. ` +
    `If the firm documents do not address the question, say so briefly.\n\n` +
    `Question: ${query}`;

  let response: Response;
  try {
    response = await fetch('https://api.pageindex.ai/chat/completions', {
      method: 'POST',
      headers: { api_key: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doc_id: docs.map((d) => d.docId),
        messages: [{ role: 'user', content: userMessage }],
        stream: false,
        enable_citations: true,
      }),
    });
  } catch (err) {
    console.warn('[pageindex] fetchPageIndexContext request failed:', err);
    return { contextString: '', sources: [] };
  }
  if (!response.ok) {
    console.warn(`[pageindex] fetchPageIndexContext ${response.status}: ${await response.text()}`);
    return { contextString: '', sources: [] };
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawContent = data.choices?.[0]?.message?.content ?? '';
  if (!rawContent) return { contextString: '', sources: [] };

  // Strip citation tags from the prose; collect them as structured sources.
  const sources: PageIndexSource[] = [];
  const seen = new Set<string>();
  const contextString = rawContent.replace(CITATION_TAG_RE, (_m, docName: string, pageStr: string) => {
    const page = parseInt(pageStr, 10);
    const key = `${docName}::${page}`;
    if (!seen.has(key)) {
      seen.add(key);
      const spec = docMap.get(docName);
      if (spec) {
        sources.push({
          namespace: spec.namespace,
          documentName: spec.fileName,
          section: '',
          pageNumber: page,
          excerpt: '',
          nodeId: '',
        });
      }
    }
    return '';
  });

  return { contextString: contextString.trim(), sources };
}
