/**
 * functions/src/chat-ai.ts
 *
 * Enhanced AI Chat — supports both general Q&A and document drafting mode.
 *
 * Intelligence features:
 *  - Full client context aggregation (notes, vault docs, KB) in ALL modes
 *  - Knowledge base search even without a client selected
 *  - Template awareness (available templates + variable dictionary)
 *  - Learning context from the template learning engine
 *  - LLM-agnostic via callAI (routes based on firm's active provider)
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { callAI, sanitizeForPrompt, type FirmData } from './ai-client';
import { aggregateClientContext, ClientContext, aggregateMinimalContext, KBSnapshot } from './client-context-aggregator';
import { getLearningContext, formatLearningPrompt } from './template-learning';
import {
  saveConversation,
  loadConversation,
  buildMemoryPrompt,
  extractAndSaveKeyFacts,
  recordDraftHistory,
  ConversationMessage,
} from './ai-memory';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatAiRequest {
  firmId: string;
  clientId?: string;
  message: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contextParams?: Record<string, any>;
  history?: { role: 'user' | 'assistant'; content: string }[];
  /** 'chat' for general Q&A, 'draft' for document drafting */
  mode?: 'chat' | 'draft';
  /** When mode='draft', the document type being drafted */
  draftDocType?: string;
  /** Resume an existing conversation */
  conversationId?: string;
}

interface ChatAiResponse {
  reply: string;
  /** When the AI produces a document draft, this contains the HTML content */
  draftContent?: string;
  /** Title for the draft document */
  draftTitle?: string;
  /** Persistent conversation ID for resuming */
  conversationId?: string;
}

// ---------------------------------------------------------------------------
// Fetch available templates summary
// ---------------------------------------------------------------------------

