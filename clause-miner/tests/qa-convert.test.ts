import { describe, expect, it } from 'vitest';
import { formatQaConvert, runQaConvert } from '../src/stages/qa-convert.js';
import { PARSER_VERSION, type SegmentsReadyFile } from '../src/stages/convert.js';
import { fileDocPath, segmentsReadyPath } from '../src/paths.js';
import { FakeBlobStore, FakeDocStore, makeEnv } from './helpers/fakes.js';

const env = makeEnv();

function segments(paragraphs: SegmentsReadyFile['paragraphs']): string {
  return JSON.stringify({
    parserVersion: PARSER_VERSION,
    structureConfidence: 'ooxml',
    paragraphs,
  } satisfies SegmentsReadyFile);
}

function para(text: string, over: Partial<SegmentsReadyFile['paragraphs'][number]> = {}) {
  return { text, styleId: null, numIlvl: null, inTable: false, bold: false, centered: false, ...over };
}

async function seedConverted(
  store: FakeDocStore,
  blobs: FakeBlobStore,
  id: string,
  doc: Record<string, unknown>,
  paragraphs: SegmentsReadyFile['paragraphs'],
): Promise<void> {
  await store.set(fileDocPath(env.firmId, env.runId, id), {
    status: 'converted',
    fileName: `${id}.doc`,
    attorneyFolder: 'adams',
    sniffedFormat: 'ole-doc',
    convertedVia: 'soffice',
    structureConfidence: 'ooxml',
    ...doc,
  });
  await blobs.write(segmentsReadyPath(env.firmId, id), segments(paragraphs));
}

describe('qa-convert stage', () => {
  it('reports errors distinctly from healthy files, with the recorded reason', async () => {
    const store = new FakeDocStore();
    const blobs = new FakeBlobStore();
    await store.set(fileDocPath(env.firmId, env.runId, 'bad1'), {
      status: 'error',
      fileName: 'BROKEN.WPD',
      drivePath: 'Wills and Trusts/X',
      processing_error: 'conversion ladder exhausted (soffice: crash)',
    });
    const sentence = 'This paragraph is a full operative sentence of ordinary length for a trust document.';
    await seedConverted(store, blobs, 'ok1', {}, [
      para('ARTICLE I'),
      para(sentence),
    ]);

    const report = await runQaConvert({ store, blobs }, env);
    expect(report.files).toBe(2);
    expect(report.errors).toEqual([
      {
        fileName: 'BROKEN.WPD',
        drivePath: 'Wills and Trusts/X',
        error: 'conversion ladder exhausted (soffice: crash)',
      },
    ]);
    expect(report.diags).toHaveLength(1);
    const text = formatQaConvert(report);
    expect(text).toContain('BROKEN.WPD');
    expect(text).toContain('conversion ladder exhausted');
  });

  it('flags zero-boundary, hard-wrapped, and rtf-no-bold files by name', async () => {
    const store = new FakeDocStore();
    const blobs = new FakeBlobStore();
    // Hard-wrapped: many short lines without sentence punctuation, no headings.
    await seedConverted(
      store,
      blobs,
      'wrap1',
      { fileName: 'OLD.WIL.doc', sniffedFormat: 'rtf' },
      Array.from({ length: 20 }, (_, i) => para(`short line ${i} without ending`)),
    );
    const report = await runQaConvert({ store, blobs }, env);
    expect(report.hardWrappedFiles).toEqual(['OLD.WIL.doc']);
    expect(report.noBoundaryFiles).toEqual(['OLD.WIL.doc']);
    expect(report.underSegmentedFiles).toEqual(['OLD.WIL.doc']);
    expect(report.rtfNoBoldFiles).toEqual(['OLD.WIL.doc']);
  });

  it('distinguishes Schedule A with values from the $10-and-other-property case', async () => {
    const store = new FakeDocStore();
    const blobs = new FakeBlobStore();
    await seedConverted(store, blobs, 'v1', { fileName: 'VAL.docx' }, [
      para('SCHEDULE A'),
      para('123 Main Street, valued at $450,000.'),
    ]);
    await seedConverted(store, blobs, 'n1', { fileName: 'NOVAL.docx' }, [
      para('SCHEDULE A'),
      para('Ten Dollars ($10) and other good and valuable property.'),
    ]);
    await seedConverted(store, blobs, 'a1', { fileName: 'NOSCHED.docx' }, [
      para('ARTICLE I'),
      para('This trust has no schedule at all.'),
    ]);
    const report = await runQaConvert({ store, blobs }, env);
    expect(report.scheduleA).toEqual({ absent: 1, noValues: 1, hasValues: 1 });
  });

  it('counts style/numbering boundaries, not only text grammar', async () => {
    const store = new FakeDocStore();
    const blobs = new FakeBlobStore();
    const sentence = 'The trustee shall hold, administer and distribute the trust estate as follows.';
    await seedConverted(store, blobs, 's1', { fileName: 'IL.docx' }, [
      para('Trust Property', { styleId: 'TR_Head1' }),
      para(sentence),
      para('Distributions', { numIlvl: 0 }),
      para(sentence),
    ]);
    const report = await runQaConvert({ store, blobs }, env);
    expect(report.diags[0].boundaries).toBe(2);
    expect(report.noBoundaryFiles).toEqual([]);
  });
});
