/**
 * tests/unit/export-content.test.ts
 *
 * Export content resolution — the precedence rules that decide what a
 * PDF/DOCX export is built from:
 *
 *   1. Attorney edits (editorContent) beat generated content. Before this
 *      module existed, both exporters read `htmlContent ?? content` and
 *      silently dropped every edit made in the document editor.
 *   2. An UNEDITED high-fidelity document exports its preserved .docx binary
 *      (the whole point of high-fidelity mode); an EDITED one falls back to
 *      the HTML rebuild so edits are never discarded.
 */

import { describe, it, expect } from 'vitest';
import {
  hasRealText,
  resolveExportHtml,
  resolveDocxExport,
  EXPORT_FALLBACK_HTML,
} from '../../functions/src/export-content';

const GENERATED = '<p>I, John Doe, being of sound mind…</p>';
const EDITED = '<p>I, John Doe, being of sound mind and body…</p>';
const BINARY_PATH = 'firms/f1/clients/c1/documents/will.docx';

describe('hasRealText', () => {
  it('rejects undefined, empty string, and tag-only HTML', () => {
    expect(hasRealText(undefined)).toBe(false);
    expect(hasRealText('')).toBe(false);
    expect(hasRealText('<p></p>')).toBe(false);
    expect(hasRealText('<p>  \n </p>')).toBe(false);
  });

  it('accepts HTML with any real text', () => {
    expect(hasRealText('<p>x</p>')).toBe(true);
  });
});

describe('resolveExportHtml — attorney edits beat generated content', () => {
  it('prefers editorContent when it has real text', () => {
    expect(
      resolveExportHtml({ editorContent: EDITED, htmlContent: GENERATED, content: GENERATED }),
    ).toBe(EDITED);
  });

  it('ignores blank editorContent ("<p></p>" after an editor open)', () => {
    expect(
      resolveExportHtml({ editorContent: '<p></p>', content: GENERATED }),
    ).toBe(GENERATED);
  });

  it('falls back htmlContent → content → placeholder', () => {
    expect(resolveExportHtml({ htmlContent: GENERATED })).toBe(GENERATED);
    expect(resolveExportHtml({ content: GENERATED })).toBe(GENERATED);
    expect(resolveExportHtml({})).toBe(EXPORT_FALLBACK_HTML);
  });
});

describe('resolveDocxExport — preserved binary vs rebuild', () => {
  it('serves the preserved binary for an unedited high-fidelity document', () => {
    // saveDocumentToVault writes content and editorContent as identical
    // strings on generation — that is the "unedited" signature.
    const plan = resolveDocxExport({
      hasBinary: true,
      storagePath: BINARY_PATH,
      content: GENERATED,
      editorContent: GENERATED,
    });
    expect(plan).toEqual({ kind: 'binary', storagePath: BINARY_PATH });
  });

  it('rebuilds from the edits when editorContent diverged — edits are never discarded', () => {
    const plan = resolveDocxExport({
      hasBinary: true,
      storagePath: BINARY_PATH,
      content: GENERATED,
      editorContent: EDITED,
    });
    expect(plan).toEqual({ kind: 'rebuild', html: EDITED });
  });

  it('treats blank editorContent as unedited, not as an edit', () => {
    const plan = resolveDocxExport({
      hasBinary: true,
      storagePath: BINARY_PATH,
      content: GENERATED,
      editorContent: '<p></p>',
    });
    expect(plan.kind).toBe('binary');
  });

  it('rebuilds when there is no binary (legacy HTML documents)', () => {
    const plan = resolveDocxExport({
      content: GENERATED,
      editorContent: GENERATED,
      storagePath: '',
    });
    expect(plan).toEqual({ kind: 'rebuild', html: GENERATED });
  });

  it('rebuilds when hasBinary is set but storagePath is not a .docx', () => {
    const plan = resolveDocxExport({
      hasBinary: true,
      storagePath: 'firms/f1/clients/c1/documents/will.html',
      content: GENERATED,
    });
    expect(plan.kind).toBe('rebuild');
  });
});
