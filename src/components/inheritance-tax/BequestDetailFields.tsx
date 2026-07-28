/**
 * The columns the official IT-R schedules ask for beyond a description and a value.
 *
 * Which fields appear follows the bequest's type, because that is what decides the schedule it
 * prints on: an account lists on B-1 with its institution and registered owners, a stock on B-2
 * with its ticker and share count, a bond on B-3, a transfer on C.
 *
 * Every block is optional. When its leading field is cleared the whole object is dropped rather
 * than sent empty — the server's schemas are strict, and an object missing its required field is
 * rejected at the boundary.
 */
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TRANSFER_PARTS } from '@/types/inheritance-tax';
import type {
  ITRAccountDetails, ITRBequest, ITRBondDetails, ITRSecurityDetails, ITRTransferDetails,
  TransferPart,
} from '@/types/inheritance-tax';

interface Props {
  bequest: ITRBequest;
  /** Applies a mutation to this bequest inside the page's immutable patch. */
  onChange: (mutate: (bequest: ITRBequest) => void) => void;
}

/** Drops keys the server would reject: empty strings, and numbers that never got typed. */
function prune<T extends object>(draft: T): T {
  for (const [key, value] of Object.entries(draft)) {
    const empty = value === undefined || value === '' || value === false
      || (typeof value === 'number' && !Number.isFinite(value));
    if (empty) delete (draft as Record<string, unknown>)[key];
  }
  return draft;
}

const selectClass = 'border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm';

