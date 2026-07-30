import { describe, expect, it } from 'vitest';
import {
  parseLabels,
  pickBoundaryDocs,
  runCalibrate,
  type CalibrationPacket,
} from '../src/stages/calibrate.js';
import {
  calibrationLabelsPath,
  calibrationPacketPath,
  fileDocPath,
  runLedgerPath,
  seedPiecesPath,
  segmentsPath,
} from '../src/paths.js';
import { normalize } from '../src/core/normalize.js';
import { ring0Hash, toSigText } from '../src/core/sigtext.js';
import { FakeBlobStore, FakeDocStore, makeEnv } from './helpers/fakes.js';
import type { SeedPiece } from '../src/stages/seed.js';

const env = makeEnv({ seedFolderIds: ['f-seed'] });

const SPENDTHRIFT =
  'No beneficiary shall have any right or power to anticipate, pledge, assign, sell, transfer, ' +
  'alienate or encumber his or her interest in the trust estate in any way, nor shall any such ' +
  'interest be liable for the debts or obligations of such beneficiary.';

function seedPiece(id: string, text: string, index: number): SeedPiece {
  const { normText } = normalize(text, []);
  const sigText = toSigText(normText);
  return {
    pieceId: id,
    seedFileId: 'seedfile',
    seedFileName: 'AAA WILL PIECES.doc',
    pieceIndex: index,
    title: `Piece ${index}`,
    normText,
    sigText,
    ring0Hash: ring0Hash(sigText),
    separatorSignal: 'rule',
    canary: false,
    trustRelevant: true,
    kind: 'clause',
  };
}

function segment(text: string, segmentIndex: number) {
  const { normText, parameters } = normalize(text, []);
  const sigText = toSigText(normText);
  return {
    segmentIndex,
    articleIndex: 0,
    sectionIndex: segmentIndex,
    charSpan: [0, text.length] as [number, number],
    normText,
    sigText,
    ring0Hash: ring0Hash(sigText),
    structureSignal: 'text-grammar',
    executionBlock: false,
    parameters,
    itemSet: null,
  };
}

async function setup(opts: { labels?: Array<{ pairId: string; label: string }> } = {}) {
  const store = new FakeDocStore();
  const blobs = new FakeBlobStore();

  await blobs.write(
    seedPiecesPath(env.firmId, env.runId),
    JSON.stringify([
      seedPiece('seedfile:0', SPENDTHRIFT, 0),
      seedPiece('seedfile:1', SPENDTHRIFT.replace('in any way', 'in any manner'), 1),
    ]),
  );

  // One segmented corpus doc so the candidate band comes from the pilot.
  await store.set(fileDocPath(env.firmId, env.runId, 'doc1'), {
    status: 'segmented',
    fileName: 'DoeTrust.doc',
  });
  await blobs.write(
    segmentsPath(env.firmId, env.runId, 'doc1'),
    JSON.stringify({
      driveFileId: 'doc1',
      textArtifactPath: 'text/doc1.txt',
      parserVersion: 'clause-miner-parser/1',
      reflowed: false,
      flags: [],
      structureConfidence: 'ooxml',
      segments: [
        segment(SPENDTHRIFT.replace('pledge, assign', 'pledge, convey'), 0),
        segment('The Trustee shall serve without bond in any jurisdiction.', 1),
      ],
    }),
  );

  if (opts.labels !== undefined) {
    await store.set(calibrationLabelsPath(env.firmId, env.runId), { pairs: opts.labels });
  }
  return { store, blobs };
}

async function packetOf(blobs: FakeBlobStore): Promise<CalibrationPacket> {
  return JSON.parse(
    (await blobs.read(calibrationPacketPath(env.firmId, env.runId))).toString(),
  ) as CalibrationPacket;
}

describe('runCalibrate — emit mode (§11 P1)', () => {
  it('writes a packet with the three asks', async () => {
    const { store, blobs } = await setup();
    const summary = await runCalibrate({ store, blobs }, env);

    expect(summary.mode).toBe('emit');
    const packet = await packetOf(blobs);
    expect(packet.seedPieces).toHaveLength(2);
    expect(packet.boundaryDocs).toHaveLength(1);
    expect(packet.boundaryDocs[0].segmentOpeners).toHaveLength(2);
    expect(packet.instructions).toContain('When in doubt, answer different');
  });

  it('samples label pairs out of the pilot\'s own candidate band', async () => {
    const { store, blobs } = await setup();
    await runCalibrate({ store, blobs }, env);
    const packet = await packetOf(blobs);
    // The near-duplicate corpus segment and the seed pieces are candidates;
    // the unrelated "without bond" segment is not.
    expect(packet.labelPairs.length).toBeGreaterThan(0);
    expect(packet.labelPairs.every((p) => p.score >= 0.6 && p.score <= 0.98)).toBe(true);
  });

  it('does not write thresholds before Adam has labeled anything', async () => {
    const { store, blobs } = await setup();
    await runCalibrate({ store, blobs }, env);
    const ledger = await store.get(runLedgerPath(env.firmId, env.runId));
    expect(ledger?.thresholds).toBeUndefined();
  });

  it('refuses to run before the seed stage', async () => {
    const store = new FakeDocStore();
    const blobs = new FakeBlobStore();
    await expect(runCalibrate({ store, blobs }, env)).rejects.toThrow(/run STAGE=seed first/);
  });
});

