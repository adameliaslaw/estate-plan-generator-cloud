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
 * Everything on screen is a WORKPAPER for attorney review, not a filed return.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calculator, Plus, Trash2, FileText, ShieldCheck, RefreshCw, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
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
    const res = await inheritanceTaxService.save(firmId, matter);
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
    setForm(await inheritanceTaxService.getForm(firmId, matter.matterId, true));
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
                <Input id="ssn" placeholder="NNN-NN-NNNN" value={matter.decedent.ssn}
                  onChange={(e) => patch((d) => { d.decedent.ssn = e.target.value; })} />
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
              <div>
                <Label htmlFor="pr-address">Address</Label>
                <Input id="pr-address" value={matter.personalRepresentative.address}
                  onChange={(e) => patch((d) => { d.personalRepresentative.address = e.target.value; })} />
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
                  <div>
                    <Label>Address</Label>
                    <Input value={b.address}
                      onChange={(e) => patch((d) => { d.beneficiaries[bi]!.address = e.target.value; })} />
                  </div>
                </div>

                {b.bequests.map((q, qi) => (
                  <div key={q.id} className="grid items-end gap-3 md:grid-cols-4">
                    <div>
                      <Label>Asset type</Label>
                      <select className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                        value={q.type}
                        onChange={(e) => patch((d) => { d.beneficiaries[bi]!.bequests[qi]!.type = e.target.value as BequestType; })}>
                        {BEQUEST_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
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
              <div key={d0.id} className="grid items-end gap-3 md:grid-cols-4">
                <div>
                  <Label>Type</Label>
                  <select className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                    value={d0.type}
                    onChange={(e) => patch((d) => { d.deductions[di]!.type = e.target.value as DeductionType; })}>
                    {DEDUCTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <Label>Description</Label>
                  <Input value={d0.description}
                    onChange={(e) => patch((d) => { d.deductions[di]!.description = e.target.value; })} />
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
              <Button variant="ghost" onClick={onLoadAudit} disabled={!saved || busy !== null}>
                <RefreshCw className="mr-2 h-4 w-4" /> Audit trail
              </Button>
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
