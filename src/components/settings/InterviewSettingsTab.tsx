/**
 * InterviewSettingsTab.tsx
 *
 * Settings → Interview: firm-level drafting defaults (HOMEWORK D1) — what a
 * new matter starts from before any per-client answer. The record lives at
 * firms/{firmId}/interviewSettings/current and autosaves per change, like
 * Statular's equivalent screen.
 *
 * D1 is the SHELL: the record, the section layout, and controls for the five
 * sections whose fields are concretely known (Documents · Trust · Definitions ·
 * Healthcare · Asset Schedules). POA, Deeds, Signing and Fiduciaries render as
 * placeholders until D7 defines their fields. An absent field means "use the
 * engine's built-in default" — nothing changes behaviour until a generator
 * reads the record (D2+).
 */

import { useEffect, useRef, useState } from 'react';
import { doc, getFirestore, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '@/hooks/useAuth';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import type {
  FirmInterviewSettings,
  IncapacityDeterminer,
} from '@/types';

interface Props {
  firmId: string;
}

const INCAPACITY_OPTIONS: Array<{ value: IncapacityDeterminer; label: string }> = [
  { value: 'two-physicians', label: 'Two physicians' },
  { value: 'physician-and-psychologist', label: 'Physician and psychologist' },
  { value: 'attorney-at-law', label: 'Attorney-at-law' },
  { value: 'governmental-official', label: 'Governmental official' },
  { value: 'trust-protector', label: 'Trust protector' },
  { value: 'court', label: 'Court of competent jurisdiction' },
];

/** Sections that exist conceptually but whose fields arrive with D7. */
const PLACEHOLDER_SECTIONS = [
  { title: 'Power of Attorney', note: 'Defaults for the long-form POA. Fields arrive with D7.' },
  { title: 'Deeds', note: 'Deed drafting defaults. Fields arrive with D7.' },
  { title: 'Signing', note: 'Execution ceremony defaults. Fields arrive with D7.' },
  { title: 'Fiduciaries', note: 'Fiduciary appointment defaults. Fields arrive with D7.' },
] as const;

export default function InterviewSettingsTab({ firmId }: Props) {
  const { userProfile } = useAuth();
  const [settings, setSettings] = useState<Partial<FirmInterviewSettings>>({});
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!firmId) return;
    const ref = doc(getFirestore(), `firms/${firmId}/interviewSettings/current`);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setSettings((snap.data() as Partial<FirmInterviewSettings>) ?? {});
        setLoaded(true);
      },
      (err) => {
        console.error('[InterviewSettingsTab] subscription error:', err);
        setLoaded(true);
      },
    );
    return unsub;
  }, [firmId]);

  /**
   * Merge a partial update into the record and autosave. Writes are merged so
   * concurrent editors (or future sections) never clobber each other's keys.
   */
  function update(patch: Partial<FirmInterviewSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await setDoc(
          doc(getFirestore(), `firms/${firmId}/interviewSettings/current`),
          {
            ...patch,
            firmId,
            updatedAt: serverTimestamp(),
            updatedBy: userProfile?.uid ?? '',
          },
          { merge: true },
        );
        setSaveState('saved');
      } catch (err) {
        console.error('[InterviewSettingsTab] save failed:', err);
        setSaveState('error');
      }
    }, 600);
  }

  if (!loaded) {
    return <p className="text-sm text-muted-foreground">Loading interview defaults…</p>;
  }

  const trust = settings.trust ?? {};
  const definitions = settings.definitions ?? {};
  const healthcare = settings.healthcare ?? {};
  const documents = settings.documents ?? {};

  const toggleIncapacity = (value: IncapacityDeterminer, checked: boolean) => {
    const current = definitions.incapacityDeterminedBy ?? [];
    const next = checked ? [...current, value] : current.filter((v) => v !== value);
    update({ definitions: { ...definitions, incapacityDeterminedBy: next } });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground max-w-2xl">
          These defaults control how new matters start. A blank setting means the
          engine&apos;s current built-in behaviour; nothing here changes documents
          already generated.
        </p>
        <span className="text-xs text-muted-foreground shrink-0">
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved' && 'Saved'}
          {saveState === 'error' && <span className="text-red-600">Save failed — retry a change</span>}
        </span>
      </div>

      {/* ── Documents (D6) ── */}
      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
          <CardDescription>
            Cover letter mode. Per-package default document selection arrives with D6.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="is-cover-letter">Cover letter</Label>
            <Select
              value={documents.coverLetterMode ?? ''}
              onValueChange={(v) =>
                update({ documents: { ...documents, coverLetterMode: v as 'short' | 'ai-distribution-summary' } })
              }
            >
              <SelectTrigger id="is-cover-letter" className="w-72">
                <SelectValue placeholder="Engine default (short letter)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="short">Short letter</SelectItem>
                <SelectItem value="ai-distribution-summary">AI-generated distribution summary</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ── Trust (D3 · D2) ── */}
      <Card>
        <CardHeader>
          <CardTitle>Trust</CardTitle>
          <CardDescription>
            Defaults for trust drafting. The apportionment mode is the NJ
            transfer inheritance tax direction (D2) — it changes what each
            beneficiary actually receives.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="is-representation">Representation</Label>
            <Select
              value={trust.representationType ?? ''}
              onValueChange={(v) =>
                update({ trust: { ...trust, representationType: v as NonNullable<typeof trust.representationType> } })
              }
            >
              <SelectTrigger id="is-representation" className="w-72">
                <SelectValue placeholder="Engine default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="right-of-representation">Right of representation</SelectItem>
                <SelectItem value="per-stirpes">Per stirpes</SelectItem>
                <SelectItem value="per-capita-at-each-generation">Per capita at each generation</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="is-apportionment">Death-tax apportionment</Label>
            <Select
              value={trust.apportionmentMode ?? ''}
              onValueChange={(v) =>
                update({ trust: { ...trust, apportionmentMode: v as NonNullable<typeof trust.apportionmentMode> } })
              }
            >
              <SelectTrigger id="is-apportionment" className="w-72">
                <SelectValue placeholder="Engine default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="residuary">All death taxes from the residue</SelectItem>
                <SelectItem value="apportioned">Each beneficiary bears their own (N.J.S.A. 54:35-6)</SelectItem>
                <SelectItem value="hybrid">Hybrid (specific gifts free of tax; residue apportioned)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(
            [
              ['noContestClause', 'Include a no-contest clause'],
              ['trusteeCompensation', 'Trustee compensation'],
              ['waiveBond', 'Waive bond'],
              ['soleTrusteeCoAppointment', 'Co-appoint on sole-trustee failure'],
              ['substanceAbuseProvisions', 'Substance-abuse provisions'],
              ['contingentSpecialNeedsTrust', 'Contingent special needs trust'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <Label htmlFor={`is-${key}`}>{label}</Label>
              <Checkbox
                id={`is-${key}`}
                checked={trust[key] ?? false}
                onCheckedChange={(checked) => update({ trust: { ...trust, [key]: checked === true } })}
              />
            </div>
          ))}

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="is-special-age">Special distributions age</Label>
            <Input
              id="is-special-age"
              type="number"
              min={18}
              max={45}
              className="w-24"
              value={trust.specialDistributionsAge ?? ''}
              onChange={(e) => {
                const n = e.target.value === '' ? undefined : Number(e.target.value);
                update({ trust: { ...trust, specialDistributionsAge: n } });
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Definitions (D5) ── */}
      <Card>
        <CardHeader>
          <CardTitle>Definitions</CardTitle>
          <CardDescription>
            Incapacity is a multi-select — more than one determiner may apply.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="mb-2 block">Incapacity may be determined by</Label>
            <div className="grid grid-cols-2 gap-2">
              {INCAPACITY_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={(definitions.incapacityDeterminedBy ?? []).includes(opt.value)}
                    onCheckedChange={(checked) => toggleIncapacity(opt.value, checked === true)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="is-children-def">Children definition</Label>
            <Select
              value={definitions.childrenDefinition ?? ''}
              onValueChange={(v) =>
                update({ definitions: { ...definitions, childrenDefinition: v as 'state-probate-code' | 'custom' } })
              }
            >
              <SelectTrigger id="is-children-def" className="w-72">
                <SelectValue placeholder="Engine default (State Probate Code)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="state-probate-code">State Probate Code</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {definitions.childrenDefinition === 'custom' && (
            <div>
              <Label htmlFor="is-children-custom" className="mb-1 block">
                Custom children definition
              </Label>
              <Input
                id="is-children-custom"
                value={definitions.customChildrenDefinition ?? ''}
                onChange={(e) =>
                  update({ definitions: { ...definitions, customChildrenDefinition: e.target.value } })
                }
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Healthcare (D4) ── */}
      <Card>
        <CardHeader>
          <CardTitle>Healthcare</CardTitle>
          <CardDescription>
            The Dementia Directive is a toggle here, not a separate document type (D4).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(
            [
              ['dementiaDirective', 'Include the Dementia Directive'],
              ['visitationAuthorization', 'Visitation authorization'],
              ['leaveInstructionsBlank', 'Leave health care instructions blank'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <Label htmlFor={`is-${key}`}>{label}</Label>
              <Checkbox
                id={`is-${key}`}
                checked={healthcare[key] ?? false}
                onCheckedChange={(checked) => update({ healthcare: { ...healthcare, [key]: checked === true } })}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Asset Schedules (D7 note) ── */}
      <Card>
        <CardHeader>
          <CardTitle>Asset Schedules</CardTitle>
          <CardDescription>
            Preamble text for Schedule A. Rendered through DOMPurify wherever it is shown.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <textarea
            aria-label="Schedule A preamble"
            className="w-full min-h-24 rounded-md border px-3 py-2 text-sm"
            value={settings.assetSchedules?.scheduleAPreambleHtml ?? ''}
            onChange={(e) =>
              update({ assetSchedules: { ...settings.assetSchedules, scheduleAPreambleHtml: e.target.value } })
            }
          />
        </CardContent>
      </Card>

      {/* ── D7 placeholders ── */}
      <div className="grid gap-4 md:grid-cols-2">
        {PLACEHOLDER_SECTIONS.map((s) => (
          <Card key={s.title} className="opacity-70">
            <CardHeader>
              <CardTitle className="text-base">{s.title}</CardTitle>
              <CardDescription>{s.note}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
