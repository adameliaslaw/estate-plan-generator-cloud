/**
 * Assets → per-beneficiary bequests: the boundary derivation.
 *
 * The model the attorney enters is *assets held by the estate, allocated to beneficiaries*
 * (docs/ASSET-ALLOCATION-MODEL.md). The model the engine takes is *bequests nested under
 * beneficiaries*, and it MUST NOT CHANGE — the 25 gold cases are the only proof the figures are
 * right, and they reproduce the State's own worked examples to the cent. So the two shapes meet
 * here, at the boundary, and nowhere else:
 *
 *   deriveEngineMatter(matter)      allocation shape → the shape computeEstate already takes
 *   normalizeMatterToAssets(matter) legacy nested shape → the allocation shape
 *
 * The pair round-trips: `deriveEngineMatter(normalizeMatterToAssets(m))` computes to figures
 * identical to `m`'s, including the frozen form snapshot. That equality is the acceptance test
 * (tests/unit/inheritance-tax-allocations.test.ts) and the reason the engine could be left alone.
 *
 * Deliberately NOT in here: anything that changes a figure. Derivation redistributes an asset's
 * value across its takers to the cent and stops.
 */
import type { Allocation, Asset, Bequest, Matter, ResiduaryShare } from './types';
import { fromCents, toCents } from './money';
// Imported from the specific file (not the forms barrel) for the same reason engine/compute.ts
// does: the barrel would pull forms in and create a cycle.
import { UnsupportedMatterError } from './forms/errors';

/**
 * Fractions are entered as decimals ("1/3" becomes 0.3333333333333333), so exact comparison is
 * meaningless. This tolerance is far below a cent on any estate this engine will ever see — the
 * cent-exact arithmetic is done in integers, below; this only decides "did the attorney mean
 * fully allocated".
 */
const FRACTION_EPSILON = 1e-9;

/** True when the matter is in the allocation model (assets present) rather than the nested one. */
export function usesAssetModel(matter: Matter): boolean {
  return matter.assets !== undefined;
}

/** Σ of an asset's SPECIFIC allocations, as a fraction of the asset. */
function allocatedFraction(asset: Asset): number {
  return (asset.allocations ?? []).reduce((sum, a) => sum + a.fraction, 0);
}

/**
 * The residuary pool in dollars: Σ(asset value) − Σ(all specific allocations).
 *
 * Computed, never entered — there is nowhere for an attorney to type a wrong pool. Exported
 * because the intake UI (PR 3) shows it as the unallocated remainder, and the validator uses it
 * to decide whether residuary shares are required.
 */
export function residuaryPool(matter: Matter): number {
  const cents = (matter.assets ?? []).reduce((sum, asset) => {
    const remainder = Math.max(0, 1 - allocatedFraction(asset));
    return sum + Math.round(toCents(asset.fairMarketValue) * remainder);
  }, 0);
  return fromCents(cents);
}

/**
 * Splits `totalCents` across `fractions` so the parts sum to EXACTLY `totalCents`.
 *
 * Largest-remainder apportionment: floor every part, then hand the leftover cents to the parts
 * with the largest discarded fraction, ties broken by order. Rounding each part independently
 * would lose or invent a cent on a 1/3 : 2/3 split, and a gross estate that disagrees with the
 * sum of its schedules by a cent is exactly the kind of quiet wrongness this model exists to
 * remove.
 */
function apportionCents(totalCents: number, fractions: number[]): number[] {
  if (fractions.length === 0) return [];
  const raw = fractions.map((f) => totalCents * f);
  const parts = raw.map((r) => Math.floor(r));
  let leftover = totalCents - parts.reduce((sum, p) => sum + p, 0);
  const byRemainder = raw
    .map((r, i) => ({ i, remainder: r - Math.floor(r) }))
    .sort((a, b) => (b.remainder - a.remainder) || (a.i - b.i));
  for (let k = 0; leftover > 0 && k < byRemainder.length; k += 1, leftover -= 1) {
    const entry = byRemainder[k];
    if (entry !== undefined) parts[entry.i] = (parts[entry.i] ?? 0) + 1;
  }
  return parts;
}

/**
 * A share as the attorney reads it: "50%", "33.3333%", "100%". At most four decimals, trailing
 * zeros trimmed, so a half is "50%" and a third is not thirteen digits of noise.
 */
function formatShare(fraction: number): string {
  return `${parseFloat((fraction * 100).toFixed(4))}%`;
}

/**
 * Who takes this asset, for the beneficiary column on a schedule row.
 *
 * **That column is ours, not the State's.** Verified against the IT-R instructions
 * (it-rinst.pdf, 2026-07-28): no asset schedule asks who receives the property. Schedule A's
 * Column A asks for the county, the decedent's fractional interest, address, lot and block,
 * municipality and the **owners of record** — *"Include all owners' names listed on the
 * property"* — and Schedule B-1's asks for the institution, last four digits and registered
 * owners. Beneficiaries are Schedule E's subject. So this string reaches only our own HTML
 * workpaper and the HTML L-9; the official PDF fillers never write it.
 *
 * Being a review aid, it is written for the reviewer: where one row now prints in place of two,
 * the split must not vanish with them. Each taker is named with their share, and whatever falls
 * into residue is "Residuary estate" — the State's own Schedule E vocabulary ("50% Residue").
 * A whole asset to one person stays a plain name, which is what keeps a normalised legacy matter
 * rendering exactly as it did.
 */
