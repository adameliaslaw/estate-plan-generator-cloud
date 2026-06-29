/**
 * functions/src/ai-client.ts
 * Server-side AI client for Cloud Functions.
 *
 * Separate from the frontend AiService — this module runs in Node.js and uses
 * the openai npm package directly rather than raw fetch calls.
 *
 * All free-text fields must be sanitized via sanitizeForPrompt() before being
 * embedded in prompts to prevent prompt-injection attacks.
 */

import OpenAI from 'openai';
import { Agent } from 'undici';

// Custom dispatcher with extended timeouts for long-running AI calls.
// Node's default fetch (undici) has a 300s headersTimeout, which kills large
// requests like 70k+ char templatizations before Anthropic finishes streaming
// the response. 10 minutes gives plenty of headroom while still protecting
// against truly hung requests.
const LONG_REQUEST_AGENT = new Agent({
  headersTimeout: 10 * 60 * 1000,
  bodyTimeout: 10 * 60 * 1000,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Minimal typed shapes for raw fetch-based AI provider responses.
// These match the stable fields actually used by this module.

interface AnthropicMessageResponse {
  content: Array<{ type: string; text: string }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  stop_reason?: string;
}

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

interface PerplexityChatCompletion {
  choices?: Array<{
    message?: { content?: string | null; role?: string };
    finish_reason?: string;
  }>;
  citations?: string[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface CallAIOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  /**
   * OpenAI Structured Outputs JSON Schema.
   * When provided (and the provider is OpenAI), the response is guaranteed
   * to conform to this schema — no parse recovery needed.
   * Pass the full schema object from document-schemas.ts.
   * For non-OpenAI providers, the schema is included in the system prompt.
   */
  jsonSchema?: { name: string; schema: Record<string, unknown>; strict?: boolean };
  /**
   * Gemini Google Search Grounding.
   * When true, Gemini will use Google Search to ground its responses
   * against real-time web data (statutory citations, current law, etc.).
   * Only applicable when provider is Gemini.
   */
  groundingEnabled?: boolean;
}

/** Subset of Firm data used by the AI client for provider selection and API keys. */
export interface FirmData {
  activeAiProvider?: string;
  openAiApiKey?: string;
  anthropicApiKey?: string;
  geminiApiKey?: string;
  perplexityApiKey?: string;
  documentDraftingModel?: string;
  chatbotModel?: string;
  settings?: {
    activeAiProvider?: string;
    openAiApiKey?: string;
    anthropicApiKey?: string;
    geminiApiKey?: string;
    perplexityApiKey?: string;
  };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Model name validation / allowlist
// ---------------------------------------------------------------------------

/** Known-good models per provider. If a model isn't in this list, we fall back. */
const KNOWN_MODELS: Record<string, Set<string>> = {
  openai: new Set([
    'gpt-4', 'gpt-4-turbo', 'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
    'gpt-4.5-preview', 'gpt-5', 'gpt-5-mini', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.5',
    'o1', 'o1-mini', 'o1-preview', 'o3', 'o3-mini', 'o4-mini',
  ]),
  anthropic: new Set([
    'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307',
    'claude-3.5-sonnet', 'claude-3.5-haiku', 'claude-3.7-sonnet',
    'claude-sonnet-4-6', 'claude-4-opus', 'claude-opus-4-6', 'claude-opus-4-8',
    'claude-haiku-4-5-20251001',
  ]),
  gemini: new Set([
    'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro',
    'gemini-1.5-flash', 'gemini-1.5-pro',
  ]),
  perplexity: new Set([
    'sonar', 'sonar-pro', 'sonar-reasoning', 'sonar-reasoning-pro',
  ]),
};

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-5.4',
  anthropic: 'claude-sonnet-4-6',
  gemini: 'gemini-2.5-flash',
  perplexity: 'sonar-pro',
};

/**
 * Validate a model name against the known allowlist for a provider.
 * If the model is unknown, logs a warning and returns the provider's default.
 */
export function validateAndResolveModel(model: string, provider: string): string {
  const allowlist = KNOWN_MODELS[provider];
  if (!allowlist) {
    console.warn(`[ai-client] Unknown provider "${provider}", using model as-is: ${model}`);
    return model;
  }
  if (allowlist.has(model)) {
    return model;
  }
  const fallback = DEFAULT_MODELS[provider] ?? model;
  console.warn(
    `[ai-client] Model "${model}" not in ${provider} allowlist. ` +
    `Falling back to "${fallback}". Update KNOWN_MODELS if this model is valid.`,
  );
  return fallback;
}

// ---------------------------------------------------------------------------
// Core callAI helper
// ---------------------------------------------------------------------------

/**
 * Send a single-turn chat completion to the configured AI provider and return the text content.
 *
 * @param systemPrompt  Role="system" message — sets the model's behaviour.
 * @param userPrompt    Role="user" message — the specific task.
 * @param firmData      The Firm object containing settings, `activeAiProvider`, and API keys.
 * @param options       Optional model/temperature/token overrides.
 */
export async function callAI(
  systemPrompt: string,
  userPrompt: string,
  firmData: FirmData,
  options: CallAIOptions = {},
): Promise<string> {
  let provider = firmData?.activeAiProvider ?? firmData?.settings?.activeAiProvider ?? 'openai';

  if (options.model) {
    const m = options.model.toLowerCase();
    if (m.startsWith('gemini')) provider = 'gemini';
    else if (m.startsWith('claude') || m.includes('opus') || m.includes('sonnet') || m.includes('haiku')) provider = 'anthropic';
    else if (m.startsWith('sonar')) provider = 'perplexity';
    else if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4') || m.startsWith('gpt-5')) provider = 'openai';
    else provider = 'openai';
  }

  // Validate the model name against the known allowlist for this provider
  if (options.model) {
    options = { ...options, model: validateAndResolveModel(options.model, provider) };
  }

  if (provider === 'anthropic') {
    try {
      return await _callAnthropic(systemPrompt, userPrompt, firmData, options);
    } catch (err) {
      // Detect Anthropic content-filter rejections / refusals and fall back to
      // OpenAI. POA and healthcare directive language commonly triggers Claude's
      // safety filter; real blocks surface as a refusal stop_reason or an empty
      // response, not only the literal "content filtering policy" string.
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      const isContentBlock = msg.includes('content filtering policy')
        || msg.includes('output blocked')
        || msg.includes('refusal')
        || msg.includes('no text content');
      if (isContentBlock) {
        console.warn(
          `[callAI] Anthropic blocked/empty output. Falling back to OpenAI. ` +
          `Error: ${msg.slice(0, 200)}`,
        );
        const openaiKey = firmData?.openAiApiKey ?? firmData?.settings?.openAiApiKey;
        if (openaiKey) {
          // model: undefined — the caller's model is an Anthropic id OpenAI
          // cannot use, so let OpenAI pick its default.
          return _callOpenAI(systemPrompt, userPrompt, firmData, {
            ...options,
            model: undefined,
          });
        }
      }
      throw err; // Re-throw if not a content-filter issue or no OpenAI key
    }
  } else if (provider === 'gemini') {
    return _callGemini(systemPrompt, userPrompt, firmData, options);
  } else if (provider === 'perplexity') {
    return _callPerplexity(systemPrompt, userPrompt, firmData, options);
  } else {
    // Default to OpenAI
    return _callOpenAI(systemPrompt, userPrompt, firmData, options);
  }
}

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
  let attempt = 0;
  while (true) {
    try {
      const response = await fetch(url, { ...options, dispatcher: LONG_REQUEST_AGENT } as unknown as RequestInit);
      // Retry on rate limits (429) and transient server errors (5xx) — the most
      // common recoverable failures on long-running AI calls.
      const retryable = response.status === 429 || (response.status >= 500 && response.status <= 599);
      if (!response.ok && retryable && attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        console.warn(`[callAI] Provider returned ${response.status}. Retrying in ${Math.round(waitTime)}ms...`);
        await new Promise(r => setTimeout(r, waitTime));
        attempt++;
        continue;
      }
      return response;
    } catch (err) {
      // Network-level failure (ECONNRESET, dropped connection, DNS, etc.).
      // fetch() rejects rather than returning a Response, so retry here too.
      if (attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        console.warn(`[callAI] Network error (${err instanceof Error ? err.message : String(err)}). Retrying in ${Math.round(waitTime)}ms...`);
        await new Promise(r => setTimeout(r, waitTime));
        attempt++;
        continue;
      }
      throw err;
    }
  }
}

async function _callOpenAI(
  systemPrompt: string,
  userPrompt: string,
  firmData: FirmData,
  options: CallAIOptions
): Promise<string> {
  // Use the firm's API key if provided, fallback to the environment variable
  const apiKey = firmData?.openAiApiKey ?? firmData?.settings?.openAiApiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OpenAI API key is missing. Configure it in Firm Settings.');
  }

  const client = new OpenAI({ apiKey });
  const model = options.model ?? 'gpt-5.4'; // Default OpenAI model — validated upstream in callAI
  const temperature = options.temperature ?? 0.2;
  const maxTokens = options.maxTokens ?? 128000;  // GPT-5.4 supports up to 128K output

  const requestParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature,
    // Newer OpenAI models (gpt-5.4, o1, o3, etc.) require max_completion_tokens
    // instead of the deprecated max_tokens parameter
    max_completion_tokens: maxTokens,
  };

  if (options.jsonSchema) {
    // Structured Outputs — guarantees valid JSON matching the schema
    requestParams.response_format = {
      type: 'json_schema',
      json_schema: {
        name: options.jsonSchema.name,
        schema: options.jsonSchema.schema,
        strict: options.jsonSchema.strict ?? true,
      },
    } as unknown as OpenAI.Chat.ChatCompletionCreateParams['response_format'];
  } else if (options.jsonMode) {
    requestParams.response_format = { type: 'json_object' };
  }

  const response = await client.chat.completions.create(requestParams);
  const finishReason = response.choices[0]?.finish_reason;
  if (finishReason === 'length') {
    const detail = `OpenAI response truncated (finish_reason=length, model=${model}, maxTokens=${maxTokens}).`;
    // In JSON modes a truncated response is invalid JSON downstream, so fail
    // loudly rather than returning half an object. Prose output may still be
    // usable, so only warn there.
    if (options.jsonMode || options.jsonSchema) {
      throw new Error(`${detail} Increase maxTokens.`);
    }
    console.warn(`[ai-client] ${detail} Consider increasing maxTokens.`);
  }
  return response.choices[0]?.message?.content ?? '';
}

