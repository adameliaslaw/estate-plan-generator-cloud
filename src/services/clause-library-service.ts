/**
 * Clause library service — the attorney-facing Clause Picker's data layer.
 *
 * Reads AND writes go through callables. Reads moved server-side
 * (listClauseCatalog) because the mined catalog lives under the mining
 * firm id ('firm-001') while live auth claims carry 'elias-counsel' —
 * the callable bridges the two, which firm-scoped Firestore rules can't.
 * Writes go through callables because catalog client-writes are closed
 * (#222) — manual "My Clauses" entries are created server-side.
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';

/** Subset of the mined-catalog schema the picker renders (design doc §9). */
export interface ClauseCatalogEntry {
  id: string;
  title: string;
  functionSummary?: string;
  category?: string;
  canonicalText: string;
  status?: string;
  /** 'manual' = attorney-authored via addMyClause; absent = mined. */
  origin?: 'manual';
  createdBy?: string;
  /** Two-letter jurisdiction for manual clauses; mined families split by file. */
  state?: string;
  counts?: { occurrences?: number; matters?: number };
  piiScanStatus?: string;
}

export interface ListClauseCatalogResult {
  entries: ClauseCatalogEntry[];
  /** Mined clauses still awaiting approval (clean text only). */
  pendingMined: number;
}

export async function listClauseCatalog(req: {
  firmId: string;
}): Promise<ListClauseCatalogResult> {
  const fn = httpsCallable<{ firmId: string }, ListClauseCatalogResult>(
    functions,
    'listClauseCatalog',
  );
  return (await fn(req)).data;
}

/**
 * Flip every clean mined clause to 'approved' in one shot (Adam's
 * curate-by-deletion workflow: approve all, then prune from the picker).
 * Tombstoned and PII-blocked entries are never touched.
 */
export async function approveAllClauses(req: {
  firmId: string;
}): Promise<{ approved: number; skippedBlocked: number }> {
  const fn = httpsCallable<{ firmId: string }, { approved: number; skippedBlocked: number }>(
    functions,
    'approveAllClauses',
  );
  return (await fn(req)).data;
}

export interface AddMyClauseRequest {
  firmId: string;
  title: string;
  text: string;
  category?: string;
  state?: string;
}

export async function addMyClause(req: AddMyClauseRequest): Promise<{ clauseId: string }> {
  const fn = httpsCallable<AddMyClauseRequest, { clauseId: string }>(functions, 'addMyClause');
  return (await fn(req)).data;
}

export interface RemoveClauseRequest {
  firmId: string;
  clauseId: string;
}

/**
 * Delete a clause from the library. Manual entries are hard-deleted; mined
 * entries are tombstoned server-side (status 'removed') so pipeline re-runs
 * don't resurrect them. Either way the entry leaves the picker immediately.
 */
export async function removeClause(
  req: RemoveClauseRequest,
): Promise<{ removed: 'deleted' | 'tombstoned' }> {
  const fn = httpsCallable<RemoveClauseRequest, { removed: 'deleted' | 'tombstoned' }>(
    functions,
    'removeClause',
  );
  return (await fn(req)).data;
}

/**
 * Fill {{PLACEHOLDER}} tokens from the values we know about this client;
 * unknown tokens are left as-is so the attorney sees exactly what still
 * needs a value instead of getting a silently blanked sentence.
 */
export function resolveClausePlaceholders(
  text: string,
  values: Record<string, string | undefined>,
): string {
  return text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (whole, tag: string) => {
    const v = values[tag];
    return v !== undefined && v !== '' ? v : whole;
  });
}
