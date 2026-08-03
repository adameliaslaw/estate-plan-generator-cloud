/**
 * STAGE=mine-misses — the C4 gazetteer feedback loop. The seed library is
 * the vocabulary filter: seed pieces are client-free boilerplate, so a miss
 * token that also appears in seed text is shared drafting vocabulary, and
 * admitting it would redact ordinary words corpus-wide.
 */
import { describe, expect, it } from 'vitest';
import {
  buildSupplementalGazetteer,
  runMineMisses,
  seedVocabularyOf,
} from '../src/stages/mine-misses.js';
import { loadSupplementalGazetteer } from '../src/stages/segment-normalize.js';
import { edgesPath, seedPiecesPath, supplementalGazetteerPath } from '../src/paths.js';
import { FakeBlobStore, FakeDocStore, makeEnv } from './helpers/fakes.js';
import type { IdentityEdge } from '../src/stages/identity.js';

const env = makeEnv();

function missEdge(a: string, b: string, tokens: string[]): IdentityEdge {
  return {
    a, b, ring: 1, kind: 'adjudicated', scores: {},
    diff: { changedA: tokens, changedB: [] },
    adjudicationRef: 'adj/p.json', verdict: 'NORMALIZATION_MISS', merged: false,
  };
}

describe('buildSupplementalGazetteer', () => {
  const seedVocab = seedVocabularyOf(['the trustee shall distribute the residue per stirpes']);

  it('admits name-shaped tokens absent from the seed vocabulary', () => {
    const g = buildSupplementalGazetteer(
      [missEdge('h1', 'h2', ['porwancher', 'zuss'])],
      seedVocab,
      't0',
    );
    expect(g.names).toEqual(['porwancher', 'zuss']);
    expect(g.minedFromPairs).toBe(1);
  });

  it('rejects seed-vocabulary words — shared boilerplate is not a name', () => {
    const g = buildSupplementalGazetteer(
      [missEdge('h1', 'h2', ['trustee', 'porwancher'])],
      seedVocab,
      't0',
    );
    expect(g.names).toEqual(['porwancher']);
    expect(g.rejected.inSeedVocabulary).toBe(1);
  });

  it('rejects non-name-shaped tokens (numbers, placeholders, short strings)', () => {
    const g = buildSupplementalGazetteer(
      [missEdge('h1', 'h2', ['42', '{{DURATION}}', 'jr', 'ab1', "o'hara"])],
      seedVocab,
      't0',
    );
    expect(g.names).toEqual(["o'hara"]);
    expect(g.rejected.notNameShaped).toBe(4);
  });
});

describe('runMineMisses + segment pickup', () => {
  it('writes the roster and segment loads it as SUPPLEMENTAL_NAME entries', async () => {
    const store = new FakeDocStore();
    const blobs = new FakeBlobStore();
    await blobs.write(
      edgesPath(env.firmId, env.runId),
      JSON.stringify([missEdge('h1', 'h2', ['porwancher'])]),
    );
    await blobs.write(
      seedPiecesPath(env.firmId, env.runId),
      JSON.stringify({
        segmenterVersion: 'seg/4',
        generatedAt: 't0',
        pieces: [{ normText: 'the trustee shall serve', sigText: 'trustee serve' }],
      }),
    );
    const summary = await runMineMisses({ store, blobs }, env);
    expect(summary.admitted).toBe(1);
    expect(blobs.blobs.has(supplementalGazetteerPath(env.firmId, env.runId))).toBe(true);

    const entries = await loadSupplementalGazetteer(blobs, env);
    expect(entries).toEqual([{ role: 'SUPPLEMENTAL_NAME', names: ['porwancher'] }]);
  });

  it('refuses to run without identity edges or seed pieces', async () => {
    const store = new FakeDocStore();
    const blobs = new FakeBlobStore();
    await expect(runMineMisses({ store, blobs }, env)).rejects.toThrow(/STAGE=identity first/);
    await blobs.write(edgesPath(env.firmId, env.runId), JSON.stringify([]));
    await expect(runMineMisses({ store, blobs }, env)).rejects.toThrow(/STAGE=seed first/);
  });

  it('an absent roster is an empty gazetteer, not an error', async () => {
    const blobs = new FakeBlobStore();
    expect(await loadSupplementalGazetteer(blobs, env)).toEqual([]);
  });
});
