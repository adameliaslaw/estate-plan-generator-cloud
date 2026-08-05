/**
 * The mining/catalog firm bridge.
 *
 * The mining run is FIRM INFRASTRUCTURE keyed under the pipeline's firm id
 * ('firm-001', pinned 2026-07-31), while the app's live auth claims carry
 * 'elias-counsel' — discovered when the calibration page 404'd on its own
 * packet (HOMEWORK 2026-07-31 warning, proven real). Staff of either id
 * operate on the one mining scope, and the mined clause catalog lives under
 * the MINING firm id — so Clause Picker callables resolve the caller's firm
 * to the catalog's firm here, server-side, instead of loosening Firestore
 * rules to allow cross-firm client reads.
 */

export const MINING_FIRM_ID = 'firm-001';
export const MINING_STAFF_FIRMS: ReadonlySet<string> = new Set(['firm-001', 'elias-counsel']);

/**
 * The firm id whose clauseCatalog a caller firm reads and writes: mining-staff
 * firms share the mining firm's catalog; any other firm keeps its own.
 */
export function resolveCatalogFirm(firmId: string): string {
  return MINING_STAFF_FIRMS.has(firmId) ? MINING_FIRM_ID : firmId;
}
