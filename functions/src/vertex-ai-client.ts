/**
 * functions/src/vertex-ai-client.ts
 *
 * Client for Google Gen AI (Gemini) using the @google/genai SDK.
 * Specifically handles structured data extraction using JSON response schemas.
 */

import { GoogleGenAI } from '@google/genai';

// Initialize the Gen AI client using the API key secret.
// VERTEX_AI_KEY must be set in Firebase Secret Management.
const apiKey = process.env.VERTEX_AI_KEY;

// Fail early if no API key is provided
if (!apiKey) {
  console.warn('VERTEX_AI_KEY is not set in environment or secret management');
}

const client = new GoogleGenAI({
  apiKey: apiKey || '',
});

/**
 * Call Google Gen AI (Gemini) to extract structured data from a prompt.
 *
 * @param modelName  The model ID to use (e.g. 'gemini-1.5-flash').
 * @param prompt     The instructions and context to process.
 * @param schema     The JSON Schema for the structured output.
 */
export async function callVertexAIStructured<T>(
  modelName: string,
  prompt: string,
  schema: Record<string, unknown>,
): Promise<T> {
  if (!apiKey) {
    throw new Error('VERTEX_AI_KEY is required for structured AI extraction');
  }

  // Map incoming modelName if it has 'vertexai/' prefix (old SDK artifacts)
  const modelId = modelName.includes('/') ? modelName.split('/').pop() || modelName : modelName;

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

    // The SDK often returns JSON within markdown backticks if not perfectly parsed,
    // though structured output mode usually prevents this.
    // We clean it just in case.
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
