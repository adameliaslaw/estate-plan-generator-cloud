/**
 * src/services/rag-chat-service.ts
 *
 * Thin clients for the RAG Cloud Functions.
 * Handles Firebase Auth token retrieval and SSE stream parsing.
 */

import { getAuth } from 'firebase/auth';

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

export interface RagStreamCallbacks {
  onCitations: (citations: Citation[]) => void;
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Function URLs
// ---------------------------------------------------------------------------
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID as string;
const REGION = 'us-east1';

function functionUrl(name: string): string {
  if (
    import.meta.env.DEV &&
    (import.meta.env.VITE_USE_EMULATORS === 'true' || import.meta.env.VITE_USE_EMULATORS === true)
  ) {
    return `http://localhost:5001/${PROJECT_ID}/${REGION}/${name}`;
  }
  return `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${name}`;
}

const RAG_CHAT_URL          = functionUrl('ragChat');
const CLIENT_FILES_CHAT_URL = functionUrl('pageIndexClientFilesChat');

// ---------------------------------------------------------------------------
// SSE stream helper
// ---------------------------------------------------------------------------
async function streamSse(
  url: string,
  body: Record<string, unknown>,
  callbacks: RagStreamCallbacks,
): Promise<void> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const idToken = await user.getIdToken(true);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  if (!response.body) {
    throw new Error('Response body is null — streaming not supported');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const json = line.slice(6).trim();
        if (!json) continue;
        try {
          const event = JSON.parse(json) as {
            type: 'citations' | 'chunk' | 'done' | 'error';
            data?: Citation[];
            text?: string;
            message?: string;
          };
          if (event.type === 'citations' && event.data) {
            callbacks.onCitations(event.data);
          } else if (event.type === 'chunk' && event.text != null) {
            callbacks.onChunk(event.text);
          } else if (event.type === 'done') {
            callbacks.onDone();
          } else if (event.type === 'error' && event.message) {
            callbacks.onError(event.message);
          }
        } catch {
          // Silently skip malformed frames
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Research chat — queries reference + work-product namespaces. */
export async function streamRagChat(query: string, callbacks: RagStreamCallbacks): Promise<void> {
  return streamSse(RAG_CHAT_URL, { query }, callbacks);
}

/** Client-files chat — queries client-files namespace only (RPC 1.6 isolated). */
export async function streamClientFilesChat(query: string, callbacks: RagStreamCallbacks): Promise<void> {
  return streamSse(CLIENT_FILES_CHAT_URL, { query }, callbacks);
}

/** Draft generation — queries a single work-product doc as style reference. */
export async function streamDraftChat(
  sourceDocId: string,
  instructions: string,
  callbacks: RagStreamCallbacks,
): Promise<void> {
  return streamSse(RAG_CHAT_URL, {
    query: instructions,
    mode: 'draft',
    sourceDocId,
    instructions,
  }, callbacks);
}