async function getTemplateSummary(firmId: string): Promise<string> {
  try {
    const snap = await admin.firestore()
      .collection(`firms/${firmId}/templates`)
      .where('isActive', '==', true)
      .get();

    if (snap.empty) return '';

    const templates = snap.docs.map((d) => {
      const data = d.data();
      return `  - ${data.name} (${data.docType}, variant: ${data.variant}, v${data.version}) — ${data.variables?.length ?? 0} variables`;
    });

    return `\nAVAILABLE TEMPLATES (${templates.length}):\n${templates.join('\n')}`;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Format KB resources for prompt
// ---------------------------------------------------------------------------

function formatKBForPrompt(resources: KBSnapshot[], limit: number = 15): string {
  if (resources.length === 0) return '';

  const lines = resources.slice(0, limit).map(
    (r) => `  [${r.category}] ${r.title}${r.citation ? ` (${r.citation})` : ''}: ${r.content.slice(0, 300)}`,
  );

  return `\nKNOWLEDGE BASE (${resources.length} resources):\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Build system prompt
// ---------------------------------------------------------------------------

function buildChatSystemPrompt(
  mode: 'chat' | 'draft',
  draftDocType: string | undefined,
  contextStr: string,
  templateSummary: string,
  learningPromptStr: string,
): string {
  if (mode === 'draft') {
    return `You are an expert New Jersey estate planning attorney acting as a document drafting assistant.

You are helping the attorney draft ${draftDocType ? `a "${draftDocType}" document` : 'a legal document'}.

YOUR ROLE:
• Engage in a professional conversation about the document's structure, clauses, and content.
• Ask clarifying questions about what the attorney wants included or excluded.
• When the attorney says "generate", "create the document", "draft it", "produce it", or similar — output the complete document.
• When producing a document draft, output ONLY a JSON object: {"draftTitle": "...", "draftContent": "<HTML>", "reply": "Here's your draft..."}.
• When NOT producing a document (just discussing), respond normally with plain text.

LEGAL STANDARDS:
• Follow New Jersey estate planning law rigorously.
• Cite relevant statutes (N.J.S.A. Title 3B, Title 46, etc.) where applicable.
• Do NOT fabricate citations. If uncertain, state the general legal principle.
• Use proper legal formatting and execution blocks.

TEMPLATE AWARENESS:
• When drafting, align the document structure and variables with the firm's existing templates when possible.
• Use Handlebars-style variables (e.g., {{personalInfo.firstName}}) that match the firm's variable dictionary.
${templateSummary}

CLIENT CONTEXT (use this data to populate the document):
${contextStr}
${learningPromptStr}
IMPORTANT: When generating a document draft, produce complete, execution-ready HTML with all client data filled in — never leave [NAME] or [DATE] placeholders when the data is available in the context.`;
  }

  // Default chat system prompt — ENHANCED
  return `You are an expert New Jersey estate planning attorney assistant with deep knowledge of:
• New Jersey estate planning law, statutes, and case law
• Document drafting best practices for wills, trusts, POAs, deeds, and related instruments
• The firm's knowledge base, templates, and client data

YOUR CAPABILITIES:
• Answer complex legal questions with precise statutory citations (N.J.S.A. Title 3B, Title 46, etc.)
• Analyze client situations and recommend strategies
• Reference the firm's knowledge base resources, CLE materials, and statutes
• Advise on document preparation using the firm's established templates
• Explain how template variables map to client questionnaire data

RULES:
• Always cite New Jersey statutes when relevant. Do NOT fabricate citations.
• When referencing knowledge base resources, mention the resource title and citation.
• If uncertain about a specific statute, state the general legal principle.
• Be analytical, precise, and proactive in identifying potential legal issues.
• Give substantive, thorough answers — you are a first-chair estate planning attorney, not a FAQ bot.

CONTEXT:
${contextStr}
${templateSummary}
${learningPromptStr}`;
}

// ---------------------------------------------------------------------------
// Build context string
// ---------------------------------------------------------------------------

async function buildContextString(
  firmId: string,
  clientId: string | undefined,
  mode: 'chat' | 'draft',
  draftDocType: string | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contextParams: Record<string, any> | undefined,
): Promise<string> {
  let contextStr = '';

  if (clientId && (mode === 'draft' || mode === 'chat')) {
    // Full context aggregation for BOTH modes when client is selected
    try {
      const ctx: ClientContext = await aggregateClientContext(firmId, clientId, draftDocType);

      contextStr += `\nCLIENT: ${ctx.computed.clientFullName}`;
      contextStr += `\nAddress: ${ctx.client.personalInfo?.address}, ${ctx.client.personalInfo?.city}, ${ctx.client.personalInfo?.state} ${ctx.client.personalInfo?.zip}`;
      contextStr += `\nCounty: ${ctx.client.personalInfo?.county}`;
      contextStr += `\nMarital Status: ${ctx.client.personalInfo?.maritalStatus}`;
      contextStr += `\nPackage: ${ctx.computed.packageLabel}`;

      if (ctx.computed.hasSpouse) {
        contextStr += `\nSpouse: ${ctx.computed.spouseFullName}`;
      }

      if (ctx.computed.childCount > 0) {
        contextStr += `\nChildren (${ctx.computed.childCount}):`;
        for (const c of ctx.client.children ?? []) {
          contextStr += `\n  - ${c.name}, ${c.isMinor ? 'minor' : 'adult'}, ${c.relationship}${c.specialNeeds ? ' [SPECIAL NEEDS]' : ''}`;
        }
      }

      // Fiduciaries
      const fid = ctx.client.fiduciaries ?? {};
      if (fid.executor?.primary) contextStr += `\nExecutor: ${fid.executor.primary.name}`;
      if (fid.trustee?.primary) contextStr += `\nTrustee: ${fid.trustee.primary.name}`;
      if (fid.powerOfAttorney?.agent) contextStr += `\nPOA Agent: ${fid.powerOfAttorney.agent.name}`;
      if (fid.healthcareProxy?.agent) contextStr += `\nHealthcare Proxy: ${fid.healthcareProxy.agent.name}`;

      // Notes
      if (ctx.notes.length > 0) {
        contextStr += `\n\nCLIENT NOTES (${ctx.notes.length}):`;
        for (const n of ctx.notes.slice(0, 10)) {
          const text = n.aiSummary ?? n.content ?? '';
          contextStr += `\n  [${n.noteType}] ${n.title ?? ''}: ${sanitizeForPrompt(text).slice(0, 300)}`;
        }
      }

      // Existing documents
      if (ctx.existingDocuments.length > 0) {
        contextStr += `\n\nEXISTING VAULT DOCUMENTS (${ctx.existingDocuments.length}):`;
        for (const d of ctx.existingDocuments) {
          contextStr += `\n  - ${d.displayName} (${d.status})`;
        }
      }

      // Knowledge base
      if (ctx.knowledgeResources.length > 0) {
        contextStr += formatKBForPrompt(ctx.knowledgeResources);
      }

      // Full client data as JSON for comprehensive context
      contextStr += `\n\nFULL CLIENT DATA:\n${JSON.stringify(ctx.client, null, 2).slice(0, 8000)}`;
      contextStr += `\n\nFIRM: ${ctx.firm.firmName}, ${ctx.firm.firmAddress}, ${ctx.firm.firmPhone}`;
      contextStr += `\nBar Number: ${ctx.firm.barNumber ?? ''}`;
    } catch (err) {
      console.warn('[chatAi] Context aggregation failed:', err);
      // Fall back to basic client fetch
      const clientDoc = await admin.firestore()
        .collection('firms').doc(firmId).collection('clients').doc(clientId).get();
      if (clientDoc.exists) {
        contextStr += `\nViewing Client: ${JSON.stringify(clientDoc.data())}`;
      }
    }
  } else {
    // No client selected — still fetch firm + KB
    try {
      const minCtx = await aggregateMinimalContext(firmId);
      contextStr += `\nFIRM: ${minCtx.firm.firmName ?? ''}, ${minCtx.firm.firmAddress ?? ''}, ${minCtx.firm.firmPhone ?? ''}`;
      contextStr += `\nBar Number: ${minCtx.firm.barNumber ?? ''}`;

      if (minCtx.knowledgeResources.length > 0) {
        contextStr += formatKBForPrompt(minCtx.knowledgeResources);
      }
    } catch (err) {
      console.warn('[chatAi] Minimal context failed:', err);
    }
  }

  if (contextParams) {
    contextStr += `\nAdditional UI Context: ${JSON.stringify(contextParams)}`;
  }

  return contextStr;
}

// ---------------------------------------------------------------------------
// Parse draft response
// ---------------------------------------------------------------------------

function parseDraftResponse(raw: string): ChatAiResponse {
  // Try to parse as JSON (draft mode response)
  try {
    // Strip markdown fences if present
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    if (cleaned.startsWith('{')) {
      const parsed = JSON.parse(cleaned);
      if (parsed.draftContent) {
        return {
          reply: parsed.reply ?? 'Here is your document draft.',
          draftContent: parsed.draftContent,
          draftTitle: parsed.draftTitle,
        };
      }
    }
  } catch {
    // Not JSON — plain text reply, no draft produced
  }

  return { reply: raw };
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const chatAi = functions
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .region('us-east1')
  .https.onCall(
  async (data: ChatAiRequest, context: functions.https.CallableContext) => {
    // 1. Authenticate user
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'You must be signed in to use the AI Assistant.',
      );
    }

    const { firmId, clientId, message, contextParams, history = [], mode = 'chat', draftDocType, conversationId: inConvId } = data;

    if (!firmId) {
      throw new functions.https.HttpsError('invalid-argument', 'firmId is required.');
    }
    if (!message) {
      throw new functions.https.HttpsError('invalid-argument', 'message is required.');
    }

    try {
      // 2. Fetch firm data (for API keys and provider)
      const firmDoc = await admin.firestore().collection('firms').doc(firmId).get();
      if (!firmDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Firm not found.');
      }
      const firmData = firmDoc.data() as FirmData;

      // 3. Load existing conversation if resuming
      let resolvedHistory = history;
      if (inConvId && history.length === 0) {
        const existingConv = await loadConversation(firmId, inConvId);
        if (existingConv) {
          resolvedHistory = existingConv.messages
            .filter((m) => m.role !== 'assistant' || !m.content.startsWith('Hello!'))
            .map((m) => ({ role: m.role, content: m.content }));
        }
      }

      // 4. Build context (full aggregation for both modes)
      const contextStr = await buildContextString(firmId, clientId, mode, draftDocType, contextParams);

      // 5. Fetch template awareness, learning context, and memory (parallel)
      const [templateSummary, learningCtx, memoryPromptStr] = await Promise.all([
        getTemplateSummary(firmId),
        getLearningContext(firmId).catch(() => null),
        buildMemoryPrompt(firmId, clientId).catch(() => ''),
      ]);

      const learningPromptStr = learningCtx ? formatLearningPrompt(learningCtx) : '';

      // 6. Build prompt (now includes memory context)
      const systemPrompt = buildChatSystemPrompt(
        mode,
        draftDocType,
        contextStr + memoryPromptStr,
        templateSummary,
        learningPromptStr,
      );

      // Build user prompt including history
      let userPrompt = '';
      if (resolvedHistory.length > 0) {
        userPrompt += 'Chat History:\n';
        for (const msg of resolvedHistory) {
          userPrompt += `${msg.role.toUpperCase()}: ${msg.content}\n`;
        }
        userPrompt += `\nCURRENT USER MESSAGE: ${message}`;
      } else {
        userPrompt = message;
      }

      // 7. Call the LLM (uses firm's active provider)
      const raw = await callAI(systemPrompt, userPrompt, firmData, {
        model: firmData?.chatbotModel || undefined,
        temperature: mode === 'draft' ? 0.2 : 0.4,
        maxTokens: mode === 'draft' ? 16000 : 8000,
      });

      // 8. Build the conversation messages for persistence
      const allMessages: ConversationMessage[] = [
        ...resolvedHistory.map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: new Date().toISOString(),
        })),
        {
          role: 'user' as const,
          content: message,
          timestamp: new Date().toISOString(),
        },
      ];

      // 9. Parse response (check for draft content in draft mode)
      if (mode === 'draft') {
        const result: ChatAiResponse = parseDraftResponse(raw);

        // Add AI reply to messages
        allMessages.push({
          role: 'assistant',
          content: result.reply,
          timestamp: new Date().toISOString(),
          isDraft: !!result.draftContent,
          draftTitle: result.draftTitle ?? null,
        });

        // If a draft was produced, save it + record in draft history
        if (result.draftContent && clientId) {
          const now = admin.firestore.FieldValue.serverTimestamp();
          const docId = `${draftDocType ?? 'custom'}_chat_${Date.now()}`;
          const docRef = admin.firestore()
            .collection('firms').doc(firmId)
            .collection('clients').doc(clientId)
            .collection('documents').doc(docId);

          await docRef.set({
            id: docId,
            firmId,
            clientId,
            docType: draftDocType ?? 'custom',
            displayName: result.draftTitle ?? `Chat Draft — ${draftDocType ?? 'Document'}`,
            status: 'draft',
            content: result.draftContent,
            storagePath: '',
            fileName: `${docId}.html`,
            mimeType: 'text/html',
            currentVersion: 1,
            versions: [{
              versionNumber: 1,
              storagePath: '',
              createdAt: admin.firestore.Timestamp.now(),
              createdBy: context.auth.uid,
              changeNotes: 'Generated via AI drafting conversation',
            }],
            generatedByAI: true,
            aiModel: firmData?.chatbotModel ?? 'gpt-4o',
            requiresSignature: false,
            notarized: false,
            tags: ['chat-draft', draftDocType ?? 'custom'],
            isConfidential: true,
            createdAt: now,
            updatedAt: now,
            createdBy: context.auth.uid,
            updatedBy: context.auth.uid,
          });

          result.reply += `\n\n✅ Draft saved to the client's Document Vault as "${result.draftTitle ?? docId}".`;

          // Record draft history (fire-and-forget)
          recordDraftHistory(firmId, clientId, {
            docType: draftDocType ?? 'custom',
            title: result.draftTitle ?? docId,
            generatedAt: new Date().toISOString(),
            generationMode: 'chat-draft',
          }).catch(console.error);
        }

        // Save conversation (fire-and-forget)
        const convId = await saveConversation(firmId, context.auth.uid, inConvId, allMessages, mode, clientId, draftDocType);
        result.conversationId = convId;

        // Extract key facts (fire-and-forget)
        if (clientId && allMessages.length >= 4) {
          extractAndSaveKeyFacts(firmId, clientId, convId, allMessages, firmData ?? {}).catch(console.error);
        }

        return result;
      }

      // Chat mode
      allMessages.push({
        role: 'assistant',
        content: raw,
        timestamp: new Date().toISOString(),
        isDraft: false,
        draftTitle: null,
      });

      // Save conversation
      const convId = await saveConversation(firmId, context.auth.uid, inConvId, allMessages, mode, clientId);

      // Extract key facts (fire-and-forget)
      if (clientId && allMessages.length >= 4) {
        extractAndSaveKeyFacts(firmId, clientId, convId, allMessages, firmData ?? {}).catch(console.error);
      }

      return { reply: raw, conversationId: convId };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error('[chatAi] Error:', error);
      throw new functions.https.HttpsError(
        'internal',
        error.message || 'An error occurred bridging to the AI provider.',
      );
    }
  },
);

