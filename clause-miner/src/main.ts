/**
 * Cloud Run Job entrypoint — stage dispatcher.
 *
 * The Job is executed once per stage; the stage is selected by the STAGE env
 * var (docs/CLAUSE-MINING-PIPELINE.md §3). Every stage checkpoints per-file
 * to Firestore so any crash resumes (§3). See README.md for the runbook:
 * env vars, stage order, resume semantics, spend breaker, and kill switch.
 */

import Anthropic from '@anthropic-ai/sdk';
import { loadEnv, requireAnthropicKey, type Env } from './env.js';
import { runLedgerPath, CONTROL_DOC } from './paths.js';
import {
  AnthropicBatchClient,
  KillSwitchError,
  type AnthropicLike,
} from './anthropic-batch.js';
import {
  ChildProcessShellRunner,
  FirestoreDocStore,
  GcsBlobStore,
  GoogleDriveClient,
  VertexEmbeddingClient,
} from './clients/gcp.js';
import { runManifest } from './stages/manifest.js';
import { runConvert } from './stages/convert.js';
import { runTriage } from './stages/triage.js';
import { runExtract } from './stages/extract.js';
import { runSegmentNormalize } from './stages/segment-normalize.js';
import { runIdentity } from './stages/identity.js';
import { runCanonicalize } from './stages/canonicalize.js';
import { runStats } from './stages/stats.js';
import { runCatalog, assembleUnionTemplate } from './stages/catalog.js';
import type { BatchClient, DocStore } from './clients/interfaces.js';

const STAGES = [
  'manifest', // Stage 0 — Drive BFS + sniff-everything filter (§3 Stage 0)
  'convert', // Stage 1 — LibreOffice headless convert + GCS cache (§8)
  'triage', // Stage 2 — haiku triage classify via Batches API (§3 Stage 2)
  'extract', // Stage 3 — facts + gazetteer (§3 Stage 3)
  'segment', // Stages 4-5 — reflow + segment + normalize (§4.1-4.2, §5)
  'identity', // Stage 6 — rings 0/1/2 + adjudication (§4.3)
  'canonicalize', // Stage 7 — canonicalize + label + fill contract + PII gates (§6)
  'stats', // Stage 8 — contingency tables + trigger cards (§7)
  'catalog', // Stage 9 — catalog write (§9); union template is checkpoint-2
  'template', // Stage 9b — union template assembly (checkpoint-2 stub)
] as const;

type Stage = (typeof STAGES)[number];

function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}

async function assertKillSwitchOpen(store: DocStore): Promise<void> {
  const control = await store.get(CONTROL_DOC);
  if (control?.enabled === false) {
    throw new KillSwitchError('clause_mining_state/control.enabled=false — kill switch active');
  }
}

function makeBatchClient(env: Env, store: DocStore): BatchClient {
  const anthropic = new Anthropic({
    apiKey: requireAnthropicKey(env),
  }) as unknown as AnthropicLike;
  return new AnthropicBatchClient(anthropic, store, runLedgerPath(env.firmId, env.runId));
}

async function main(): Promise<void> {
  const stage = process.env.STAGE;
  if (stage === undefined || stage === '' || !isStage(stage)) {
    console.error(
      `STAGE env var must be one of: ${STAGES.join('|')} (got ${JSON.stringify(stage)})`,
    );
    process.exit(2);
  }

  const env = loadEnv();
  const store = new FirestoreDocStore();
  const blobs = new GcsBlobStore(env.gcsBucket);
  await assertKillSwitchOpen(store);

  console.log(
    `clause-miner: stage '${stage}' firm=${env.firmId} run=${env.runId}` +
      (env.sampleLimit !== undefined ? ` SAMPLE_LIMIT=${env.sampleLimit}` : ''),
  );

  switch (stage) {
    case 'manifest': {
      const summary = await runManifest({ drive: new GoogleDriveClient(), store }, env);
      console.log('manifest:', JSON.stringify(summary));
      break;
    }
    case 'convert': {
      const summary = await runConvert(
        { drive: new GoogleDriveClient(), store, blobs, shell: new ChildProcessShellRunner() },
        env,
      );
      console.log('convert:', JSON.stringify(summary));
      break;
    }
    case 'triage': {
      const summary = await runTriage({ store, blobs, batches: makeBatchClient(env, store) }, env);
      console.log('triage:', JSON.stringify(summary));
      break;
    }
    case 'extract': {
      const summary = await runExtract({ store, blobs, batches: makeBatchClient(env, store) }, env);
      console.log('extract:', JSON.stringify(summary));
      break;
    }
    case 'segment': {
      const summary = await runSegmentNormalize(
        { store, blobs, batches: makeBatchClient(env, store) },
        env,
      );
      console.log('segment:', JSON.stringify(summary));
      break;
    }
    case 'identity': {
      const summary = await runIdentity(
        {
          store,
          blobs,
          batches: makeBatchClient(env, store),
          embeddings: new VertexEmbeddingClient(),
        },
        env,
      );
      console.log('identity:', JSON.stringify(summary));
      break;
    }
    case 'canonicalize': {
      const summary = await runCanonicalize(
        { store, blobs, batches: makeBatchClient(env, store) },
        env,
      );
      console.log('canonicalize:', JSON.stringify(summary));
      break;
    }
    case 'stats': {
      const summary = await runStats({ store, blobs, batches: makeBatchClient(env, store) }, env);
      console.log('stats:', JSON.stringify(summary));
      break;
    }
    case 'catalog': {
      const summary = await runCatalog(
        { store, blobs, embeddings: new VertexEmbeddingClient() },
        env,
      );
      console.log('catalog:', JSON.stringify(summary));
      break;
    }
    case 'template': {
      assembleUnionTemplate();
      break;
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
