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
import { NJ_COUNTIES, TRANSFER_PARTS } from '@/types/inheritance-tax';
import type {
  ITRAccountDetails, ITRBequest, ITRBondDetails, ITRBusinessDetails, ITRRealPropertyDetails,
  ITRSecurityDetails, ITRTransferDetails, TransferPart,
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

  if (bequest.type === 'nj_real_property') {
    const updateProperty = (mutate: (draft: ITRRealPropertyDetails) => void) =>
      onChange((b) => {
        const draft: ITRRealPropertyDetails = { county: '', ...b.realPropertyDetails };
        mutate(draft);
        if (draft.county.trim()) b.realPropertyDetails = prune(draft);
        else delete b.realPropertyDetails;
      });
    const property = bequest.realPropertyDetails;
    return (
      <Row hint="Schedule A marks every one of these required. What is left blank here is left blank on the return for the attorney to complete.">
        <Field label="NJ county">
          <select className={selectClass} value={property?.county ?? ''}
            onChange={(e) => updateProperty((d) => { d.county = e.target.value; })}>
            <option value="">—</option>
            {NJ_COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Street address, unit" wide>
          <Input value={property?.streetAddress ?? ''}
            onChange={(e) => updateProperty((d) => { d.streetAddress = e.target.value; })} />
        </Field>
        <Field label="Municipality">
          <Input value={property?.municipality ?? ''}
            onChange={(e) => updateProperty((d) => { d.municipality = e.target.value; })} />
        </Field>
        <Field label="Lot(s)">
          <Input value={property?.lots ?? ''}
            onChange={(e) => updateProperty((d) => { d.lots = e.target.value; })} />
        </Field>
        <Field label="Block">
          <Input value={property?.block ?? ''}
            onChange={(e) => updateProperty((d) => { d.block = e.target.value; })} />
        </Field>
        <Field label="Fractional / percent interest">
          <Input value={property?.fractionalInterest ?? ''} placeholder="1/2 or 50%"
            onChange={(e) => updateProperty((d) => { d.fractionalInterest = e.target.value; })} />
        </Field>
        <Field label="Owner(s) / property title">
          <Input value={property?.ownersAndTitle ?? ''}
            onChange={(e) => updateProperty((d) => { d.ownersAndTitle = e.target.value; })} />
        </Field>
        <Field label="Tax assessed value">
          <Input type="number" min={0} value={property?.taxAssessedValue ?? ''}
            onChange={(e) => updateProperty((d) => { d.taxAssessedValue = Number(e.target.value); })} />
        </Field>
        <Field label="Full market value (whole property)">
          <Input type="number" min={0} value={property?.fullMarketValue ?? ''}
            onChange={(e) => updateProperty((d) => { d.fullMarketValue = Number(e.target.value); })} />
        </Field>
        <Field label="Mortgage lien">
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" checked={property?.hasMortgageLien ?? false}
              onChange={(e) => updateProperty((d) => { d.hasMortgageLien = e.target.checked; })} />
            On Schedule D
          </label>
        </Field>
      </Row>
    );
  }

  if (bequest.type === 'closely_held_business') {
    const updateBusiness = (mutate: (draft: ITRBusinessDetails) => void) =>
      onChange((b) => {
        const draft: ITRBusinessDetails = { businessName: '', ...b.businessDetails };
        mutate(draft);
        if (draft.businessName.trim()) b.businessDetails = prune(draft);
        else delete b.businessDetails;
      });
    const business = bequest.businessDetails;
    return (
      <Row hint="Schedule B. The decedent's share is the value above; column (B) is the whole business.">
        <Field label="Business name">
          <Input value={business?.businessName ?? ''}
            onChange={(e) => updateBusiness((d) => { d.businessName = e.target.value; })} />
        </Field>
        <Field label="Federal EIN">
          <Input value={business?.federalEIN ?? ''}
            onChange={(e) => updateBusiness((d) => { d.federalEIN = e.target.value; })} />
        </Field>
        <Field label="Type of business">
          <Input value={business?.businessType ?? ''}
            onChange={(e) => updateBusiness((d) => { d.businessType = e.target.value; })} />
        </Field>
        <Field label="Decedent's ownership">
          <Input value={business?.ownershipPercentage ?? ''} placeholder="40%"
            onChange={(e) => updateBusiness((d) => { d.ownershipPercentage = e.target.value; })} />
        </Field>
        <Field label="Shares held">
          <Input type="number" min={0} value={business?.numberOfShares ?? ''}
            onChange={(e) => updateBusiness((d) => { d.numberOfShares = Number(e.target.value); })} />
        </Field>
        <Field label="Value of entire business">
          <Input type="number" min={0} value={business?.entireBusinessValue ?? ''}
            onChange={(e) => updateBusiness((d) => { d.entireBusinessValue = Number(e.target.value); })} />
        </Field>
        <Field label="Family limited partnership">
          <select className={selectClass}
            value={business?.isFamilyLimitedPartnership === undefined ? '' : String(business.isFamilyLimitedPartnership)}
            onChange={(e) => updateBusiness((d) => {
              // Left unanswered the pair stays unticked on the form, which is not the same as No.
              if (e.target.value === '') delete d.isFamilyLimitedPartnership;
              else d.isFamilyLimitedPartnership = e.target.value === 'true';
            })}>
            <option value="">Not stated</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </Field>
      </Row>
    );
  }

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
