/**
 * Environment contract for the Cloud Run Job (see README.md runbook).
 *
 * - CLAUSE_MINER_ROOT_FOLDER_ID — Drive root of the "Wills and Trusts" tree.
 *   This should match the wills-backfill root pinned at
 *   functions/src/wills-backfill.ts:23 (DRIVE_ROOT_FOLDER_ID) so both
 *   pipelines walk the same corpus with the same drive.readonly grant.
 * - FIRM_ID / RUN_ID — Firestore scoping: firms/{firmId}/clauseMining/{runId}.
 * - GCS_BUCKET — bucket holding converted/text/segment artifacts.
 * - ANTHROPIC_API_KEY — mounted as a Cloud Run secret (never in the image).
 * - STAGE — which stage to run (dispatched by src/main.ts).
 * - SAMPLE_LIMIT — optional calibration-sample mode: limits the manifest to
 *   N stratified files (§4.4).
 */

export interface Env {
  firmId: string;
  runId: string;
  rootFolderId: string;
  gcsBucket: string;
  anthropicApiKey: string | undefined;
  sampleLimit: number | undefined;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function loadEnv(): Env {
  const sampleLimitRaw = process.env.SAMPLE_LIMIT;
  let sampleLimit: number | undefined;
  if (sampleLimitRaw !== undefined && sampleLimitRaw !== '') {
    sampleLimit = Number(sampleLimitRaw);
    if (!Number.isInteger(sampleLimit) || sampleLimit <= 0) {
      throw new Error(`SAMPLE_LIMIT must be a positive integer, got ${sampleLimitRaw}`);
    }
  }
  return {
    firmId: required('FIRM_ID'),
    runId: required('RUN_ID'),
    rootFolderId: required('CLAUSE_MINER_ROOT_FOLDER_ID'),
    gcsBucket: required('GCS_BUCKET'),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    sampleLimit,
  };
}

/** LLM stages fail fast without the key rather than mid-batch. */
export function requireAnthropicKey(env: Env): string {
  if (env.anthropicApiKey === undefined || env.anthropicApiKey === '') {
    throw new Error('ANTHROPIC_API_KEY is required for LLM stages (Cloud Run secret mount)');
  }
  return env.anthropicApiKey;
}
