/**
 * The attorney attestations two deduction types cannot be claimed without.
 *
 * Both are questions of fact about this estate that the regulation makes the deduction depend on,
 * so the server refuses to save the matter until they are answered — which, until this existed,
 * meant those two deduction types could not be entered at all.
 *
 * Neither is a second-attorney review. A sole practitioner attests these alone, in the same act as
 * preparing the return.
 *
 * A box left unticked is a real answer, not an empty one: it says the estate fails the
 * regulation's test, and the deduction belongs off the return. The block says so rather than
 * pretending it is a missing field.
 */
import { AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  emptyExecutorCommissionEligibility,
  emptyTransferTaxEligibility,
  needsExecutorCommissionAttestation,
  needsTransferTaxAttestation,
} from '@/lib/inheritance-tax-attestations';
import type {
  ITRDeduction, ITRExecutorCommissionEligibility, ITRTransferTaxEligibility,
} from '@/types/inheritance-tax';

interface Props {
  deduction: ITRDeduction;
  /** Selects the executor-commission rule set — R.2025 d.152 applies from 2025-12-15. */
  dateOfDeath: string;
  /** Applies a mutation to this deduction inside the page's immutable patch. */
  onChange: (mutate: (deduction: ITRDeduction) => void) => void;
}

export function DeductionAttestationFields({ deduction, dateOfDeath, onChange }: Props) {
  const needsExecutor = needsExecutorCommissionAttestation(deduction, dateOfDeath);
  const needsTransfer = needsTransferTaxAttestation(deduction);
  if (!needsExecutor && !needsTransfer) return null;

  // The object is created on first interaction and then always carries all three keys — every one
  // is required by the server's schema, so there is no partial shape worth writing.
  const updateExecutor = (mutate: (draft: ITRExecutorCommissionEligibility) => void) =>
    onChange((d) => {
      const draft = { ...emptyExecutorCommissionEligibility(), ...d.executorCommissionEligibility };
      mutate(draft);
      d.executorCommissionEligibility = draft;
    });

  const updateTransfer = (mutate: (draft: ITRTransferTaxEligibility) => void) =>
    onChange((d) => {
      const draft = { ...emptyTransferTaxEligibility(), ...d.transferTaxEligibility };
      mutate(draft);
      d.transferTaxEligibility = draft;
    });

  if (needsExecutor) {
    const e = deduction.executorCommissionEligibility;
    const allowable = (e?.propertyWasResidueNotSpecificallyDevised ?? false)
      && (e?.propertyWasSoldByExecutor ?? false);
    return (
      <Block
        citation="N.J.A.C. 18:26-7.10(d), as amended by R.2025 d.152 — applies to deaths on or after 15 December 2025."
        warning={allowable ? null : 'Both statements must be true. If either is not, this commission is not an allowable deduction and belongs off the return.'}
      >
        <Attest
          checked={e?.propertyWasResidueNotSpecificallyDevised ?? false}
          onChange={(v) => updateExecutor((d) => { d.propertyWasResidueNotSpecificallyDevised = v; })}
          label="The real property sold was part of the residue — it was not specifically devised."
        />
        <Attest
          checked={e?.propertyWasSoldByExecutor ?? false}
          onChange={(v) => updateExecutor((d) => { d.propertyWasSoldByExecutor = v; })}
          label="The executor or administrator made the sale on behalf of the estate, not the beneficiary."
        />
        <div>
          <Label className="text-xs">Factual basis (required)</Label>
          <Input value={e?.notes ?? ''}
            placeholder="Deed dated 2026-03-04; sale by the executor under the power in Article IV"
            onChange={(ev) => updateExecutor((d) => { d.notes = ev.target.value; })} />
        </div>
      </Block>
    );
  }

  const t = deduction.transferTaxEligibility;
  return (
    <Block
      citation="N.J.A.C. 18:26-7.16 — deductible only where the property the other jurisdiction taxed is also subject to NJ Transfer Inheritance Tax."
      warning={t?.taxedPropertyIsAlsoNJTaxable ? null : 'Without this, the tax paid elsewhere is not a deduction on this return.'}
    >
      <Attest
        checked={t?.taxedPropertyIsAlsoNJTaxable ?? false}
        onChange={(v) => updateTransfer((d) => { d.taxedPropertyIsAlsoNJTaxable = v; })}
        label="The property that jurisdiction taxed is also subject to NJ Transfer Inheritance Tax."
      />
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label className="text-xs">Taxing jurisdiction (required)</Label>
          <Input value={t?.taxingJurisdiction ?? ''} placeholder="Pennsylvania"
            onChange={(ev) => updateTransfer((d) => { d.taxingJurisdiction = ev.target.value; })} />
        </div>
        <div>
          <Label className="text-xs">Factual basis (required)</Label>
          <Input value={t?.notes ?? ''}
            placeholder="PA inheritance tax on the Bucks County property, receipt dated 2026-02-11"
            onChange={(ev) => updateTransfer((d) => { d.notes = ev.target.value; })} />
        </div>
      </div>
    </Block>
  );
}

function Block(
  { citation, warning, children }:
  { citation: string; warning: string | null; children: React.ReactNode },
) {
  return (
    <div className="bg-muted/30 space-y-2 rounded-md border p-3 md:col-span-5">
      <p className="text-muted-foreground text-xs">
        <strong>Attorney attestation.</strong> {citation}
      </p>
      {children}
      {warning && (
        <p className="text-destructive flex items-start gap-1.5 text-xs">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {warning}
        </p>
      )}
    </div>
  );
}

function Attest(
  { checked, onChange, label }:
  { checked: boolean; onChange: (value: boolean) => void; label: string },
) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-1" checked={checked}
        onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
