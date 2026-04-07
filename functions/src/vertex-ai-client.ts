/**
 * functions/src/vertex-ai-client.ts
 *
 * Client for Google Gen AI (Gemini) using the @google/genai SDK.
 * Specifically handles structured data extraction using JSON response schemas.
 *
 * API key is passed by the caller (fetched from the firm's Firestore geminiApiKey field)
 * rather than read from a global secret, so each firm uses its own key.
 */

import { GoogleGenAI } from '@google/genai';

/**
 * Call Google Gen AI (Gemini) to extract structured data from a prompt.
 *
 * @param modelName  The model ID to use (e.g. 'gemini-1.5-flash').
 * @param prompt     The instructions and context to process.
 * @param schema     The JSON Schema for the structured output.
 * @param apiKey     The Gemini API key (from the firm's Firestore geminiApiKey field).
 */
export async function callVertexAIStructured<T>(
  modelName: string,
  prompt: string,
  schema: Record<string, unknown>,
  apiKey: string,
): Promise<T> {
  if (!apiKey) {
    throw new Error('Gemini API key is required for structured AI extraction. Configure it in Firm Settings.');
  }

  // Map incoming modelName if it has 'vertexai/' prefix (old SDK artifacts)
  const modelId = modelName.includes('/') ? modelName.split('/').pop() || modelName : modelName;

  const client = new GoogleGenAI({ apiKey });

  try {
    const response = await client.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
      },
    });

    const responseText = response.text;
    if (!responseText) {
      throw new Error('Google Gen AI extraction failed: No response text returned');
    }

    const cleanText = responseText.replace(/^```json/, '').replace(/```$/, '').trim();

    try {
      return JSON.parse(cleanText) as T;
    } catch (_err) {
      console.error('Failed to parse Google Gen AI JSON response:', cleanText);
      throw new Error('Google Gen AI extraction failed: Invalid JSON response');
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`Error calling Google Gen AI (${modelId}):`, errorMessage);
    throw new Error(`Google Gen AI extraction failed: ${errorMessage}`);
  }
}

