/**
 * §7.2 — counting units: one unit per (client matter, trust instrument).
 *
 * - Matter identity is VERIFIED, not assumed: same-name folders are
 *   confirmed same-client only if extracted party names agree (else suffixed
 *   distinct — the known duplicate-folder cases), and the same party-name
 *   join runs ACROSS trees (legacy-root vs mega-folder) to catch cross-tree
 *   duplicates.
 * - Drafts collapse via full-document SimHash ≥ 0.97 within a matter;
 *   the version pointer follows the _extractVersionLabel convention
 *   (functions/src/wills-processor.ts:359) with an execution-date tiebreak.
 * - Instrument distinction (original|restatement|amendment) comes from the
 *   Stage-2 triage classification.
 *
 * Pure module: metadata in, counting units out.
 */

import { createHash } from 'node:crypto';
import { config } from './config.js';
import { UnionFind } from './union-find.js';
import { hammingDistance64 } from './core/simhash.js';

export interface CountingUnitInput {
  driveFileId: string;
  /** Immediate parent folder name — the presumptive client name. */
  clientFolderName: string;
  /** Top-level attorney folder classification (adams|…|legacy-root). */
  attorneyFolder: string;
  /** Normalized party names from Stage-3 extraction. */
  partyNames: string[];
  instrumentKind: string;
  /** From filename/path, wills-processor convention. */
  versionLabel: string | null;
  executionDate: string | null;
  /** Full-document SimHash (hex string of the 64-bit value). */
  simhashHex: string;
}

export interface CountingUnit {
  countingUnitId: string;
  matterKey: string;
  attorneyFolder: string;
  instrumentKind: string;
  /** The version-pointer doc (§7.2). */
  representativeDriveFileId: string;
  memberDriveFileIds: string[];
}

/** Mirror of wills-processor._extractVersionLabel (verified). */
export function extractVersionLabel(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\bexecuted\b/.test(lower)) return 'executed';
  if (/\bfinal\b/.test(lower)) return 'final';
  if (/\bsigned\b/.test(lower)) return 'signed';
  const v = lower.match(/\bv(\d+)\b/);
  if (v !== null) return v[0];
  if (/\bdraft\b/.test(lower)) return 'draft';
  return null;
}

/** Higher = preferred as the version pointer. */
export function versionRank(label: string | null): number {
  if (label === 'executed') return 500;
  if (label === 'final') return 400;
  if (label === 'signed') return 300;
  if (label !== null && /^v\d+$/.test(label)) return 100 + Number(label.slice(1));
  if (label === 'draft') return 50;
  return 0;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedFolder(name: string): string {
  // Unlike party names, folder names keep digits — "Smith 1998" and
  // "Smith 2004" are different folders, not the same client.
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Multi-token party names only — a bare surname is too weak for a join. */
function joinableParties(parties: string[]): Set<string> {
  const out = new Set<string>();
  for (const p of parties) {
    const n = normalizeName(p);
    if (n.split(' ').length >= 2) out.add(n);
  }
  return out;
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

function matterKeyOf(memberIds: string[]): string {
  const h = createHash('sha256').update([...memberIds].sort().join('|'), 'utf8').digest('hex');
  return `m_${h.slice(0, 16)}`;
}

/**
 * §7.2 matter identity. Two docs share a matter iff:
 *  - same normalized client folder AND (party sets intersect, or at least
 *    one side has no joinable parties — folder evidence stands unrebutted); or
 *  - different folders but joinable party sets intersect (cross-tree join).
 * Same-folder docs with disjoint non-empty party sets stay DISTINCT
 * (the duplicate-folder case — "suffixed distinct").
 */
export function assignMatters(inputs: CountingUnitInput[]): Map<string, string> {
  const uf = new UnionFind();
  const parties = new Map<string, Set<string>>();
  for (const doc of inputs) {
    uf.add(doc.driveFileId);
    parties.set(doc.driveFileId, joinableParties(doc.partyNames));
  }
  for (let i = 0; i < inputs.length; i++) {
    for (let j = i + 1; j < inputs.length; j++) {
      const a = inputs[i];
      const b = inputs[j];
      const pa = parties.get(a.driveFileId) as Set<string>;
      const pb = parties.get(b.driveFileId) as Set<string>;
      const sameFolder = normalizedFolder(a.clientFolderName) === normalizedFolder(b.clientFolderName);
      if (sameFolder) {
        if (pa.size === 0 || pb.size === 0 || intersects(pa, pb)) {
          uf.union(a.driveFileId, b.driveFileId);
        }
        // else: same folder name, disagreeing parties — distinct matters.
      } else if (intersects(pa, pb)) {
        uf.union(a.driveFileId, b.driveFileId); // cross-tree join
      }
    }
  }
  const groups = uf.groups();
  const out = new Map<string, string>();
  for (const members of groups.values()) {
    const key = matterKeyOf(members);
    for (const m of members) out.set(m, key);
  }
  return out;
}

/**
 * Full counting-unit derivation: matter identity → per-(matter, instrument)
 * SimHash draft collapse (≥ config.countingUnits.simhashCollapse similarity,
 * single-link) → version pointer per §7.2.
 */
export function deriveCountingUnits(inputs: CountingUnitInput[]): CountingUnit[] {
  const matterOf = assignMatters(inputs);
  const byMatterInstrument = new Map<string, CountingUnitInput[]>();
  for (const doc of inputs) {
    const key = `${matterOf.get(doc.driveFileId) as string}::${doc.instrumentKind}`;
    const list = byMatterInstrument.get(key);
    if (list === undefined) byMatterInstrument.set(key, [doc]);
    else list.push(doc);
  }

  const maxHamming = Math.floor((1 - config.countingUnits.simhashCollapse) * 64);
  const units: CountingUnit[] = [];
  for (const [key, docs] of byMatterInstrument) {
    const [matterKey, instrumentKind] = key.split('::');
    const uf = new UnionFind();
    for (const d of docs) uf.add(d.driveFileId);
    for (let i = 0; i < docs.length; i++) {
      for (let j = i + 1; j < docs.length; j++) {
        const ha = BigInt(`0x${docs[i].simhashHex}`);
        const hb = BigInt(`0x${docs[j].simhashHex}`);
        if (hammingDistance64(ha, hb) <= maxHamming) {
          uf.union(docs[i].driveFileId, docs[j].driveFileId);
        }
      }
    }
    for (const members of uf.groups().values()) {
      const memberDocs = members.map(
        (id) => docs.find((d) => d.driveFileId === id) as CountingUnitInput,
      );
      const representative = [...memberDocs].sort((a, b) => {
        const rank = versionRank(b.versionLabel) - versionRank(a.versionLabel);
        if (rank !== 0) return rank;
        const dateA = a.executionDate ?? '';
        const dateB = b.executionDate ?? '';
        if (dateA !== dateB) return dateB.localeCompare(dateA); // latest wins
        return a.driveFileId.localeCompare(b.driveFileId);
      })[0];
      units.push({
        countingUnitId: `cu_${createHash('sha256')
          .update(`${matterKey}|${instrumentKind}|${members.sort().join('|')}`, 'utf8')
          .digest('hex')
          .slice(0, 16)}`,
        matterKey,
        attorneyFolder: representative.attorneyFolder,
        instrumentKind,
        representativeDriveFileId: representative.driveFileId,
        memberDriveFileIds: [...members].sort(),
      });
    }
  }
  return units.sort((a, b) => a.countingUnitId.localeCompare(b.countingUnitId));
}
