/**
 * functions/src/export-content.ts
 *
 * Pure content-resolution logic shared by the PDF and DOCX exporters.
 *
 * Two problems this solves (both found in the 2026-07-30 assessment):
 *
 *  1. Attorney edits live in `editorContent` (DocumentEditor.tsx flushes only
 *     that field), but both exporters read `htmlContent ?? content` — so edits
 *     made in the editor silently never reached an exported PDF or DOCX.
 *
 *  2. High-fidelity documents save the exact filled .docx binary to Storage
 *     (`hasBinary: true` + a `.docx` storagePath), but the DOCX exporter
 *     always rebuilt a new file from the HTML preview, discarding the
 *     preserved formatting. The binary must be served — but ONLY when the
 *     document is unedited, otherwise serving it would discard the edits.
 *
 * Precedence, encoded in resolveDocxExport():
 *   edited (editorContent diverged from content) → rebuild from the edits
 *   unedited + preserved binary                  → serve the stored .docx
 *   otherwise                                    → rebuild from HTML (legacy)
 *
 * "Unedited" is a conservative string comparison: saveDocumentToVault writes
 * `editorContent` and `content` as identical strings on every generation, and
 * only the editor diverges them. A false "edited" verdict (e.g. TipTap
 * re-serializing equivalent HTML differently) safely degrades to the old
 * rebuild path — it can never lose data.
 */

export const EXPORT_FALLBACK_HTML = '<p>No content available.</p>';

/** True when the HTML contains any real text after stripping tags. */
export function hasRealText(html: unknown): html is string {
  return (
    typeof html === 'string' &&
    html.replace(/<[^>]*>/g, '').trim().length > 0
  );
}

/**
 * The HTML that faithfully represents the document's current state:
 * attorney edits when they exist, generated content otherwise.
 */
export function resolveExportHtml(
  docData: Record<string, unknown>,
): string {
  if (hasRealText(docData.editorContent)) return docData.editorContent;
  if (hasRealText(docData.htmlContent)) return docData.htmlContent;
  if (hasRealText(docData.content)) return docData.content;
  return EXPORT_FALLBACK_HTML;
}

export type DocxExportPlan =
  | { kind: 'binary'; storagePath: string }
  | { kind: 'rebuild'; html: string };

/**
 * Decide how a DOCX export should be produced for this document.
 * Pure — no Firestore/Storage access; the caller verifies the binary
 * actually exists and falls back to rebuild if it doesn't.
 */
export function resolveDocxExport(
  docData: Record<string, unknown>,
): DocxExportPlan {
  const storagePath =
    typeof docData.storagePath === 'string' ? docData.storagePath : '';

  const hasPreservedBinary =
    docData.hasBinary === true && storagePath.toLowerCase().endsWith('.docx');

  // Edited = editorContent holds real text that differs from the generated
  // content. Blank/absent editorContent ("<p></p>" after some editor opens)
  // does not count as an edit.
  const edited =
    hasRealText(docData.editorContent) &&
    docData.editorContent !== docData.content;

  if (hasPreservedBinary && !edited) {
    return { kind: 'binary', storagePath };
  }
  return { kind: 'rebuild', html: resolveExportHtml(docData) };
}
