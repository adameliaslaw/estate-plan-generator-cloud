/**
 * The allocation model at intake: inventory the estate, then allocate it.
 *
 * The arithmetic lives here rather than in the page so it can be tested against the server's own
 * validator — a client rule that drifts from what the server enforces is worse than no client
 * rule, because it lets an attorney get all the way to a save before finding out.
 *
 * The shares are stored as FRACTIONS. The attorney may type a percentage, a dollar amount or a
 * plain fraction like "1/3"; each is converted here, and the dollar figure is derived back for
 * display. That is the whole point of the model — nobody hand-computes $166,666.67 and hopes it
 * sums.
 */
import type {
  ITRAsset,
  ITRBeneficiary,
  ITRMatterInput,
  ITRResiduaryShare,
} from '@/types/inheritance-tax';

/** Matches the server's tolerance (functions/src/inheritance-tax/allocations.ts). */
const FRACTION_EPSILON = 1e-9;

/** How the attorney is expressing a share. The stored value is a fraction either way. */
export type ShareMode = 'percent' | 'amount' | 'fraction';

export const SHARE_MODES: ReadonlyArray<{ value: ShareMode; label: string; hint: string }> = [
  { value: 'percent', label: '%', hint: 'e.g. 50' },
  { value: 'amount', label: '$', hint: 'e.g. 50000' },
  { value: 'fraction', label: '⅟', hint: 'e.g. 1/3' },
];

/** True when the matter is in the allocation model rather than the legacy nested one. */
export function usesAssetModel(matter: ITRMatterInput): boolean {
  return matter.assets !== undefined;
}

/** Σ of an asset's SPECIFIC allocations, as a fraction of the asset. */
export function allocatedFraction(asset: ITRAsset): number {
  return (asset.allocations ?? []).reduce((sum, a) => sum + (Number(a.fraction) || 0), 0);
}

/** What is left of an asset after its specific gifts — the part that falls into residue. */
export function unallocatedFraction(asset: ITRAsset): number {
  return Math.max(0, 1 - allocatedFraction(asset));
}

/** The residuary pool in dollars: Σ(asset value) − Σ(all specific allocations). Never entered. */
export function residuaryPool(matter: ITRMatterInput): number {
  return (matter.assets ?? []).reduce(
    (sum, a) => sum + (Number(a.fairMarketValue) || 0) * unallocatedFraction(a),
    0,
  );
}

/** Every asset's value — the gross estate as entered. */
export function grossFromAssets(matter: ITRMatterInput): number {
  return (matter.assets ?? []).reduce((sum, a) => sum + (Number(a.fairMarketValue) || 0), 0);
}

/**
 * Reads what the attorney typed as a fraction of `assetValue`.
 *
 * Returns null for anything that is not a share yet — blank, unparseable, negative — so the
 * caller can leave the stored fraction alone rather than writing a 0 the attorney did not mean.
 * A dollar amount against a $0 asset is also null: there is no fraction of nothing.
 */
export function parseShare(raw: string, mode: ShareMode, assetValue: number): number | null {
  const text = raw.trim();
  if (text === '') return null;

  if (mode === 'fraction') {
    const slash = text.split('/');
    if (slash.length === 2) {
      const [n, d] = [Number(slash[0]), Number(slash[1])];
      if (!isFinite(n) || !isFinite(d) || d === 0 || n < 0) return null;
      return n / d;
    }
    const whole = Number(text);
    return isFinite(whole) && whole >= 0 ? whole : null;
  }

  const n = Number(text);
  if (!isFinite(n) || n < 0) return null;
  if (mode === 'percent') return n / 100;
  if (assetValue <= 0) return null;
  return n / assetValue;
}

/** A fraction shown back in the mode the attorney is working in. */
export function formatShare(fraction: number, mode: ShareMode, assetValue: number): string {
  if (mode === 'amount') return (fraction * assetValue).toFixed(2);
  if (mode === 'fraction') return String(parseFloat(fraction.toFixed(6)));
  return String(parseFloat((fraction * 100).toFixed(4)));
}

/** A share as prose: "50%", "33.3333%". */
export function shareLabel(fraction: number): string {
  return `${parseFloat((fraction * 100).toFixed(4))}%`;
}

/** The dollars a share of an asset comes to — derived, never entered. */
export function shareAmount(fraction: number, assetValue: number): number {
  return fraction * assetValue;
}

const nameOf = (b: ITRBeneficiary): string =>
  `${b.firstName} ${b.lastName}`.trim() || b.id;

/**
 * Everything that would make the server reject this matter's allocations, phrased as the question
 * it actually is. Mirrors the rules in `functions/src/inheritance-tax/validation/matter.ts`:
 *
 *   - an asset's specific allocations total **≤** its value, never more;
 *   - pool > 0 ⇒ residuary shares are required and total exactly 100%;
 *   - pool = 0 ⇒ there is no residue to divide, so there must be no residuary shares.
 *
 * An asset with NO allocations is not a problem — it passes wholly into residue, which is the
 * ordinary will.
 */
