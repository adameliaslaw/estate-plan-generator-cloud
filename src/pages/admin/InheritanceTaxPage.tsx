/**
 * InheritanceTaxPage — NJ Transfer Inheritance Tax (IT-R) workpapers.
 *
 * The decedent's estate is entered here directly. It is NOT prefilled from the estate-planning
 * questionnaire: a decedent is almost always a new intake rather than a former planning client, so
 * there is no mapping between the two data models — only an optional client association for the
 * occasional case where a planning client has died.
 *
 * The flow mirrors what the server enforces, and the buttons unlock in that order:
 *   enter → compute → request review → approve (2nd attorney) | finalize (solo) → IT-R
 *
 * The IT-R renders from the *frozen* snapshot taken at review time, so editing a matter afterwards
 * cannot retroactively change a form that was signed off. It just leaves the matter needing a new
 * computation and a new review.
 *
 * What renders ON SCREEN is a WORKPAPER for attorney review, stamped as such. "Download official
 * IT-R" is the exception: it returns the State's own booklet filled from the same approved
 * snapshot, with its fields still interactive. That one is a real return — every figure on it is
 * the attorney's to verify before signing.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, Plus, Trash2, FileText, ShieldCheck, RefreshCw, AlertTriangle, Download } from 'lucide-react';
import { toast } from 'sonner';
import { AddressPartsInput } from '@/components/inheritance-tax/AddressPartsInput';
import { BequestDetailFields } from '@/components/inheritance-tax/BequestDetailFields';
import { DeductionAttestationFields } from '@/components/inheritance-tax/DeductionAttestationFields';
import { attestationProblems, withApplicableAttestations } from '@/lib/inheritance-tax-attestations';
import { useAuth } from '@/hooks/useAuth';
import { inheritanceTaxService } from '@/services/inheritance-tax-service';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import {
  NJ_COUNTIES,
  RELATIONSHIP_GROUPS,
  ENTITY_RELATIONSHIPS,
  BEQUEST_TYPES,
  DEDUCTION_TYPES,
  NOT_REPORTED_ON_ITR,
  type ITRMatterInput,
  type ITRBeneficiary,
  type ITRDeduction,
  type EstateComputationResult,
  type InheritanceMatterSummary,
  type CheckpointResult,
  type ITRFormResult,
  type AuditTrailResult,
  type NJCounty,
  type Relationship,
  type BequestType,
  COMPANION_FORMS,
  type CompanionForm,
  type CompanionFormResult,
  type DeductionType,
  type PersonalRepresentativeTitle,
} from '@/types/inheritance-tax';

const uid = (prefix: string): string => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

const money = (n: number | undefined): string =>
  typeof n === 'number'
    ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    : '—';

function emptyMatter(): ITRMatterInput {
  return {
    matterId: `ITR-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    createdAt: new Date().toISOString(),
    decedent: {
      lastName: '', firstName: '', ssn: '', dateOfDeath: '',
      countyOfResidence: 'Mercer', isNJResident: true,
    },
    willExists: false,
    trustExists: false,
    federalReturnFiled: false,
    virtualCurrencyExists: false,
    disclaimersExist: false,
    personalRepresentative: { name: '', title: 'Executor', address: '', phone: '' },
    beneficiaries: [],
    deductions: [],
  };
}

function emptyBeneficiary(): ITRBeneficiary {
  return {
    id: uid('ben'), lastName: '', firstName: '', address: '',
    relationship: 'child',
    bequests: [{ id: uid('beq'), type: 'bank_account', description: '', fairMarketValue: 0 }],
  };
}

function emptyDeduction(): ITRDeduction {
  return { id: uid('ded'), type: 'funeral_expenses', description: '', amount: 0 };
}

/**
 * Format an SSN as the attorney types. People type nine digits; the schema wants NNN-NN-NNNN,
 * and bouncing that off the server as a regex failure is a poor way to find out.
 */
