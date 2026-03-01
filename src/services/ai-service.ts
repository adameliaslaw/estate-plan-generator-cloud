/**
 * ai-service.ts — Pluggable AI provider layer for the NJ Estate Plan Generator.
 *
 * Architecture
 * ─────────────
 * AiProvider        abstract interface every provider must implement
 * OpenAiProvider    concrete implementation using the OpenAI REST API
 * AiService         singleton façade; delegates to the current provider
 *
 * Usage
 * ─────
 * // At app startup (main.tsx or a root component):
 * AiService.initialize(new OpenAiProvider(import.meta.env.VITE_OPENAI_API_KEY));
 *
 * // In a component or service:
 * const ai = AiService.getInstance();
 * const doc = await ai.generateDocument({ clientData, docType, ... });
 *
 * Prompt-injection protection
 * ────────────────────────────
 * All free-text user fields passed to an AI prompt are sanitized with
 * sanitizeForPrompt() before being serialised into the prompt payload.
 */

import { sanitizeForPrompt } from '@/utils/sanitize';
import { DEFAULT_AI_MODEL } from '@/config/constants';
import type { ClientData, DocType, FirmInfo, PackageType } from '@/types';

// ---------------------------------------------------------------------------
// Parameter / result types
// ---------------------------------------------------------------------------

export interface DocumentGenerationParams {
  clientData: ClientData;
  docType: DocType;
  packageType: PackageType;
  trustTypes?: string[];
  /** NJ statutory template context injected from research/knowledge base. */
  templateContext: string;
  firmInfo: FirmInfo;
}

export interface GeneratedDocument {
  title: string;
  /** Full document body as HTML, ready to render or convert to DOCX/PDF. */
  content: string;
  docType: DocType;
  metadata: Record<string, unknown>;
}

export interface DocumentReviewParams {
  documentHtml: string;
  docType: DocType;
  clientData: ClientData;
  /** Specific areas the reviewer should focus on. */
  focusAreas?: string[];
}

export interface DocumentReview {
  issues: ReviewIssue[];
  suggestions: string[];
  complianceNotes: string[];
  overallAssessment: string;
}

export interface ReviewIssue {
  severity: 'critical' | 'major' | 'minor' | 'info';
  location: string;
  description: string;
  suggestion: string;
}

export interface SummaryParams {
  documentHtml: string;
  docType: DocType;
  audience: 'client' | 'attorney' | 'paralegal';
}

export interface TranscriptionResult {
  text: string;
  /** Confidence score 0–1 (when available). */
  confidence?: number;
  /** Segments with timestamps (when available). */
  segments?: TranscriptionSegment[];
}

export interface TranscriptionSegment {
  start: number; // seconds
  end: number;
  text: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ---------------------------------------------------------------------------
// AiProvider interface
// ---------------------------------------------------------------------------

/**
 * Every AI backend (OpenAI, Anthropic, Gemini, local model, …)
 * must implement this interface to be usable by AiService.
 */
export interface AiProvider {
  /** Generate a complete estate-planning document. */
  generateDocument(params: DocumentGenerationParams): Promise<GeneratedDocument>;

  /** Review a document for NJ statutory compliance and best-practice issues. */
  reviewDocument(params: DocumentReviewParams): Promise<DocumentReview>;

  /** Generate a plain-language summary of a document for a given audience. */
  generateSummary(params: SummaryParams): Promise<string>;

  /** Transcribe an audio recording of a client intake session. */
  transcribeAudio(audioBlob: Blob): Promise<TranscriptionResult>;