// ---------------------------------------------------------------------------
// List conversations (for conversation history sidebar)
// ---------------------------------------------------------------------------

export const listAiConversations = functions
  .region('us-east1')
  .https.onCall(
    async (data: { firmId: string; clientId?: string; limit?: number }, context) => {
      if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
      }
      const { firmId, clientId, limit: lim = 20 } = data;
      if (!firmId) {
        throw new functions.https.HttpsError('invalid-argument', 'firmId is required.');
      }
      const { listConversations } = await import('./ai-memory');
      return listConversations(firmId, clientId, lim);
    },
  );

// ---------------------------------------------------------------------------
// Save a single message as a client note (manual integration)
// ---------------------------------------------------------------------------

export const saveMessageAsNote = functions
  .region('us-east1')
  .https.onCall(
    async (
      data: { firmId: string; clientId: string; messageContent: string; messageRole: 'user' | 'assistant'; conversationId?: string },
      context,
    ) => {
      if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
      }
      const { firmId, clientId, messageContent, messageRole, conversationId: convId } = data;
      if (!firmId || !clientId || !messageContent) {
        throw new functions.https.HttpsError('invalid-argument', 'firmId, clientId, and messageContent are required.');
      }

      const noteRef = admin.firestore()
        .collection(`firms/${firmId}/clients/${clientId}/notes`)
        .doc();

      const isAssistant = messageRole === 'assistant';
      const title = isAssistant
        ? `AI Assistant Response — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
        : `Chat Message — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

      const now = admin.firestore.FieldValue.serverTimestamp();
      await noteRef.set({
        id: noteRef.id,
        title,
        content: messageContent,
        noteType: 'ai-chat',
        source: 'chatbot',
        conversationId: convId ?? null,
        savedBy: context.auth.uid,
        createdAt: now,
        updatedAt: now,
      });

      return { success: true, noteId: noteRef.id, title };
    },
  );
