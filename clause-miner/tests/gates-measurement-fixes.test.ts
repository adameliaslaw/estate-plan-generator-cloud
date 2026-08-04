/**
 * Checkpoint-2 measurement fixes:
 *  M1 — gates hard-fail on a stale/unstamped seed-match artifact.
 *  M6 — gate 2 walks corpus merge edges (all-exact blind spot closed) and
 *       treats filename revisions of one template as ONE filing.
 *  Gate 4 — a canary file byte-duplicated inside the corpus (md5) defeats
 *       the holdout and fails the gate as compromised.
 */
import { describe, expect, it } from 'vitest';
import {
  checkSeedMatchConsistency,
  filingKey,
  gate2Purity,
  gate4Canary,
  runGates,
} from '../src/stages/gates.js';
import { SEGMENTER_VERSION } from '../src/stages/segment-normalize.js';
import { fileDocPath, seedFileDocPath, seedMatchPath } from '../src/paths.js';
import { FakeBlobStore, FakeDocStore, makeEnv } from './helpers/fakes.js';
import type { IdentityEdge } from '../src/stages/identity.js';
import type { SeedPiece } from '../src/stages/seed.js';
import type { SeedMatch } from '../src/seed-match.js';

const env = makeEnv({ canaryFolderIds: ['canary-folder'] });

function piece(id: string, fileName: string, fileId: string, overrides: Partial<SeedPiece> = {}): SeedPiece {
  return {
    pieceId: id,
    seedFileId: fileId,
    seedFileName: fileName,
    pieceIndex: 0,
    title: `Piece ${id}`,
    heading: null,
    normText: `text ${id}`,
    sigText: `text ${id}`,
    ring0Hash: `hash_${id}`,
    structureSignal: 'text-grammar',
    canary: false,
    trustRelevant: true,
    kind: 'clause',
    ...overrides,
  } as SeedPiece;
}

function match(pieceId: string, familyId: string, overrides: Partial<SeedMatch> = {}): SeedMatch {
  return {
    pieceId,
    seedFileId: 'seed1',
    familyId,
    matchedHash: `hash_${pieceId}`,
    ring: 0,
    kind: 'exact',
    scores: {},
    adjudicationRef: null,
    ...overrides,
  };
}

function edge(a: string, b: string, adjudicationRef: string | null): IdentityEdge {
  return {
    a, b, merged: true, ring: 1,
    kind: 'trivial',
    scores: {},
    diff: { changedA: [], changedB: [] },
    adjudicationRef,
  } as unknown as IdentityEdge;
}

describe('filingKey', () => {
  it('folds revision markers of one template into one filing', () => {
    expect(filingKey('DISCLAIMER WILL.doc')).toBe('DISCLAIMER WILL');
    expect(filingKey('DISCLAIMER WILL (NEW).doc')).toBe('DISCLAIMER WILL');
    expect(filingKey('DISCLAIMER WILL (NEW) (JJB).doc')).toBe('DISCLAIMER WILL');
  });

  it('keeps genuinely different filings apart', () => {
    expect(filingKey('MTP1.doc')).not.toBe(filingKey('ETP4.doc'));
  });
});

describe('gate 2 — filing lineage and edge-walking', () => {
  it('excuses the same clause carried across revisions of one template', () => {
    // The pilot-1 "violations" were exactly this shape: X.doc #8 +
    // X (NEW).doc #9 + X (NEW) (JJB).doc #8 in one family.
    const pieces = [
      piece('p1', 'DISCLAIMER WILL.doc', 'f1'),
      piece('p2', 'DISCLAIMER WILL (NEW).doc', 'f2'),
    ];
    const matches = [
      match('p1', 'fam_A'),
      match('p2', 'fam_A', { kind: 'trivial', ring: 1 }),
    ];
    expect(gate2Purity(pieces, matches, []).status).toBe('pass');
  });

  it('closes the all-exact blind spot: two exact matches joined by a silent corpus edge FAIL', () => {
    const pieces = [
      piece('p1', 'MTP1.doc', 'f1'),
      piece('p2', 'ETP4.doc', 'f2'),
    ];
    const matches = [match('p1', 'fam_A'), match('p2', 'fam_A')]; // both exact
    const silentEdges = [edge('hash_p1', 'hash_p2', null)];
    const result = gate2Purity(pieces, matches, silentEdges);
    expect(result.status).toBe('fail');
    expect(result.items[0]).toContain('MTP1.doc');
  });

  it('passes when the corpus merge between the two hashes carries a transcript', () => {
    const pieces = [
      piece('p1', 'MTP1.doc', 'f1'),
      piece('p2', 'ETP4.doc', 'f2'),
    ];
    const matches = [match('p1', 'fam_A'), match('p2', 'fam_A')];
    const reviewed = [edge('hash_p1', 'hash_p2', 'transcripts/pair1.json')];
    expect(gate2Purity(pieces, matches, reviewed).status).toBe('pass');
  });

  it('still fails two distinct pieces of the SAME file merged silently', () => {
    const pieces = [
      piece('p1', 'AAA WILL PIECES.doc', 'f1'),
      piece('p2', 'AAA WILL PIECES.doc', 'f1'),
    ];
    const matches = [match('p1', 'fam_A'), match('p2', 'fam_A')];
    expect(gate2Purity(pieces, matches, [edge('hash_p1', 'hash_p2', null)]).status).toBe('fail');
  });
});

