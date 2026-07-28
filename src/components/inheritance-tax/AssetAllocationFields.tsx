/**
 * Who takes this asset, and how much of it.
 *
 * The attorney enters a share — as a percentage, a dollar amount, or a plain fraction like "1/3"
 * — and the dollars are derived beside it. What is stored is always the fraction, so a
 * re-appraisal keeps the split intact and the schedules print the new figure. The unallocated
 * remainder is shown as it falls into the residuary pool, because that is the number an attorney
 * would otherwise be computing on paper.
 *
 * Nothing here decides anything: an asset with no shares at all passes wholly into residue, which
 * is the ordinary will and not an error.
 */
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  SHARE_MODES,
  formatShare,
  parseShare,
  shareAmount,
  unallocatedFraction,
} from '@/lib/inheritance-tax-allocations';
import type { ShareMode } from '@/lib/inheritance-tax-allocations';
import type { ITRAsset, ITRBeneficiary } from '@/types/inheritance-tax';

interface Props {
  asset: ITRAsset;
  beneficiaries: ITRBeneficiary[];
  /** How this asset's shares are being expressed. Presentation only — the store is a fraction. */
  mode: ShareMode;
  onModeChange: (mode: ShareMode) => void;
  /** Applies a mutation to this asset inside the page's immutable patch. */
  onChange: (mutate: (asset: ITRAsset) => void) => void;
}

const selectClass = 'border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm';

const money = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const nameOf = (b: ITRBeneficiary): string =>
  `${b.firstName} ${b.lastName}`.trim() || '(unnamed beneficiary)';

export function AssetAllocationFields({
  asset, beneficiaries, mode, onModeChange, onChange,
}: Props) {
  const allocations = asset.allocations ?? [];
  const value = Number(asset.fairMarketValue) || 0;
  const remainder = unallocatedFraction(asset);
  const remainderAmount = shareAmount(remainder, value);
  const overAllocated = remainder === 0 && allocations.reduce((s, a) => s + a.fraction, 0) > 1 + 1e-9;

  return (
    <div className="space-y-2 rounded-md border-l-2 pl-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Specific gifts of this asset</Label>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground text-xs">Enter shares as</span>
          <select
            aria-label="Share format"
            className="border-input h-7 rounded-md border bg-transparent px-2 text-xs"
            value={mode}
            onChange={(e) => onModeChange(e.target.value as ShareMode)}
          >
            {SHARE_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      {allocations.map((a, ai) => (
        <div key={`${asset.id}-alloc-${ai}`} className="grid items-end gap-2 md:grid-cols-[1fr_9rem_auto]">
          <div>
            <Label className="text-xs">Beneficiary</Label>
            <select
              aria-label={`Beneficiary for share ${ai + 1}`}
              className={selectClass}
              value={a.beneficiaryId}
              onChange={(e) => onChange((d) => { d.allocations![ai]!.beneficiaryId = e.target.value; })}
            >
              <option value="">Select…</option>
              {beneficiaries.map((b) => (
                <option key={b.id} value={b.id}>{nameOf(b)}</option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-xs">Share</Label>
            <Input
              aria-label={`Share ${ai + 1}`}
              defaultValue={formatShare(a.fraction, mode, value)}
              key={`${asset.id}-${ai}-${mode}-${value}`}
              placeholder={SHARE_MODES.find((m) => m.value === mode)?.hint}
              onChange={(e) => {
                const fraction = parseShare(e.target.value, mode, value);
                // A half-typed "1/" is not a share yet — leave the stored fraction alone rather
                // than writing a 0 the attorney did not mean.
                if (fraction === null) return;
                onChange((d) => { d.allocations![ai]!.fraction = fraction; });
              }}
            />
          </div>
          <div className="flex items-center gap-2 pb-1">
            {/* The arithmetic the attorney no longer does. */}
            <span className="text-muted-foreground w-28 text-right text-sm tabular-nums">
              {money(shareAmount(a.fraction, value))}
            </span>
            <Button
              variant="ghost" size="icon" aria-label={`Remove share ${ai + 1}`}
              onClick={() => onChange((d) => { d.allocations!.splice(ai, 1); })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline" size="sm"
          onClick={() => onChange((d) => {
            d.allocations = [...(d.allocations ?? []), { beneficiaryId: '', fraction: 0 }];
          })}
        >
          <Plus className="mr-2 h-4 w-4" /> Add a specific gift
        </Button>
        {overAllocated ? (
          <span className="text-destructive text-xs">
            The shares total more than the whole asset — it cannot be given away twice.
          </span>
        ) : remainder > 0 ? (
          <span className="text-muted-foreground text-xs">
            {allocations.length === 0
              ? <>Wholly residuary — all {money(value)} falls into the residuary pool.</>
              : <>{money(remainderAmount)} left over, which falls into the residuary pool.</>}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">Fully given away — nothing falls into residue.</span>
        )}
      </div>
    </div>
  );
}
