/**
 * tests/unit/file-transcript-to-matter.test.ts
 *
 * Regression test for R5-038: filing a pending transcript built the note body
 * only from `transcript.segments`. A transcript that carried `transcriptText`
 * but no segments filed an EMPTY note marked 'completed'. The fix falls back to
 * the flat transcriptText and refuses to file when there is no content at all.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  transcript: {} as Record<string, unknown>,
  noteWrite: null as Record<string, unknown> | null,
  committed: false,
}));

vi.mock('../../functions/node_modules/firebase-functions/lib/esm/v2/providers/https.mjs', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
  },
}));
vi.mock('../../functions/node_modules/firebase-functions/lib/v2/providers/https.js', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {
    code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
  },
}));
vi.mock('../../functions/src/auth-guards', () => ({
  assertStaff: () => ({ uid: 'staff-1', firmId: 'firm-1' }),
}));
vi.mock('../../functions/node_modules/firebase-admin', () => {
  type MockRef = {
    id: string | undefined;
    path: string;
    get: () => Promise<{ exists: boolean; data?: () => Record<string, unknown> }>;
    collection: (name: string) => MockColl;
  };
  type MockColl = { doc: (id?: string) => MockRef };
  const makeRef = (path: string): MockRef => ({
    id: path.split('/').pop(),
    path,
    get: async () => {
      if (path.includes('/pendingTranscripts/')) return { exists: true, data: () => state.transcript };
      if (path.includes('/clients/')) return { exists: true, data: () => ({}) };
      return { exists: false };
    },
    collection: (name: string) => makeColl(`${path}/${name}`),
  });
  const makeColl = (path: string): MockColl => ({ doc: (id?: string) => makeRef(`${path}/${id ?? 'note-auto'}`) });
  const batch = () => ({
    set: (ref: MockRef, data: Record<string, unknown>) => {
      if (String(ref.path).includes('/notes/')) state.noteWrite = data;
    },
    update: vi.fn(),
    commit: async () => { state.committed = true; },
  });
  const firestore = Object.assign(
    () => ({ collection: (name: string) => makeColl(name), batch }),
    { FieldValue: { serverTimestamp: () => 'ts' }, DocumentData: {} },
  );
  return { firestore, initializeApp: vi.fn() };
});

import { fileTranscriptToMatter } from '../../functions/src/file-transcript-to-matter';

const handler = fileTranscriptToMatter as unknown as (r: unknown) => Promise<{ success: boolean }>;
const REQ = {
  auth: { uid: 'staff-1', token: { role: 'attorney', firmId: 'firm-1' } },
  data: { transcriptId: 't1', matterId: 'm1' },
};

describe('fileTranscriptToMatter — content honesty (R5-038)', () => {
  beforeEach(() => {
    state.transcript = {};
    state.noteWrite = null;
    state.committed = false;
  });

  it('files transcriptText as the note body when segments are missing', async () => {
    state.transcript = { status: 'pending', segments: [], transcriptText: '  Client wants a revocable trust.  ' };
    const res = await handler(REQ);

    expect(res.success).toBe(true);
    expect(state.committed).toBe(true);
    expect(state.noteWrite?.transcription).toBe('Client wants a revocable trust.');
    expect(state.noteWrite?.transcriptionStatus).toBe('completed');
  });

  it('prefers speaker-attributed segments when present', async () => {
    state.transcript = { status: 'pending', segments: [{ speaker: 'A', text: 'Hello' }], transcriptText: 'ignored' };
    await handler(REQ);
    expect(state.noteWrite?.transcription).toBe('Speaker A: Hello');
  });

  it('refuses to file (and writes nothing) when there is no content at all', async () => {
    state.transcript = { status: 'pending', segments: [], transcriptText: '   ' };
    await expect(handler(REQ)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(state.committed).toBe(false);
    expect(state.noteWrite).toBeNull();
  });
});
