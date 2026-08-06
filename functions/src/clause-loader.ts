/**
 * functions/src/clause-loader.ts
 *
 * Reads the firm's clause catalog for generation.
 *
 * Split from clause-selection.ts so the selection logic stays pure and
 * unit-testable without Firestore, and so this file owns the one wrinkle that
 * has nothing to do with drafting: the mined catalog lives under the pipeline's
 * firm id while live auth claims carry a different one, so every read has to go
 * through the same `resolveCatalogFirm` bridge the picker's callables use.
 *
 * Failure is non-fatal by design. A catalog read that errors, times out, or
 * comes back empty must degrade to "generate without firm clauses" — the
 * document is still valid, it just falls back to template and model language.
 * Failing the batch because a supplementary clause bank was unreachable would
 * trade a better document for no document.
 */

import * as admin from 'firebase-admin';
import { resolveCatalogFirm } from './mining-firm';
import type { ClauseEntry } from './clause-selection';

/** Cap the read. A firm catalog is hundreds of entries, not thousands. */
const MAX_CATALOG_READ = 500;

/**
 * Load every catalog entry for a firm.
 *
 * Tombstones and PII-blocked entries are dropped here rather than in selection
 * so they never enter memory in the first place — `isDraftable` would exclude
 * them anyway, but a blocked entry's text is the thing we least want floating
 * around a generation process.
 */
export async function loadClauseCatalog(firmId: string): Promise<ClauseEntry[]> {
  try {
    const catalogFirmId = resolveCatalogFirm(firmId);
    const snap = await admin
      .firestore()
      .collection(`firms/${catalogFirmId}/clauseCatalog`)
      .limit(MAX_CATALOG_READ)
      .get();

    const entries: ClauseEntry[] = [];
    for (const doc of snap.docs) {
      const d = doc.data();
      if (d.status === 'removed') continue;
      if (d.piiScanStatus === 'blocked') continue;
      entries.push({
        id: doc.id,
        title: d.title,
        functionSummary: d.functionSummary,
        category: d.category,
        canonicalText: d.canonicalText,
        status: d.status,
        origin: d.origin,
        state: d.state,
        piiScanStatus: d.piiScanStatus,
        docType: d.docType,
      });
    }

    if (snap.size >= MAX_CATALOG_READ) {
      console.warn(
        `[clause-loader] Catalog read hit the ${MAX_CATALOG_READ}-entry cap for firm=${firmId}; ` +
        'some approved clauses were not considered for injection.',
      );
    }
    return entries;
  } catch (err) {
    // Non-fatal: generate without firm clauses rather than failing the batch.
    console.error(`[clause-loader] Catalog read failed for firm=${firmId}; continuing without clauses:`, err);
    return [];
  }
}