export function describeAssetTakers(asset: Asset, matter: Pick<Matter, 'beneficiaries'>): string {
  const nameById = new Map(matter.beneficiaries.map((b) => [b.id, `${b.firstName} ${b.lastName}`.trim()]));
  const name = (id: string): string => nameById.get(id) ?? id;
  const allocations = asset.allocations ?? [];
  const remainder = 1 - allocatedFraction(asset);

  const sole = allocations.length === 1 ? allocations[0] : undefined;
  if (sole !== undefined && remainder <= FRACTION_EPSILON) return name(sole.beneficiaryId);

  const parts = allocations.map((a) => `${name(a.beneficiaryId)} (${formatShare(a.fraction)})`);
  if (remainder > FRACTION_EPSILON) {
    parts.push(
      allocations.length === 0 ? 'Residuary estate' : `Residuary estate (${formatShare(remainder)})`,
    );
  }
  return parts.join(', ');
}

/**
 * A share written the way Schedule E's own examples write it: "1/3", "50%".
 *
 * The State's instruction gives both notations — *"Examples: '50% Residue,' '1/3 of Estate,'
 * '100% Residue.'"* — and a third is exact as a fraction and endless as a decimal, so a simple
 * ratio is printed as a ratio. Anything that is not a small whole ratio prints as a percentage.
 */
export function shareNotation(fraction: number): string {
  for (let d = 2; d <= 16; d += 1) {
    const n = fraction * d;
    if (Math.abs(n - Math.round(n)) < FRACTION_EPSILON && Math.round(n) > 0 && Math.round(n) < d) {
      return `${Math.round(n)}/${d}`;
    }
  }
  return formatShare(fraction);
}

/**
 * Schedule E **column D** — *"Fractional/percentage of residuary Estate and/or specific asset"*.
 *
 * The State asks each beneficiary's interest to be described, not just valued: *"List each type
 * of asset, devise, or bequest due to each beneficiary… Examples: '50% Residue,' '1/3 of
 * Estate,' '$5,000 cash bequest,' 'grandfather clock'."* Column E is the dollar amount; column D
 * is what the will actually said, and until this model existed there was nothing to build it
 * from — a nested bequest had no notion of "a third of the residue".
 *
 * Returns '' for a matter in the legacy nested model, where the column stays blank exactly as it
 * did before, and for a beneficiary who takes nothing.
 */
export function describeBeneficiaryInterest(
  beneficiaryId: string,
  matter: Pick<Matter, 'assets' | 'residuary'>,
): string {
  if (matter.assets === undefined) return '';
  const parts: string[] = [];

  for (const asset of matter.assets) {
    for (const a of asset.allocations ?? []) {
      if (a.beneficiaryId !== beneficiaryId) continue;
      const what = asset.description.trim() || asset.type.replace(/_/g, ' ');
      parts.push(Math.abs(a.fraction - 1) <= FRACTION_EPSILON
        ? what
        : `${shareNotation(a.fraction)} of ${what}`);
    }
  }

  const share = (matter.residuary ?? []).find((s) => s.beneficiaryId === beneficiaryId);
  if (share !== undefined) parts.push(`${shareNotation(share.fraction)} Residue`);

  return parts.join('; ');
}

/** One beneficiary's claim on one asset, before it is priced. */
interface AssetPart {
  beneficiaryId: string;
  fraction: number;
  /** Residuary parts get a distinct derived id so a disclaimer can never name one by accident. */
  viaResidue: boolean;
}

/** The parts one asset is divided into: its specific allocations, then the residuary takers. */
function partsOf(asset: Asset, residuary: ResiduaryShare[]): AssetPart[] {
  const parts: AssetPart[] = (asset.allocations ?? []).map((a: Allocation) => ({
    beneficiaryId: a.beneficiaryId,
    fraction: a.fraction,
    viaResidue: false,
  }));
  const remainder = 1 - allocatedFraction(asset);
  if (remainder > FRACTION_EPSILON) {
    for (const share of residuary) {
      parts.push({
        beneficiaryId: share.beneficiaryId,
        fraction: remainder * share.fraction,
        viaResidue: true,
      });
    }
  }
  return parts;
}

/**
 * The derived bequest's id.
 *
 * An asset taken whole by one beneficiary keeps the ASSET'S OWN id, which is what makes the
 * legacy round-trip exact: a nested bequest normalises to an asset with its own id and derives
 * back to a bequest with that id, so existing disclaimers (which reference bequest ids) and
 * existing schedule rows are untouched. Split assets get a compound id, and residuary-derived
 * bequests are marked so validation can refuse to let a disclaimer name one.
 */
