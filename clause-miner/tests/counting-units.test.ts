import { describe, expect, it } from 'vitest';
import { simhash } from '../src/core/simhash.js';
import {
  assignMatters,
  deriveCountingUnits,
  extractVersionLabel,
  versionRank,
  type CountingUnitInput,
} from '../src/counting-units.js';

function doc(overrides: Partial<CountingUnitInput> & { driveFileId: string }): CountingUnitInput {
  return {
    clientFolderName: 'Doe, John',
    attorneyFolder: 'adams',
    partyNames: ['John Doe'],
    instrumentKind: 'original',
    versionLabel: null,
    executionDate: null,
    simhashHex: simhash(`document body of ${overrides.driveFileId}`).toString(16),
    ...overrides,
  };
}

describe('extractVersionLabel (wills-processor mirror)', () => {
  it('follows the priority convention', () => {
    expect(extractVersionLabel('Doe Trust EXECUTED 2019.doc')).toBe('executed');
    expect(extractVersionLabel('trust FINAL v2')).toBe('final'); // final beats vN
    expect(extractVersionLabel('trust signed copy')).toBe('signed');
    expect(extractVersionLabel('trust v3 clean')).toBe('v3');
    expect(extractVersionLabel('trust draft')).toBe('draft');
    expect(extractVersionLabel('trust')).toBeNull();
  });

  it('versionRank orders executed > final > signed > vN > draft > null', () => {
    const ranks = ['executed', 'final', 'signed', 'v9', 'draft', null].map(versionRank);
    for (let i = 1; i < ranks.length; i++) expect(ranks[i - 1]).toBeGreaterThan(ranks[i]);
    expect(versionRank('v3')).toBeGreaterThan(versionRank('v2'));
  });
});

describe('assignMatters (§7.2 — verified matter identity)', () => {
  it('same folder + agreeing parties → one matter', () => {
    const matters = assignMatters([
      doc({ driveFileId: 'a', partyNames: ['John Q Doe', 'Mary Doe'] }),
      doc({ driveFileId: 'b', partyNames: ['John Q Doe'] }),
    ]);
    expect(matters.get('a')).toBe(matters.get('b'));
  });

  it('same folder name + DISJOINT parties → distinct matters (duplicate-folder case)', () => {
    const matters = assignMatters([
      doc({ driveFileId: 'a', clientFolderName: 'Smith', partyNames: ['John Smith'] }),
      doc({ driveFileId: 'b', clientFolderName: 'Smith', partyNames: ['Robert Smith'] }),
    ]);
    expect(matters.get('a')).not.toBe(matters.get('b'));
  });

  it('same folder + one side has no extracted parties → folder evidence stands', () => {
    const matters = assignMatters([
      doc({ driveFileId: 'a', partyNames: ['John Doe'] }),
      doc({ driveFileId: 'b', partyNames: [] }),
    ]);
    expect(matters.get('a')).toBe(matters.get('b'));
  });

  it('cross-tree join: legacy-root and mega-folder docs join on party names', () => {
    const matters = assignMatters([
      doc({
        driveFileId: 'a',
        clientFolderName: 'Doe John 1998',
        attorneyFolder: 'legacy-root',
        partyNames: ['John Q. Doe'],
      }),
      doc({
        driveFileId: 'b',
        clientFolderName: 'Doe, John',
        attorneyFolder: 'adams',
        partyNames: ['John Q Doe'],
      }),
    ]);
    expect(matters.get('a')).toBe(matters.get('b'));
  });

  it('bare surnames never drive a cross-tree join', () => {
    const matters = assignMatters([
      doc({ driveFileId: 'a', clientFolderName: 'F1', partyNames: ['Smith'] }),
      doc({ driveFileId: 'b', clientFolderName: 'F2', partyNames: ['Smith'] }),
    ]);
    expect(matters.get('a')).not.toBe(matters.get('b'));
  });
});

describe('deriveCountingUnits (§7.2)', () => {
  it('collapses near-identical drafts and picks the version pointer', () => {
    const body =
      'declaration of trust made by john doe article one family the grantor has two children ' +
      'article four successor trustees the trustee shall distribute income for health education';
    const units = deriveCountingUnits([
      doc({
        driveFileId: 'draft1',
        versionLabel: 'draft',
        simhashHex: simhash(body).toString(16),
      }),
      doc({
        driveFileId: 'final1',
        versionLabel: 'final',
        simhashHex: simhash(body).toString(16),
      }),
      doc({
        driveFileId: 'unrelated',
        clientFolderName: 'Roe, Mary',
        partyNames: ['Mary Roe'],
        simhashHex: simhash('completely different invoice text about payments due').toString(16),
      }),
    ]);
    expect(units).toHaveLength(2);
    const doeUnit = units.find((u) => u.memberDriveFileIds.includes('draft1'));
    expect(doeUnit?.memberDriveFileIds).toEqual(['draft1', 'final1']);
    expect(doeUnit?.representativeDriveFileId).toBe('final1'); // final > draft
  });

  it('distinguishes instruments within a matter', () => {
    const units = deriveCountingUnits([
      doc({ driveFileId: 'orig', instrumentKind: 'original' }),
      doc({ driveFileId: 'amend', instrumentKind: 'amendment' }),
    ]);
    expect(units).toHaveLength(2);
    expect(new Set(units.map((u) => u.instrumentKind))).toEqual(
      new Set(['original', 'amendment']),
    );
    // Same matter, distinct counting units.
    expect(units[0].matterKey).toBe(units[1].matterKey);
  });

  it('execution-date tiebreak when version labels tie', () => {
    const body = 'identical trust text for tiebreak purposes with several words repeated here';
    const units = deriveCountingUnits([
      doc({
        driveFileId: 'older',
        executionDate: '2015-01-01',
        simhashHex: simhash(body).toString(16),
      }),
      doc({
        driveFileId: 'newer',
        executionDate: '2019-06-30',
        simhashHex: simhash(body).toString(16),
      }),
    ]);
    expect(units).toHaveLength(1);
    expect(units[0].representativeDriveFileId).toBe('newer');
  });

  it('is deterministic across runs', () => {
    const inputs = [
      doc({ driveFileId: 'x' }),
      doc({ driveFileId: 'y', clientFolderName: 'Roe', partyNames: ['Mary Roe'] }),
    ];
    expect(deriveCountingUnits(inputs)).toEqual(deriveCountingUnits([...inputs].reverse()));
  });
});
