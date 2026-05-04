/**
 * functions/src/pageindex-retrieval.ts
 *
 * Shared PageIndex retrieval helper — used by both rag-chat.ts and chat-ai.ts.
 * Submits queries for a set of documents in parallel, polls until complete,
 * and returns a formatted context string ready to inject into a prompt.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface PageIndexNode {
  title: string;
  node_id: string;
  relevant_contents: Array<{ page_index: number; relevant_content: string }>;
}

interface PageIndexResponse {
  retrieval_id: string;
  status: 'pending' | 'completed' | 'failed';
  nodes?: PageIndexNode[];
}

export interface PageIndexSource {
  namespace: string;
  documentName: string;
  section: string;
  pageNumber: number;
  excerpt: string;
  nodeId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const POLL_INTERVAL = 1500;
const POLL_TIMEOUT  = 90_000;

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
// Public API
// ---------------------------------------------------------------------------

interface DocSpec {
  docId: string;
  namespace: string;
  fileName: string;
}

interface RetrievalResult {
  namespace: string;
  fileName: string;
  nodes: PageIndexNode[];
}

export async function runPageIndexRetrievals(
  docs: DocSpec[],
  query: string,
  apiKey: string,
): Promise<RetrievalResult[]> {
  if (docs.length === 0) return [];

  const submissions = await Promise.allSettled(
    docs.map(async (d) => ({ ...d, retrievalId: await submitRetrieval(d.docId, query, apiKey) })),
  );

  const active: Array<DocSpec & { retrievalId: string }> = [];
  for (const s of submissions) {
    if (s.status === 'fulfilled') active.push(s.value);
    else console.warn('[pageindex] submit failed:', s.reason);
  }
  if (active.length === 0) return [];

  const deadline = Date.now() + POLL_TIMEOUT;
  const settled = new Map<string, PageIndexNode[]>();

  while (active.some((a) => !settled.has(a.retrievalId)) && Date.now() < deadline) {
    await sleep(POLL_INTERVAL);
    const pending = active.filter((a) => !settled.has(a.retrievalId));
    const polls = await Promise.allSettled(
      pending.map(async (a) => ({ ...a, data: await pollRetrieval(a.retrievalId, apiKey) })),
    );
    for (const p of polls) {
      if (p.status === 'rejected') { console.warn('[pageindex] poll failed:', p.reason); continue; }
      const { retrievalId, data } = p.value;
      if (data.status === 'completed') settled.set(retrievalId, data.nodes ?? []);
      else if (data.status === 'failed') settled.set(retrievalId, []);
    }
  }

  return active
    .filter((a) => settled.has(a.retrievalId))
    .map((a) => ({ namespace: a.namespace, fileName: a.fileName, nodes: settled.get(a.retrievalId)! }));
}

/**
 * Load docs from Firestore, run PageIndex retrievals, and return a formatted
 * context string + structured source list for use in prompts / citation panels.
 */
export async function fetchPageIndexContext(
  namespaces: string[],
  query: string,
  apiKey: string,
  db: FirebaseFirestore.Firestore,
  maxChunks = 8,
): Promise<{ contextString: string; sources: PageIndexSource[] }> {
  if (!apiKey) return { contextString: '', sources: [] };

  // Load doc IDs for each namespace in parallel
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
  const docs = namespaceDocs.flat();
  if (docs.length === 0) return { contextString: '', sources: [] };

  const results = await runPageIndexRetrievals(docs, query, apiKey);

  // Flatten all nodes
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

  if (allNodes.length === 0) return { contextString: '', sources: [] };

  const contextString = allNodes
    .slice(0, maxChunks)
    .map(({ namespace, fileName, node, top }, i) =>
      `[Firm Doc ${i + 1}] namespace="${namespace}" file="${fileName}" section="${node.title}" page=${top.page_index}\n${top.relevant_content}`,
    )
    .join('\n\n---\n\n');

  const sources: PageIndexSource[] = allNodes.slice(0, 5).map(({ namespace, fileName, node, top }) => ({
    namespace,
    documentName: fileName,
    section: node.title,
    pageNumber: top.page_index,
    excerpt: top.relevant_content.slice(0, 300),
    nodeId: node.node_id,
  }));

  return { contextString, sources };
}