  /** Multi-turn chat (e.g. client Q&A assistant, attorney research helper). */
  chat(messages: ChatMessage[], systemPrompt?: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// NJ Statutory system prompt helpers
// ---------------------------------------------------------------------------

const NJ_STATUTORY_CONTEXT = `
You are an expert New Jersey estate planning attorney assistant. You generate
precise, legally accurate estate planning documents that comply with:

• New Jersey Revised Statutes Title 3B (Administration of Estates)
• N.J.S.A. 3B:3-1 et seq. (Wills — formalities, execution, witnesses)
• N.J.S.A. 3B:11-1 et seq. (Trusts)
• N.J.S.A. 46:2B-8 et seq. (Durable Power of Attorney)
• New Jersey Advance Directive for Health Care Act (N.J.S.A. 26:2H-53 et seq.)
• HIPAA (45 C.F.R. Parts 160 and 164)

Document standards:
- All Wills must be signed by the testator and two adult witnesses who are not
  beneficiaries (N.J.S.A. 3B:3-2).
- Durable Powers of Attorney must comply with N.J.S.A. 46:2B-8.9 (statutory short
  form or equivalent).
- Healthcare Proxies / Advance Directives must satisfy N.J.S.A. 26:2H-56.
- Use plain, clear language while preserving legal precision.
- Include all required NJ execution clauses and notary blocks.
- Never fabricate statutes, case law, or legal standards.
`.trim();

/**
 * Sanitize all free-text fields within ClientData before they are embedded
 * into a prompt. Returns a new object with sanitized strings.
 */
function sanitizeClientData(data: ClientData): ClientData {
  const s = sanitizeForPrompt;

  return {
    ...data,
    personalInfo: {
      ...data.personalInfo,
      firstName: s(data.personalInfo.firstName),
      lastName: s(data.personalInfo.lastName),
      middleName: data.personalInfo.middleName
        ? s(data.personalInfo.middleName)
        : undefined,
      address: s(data.personalInfo.address),
      city: s(data.personalInfo.city),
      occupation: data.personalInfo.occupation
        ? s(data.personalInfo.occupation)
        : undefined,
    },
    spouseInfo: data.spouseInfo
      ? {
          ...data.spouseInfo,
          firstName: s(data.spouseInfo.firstName),
          lastName: s(data.spouseInfo.lastName),
          address: s(data.spouseInfo.address),
        }
      : undefined,
    beneficiaries: data.beneficiaries.map((b) => ({
      ...b,
      firstName: s(b.firstName),
      lastName: s(b.lastName),
      relationship: s(b.relationship),
    })),
    executors: data.executors.map((e) => ({
      ...e,
      firstName: s(e.firstName),
      lastName: s(e.lastName),
      relationship: s(e.relationship),
    })),
    healthcareProxies: data.healthcareProxies.map((h) => ({
      ...h,
      firstName: s(h.firstName),
      lastName: s(h.lastName),
      relationship: s(h.relationship),
    })),
    specialInstructions: data.specialInstructions
      ? s(data.specialInstructions)
      : undefined,
  };
}

/**
 * Build the document generation system prompt.
 */
function buildDocGenerationSystemPrompt(
  templateContext: string,
  firmInfo: FirmInfo,
): string {
  return `${NJ_STATUTORY_CONTEXT}

FIRM INFORMATION:
${JSON.stringify(
  {
    name: sanitizeForPrompt(firmInfo.name),
    address: sanitizeForPrompt(firmInfo.address),
    city: sanitizeForPrompt(firmInfo.city),
    state: firmInfo.state,
    zip: firmInfo.zip,
    phone: firmInfo.phone,
    email: sanitizeForPrompt(firmInfo.email),
    primaryAttorney: firmInfo.primaryAttorney
      ? sanitizeForPrompt(firmInfo.primaryAttorney)
      : undefined,
    barNumber: firmInfo.barNumber,
  },
  null,
  2,
)}

STATUTORY TEMPLATE CONTEXT:
${sanitizeForPrompt(templateContext)}

OUTPUT FORMAT:
Respond with a valid JSON object matching this schema:
{
  "title": "<document title>",
  "content": "<complete HTML document body — use semantic tags, no <html>/<body>/<head>",
  "metadata": {
    "wordCount": <number>,
    "estimatedPages": <number>,
    "executionRequirements": ["<requirement 1>", ...],
    "witnessRequired": <boolean>,
    "notarizationRequired": <boolean>
  }
}

Do not include any text outside the JSON object.`;
}

// ---------------------------------------------------------------------------
// OpenAI REST API types (minimal surface area — no SDK dependency)
// ---------------------------------------------------------------------------

interface OpenAiChatRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' | 'text' };
}

interface OpenAiChatResponse {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAiTranscriptionResponse {
  text: string;
}

// ---------------------------------------------------------------------------
// OpenAiProvider
// ---------------------------------------------------------------------------

export class OpenAiProvider implements AiProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl = 'https://api.openai.com/v1';

  constructor(apiKey: string, model: string = DEFAULT_AI_MODEL) {
    if (!apiKey) {
      throw new Error('OpenAiProvider: apiKey is required.');
    }
    this.apiKey = apiKey;
    this.model = model;
  }

  // -------------------------------------------------------------------------
  // Private helper — raw chat completion
  // -------------------------------------------------------------------------