async function _callAnthropic(
  systemPrompt: string,
  userPrompt: string,
  firmData: FirmData,
  options: CallAIOptions
): Promise<string> {
  const apiKey = firmData?.anthropicApiKey ?? firmData?.settings?.anthropicApiKey;
  if (!apiKey) {
    throw new Error('Anthropic API key is missing. Configure it in Firm Settings.');
  }

  const model = options.model ?? 'claude-sonnet-4-6';
  const temperature = options.temperature ?? 0.2;
  const maxTokens = options.maxTokens ?? 64000;  // Claude Sonnet 4 supports up to 64K output

  // If JSON mode is requested, explicitly instruct Claude to output ONLY JSON
  let finalSystemPrompt = systemPrompt;
  if (options.jsonSchema) {
    finalSystemPrompt += `\n\nIMPORTANT: You must output ONLY a valid JSON object conforming to this exact JSON Schema:\n${JSON.stringify(options.jsonSchema.schema, null, 2)}\n\nDo not include any markdown formatting, preamble, or conversational text. Start directly with { and end with }.`;
  } else if (options.jsonMode) {
    finalSystemPrompt += '\n\nIMPORTANT: You must output ONLY a valid JSON object. Do not include any markdown formatting, preamble, or conversational text. Start directly with { and end with }';
  }

  const response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      // Prompt caching: send system prompt as a content block array with
      // cache_control so Anthropic caches the system prompt prefix.
      // Subsequent calls within 5 minutes pay only 10% of input token cost
      // for cached content (~90% savings on system prompt tokens).
      system: [
        {
          type: 'text',
          text: finalSystemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        { role: 'user', content: userPrompt }
      ],
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json() as AnthropicMessageResponse;

  // Log prompt cache performance metrics
  if (data.usage) {
    const cacheRead = data.usage.cache_read_input_tokens ?? 0;
    const cacheWrite = data.usage.cache_creation_input_tokens ?? 0;
    if (cacheRead > 0 || cacheWrite > 0) {
      console.info(
        `[ai-client] Anthropic cache: read=${cacheRead} tokens, write=${cacheWrite} tokens` +
        ` (${cacheRead > 0 ? 'HIT' : 'MISS'})`,
      );
    }
  }

  // A refusal stop_reason means the safety filter blocked the output. Surface it
  // as a content-block error so callAI's OpenAI fallback engages instead of
  // returning '' to the generator.
  if (data.stop_reason === 'refusal') {
    throw new Error('Anthropic content filtering policy: output blocked (stop_reason=refusal)');
  }

  // Concatenate every text block — a response can carry multiple blocks or a
  // non-text block, so content[0].text is not reliable.
  const text = Array.isArray(data.content)
    ? data.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
    : '';

  if (!text.trim()) {
    // Empty output (refusal or otherwise) — treat as a content block so the
    // fallback engages rather than silently returning an empty document.
    throw new Error('Anthropic content filtering policy: empty response (no text content)');
  }

  // Truncated JSON is unusable downstream — fail loudly. (Not phrased as a
  // content-block error, so it does NOT trigger the OpenAI fallback, which
  // would likely truncate too.)
  if (data.stop_reason === 'max_tokens' && (options.jsonMode || options.jsonSchema)) {
    throw new Error(`Anthropic response truncated (stop_reason=max_tokens, max_tokens=${maxTokens}). Increase maxTokens.`);
  }

  return text;
}

async function _callGemini(
  systemPrompt: string,
  userPrompt: string,
  firmData: FirmData,
  options: CallAIOptions
): Promise<string> {
  const apiKey = firmData?.geminiApiKey ?? firmData?.settings?.geminiApiKey;
  if (!apiKey) {
    throw new Error('Gemini API key is missing. Configure it in Firm Settings.');
  }

  const model = options.model ?? 'gemini-2.5-flash';
  const temperature = options.temperature ?? 0.2;

  // Gemini requires system prompt to be passed inside 'system_instruction'
  // But standard system instruction text is expected. 

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const requestBody: Record<string, unknown> = {
    system_instruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }]
      }
    ],
    generationConfig: {
      temperature,
      maxOutputTokens: options.maxTokens ?? 65536,  // Gemini 2.5 Flash supports up to 65K output
    }
  };

  // Gemini rejects (HTTP 400) structured-output config (responseMimeType /
  // responseSchema) when the google_search grounding tool is enabled. When
  // grounding is on, rely on the system prompt to request JSON and parse the
  // response defensively (parseAIJson) instead.
  if (options.groundingEnabled) {
    (requestBody as Record<string, unknown>).tools = [
      { google_search: {} }
    ];
  } else if (options.jsonSchema) {
    (requestBody.generationConfig as Record<string, unknown>).responseMimeType = 'application/json';
    (requestBody.generationConfig as Record<string, unknown>).responseSchema = options.jsonSchema.schema;
  } else if (options.jsonMode) {
    (requestBody.generationConfig as Record<string, unknown>).responseMimeType = 'application/json';
  }

  const response = await fetchWithRetry(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json() as GeminiGenerateResponse;
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function _callPerplexity(
  systemPrompt: string,
  userPrompt: string,
  firmData: FirmData,
  options: CallAIOptions
): Promise<string> {
  const apiKey = firmData?.perplexityApiKey ?? firmData?.settings?.perplexityApiKey;
  if (!apiKey) {
    throw new Error('Perplexity API key is missing. Configure it in Firm Settings.');
  }

  const model = options.model ?? 'sonar-pro';
  const temperature = options.temperature ?? 0.2;

  const response = await fetchWithRetry('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature,
      max_tokens: options.maxTokens ?? 8000,  // Sonar Pro supports up to 8K output
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Perplexity API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json() as PerplexityChatCompletion;
  return data.choices?.[0]?.message?.content ?? '';
}

// ---------------------------------------------------------------------------
// Perplexity with citations (for Research mode)
// ---------------------------------------------------------------------------

export interface PerplexityCitedResponse {
  content: string;
  citations: string[];
}

/**
 * Strict allowlist for Research-mode web search — restricts Perplexity's
 * retrieval to primary/authoritative legal sources so it cannot surface
 * law-firm marketing/SEO pages. (Perplexity's search_domain_filter is hard
 * include-only; case law still comes separately from CourtListener.)
 */
const PERPLEXITY_RESEARCH_DOMAINS = [
  'law.cornell.edu', 'law.justia.com', 'courtlistener.com', 'govinfo.gov',
  'congress.gov', 'irs.gov', 'nj.gov', 'njcourts.gov',
];

/**
 * Call Perplexity API and return both the content AND source citations.
 * Used by the Research tab to provide grounded, cited answers.
 */
export async function callPerplexityWithCitations(
  systemPrompt: string,
  userPrompt: string,
  firmData: FirmData,
  options: CallAIOptions = {},
): Promise<PerplexityCitedResponse> {
  const apiKey = firmData?.perplexityApiKey ?? firmData?.settings?.perplexityApiKey;
  if (!apiKey) {
    throw new Error('Perplexity API key is missing. Configure it in Firm Settings → AI Configuration.');
  }

  const model = options.model ?? 'sonar-pro';
  const temperature = options.temperature ?? 0.2;

  const response = await fetchWithRetry('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature,
      // Restrict web retrieval to authoritative legal sources (no law-firm marketing).
      search_domain_filter: PERPLEXITY_RESEARCH_DOMAINS,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Perplexity API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json() as PerplexityChatCompletion;
  const content: string = data.choices?.[0]?.message?.content ?? '';
  const citations: string[] = Array.isArray(data.citations) ? data.citations : [];

  return { content, citations };
}

// ---------------------------------------------------------------------------
// Prompt-injection sanitizer
// ---------------------------------------------------------------------------

/**
 * Patterns that may indicate a prompt-injection attempt.
 * Sorted by severity; each entry is a regex that will be stripped.
 * This must be kept in sync with the frontend sanitize.ts version.
 */
const INJECTION_PATTERNS: RegExp[] = [
  // Role override markers
  /\b(system|user|assistant)\s*:\s*/gi,
  // Direct instructions to change behaviour
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|context)/gi,
  /forget\s+(everything|all|prior|previous)/gi,
  /\byou\s+are\s+now\b/gi,
  /\bact\s+as\b/gi,
  /\bpretend\s+(to\s+be|you\s+are)\b/gi,
  /\bnew\s+(instruction|role|persona|context|prompt)\b/gi,
  /\boverride\s+(your|all)?\s*(instructions?|rules?|constraints?)/gi,
  // Jailbreak keywords
  /\bdan\s+mode\b/gi,
  /\bjailbreak\b/gi,
  /\bdo\s+anything\s+now\b/gi,
  // Delimiters commonly used to inject synthetic messages
  /<<<|>>>/g,
  /---\s*(system|user|assistant)\s*---/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  // Template literal injection
  /\{\{[^}]*\}\}/g,
  // Null byte / control characters
  // eslint-disable-next-line no-control-regex
  /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
];

/**
 * Strip prompt-injection patterns from user-supplied free-text fields
 * before embedding them in AI prompts.
 *
 * - Applies all injection-stripping patterns (see INJECTION_PATTERNS)
 * - Strips role prefixes ("system:", "user:", "assistant:")
 * - Escapes backticks so the value can't break a markdown fence
 * - Hard-caps the string at `maxLength` characters at a word boundary
 *
 * `options.maxLength` defaults to 5,000 (the per-field cap). Pass a larger value
 * for already-aggregated content; pass `null` to disable the cap entirely.
 */
export function sanitizeForPrompt(
  text: string | undefined | null,
  options?: { maxLength?: number | null },
): string {
  if (!text) return '';

  const maxLength = options?.maxLength === undefined ? 5000 : options.maxLength;
  let result = text;

  // Apply all injection-stripping patterns.
  for (const pattern of INJECTION_PATTERNS) {
    result = result.replace(pattern, ' ');
  }

  // Escape backticks so the value can't break a markdown fence.
  result = result.replace(/`/g, "'");

  // Collapse runs of whitespace introduced by the stripping.
  result = result.replace(/\s{3,}/g, '  ').trim();

  // Hard length cap — do NOT silently truncate in the middle of a word;
  // find the last whitespace before the limit.
  if (maxLength !== null && result.length > maxLength) {
    const truncated = result.slice(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    result = (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + '…';
  }

  return result;
}

// ---------------------------------------------------------------------------
// Firestore-safe client data extractor
// ---------------------------------------------------------------------------

/**
 * Canonical pre-serialized prompt-context fields produced by
 * client-data-serializer. They are already field-level sanitized (and
 * length-capped per field) at build time, and the aggregated block routinely
 * exceeds the 5,000-char per-field cap. Re-applying that cap here silently
 * truncated the client-data block fed to every AI generator (audit finding AF),
 * dropping legal input. These keys still get injection-stripped (so the
 * serialization-failure path, where the value may be a raw client-supplied
 * string, stays safe) but are not length-capped to 5,000.
 */
const UNCAPPED_PROMPT_KEYS = new Set([
  '_serializedClientData',
  '_clientFullName',
  '_spouseFullName',
]);

/** Generous ceiling for aggregated prompt-context fields (bounds abuse without truncating real data). */
const AGGREGATED_FIELD_MAX = 100_000;

/**
 * Sanitize all free-text string values inside an arbitrary Firestore document
 * object. Recurses into nested objects and arrays.
 *
 * Use this on clientData and firmData before passing them into any prompt.
 */
export function sanitizeObject<T>(obj: T): T {
  if (typeof obj === 'string') {
    return sanitizeForPrompt(obj) as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject) as unknown as T;
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (UNCAPPED_PROMPT_KEYS.has(key) && typeof value === 'string') {
        // Already sanitized at serialization time — strip injection but keep full length.
        result[key] = sanitizeForPrompt(value, { maxLength: AGGREGATED_FIELD_MAX });
      } else {
        result[key] = sanitizeObject(value);
      }
    }
    return result as T;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Vision API — Gemini for OCR of scanned documents
// ---------------------------------------------------------------------------

/**
 * Send an image or PDF page to Gemini Vision API for OCR text extraction.
 *
 * @param imageBase64  Base64-encoded image or PDF page data.
 * @param mimeType     MIME type (e.g., 'image/png', 'image/jpeg', 'application/pdf').
 * @param prompt       Instructions for the model (what to extract).
 * @param firmData     Firm object with API keys.
 * @param options      Optional overrides.
 */
export async function callAIWithVision(
  imageBase64: string,
  mimeType: string,
  prompt: string,
  firmData: FirmData,
  options: CallAIOptions = {},
): Promise<string> {
  const apiKey = firmData?.geminiApiKey ?? firmData?.settings?.geminiApiKey;
  if (!apiKey) {
    throw new Error('Gemini API key is missing. Configure it in Firm Settings.');
  }

  const model = options.model ?? 'gemini-2.5-flash';
  const temperature = options.temperature ?? 0.1;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const requestBody: Record<string, unknown> = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType,
              data: imageBase64,
            },
          },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      temperature,
      maxOutputTokens: options.maxTokens ?? 8192,
    },
  };

  if (options.jsonMode) {
    (requestBody.generationConfig as Record<string, unknown>).responseMimeType = 'application/json';
  }

  const response = await fetchWithRetry(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[callAIWithVision] Gemini Vision error: ${response.status} - ${errorText}`);
    return ''; // Non-blocking — return empty on failure
  }

  const data = await response.json() as GeminiGenerateResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    console.error(
      `[callAIWithVision] Gemini returned no text. finishReason=${data.candidates?.[0]?.finishReason ?? 'none'} ` +
      `candidates=${data.candidates?.length ?? 0}`,
    );
  }
  return text ?? '';
}