function derivedBequestId(asset: Asset, part: AssetPart, isWholeAsset: boolean): string {
  if (isWholeAsset) return asset.id;
  return part.viaResidue
    ? `${asset.id}::residue::${part.beneficiaryId}`
    : `${asset.id}::${part.beneficiaryId}`;
}

/** Everything a bequest carries except its id and value — copied through unchanged. */
function assetDetail(asset: Asset): Omit<Bequest, 'id' | 'fairMarketValue'> {
  return {
    type: asset.type,
    description: asset.description,
    // Conditional so an asset without a given detail block stores no key at all — Firestore
    // rejects an explicit undefined, and these flow into the frozen snapshot.
    ...(asset.realPropertyDetails !== undefined ? { realPropertyDetails: asset.realPropertyDetails } : {}),
    ...(asset.businessDetails !== undefined ? { businessDetails: asset.businessDetails } : {}),
    ...(asset.accountDetails !== undefined ? { accountDetails: asset.accountDetails } : {}),
    ...(asset.securityDetails !== undefined ? { securityDetails: asset.securityDetails } : {}),
    ...(asset.bondDetails !== undefined ? { bondDetails: asset.bondDetails } : {}),
    ...(asset.transferDetails !== undefined ? { transferDetails: asset.transferDetails } : {}),
  };
}

/**
 * Derives the per-beneficiary bequests `computeEstate` takes from a matter's assets,
 * allocations and residuary shares. A matter in the nested model is returned unchanged.
 *
 * Each asset is divided into its specific allocations plus, if anything is left, each residuary
 * taker's slice of that remainder — so an asset's value reaches the schedules under its own
 * type, and the per-schedule totals (Lines 1–4) come out identical to the nested model. Residue
 * is NOT lumped into one synthetic bequest: that would move real property onto whatever schedule
 * the lump was typed as.
 *
 * Throws {@link UnsupportedMatterError} rather than dropping or inventing cents when an asset's
 * shares do not cover it — a valid matter cannot reach that state (validateMatter rejects it
 * first), so getting here means a matter was stored by some path that skipped validation.
 */
export function deriveEngineMatter(matter: Matter): Matter {
  if (!usesAssetModel(matter)) return matter;

  const assets = matter.assets ?? [];
  const residuary = matter.residuary ?? [];
  const bequestsByBeneficiary = new Map<string, Bequest[]>();
  for (const b of matter.beneficiaries) bequestsByBeneficiary.set(b.id, []);

  for (const asset of assets) {
    const parts = partsOf(asset, residuary);
    if (parts.length === 0) continue;
    const totalFraction = parts.reduce((sum, p) => sum + p.fraction, 0);
    if (Math.abs(totalFraction - 1) > FRACTION_EPSILON) {
      throw new UnsupportedMatterError(
        `Matter '${matter.matterId}': asset '${asset.id}' is ${(totalFraction * 100).toFixed(4)}% ` +
        'allocated. Every asset must be fully accounted for — specific gifts plus the residuary ' +
        'takers of what is left. No figure is produced from a partially allocated estate.',
      );
    }
    const isWholeAsset = parts.length === 1 && parts[0]?.viaResidue === false;
    const amounts = apportionCents(toCents(asset.fairMarketValue), parts.map((p) => p.fraction));
    parts.forEach((part, i) => {
      const list = bequestsByBeneficiary.get(part.beneficiaryId);
      if (list === undefined) {
        throw new UnsupportedMatterError(
          `Matter '${matter.matterId}': asset '${asset.id}' is allocated to '${part.beneficiaryId}', ` +
          'who is not a beneficiary of this matter.',
        );
      }
      list.push({
        id: derivedBequestId(asset, part, isWholeAsset),
        fairMarketValue: fromCents(amounts[i] ?? 0),
        ...assetDetail(asset),
      });
    });
  }

  return {
    ...matter,
    beneficiaries: matter.beneficiaries.map((b) => ({
      ...b,
      bequests: bequestsByBeneficiary.get(b.id) ?? [],
    })),
  };
}

/**
 * Normalises a legacy nested matter into the allocation model: one asset per bequest, wholly
 * allocated to the beneficiary it was entered under, nothing in residue.
 *
 * This is the read path for the matters already saved in production (docs §5) — the mapping is
 * exact, so nothing needs a backfill job. A matter already in the allocation model is returned
 * unchanged.
 */
export function normalizeMatterToAssets(matter: Matter): Matter {
  if (usesAssetModel(matter)) return matter;
  const assets: Asset[] = matter.beneficiaries.flatMap((b) =>
    b.bequests.map((q) => ({ ...q, allocations: [{ beneficiaryId: b.id, fraction: 1 }] })),
  );
  return {
    ...matter,
    assets,
    residuary: [],
    beneficiaries: matter.beneficiaries.map((b) => ({ ...b, bequests: [] })),
  };
}
