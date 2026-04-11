/**
 * functions/src/ai-memory.ts
 *
 * Persistent memory system for the AI chatbot and document generation engine.
 *
 * Three memory layers:
 *  1. Conversation Memory — save/resume chat conversations
 *  2. Client Memory — per-client key facts, preferences, draft history
 *  3. Firm Memory — firm-wide drafting patterns and standing instructions
 */

import * as admin from 'firebase-admin';
import { callAI, sanitizeForPrompt } from './ai-client';
import { generateEmbedding } from './kb-embeddings';
import { getGeminiApiKey } from './kb-vector-search';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string; // ISO string
  isDraft?: boolean | null;
  draftTitle?: string | null;
}

export interface Conversation {
  id: string;
  firmId: string;
  clientId: string | null;
  userId: string;
  mode: 'chat' | 'draft' | 'research';
  draftDocType: string | null;
  title: string;
  lastMessage: string;
  messages: ConversationMessage[];
  messageCount: number;
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  updatedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
}

export interface ClientMemory {
  clientId: string;
  firmId: string;
  keyFacts: KeyFact[];
  preferences: Record<string, string>;
  draftHistory: DraftHistoryEntry[];
  lastTopics: string[];
  updatedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
}

export interface KeyFact {
  fact: string;
  category: 'preference' | 'family' | 'financial' | 'legal' | 'instruction';
  source: 'conversation' | 'document' | 'manual';
  confidence: 'high' | 'medium';
  extractedAt: string;
  conversationId?: string;
}

export interface DraftHistoryEntry {
  docType: string;
  title: string;
  generatedAt: string;
  customInstructions?: string;
  templateUsed?: string;
  generationMode?: string;
}

export interface FirmMemory {
  firmId: string;
  draftingPatterns: Record<string, string>;
  globalInstructions: string[];
  frequentTopics: string[];
  updatedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
}

// ---------------------------------------------------------------------------
// Layer 1: Conversation Memory
// ---------------------------------------------------------------------------

const db = () => admin.firestore();

/**
 * Save or update a conversation in Firestore.
 * Returns the conversation ID.
 */
export async function saveConversation(
  firmId: string,
  userId: string,
  conversationId: string | undefined,
  messages: ConversationMessage[],
  mode: 'chat' | 'draft' | 'research',
  clientId?: string,
  draftDocType?: string,
): Promise<string> {
  const col = db().collection(`firms/${firmId}/aiConversations`);

  // Auto-generate title from first user message
  const firstUserMsg = messages.find((m) => m.role === 'user');
  const title = firstUserMsg
    ? firstUserMsg.content.slice(0, 80) + (firstUserMsg.content.length > 80 ? '...' : '')
    : 'New Conversation';

  const lastMsg = messages[messages.length - 1];
  const lastMessage = lastMsg ? lastMsg.content.slice(0, 100) : '';

  const now = admin.firestore.FieldValue.serverTimestamp();

  if (conversationId) {
    // Update existing conversation
    const ref = col.doc(conversationId);
    await ref.update({
      messages,
      messageCount: messages.length,
      lastMessage,
      title,
      updatedAt: now,
    });
    return conversationId;
  } else {
    // Create new conversation
    const ref = col.doc();
    const data: Conversation = {
      id: ref.id,
      firmId,
      clientId: clientId ?? null,
      userId,
      mode,
      draftDocType: draftDocType ?? null,
      title,
      lastMessage,
      messages,
      messageCount: messages.length,
      createdAt: now,
      updatedAt: now,
    };
    await ref.set(data);
    return ref.id;
  }
}

/**
 * Load conversation history from Firestore.
 */
export async function loadConversation(
  firmId: string,
  conversationId: string,
): Promise<Conversation | null> {
  const snap = await db().doc(`firms/${firmId}/aiConversations/${conversationId}`).get();
  if (!snap.exists) return null;
  return snap.data() as Conversation;
}

