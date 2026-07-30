/**
 * §7.2 — 64-bit SimHash for full-document draft collapse: drafts of the same
 * instrument within a matter collapse at similarity ≥ 0.97 into one counting
 * unit. Deterministic (FNV-1a 64-bit over word 3-gram shingles).
 *
 * Pure module: strings in, bigint out.
 */

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

export function fnv1a64(s: string): bigint {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * FNV_PRIME) & MASK64;
  }
  return h;
}

const SHINGLE_K = 3;

function features(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length <= SHINGLE_K) return words.length > 0 ? [words.join(' ')] : [];
  const out: string[] = [];
  for (let i = 0; i + SHINGLE_K <= words.length; i++) {
    out.push(words.slice(i, i + SHINGLE_K).join(' '));
  }
  return out;
}

/** 64-bit SimHash of a document's text. */
export function simhash(text: string): bigint {
  const counts = new Array<number>(64).fill(0);
  for (const feature of features(text)) {
    const h = fnv1a64(feature);
    for (let bit = 0; bit < 64; bit++) {
      if (((h >> BigInt(bit)) & 1n) === 1n) counts[bit] += 1;
      else counts[bit] -= 1;
    }
  }
  let out = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (counts[bit] > 0) out |= 1n << BigInt(bit);
  }
  return out;
}

export function hammingDistance64(a: bigint, b: bigint): number {
  let x = (a ^ b) & MASK64;
  let count = 0;
  while (x > 0n) {
    x &= x - 1n;
    count += 1;
  }
  return count;
}

/** Similarity in [0,1]: 1 - hamming/64. §7.2 collapse threshold is ≥ 0.97. */
export function simhashSimilarity(a: bigint, b: bigint): number {
  return 1 - hammingDistance64(a, b) / 64;
}
