/**
 * Cloud Run Job entrypoint — stage dispatcher.
 *
 * The Job is executed once per stage; the stage is selected by the STAGE env
 * var (docs/CLAUSE-MINING-PIPELINE.md §3). Every stage is currently a stub:
 * this first slice ships the deterministic core (src/core/ — pure functions,
 * no GCP, no network) plus the package/deploy scaffolding. GCP-dependent
 * stage implementations (Drive BFS, LibreOffice conversion, Batches API
 * calls, Firestore checkpointing) are later slices.
 */

const STAGES = [
  'manifest', // Stage 0 — Drive BFS + sniff-everything filter (§3 Stage 0)
  'convert', // Stage 1 — LibreOffice headless convert + GCS cache (§8)
  'triage', // Stage 2 — haiku triage classify via Batches API (§3 Stage 2)
  'extract', // Stage 3 — facts + gazetteer (§3 Stage 3)
  'segment', // Stage 4 — reflow + segment (§4.1–4.2; core: reflow.ts/segment.ts)
  'identity', // Stage 6 — rings 0/1/2 + adjudication (§4.3; core: minhash.ts/diff.ts)
  'canonicalize', // Stage 7 — canonicalize + label + fill contract (§6)
  'stats', // Stage 8 — contingency tables + trigger cards (§7)
  'catalog', // Stage 9 — catalog write + union template assembly (§6.4, §9)
] as const;

type Stage = (typeof STAGES)[number];

function notImplemented(stage: Stage): () => Promise<void> {
  return async () => {
    throw new Error(
      `clause-miner stage '${stage}' not implemented (deterministic core only in this slice)`,
    );
  };
}

const handlers: Record<Stage, () => Promise<void>> = {
  manifest: notImplemented('manifest'),
  convert: notImplemented('convert'),
  triage: notImplemented('triage'),
  extract: notImplemented('extract'),
  segment: notImplemented('segment'),
  identity: notImplemented('identity'),
  canonicalize: notImplemented('canonicalize'),
  stats: notImplemented('stats'),
  catalog: notImplemented('catalog'),
};

function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}

async function main(): Promise<void> {
  const stage = process.env.STAGE;
  if (stage === undefined || stage === '' || !isStage(stage)) {
    console.error(
      `STAGE env var must be one of: ${STAGES.join('|')} (got ${JSON.stringify(stage)})`,
    );
    process.exit(2);
  }
  console.log(`clause-miner: dispatching stage '${stage}'`);
  await handlers[stage]();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