/**
 * List recent conversations for a firm, optionally filtered by client.
 */
export async function listConversations(
  firmId: string,
  clientId?: string,
  limit: number = 20,
): Promise<Array<{ id: string; title: string; lastMessage: string; mode: string; messageCount: number; clientId?: string; updatedAt: string }>> {
  let query: admin.firestore.Query = db()
    .collection(`firms/${firmId}/aiConversations`)
    .orderBy('updatedAt', 'desc')
    .limit(limit);

  if (clientId) {
    query = query.where('clientId', '==', clientId);
  }

  const snap = await query.get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      title: data.title,
      lastMessage: data.lastMessage,
      mode: data.mode,
      messageCount: data.messageCount,
      clientId: data.clientId,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? '',
    };
  });
}

// ---------------------------------------------------------------------------
// Layer 2: Client Memory
// ---------------------------------------------------------------------------

/**
 * Get or create a client's memory document.
 */
export async function getClientMemory(
  firmId: string,
  clientId: string,
): Promise<ClientMemory> {
  const ref = db().doc(`firms/${firmId}/aiMemory/${clientId}`);
  const snap = await ref.get();

  if (snap.exists) {
    return snap.data() as ClientMemory;
  }

  // Create empty memory
  const memory: ClientMemory = {
    clientId,
    firmId,
    keyFacts: [],
    preferences: {},
    draftHistory: [],
    lastTopics: [],
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await ref.set(memory);
  return memory;
}

/**
 * Record a document generation in the client's draft history.
 */
export async function recordDraftHistory(
  firmId: string,
  clientId: string,
  entry: DraftHistoryEntry,
): Promise<void> {
  const ref = db().doc(`firms/${firmId}/aiMemory/${clientId}`);

  // Strip undefined fields up-front — Firestore rejects undefined values
  const sanitizedEntry = Object.fromEntries(
    Object.entries(entry).filter(([, v]) => v !== undefined),
  ) as DraftHistoryEntry;

  const snap = await ref.get();

  if (snap.exists) {
    // Append to draftHistory (keep last 50)
    const data = snap.data() as ClientMemory;
    const history = [...(data.draftHistory ?? []), sanitizedEntry].slice(-50);
    await ref.update({
      draftHistory: history,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } else {
    // Create with this entry
    const memory: ClientMemory = {
      clientId,
      firmId,
      keyFacts: [],
      preferences: {},
      draftHistory: [sanitizedEntry],
      lastTopics: [],
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    await ref.set(memory);
  }
}

/**
 * Extract key facts from a conversation using AI, then store them.
 * Fire-and-forget — call after responding to the user.
 */
export async function extractAndSaveKeyFacts(
  firmId: string,
  clientId: string,
  conversationId: string,
  messages: ConversationMessage[],
  firmData: Record<string, unknown>,
): Promise<void> {
  // Only process conversations with substantial content
  if (messages.length < 4) return;

  const conversationText = messages
    .map((m) => `${m.role.toUpperCase()}: ${sanitizeForPrompt(m.content).slice(0, 500)}`)
    .join('\n');

  const systemPrompt = `You are a legal memory assistant. Extract durable, important facts about the client from the following attorney-client conversation. Focus on:
- Client preferences (e.g., "wants to disinherit son", "prefers revocable trust")
- Family dynamics (e.g., "has a special needs child named X", "estranged from sibling")
- Financial facts (e.g., "owns rental property in Bergen County", "has $2M in retirement")
- Legal instructions (e.g., "wants separate trusts for minor children", "no-contest clause required")
- Standing instructions (e.g., "always include digital asset provisions")

Do NOT extract:
- General legal information or statutes discussed
- Routine pleasantries or small talk
- Facts already obvious from the questionnaire (name, address, etc.)

Respond with a JSON array of facts. Each fact should have:
- "fact": concise statement of the fact
- "category": one of "preference", "family", "financial", "legal", "instruction"
- "confidence": "high" or "medium"

If no meaningful facts to extract, return an empty array: []

Respond ONLY with the JSON array, no markdown fences or extra text.`;

  try {
    const raw = await callAI(systemPrompt, conversationText, firmData, {
      temperature: 0.1,
      maxTokens: 2000,
    });

    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const facts: Array<{ fact: string; category: string; confidence: string }> = JSON.parse(cleaned);

    if (!Array.isArray(facts) || facts.length === 0) return;

    const ref = db().doc(`firms/${firmId}/aiMemory/${clientId}`);
    const snap = await ref.get();
    const existing = snap.exists ? (snap.data() as ClientMemory) : null;

    const newFacts: KeyFact[] = facts.map((f) => ({
      fact: f.fact,
      category: f.category as KeyFact['category'],
      source: 'conversation' as const,
      confidence: f.confidence as KeyFact['confidence'],
      extractedAt: new Date().toISOString(),
      conversationId,
    }));

    // Deduplicate: don't add facts that are too similar to existing ones
    const existingFacts = existing?.keyFacts ?? [];
    const deduped = newFacts.filter((nf) => {
      const normalized = nf.fact.toLowerCase().trim();
      return !existingFacts.some(
        (ef) => ef.fact.toLowerCase().trim() === normalized,
      );
    });

    if (deduped.length === 0) return;

    // Keep last 100 key facts
    const allFacts = [...existingFacts, ...deduped].slice(-100);

    if (snap.exists) {
      await ref.update({
        keyFacts: allFacts,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      await ref.set({
        clientId,
        firmId,
        keyFacts: allFacts,
        preferences: {},
        draftHistory: [],
        lastTopics: [],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    console.log(`[ai-memory] Extracted ${deduped.length} key facts for client ${clientId}`);

    // Also create a note in the client's Notes subcollection
    // so key facts are visible in the Notes tab
    try {
      const noteContent = deduped
        .map((f) => `• [${f.category.toUpperCase()}] ${f.fact}`)
        .join('\n');

      const noteRef = db().collection(`firms/${firmId}/clients/${clientId}/notes`).doc();
      await noteRef.set({
        id: noteRef.id,
        title: `AI Conversation Insights — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
        content: noteContent,
        noteType: 'ai-memory',
        aiSummary: `${deduped.length} key fact${deduped.length === 1 ? '' : 's'} extracted from AI conversation.`,
        conversationId,
        source: 'chatbot',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`[ai-memory] Created note ${noteRef.id} for client ${clientId}`);
    } catch (noteErr) {
      console.warn('[ai-memory] Failed to create note from key facts:', noteErr);
    }

    // ── Embed key facts into chatInsights for cross-client semantic search ──
    try {
      const geminiApiKey = await getGeminiApiKey(firmId);
      const insightsCol = db().collection(`firms/${firmId}/chatInsights`);
      const batch = db().batch();
      let embeddedCount = 0;

      for (const fact of deduped) {
        try {
          const embeddingText = `[${fact.category}] ${fact.fact}`;
          const embedding = await generateEmbedding(embeddingText, geminiApiKey);
          const insightRef = insightsCol.doc();
          batch.set(insightRef, {
            fact: fact.fact,
            category: fact.category,
            confidence: fact.confidence,
            clientId,
            conversationId,
            firmId,
            embedding: admin.firestore.FieldValue.vector(embedding),
            isActive: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          embeddedCount++;
          // Rate limit: small delay between embedding calls
          await new Promise((r) => setTimeout(r, 200));
        } catch (embedErr) {
          console.warn(`[ai-memory] Failed to embed fact "${fact.fact.slice(0, 50)}...":`, embedErr);
        }
      }

      if (embeddedCount > 0) {
        await batch.commit();
        console.log(`[ai-memory] Embedded ${embeddedCount} chat insights for cross-client search`);
      }
    } catch (insightErr) {
      // Non-fatal — facts are still saved to aiMemory and notes
      console.warn('[ai-memory] Chat insight embedding failed:', insightErr);
    }
  } catch (err) {
    console.warn('[ai-memory] Key fact extraction failed:', err);
    // Non-critical — don't throw
  }
}

// ---------------------------------------------------------------------------
// Correction detection — auto-save attorney corrections to KB (Backlog #10)
// ---------------------------------------------------------------------------

/**
 * Detect legal corrections in chat and auto-save them as Knowledge Base
 * resources. Runs fire-and-forget alongside extractAndSaveKeyFacts().
 *
 * Triggers on patterns like:
 *  - "Actually, NJ changed this statute in 2024..."
 *  - "That's incorrect — the correct citation is..."
 *  - "Update: the fee schedule changed to..."
 *
 * Saved resources get auto-embedded by the onKnowledgeResourceWritten
 * trigger in kb-embeddings.ts — no extra embedding code needed here.
 */
export async function extractAndSaveCorrections(
  firmId: string,
  conversationId: string,
  messages: ConversationMessage[],
  firmData: Record<string, unknown>,
): Promise<void> {
  // Only process conversations with enough back-and-forth
  if (messages.length < 4) return;

  // Quick heuristic pre-filter: skip if no user messages contain correction signals
  const correctionSignals = /\b(actually|incorrect|wrong|outdated|changed|amended|updated|revised|no longer|used to be|correction|clarif(?:y|ication)|new (?:rule|law|statute|regulation)|as of \d{4})\b/i;
  const userMessages = messages.filter(m => m.role === 'user');
  const hasSignal = userMessages.some(m => correctionSignals.test(m.content));
  if (!hasSignal) return;

  const conversationText = messages
    .map((m) => `${m.role.toUpperCase()}: ${sanitizeForPrompt(m.content).slice(0, 500)}`)
    .join('\n');

  const systemPrompt = `You are a legal knowledge curator. Analyze the following attorney-client conversation and detect any LEGAL CORRECTIONS — instances where the attorney corrects a legal point, updates a statute citation, clarifies a legal rule, or provides updated legal information.

EXTRACT corrections like:
- Statute changes ("N.J.S.A. 3B:3-2 was amended in 2024 to...")
- Case law updates ("The Smith v. Jones ruling now requires...")
- Practice changes ("The recording fee in Bergen County changed to...")
- Rule clarifications ("Actually, the waiting period is 30 days, not 60")
- Regulatory updates ("The IRS changed the estate tax exemption to...")

Do NOT extract:
- General legal advice or opinions
- Client-specific instructions (those go to key facts)
- Routine case discussion
- Speculative or uncertain statements

Respond with a JSON array of corrections. Each correction should have:
- "title": concise title describing the correction (e.g., "NJ Changed Witness Requirements for Wills")
- "content": the full correction with context, statute citations, and effective date if mentioned
- "tags": relevant tags as an array of strings
- "docTypes": which document types this affects (e.g., ["will", "trust", "poa"])

If no legal corrections are found, return an empty array: []

Respond ONLY with the JSON array, no markdown fences or extra text.`;

  try {
    const raw = await callAI(systemPrompt, conversationText, firmData, {
      temperature: 0.1,
      maxTokens: 2000,
    });

    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const corrections: Array<{
      title: string;
      content: string;
      tags: string[];
      docTypes: string[];
    }> = JSON.parse(cleaned);

    if (!Array.isArray(corrections) || corrections.length === 0) return;

    // Save each correction as a KB resource
    const kbCol = db().collection(`firms/${firmId}/knowledgeBase`);
    const now = admin.firestore.FieldValue.serverTimestamp();

    for (const correction of corrections) {
      // Deduplicate: check if a similar correction already exists
      const existingSnap = await kbCol
        .where('source', '==', 'chat-correction')
        .where('title', '==', correction.title)
        .limit(1)
        .get();

      if (!existingSnap.empty) {
        console.log(`[ai-memory] Skipping duplicate correction: "${correction.title}"`);
        continue;
      }

      const ref = kbCol.doc();
      await ref.set({
        id: ref.id,
        firmId,
        category: 'practice_note',
        title: correction.title,
        citation: '',
        content: correction.content,
        tags: [...(correction.tags ?? []), 'attorney-correction', 'auto-captured'],
        docTypes: correction.docTypes ?? [],
        jurisdiction: 'NJ',
        isActive: true,
        source: 'chat-correction',
        sourceUrl: '',
        conversationId,
        createdAt: now,
        updatedAt: now,
        createdBy: 'system',
        updatedBy: 'system',
      });

      console.log(`[ai-memory] ✓ Saved correction to KB: "${correction.title}" (${ref.id})`);
    }

    console.log(`[ai-memory] Saved ${corrections.length} corrections from conversation ${conversationId}`);
  } catch (err) {
    console.warn('[ai-memory] Correction extraction failed:', err);
    // Non-critical — don't throw
  }
}

// ---------------------------------------------------------------------------
// Layer 3: Firm-wide Memory
// ---------------------------------------------------------------------------

/**
 * Get or create the firm's AI memory.
 */
export async function getFirmMemory(firmId: string): Promise<FirmMemory> {
  const ref = db().doc(`firms/${firmId}/firmAiMemory/config`);
  const snap = await ref.get();

  if (snap.exists) return snap.data() as FirmMemory;

  const memory: FirmMemory = {
    firmId,
    draftingPatterns: {},
    globalInstructions: [],
    frequentTopics: [],
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  await ref.set(memory);
  return memory;
}

// ---------------------------------------------------------------------------
// Build memory prompt
// ---------------------------------------------------------------------------

/**
 * Build a memory context string that can be injected into the AI system prompt.
 * Combines client memory + firm memory into one section.
 */
export async function buildMemoryPrompt(
  firmId: string,
  clientId?: string,
): Promise<string> {
  let prompt = '';

  // Client memory
  if (clientId) {
    try {
      const mem = await getClientMemory(firmId, clientId);

      if (mem.keyFacts.length > 0) {
        prompt += '\n\nCLIENT MEMORY (facts learned from previous conversations):';
        for (const f of mem.keyFacts.slice(-30)) { // Most recent 30
          prompt += `\n  [${f.category}] ${f.fact}`;
        }
      }

      if (mem.draftHistory.length > 0) {
        prompt += `\n\nDRAFT HISTORY (${mem.draftHistory.length} documents previously generated):`;
        for (const d of mem.draftHistory.slice(-10)) {
          prompt += `\n  - ${d.title} (${d.docType}, ${d.generatedAt})${d.customInstructions ? ` — Note: ${d.customInstructions.slice(0, 100)}` : ''}`;
        }
      }

      if (Object.keys(mem.preferences).length > 0) {
        prompt += '\n\nCLIENT PREFERENCES:';
        for (const [key, val] of Object.entries(mem.preferences)) {
          prompt += `\n  ${key}: ${val}`;
        }
      }
    } catch {
      // Non-critical
    }
  }

  // Firm memory
  try {
    const firmMem = await getFirmMemory(firmId);

    if (firmMem.globalInstructions.length > 0) {
      prompt += '\n\nFIRM STANDING INSTRUCTIONS (always follow these):';
      for (const inst of firmMem.globalInstructions) {
        prompt += `\n  • ${inst}`;
      }
    }

    if (Object.keys(firmMem.draftingPatterns).length > 0) {
      prompt += '\n\nFIRM DRAFTING PATTERNS:';
      for (const [key, val] of Object.entries(firmMem.draftingPatterns)) {
        prompt += `\n  ${key}: ${val}`;
      }
    }
  } catch {
    // Non-critical
  }

  return prompt;
}
