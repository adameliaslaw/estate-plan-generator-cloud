/**
 * Who takes the residue.
 *
 * The pool is COMPUTED — Σ(asset values) − Σ(specific gifts) — and shown, never typed. What the
 * attorney enters is who takes it and in what percentages, which is how the firm's own wills read
 * and how the State's Schedule E asks for it ("50% Residue", "1/3 of Estate").
 *
 * The per-stirpes notice is not decoration. `perStirpes` decides who takes when a residuary
 * beneficiary predeceases, and the substitute can be a DIFFERENT TAX CLASS — a deceased child's
 * share to grandchildren stays Class A, a deceased sibling's share to nieces and nephews moves
 * Class C → Class D. The engine will not resolve that, and the schema rejects the field outright,
 * so the screen has to say what the attorney is expected to do instead.
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
  shareLabel,
} from '@/lib/inheritance-tax-allocations';
import type { ShareMode } from '@/lib/inheritance-tax-allocations';
import type { ITRBeneficiary, ITRResiduaryShare } from '@/types/inheritance-tax';

interface Props {
  /** The computed pool, in dollars. */
  pool: number;
  shares: ITRResiduaryShare[];
  beneficiaries: ITRBeneficiary[];
  /**
   * How the shares are being expressed. Presentation only — the store is a fraction.
   *
   * The page defaults this to `fraction`, and that default is load-bearing: an estate divided
   * equally between three people is a THIRD each, and a third has no exact decimal. Typed as
   * "33.33" it is short by $167 on a $500,000 residue, and typed as "33.3333" it is still short
   * — and the shares no longer come out equal, which is what the attorney actually meant. "1/3"
   * is exact, and the engine apportions the remaining cents.
   */
  mode: ShareMode;
  onModeChange: (mode: ShareMode) => void;
  onChange: (mutate: (shares: ITRResiduaryShare[]) => void) => void;
}

const selectClass = 'border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm';

const money = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const nameOf = (b: ITRBeneficiary): string =>
  `${b.firstName} ${b.lastName}`.trim() || '(unnamed beneficiary)';

export function ResiduarySharesFields({
  pool, shares, beneficiaries, mode, onModeChange, onChange,
}: Props) {
  const total = shares.reduce((sum, s) => sum + (Number(s.fraction) || 0), 0);
  const balanced = Math.abs(total - 1) <= 1e-9;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="text-sm font-medium">Residuary pool</span>
          <span className="text-muted-foreground ml-2 text-xs">
            everything not specifically given away — computed, not entered
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground text-xs">Enter shares as</span>
            <select
              aria-label="Residuary share format"
              className="border-input h-7 rounded-md border bg-transparent px-2 text-xs"
              value={mode}
              onChange={(e) => onModeChange(e.target.value as ShareMode)}
            >
              {SHARE_MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <span className="text-lg tabular-nums">{money(pool)}</span>
        </div>
      </div>

      {pool <= 0 ? (
        <p className="text-muted-foreground text-sm">
          Every asset is specifically given away in full, so there is no residue to divide.
        </p>
      ) : (
        <>
          {shares.map((s, si) => (
            <div key={`res-${si}`} className="grid items-end gap-2 md:grid-cols-[1fr_9rem_auto]">
              <div>
                <Label className="text-xs">Beneficiary</Label>
                <select
                  aria-label={`Residuary beneficiary ${si + 1}`}
                  className={selectClass}
                  value={s.beneficiaryId}
                  onChange={(e) => onChange((d) => { d[si]!.beneficiaryId = e.target.value; })}
                >
                  <option value="">Select…</option>
                  {beneficiaries.map((b) => (
                    <option key={b.id} value={b.id}>{nameOf(b)}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">Share of residue</Label>
                <Input
                  aria-label={`Residuary share ${si + 1}`}
                  defaultValue={formatShare(s.fraction, mode, pool)}
                  key={`res-${si}-${mode}-${pool}`}
                  placeholder={SHARE_MODES.find((m) => m.value === mode)?.hint}
                  onChange={(e) => {
                    const fraction = parseShare(e.target.value, mode, pool);
                    // A half-typed "1/" is not a share yet — leave the stored fraction alone.
                    if (fraction === null) return;
                    onChange((d) => { d[si]!.fraction = fraction; });
                  }}
                />
              </div>
              <div className="flex items-center gap-2 pb-1">
                <span className="text-muted-foreground w-28 text-right text-sm tabular-nums">
                  {money(shareAmount(s.fraction, pool))}
                </span>
                <Button
                  variant="ghost" size="icon" aria-label={`Remove residuary share ${si + 1}`}
                  onClick={() => onChange((d) => { d.splice(si, 1); })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline" size="sm"
              onClick={() => onChange((d) => { d.push({ beneficiaryId: '', fraction: 0 }); })}
            >
              <Plus className="mr-2 h-4 w-4" /> Add a residuary taker
            </Button>
            <span className={balanced ? 'text-muted-foreground text-xs' : 'text-destructive text-xs'}>
              {shares.length === 0
                ? 'Enter who takes the residue.'
                : `Shares total ${shareLabel(total)}${balanced ? '' : ' — they must total 100%'}`}
            </span>
          </div>
        </>
      )}

      {/* Stated on screen because the model deliberately refuses to compute it. */}
      <div className="bg-muted/30 space-y-1.5 rounded-md border p-3">
        <p className="text-xs font-medium">Enter the actual takers — per stirpes is not applied</p>
        <p className="text-muted-foreground text-xs">
          If a residuary beneficiary died before the decedent, do <strong>not</strong> enter them
          and rely on a per stirpes clause: name the people who actually take instead. Who
          substitutes changes the tax, because the substitute can be a different class — a
          deceased child's share passing to grandchildren stays <strong>Class A</strong>, but a
          deceased sibling's share passing to nieces and nephews moves{' '}
          <strong>Class C to Class D</strong>. This tool will not decide that for you, and will not
          quietly assume it.
        </p>
      </div>
    </div>
  );
}
