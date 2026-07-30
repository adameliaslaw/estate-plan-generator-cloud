import { describe, expect, it } from 'vitest';
import {
  classifyAttorneyFolder,
  fileExtension,
  runManifest,
  stratifiedSample,
  type ManifestRow,
} from '../src/stages/manifest.js';
import { fileDocPath, filesCollection, runLedgerPath } from '../src/paths.js';
import type { Env } from '../src/env.js';
import { FakeDocStore, FakeDrive, file, folder } from './helpers/fakes.js';

const env: Env = {
  firmId: 'firm1',
  runId: 'run1',
  rootFolderId: 'root',
  gcsBucket: 'bucket',
  anthropicApiKey: undefined,
  sampleLimit: undefined,
};

function tree() {
  return folder('root', 'Wills and Trusts', [
    folder('f-adam', 'Adam Files', [
      file('doc1', 'DoeTrust.doc', { mimeType: 'application/msword', size: 100 }),
      file('doc2', 'scan.pdf', { mimeType: 'application/pdf' }), // PDF by mime
      file('doc3', 'weird.PDF', { mimeType: 'application/octet-stream' }), // PDF by extension
      file('doc4', 'Thumbs.db'), // debris
      file('doc5', 'oldfile.wpd', { mimeType: 'application/octet-stream' }),
    ]),
    folder('f-george', 'George Legacy', [
      file('doc6', 'RoeTrust.rtf', { canDownload: false, ownedByMe: false }),
    ]),
    file('doc7', 'loose-legacy.doc', { mimeType: 'application/msword' }),
  ]);
}

describe('classifyAttorneyFolder', () => {
  it('matches top-level folder names case-insensitively', () => {
    expect(classifyAttorneyFolder('Adam Files')).toBe('adams');
    expect(classifyAttorneyFolder('GEORGE Legacy')).toBe('george');
    expect(classifyAttorneyFolder('Jerome Clients')).toBe('jerome');
    expect(classifyAttorneyFolder('elizabeth-matters')).toBe('elizabeth');
    expect(classifyAttorneyFolder('Old Stuff')).toBe('legacy-root');
    expect(classifyAttorneyFolder(null)).toBe('legacy-root');
  });
});

describe('fileExtension', () => {
  it('lowercases and handles 8.3-era oddities', () => {
    expect(fileExtension('TRUST.DOC')).toBe('doc');
    expect(fileExtension('backup.BK!')).toBe('bk!');
    expect(fileExtension('noext')).toBe('(none)');
  });
});

describe('runManifest (Stage 0)', () => {
  it('applies the sniff-everything filter: keeps everything but PDFs and debris', async () => {
    const store = new FakeDocStore();
    const summary = await runManifest({ drive: new FakeDrive(tree()), store }, env);
    expect(summary.discovered).toBe(7);
    expect(summary.pdfExcluded).toBe(2);
    expect(summary.debrisSkipped).toBe(1);
    expect(summary.manifested).toBe(3); // doc1, doc5, doc7
    expect(summary.shareRequired).toBe(1); // doc6

    // The .wpd with octet-stream mime is KEPT — no whitelist exists.
    const wpd = store.docs.get(fileDocPath('firm1', 'run1', 'doc5'));
    expect(wpd?.status).toBe('manifested');
    expect(wpd?.attorneyFolder).toBe('adams');

    // File directly under root is legacy-root.
    const loose = store.docs.get(fileDocPath('firm1', 'run1', 'doc7'));
    expect(loose?.attorneyFolder).toBe('legacy-root');
  });

  it('records unreadable files as share-required — never silently excluded', async () => {
    const store = new FakeDocStore();
    await runManifest({ drive: new FakeDrive(tree()), store }, env);
    const row = store.docs.get(fileDocPath('firm1', 'run1', 'doc6'));
    expect(row?.status).toBe('share-required');
    expect(row?.externalOwner).toBe(true);
    const ledger = store.docs.get(runLedgerPath('firm1', 'run1'));
    const manifest = ledger?.manifest as { shareRequestList: string[] };
    expect(manifest.shareRequestList).toHaveLength(1);
    expect(manifest.shareRequestList[0]).toContain('doc6');
  });

  it('is resumable: already-manifested rows are not rewritten', async () => {
    const store = new FakeDocStore();
    await store.set(fileDocPath('firm1', 'run1', 'doc1'), {
      status: 'converted', // downstream progress must survive re-manifest
      customMarker: true,
    });
    await runManifest({ drive: new FakeDrive(tree()), store }, env);
    const row = store.docs.get(fileDocPath('firm1', 'run1', 'doc1'));
    expect(row?.status).toBe('converted');
    expect(row?.customMarker).toBe(true);
  });

  it('honors SAMPLE_LIMIT with stratification', async () => {
    const store = new FakeDocStore();
    await runManifest(
      { drive: new FakeDrive(tree()), store },
      { ...env, sampleLimit: 2 },
    );
    const ids = await store.listIds(filesCollection('firm1', 'run1'));
    expect(ids).toHaveLength(2);
  });
});

describe('stratifiedSample', () => {
  function row(id: string, attorneyFolder: ManifestRow['attorneyFolder']): ManifestRow {
    return {
      driveFileId: id,
      drivePath: 'p',
      fileName: `${id}.doc`,
      size: 1,
      driveMime: 'application/msword',
      md5Checksum: null,
      attorneyFolder,
      externalOwner: false,
      status: 'manifested',
    };
  }

  it('round-robins across attorney folders deterministically', () => {
    const rows = [
      row('a1', 'adams'), row('a2', 'adams'), row('a3', 'adams'),
      row('g1', 'george'),
      row('l1', 'legacy-root'), row('l2', 'legacy-root'),
    ];
    const sample = stratifiedSample(rows, 4);
    expect(sample.map((r) => r.driveFileId)).toEqual(['a1', 'g1', 'l1', 'a2']);
  });

  it('handles a limit above the population', () => {
    const rows = [row('a1', 'adams'), row('g1', 'george')];
    expect(stratifiedSample(rows, 10)).toHaveLength(2);
  });
});
