/**
 * tests/emulator/conversation-append.test.ts
 *
 * Regression test for R5-047: `saveConversation` used to overwrite the stored
 * `messages` array with the caller's ~20-message sliding prompt window on every
 * turn, so any conversation longer than the window was permanently truncated —
 * reopening it tomorrow showed only the tail.
 *
 * The fix makes the update path APPEND only the new turn (transactional
 * read-modify-write, deduped by a stable per-message `id`). This drives the
 * REAL `saveConversation` / `loadConversation` against the Firestore emulator.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { uniq } from './_emulator';
import {
  saveConversation,
  loadConversation,
  type ConversationMessage,
} from '../../functions/src/ai-memory';

const FIRM_ID = 'firm-convo-append';
const USER_ID = 'user-1';

// A turn = the two messages a chat turn actually produces (user + assistant),
// exactly what chat-ai.ts now passes to saveConversation.
const turn = (n: number): ConversationMessage[] => [
  { role: 'user', content: `question ${n}`, timestamp: new Date(2026, 0, 1, 0, n).toISOString() },
  { role: 'assistant', content: `answer ${n}`, timestamp: new Date(2026, 0, 1, 0, n, 30).toISOString() },
];

describe('saveConversation — append-only history (R5-047)', () => {
  let convId: string;

  beforeEach(async () => {
    // First turn creates the conversation.
    convId = await saveConversation(FIRM_ID, USER_ID, undefined, turn(1), 'chat', uniq('client'));
  });

  it('keeps ALL messages across many turns (no truncation to the window)', async () => {
    // 20 more turns = 42 messages total, well past any ~20-message window.
    for (let n = 2; n <= 21; n++) {
      await saveConversation(FIRM_ID, USER_ID, convId, turn(n), 'chat');
    }

    const conv = await loadConversation(FIRM_ID, convId);
    expect(conv).not.toBeNull();
    expect(conv!.messages).toHaveLength(42);
    expect(conv!.messageCount).toBe(42);
    // The very first turn — the one the pre-fix window would have dropped —
    // is still there, still first.
    expect(conv!.messages[0].content).toBe('question 1');
    expect(conv!.messages[1].content).toBe('answer 1');
    expect(conv!.messages[41].content).toBe('answer 21');
    // lastMessage tracks the newest turn.
    expect(conv!.lastMessage).toBe('answer 21');
  });

  it('sets a stable id on every stored message', async () => {
    await saveConversation(FIRM_ID, USER_ID, convId, turn(2), 'chat');
    const conv = await loadConversation(FIRM_ID, convId);
    const ids = conv!.messages.map((m) => m.id);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length); // all unique
  });

  it('does not double-append when the same turn (same ids) is saved twice', async () => {
    const t = turn(2).map((m, i) => ({ ...m, id: `fixed-${i}` }));
    await saveConversation(FIRM_ID, USER_ID, convId, t, 'chat');
    await saveConversation(FIRM_ID, USER_ID, convId, t, 'chat'); // retry

    const conv = await loadConversation(FIRM_ID, convId);
    // turn 1 (2) + turn 2 (2) — the retry adds nothing.
    expect(conv!.messages).toHaveLength(4);
    expect(conv!.messages.filter((m) => m.id === 'fixed-0')).toHaveLength(1);
  });

  it('preserves history stored WITHOUT ids (pre-fix conversations)', async () => {
    // Simulate a legacy doc: overwrite messages with id-less entries, then
    // append a new turn the way the fixed code does.
    const { admin } = await import('./_emulator');
    await admin.firestore().doc(`firms/${FIRM_ID}/aiConversations/${convId}`).update({
      messages: [
        { role: 'user', content: 'legacy q', timestamp: '2025-01-01T00:00:00.000Z' },
        { role: 'assistant', content: 'legacy a', timestamp: '2025-01-01T00:00:30.000Z' },
      ],
    });

    await saveConversation(FIRM_ID, USER_ID, convId, turn(9), 'chat');

    const conv = await loadConversation(FIRM_ID, convId);
    expect(conv!.messages).toHaveLength(4);
    expect(conv!.messages[0].content).toBe('legacy q');
    expect(conv!.messages[3].content).toBe('answer 9');
  });
});
