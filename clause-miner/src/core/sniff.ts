/**
 * Byte-level format detection + debris filter (§8, §3 Stage 0).
 *
 * Detection is by BYTES, never extension or Drive mimeType — the ".doc that
 * is actually RTF" case is the majority case in the legacy tranche, and the
 * repo's own SUPPORTED_MIME_TYPES whitelists are live proof that
 * extension/mime filtering silently drops the oldest files (§3 Stage 0).
 *
 * Pure module: operates on bytes/strings only. No GCP, no filesystem.
 */

export type SniffedFormat = 'rtf' | 'ole-doc' | 'docx' | 'wpd' | 'unknown';

/** `{\rtf1` — RTF, regardless of what the extension claims. */
const RTF_MAGIC = [0x7b, 0x5c, 0x72, 0x74, 0x66, 0x31]; // {\rtf1
/** OLE compound file (binary Word .doc, among others). */
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];
/** ZIP local-file header — candidate OOXML; the CALLER validates it is real OOXML. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04
/** WordPerfect (incl. WP 5.x/6.x). */
const WPD_MAGIC = [0xff, 0x57, 0x50, 0x43]; // \xFF W P C

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

/**
 * Sniff the format from leading bytes (§8).
 *
 * 'docx' means "ZIP container" — the conversion stage must still validate the
 * OOXML content types before passing it through unconverted.
 */
export function sniffFormat(bytes: Uint8Array): SniffedFormat {
  if (startsWith(bytes, RTF_MAGIC)) return 'rtf';
  if (startsWith(bytes, OLE_MAGIC)) return 'ole-doc';
  if (startsWith(bytes, ZIP_MAGIC)) return 'docx';
  if (startsWith(bytes, WPD_MAGIC)) return 'wpd';
  return 'unknown';
}

/**
 * Known debris to drop from the manifest (§3 Stage 0): Windows thumbnail
 * caches, Word autosave temp files, Windows shortcuts, WordPerfect wfx32
 * database artifacts, and WordPerfect backup files (*.BK!).
 *
 * Everything else that is not a folder or PDF is KEPT — no extension
 * whitelist exists anywhere in this pipeline by design.
 */
export function isDebris(fileName: string): boolean {
  const base = fileName.trim().toLowerCase();
  if (base === 'thumbs.db') return true;
  // Word autosave artifacts: ~WRL0001.tmp etc.
  if (/^~wrl.*\.tmp$/.test(base)) return true;
  if (base.endsWith('.lnk')) return true;
  // WordPerfect wfx32 file-management database artifacts.
  if (base.includes('wfx32')) return true;
  // WordPerfect backup files.
  if (base.endsWith('.bk!')) return true;
  return false;
}
