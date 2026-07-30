import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { runConvert, INFILTERS, PARSER_VERSION } from '../src/stages/convert.js';
import {
  convertedPath,
  fileDocPath,
  runLedgerPath,
  segmentsReadyPath,
  textPath,
} from '../src/paths.js';
import type { Env } from '../src/env.js';
import type { ShellResult } from '../src/clients/interfaces.js';
import {
  FakeBlobStore,
  FakeDocStore,
  FakeDrive,
  FakeShell,
  file,
  folder,
  shellFail,
  shellOk,
} from './helpers/fakes.js';

const env: Env = {
  firmId: 'firm1',
  runId: 'run1',
  rootFolderId: 'root',
  gcsBucket: 'bucket',
  anthropicApiKey: undefined,
  sampleLimit: undefined,
};

function docxBytes(text: string): Buffer {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="ns"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
  return Buffer.from(
    zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8(xml) }),
  );
}

const RTF_BYTES = Buffer.from(String.raw`{\rtf1\ansi ARTICLE I. Trust Estate.\par Body text here.\par}`, 'latin1');
const OLE_BYTES = Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.from('binary word doc payload'),
]);

function setup(nodes: ReturnType<typeof file>[], shellHandler: (cmd: string, args: string[]) => ShellResult) {
  const store = new FakeDocStore();
  const blobs = new FakeBlobStore();
  const drive = new FakeDrive(folder('root', 'Root', nodes));
  const shell = new FakeShell(shellHandler);
  return { store, blobs, drive, shell };
}

async function manifestRow(store: FakeDocStore, id: string, fileName: string): Promise<void> {
  await store.set(fileDocPath('firm1', 'run1', id), {
    status: 'manifested',
    fileName,
    drivePath: 'Adam/Client',
    attorneyFolder: 'adams',
  });
}

