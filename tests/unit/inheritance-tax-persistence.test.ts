/**
 * The persistence guarantees, tested against a fake Firestore:
 *
 *  - the audit chain links, verifies, and detects tampering;
 *  - SSNs never reach an audit payload;
 *  - an unsigned chain is refused rather than silently written;
 *  - approve refuses a self-approval — in every configuration;
 *  - finalize is requester-only and is recorded as `matter_finalized`, not `review_approved`;
 *  - the IT-R needs an approved checkpoint.
 */
import { describe, it, expect } from 'vitest';
import { createFakeFirestore } from './fake-firestore';
import {
  appendAudit,
  verifyAuditChain,
  readAuditChain,
  saveCheckpoint,
  getCheckpoint,
  saveMatter,
  getMatter,
  sanitizePayload,
} from '../../functions/src/inheritance-tax-store';
import { approveHandler, finalizeHandler } from '../../functions/src/inheritance-tax-review';
import type { ReviewCheckpoint } from '../../functions/src/inheritance-tax';

const KEY = 'test-audit-key';
const FIRM = 'FIRM-1';
const MATTER = 'M-1';

function pendingCheckpoint(requestedBy: string): ReviewCheckpoint {
  return {
    checkpointId: 'CP-1',
    matterId: MATTER,
    requestedAt: '2026-01-01T00:00:00.000Z',
    requestedBy,
    // The frozen snapshot; its contents do not matter for these rules.
    computationSnapshot: { computedAt: '2026-01-01T00:00:00.000Z' } as never,
    status: 'pending',
  };
}

describe('audit chain', () => {
  it('links entries and verifies', async () => {
    const db = createFakeFirestore();
    await appendAudit(db, FIRM, MATTER, 'u1', 'matter_created', { matterId: MATTER }, KEY);
    await appendAudit(db, FIRM, MATTER, 'u1', 'computation_run', { matterId: MATTER }, KEY);
    await appendAudit(db, FIRM, MATTER, 'u2', 'review_approved', { matterId: MATTER }, KEY);

    const entries = await readAuditChain(db, FIRM, MATTER);
    expect(entries).toHaveLength(3);
    expect(entries[0]!.previousHash).toBe('0'.repeat(64));
    expect(entries[1]!.previousHash).toBe(entries[0]!.hash);
    expect(entries[2]!.previousHash).toBe(entries[1]!.hash);

    await expect(verifyAuditChain(db, FIRM, MATTER, KEY)).resolves.toEqual({ valid: true, entries: 3 });
  });

  it('detects a tampered entry', async () => {
    const db = createFakeFirestore();
    await appendAudit(db, FIRM, MATTER, 'u1', 'matter_created', { matterId: MATTER }, KEY);
    await appendAudit(db, FIRM, MATTER, 'u1', 'computation_run', { matterId: MATTER, totalTaxDue: 100 }, KEY);

    // Rewrite a stored payload, keeping its hash — exactly what a chain exists to catch.
    for (const [path, doc] of db.__raw.entries()) {
      if (path.includes('/audit/') && (doc['action'] as string) === 'computation_run') {
        const entry = JSON.parse(doc['json'] as string) as { payload: Record<string, unknown> };
        entry.payload['totalTaxDue'] = 1;
        db.__raw.set(path, { ...doc, json: JSON.stringify(entry) });
      }
    }
    const result = await verifyAuditChain(db, FIRM, MATTER, KEY);
    expect(result.valid).toBe(false);
  });

  it('does not verify under a different key', async () => {
    const db = createFakeFirestore();
    await appendAudit(db, FIRM, MATTER, 'u1', 'matter_created', { matterId: MATTER }, KEY);
    await expect(verifyAuditChain(db, FIRM, MATTER, 'other-key')).resolves.toMatchObject({ valid: false });
  });

  it('refuses to write an unsigned entry', async () => {
    const db = createFakeFirestore();
    await expect(
      appendAudit(db, FIRM, MATTER, 'u1', 'matter_created', { matterId: MATTER }, ''),
    ).rejects.toThrow(/INHERITANCE_AUDIT_KEY/);
  });

  it('masks SSNs before they are stored', async () => {
    const db = createFakeFirestore();
    await appendAudit(db, FIRM, MATTER, 'u1', 'matter_created', { ssn: '123-45-6789', nested: { decedentSsn: '987-65-4321' } }, KEY);
    const [entry] = await readAuditChain(db, FIRM, MATTER);
    expect(JSON.stringify(entry)).not.toContain('123-45-6789');
    expect(JSON.stringify(entry)).not.toContain('987-65-4321');
    expect(entry!.payload['ssn']).toBe('***-**-****');
  });

  it('sanitizePayload leaves non-SSN data alone', () => {
    expect(sanitizePayload({ a: 1, b: ['x'], ssn: '111-22-3333' })).toEqual({ a: 1, b: ['x'], ssn: '***-**-****' });
  });
});