export function BequestDetailFields({ bequest, onChange }: Props) {
  const account = bequest.accountDetails;
  const security = bequest.securityDetails;
  const bond = bequest.bondDetails;
  const transfer = bequest.transferDetails;

  const updateAccount = (mutate: (draft: ITRAccountDetails) => void) =>
    onChange((b) => {
      const draft: ITRAccountDetails = { institutionName: '', ...b.accountDetails };
      mutate(draft);
      if (draft.institutionName.trim()) b.accountDetails = prune(draft);
      else delete b.accountDetails;
    });

  const updateSecurity = (mutate: (draft: ITRSecurityDetails) => void) =>
    onChange((b) => {
      const draft: ITRSecurityDetails = { corporationName: '', ...b.securityDetails };
      mutate(draft);
      if (draft.corporationName.trim()) b.securityDetails = prune(draft);
      else delete b.securityDetails;
    });

  const updateBond = (mutate: (draft: ITRBondDetails) => void) =>
    onChange((b) => {
      const draft: ITRBondDetails = { issuerAndTerms: '', ...b.bondDetails };
      mutate(draft);
      if (draft.issuerAndTerms.trim()) b.bondDetails = prune(draft);
      else delete b.bondDetails;
    });

  const updateTransfer = (mutate: (draft: ITRTransferDetails) => void) =>
    onChange((b) => {
      const draft: ITRTransferDetails = { transfereeName: '', ...b.transferDetails };
      mutate(draft);
      if (draft.transfereeName.trim()) b.transferDetails = prune(draft);
      else delete b.transferDetails;
    });

  if (bequest.type === 'bank_account' || bequest.type === 'retirement_account') {
    return (
      <Row hint="Schedule B-1 prints the institution, the last four digits, and everyone on the account.">
        <Field label="Institution">
          <Input value={account?.institutionName ?? ''}
            onChange={(e) => updateAccount((d) => { d.institutionName = e.target.value; })} />
        </Field>
        <Field label="Account no. (last 4)">
          <Input value={account?.accountNumberLast4 ?? ''} inputMode="numeric" maxLength={4}
            placeholder="4821"
            onChange={(e) => updateAccount((d) => { d.accountNumberLast4 = e.target.value.replace(/\D/g, ''); })} />
        </Field>
        <Field label="Name(s) on account">
          <Input value={account?.registeredOwners ?? ''}
            onChange={(e) => updateAccount((d) => { d.registeredOwners = e.target.value; })} />
        </Field>
      </Row>
    );
  }

  if (bequest.type === 'securities') {
    return (
      <Row hint="Schedule B-2. A co-op prints in Part II, which asks for the registered owner and address instead of a ticker.">
        <Field label={security?.isCoOp ? 'Co-op company' : 'Corporation'}>
          <Input value={security?.corporationName ?? ''}
            onChange={(e) => updateSecurity((d) => { d.corporationName = e.target.value; })} />
        </Field>
        {!security?.isCoOp && (
          <Field label="Ticker">
            <Input value={security?.tickerSymbol ?? ''}
              onChange={(e) => updateSecurity((d) => { d.tickerSymbol = e.target.value; })} />
          </Field>
        )}
        <Field label="Shares">
          <Input type="number" min={0} value={security?.numberOfShares ?? ''}
            onChange={(e) => updateSecurity((d) => { d.numberOfShares = Number(e.target.value); })} />
        </Field>
        {!security?.isCoOp && (
          <Field label="Per-share value">
            <Input type="number" min={0} value={security?.perShareValue ?? ''}
              onChange={(e) => updateSecurity((d) => { d.perShareValue = Number(e.target.value); })} />
          </Field>
        )}
        {security?.isCoOp && (
          <Field label="Registered owner and address">
            <Input value={security?.registeredOwners ?? ''}
              onChange={(e) => updateSecurity((d) => { d.registeredOwners = e.target.value; })} />
          </Field>
        )}
        <Field label="Co-op">
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" checked={security?.isCoOp ?? false}
              onChange={(e) => updateSecurity((d) => { d.isCoOp = e.target.checked; })} />
            Part II
          </label>
        </Field>
        <Field label="NJ corporation">
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" checked={security?.isNJCorporation ?? false}
              onChange={(e) => updateSecurity((d) => { d.isNJCorporation = e.target.checked; })} />
            Check if NJ
          </label>
        </Field>
      </Row>
    );
  }

  if (bequest.type === 'bonds') {
    return (
      <Row hint="Schedule B-3 asks for the bond's terms as well as its issuer.">
        <Field label="Bond and terms" wide>
          <Input value={bond?.issuerAndTerms ?? ''} placeholder="Trenton GO 4% due 2030"
            onChange={(e) => updateBond((d) => { d.issuerAndTerms = e.target.value; })} />
        </Field>
        <Field label="Registered owner(s)">
          <Input value={bond?.registeredOwners ?? ''}
            onChange={(e) => updateBond((d) => { d.registeredOwners = e.target.value; })} />
        </Field>
      </Row>
    );
  }

  if (bequest.type === 'transfer') {
    const part = transfer?.part ?? 'lifetime_within_3_years';
    const isPOD = part === 'pod_to_beneficiary' || part === 'pod_to_estate';
    return (
      <Row hint="Schedule C reports each part separately and asks a separate question about each.">
        <Field label="Reported in" wide>
          <select className={selectClass} value={part}
            onChange={(e) => updateTransfer((d) => { d.part = e.target.value as TransferPart; })}>
            {TRANSFER_PARTS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </Field>
        {!isPOD && (
          <Field label="Date of transfer">
            <Input type="date" value={transfer?.dateOfTransfer ?? ''}
              onChange={(e) => updateTransfer((d) => { d.dateOfTransfer = e.target.value; })} />
          </Field>
        )}
        {isPOD && (
          <Field label="Issuing company and policy no.">
            <Input value={transfer?.issuerName ?? ''}
              onChange={(e) => updateTransfer((d) => { d.issuerName = e.target.value; })} />
          </Field>
        )}
        <Field label={part === 'pod_to_estate' ? 'Payable to' : 'Transferee'}>
          <Input value={transfer?.transfereeName ?? ''}
            onChange={(e) => updateTransfer((d) => { d.transfereeName = e.target.value; })} />
        </Field>
        {part !== 'pod_to_estate' && (
          <Field label="Relationship to decedent">
            <Input value={transfer?.transfereeRelationship ?? ''}
              onChange={(e) => updateTransfer((d) => { d.transfereeRelationship = e.target.value; })} />
          </Field>
        )}
      </Row>
    );
  }

  return null;
}

function Row({ hint, children }: { hint: string; children: React.ReactNode }) {
  return (
    <div className="bg-muted/30 -mt-1 space-y-2 rounded-md border p-3">
      <p className="text-muted-foreground text-xs">{hint}</p>
      <div className="grid gap-3 md:grid-cols-4">{children}</div>
    </div>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? 'md:col-span-2' : undefined}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
