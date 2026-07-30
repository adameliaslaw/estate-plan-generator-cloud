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
  /**
   * Drive folder ids of the curated clause library (AAA WILL PIECES, Trust
   * Agreements). Everything under them is manifested to the SEED collection
   * and excluded from the corpus — §11 P1 gold set, and the structural
   * precondition for Gate 4's canary.
   */
  seedFolderIds: string[];
  /**
   * Subset of the seed folders held out as the Gate 4 canary (the Trust
   * Agreements boilerplate). Excluded from corpus input like all seed
   * folders; the pipeline must re-derive their clauses from client documents
   * alone. Ids listed here must also appear in seedFolderIds.
   */
  canaryFolderIds: string[];
  /**
   * Folder NAMES the preflight searches for (§11 P0.1). Names rather than ids
   * on purpose: the preflight exists to discover the ids.
   */
  seedFolderNames: string[];
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
  const seedFolderIds = idList(process.env.CLAUSE_MINER_SEED_FOLDER_IDS);
  const canaryFolderIds = idList(process.env.CLAUSE_MINER_CANARY_FOLDER_IDS);
  // A canary folder that is not a seed folder would be walked into the corpus
  // — the exact leak Gate 4 exists to rule out. Fail loudly at startup.
  const stray = canaryFolderIds.filter((id) => !seedFolderIds.includes(id));
  if (stray.length > 0) {
    throw new Error(
      `CLAUSE_MINER_CANARY_FOLDER_IDS must be a subset of CLAUSE_MINER_SEED_FOLDER_IDS; ` +
        `not listed as seed folders: ${stray.join(', ')}`,
    );
  }

  return {
    firmId: required('FIRM_ID'),
    runId: required('RUN_ID'),
    rootFolderId: required('CLAUSE_MINER_ROOT_FOLDER_ID'),
    gcsBucket: required('GCS_BUCKET'),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    sampleLimit,
    seedFolderIds,
    canaryFolderIds,
    seedFolderNames: nameList(process.env.CLAUSE_MINER_SEED_FOLDER_NAMES),
  };
}

/** Comma-separated folder NAMES (names may contain spaces, so only commas split). */
export function nameList(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Comma/whitespace-separated Drive folder id list; empty when unset. */
export function idList(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** LLM stages fail fast without the key rather than mid-batch. */
export function requireAnthropicKey(env: Env): string {
  if (env.anthropicApiKey === undefined || env.anthropicApiKey === '') {
    throw new Error('ANTHROPIC_API_KEY is required for LLM stages (Cloud Run secret mount)');
  }
  return env.anthropicApiKey;
}