  private async chatCompletion(
    req: OpenAiChatRequest,
  ): Promise<OpenAiChatResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(req),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(
        `OpenAI API error ${response.status}: ${errorBody || response.statusText}`,
      );
    }

    return (await response.json()) as OpenAiChatResponse;
  }

  // -------------------------------------------------------------------------
  // generateDocument
  // -------------------------------------------------------------------------

  async generateDocument(
    params: DocumentGenerationParams,
  ): Promise<GeneratedDocument> {
    const { clientData, docType, packageType, trustTypes, templateContext, firmInfo } =
      params;

    // Sanitize all user-supplied free-text fields.
    const safeClientData = sanitizeClientData(clientData);

    const systemPrompt = buildDocGenerationSystemPrompt(
      templateContext,
      firmInfo,
    );

    const userPrompt = `Generate a complete, execution-ready "${docType}" document.

PACKAGE TYPE: ${packageType}
${trustTypes && trustTypes.length > 0 ? `TRUST TYPES: ${trustTypes.map(sanitizeForPrompt).join(', ')}` : ''}

CLIENT DATA:
${JSON.stringify(safeClientData, null, 2)}

Generate the full document now. Include all required NJ execution blocks,
signature lines, witness attestation clauses, and notary acknowledgment
as required by law for this document type.`;

    const response = await this.chatCompletion({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.15, // Low temperature for legal documents
      max_tokens: 8000,
      response_format: { type: 'json_object' },
    });

    const raw = response.choices[0]?.message.content ?? '';

    let parsed: { title: string; content: string; metadata: Record<string, unknown> };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      throw new Error(
        `AI returned invalid JSON for document generation. Raw response: ${raw.slice(0, 500)}`,
      );
    }

    return {
      title: parsed.title ?? `${docType} — ${safeClientData.personalInfo.lastName}`,
      content: parsed.content ?? '',
      docType,
      metadata: parsed.metadata ?? {},
    };
  }

  // -------------------------------------------------------------------------
  // reviewDocument
  // -------------------------------------------------------------------------

  async reviewDocument(params: DocumentReviewParams): Promise<DocumentReview> {
    const { documentHtml, docType, clientData, focusAreas } = params;

    const systemPrompt = `${NJ_STATUTORY_CONTEXT}

You are reviewing an estate planning document for NJ statutory compliance and
drafting quality. Return a JSON object matching this schema:
{
  "issues": [
    { "severity": "critical|major|minor|info", "location": "<section>", "description": "<text>", "suggestion": "<fix>" }
  ],
  "suggestions": ["<improvement>", ...],
  "complianceNotes": ["<NJ statute note>", ...],
  "overallAssessment": "<paragraph>"
}`;

    const safeClientData = sanitizeClientData(clientData);
    const safeHtml = sanitizeForPrompt(documentHtml);

    const focusSection =
      focusAreas && focusAreas.length > 0
        ? `\nFocus particularly on: ${focusAreas.map(sanitizeForPrompt).join(', ')}`
        : '';

    const userPrompt = `Review this "${docType}" document for NJ compliance.
${focusSection}

CLIENT CONTEXT:
${JSON.stringify(
  {
    hasSpouse: !!safeClientData.spouseInfo?.married,
    beneficiaryCount: safeClientData.beneficiaries.length,
    executorCount: safeClientData.executors.length,
    hasSpecialInstructions: !!safeClientData.specialInstructions,
  },
  null,
  2,
)}

DOCUMENT HTML:
${safeHtml}`;

    const response = await this.chatCompletion({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    });

    const raw = response.choices[0]?.message.content ?? '';

    let parsed: DocumentReview;
    try {
      parsed = JSON.parse(raw) as DocumentReview;
    } catch {
      throw new Error(
        `AI returned invalid JSON for document review. Raw: ${raw.slice(0, 500)}`,
      );
    }

    return parsed;
  }

  // -------------------------------------------------------------------------
  // generateSummary
  // -------------------------------------------------------------------------

  async generateSummary(params: SummaryParams): Promise<string> {
    const { documentHtml, docType, audience } = params;
    const safeHtml = sanitizeForPrompt(documentHtml);

    const audienceInstructions: Record<SummaryParams['audience'], string> = {
      client:
        'Write in plain English for a non-lawyer client. Avoid jargon. Use short paragraphs. Explain what the document does and what the client needs to do to execute it.',
      attorney:
        'Write a concise professional summary noting key provisions, potential issues, and any NJ-specific considerations.',
      paralegal:
        'List the key provisions, required execution steps, required witnesses/notarizations, and any follow-up tasks.',
    };

    const systemPrompt = `You are a New Jersey estate planning expert. Summarize estate planning documents accurately and helpfully.`;

    const userPrompt = `Summarize this "${docType}" document.
AUDIENCE: ${audience}
INSTRUCTIONS: ${audienceInstructions[audience]}

DOCUMENT:
${safeHtml}`;

    const response = await this.chatCompletion({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1500,
    });

    return response.choices[0]?.message.content ?? '';
  }

  // -------------------------------------------------------------------------
  // transcribeAudio
  // -------------------------------------------------------------------------

  async transcribeAudio(audioBlob: Blob): Promise<TranscriptionResult> {
    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.webm');
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'verbose_json');
    formData.append(
      'prompt',
      'This is a legal client intake recording for a New Jersey estate planning consultation.',
    );

    const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(
        `OpenAI Whisper API error ${response.status}: ${errorBody || response.statusText}`,
      );
    }

    const data = (await response.json()) as OpenAiTranscriptionResponse & {
      segments?: Array<{ start: number; end: number; text: string }>;
    };

    return {
      text: data.text,
      segments: data.segments?.map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // chat
  // -------------------------------------------------------------------------

  async chat(
    messages: ChatMessage[],
    systemPrompt?: string,
  ): Promise<string> {
    const builtMessages: Array<{ role: string; content: string }> = [];

    if (systemPrompt) {
      builtMessages.push({
        role: 'system',
        content: `${NJ_STATUTORY_CONTEXT}\n\n${sanitizeForPrompt(systemPrompt)}`,
      });
    } else {
      builtMessages.push({ role: 'system', content: NJ_STATUTORY_CONTEXT });
    }

    // Sanitize any user messages; pass assistant messages through as-is
    // (they were generated by us, not user-supplied).
    for (const msg of messages) {
      builtMessages.push({
        role: msg.role,
        content: msg.role === 'user' ? sanitizeForPrompt(msg.content) : msg.content,
      });
    }

    const response = await this.chatCompletion({
      model: this.model,
      messages: builtMessages,
      temperature: 0.4,
      max_tokens: 2000,
    });

    return response.choices[0]?.message.content ?? '';
  }
}

