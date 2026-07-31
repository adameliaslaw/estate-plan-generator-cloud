/**
 * Clause library service — the attorney-facing Clause Picker's data layer.
 *
 * Reads come straight off firms/{firmId}/clauseCatalog with the client SDK
 * (staff-read is allowed by rules; see useCollection in the dialog). Writes
 * go through the addMyClause callable because catalog client-writes are
 * closed (#222) — manual "My Clauses" entries are created server-side.
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
