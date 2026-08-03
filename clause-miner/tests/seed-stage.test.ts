import { describe, expect, it } from 'vitest';
import {
  buildSeedPieceRequest,
  buildSeedTriageRequest,
  runSeed,
  type SeedPiece,
} from '../src/stages/seed.js';
import { runLedgerPath, seedFileDocPath, seedPiecesPath, segmentsReadyPath } from '../src/paths.js';
import { parseSeedPiecesArtifact } from '../src/stages/seed.js';
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

/** A complete will template — the shape that broke the first calibration
 *  packet: the old library segmenter kept the whole body as ONE piece. */
const WILL_TEMPLATE = [
  'LAST WILL AND TESTAMENT',
  'I, [NAME], now residing at ____________, Township of Monroe, County of Middlesex and State of New Jersey, which I declare to be my domicile, being of sound and disposing mind and memory, and mindful of the uncertainty of life and the objects of my bounty, do make, publish and declare this to be my Last Will and Testament, hereby revoking all wills and codicils at any time heretofore made by me.',
  'FIRST: I direct that all expenses incurred for my support or in my behalf, including funeral expenses, expenses of any last illness, and all of the expenses of administering my estate, together with all of my just and enforceable debts, be paid as soon after my death as may be convenient and practicable for my Executor hereinafter named, without any order of court and without the necessity of filing any claim therefor.',
  'SECOND: I devise all tangible personal property owned by me at the time of my death, including policies of insurance thereon if any, to my beloved spouse, [SPOUSE], if my spouse survives me, outright and free of trust, in the hope that my spouse will dispose of such property in accordance with my wishes as I may have expressed them from time to time during my lifetime, but without imposing any legal obligation whatsoever upon my spouse to do so.',
  'NOTE: use the following only when there are minor children.',
  'THIRD: I nominate and appoint my spouse, [SPOUSE], Executor of this my Last Will and Testament, and I order and direct that no Executor nominated or appointed by me shall be required to furnish any bond or other security as such in the State of New Jersey or elsewhere, or if a bond be required, that such Executor shall serve without bond so far as the law allows and shall not be required to furnish any sureties thereon.',
  'IN WITNESS WHEREOF, I have hereunto set my hand and seal this day of [MONTH], 2017.',
  '________________________________',
  'The foregoing instrument was signed, sealed, published and declared by the said [NAME] as and for his Last Will and Testament in the presence of us.',
];

const POA_DOC = [
  'GENERAL DURABLE POWER OF ATTORNEY',
  'FIRST: I, [NAME], hereby appoint my agent, [AGENT], to act for me in any lawful way with respect to the powers enumerated herein.',
  'SECOND: My agent may conduct banking transactions, sign checks and endorse instruments on my behalf.',
];

const LETTER_DOC = [
  'Dear Mr. Doe,',
  'I prepared a deed for your review and enclose two copies with this letter. Please sign both where indicated and return them in the envelope provided.',
  'Very truly yours,',
];

/** A single hand-curated clause — no internal structure to segment. */
const EXCERPT_DOC = [
  'No beneficiary shall have any right to anticipate, sell, assign or encumber any interest in the trust estate, nor shall such interest be liable for the debts of any beneficiary.',
];

const FILES: Array<{ id: string; name: string; canary: boolean; paragraphs: string[] }> = [
  { id: 'willfile', name: 'DISCLAIMER WILL.doc', canary: false, paragraphs: WILL_TEMPLATE },
  { id: 'poafile', name: 'New York POA.doc', canary: false, paragraphs: POA_DOC },
  { id: 'letterfile', name: 'Letter-Waiver.doc', canary: false, paragraphs: LETTER_DOC },
  { id: 'excerptfile', name: 'SPENDTHRIFT PARAGRAPH.doc', canary: true, paragraphs: EXCERPT_DOC },
];

const TRIAGE: Record<string, Record<string, unknown> | { ok: false; error: string }> = {
  willfile: { toolInput: { docCategory: 'will', contentKind: 'complete-document', confidence: 0.95 } },
  poafile: { toolInput: { docCategory: 'poa', contentKind: 'complete-document', confidence: 0.97 } },
  // The letter's triage FAILS — it must stay in scope and fall to the
  // segmentability litmus, not vanish silently.
  letterfile: { ok: false, error: 'timeout' },
  excerptfile: { toolInput: { docCategory: 'trust', contentKind: 'clause-excerpt', confidence: 0.9 } },
};

function defaultResponder(req: BatchRequest): Record<string, unknown> {
  if (req.customId.startsWith('seedtriage:')) {
    const id = req.customId.slice('seedtriage:'.length);
    return TRIAGE[id] as Record<string, unknown>;
  }
  return { toolInput: { kind: 'clause', trust_relevant: true, title: 'Piece' } };
}