// ---------------------------------------------------------------------------
// AiService — singleton façade
// ---------------------------------------------------------------------------

/**
 * AiService is a singleton that delegates to whichever AiProvider was
 * registered at startup via AiService.initialize().
 *
 * @example
 * // main.tsx — run before any component renders:
 * AiService.initialize(new OpenAiProvider(import.meta.env.VITE_OPENAI_API_KEY));
 */
export class AiService {
  private static instance: AiService | null = null;
  private provider: AiProvider;

  private constructor(provider: AiProvider) {
    this.provider = provider;
  }

  /**
   * Register the AI provider and create the singleton.
   * Must be called before any call to getInstance().
   * Calling initialize() a second time replaces the provider.
   */
  static initialize(provider: AiProvider): void {
    if (AiService.instance) {
      // Allow hot-swapping the provider (e.g. during testing).
      AiService.instance.provider = provider;
    } else {
      AiService.instance = new AiService(provider);
    }
  }

  /**
   * Return the singleton AiService.
   * @throws if initialize() has not been called yet.
   */
  static getInstance(): AiService {
    if (!AiService.instance) {
      throw new Error(
        'AiService has not been initialized. ' +
          'Call AiService.initialize(provider) before using AiService.',
      );
    }
    return AiService.instance;
  }

  /** Replace the current provider without creating a new singleton. */
  setProvider(provider: AiProvider): void {
    this.provider = provider;
  }

  // Delegate all methods to the current provider.

  generateDocument(params: DocumentGenerationParams): Promise<GeneratedDocument> {
    return this.provider.generateDocument(params);
  }

  reviewDocument(params: DocumentReviewParams): Promise<DocumentReview> {
    return this.provider.reviewDocument(params);
  }

  generateSummary(params: SummaryParams): Promise<string> {
    return this.provider.generateSummary(params);
  }

  transcribeAudio(audioBlob: Blob): Promise<TranscriptionResult> {
    return this.provider.transcribeAudio(audioBlob);
  }

  chat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
    return this.provider.chat(messages, systemPrompt);
  }
}