describe('runConvert (Stage 1, §8)', () => {
  it('passes real OOXML through without soffice and persists all artifacts', async () => {
    const bytes = docxBytes('Hello Trust');
    const { store, blobs, drive, shell } = setup(
      [file('d1', 'trust.docx', { bytes })],
      () => shellOk,
    );
    await manifestRow(store, 'd1', 'trust.docx');
    const summary = await runConvert(
      { drive, store, blobs, shell, tmpRoot: mkdtempSync(join(tmpdir(), 'cm-test-')) },
      env,
    );
    expect(summary.passthrough).toBe(1);
    expect(shell.calls).toHaveLength(0); // no soffice for valid OOXML
    expect(await blobs.exists(convertedPath('firm1', 'd1'))).toBe(true);
    expect((await blobs.read(textPath('firm1', 'd1'))).toString('utf8')).toBe('Hello Trust');
    const ready = JSON.parse((await blobs.read(segmentsReadyPath('firm1', 'd1'))).toString('utf8'));
    expect(ready.parserVersion).toBe(PARSER_VERSION);
    expect(ready.structureConfidence).toBe('ooxml');
    const row = store.docs.get(fileDocPath('firm1', 'run1', 'd1'));
    expect(row?.status).toBe('converted');
    expect(row?.sniffedFormat).toBe('docx');
  });

  it('falls back to in-repo RTF text extraction when soffice fails (structureConfidence none)', async () => {
    const { store, blobs, drive, shell } = setup(
      [file('r1', 'letter.doc', { bytes: RTF_BYTES })], // .doc that is actually RTF
      (cmd) => (cmd === 'soffice' ? shellFail : shellOk),
    );
    await manifestRow(store, 'r1', 'letter.doc');
    const summary = await runConvert(
      { drive, store, blobs, shell, tmpRoot: mkdtempSync(join(tmpdir(), 'cm-test-')) },
      env,
    );
    expect(summary.fallbackText).toBe(1);
    const row = store.docs.get(fileDocPath('firm1', 'run1', 'r1'));
    expect(row?.status).toBe('converted');
    expect(row?.sniffedFormat).toBe('rtf'); // bytes beat the .doc extension
    expect(row?.structureConfidence).toBe('none');
    expect(row?.convertedVia).toBe('rtf-text');
    const text = (await blobs.read(textPath('firm1', 'r1'))).toString('utf8');
    expect(text).toContain('ARTICLE I. Trust Estate.');
  });

  it('uses antiword for real OLE .doc when soffice fails', async () => {
    const { store, blobs, drive, shell } = setup(
      [file('o1', 'old.doc', { bytes: OLE_BYTES })],
      (cmd) =>
        cmd === 'antiword'
          ? { code: 0, stdout: 'Extracted legacy text.', stderr: '', timedOut: false }
          : shellFail,
    );
    await manifestRow(store, 'o1', 'old.doc');
    const summary = await runConvert(
      { drive, store, blobs, shell, tmpRoot: mkdtempSync(join(tmpdir(), 'cm-test-')) },
      env,
    );
    expect(summary.fallbackText).toBe(1);
    expect((await blobs.read(textPath('firm1', 'o1'))).toString('utf8')).toContain(
      'Extracted legacy text.',
    );
    expect(store.docs.get(fileDocPath('firm1', 'run1', 'o1'))?.convertedVia).toBe('antiword');
  });

  it('writes an error record when the whole ladder fails — never silent', async () => {
    const { store, blobs, drive, shell } = setup(
      [file('o2', 'broken.doc', { bytes: OLE_BYTES })],
      () => shellFail,
    );
    await manifestRow(store, 'o2', 'broken.doc');
    const summary = await runConvert(
      { drive, store, blobs, shell, tmpRoot: mkdtempSync(join(tmpdir(), 'cm-test-')) },
      env,
    );
    expect(summary.errors).toBe(1);
    const row = store.docs.get(fileDocPath('firm1', 'run1', 'o2'));
    expect(row?.status).toBe('error');
    expect(row?.needs_human_review).toBe(true);
    expect(String(row?.processing_error)).toContain('ladder exhausted');
  });

  it('records unknown formats in the ledger, not silently', async () => {
    const { store, blobs, drive, shell } = setup(
      [file('u1', 'mystery.xyz', { bytes: Buffer.from('no known magic here') })],
      () => shellOk,
    );
    await manifestRow(store, 'u1', 'mystery.xyz');
    const summary = await runConvert(
      { drive, store, blobs, shell, tmpRoot: mkdtempSync(join(tmpdir(), 'cm-test-')) },
      env,
    );
    expect(summary.unrecognized).toBe(1);
    expect(store.docs.get(fileDocPath('firm1', 'run1', 'u1'))?.status).toBe('unrecognized-format');
    const ledger = store.docs.get(runLedgerPath('firm1', 'run1'));
    const convert = ledger?.convert as { unrecognizedFormats: Record<string, number> };
    expect(convert.unrecognizedFormats.xyz).toBe(1);
  });

  it('invokes soffice with explicit --infilter and per-invocation profile, and consumes its output', async () => {
    const { store, blobs, drive } = setup([], () => shellOk);
    const driveWithRtf = new FakeDrive(
      folder('root', 'Root', [file('s1', 'trust.rtf', { bytes: RTF_BYTES })]),
    );
    const shell = new FakeShell((cmd, args) => {
      if (cmd !== 'soffice') return shellFail;
      const outDir = args[args.indexOf('--outdir') + 1];
      writeFileSync(join(outDir, 's1.docx'), docxBytes('Converted content'));
      return shellOk;
    });
    await manifestRow(store, 's1', 'trust.rtf');
    const summary = await runConvert(
      { drive: driveWithRtf, store, blobs, shell, tmpRoot: mkdtempSync(join(tmpdir(), 'cm-test-')) },
      env,
    );
    void drive;
    expect(summary.converted).toBe(1);
    const call = shell.calls.find((c) => c.cmd === 'soffice');
    expect(call?.args).toContain(`--infilter=${INFILTERS.rtf as string}`);
    expect(call?.args.some((a) => a.startsWith('-env:UserInstallation=file://'))).toBe(true);
    expect((await blobs.read(textPath('firm1', 's1'))).toString('utf8')).toBe('Converted content');
    expect(store.docs.get(fileDocPath('firm1', 'run1', 's1'))?.structureConfidence).toBe('ooxml');
  });

  it('is resumable: converted rows are skipped', async () => {
    const { store, blobs, drive, shell } = setup([], () => shellOk);
    await store.set(fileDocPath('firm1', 'run1', 'done1'), { status: 'converted' });
    const summary = await runConvert(
      { drive, store, blobs, shell, tmpRoot: mkdtempSync(join(tmpdir(), 'cm-test-')) },
      env,
    );
    expect(summary.skipped).toBe(1);
    expect(summary.converted + summary.passthrough + summary.fallbackText).toBe(0);
  });
});
