/**
 * The mining/catalog firm bridge: the app's live auth claims carry
 * 'elias-counsel' while the mined catalog is keyed under 'firm-001'.
 * Clause Picker callables resolve through this mapping server-side.
 */
import { describe, expect, it } from 'vitest';
import {
  MINING_FIRM_ID,
  resolveCatalogFirm,
} from '../../functions/src/mining-firm';

describe('resolveCatalogFirm', () => {
  it('bridges the app firm to the mining catalog', () => {
    expect(resolveCatalogFirm('elias-counsel')).toBe(MINING_FIRM_ID);
  });

  it('the mining firm maps to itself', () => {
    expect(resolveCatalogFirm('firm-001')).toBe(MINING_FIRM_ID);
  });

  it('any other firm keeps its own catalog', () => {
    expect(resolveCatalogFirm('some-other-firm')).toBe('some-other-firm');
  });
});
