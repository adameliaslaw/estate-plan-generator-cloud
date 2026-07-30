import { describe, expect, it } from 'vitest';
import { buildSeedPieceRequest, runSeed, type SeedPiece } from '../src/stages/seed.js';
import { runLedgerPath, seedFileDocPath, seedPiecesPath, segmentsReadyPath } from '../src/paths.js';
import {
  FakeBatchClient,
  FakeBlobStore,
  FakeDocStore,
  FakeDrive,
  FakeShell,
  folder,
  makeEnv,
  shellOk,
} from './helpers/fakes.js';
import type { BatchRequest } from '../src/clients/interfaces.js';

const env = makeEnv({ seedFolderIds: ['f-seed'], canaryFolderIds: ['f-canary'] });

const LIBRARY = [
  'SPENDTHRIFT PROVISION',
  'No beneficiary shall have any right to anticipate, sell, assign or encumber any interest',
  'in the trust estate, nor shall such interest be liable for the debts of any beneficiary.',
  '',
  '',
  'NOTE: omit this paragraph for a single-beneficiary trust.',
  'DISTRIBUTION ON DEATH',
  'Upon my death the Trustee shall distribute the remaining trust estate to my descendants,',
  'per stirpes, in equal shares.',
];

async function setup(opts: { responder?: (req: BatchRequest) => Record<string, unknown> } = {}) {
  const store = new FakeDocStore();
  const blobs = new FakeBlobStore();
  // Both seed files are already converted — the ladder itself is covered by
  // convert.test.ts; this exercises segmentation, classification and output.
  for (const [id, canary] of [
    ['seedfile', false],
    ['canaryfile', true],
  ] as Array<[string, boolean]>) {
    await store.set(seedFileDocPath(env.firmId, env.runId, id), {
      status: 'converted',
      fileName: canary ? 'Trust Agreements.doc' : 'AAA WILL PIECES.doc',
      canary,
    });
    await blobs.write(
      segmentsReadyPath(env.firmId, id),
      JSON.stringify({
        parserVersion: 'clause-miner-parser/1',
        structureConfidence: 'ooxml',
        paragraphs: LIBRARY.map((text) => ({
          text,
          styleId: null,
          numIlvl: null,
          inTable: false,
          bold: false,
          centered: false,
        })),
      }),
    );
  }
  const batches = new FakeBatchClient((req) =>
    opts.responder !== undefined
      ? (opts.responder(req) as never)
      : { toolInput: { kind: 'clause', trust_relevant: true, title: 'Piece' } },
  );
  const deps = {
    drive: new FakeDrive(folder('root', 'root', [])),
    store,
    blobs,
    shell: new FakeShell(() => shellOk),
    batches,
  };
  return { store, blobs, batches, deps };
}

async function pieces(blobs: FakeBlobStore): Promise<SeedPiece[]> {
  return JSON.parse((await blobs.read(seedPiecesPath(env.firmId, env.runId))).toString()) as SeedPiece[];
}

describe('runSeed (§11 P1a)', () => {
  it('segments each curated file with the library segmenter and hashes the pieces', async () => {
    const { blobs, deps } = await setup();
    const summary = await runSeed(deps, env);
    const out = await pieces(blobs);

    expect(summary.pieces).toBe(4); // 2 pieces × 2 files
    expect(out.every((p) => p.ring0Hash.length > 0)).toBe(true);
    expect(out.map((p) => p.title)).toContain('SPENDTHRIFT PROVISION');
  });

  it('normalizes seed text the SAME way the corpus does, so pieces can land', async () => {
    const { blobs, deps } = await setup();
    await runSeed(deps, env);
    const out = await pieces(blobs);
    // Identical library text in two files must produce one signature — if the
    // seed folded differently from the corpus, Gate 1 could never pass.
    const spendthrift = out.filter((p) => p.pieceIndex === 0);
    expect(new Set(spendthrift.map((p) => p.ring0Hash)).size).toBe(1);
  });

  it('tags canary pieces so Gate 4 can find them', async () => {
    const { blobs, deps } = await setup();
    const summary = await runSeed(deps, env);
    const out = await pieces(blobs);
    expect(out.filter((p) => p.canary)).toHaveLength(2);
    expect(summary.canaryPieces).toBe(2);
  });

  it('keeps the drafting note out of every piece', async () => {
    const { blobs, deps } = await setup();
    await runSeed(deps, env);
    const out = await pieces(blobs);
    expect(out.map((p) => p.normText).join(' ')).not.toContain('single-beneficiary');
  });

  it('records a commentary verdict without dropping the piece from the artifact', async () => {
    const { blobs, deps } = await setup({
      responder: () => ({ toolInput: { kind: 'commentary', trust_relevant: false, title: 'Note' } }),
    });
    const summary = await runSeed(deps, env);
    expect(summary.commentaryPieces).toBe(4);
    expect(summary.trustRelevant).toBe(0);
    // Still written out — the gates filter on `kind`, and a discarded piece
    // could not be reviewed in the calibration packet.
    expect(await pieces(blobs)).toHaveLength(4);
  });

  it('fails SAFE on an unclassified piece: it counts against recall, not out of it', async () => {
    // A dropped classification must not silently shrink Gate 1's denominator
    // — that would turn a model failure into a higher recall score.
    const { blobs, deps } = await setup({ responder: () => ({ ok: false, error: 'timeout' }) });
    const summary = await runSeed(deps, env);
    expect(summary.unclassified).toBe(4);
    const out = await pieces(blobs);
    expect(out.every((p) => p.kind === 'clause' && p.trustRelevant)).toBe(true);
  });

  it('refuses to run with no seed folders configured', async () => {
    const { deps } = await setup();
    await expect(runSeed(deps, makeEnv())).rejects.toThrow(/CLAUSE_MINER_SEED_FOLDER_IDS is empty/);
  });

  it('writes the run-ledger entry', async () => {
    const { store, deps } = await setup();
    await runSeed(deps, env);
    const ledger = await store.get(runLedgerPath(env.firmId, env.runId));
    expect(ledger?.stage).toBe('seed');
    expect((ledger?.seed as Record<string, unknown>).pieces).toBe(4);
  });
});

describe('buildSeedPieceRequest', () => {
  it('uses haiku with a forced tool and tells the model blanks are normal', () => {
    const req = buildSeedPieceRequest('p1', 'I, JOHN DOE, of ______, declare this trust.');
    expect(req.model).toBe('haiku');
    expect(req.tool?.name).toBe('classify_library_piece');
    expect(req.system).toContain('do NOT make it commentary');
  });
});
