import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEED_FOLDER_NAMES,
  formatPreflight,
  interpretPreflight,
  runPreflight,
  type PreflightReport,
} from '../src/stages/preflight.js';
import { runLedgerPath } from '../src/paths.js';
import { FakeDocStore, FakeDrive, file, folder, makeEnv } from './helpers/fakes.js';
import type { FolderMatch } from '../src/clients/interfaces.js';

const env = makeEnv();

function tree(opts: { seedName?: string; duplicate?: boolean; empty?: boolean } = {}) {
  if (opts.empty === true) return folder('root', 'Wills and Trusts', []);
  const seedName = opts.seedName ?? 'AAA WILL PIECES';
  return folder('root', 'Wills and Trusts', [
    folder('f-adam', 'Adam Files', [
      file('doc1', 'DoeTrust.doc', {
        mimeType: 'application/msword',
        bytes: Buffer.from('{\\rtf1 hello'),
      }),
    ]),
    folder('f-seed', seedName, []),
    folder('f-canary', 'Trust Agreements', []),
    ...(opts.duplicate === true ? [folder('f-seed-dup', seedName, [])] : []),
  ]);
}

async function run(driveTree = tree(), identity: string | null = 'miner@epg.iam.gserviceaccount.com') {
  const store = new FakeDocStore();
  const report = await runPreflight({ drive: new FakeDrive(driveTree, identity), store }, env);
  return { store, report };
}

describe('runPreflight (§11 P0.1)', () => {
  it('reports READY when the grant works and both seed folders resolve', async () => {
    const { report } = await run();
    expect(report.ready).toBe(true);
    expect(report.rootReadable).toBe(true);
    expect(report.seedFolders['AAA WILL PIECES']).toHaveLength(1);
    expect(report.seedFolders['Trust Agreements'][0].id).toBe('f-canary');
  });

  it('probes an actual byte read, not just a listing', async () => {
    // Listing and downloading are different permissions in practice. Stage 1
    // opens with an 8-byte Range request, so that is what gets probed.
    const { report } = await run();
    expect(report.downloadProbe.attempted).toBe(true);
    expect(report.downloadProbe.ok).toBe(true);
    expect(report.downloadProbe.fileName).toBe('DoeTrust.doc');
  });

  it('descends to find a probe file when the root has only folders', async () => {
    const { report } = await run();
    // The only file lives one level down, inside "Adam Files".
    expect(report.rootChildFiles).toBe(0);
    expect(report.downloadProbe.ok).toBe(true);
  });

  it('BLOCKS and names the identity when the root cannot be read', async () => {
    const store = new FakeDocStore();
    // FakeDrive throws 403 for a folder it does not hold.
    const report = await runPreflight(
      { drive: new FakeDrive(folder('other', 'Elsewhere', []), 'miner@epg.iam.gserviceaccount.com'), store },
      env,
    );
    expect(report.ready).toBe(false);
    expect(report.rootReadable).toBe(false);
    expect(report.findings.join('\n')).toContain('miner@epg.iam.gserviceaccount.com');
    expect(report.nextSteps.join('\n')).toContain('as Viewer');
  });

  it('points at the wills pipeline when the grant is missing — the likely cause', async () => {
    const store = new FakeDocStore();
    const report = await runPreflight(
      { drive: new FakeDrive(folder('other', 'Elsewhere', []), null), store },
      env,
    );
    expect(report.nextSteps.join('\n')).toContain('wills-backfill');
    expect(report.findings.join('\n')).toContain('UNKNOWN');
  });

  it('BLOCKS on a readable but EMPTY root — that is not a pass', async () => {
    const { report } = await run(tree({ empty: true }));
    expect(report.rootReadable).toBe(true);
    expect(report.ready).toBe(false);
    expect(report.findings.join('\n')).toContain('contains NOTHING this account can see');
  });

  it('BLOCKS on duplicate folder names and makes a human choose', async () => {
    // Pointing the seed exclusion at the wrong "AAA WILL PIECES" would
    // silently mis-scope the gold set and the canary.
    const { report } = await run(tree({ duplicate: true }));
    expect(report.ready).toBe(false);
    const findings = report.findings.join('\n');
    expect(findings).toContain('2 folders named');
    expect(findings).toContain('f-seed-dup');
    expect(report.nextSteps.join('\n')).toContain('Choose which');
  });

  it('BLOCKS when a seed folder is not visible at all', async () => {
    const { report } = await run(tree({ seedName: 'Some Other Name' }));
    expect(report.ready).toBe(false);
    expect(report.findings.join('\n')).toContain('No folder named "AAA WILL PIECES"');
  });

  it('writes the ledger with a blocked status when not ready', async () => {
    const { store } = await run(tree({ empty: true }));
    const ledger = await store.get(runLedgerPath(env.firmId, env.runId));
    expect(ledger?.stage).toBe('preflight');
    expect(ledger?.status).toBe('blocked');
  });

  it('searches the configured names when overridden', async () => {
    const store = new FakeDocStore();
    const custom = makeEnv({ seedFolderNames: ['Trust Agreements'] });
    const report = await runPreflight({ drive: new FakeDrive(tree()), store }, custom);
    expect(Object.keys(report.seedFolders)).toEqual(['Trust Agreements']);
    expect(report.ready).toBe(true);
  });
});

