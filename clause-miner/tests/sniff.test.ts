import { describe, expect, it } from 'vitest';
import { isDebris, sniffFormat } from '../src/core/sniff.js';

function bytes(...values: Array<number | string>): Uint8Array {
  const out: number[] = [];
  for (const v of values) {
    if (typeof v === 'string') {
      for (const ch of v) out.push(ch.charCodeAt(0));
    } else {
      out.push(v);
    }
  }
  return Uint8Array.from(out);
}

describe('sniffFormat (§8: bytes, never extension)', () => {
  it('detects RTF from {\\rtf1 regardless of a .doc extension story', () => {
    expect(sniffFormat(bytes('{\\rtf1\\ansi\\deff0 {\\fonttbl...}'))).toBe('rtf');
  });

  it('detects OLE binary Word from D0 CF 11 E0', () => {
    expect(
      sniffFormat(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)),
    ).toBe('ole-doc');
  });

  it('detects ZIP/OOXML candidate from PK\\x03\\x04', () => {
    expect(sniffFormat(bytes('PK', 0x03, 0x04, 0x14, 0x00))).toBe('docx');
  });

  it('detects WordPerfect from FF 57 50 43 (incl. WP 5.x/6.x)', () => {
    expect(sniffFormat(bytes(0xff, 0x57, 0x50, 0x43, 0x10, 0x00))).toBe('wpd');
  });

  it('returns unknown for plain text', () => {
    expect(sniffFormat(bytes('LAST WILL AND TESTAMENT'))).toBe('unknown');
  });

  it('returns unknown for empty and too-short buffers', () => {
    expect(sniffFormat(bytes())).toBe('unknown');
    expect(sniffFormat(bytes(0xd0, 0xcf))).toBe('unknown');
  });

  it('does not confuse RTF prefix lookalikes', () => {
    expect(sniffFormat(bytes('{\\rt not rtf'))).toBe('unknown');
  });
});

describe('isDebris (§3 Stage 0 debris filter)', () => {
  it('drops Thumbs.db case-insensitively', () => {
    expect(isDebris('Thumbs.db')).toBe(true);
    expect(isDebris('THUMBS.DB')).toBe(true);
  });

  it('drops Word autosave ~WRL*.tmp artifacts', () => {
    expect(isDebris('~WRL0005.tmp')).toBe(true);
    expect(isDebris('~wrl3182.TMP')).toBe(true);
  });

  it('drops Windows shortcuts', () => {
    expect(isDebris('Smith Trust.lnk')).toBe(true);
  });

  it('drops WordPerfect wfx32 database artifacts', () => {
    expect(isDebris('wfx32.bfn')).toBe(true);
  });

  it('drops WordPerfect backups (*.BK!)', () => {
    expect(isDebris('JONES.BK!')).toBe(true);
  });

  it('keeps ordinary word-processing files, odd extensions included', () => {
    expect(isDebris('SMITH.WPD')).toBe(false);
    expect(isDebris('Doe Revocable Trust 2019.docx')).toBe(false);
    expect(isDebris('WILL~1.DOC')).toBe(false);
    expect(isDebris('trust.rtf')).toBe(false);
  });
});