export function allocationProblems(matter: ITRMatterInput): string[] {
  if (!usesAssetModel(matter)) return [];
  const problems: string[] = [];
  const assets = matter.assets ?? [];
  const known = new Set(matter.beneficiaries.map((b) => b.id));

  assets.forEach((asset, i) => {
    const at = `Asset ${i + 1}${asset.description.trim() ? ` (${asset.description.trim()})` : ''}`;
    if (!asset.description.trim()) problems.push(`${at}: description`);
    if (!(Number(asset.fairMarketValue) > 0)) problems.push(`${at}: a value greater than $0`);

    const allocations = asset.allocations ?? [];
    const seen = new Set<string>();
    allocations.forEach((a) => {
      if (!a.beneficiaryId || !known.has(a.beneficiaryId)) {
        problems.push(`${at}: a share is not assigned to anyone — pick the beneficiary or remove it`);
      } else if (seen.has(a.beneficiaryId)) {
        problems.push(`${at}: the same beneficiary is given two shares — combine them into one`);
      }
      seen.add(a.beneficiaryId);
      if (!(Number(a.fraction) > 0)) problems.push(`${at}: a share of 0 — enter it or remove the row`);
    });

    const allocated = allocatedFraction(asset);
    if (allocated > 1 + FRACTION_EPSILON) {
      problems.push(
        `${at}: specific gifts total ${shareLabel(allocated)} of it — an asset cannot be given ` +
        `away more than once`,
      );
    }
  });

  const pool = residuaryPool(matter);
  const residuary = matter.residuary ?? [];
  const residuaryTotal = residuary.reduce((sum, s) => sum + (Number(s.fraction) || 0), 0);
  const residuarySeen = new Set<string>();
  residuary.forEach((s) => {
    if (!s.beneficiaryId || !known.has(s.beneficiaryId)) {
      problems.push('Residue: a share is not assigned to anyone — pick the beneficiary or remove it');
    } else if (residuarySeen.has(s.beneficiaryId)) {
      const b = matter.beneficiaries.find((x) => x.id === s.beneficiaryId);
      problems.push(`Residue: ${b ? nameOf(b) : s.beneficiaryId} takes residue twice — combine the shares`);
    }
    residuarySeen.add(s.beneficiaryId);
  });

  if (pool > 0.005) {
    if (residuary.length === 0) {
      problems.push(
        `Residue: ${pool.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} is not ` +
        'specifically given away, so it passes under the residuary clause — enter who takes it',
      );
    } else if (Math.abs(residuaryTotal - 1) > FRACTION_EPSILON) {
      problems.push(`Residue: the shares total ${shareLabel(residuaryTotal)} — they must total 100%`);
    }
  } else if (residuary.length > 0) {
    problems.push(
      'Residue: every asset is specifically given away in full, so there is no residue to divide ' +
      '— remove the residuary shares or reduce a specific gift',
    );
  }

  return problems;
}

/**
 * Turns a legacy nested matter into the allocation model: one asset per bequest, wholly allocated
 * to the beneficiary it was entered under, nothing in residue.
 *
 * Applied when the page opens a saved matter, so there is one screen rather than two. The mapping
 * is exact — the server proves the round-trip computes to identical figures — and a matter
 * already in the allocation model is returned unchanged.
 */
export function normalizeMatterToAssets(matter: ITRMatterInput): ITRMatterInput {
  if (usesAssetModel(matter)) return matter;
  const assets: ITRAsset[] = matter.beneficiaries.flatMap((b) =>
    b.bequests.map((q) => ({ ...q, allocations: [{ beneficiaryId: b.id, fraction: 1 }] })),
  );
  return {
    ...matter,
    assets,
    residuary: [],
    beneficiaries: matter.beneficiaries.map((b) => ({ ...b, bequests: [] })),
  };
}

/**
 * What the page sends. The server's schemas are `.strict()`, and it rejects a residuary array on
 * a matter with no assets — so an empty `residuary` is dropped rather than sent as `[]` when
 * there is no pool to divide.
 */
export function withAllocationsForSave(matter: ITRMatterInput): ITRMatterInput {
  if (!usesAssetModel(matter)) return matter;
  const residuary = (matter.residuary ?? []).filter((s) => s.beneficiaryId);
  const next: ITRMatterInput = { ...matter, residuary };
  if (residuary.length === 0) delete next.residuary;
  return next;
}

/** A fresh, empty asset for the inventory. */
export function emptyAsset(id: string): ITRAsset {
  return { id, type: 'bank_account', description: '', fairMarketValue: 0, allocations: [] };
}

/** A fresh residuary share. */
export function emptyResiduaryShare(beneficiaryId: string): ITRResiduaryShare {
  return { beneficiaryId, fraction: 0 };
}
