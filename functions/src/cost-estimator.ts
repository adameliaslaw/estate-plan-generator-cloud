/**
 * functions/src/cost-estimator.ts
 *
 * Pre-generation cost estimator — provides attorneys with a cost estimate
 * before committing to an AI generation call.
 *
 * Estimation strategy:
 *  1. Input tokens: calculated from system prompt size + serialized client data
 *     (~4 characters ≈ 1 token, conservative)
 *  2. Output tokens: empirical per-doc-type averages from production runs
 *  3. Model pricing: per-provider rate cards (updated manually as pricing changes)
 */

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { FirmData } from './ai-client';
import { validateAndResolveModel } from './ai-client';

// ---------------------------------------------------------------------------
// Pricing per 1M tokens (USD) — updated March 2026
// ---------------------------------------------------------------------------

interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  label: string;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-5.4':       { inputPer1M: 2.00,  outputPer1M: 8.00,  label: 'GPT-5.4' },
  'gpt-5.4-nano':  { inputPer1M: 0.20,  outputPer1M: 1.25,  label: 'GPT-5.4 Nano' },
  'gpt-5':         { inputPer1M: 2.00,  outputPer1M: 8.00,  label: 'GPT-5' },
  'gpt-5-mini':    { inputPer1M: 0.40,  outputPer1M: 1.60,  label: 'GPT-5 Mini' },
  'gpt-4.1':       { inputPer1M: 2.00,  outputPer1M: 8.00,  label: 'GPT-4.1' },
  'gpt-4.1-mini':  { inputPer1M: 0.40,  outputPer1M: 1.60,  label: 'GPT-4.1 Mini' },
  'gpt-4o':        { inputPer1M: 2.50,  outputPer1M: 10.00, label: 'GPT-4o' },
  'o3':            { inputPer1M: 10.00, outputPer1M: 40.00, label: 'o3' },
  'o3-mini':       { inputPer1M: 1.10,  outputPer1M: 4.40,  label: 'o3-mini' },
  'o4-mini':       { inputPer1M: 1.10,  outputPer1M: 4.40,  label: 'o4-mini' },

  // Anthropic
  'claude-sonnet-4-6': { inputPer1M: 3.00,  outputPer1M: 15.00, label: 'Claude Sonnet 4' },
  'claude-opus-4-8':   { inputPer1M: 5.00,  outputPer1M: 25.00, label: 'Claude Opus 4.8' },
  'claude-4-opus':     { inputPer1M: 15.00, outputPer1M: 75.00, label: 'Claude 4 Opus' },
  'claude-3.7-sonnet': { inputPer1M: 3.00,  outputPer1M: 15.00, label: 'Claude 3.7 Sonnet' },
  'claude-3.5-sonnet': { inputPer1M: 3.00,  outputPer1M: 15.00, label: 'Claude 3.5 Sonnet' },

  // Gemini
  'gemini-2.5-flash': { inputPer1M: 0.15,  outputPer1M: 0.60,  label: 'Gemini 2.5 Flash' },
  'gemini-2.5-pro':   { inputPer1M: 1.25,  outputPer1M: 10.00, label: 'Gemini 2.5 Pro' },
  'gemini-2.0-flash': { inputPer1M: 0.10,  outputPer1M: 0.40,  label: 'Gemini 2.0 Flash' },

  // Perplexity
  'sonar-pro':           { inputPer1M: 3.00, outputPer1M: 15.00, label: 'Sonar Pro' },
  'sonar':               { inputPer1M: 1.00, outputPer1M: 1.00,  label: 'Sonar' },
  'sonar-reasoning-pro': { inputPer1M: 3.00, outputPer1M: 15.00, label: 'Sonar Reasoning Pro' },
};

// ---------------------------------------------------------------------------
// Empirical output token estimates per doc type (from production averages)
// ---------------------------------------------------------------------------

const ESTIMATED_OUTPUT_TOKENS: Record<string, number> = {
  // Standard generators
  will:                    4000,
  pourOverWill:            3500,
  poa:                     3500,
  livingWill:              3000,
  trust:                   8000,
  deed:                    2500,
  affidavitOfConsideration: 1500,
  gitRep3:                 1200,
  estatePlanSummary:       3500,
  // Flex generators
  engagementLetter:        2000,
  coverLetter:             1000,
  invoice:                 800,
  certificationOfTrust:    2000,
  beneficiaryDesignation:  1200,
  trustAmendment:          3000,
  trustRestatement:        5000,
  petTrust:                2500,
  letterOfInstruction:     2000,
  memorandumOfPersonalProp: 1500,
  codicil:                 2000,
  hipaaRelease:            1200,
  custom:                  3000,
};

/** Default output estimate when doc type isn't in the lookup */
const DEFAULT_OUTPUT_TOKENS = 3000;

// ---------------------------------------------------------------------------
// Estimation logic
// ---------------------------------------------------------------------------

