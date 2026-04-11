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
import { callAI, sanitizeForPrompt, type FirmData, callPerplexityWithCitations } from './ai-client';
import { aggregateClientContext, ClientContext, aggregateMinimalContext, KBSnapshot } from './client-context-aggregator';
import { getLearningContext, formatLearningPrompt } from './template-learning';
import {
  saveConversation,
  loadConversation,
  buildMemoryPrompt,
  extractAndSaveKeyFacts,
  extractAndSaveCorrections,
  ConversationMessage,
} from './ai-memory';
import { generateDocument } from './unified-generator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatAiRequest {
  firmId: string;
  clientId?: string;
  message: string;
  contextParams?: Record<string, unknown>;
  history?: { role: 'user' | 'assistant'; content: string }[];
  /** 'chat' for general Q&A, 'draft' for document drafting, 'research' for web-grounded research */
  mode?: 'chat' | 'draft' | 'research';
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
  /** Source citations from Perplexity (research mode) */
  citations?: string[];
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
    (r) => {
      const simLabel = r.similarity ? ` [relevance: ${(r.similarity * 100).toFixed(0)}%]` : '';
      const contentPreview = r.content.length > 2000 ? r.content.slice(0, 2000) + '…' : r.content;
      return `  [${r.category}] ${r.title}${r.citation ? ` (${r.citation})` : ''}${simLabel}:\n${contentPreview}`;
    },
  );

  return `\nKNOWLEDGE BASE (${resources.length} resources):\n${lines.join('\n\n')}`;
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
  contextParams: Record<string, unknown> | undefined,
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
    // No client selected — still fetch firm + KB using vector search with user's message
    try {
      const minCtx = await aggregateMinimalContext(firmId, contextParams?.__userMessage as string | undefined);
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
// Detect generation intent in USER MESSAGE (pre-LLM short-circuit)
// ---------------------------------------------------------------------------

/**
 * Patterns that indicate the user is explicitly requesting document generation.
 * When matched in draft mode, we skip the chat LLM call and go straight to
 * the unified generator — eliminating the double-LLM-call bottleneck.
 */
const USER_GENERATION_PATTERNS: RegExp[] = [
  /\b(?:draft|generate|create|produce|write|prepare|make)\s+(?:a\s+|the\s+|my\s+)?(?:will|trust|poa|power\s+of\s+attorney|deed|advance\s+directive|living\s+will|document)/i,
  /\b(?:draft|generate|create|produce)\s+(?:it|this|the\s+document|the\s+draft)/i,
  /\bgo\s+ahead\s+and\s+(?:draft|generate|create)/i,
  /\b(?:please\s+)?(?:draft|generate)\b.*\btemplate\b/i,
  /\bready\s+to\s+(?:draft|generate)/i,
  /\blet'?s\s+(?:draft|generate|create)/i,
  // Affirmative intent — user confirming they want generation to proceed
  /^\s*(?:go\s+ahead|do\s+it|yes(?:\s*,?\s*please)?|sounds?\s+good|perfect|proceed|make\s+it|yes\s+go)\s*[.!]?\s*$/i,
  /\b(?:go\s+ahead|proceed)\b/i,
];

function detectUserGenerationIntent(message: string): boolean {
  return USER_GENERATION_PATTERNS.some((p) => p.test(message));
}

// ---------------------------------------------------------------------------
// Detect generation intent in AI response (fallback for conversational flow)
// ---------------------------------------------------------------------------

interface GenerationAction {
  shouldGenerate: boolean;
  docType?: string;
  instructions?: string;
}

function detectGenerationIntent(raw: string, draftDocType?: string): GenerationAction {
  // Strategy 1: AI returned a structured JSON action
  try {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    if (cleaned.startsWith('{')) {
      const parsed = JSON.parse(cleaned);
      if (parsed.action === 'generate' || parsed.draftContent || parsed.content) {
        return {
          shouldGenerate: true,
          docType: parsed.docType ?? draftDocType,
          instructions: parsed.instructions ?? parsed.customInstructions,
        };
      }
    }
  } catch {
    // Not JSON — check for other signals
  }

  // Strategy 2: AI produced a substantial HTML document in its response
  const hasHtmlStructure = /<(?:h[1-6]|p|div|table|section|article)[^>]*>[\s\S]*?<\/(?:h[1-6]|p|div|table|section|article)>/i.test(raw);
  const htmlTagCount = (raw.match(/<[^>]+>/g) || []).length;
  if (hasHtmlStructure && htmlTagCount > 10 && raw.length > 500) {
    return { shouldGenerate: true, docType: draftDocType };
  }

  // Strategy 3: AI produced a markdown-formatted document
  const markdownHeadings = (raw.match(/^#{1,3}\s+.+$/gm) || []).length;
  if (markdownHeadings >= 3 && raw.length > 1000) {
    return { shouldGenerate: true, docType: draftDocType };
  }

  return { shouldGenerate: false };
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const chatAi = functions
  .runWith({ timeoutSeconds: 300, memory: '1GB' })
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
      const t0 = Date.now();

      // 2. Fetch firm data (for API keys and provider)
      const firmDoc = await admin.firestore().collection('firms').doc(firmId).get();
      if (!firmDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Firm not found.');
      }
      const firmData = firmDoc.data() as FirmData;
      console.log(`[chatAi] Firm fetch: ${Date.now() - t0}ms`);

      // 3. Load existing conversation if resuming
      let resolvedHistory = history.slice(-20); // Cap history to prevent unbounded prompt growth
      if (inConvId && history.length === 0) {
        const existingConv = await loadConversation(firmId, inConvId);
        if (existingConv) {
          resolvedHistory = existingConv.messages
            .filter((m) => m.role !== 'assistant' || !m.content.startsWith('Hello!'))
            .slice(-20)
            .map((m) => ({ role: m.role, content: m.content }));
        }
      }

      // 3b. Detect model override in user message
      let modelOverride: string | undefined;
      const modelPatterns: Array<{ regex: RegExp; model: string }> = [
        { regex: /\busing\s+opus\b/i, model: 'claude-opus-4-6' },
        { regex: /\bwith\s+opus\b/i, model: 'claude-opus-4-6' },
        { regex: /\buse\s+opus\b/i, model: 'claude-opus-4-6' },
        { regex: /\busing\s+sonnet\b/i, model: 'claude-sonnet-4-6' },
        { regex: /\bwith\s+sonnet\b/i, model: 'claude-sonnet-4-6' },
        { regex: /\busing\s+gpt-?5\b/i, model: 'gpt-5.4' },
        { regex: /\bwith\s+gpt-?5\b/i, model: 'gpt-5.4' },
        { regex: /\busing\s+gemini\b/i, model: 'gemini-2.5-flash' },
        { regex: /\bwith\s+gemini\b/i, model: 'gemini-2.5-flash' },
        { regex: /\busing\s+gpt-?4\b/i, model: 'gpt-5.4' },
        { regex: /\bwith\s+gpt-?4\b/i, model: 'gpt-5.4' },
      ];
      for (const { regex, model } of modelPatterns) {
        if (regex.test(message)) {
          modelOverride = model;
          break;
        }
      }

      // =====================================================================
      // 4. SHORT-CIRCUIT: If the user explicitly requests generation in draft
      //    mode with a client selected, skip the chat LLM call entirely and
      //    route directly to the unified generator. This eliminates the
      //    double-LLM-call that was causing timeouts.
      // =====================================================================
      if (mode === 'draft' && clientId && detectUserGenerationIntent(message)) {
        const targetDocType = draftDocType ?? 'will';
        console.log(`[chatAi] Short-circuit: user explicitly requested ${targetDocType} generation, skipping chat LLM call`);

        // Aggregate context once (will be reused by the generator)
        let preloadedContext: Awaited<ReturnType<typeof aggregateClientContext>> | undefined;
        try {
          preloadedContext = await aggregateClientContext(firmId, clientId, targetDocType);
          console.log(`[chatAi] Context aggregation: ${Date.now() - t0}ms`);
        } catch (ctxErr) {
          console.warn('[chatAi] Context aggregation failed for short-circuit:', ctxErr);
        }

        try {
          const genResult = await generateDocument({
            firmId,
            clientId,
            docType: targetDocType,
            generationMode: 'hybrid',
            customInstructions: message, // Pass the user's full message as instructions
            createdBy: context.auth.uid,
            triggerSource: 'chat-draft',
            modelOverride,
            preloadedContext,
          });
          console.log(`[chatAi] Short-circuit generation complete: ${Date.now() - t0}ms`);

          const reply = `I've generated your ${targetDocType} and saved it to the Document Vault as "${genResult.title}" (version ${genResult.currentVersion}).`;

          // Save conversation
          const allMessages: ConversationMessage[] = [
            ...resolvedHistory.map((m) => ({
              role: m.role,
              content: m.content,
              timestamp: new Date().toISOString(),
            })),
            { role: 'user' as const, content: message, timestamp: new Date().toISOString() },
            {
              role: 'assistant' as const,
              content: `[Document draft saved to vault: "${genResult.title}"]`,
              timestamp: new Date().toISOString(),
              isDraft: true,
              draftTitle: genResult.title,
            },
          ];
          const convId = await saveConversation(firmId, context.auth.uid, inConvId, allMessages, mode, clientId, draftDocType);

          return {
            reply,
            draftContent: genResult.content,
            draftTitle: genResult.title,
            conversationId: convId,
          } as ChatAiResponse;
        } catch (genErr) {
          console.error('[chatAi] Short-circuit generation failed:', genErr);
          // Return a friendly error instead of falling through to the full 
          // (slow) chat+generation pipeline that caused the original timeout
          const errMsg = (genErr as Error).message ?? 'Unknown error';
          const reply = `I tried to generate your ${targetDocType} but ran into an issue: ${errMsg}. Please try again — if the problem persists, try a simpler request or check that the client profile has the necessary data filled in.`;
          const allMessages: ConversationMessage[] = [
            ...resolvedHistory.map((m) => ({
              role: m.role,
              content: m.content,
              timestamp: new Date().toISOString(),
            })),
            { role: 'user' as const, content: message, timestamp: new Date().toISOString() },
            { role: 'assistant' as const, content: reply, timestamp: new Date().toISOString() },
          ];
          const convId = await saveConversation(firmId, context.auth.uid, inConvId, allMessages, mode, clientId, draftDocType);
          return { reply, conversationId: convId } as ChatAiResponse;
        }
      }

      // =====================================================================
      // 4b. RESEARCH MODE: Pure Perplexity — no client context, no KB.
      //     Returns grounded answers with source citations.
      // =====================================================================
      if (mode === 'research') {
        console.log(`[chatAi] Research mode — calling Perplexity`);

        const researchSystemPrompt = `You are an expert legal research assistant specializing in estate planning, trust and estate law, elder law, and related practice areas.

YOUR ROLE:
• Provide thorough, well-researched answers grounded in current legal sources.
• Cite specific statutes, regulations, case law, and authoritative secondary sources.
• Focus especially on New Jersey law (N.J.S.A. Title 3B, Title 46, etc.) but cover federal and other state laws when relevant.
• Organize your answers with clear headings and numbered citations.
• Distinguish between current law and proposed/pending legislation.

RULES:
• Always indicate the jurisdiction of cited authorities.
• If information may be outdated, note the date context.
• Never fabricate citations — if you cannot find a specific source, say so.
• Provide practical implications for estate planning practitioners where applicable.`;

        let userPrompt = '';
        if (resolvedHistory.length > 0) {
          userPrompt += 'Previous research conversation:\n';
          for (const msg of resolvedHistory.slice(-10)) {
            userPrompt += `${msg.role.toUpperCase()}: ${msg.content}\n`;
          }
          userPrompt += `\nNEW QUESTION: ${message}`;
        } else {
          userPrompt = message;
        }

        const { content: researchContent, citations: researchCitations } =
          await callPerplexityWithCitations(researchSystemPrompt, userPrompt, firmData, {
            model: modelOverride ?? 'sonar',
            temperature: 0.2,
          });
        console.log(`[chatAi] Research response received: ${researchContent.length} chars, ${researchCitations.length} citations (${Date.now() - t0}ms)`);

        const allMessages: ConversationMessage[] = [
          ...resolvedHistory.map((m) => ({
            role: m.role,
            content: m.content,
            timestamp: new Date().toISOString(),
          })),
          { role: 'user' as const, content: message, timestamp: new Date().toISOString() },
          { role: 'assistant' as const, content: researchContent, timestamp: new Date().toISOString() },
        ];

        const convId = await saveConversation(firmId, context.auth.uid, inConvId, allMessages, 'research', clientId);

        return {
          reply: researchContent,
          citations: researchCitations,
          conversationId: convId,
        } as ChatAiResponse;
      }

      // =====================================================================
      // 5. Normal flow: Build context, call LLM, detect generation intent
      // =====================================================================

      // Build context, template summary, learning context, and memory ALL in parallel
      const contextParamsWithMsg = { ...contextParams, __userMessage: message };
      const [contextStr, templateSummaryResult, learningCtxResult, memoryPromptResult] = await Promise.all([
        buildContextString(firmId, clientId, mode, draftDocType, contextParamsWithMsg),
        getTemplateSummary(firmId),
        getLearningContext(firmId).catch(() => null),
        buildMemoryPrompt(firmId, clientId).catch(() => ''),
      ]);
      console.log(`[chatAi] Context + metadata (parallel): ${Date.now() - t0}ms`);

      // Results are already fetched in the parallel block above
      const templateSummary = templateSummaryResult;
      const learningCtx = learningCtxResult;
      const memoryPromptStr = memoryPromptResult;

      const learningPromptStr = learningCtx ? formatLearningPrompt(learningCtx) : '';

      // Build prompt (now includes memory context)
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

      // Call the LLM
      // Draft mode uses documentDraftingModel for higher quality; chat uses chatbotModel
      const effectiveModel = mode === 'draft'
        ? (modelOverride ?? firmData?.documentDraftingModel ?? firmData?.chatbotModel ?? undefined)
        : (modelOverride ?? firmData?.chatbotModel ?? undefined);
      const raw = await callAI(systemPrompt, userPrompt, firmData, {
        model: effectiveModel,
        temperature: mode === 'draft' ? 0.2 : 0.4,
        maxTokens: mode === 'draft' ? 16000 : 8000,
      });
      console.log(`[chatAi] LLM call complete: ${Date.now() - t0}ms`);

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

      // 9. Handle draft mode — detect if the AI wants to generate a document
      if (mode === 'draft') {
        const genAction = detectGenerationIntent(raw, draftDocType);
        const result: ChatAiResponse = { reply: raw };

        if (genAction.shouldGenerate && clientId) {
          // The AI already produced document content in its response.
          // Instead of making a SECOND LLM call through generateDocument(),
          // extract the HTML directly and save it — eliminating the
          // double-LLM-call bottleneck that was causing 30-90s delays.
          const targetDocType = genAction.docType ?? draftDocType ?? 'custom';
          console.log(`[chatAi] Generation intent detected for ${targetDocType} — saving AI response directly (${Date.now() - t0}ms elapsed)`);

          try {
            // Extract the HTML content the AI already produced
            let draftHtml = raw;

            // If the AI returned JSON with draftContent, extract it
            try {
              const cleaned = raw
                .replace(/^```(?:json)?\s*/i, '')
                .replace(/\s*```\s*$/i, '')
                .trim();
              if (cleaned.startsWith('{')) {
                const parsed = JSON.parse(cleaned);
                if (parsed.draftContent) {
                  draftHtml = parsed.draftContent;
                  result.reply = parsed.reply ?? `Here's your ${targetDocType} draft.`;
                } else if (parsed.content) {
                  draftHtml = parsed.content;
                  result.reply = parsed.reply ?? `Here's your ${targetDocType} draft.`;
                }
              }
            } catch {
              // Not JSON — use the raw response as HTML
            }

            // Strip markdown fences if the AI wrapped HTML in them
            draftHtml = draftHtml
              .replace(/^```(?:html)?\s*\n?/i, '')
              .replace(/\n?\s*```\s*$/i, '')
              .trim();

            const { getDocTypeDisplayName } = await import('./unified-generator');
            const displayName = getDocTypeDisplayName(targetDocType);
            const draftTitle = `${displayName} — Draft`;

            // Save directly to vault (skip the unified generator LLM call)
            const { saveDocumentToVault } = await import('./document-save-helper');
            const saveResult = await saveDocumentToVault({
              firmId,
              clientId,
              docType: targetDocType,
              displayName: draftTitle,
              content: draftHtml,
              status: 'draft',
              createdBy: context.auth.uid,
              documentId: targetDocType,
              generationMode: 'chat-draft',
              changeNotes: 'Generated via AI drafting conversation',
              tags: ['chat-draft'],
            });

            result.draftTitle = draftTitle;
            result.draftContent = draftHtml;
            result.reply = `I've generated your ${targetDocType} and saved it to the Document Vault as "${draftTitle}" (version ${saveResult.currentVersion}).`;
            console.log(`[chatAi] Draft saved directly: ${Date.now() - t0}ms total (avoided 2nd LLM call)`);
          } catch (saveErr) {
            console.error('[chatAi] Direct draft save failed:', saveErr);
            result.reply = `I drafted the document but encountered an error saving it: ${saveErr instanceof Error ? saveErr.message : 'Unknown error'}. You can try again or use the dedicated Generate Documents button.`;
          }
        }

        // Add AI reply to messages — use short summary for drafts to prevent token bloat
        allMessages.push({
          role: 'assistant',
          content: result.draftContent
            ? `[Document draft saved to vault: "${result.draftTitle ?? 'Draft'}"]`
            : result.reply,
          timestamp: new Date().toISOString(),
          isDraft: !!result.draftContent,
          draftTitle: result.draftTitle ?? null,
        });

        // Save conversation (fire-and-forget)
        const convId = await saveConversation(firmId, context.auth.uid, inConvId, allMessages, mode, clientId, draftDocType);
        result.conversationId = convId;

        // Extract key facts (fire-and-forget)
        if (clientId && allMessages.length >= 4) {
          extractAndSaveKeyFacts(firmId, clientId, convId, allMessages, firmData ?? {}).catch(console.error);
          extractAndSaveCorrections(firmId, convId, allMessages, firmData ?? {}).catch(console.error);
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
        extractAndSaveCorrections(firmId, convId, allMessages, firmData ?? {}).catch(console.error);
      }

      return { reply: raw, conversationId: convId };
    } catch (error: unknown) {
      console.error('[chatAi] Error:', error);
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new functions.https.HttpsError(
        'internal',
        errMsg || 'An error occurred bridging to the AI provider.',
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