describe('checkSeedMatchConsistency (M1)', () => {
  const pieces = [piece('p1', 'A.doc', 'f1')];

  it('rejects an unstamped artifact', () => {
    expect(checkSeedMatchConsistency({ pieces, matches: [] }, null)).toMatch(/no segmenter-version stamp/);
  });

  it('rejects a stamp from another segmenter version', () => {
    expect(
      checkSeedMatchConsistency({ segmenterVersion: 'seg/2', pieces, matches: [] }, null),
    ).toMatch(/seg\/2/);
  });

  it('rejects a piece-count disagreement with the seed ledger', () => {
    const err = checkSeedMatchConsistency(
      { segmenterVersion: SEGMENTER_VERSION, pieces, matches: [] },
      { clausePieces: 2, commentaryPieces: 0, trustRelevant: 1 },
    );
    expect(err).toMatch(/clausePieces/);
  });

  it('accepts a stamped artifact that reconciles with the ledger', () => {
    expect(
      checkSeedMatchConsistency(
        { segmenterVersion: SEGMENTER_VERSION, pieces, matches: [] },
        { clausePieces: 1, commentaryPieces: 0, trustRelevant: 1 },
      ),
    ).toBeNull();
  });
});

describe('gate 4 — md5 holdout compromise', () => {
  const canary = Array.from({ length: 10 }, (_, i) =>
    piece(`c${i}`, 'Canary.doc', 'cf1', { canary: true }),
  );
  const matches = canary.map((p) => match(p.pieceId, `fam_${p.pieceId}`));

  it('fails when EVERY canary piece comes from a byte-duplicated file — no clean holdout', () => {
    const result = gate4Canary(canary, matches, true, ['Canary.doc']);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('byte-identical');
    expect(result.detail).toContain('no clean holdout');
    expect(result.items).toEqual(['Canary.doc']);
  });

  it('EXCLUDES compromised files and grades the clean remainder (Adam, 2026-08-04)', () => {
    const clean = Array.from({ length: 10 }, (_, i) =>
      piece(`k${i}`, 'CleanCanary.doc', 'cf2', { canary: true }),
    );
    const mixed = [...canary, ...clean];
    // 9 of the 10 clean pieces recovered; the 10 compromised pieces would
    // have inflated the score had they been counted.
    const mixedMatches = clean.slice(0, 9).map((p) => match(p.pieceId, `fam_${p.pieceId}`));
    const result = gate4Canary(mixed, mixedMatches, true, ['Canary.doc']);
    expect(result.value).toBeCloseTo(0.9);
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('10 piece(s) from 1 byte-duplicated file(s) EXCLUDED');
  });

  it('runGates detects the md5 duplicate from the manifest rows', async () => {
    const store = new FakeDocStore();
    const blobs = new FakeBlobStore();
    await store.set(seedFileDocPath(env.firmId, env.runId, 'canaryfile'), {
      canary: true,
      md5Checksum: 'abc123',
      fileName: 'Canary.doc',
    });
    await store.set(fileDocPath(env.firmId, env.runId, 'corpusfile'), {
      md5Checksum: 'abc123',
      fileName: 'Copy of Canary.doc',
    });
    await blobs.write(
      seedMatchPath(env.firmId, env.runId),
      JSON.stringify({
        segmenterVersion: SEGMENTER_VERSION,
        pieces: canary,
        matches,
      }),
    );
    const report = await runGates({ store, blobs }, env);
    const gate4 = report.results.find((r) => r.gate === 'gate4');
    expect(gate4?.status).toBe('fail');
    expect(gate4?.detail).toContain('byte-identical');
  });
});