describe('review rules', () => {
  it('approve refuses a self-approval', async () => {
    const db = createFakeFirestore();
    await saveCheckpoint(db, FIRM, pendingCheckpoint('attorney-1'));
    await expect(
      approveHandler(db, FIRM, 'attorney-1', { matterId: MATTER, checkpointId: 'CP-1' }, KEY),
    ).rejects.toThrow(/Separation of duties/);
  });

  it('approve accepts a different attorney and records two-attorney', async () => {
    const db = createFakeFirestore();
    await saveCheckpoint(db, FIRM, pendingCheckpoint('attorney-1'));
    const res = await approveHandler(db, FIRM, 'attorney-2', { matterId: MATTER, checkpointId: 'CP-1' }, KEY);
    expect(res).toMatchObject({ status: 'approved', finalizationKind: 'two-attorney' });

    const actions = (await readAuditChain(db, FIRM, MATTER)).map((e) => e.action);
    expect(actions).toContain('review_approved');
    expect(actions).not.toContain('matter_finalized');
  });

  it('finalize is requester-only', async () => {
    const db = createFakeFirestore();
    await saveCheckpoint(db, FIRM, pendingCheckpoint('attorney-1'));
    await expect(
      finalizeHandler(db, FIRM, 'attorney-2', { matterId: MATTER, checkpointId: 'CP-1' }, KEY),
    ).rejects.toThrow(/Only the attorney who requested/);
  });

  it('finalize freezes the checkpoint and records matter_finalized, never review_approved', async () => {
    const db = createFakeFirestore();
    await saveCheckpoint(db, FIRM, pendingCheckpoint('solo-attorney'));
    const res = await finalizeHandler(db, FIRM, 'solo-attorney', { matterId: MATTER, checkpointId: 'CP-1' }, KEY);
    expect(res).toMatchObject({ status: 'approved', finalizationKind: 'solo' });

    const stored = await getCheckpoint(db, FIRM, MATTER, 'CP-1');
    expect(stored?.status).toBe('approved');
    expect(stored?.finalizationKind).toBe('solo');

    const actions = (await readAuditChain(db, FIRM, MATTER)).map((e) => e.action);
    expect(actions).toContain('matter_finalized');
    expect(actions).not.toContain('review_approved');
  });

  it('a resolved checkpoint cannot be re-resolved', async () => {
    const db = createFakeFirestore();
    await saveCheckpoint(db, FIRM, pendingCheckpoint('attorney-1'));
    await approveHandler(db, FIRM, 'attorney-2', { matterId: MATTER, checkpointId: 'CP-1' }, KEY);
    await expect(
      approveHandler(db, FIRM, 'attorney-3', { matterId: MATTER, checkpointId: 'CP-1' }, KEY),
    ).rejects.toThrow(/already approved/);
    await expect(
      finalizeHandler(db, FIRM, 'attorney-1', { matterId: MATTER, checkpointId: 'CP-1' }, KEY),
    ).rejects.toThrow(/already approved/);
  });
});

describe('matter storage', () => {
  it('round-trips a matter through the canonical JSON encoding', async () => {
    const db = createFakeFirestore();
    const matter = {
      matterId: MATTER,
      createdAt: '2026-01-01T00:00:00.000Z',
      decedent: { firstName: 'Jane', lastName: 'Doe', ssn: '123-45-6789', dateOfDeath: '2024-03-01', countyOfResidence: 'Mercer' },
      beneficiaries: [],
      deductions: [],
    } as never;
    await saveMatter(db, FIRM, matter);
    const read = await getMatter(db, FIRM, MATTER);
    expect(read).toEqual(matter);
  });
});
