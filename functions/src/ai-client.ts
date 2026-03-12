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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CallAIOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
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
    else if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) provider = 'openai';
    else provider = 'openai';
  }

  if (provider === 'anthropic') {
    return _callAnthropic(systemPrompt, userPrompt, firmData, options);
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
    const response = await fetch(url, options);
    if (!response.ok && response.status === 429 && attempt < maxRetries) {
      const waitTime = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
      console.warn(`[callAI] Rate limited (429). Retrying in ${Math.round(waitTime)}ms...`);
      await new Promise(r => setTimeout(r, waitTime));
      attempt++;
      continue;
    }
    return response;
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
  const model = options.model ?? 'gpt-4.1'; // Updated default model
  const temperature = options.temperature ?? 0.2;
  const maxTokens = options.maxTokens ?? 8192;

  const requestParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature,
    max_tokens: maxTokens,
  };

  if (options.jsonMode) {
    requestParams.response_format = { type: 'json_object' };
  }

  const response = await client.chat.completions.create(requestParams);
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

  const model = options.model ?? 'claude-sonnet-4-20250514';
  const temperature = options.temperature ?? 0.2;
  const maxTokens = options.maxTokens ?? 8192;

  // If JSON mode is requested, explicitly instruct Claude to output ONLY JSON
  let finalSystemPrompt = systemPrompt;
  if (options.jsonMode) {
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
      system: finalSystemPrompt,
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await response.json() as any;
  return data.content[0]?.text ?? '';
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
    }
  };

  if (options.jsonMode) {
    (requestBody.generationConfig as Record<string, unknown>).responseMimeType = "application/json";
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await response.json() as any;
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
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Perplexity API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content ?? '';
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
 * - Hard-caps the string at 5,000 characters at a word boundary
 */
export function sanitizeForPrompt(text: string | undefined | null): string {
  if (!text) return '';

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
  if (result.length > 5000) {
    const truncated = result.slice(0, 5000);
    const lastSpace = truncated.lastIndexOf(' ');
    result = (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + '…';
  }

  return result;
}

// ---------------------------------------------------------------------------
// Firestore-safe client data extractor
// ---------------------------------------------------------------------------

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
      result[key] = sanitizeObject(value);
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await response.json() as any;
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

// ---------------------------------------------------------------------------
// JSON response parser helper
// ---------------------------------------------------------------------------

/**
 * Parse a JSON string returned by the AI model.
 * Strips markdown code fences that the model may erroneously include.
 */
export function parseAIJson<T>(raw: string): T {
  // Strip ```json ... ``` wrappers
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    throw new Error(
      `Failed to parse AI JSON response: ${(err as Error).message}. ` +
      `Raw (first 500 chars): ${raw.slice(0, 500)}`,
    );
  }
}
