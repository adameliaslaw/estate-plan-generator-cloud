/**
 * Wiring-level negative control for the PII stop-ship: runCatalog itself must
 * route blocked families through the scrub (finding C1 was precisely that the
 * write path never consulted piiScanStatus), and a re-run must SCRUB text that
 * an earlier, pre-stop-ship run already shipped — including stale variant docs
 * whose sigHashes are no longer in the family.
 */
import { describe, expect, it } from 'vitest';
import { runCatalog } from '../src/stages/catalog.js';
import { canonicalPath, catalogDocPath, edgesPath, statsPath } from '../src/paths.js';
import { FakeBlobStore, FakeDocStore, FakeEmbeddings, makeEnv } from './helpers/fakes.js';
import type { CanonicalFamily, CanonicalVariant } from '../src/stages/canonicalize.js';

function variant(sigHash: string): CanonicalVariant {
  return {
    sigHash,
    normText: `text of ${sigHash} naming JOHN Q CLIENT`,
    occurrenceCount: 2,
    matterCount: 1,
    eraRange: [2001, 2015],
    parameters: { beneficiary: ['JOHN Q CLIENT'] },
  };
}

function family(id: string, overrides: Partial<CanonicalFamily> = {}): CanonicalFamily {
  return {
    familyId: id,
    canonicalHash: `c_${id}`,
    canonicalText: `canonical text of ${id}`,
    title: `Family ${id}`,
    functionSummary: 'summary',
    category: 'general',
    switchName: `include_${id}`,
    fillContract: [],
    variants: [variant(`v_${id}`)],
    countingUnitCount: 5,
    piiScanStatus: 'clean',
    piiFindings: [],
    seedDivergent: false,
    labelError: null,
    executionBlock: false,
    relatedTo: [],
    positionMedian: 0.5,
    ...overrides,
  };
}

async function setup(families: CanonicalFamily[]) {
  const store = new FakeDocStore();
  const blobs = new FakeBlobStore();
  const env = makeEnv();
  await blobs.write(canonicalPath(env.firmId, env.runId), JSON.stringify(families));
  await blobs.write(edgesPath(env.firmId, env.runId), JSON.stringify([]));
  await blobs.write(statsPath(env.firmId, env.runId), JSON.stringify({ cards: [] }));
  return { store, blobs, env, deps: { store, blobs, embeddings: new FakeEmbeddings() } };
}

describe('runCatalog PII stop-ship', () => {
  it('ships text for clean families and none for blocked families', async () => {
    const { store, env, deps } = await setup([
      family('fam_clean'),
      family('fam_blocked', { piiScanStatus: 'blocked', piiFindings: ['JOHN Q CLIENT'] }),
    ]);
    await runCatalog(deps, env);

    const clean = await store.get(catalogDocPath(env.firmId, 'fam_clean'));
    expect(clean?.canonicalText).toBe('canonical text of fam_clean');
    expect(clean?.embedding).toBeDefined();
    const cleanVariant = await store.get(
      `${catalogDocPath(env.firmId, 'fam_clean')}/variants/v_fam_clean`,
    );
    expect(cleanVariant?.normText).toContain('v_fam_clean');

    const blocked = await store.get(catalogDocPath(env.firmId, 'fam_blocked'));
    expect(blocked).not.toBeNull();
    expect(blocked?.piiScanStatus).toBe('blocked');
    expect(blocked?.piiBlockedRedacted).toBe(true);
    for (const field of ['canonicalText', 'title', 'functionSummary', 'switchName', 'embedding', 'triggerCard']) {
      expect(blocked, field).not.toHaveProperty(field);
    }
    const blockedVariant = await store.get(
      `${catalogDocPath(env.firmId, 'fam_blocked')}/variants/v_fam_blocked`,
    );
    expect(blockedVariant).not.toBeNull();
    expect(blockedVariant).not.toHaveProperty('normText');
    expect(blockedVariant).not.toHaveProperty('parameters');
    expect(blockedVariant).not.toHaveProperty('mergeEdge');
  });

  it('scrubs text a pre-stop-ship run already shipped, including stale variant ids', async () => {
    const { store, env, deps } = await setup([
      family('fam_blocked', { piiScanStatus: 'blocked' }),
    ]);
    const docPath = catalogDocPath(env.firmId, 'fam_blocked');
    // Simulate the earlier run's leaked writes.
    await store.set(docPath, { canonicalText: 'LEAKED JOHN Q CLIENT', status: 'mined' });
    await store.set(`${docPath}/variants/v_fam_blocked`, { normText: 'LEAKED' });
    await store.set(`${docPath}/variants/v_gone_from_family`, { normText: 'LEAKED STALE' });

    await runCatalog(deps, env);

    const doc = await store.get(docPath);
    expect(doc).not.toHaveProperty('canonicalText');
    const current = await store.get(`${docPath}/variants/v_fam_blocked`);
    expect(current).not.toHaveProperty('normText');
    const stale = await store.get(`${docPath}/variants/v_gone_from_family`);
    expect(stale).toEqual({ piiBlockedRedacted: true });
  });

  it('still carries approved/removed status on a blocked family', async () => {
    const { store, env, deps } = await setup([
      family('fam_blocked', { piiScanStatus: 'blocked' }),
    ]);
    const docPath = catalogDocPath(env.firmId, 'fam_blocked');
    await store.set(docPath, { status: 'removed' });
    await runCatalog(deps, env);
    expect((await store.get(docPath))?.status).toBe('removed');
  });
});
