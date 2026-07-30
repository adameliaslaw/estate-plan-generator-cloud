# clause-miner — corpus clause-mining Cloud Run Job

Implementation of the cloud/LLM stages of the clause-mining pipeline.
**Design of record: `docs/CLAUSE-MINING-PIPELINE.md`** — section references
below (§n) point there. Deterministic core lives in `src/core/` (pure, no
GCP); stage orchestration in `src/stages/`; every GCP/Anthropic touchpoint is
behind the narrow interfaces in `src/clients/interfaces.ts` so the unit suite
runs with in-memory fakes and zero network.

## Environment variables

| Var | Required | Purpose |
|---|---|---|
| `STAGE` | yes | Which stage to run (see stage order below). |
| `FIRM_ID` | yes | Firestore scope: `firms/{FIRM_ID}/clauseMining/{RUN_ID}`. |
| `RUN_ID` | yes | Run ledger id. Reusing a RUN_ID resumes that run. |
| `CLAUSE_MINER_ROOT_FOLDER_ID` | yes | Drive root of the "Wills and Trusts" tree. **Must match the wills-backfill root** pinned at `functions/src/wills-backfill.ts:23` (`DRIVE_ROOT_FOLDER_ID`) so both pipelines walk the same corpus with the same `drive.readonly` Viewer grant (P0.1: confirm the grant is still active). |
| `GCS_BUCKET` | yes | Bucket for converted/text/segment artifacts (`firms/{firmId}/clause-mining/**` — storage.rules path ships in the Never-Break sign-off PR, §9). |
| `ANTHROPIC_API_KEY` | LLM stages | Mounted as a **Cloud Run secret** (Secret Manager → env var). Never baked into the image. Required for `triage`, `extract`, `segment`, `identity`, `canonicalize`, `stats`. |
| `SAMPLE_LIMIT` | no | **Calibration-sample mode** (§4.4): limits the manifest to N files, stratified round-robin across attorney folders (adams/george/jerome/elizabeth/legacy-root). Set it on the `manifest` stage of a calibration run; downstream stages then only ever see those files. |

Auth for Drive/Firestore/GCS/Vertex is Application Default Credentials — the
Job runs pinned to the functions' default compute service account (§2), so the
existing `drive.readonly` grant and Vertex access carry over.

## Stage order

Each Job execution runs ONE stage (`STAGE=<name>`), in this order:

1. `manifest` — Stage 0: Drive BFS, sniff-everything filter (no extension
   whitelist; PDFs by mime AND extension + debris excluded), attorney-folder
   classification, share-request list for unreadable files (all-included
   decision, §15 #6), word-file yield to the run ledger.
2. `convert` — Stage 1: byte-sniff (first 8 bytes) → batched LibreOffice
   (25 files/invocation, per-invocation profile, 60 s kill timer, profile
   wipe on crash) with explicit `--infilter`; fallback ladder antiword /
   in-repo RTF extraction / wpd2text (structureConfidence `none`); artifacts
   to GCS (`converted/`, `text/`, `segments-ready/`); whole-ladder failures
   become error records — never silent.
3. `triage` — Stage 2: haiku batch classify → docCategory + instrumentKind;
   pilot filter = trusts only.
4. `extract` — Stage 3: sonnet batch → parties (gazetteer), execution date
   from text, fact vector (`src/facts-vocabulary.ts`), version label →
   `docFacts` (functions-only workspace; contains names).
5. `segment` — Stages 4–5: reflow → segment (style/numbering hints → text
   grammar → verified haiku boundary fallback) → normalize (gazetteer) →
   sigText/ring0Hash; segment records to GCS.
6. `identity` — Stage 6: Ring 0 exact / Ring 1 MinHash+LSH + diff filter +
   sonnet adjudication of EVERY content diff / item-set path / Ring 2 Vertex
   embeddings (≥0.92 propose → adjudicate; 0.80–0.92 relatedTo). All edges +
   transcripts persisted.
7. `canonicalize` — Stage 7: min-support ≥3 counting units; canonical = data
   decides (§6.2 amended); sonnet labels + fill contract
   (`src/fill-contract.ts`, fails on unregistered tags); PII gates
   (Aho-Corasick roster sweep + haiku gate over every canonical AND variant —
   fail closed).
8. `stats` — Stage 8: counting units (§7.2), Fisher exact + BH across the
   grid, card gate (lift ≥2.0/≤0.5, pAdj<0.01, n≥10), opus card narration
   with statsHash.
9. `catalog` — Stage 9: `firms/{firmId}/clauseCatalog` write per the §9
   schema (variants + occurrences subcollections, Vertex embedding).
   Everything lands `status: 'mined'` — nothing publishes without Adam.
10. `template` — Stage 9b: **checkpoint-2 stub** — throws
    `checkpoint-2 scope: implemented after catalog review begins` (§6.4 gates
    union-template assembly behind approved clauses existing).

## Resume semantics

Every stage checkpoints per-file to
`firms/{firmId}/clauseMining/{runId}/files/{driveFileId}` and skips rows that
already carry the stage's completion status:

- `manifest`: rows already present for the runId are not rewritten (downstream
  progress on them survives a re-manifest).
- `convert`: only `status: 'manifested'` rows are processed; `converted`,
  `error`, `unrecognized-format` rows skip.
- `triage`: only converted rows without a `docCategory`.
- `extract`: only trust rows without a `docFacts` doc.
- LLM batch ids are persisted to the run ledger (`batches.{name}`) before any
  poll, so a crashed poll can be diagnosed against the Anthropic console.

Re-running a completed stage with the same RUN_ID is a no-op (plus a ledger
update). A new RUN_ID starts a fresh run; conversion artifacts in GCS are
keyed by driveFileId and naturally reused as a cache.

## Spend breaker + kill switch

- Ledger doc: `clause_mining_state/control` (mirrors `pipeline_state/control`,
  §3/§10). Every Batches API result is charged transactionally
  (`src/anthropic-batch.ts:chargeSpend`).
- **Daily breaker: $250/day. Pilot ceiling: $350** (`src/config.ts` `spend`,
  Adam-approved §15 #8). Crossing either writes `breaker_tripped: true` and
  **hard-stops the run** (throws) — unlike the wills pipeline's log-only
  behavior.
- **Kill switch: set `clause_mining_state/control.enabled = false`.** Every
  stage checks it at startup and every spend charge re-checks it; the run
  aborts with `KillSwitchError`.
- To resume after a trip: raise/clear the counters deliberately (this is an
  explicit human action by design), delete `breaker_tripped`, re-run the
  stage.

## Build / test

```bash
npm ci
npx tsc --noEmit        # strict type check
npx vitest run          # full unit suite — no GCP, no network
npm run build           # emit lib/ (what the Docker ENTRYPOINT runs)
```

The Dockerfile installs LibreOffice Writer, antiword, and libwpd-tools
(`wpd2text`) — the §8 conversion ladder. Deploy is via the repo's
`workflow_dispatch` GitHub Action (Artifact Registry + `gcloud run jobs
deploy`); no manual local deploys.

## Not in this package (by design)

- Never-Break sign-off surface (firestore.rules/storage.rules additions,
  `clauseCatalog.embedding` vectorConfig index, workflow trigger paths) —
  ships as its own explicit sign-off PR per §9.
- Union master template assembly + round-trip QA (§6.4) — checkpoint-2.
- Weekly incremental `changes.list` Cloud Function (§12) — lives in
  `functions/` when built; this package is the batch Job only.
- Seed-calibration tooling (§11 P1) and the validation gates report (§11 P3).