interface CostEstimate {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
  estimatedCostUsd: number;
  model: string;
  modelLabel: string;
  provider: string;
  /** Per-document breakdown (for batch estimates) */
  perDocument?: Array<{
    docType: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
}

/**
 * Estimate the number of input tokens from a character count.
 * Conservative: ~4 chars per token for English text (OpenAI tiktoken average).
 */
function charsToTokens(charCount: number): number {
  return Math.ceil(charCount / 4);
}

/**
 * Estimate the base input token count for a given doc type.
 * This includes system prompt (~2K tokens) + client context (~3K tokens).
 */
function estimateInputTokens(docType: string, clientDataCharCount: number): number {
  // System prompt: ~2000 tokens for standard generators, ~1000 for flex
  const systemPromptTokens = ['engagementLetter', 'coverLetter', 'invoice',
    'certificationOfTrust', 'beneficiaryDesignation', 'trustAmendment',
    'trustRestatement', 'petTrust', 'letterOfInstruction',
    'memorandumOfPersonalProp', 'codicil', 'hipaaRelease', 'custom',
  ].includes(docType) ? 1000 : 2000;

  // Client data tokens from actual serialized size
  const clientDataTokens = charsToTokens(clientDataCharCount);

  // KB/template context: ~500 tokens average
  const contextTokens = 500;

  return systemPromptTokens + clientDataTokens + contextTokens;
}

/**
 * Resolve which model and provider would be used for a given firm + doc type.
 */
function resolveModel(firmData: FirmData, modelOverride?: string): { model: string; provider: string } {
  let provider = firmData?.activeAiProvider ?? firmData?.settings?.activeAiProvider ?? 'openai';
  let model = modelOverride ?? firmData?.documentDraftingModel ?? 'gpt-5.4';

  const m = model.toLowerCase();
  if (m.startsWith('gemini')) provider = 'gemini';
  else if (m.startsWith('claude') || m.includes('sonnet') || m.includes('opus')) provider = 'anthropic';
  else if (m.startsWith('sonar')) provider = 'perplexity';
  else provider = 'openai';

  model = validateAndResolveModel(model, provider);
  return { model, provider };
}

/**
 * Calculate cost in USD from token counts and model pricing.
 */
function calculateCost(inputTokens: number, outputTokens: number, pricing: ModelPricing): number {
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
  return Math.round((inputCost + outputCost) * 10000) / 10000; // 4 decimal places
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

interface EstimateRequest {
  firmId: string;
  clientId: string;
  /** Single doc type or array for batch estimate */
  docTypes: string[];
  /** Optional model override */
  modelOverride?: string;
}

export const estimateGenerationCost = functions
  .region('us-east1')
  .https.onCall(
    async (data: EstimateRequest, context: functions.https.CallableContext) => {
      if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
      }

      const { firmId, clientId, docTypes, modelOverride } = data;
      if (!firmId || !clientId || !docTypes?.length) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'firmId, clientId, and docTypes are required.',
        );
      }

      if ((context.auth.token.firmId as string | undefined) !== firmId) {
        throw new functions.https.HttpsError('permission-denied', 'Cannot estimate costs for a different firm.');
      }

      const db = admin.firestore();

      // Fetch firm and client data (lightweight — only what we need for estimation)
      const [firmSnap, clientSnap] = await Promise.all([
        db.doc(`firms/${firmId}`).get(),
        db.doc(`firms/${firmId}/clients/${clientId}`).get(),
      ]);

      if (!firmSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Firm not found.');
      }
      const firmData = firmSnap.data() as FirmData;

      // Estimate client data serialized size
      const clientDataCharCount = clientSnap.exists
        ? JSON.stringify(clientSnap.data()).length
        : 2000; // conservative default

      // Resolve model and pricing
      const { model, provider } = resolveModel(firmData, modelOverride);
      const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['gpt-5.4'];
      const modelLabel = pricing.label;

      // Calculate per-document estimates
      const perDocument = docTypes.map((docType) => {
        const inputTokens = estimateInputTokens(docType, clientDataCharCount);
        const outputTokens = ESTIMATED_OUTPUT_TOKENS[docType] ?? DEFAULT_OUTPUT_TOKENS;
        const costUsd = calculateCost(inputTokens, outputTokens, pricing);
        return { docType, inputTokens, outputTokens, costUsd };
      });

      // Aggregate totals
      const totalInput = perDocument.reduce((sum, d) => sum + d.inputTokens, 0);
      const totalOutput = perDocument.reduce((sum, d) => sum + d.outputTokens, 0);
      const totalCost = perDocument.reduce((sum, d) => sum + d.costUsd, 0);

      const estimate: CostEstimate = {
        estimatedInputTokens: totalInput,
        estimatedOutputTokens: totalOutput,
        estimatedTotalTokens: totalInput + totalOutput,
        estimatedCostUsd: Math.round(totalCost * 10000) / 10000,
        model,
        modelLabel,
        provider,
        perDocument: docTypes.length > 1 ? perDocument : undefined,
      };

      return estimate;
    },
  );