async function setup(opts: { responder?: (req: BatchRequest) => Record<string, unknown> } = {}) {
  const store = new FakeDocStore();
  const blobs = new FakeBlobStore();
  for (const f of FILES) {
    await store.set(seedFileDocPath(env.firmId, env.runId, f.id), {
      status: 'converted',
      fileName: f.name,
      canary: f.canary,
    });
    await blobs.write(
      segmentsReadyPath(env.firmId, f.id),
      JSON.stringify({
        parserVersion: 'clause-miner-parser/1',
        structureConfidence: 'ooxml',
        paragraphs: f.paragraphs.map((text) => ({
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
  const batches = new FakeBatchClient(
    (req) => (opts.responder ?? defaultResponder)(req) as never,
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
  return parseSeedPiecesArtifact(
    (await blobs.read(seedPiecesPath(env.firmId, env.runId))).toString(),
  ).pieces;
}

describe('runSeed (§11 P1a, instrument segmentation)', () => {
  it('segments a complete will with the instrument grammar — one piece per article', async () => {
    const { blobs, deps } = await setup();
    await runSeed(deps, env);
    const out = (await pieces(blobs)).filter((p) => p.seedFileId === 'willfile');

    // Heading block + FIRST/SECOND/THIRD — never the whole body as one piece.
    expect(out.length).toBeGreaterThanOrEqual(4);
    const withDebts = out.filter((p) => p.normText.includes('funeral expenses'));
    expect(withDebts).toHaveLength(1);
    // The article about debts and the article about tangible property are
    // DIFFERENT pieces — the old library segmenter kept them together.
    expect(withDebts[0].normText).not.toContain('tangible personal property');
    expect(out.every((p) => p.structureSignal === 'text-grammar')).toBe(true);
    expect(out.every((p) => p.pieceId.includes(':s'))).toBe(true);
  });

  it('keeps execution machinery out of the gold set without losing the last article', async () => {
    const { blobs, deps } = await setup();
    const summary = await runSeed(deps, env);
    const out = await pieces(blobs);
    const joined = out.map((p) => p.normText).join(' ');
    expect(joined).not.toContain('IN WITNESS WHEREOF');
    expect(joined).not.toContain('published and declared');
    // The THIRD article ran straight into the execution block — its operative
    // text survives the truncation.
    expect(joined).toContain('without bond');
    expect(summary.executionBlocksDropped).toBeGreaterThanOrEqual(1);
  });

  it('excludes out-of-scope categories BY NAME — the POA decision', async () => {
    const { store, blobs, deps } = await setup();
    const summary = await runSeed(deps, env);

    expect(summary.excluded['out-of-scope:poa']).toBe(1);
    expect((await pieces(blobs)).some((p) => p.seedFileId === 'poafile')).toBe(false);
    const row = await store.get(seedFileDocPath(env.firmId, env.runId, 'poafile'));
    expect(row?.status).toBe('seed-excluded');
    expect(row?.seedExclusionReason).toBe('out-of-scope:poa');
    const ledger = await store.get(runLedgerPath(env.firmId, env.runId));
    const excludedFiles = (ledger?.seed as Record<string, unknown>).excludedFiles as Array<
      Record<string, string>
    >;
    expect(excludedFiles).toContainEqual({
      seedFileId: 'poafile',
      fileName: 'New York POA.doc',
      reason: 'out-of-scope:poa',
    });
  });

  it('the litmus test: an unsegmentable document is excluded, never one giant piece', async () => {
    const { store, blobs, deps } = await setup();
    const summary = await runSeed(deps, env);

    expect(summary.triageFailed).toBe(1); // the letter's triage timed out
    expect(summary.excluded['unsegmentable']).toBe(1);
    expect((await pieces(blobs)).some((p) => p.seedFileId === 'letterfile')).toBe(false);
    const row = await store.get(seedFileDocPath(env.firmId, env.runId, 'letterfile'));
    expect(row?.seedExclusionReason).toBe('unsegmentable');
  });

  it('keeps a clause-excerpt as ONE piece despite having no internal structure', async () => {
    const { blobs, deps } = await setup();
    const summary = await runSeed(deps, env);
    const out = (await pieces(blobs)).filter((p) => p.seedFileId === 'excerptfile');
    expect(out).toHaveLength(1);
    expect(out[0].normText).toContain('anticipate');
    expect(summary.inScope).toBe(2); // will + excerpt
  });

  it('drops deterministic commentary lines from operative pieces', async () => {
    const { blobs, deps } = await setup();
    await runSeed(deps, env);
    expect((await pieces(blobs)).map((p) => p.normText).join(' ')).not.toContain('minor children');
  });

  it('tags canary pieces so Gate 4 can find them', async () => {
    const { blobs, deps } = await setup();
    const summary = await runSeed(deps, env);
    const out = await pieces(blobs);
    expect(out.filter((p) => p.canary).map((p) => p.seedFileId)).toEqual(['excerptfile']);
    expect(summary.canaryPieces).toBe(1);
  });

  it('a re-run re-processes rows a previous pass left seed-segmented', async () => {
    const { blobs, deps } = await setup();
    const first = await runSeed(deps, env);
    expect(first.pieces).toBeGreaterThan(0);
    // Statuses are now 'seed-segmented' / 'seed-excluded' — the old
    // status==='converted' filter would find nothing and write [].
    const second = await runSeed(deps, env);
    expect(second.pieces).toBe(first.pieces);
    expect(await pieces(blobs)).toHaveLength(first.pieces);
  });

  it('re-polls a ledgered triage batch instead of resubmitting those files', async () => {
    const { store, batches, deps } = await setup();
    const priorId = await batches.submitBatch('seed-triage', [
      buildSeedTriageRequest('poafile', 'New York POA.doc', POA_DOC.join('\n')),
    ]);
    await store.set(runLedgerPath(env.firmId, env.runId), {
      batches: { 'seed-triage': priorId },
    });
    await runSeed(deps, env);
    const resubmitted = batches.submitted
      .slice(1) // the pre-submitted prior batch
      .filter((b) => b.name.startsWith('seed-triage'))
      .flatMap((b) => b.requests.map((r) => r.customId));
    expect(resubmitted).not.toContain('seedtriage:poafile');
  });

  it('never applies a stale classify verdict from a pre-revision batch (id collision guard)', async () => {
    const { store, blobs, batches, deps } = await setup({
      responder: (req) =>
        req.customId === 'seedpiece:willfile:0'
          ? { toolInput: { kind: 'commentary', trust_relevant: false, title: 'Stale' } }
          : defaultResponder(req),
    });
    // A ledgered batch from the OLD segmenter run, with old-style piece ids.
    const staleId = await batches.submitBatch('seed-piece-classify', [
      buildSeedPieceRequest('willfile:0', 'old whole-document piece text'),
    ]);
    await store.set(runLedgerPath(env.firmId, env.runId), {
      batches: { 'seed-piece-classify': staleId },
    });
    const summary = await runSeed(deps, env);
    // The stale 'commentary' verdict matched no ':s' piece id — every real
    // piece was classified fresh.
    expect(summary.commentaryPieces).toBe(0);
    expect((await pieces(blobs)).every((p) => p.kind === 'clause')).toBe(true);
  });

  it('fails SAFE on an unclassified piece: it counts against recall, not out of it', async () => {
    const { blobs, deps } = await setup({
      responder: (req) =>
        req.customId.startsWith('seedtriage:')
          ? defaultResponder(req)
          : ({ ok: false, error: 'timeout' } as never),
    });
    const summary = await runSeed(deps, env);
    expect(summary.unclassified).toBe(summary.pieces);
    const out = await pieces(blobs);
    expect(out.every((p) => p.kind === 'clause' && p.trustRelevant)).toBe(true);
  });

  it('refuses to run with no seed folders configured', async () => {
    const { deps } = await setup();
    await expect(runSeed(deps, makeEnv())).rejects.toThrow(/CLAUSE_MINER_SEED_FOLDER_IDS is empty/);
  });

  it('writes the run-ledger entry with the exclusion report', async () => {
    const { store, deps } = await setup();
    const summary = await runSeed(deps, env);
    const ledger = await store.get(runLedgerPath(env.firmId, env.runId));
    expect(ledger?.stage).toBe('seed');
    const seed = ledger?.seed as Record<string, unknown>;
    expect(seed.pieces).toBe(summary.pieces);
    expect(seed.inScope).toBe(2);
    expect((seed.excludedFiles as unknown[]).length).toBe(2);
  });
});

describe('request builders', () => {
  it('seed triage uses haiku, a forced tool, and carries the file name', () => {
    const req = buildSeedTriageRequest('f1', 'DISCLAIMER WILL.doc', 'text');
    expect(req.model).toBe('haiku');
    expect(req.tool?.name).toBe('triage_seed_file');
    expect(req.userText).toContain('DISCLAIMER WILL.doc');
    expect(req.system).toContain('clause-excerpt');
  });

  it('piece classify uses haiku with a forced tool and tells the model blanks are normal', () => {
    const req = buildSeedPieceRequest('p1', 'I, JOHN DOE, of ______, declare this trust.');
    expect(req.model).toBe('haiku');
    expect(req.tool?.name).toBe('classify_library_piece');
    expect(req.system).toContain('do NOT make it commentary');
  });
});
