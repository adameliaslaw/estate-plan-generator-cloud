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
// Singleton OpenAI client
// ---------------------------------------------------------------------------

let _client: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY environment variable is not set. ' +
        'Configure it in Firebase Functions config or Secret Manager.',
      );
    }
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Core callAI helper
// ---------------------------------------------------------------------------

export interface CallAIOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** When true, instructs the model to respond with a JSON object. */
  jsonMode?: boolean;
}

/**
 * Send a single-turn chat completion to OpenAI and return the text content.
 *
 * @param systemPrompt  Role="system" message — sets the model's behaviour.
 * @param userPrompt    Role="user" message — the specific task.
 * @param options       Optional model/temperature/token overrides.
 */
export async function callAI(
  systemPrompt: string,
  userPrompt: string,
  options: CallAIOptions = {},
): Promise<string> {
  const client = getOpenAIClient();

  const model = options.model ?? 'gpt-4.1';
  const temperature = options.temperature ?? 0.2; // Low for legal accuracy
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

// ---------------------------------------------------------------------------
// Prompt-injection sanitizer
// ---------------------------------------------------------------------------

/**
 * Strip prompt-injection patterns from user-supplied free-text fields
 * before embedding them in AI prompts.
 *
 * - Removes triple-backtick fences (common injection vector)
 * - Strips role prefixes ("system:", "user:", "assistant:")
 * - Removes "ignore previous instructions" / "forget previous" phrases
 * - Hard-caps the string at 5,000 characters
 */
export function sanitizeForPrompt(text: string | undefined | null): string {
  if (!text) return '';

  return text
    .replace(/```/g, '')
    .replace(/\bsystem\b\s*:/gi, '[system]')
    .replace(/\bassistant\b\s*:/gi, '[assistant]')
    .replace(/\buser\b\s*:/gi, '[user]')
    .replace(/\bignore\b.{0,50}\binstructions\b/gi, '[removed]')
    .replace(/\bforget\b.{0,50}\bprevious\b/gi, '[removed]')
    .replace(/\bdisregard\b.{0,50}\babove\b/gi, '[removed]')
    .replace(/\bact\s+as\b/gi, '[removed]')
    .slice(0, 5000);
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