describe('runCalibrate — tune mode', () => {
  it('writes the selected banding to the ledger when labels arrive', async () => {
    const { store, blobs } = await setup();
    await runCalibrate({ store, blobs }, env); // emit, to learn the pair ids
    const packet = await packetOf(blobs);
    const labels = packet.labelPairs.map((p) => ({ pairId: p.pairId, label: 'same' }));

    const withLabels = await setup({ labels });
    const summary = await runCalibrate(withLabels, env);
    expect(summary.mode).toBe('tune');
    expect(summary.labelsReceived).toBe(labels.length);

    expect(summary.failure).toBeNull();
    expect(summary.selected).not.toBeNull();

    const ledger = await withLabels.store.get(runLedgerPath(env.firmId, env.runId));
    const thresholds = ledger?.thresholds as Record<string, unknown> | undefined;
    expect(thresholds?.lshBands).toBe(summary.selected?.lshBands);
    expect(thresholds?.lshRows).toBe(summary.selected?.lshRows);
    expect((thresholds?.labelCounts as Record<string, number>).fromAdam).toBe(labels.length);
  });

  it('leaves the configured defaults in force when tuning FAILS', async () => {
    // Every split auto-merges a pair Adam called different ⇒ no split is
    // selected, and none is written. Shipping the least-bad over-merger is
    // exactly what §4.3 forbids.
    const { store, blobs } = await setup();
    await runCalibrate({ store, blobs }, env);
    const packet = await packetOf(blobs);
    const withLabels = await setup({
      labels: packet.labelPairs.map((p) => ({ pairId: p.pairId, label: 'different' })),
    });
    const summary = await runCalibrate(withLabels, env);

    expect(summary.selected).toBeNull();
    expect(summary.failure).toContain('no SAME-labeled pairs');
    const ledger = await withLabels.store.get(runLedgerPath(env.firmId, env.runId));
    expect(ledger?.thresholds).toBeUndefined();
  });

  it('ignores labels for pairs that are not in this run\'s packet', async () => {
    const { store, blobs } = await setup({
      labels: [{ pairId: 'stale-pair-from-another-run', label: 'same' }],
    });
    const summary = await runCalibrate({ store, blobs }, env);
    expect(summary.labelsReceived).toBe(0);
    expect(summary.mode).toBe('emit');
  });
});

describe('parseLabels', () => {
  const candidates = [
    { pairId: 'p1', aId: 'a', bId: 'b', aText: 'x', bText: 'y', score: 0.8, trivial: false },
  ];

  it('keeps only well-formed labels for known pairs', () => {
    const labels = parseLabels(
      {
        pairs: [
          { pairId: 'p1', label: 'same' },
          { pairId: 'p1', label: 'maybe' }, // not a label
          { pairId: 'unknown', label: 'different' }, // not in this packet
          { label: 'same' }, // no id
        ],
      },
      candidates,
    );
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ pairId: 'p1', label: 'same', source: 'adam' });
  });

  it('handles a missing labels doc', () => {
    expect(parseLabels(null, candidates)).toEqual([]);
  });
});

describe('pickBoundaryDocs', () => {
  it('spreads across the era range rather than taking the newest', () => {
    const docs = [1994, 1999, 2005, 2012, 2019, 2024].map((eraYear, i) => ({
      driveFileId: `d${i}`,
      eraYear,
    }));
    const picked = pickBoundaryDocs(docs, 3);
    expect(picked.map((d) => d.eraYear)).toEqual([1994, 2005, 2024]);
  });

  it('includes undated docs — the least-trusted segmentation', () => {
    const docs = [
      { driveFileId: 'a', eraYear: 2020 },
      { driveFileId: 'b', eraYear: null },
    ];
    expect(pickBoundaryDocs(docs, 5).map((d) => d.driveFileId).sort()).toEqual(['a', 'b']);
  });

  it('returns everything when there are fewer docs than asked for', () => {
    const docs = [{ driveFileId: 'a', eraYear: 2020 }];
    expect(pickBoundaryDocs(docs, 5)).toHaveLength(1);
  });
});