describe('folder visibility vs emptiness (the Drive trap)', () => {
  it('reports NOT VISIBLE when the folder cannot be fetched', async () => {
    // FakeDrive holds only the tree it was given, so an unknown id is
    // invisible — the same shape as a folder that was never shared.
    const store = new FakeDocStore();
    const report = await runPreflight(
      { drive: new FakeDrive(folder('other', 'Elsewhere', [])), store },
      env,
    );
    expect(report.rootFolder).toBeNull();
    expect(report.ready).toBe(false);
    const findings = report.findings.join('\n');
    expect(findings).toContain('NOT VISIBLE');
    expect(report.nextSteps.join('\n')).toContain('as Viewer');
  });

  it('names the folder when it IS visible — proving the id points where we think', async () => {
    const { report } = await run();
    expect(report.rootFolder?.name).toBe('Wills and Trusts');
    expect(report.findings.join('\n')).toContain('named "Wills and Trusts"');
  });

  it('distinguishes a visible-but-empty folder from an invisible one', async () => {
    // Visible and genuinely empty: the message must blame CONTENTS sharing,
    // not folder sharing — sending someone to re-share a folder they already
    // shared is how a diagnostic wastes a human round trip.
    const { report } = await run(tree({ empty: true }));
    expect(report.rootFolder?.name).toBe('Wills and Trusts');
    expect(report.ready).toBe(false);
    const findings = report.findings.join('\n');
    expect(findings).toContain('contains NOTHING this account can see');
    expect(findings).not.toContain('NOT VISIBLE');
  });

  it('explains the empty listing when the folder is invisible', async () => {
    // The production shape: Drive does NOT error for an unshared folder, it
    // returns nothing. Without the getFolder check that is indistinguishable
    // from success on an empty corpus.
    const store = new FakeDocStore();
    const report = await runPreflight(
      { drive: new FakeDrive(folder('other', 'Elsewhere', []), 'sa@x.iam.gserviceaccount.com', true), store },
      env,
    );
    expect(report.rootReadable).toBe(true); // the listing "succeeded"…
    expect(report.rootFolder).toBeNull(); // …but the folder is not visible
    expect(report.ready).toBe(false);
    const findings = report.findings.join('\n');
    expect(findings).toContain('empty list rather than an error');
    // The report must not contradict itself: no ✅ readable beside ❌ NOT VISIBLE.
    expect(findings).toContain('NOT VISIBLE');
    expect(findings).not.toContain('✅ Root folder readable');
  });
});

describe('interpretPreflight', () => {
  const base = {
    identity: 'miner@epg.iam.gserviceaccount.com',
    rootFolderId: 'root',
    rootFolder: { id: 'root', name: 'Wills and Trusts' },
    rootReadable: true,
    rootError: null,
    rootChildFolders: 3,
    rootChildFiles: 1,
    downloadProbe: { attempted: true, ok: true, fileName: 'a.doc', error: null },
    seedFolders: {
      'AAA WILL PIECES': [{ id: 'f1', name: 'AAA WILL PIECES', parentNames: ['Wills and Trusts'] }],
      'Trust Agreements': [{ id: 'f2', name: 'Trust Agreements', parentNames: ['Wills and Trusts'] }],
    } as Record<string, FolderMatch[]>,
  };

  it('BLOCKS when listing succeeds but download fails', async () => {
    // A metadata-only grant passes every check that does not read bytes, then
    // fails on Stage 1's first file.
    const result = interpretPreflight(
      {
        ...base,
        downloadProbe: { attempted: true, ok: false, fileName: 'a.doc', error: '403 forbidden' },
      },
      DEFAULT_SEED_FOLDER_NAMES,
    );
    expect(result.ready).toBe(false);
    expect(result.findings.join('\n')).toContain('DOWNLOAD fails');
    expect(result.nextSteps.join('\n')).toContain('download-restriction');
  });

  it('gives the exact next command when everything is clear', () => {
    const result = interpretPreflight(base, DEFAULT_SEED_FOLDER_NAMES);
    expect(result.ready).toBe(true);
    expect(result.nextSteps.join('\n')).toContain('CLAUSE_MINER_SEED_FOLDER_IDS');
    expect(result.nextSteps.join('\n')).toContain('SAMPLE_LIMIT=60');
  });
});

describe('formatPreflight', () => {
  it('leads with READY or BLOCKED so the log is skimmable', () => {
    const report = {
      ...({} as PreflightReport),
      ready: false,
      findings: ['a finding'],
      nextSteps: ['a step'],
    } as PreflightReport;
    const text = formatPreflight(report);
    expect(text).toContain('BLOCKED');
    expect(text).toContain('a finding');
    expect(text).toContain('1. a step');
  });
});