function formatSSN(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

/**
 * Catch empty required fields before the round trip. The server is still the real validator —
 * this exists because its message for a BLANK date of death is "before 2002-01-01", which sends
 * you looking for the wrong problem.
 */
function missingRequired(m: ITRMatterInput): string[] {
  const missing: string[] = [];
  if (!m.decedent.firstName.trim()) missing.push('Decedent first name');
  if (!m.decedent.lastName.trim()) missing.push('Decedent last name');
  if (!m.decedent.ssn.trim()) missing.push('Decedent SSN');
  else if (!/^\d{3}-\d{2}-\d{4}$/.test(m.decedent.ssn)) missing.push('Decedent SSN (needs 9 digits)');
  if (!m.decedent.dateOfDeath) missing.push('Date of death');
  if (!m.personalRepresentative.name.trim()) missing.push('Personal representative name');
  if (!m.personalRepresentative.address.trim()) missing.push('Personal representative address');
  if (!m.personalRepresentative.phone.trim()) missing.push('Personal representative phone');
  if (m.beneficiaries.length === 0) missing.push('At least one beneficiary');
  m.beneficiaries.forEach((b, i) => {
    if (!b.lastName.trim()) missing.push(`Beneficiary ${i + 1}: name`);
    if (!b.address.trim()) missing.push(`Beneficiary ${i + 1}: address`);
  });
  // The two deduction attestations the server requires. Same reason as the rest of this function:
  // unanswered, they come back as a Zod path rather than as the question they are.
  missing.push(...attestationProblems(m));
  return missing;
}

/** "Gold-2023-09-18" — names a downloaded form by the estate it belongs to. */
function formFileStem(m: ITRMatterInput): string {
  const who = (m.decedent.lastName || 'decedent').replace(/[^\w-]+/g, '-');
  return `${who}-${m.decedent.dateOfDeath || 'undated'}`;
}

/** base64 → a file the browser saves. Shared by the IT-R and the companion forms. */
function downloadPdf(base64: string, filename: string): void {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Server errors arrive as Firebase callable errors; surface the real message, not "internal". */
function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return 'Something went wrong.';
}

export default function InheritanceTaxPage() {
  const { userProfile } = useAuth();
  const firmId = userProfile?.firmId ?? '';
  const currentUid = userProfile?.uid ?? '';

  const [matters, setMatters] = useState<InheritanceMatterSummary[]>([]);
  const [matter, setMatter] = useState<ITRMatterInput | null>(null);
  const [saved, setSaved] = useState(false);
  const [computation, setComputation] = useState<EstateComputationResult | null>(null);
  const [checkpoint, setCheckpoint] = useState<CheckpointResult | null>(null);
  const [form, setForm] = useState<ITRFormResult | null>(null);
  const [companion, setCompanion] = useState<CompanionFormResult | null>(null);
  const [audit, setAudit] = useState<AuditTrailResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    if (!firmId) return;
    try {
      setMatters(await inheritanceTaxService.list(firmId));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, [firmId]);

  useEffect(() => { void refreshList(); }, [refreshList]);

  const grossEntered = useMemo(
    () => (matter?.beneficiaries ?? []).reduce(
      (sum, b) => sum + b.bequests.reduce((s, q) => s + (Number(q.fairMarketValue) || 0), 0), 0),
    [matter],
  );

  // ── Mutations on the working matter ──────────────────────────────────────
  const patch = (fn: (draft: ITRMatterInput) => void) => {
    setMatter((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev) as ITRMatterInput;
      fn(next);
      return next;
    });
    // Any edit invalidates a computation and its review — same rule the server enforces.
    setComputation(null);
    setCheckpoint(null);
    setForm(null);
  };

  // ── Server actions ───────────────────────────────────────────────────────
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const onSave = () => run('save', async () => {
    if (!matter) return;
    const missing = missingRequired(matter);
    if (missing.length > 0) {
      toast.error(`Still needed: ${missing.join(', ')}`);
      return;
    }
    const res = await inheritanceTaxService.save(firmId, withApplicableAttestations(matter));
    setSaved(true);
    toast.success(res.created ? 'Matter created.' : 'Matter saved.');
    await refreshList();
  });

  const onCompute = () => run('compute', async () => {
    if (!matter) return;
    const res = await inheritanceTaxService.compute(firmId, matter.matterId);
    setComputation(res);
    toast.success('Computed.');
  });

  const onRequestReview = () => run('review', async () => {
    if (!matter) return;
    const res = await inheritanceTaxService.requestReview(firmId, matter.matterId);
    setCheckpoint(res);
    toast.success('Review requested — the figures above are now frozen.');
  });

  const onFinalize = () => run('finalize', async () => {
    if (!matter || !checkpoint) return;
    const res = await inheritanceTaxService.finalize(firmId, matter.matterId, checkpoint.checkpointId);
    setCheckpoint(res);
    toast.success('Finalized. Recorded as your own review, not an independent one.');
  });

  const onApprove = () => run('approve', async () => {
    if (!matter || !checkpoint) return;
    const res = await inheritanceTaxService.approve(firmId, matter.matterId, checkpoint.checkpointId);
    setCheckpoint(res);
    toast.success('Approved by a second attorney.');
  });

  const onLoadForm = () => run('form', async () => {
    if (!matter) return;
    setForm(await inheritanceTaxService.getForm(firmId, matter.matterId, { html: true }));
  });

  /**
   * The companion forms. Each is refused server-side when the estate does not meet its own
   * precondition, and that refusal is the useful answer — it names the reason (no extension
   * recorded, tax is due, the death is after the estate tax was repealed), so it is shown
   * rather than swallowed.
   */
  const onLoadCompanion = (form: CompanionForm) => run(`companion:${form}`, async () => {
    if (!matter) return;
    setCompanion(await inheritanceTaxService.getCompanionForm(firmId, matter.matterId, form));
  });

  /**
   * Download the State's own blank for a companion form, filled from the same approved snapshot.
   *
   * Only some are mapped. The server answers without a `pdfBase64` for the rest, and the two
   * reasons are different in kind: IT-Estate has no mapping at all, while the L-9 filler
   * refuses a pre-2018 death because that estate takes the L-9(A) — a materially different
   * State form. The refusal arrives as `failed-precondition` with its own reason, so it needs
   * no special-casing here; only the silent "no mapping" case does.
   */
  const onDownloadCompanion = (companionForm: CompanionForm) =>
    run(`companion-pdf:${companionForm}`, async () => {
      if (!matter) return;
      const res = await inheritanceTaxService.getCompanionForm(firmId, matter.matterId, companionForm, { pdf: true });
      setCompanion(res);
      if (!res.pdfBase64) {
        throw new Error(
          'No official PDF for this form yet — the workpaper above carries the same figures for ' +
          "hand-filling the State's form.",
        );
      }
      const label = COMPANION_FORMS.find((f) => f.value === companionForm)?.value ?? companionForm;
      downloadPdf(res.pdfBase64, `${label.toUpperCase()}-${formFileStem(matter)}.pdf`);
      toast.success('Downloaded. Review every figure before signing.');
    });

  /**
   * Download the State's own IT-R, filled from the approved snapshot. The form fields are left
   * interactive, so it opens in any PDF reader as a return the attorney can correct and sign.
   */
  const onDownloadForm = () => run('pdf', async () => {
    if (!matter) return;
    const res = await inheritanceTaxService.getForm(firmId, matter.matterId, { html: false, pdf: true });
    // Hosting and functions deploy independently, so a browser can be a version ahead of the
    // backend. Say which half is behind rather than reporting a bare failure.
    if (!res.pdfBase64) {
      throw new Error(
        'This page can request the official IT-R, but the server has not been updated to fill it yet. ' +
        'The workpaper above is unaffected.',
      );
    }

    downloadPdf(res.pdfBase64, `IT-R-${formFileStem(matter)}.pdf`);
    toast.success('IT-R downloaded. Review every figure before signing.');
  });

  const onLoadAudit = () => run('audit', async () => {
    if (!matter) return;
    setAudit(await inheritanceTaxService.auditTrail(firmId, matter.matterId));
  });

  const isRequester = checkpoint ? currentUid !== '' : false;
  const approved = checkpoint?.status === 'approved';

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Calculator className="h-6 w-6" /> NJ Inheritance Tax (IT-R)
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Workpaper preparation for a decedent's estate. Entered directly — not linked to the
            planning questionnaire.
          </p>
        </div>
        <Button onClick={() => { setMatter(emptyMatter()); setSaved(false); setComputation(null); setCheckpoint(null); setForm(null); setAudit(null); }}>
          <Plus className="mr-2 h-4 w-4" /> New matter
        </Button>
      </header>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-medium">Existing matters</h2>
        {matters.length === 0 ? (
          <p className="text-muted-foreground text-sm">None yet.</p>
        ) : (
          <ul className="divide-y">
            {matters.map((m) => (
              <li key={m.matterId} className="flex items-center justify-between py-2 text-sm">
                <span>
                  <span className="font-medium">{m.decedentName || m.matterId}</span>
                  <span className="text-muted-foreground ml-2">d. {m.dateOfDeath || '—'}</span>
                </span>
                <span className="text-muted-foreground text-xs">{m.matterId}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground mt-2 text-xs">
          This list is projected server-side and never includes an SSN.
        </p>
      </Card>

      {matter && (
        <>
          {/* ── Decedent ─────────────────────────────────────────────── */}
          <Card className="space-y-4 p-4">
            <h2 className="font-medium">Decedent</h2>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <Label htmlFor="first">First name</Label>
                <Input id="first" value={matter.decedent.firstName}
                  onChange={(e) => patch((d) => { d.decedent.firstName = e.target.value; })} />
              </div>
              <div>
                <Label htmlFor="last">Last name</Label>
                <Input id="last" value={matter.decedent.lastName}
                  onChange={(e) => patch((d) => { d.decedent.lastName = e.target.value; })} />
              </div>
              <div>
                <Label htmlFor="ssn">SSN</Label>
                <Input id="ssn" placeholder="123-45-6789" inputMode="numeric" value={matter.decedent.ssn}
                  onChange={(e) => patch((d) => { d.decedent.ssn = formatSSN(e.target.value); })} />
                <p className="text-muted-foreground mt-1 text-xs">Dashes are added for you.</p>
              </div>
              <div>
                <Label htmlFor="dod">Date of death</Label>
                <Input id="dod" type="date" value={matter.decedent.dateOfDeath}
                  onChange={(e) => patch((d) => { d.decedent.dateOfDeath = e.target.value; })} />
                <p className="text-muted-foreground mt-1 text-xs">
                  Selects the rule set. Before 2002-01-01 is not supported.
                </p>
              </div>
              <div>
                <Label htmlFor="county">County of residence</Label>
                <select id="county" className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                  value={matter.decedent.countyOfResidence}
                  onChange={(e) => patch((d) => { d.decedent.countyOfResidence = e.target.value as NJCounty; })}>
                  {NJ_COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="flex items-end gap-2">
                <Checkbox id="resident" checked={matter.decedent.isNJResident !== false}
                  onCheckedChange={(v) => patch((d) => { d.decedent.isNJResident = v === true; })} />
                <Label htmlFor="resident" className="mb-2">NJ resident</Label>
              </div>
            </div>
            {matter.decedent.isNJResident === false && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  A nonresident decedent files <strong>IT-NR</strong>, not IT-R. This engine will refuse
                  to compute it rather than produce a figure.
                </span>
              </div>
            )}
            <div className="flex flex-wrap gap-4 text-sm">
              {([
                ['willExists', 'Will exists'],
                ['trustExists', 'Trust exists'],
                ['federalReturnFiled', 'Federal return filed'],
                ['virtualCurrencyExists', 'Virtual currency'],
                ['disclaimersExist', 'Disclaimers'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2">
                  <Checkbox checked={matter[key]}
                    onCheckedChange={(v) => patch((d) => { (d[key] as boolean) = v === true; })} />
                  {label}
                </label>
              ))}
            </div>
          </Card>

          {/* ── Personal representative ──────────────────────────────── */}
          <Card className="space-y-4 p-4">
            <h2 className="font-medium">Personal representative</h2>
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <Label htmlFor="pr-name">Name</Label>
                <Input id="pr-name" value={matter.personalRepresentative.name}
                  onChange={(e) => patch((d) => { d.personalRepresentative.name = e.target.value; })} />
              </div>
              <div>
                <Label htmlFor="pr-title">Title</Label>
                <select id="pr-title" className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                  value={matter.personalRepresentative.title}
                  onChange={(e) => patch((d) => { d.personalRepresentative.title = e.target.value as PersonalRepresentativeTitle; })}>
                  <option value="Executor">Executor</option>
                  <option value="Administrator">Administrator</option>
                  <option value="Heir-at-law">Heir-at-law</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <AddressPartsInput
                  idPrefix="pr"
                  parts={matter.personalRepresentative.addressParts}
                  address={matter.personalRepresentative.address}
                  onChange={({ parts, address }) => patch((d) => {
                    d.personalRepresentative.addressParts = parts;
                    d.personalRepresentative.address = address;
                  })}
                />
              </div>
              <div>
                <Label htmlFor="pr-phone">Phone</Label>
                <Input id="pr-phone" value={matter.personalRepresentative.phone}
                  onChange={(e) => patch((d) => { d.personalRepresentative.phone = e.target.value; })} />
              </div>
            </div>
          </Card>

          {/* ── Beneficiaries ────────────────────────────────────────── */}
          <Card className="space-y-4 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Beneficiaries and bequests</h2>
              <Button variant="outline" size="sm"
                onClick={() => patch((d) => { d.beneficiaries.push(emptyBeneficiary()); })}>
                <Plus className="mr-2 h-4 w-4" /> Add beneficiary
              </Button>
            </div>
            <p className="text-muted-foreground text-sm">
              <strong>Relationship drives the tax class</strong> (N.J.S.A. 54:34-2) — it is the field
              to double-check. The picker is grouped by the class it produces.
            </p>
            {/* Errors of commission: the engine taxes whatever it is given, so entering one of
                these raises the tax on a filed return and nothing errors. */}
            <div className="bg-muted/30 space-y-1.5 rounded-md border p-3">
              <p className="text-xs font-medium">Not reported on the IT-R — do not enter</p>
              <ul className="text-muted-foreground space-y-1 text-xs">
                {NOT_REPORTED_ON_ITR.map((x) => (
                  <li key={x.what}><strong>{x.what}.</strong> {x.why}</li>
                ))}
              </ul>
            </div>
            {matter.beneficiaries.map((b, bi) => (
              <div key={b.id} className="space-y-3 rounded-md border p-3">
                <div className="grid gap-3 md:grid-cols-4">
                  <div>
                    <Label>First name</Label>
                    <Input value={b.firstName} disabled={ENTITY_RELATIONSHIPS.has(b.relationship)}
                      onChange={(e) => patch((d) => { d.beneficiaries[bi]!.firstName = e.target.value; })} />
                  </div>
                  <div>
                    <Label>{ENTITY_RELATIONSHIPS.has(b.relationship) ? 'Entity name' : 'Last name'}</Label>
                    <Input value={b.lastName}
                      onChange={(e) => patch((d) => { d.beneficiaries[bi]!.lastName = e.target.value; })} />
                  </div>
                  <div>
                    <Label>Relationship</Label>
                    <select className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                      value={b.relationship}
                      onChange={(e) => patch((d) => { d.beneficiaries[bi]!.relationship = e.target.value as Relationship; })}>
                      {RELATIONSHIP_GROUPS.map((g) => (
                        <optgroup key={g.label} label={g.label}>
                          {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    {/* Schedule E prints the beneficiary's address, so it is captured in parts too. */}
                    <AddressPartsInput
                      idPrefix={`ben-${bi}`}
                      parts={b.addressParts}
                      address={b.address}
                      onChange={({ parts, address }) => patch((d) => {
                        d.beneficiaries[bi]!.addressParts = parts;
                        d.beneficiaries[bi]!.address = address;
                      })}
                    />
                  </div>
                </div>

                {b.bequests.map((q, qi) => (
                  <div key={q.id} className="space-y-2">
                  <div className="grid items-end gap-3 md:grid-cols-4">
                    <div>
                      <Label>Asset type</Label>
                      <select className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                        value={q.type}
                        onChange={(e) => patch((d) => { d.beneficiaries[bi]!.bequests[qi]!.type = e.target.value as BequestType; })}>
                        {BEQUEST_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      {BEQUEST_TYPES.find((t) => t.value === q.type)?.note && (
                        <p className="text-muted-foreground mt-1 text-xs">
                          {BEQUEST_TYPES.find((t) => t.value === q.type)?.note}
                        </p>
                      )}
                    </div>
                    <div className="md:col-span-2">
                      <Label>Description</Label>
                      <Input value={q.description}
                        onChange={(e) => patch((d) => { d.beneficiaries[bi]!.bequests[qi]!.description = e.target.value; })} />
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <Label>FMV at date of death</Label>
                        <Input type="number" min={0} value={q.fairMarketValue}
                          onChange={(e) => patch((d) => { d.beneficiaries[bi]!.bequests[qi]!.fairMarketValue = Number(e.target.value); })} />
                      </div>
                      <Button variant="ghost" size="icon" aria-label="Remove bequest"
                        onClick={() => patch((d) => { d.beneficiaries[bi]!.bequests.splice(qi, 1); })}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <BequestDetailFields
                    bequest={q}
                    onChange={(mutate) => patch((d) => { mutate(d.beneficiaries[bi]!.bequests[qi]!); })} />
                  </div>
                ))}

                <div className="flex gap-2">
                  <Button variant="outline" size="sm"
                    onClick={() => patch((d) => { d.beneficiaries[bi]!.bequests.push({ id: uid('beq'), type: 'bank_account', description: '', fairMarketValue: 0 }); })}>
                    Add bequest
                  </Button>
                  <Button variant="ghost" size="sm"
                    onClick={() => patch((d) => { d.beneficiaries.splice(bi, 1); })}>
                    Remove beneficiary
                  </Button>
                </div>
              </div>
            ))}
          </Card>

          {/* ── Deductions ───────────────────────────────────────────── */}
          <Card className="space-y-4 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Deductions</h2>
              <Button variant="outline" size="sm"
                onClick={() => patch((d) => { d.deductions.push(emptyDeduction()); })}>
                <Plus className="mr-2 h-4 w-4" /> Add deduction
              </Button>
            </div>
            <p className="text-muted-foreground text-sm">
              Distributed <strong>pro rata</strong> across all classes. A will that shifts tax
              differently (specific devise bearing its own tax, residue-only burden) is outside this
              engine's scope — compute it by hand.
            </p>
            {matter.deductions.map((d0, di) => (
              <div key={d0.id} className="grid items-end gap-3 md:grid-cols-5">
                <div>
                  <Label>Type</Label>
                  <select className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                    value={d0.type}
                    onChange={(e) => patch((d) => { d.deductions[di]!.type = e.target.value as DeductionType; })}>
                    {DEDUCTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  {DEDUCTION_TYPES.find((t) => t.value === d0.type)?.note && (
                    <p className="text-muted-foreground mt-1 text-xs">
                      {DEDUCTION_TYPES.find((t) => t.value === d0.type)?.note}
                    </p>
                  )}
                </div>
                <div className="md:col-span-2">
                  <Label>Description</Label>
                  <Input value={d0.description}
                    onChange={(e) => patch((d) => { d.deductions[di]!.description = e.target.value; })} />
                </div>
                <div>
                  <Label>Paid to</Label>
                  <Input value={d0.payeeName ?? ''} placeholder="Optional"
                    onChange={(e) => patch((d) => {
                      const value = e.target.value;
                      // The server's schema is strict and requires a non-empty string, so a
                      // cleared box drops the key rather than sending ''.
                      if (value) d.deductions[di]!.payeeName = value;
                      else delete d.deductions[di]!.payeeName;
                    })} />
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Label>Amount</Label>
                    <Input type="number" min={0} value={d0.amount}
                      onChange={(e) => patch((d) => { d.deductions[di]!.amount = Number(e.target.value); })} />
                  </div>
                  <Button variant="ghost" size="icon" aria-label="Remove deduction"
                    onClick={() => patch((d) => { d.deductions.splice(di, 1); })}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <DeductionAttestationFields
                  deduction={d0}
                  dateOfDeath={matter.decedent.dateOfDeath}
                  onChange={(mutate) => patch((d) => { mutate(d.deductions[di]!); })} />
              </div>
            ))}
          </Card>

          {/* ── Workflow ─────────────────────────────────────────────── */}
          <Card className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={onSave} disabled={busy !== null}>
                {busy === 'save' ? 'Saving…' : 'Save matter'}
              </Button>
              <Button variant="outline" onClick={onCompute} disabled={!saved || busy !== null}>
                {busy === 'compute' ? 'Computing…' : 'Compute tax'}
              </Button>
              <Button variant="outline" onClick={onRequestReview} disabled={!computation || busy !== null}>
                Request review
              </Button>
              <span className="text-muted-foreground text-sm">
                Entered assets: {money(grossEntered)}
              </span>
            </div>

            {computation && (
              <div className="grid gap-3 rounded-md border p-3 text-sm md:grid-cols-5">
                <div><div className="text-muted-foreground">Gross estate</div><div className="font-medium">{money(computation.grossEstate)}</div></div>
                <div><div className="text-muted-foreground">Deductions</div><div className="font-medium">{money(computation.totalDeductions)}</div></div>
                <div><div className="text-muted-foreground">Net estate</div><div className="font-medium">{money(computation.netEstate)}</div></div>
                <div><div className="text-muted-foreground">Total tax</div><div className="font-medium">{money(computation.totalTaxDue)}</div></div>
                <div><div className="text-muted-foreground">Filing deadline</div><div className="font-medium">{computation.filingDeadline}</div></div>
              </div>
            )}

            {checkpoint && (
              <div className="space-y-3 rounded-md border p-3">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant={approved ? 'default' : 'secondary'}>{checkpoint.status}</Badge>
                  <span className="text-muted-foreground">
                    Checkpoint {checkpoint.checkpointId.slice(0, 8)} — these figures are frozen.
                  </span>
                  {checkpoint.finalizationKind && (
                    <Badge variant="outline">{checkpoint.finalizationKind}</Badge>
                  )}
                </div>
                {!approved && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={onApprove} disabled={busy !== null}>
                        <ShieldCheck className="mr-2 h-4 w-4" /> Approve as second attorney
                      </Button>
                      <Button onClick={onFinalize} disabled={busy !== null || !isRequester}>
                        Finalize (I am the only attorney)
                      </Button>
                    </div>
                    <p className="text-muted-foreground text-xs">
                      Finalizing freezes the figures and records that <em>you</em> reviewed them. It is
                      recorded as a finalization, not as an independent review — and approval by a
                      second attorney is refused if it is you.
                    </p>
                  </>
                )}
              </div>
            )}

            <Separator />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={onLoadForm} disabled={!approved || busy !== null}>
                <FileText className="mr-2 h-4 w-4" /> {busy === 'form' ? 'Loading…' : 'Load IT-R'}
              </Button>
              <Button onClick={onDownloadForm} disabled={!approved || busy !== null}>
                <Download className="mr-2 h-4 w-4" />
                {busy === 'pdf' ? 'Filling…' : 'Download official IT-R'}
              </Button>
              <Button variant="ghost" onClick={onLoadAudit} disabled={!saved || busy !== null}>
                <RefreshCw className="mr-2 h-4 w-4" /> Audit trail
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-sm">Companion forms:</span>
              {COMPANION_FORMS.map((f) => (
                <span key={f.value} className="inline-flex items-center gap-1">
                  <Button variant="outline" size="sm" title={f.hint}
                    onClick={() => onLoadCompanion(f.value)} disabled={!approved || busy !== null}>
                    {busy === `companion:${f.value}` ? 'Loading…' : f.label}
                  </Button>
                  {/* The official blank, where the State's form is mapped. Absent for the two
                      pre-2018 returns, which are hand-filled from the workpaper. */}
                  {f.hasPdf && (
                    <Button variant="ghost" size="sm" title={`Download the State's own ${f.label} filled in`}
                      aria-label={`Download official ${f.label}`}
                      onClick={() => onDownloadCompanion(f.value)} disabled={!approved || busy !== null}>
                      {busy === `companion-pdf:${f.value}`
                        ? '…'
                        : <Download className="h-4 w-4" />}
                    </Button>
                  )}
                </span>
              ))}
            </div>
            {!approved && (
              <p className="text-muted-foreground text-xs">
                The IT-R unlocks only after review — it renders from the frozen snapshot, not from
                the form above.
              </p>
            )}
          </Card>

          {form?.html && (
            <Card className="p-4">
              <h2 className="mb-2 font-medium">IT-R — WORKPAPER, not for filing</h2>
              {/* Server-rendered from the frozen snapshot. */}
              <div className="max-h-[70vh] overflow-auto rounded border p-2"
                dangerouslySetInnerHTML={{ __html: form.html }} />
            </Card>
          )}

          {companion && (
            <Card className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-medium">
                  {COMPANION_FORMS.find((f) => f.value === companion.form)?.label} — WORKPAPER, not for filing
                </h2>
                <Button variant="ghost" size="sm" onClick={() => setCompanion(null)}>Close</Button>
              </div>
              {/* Server-rendered from the same frozen snapshot the IT-R renders from. */}
              <div className="max-h-[70vh] overflow-auto rounded border p-2"
                dangerouslySetInnerHTML={{ __html: companion.html }} />
            </Card>
          )}

          {audit && (
            <Card className="p-4">
              <h2 className="mb-2 flex items-center gap-2 font-medium">
                Audit trail
                <Badge variant={audit.chainValid ? 'default' : 'destructive'}>
                  {audit.chainValid ? 'chain valid' : 'CHAIN INVALID'}
                </Badge>
              </h2>
              <ul className="space-y-1 text-sm">
                {audit.entries.map((e) => (
                  <li key={e.entryId} className="flex gap-3">
                    <span className="text-muted-foreground w-44 shrink-0">{e.timestamp}</span>
                    <span className="font-medium">{e.action}</span>
                    <span className="text-muted-foreground">{e.actor}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
