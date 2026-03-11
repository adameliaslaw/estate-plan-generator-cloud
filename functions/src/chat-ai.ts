/**
 * functions/src/chat-ai.ts
 *
 * Enhanced AI Chat — supports both general Q&A and document drafting mode.
 *
 * Modes:
 *  - 'chat' (default): General estate planning Q&A with optional client context
 *  - 'draft': Conversational document drafting assistant with full client context
 *    (questionnaire, notes, vault docs, knowledge base). Can produce a saveable
 *    document draft when the attorney asks for it.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { callAI, sanitizeForPrompt } from './ai-client';
import { aggregateClientContext, ClientContext } from './client-context-aggregator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatAiRequest {
  firmId: string;
  clientId?: string;
  message: string;
  contextParams?: Record<string, any>;
  history?: { role: 'user' | 'assistant'; content: string }[];
  /** 'chat' for general Q&A, 'draft' for document drafting */
  mode?: 'chat' | 'draft';
  /** When mode='draft', the document type being drafted */
  draftDocType?: string;
}

interface ChatAiResponse {
  reply: string;
  /** When the AI produces a document draft, this contains the HTML content */
  draftContent?: string;
  /** Title for the draft document */
  draftTitle?: string;
}

// ---------------------------------------------------------------------------
// Build system prompt
// ---------------------------------------------------------------------------

function buildChatSystemPrompt(
  mode: 'chat' | 'draft',
  draftDocType: string | undefined,
  contextStr: string,
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

CLIENT CONTEXT (use this data to populate the document):
${contextStr}

IMPORTANT: When generating a document draft, produce complete, execution-ready HTML with all client data filled in — never leave [NAME] or [DATE] placeholders when the data is available in the context.`;
  }

  // Default chat system prompt
  return `You are an expert New Jersey estate planning attorney assistant.
Your primary role is to act as a specialized legal assistant, focusing on New Jersey estate planning law, citations, and statutory compliance.
When answering questions about estate planning, drafting, or legal strategy, you must strictly cite relevant New Jersey statutes (e.g., Title 3B for Administration of Estates, N.J.S.A. 46:2B-8 for Powers of Attorney, N.J.S.A. 26:2H-53 for Advance Directives) and applicable case law. 
Provide highly intuitive, legally accurate, and professional guidance. Be analytical, precise, and proactive in identifying potential legal issues or statutory requirements.
Do not fabricate citations; if you do not know the exact statute, refer to the general legal principle under New Jersey law.
Here is the data context of the user's current environment or client:
${contextStr}
`;
}

// ---------------------------------------------------------------------------
// Build context string
// ---------------------------------------------------------------------------

async function buildContextString(
  firmId: string,
  clientId: string | undefined,
  mode: 'chat' | 'draft',
  draftDocType: string | undefined,
  contextParams: Record<string, any> | undefined,
): Promise<string> {
  let contextStr = '';

  if (clientId && mode === 'draft') {
    // Full context aggregation for drafting mode
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
        contextStr += `\n\nKNOWLEDGE BASE RESOURCES (${ctx.knowledgeResources.length}):`;
        for (const r of ctx.knowledgeResources.slice(0, 10)) {
          contextStr += `\n  [${r.category}] ${r.title}${r.citation ? ` (${r.citation})` : ''}: ${r.content.slice(0, 200)}`;
        }
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
  } else if (clientId) {
    // Basic client context for chat mode
    const clientDoc = await admin.firestore()
      .collection('firms').doc(firmId).collection('clients').doc(clientId).get();
    if (clientDoc.exists) {
      contextStr += `\nViewing Client: ${JSON.stringify(clientDoc.data())}`;
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

export const chatAi = functions.region('us-east1').https.onCall(
  async (data: ChatAiRequest, context: functions.https.CallableContext) => {
    // 1. Authenticate user
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'You must be signed in to use the AI Assistant.',
      );
    }

    const { firmId, clientId, message, contextParams, history = [], mode = 'chat', draftDocType } = data;

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
      const firmData = firmDoc.data();

      // 3. Build context
      const contextStr = await buildContextString(firmId, clientId, mode, draftDocType, contextParams);

      // 4. Build prompt
      const systemPrompt = buildChatSystemPrompt(mode, draftDocType, contextStr);

      // Build user prompt including history
      let userPrompt = '';
      if (history.length > 0) {
        userPrompt += 'Chat History:\n';
        for (const msg of history) {
          userPrompt += `${msg.role.toUpperCase()}: ${msg.content}\n`;
        }
        userPrompt += `\nCURRENT USER MESSAGE: ${message}`;
      } else {
        userPrompt = message;
      }

      // 5. Call the LLM
      const raw = await callAI(systemPrompt, userPrompt, firmData, {
        model: firmData?.chatbotModel || undefined,
        temperature: mode === 'draft' ? 0.2 : 0.4,
        maxTokens: mode === 'draft' ? 8000 : 1000,
      });

      // 6. Parse response (check for draft content in draft mode)
      if (mode === 'draft') {
        const result = parseDraftResponse(raw);

        // If a draft was produced, optionally save it
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
        }

        return result;
      }

      return { reply: raw };
    } catch (error: any) {
      console.error('[chatAi] Error:', error);
      throw new functions.https.HttpsError(
        'internal',
        error.message || 'An error occurred bridging to the AI provider.',
      );
    }
  },
);