// ---------------------------------------------------------------------------
// JSON response parser helper
// ---------------------------------------------------------------------------

/**
 * Parse a JSON string returned by the AI model.
 * Strips markdown code fences that the model may erroneously include.
 */
export function parseAIJson<T>(raw: string): T {
  let cleaned = raw.trim();

  // Strip ALL markdown code fences (handles CRLF, multiple passes, nested fences).
  // Some models wrap the entire response in ```json ... ```, sometimes with \r\n.
  let prev = '';
  while (prev !== cleaned) {
    prev = cleaned;
    // Strip leading fence (e.g. ```json\n, ```\r\n, ``` )
    cleaned = cleaned.replace(/^[ \t]*`{3,}(?:json)?[ \t]*[\r\n]+/i, '');
    // Strip trailing fence
    cleaned = cleaned.replace(/[\r\n]+[ \t]*`{3,}[ \t]*$/i, '');
    cleaned = cleaned.trim();
  }

  // If the result still doesn't start with { or [, try to extract JSON from the text.
  // This covers models that add preamble text before the JSON object.
  if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
    const jsonMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
      cleaned = jsonMatch[1];
    }
  }

  // Last resort: find the first { or [ in the raw text (handles prose + JSON mixed responses)
  if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
    const firstBrace = raw.indexOf('{');
    const firstBracket = raw.indexOf('[');
    const start = firstBrace === -1 ? firstBracket
      : firstBracket === -1 ? firstBrace
      : Math.min(firstBrace, firstBracket);
    if (start !== -1) {
      cleaned = raw.slice(start).trim();
    }
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch (_err) {
    // ── Truncated JSON recovery ──
    // When AI output exceeds maxTokens, JSON gets cut off mid-string.

    // Recovery path 1: Truncated document response (title + content)
    // The most common truncation case: a legal document with { title, content }
    // gets cut off mid-HTML in the content field.
    if (cleaned.includes('"title"') && cleaned.includes('"content"')) {
      try {
        const titleMatch = cleaned.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        const contentStart = cleaned.indexOf('"content"');
        if (titleMatch && contentStart >= 0) {
          // Find the start of the content string value
          const valueStart = cleaned.indexOf('"', contentStart + '"content"'.length);
          if (valueStart >= 0) {
            // Extract everything after the opening quote of the content value
            let contentValue = cleaned.slice(valueStart + 1);
            // Remove any trailing incomplete JSON (closing braces, commas, etc.)
            // Find the last properly closed HTML tag to truncate cleanly
            const lastClosingTag = contentValue.lastIndexOf('</div>');
            const lastClosingP = contentValue.lastIndexOf('</p>');
            const lastClosingH = contentValue.lastIndexOf('</h');
            const lastClosingTable = contentValue.lastIndexOf('</table>');
            const cutPoint = Math.max(lastClosingTag, lastClosingP, lastClosingH, lastClosingTable);
            if (cutPoint > 0) {
              // Find the end of the closing tag
              const tagEnd = contentValue.indexOf('>', cutPoint) + 1;
              if (tagEnd > 0) {
                contentValue = contentValue.slice(0, tagEnd);
              }
            } else {
              // No clean HTML cut point found — strip trailing incomplete escape/quote
              contentValue = contentValue.replace(/\\?"?[^"]*$/, '');
            }
            // Unescape JSON string escapes in the content
            contentValue = contentValue
              .replace(/\\n/g, '\n')
              .replace(/\\"/g, '"')
              .replace(/\\\\/g, '\\')
              .replace(/\\t/g, '\t');

            const title = titleMatch[1]
              .replace(/\\n/g, '\n')
              .replace(/\\"/g, '"')
              .replace(/\\\\/g, '\\');

            console.warn(
              `[parseAIJson] Recovered truncated document. Title: "${title.slice(0, 60)}", ` +
              `content length: ${contentValue.length} chars. The original response was likely ` +
              `truncated due to maxTokens limit.`,
            );

            const result: Record<string, unknown> = {
              title,
              content: contentValue,
              _truncated: true,
              metadata: {
                wordCount: 0,
                estimatedPages: 0,
                executionRequirements: [],
                witnessRequired: false,
                notarizationRequired: false,
              },
            };
            return result as T;
          }
        }
      } catch {
        // Recovery failed, fall through to other recovery paths
      }
    }

    // Recovery path 2: Truncated detectedVariables array
    if (cleaned.includes('"detectedVariables"')) {
      try {
        // Find the detectedVariables array start
        const arrStart = cleaned.indexOf('[', cleaned.indexOf('"detectedVariables"'));
        if (arrStart >= 0) {
          // Extract all complete JSON objects from the truncated array
          const completeObjects: unknown[] = [];
          const objectRegex = /\{[^{}]*"originalText"\s*:\s*"[^"]*"[^{}]*"suggestedVariable"\s*:\s*"[^"]*"[^{}]*\}/g;
          const arrContent = cleaned.slice(arrStart);
          let match: RegExpExecArray | null;
          while ((match = objectRegex.exec(arrContent)) !== null) {
            try {
              completeObjects.push(JSON.parse(match[0]));
            } catch {
              // Skip malformed objects
            }
          }

          if (completeObjects.length > 0) {
            console.log(`[parseAIJson] Recovered ${completeObjects.length} variables from truncated JSON`);
            // Try to extract other top-level fields
            const docTypeMatch = cleaned.match(/"suggestedDocType"\s*:\s*"([^"]*)"/);
            const summaryMatch = cleaned.match(/"documentSummary"\s*:\s*"([^"]*)"/);
            const tagsMatch = cleaned.match(/"suggestedTags"\s*:\s*\[([^\]]*)\]/);
            const result: Record<string, unknown> = {
              detectedVariables: completeObjects,
              suggestedDocType: docTypeMatch?.[1] ?? '',
              documentSummary: summaryMatch?.[1] ?? '',
              suggestedTags: tagsMatch ? tagsMatch[1].split(',').map(t => t.trim().replace(/"/g, '')).filter(Boolean) : [],
            };
            return result as T;
          }
        }
      } catch {
        // Recovery failed, fall through to throw
      }
    }

    throw new Error(
      `Failed to parse AI JSON response: ${(_err as Error).message}. ` +
      `Raw (first 500 chars): ${raw.slice(0, 500)}`,
    );
  }
}
