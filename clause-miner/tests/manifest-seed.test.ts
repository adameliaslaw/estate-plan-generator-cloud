import { describe, expect, it } from 'vitest';
import { runManifest } from '../src/stages/manifest.js';
import { filesCollection, seedFilesCollection } from '../src/paths.js';
import { FakeDocStore, FakeDrive, file, folder, makeEnv } from './helpers/fakes.js';
import { idList, loadEnv } from '../src/env.js';

/**
 * The curated seed leaves the corpus BY CONSTRUCTION (§11 P1, Gate 4). These
 * tests are the proof of that claim: the corpus collection must not contain a
 * single seed row, however deeply nested.
 */
function tree() {
  return folder('root', 'Wills and Trusts', [
    folder('f-adam', 'Adam Files', [
      file('client1', 'DoeTrust.doc', { mimeType: 'application/msword', size: 100 }),
    ]),
    folder('f-seed', 'AAA WILL PIECES', [
      file('seed1', 'Spendthrift.doc', { mimeType: 'application/msword', size: 50 }),
      folder('f-seed-sub', 'Trust Paragraphs', [
        file('seed2', 'Powers.doc', { mimeType: 'application/msword', size: 50 }),
      ]),
    ]),
    folder('f-canary', 'Trust Agreements', [
      file('canary1', 'RevocableTrust.doc', { mimeType: 'application/msword', size: 80 }),
    ]),
  ]);
}

describe('manifest — curated-seed exclusion (§11 P1 / Gate 4)', () => {
  it('routes seed and canary trees to the seed collection, never the corpus', async () => {
    const store = new FakeDocStore();
    const env = makeEnv({
      seedFolderIds: ['f-seed', 'f-canary'],
      canaryFolderIds: ['f-canary'],
    });
    const summary = await runManifest({ drive: new FakeDrive(tree()), store }, env);

    const corpus = await store.listIds(filesCollection(env.firmId, env.runId));
    const seed = await store.listIds(seedFilesCollection(env.firmId, env.runId));

    expect(corpus).toEqual(['client1']);
    expect(seed.sort()).toEqual(['canary1', 'seed1', 'seed2']);
    expect(summary.manifested).toBe(1);
    expect(summary.seedManifested).toBe(3);
    expect(summary.canaryManifested).toBe(1);
  });

  it('inherits seed membership into nested folders', async () => {
    // seed2 lives two levels down. If membership did not inherit it would
    // land in the corpus and Gate 4 would be measuring a document it was
    // handed — the exact vacuous pass the canary exists to prevent.
    const store = new FakeDocStore();
    const env = makeEnv({ seedFolderIds: ['f-seed'] });
    await runManifest({ drive: new FakeDrive(tree()), store }, env);
    const corpus = await store.listIds(filesCollection(env.firmId, env.runId));
    expect(corpus).not.toContain('seed2');
  });

  it('tags only the canary subtree as canary', async () => {
    const store = new FakeDocStore();
    const env = makeEnv({
      seedFolderIds: ['f-seed', 'f-canary'],
      canaryFolderIds: ['f-canary'],
    });
    await runManifest({ drive: new FakeDrive(tree()), store }, env);
    const rows = await store.listDocs(seedFilesCollection(env.firmId, env.runId));
    const canary = rows.filter((r) => r.data.canary === true).map((r) => r.id);
    expect(canary).toEqual(['canary1']);
  });

  it('does not count seed files toward the corpus word-file yield', async () => {
    const store = new FakeDocStore();
    const env = makeEnv({ seedFolderIds: ['f-seed', 'f-canary'], canaryFolderIds: ['f-canary'] });
    const summary = await runManifest({ drive: new FakeDrive(tree()), store }, env);
    // Only the one client .doc — a yield inflated by the library would
    // mis-baseline the corpus-size sanity check (§3 Stage 0).
    expect(summary.wordFileYield).toBe(1);
  });

  it('keeps every file in the corpus when no seed folders are configured', async () => {
    const store = new FakeDocStore();
    const env = makeEnv();
    await runManifest({ drive: new FakeDrive(tree()), store }, env);
    const corpus = await store.listIds(filesCollection(env.firmId, env.runId));
    expect(corpus.sort()).toEqual(['canary1', 'client1', 'seed1', 'seed2']);
  });
});

describe('env — canary must be a subset of seed', () => {
  const base = {
    FIRM_ID: 'firm1',
    RUN_ID: 'run1',
    CLAUSE_MINER_ROOT_FOLDER_ID: 'root',
    GCS_BUCKET: 'bucket',
  };

  function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries({ ...base, ...vars })) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      return fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }

  it('rejects a canary folder that is not also a seed folder', () => {
    // Such a folder would be WALKED INTO THE CORPUS while the gate believed
    // it was held out — a silently vacuous Gate 4. Fail at startup instead.
    expect(() =>
      withEnv(
        {
          CLAUSE_MINER_SEED_FOLDER_IDS: 'f-seed',
          CLAUSE_MINER_CANARY_FOLDER_IDS: 'f-canary',
        },
        loadEnv,
      ),
    ).toThrow(/subset of CLAUSE_MINER_SEED_FOLDER_IDS/);
  });

  it('accepts a canary folder listed as a seed folder', () => {
    const env = withEnv(
      {
        CLAUSE_MINER_SEED_FOLDER_IDS: 'f-seed, f-canary',
        CLAUSE_MINER_CANARY_FOLDER_IDS: 'f-canary',
      },
      loadEnv,
    );
    expect(env.seedFolderIds).toEqual(['f-seed', 'f-canary']);
    expect(env.canaryFolderIds).toEqual(['f-canary']);
  });

  it('parses comma and whitespace separated id lists', () => {
    expect(idList(undefined)).toEqual([]);
    expect(idList('  ')).toEqual([]);
    expect(idList('a, b\nc')).toEqual(['a', 'b', 'c']);
  });
});
