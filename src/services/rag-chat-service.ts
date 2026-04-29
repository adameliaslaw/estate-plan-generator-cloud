/**
 * src/services/rag-chat-service.ts
 *
 * Thin client for the ragChat Cloud Function.
 * Handles Firebase Auth token retrieval and SSE stream parsing.
 */

import { getAuth } from 'firebase/auth';

// ---------------------------------------------------------------------------
// Types (mirror the function's Citation interface)
// ---------------------------------------------------------------------------
export interface Citation {
  namespace: string;
  documentName: string;
  excerpt: string;
  score: number;
}

export interface RagStreamCallbacks {
  onCitations: (citations: Citation[]) => void;
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Function URL — dev uses the Functions emulator, prod uses the deployed URL
// ---------------------------------------------------------------------------
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID as string;
const REGION = 'us-east1';

const FUNCTION_URL =
  import.meta.env.DEV &&
  (import.meta.env.VITE_USE_EMULATORS === 'true' ||
    import.meta.env.VITE_USE_EMULATORS === true)
    ? `http://localhost:5001/${PROJECT_ID}/${REGION}/ragChat`
    : `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/ragChat`;

// ---------------------------------------------------------------------------
// streamRagChat
// ---------------------------------------------------------------------------
export async function streamRagChat(
  query: string,
  callbacks: RagStreamCallbacks,
): Promise<void> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const idToken = await user.getIdToken();

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) {
    throw new Error(`ragChat HTTP ${response.status}: ${await response.text()}`);
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

    // SSE frames are separated by double newlines.
    // We split on \n\n and keep any partial frame in the buffer.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      // Each frame may contain multiple lines; the data line starts with "data: ".
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
