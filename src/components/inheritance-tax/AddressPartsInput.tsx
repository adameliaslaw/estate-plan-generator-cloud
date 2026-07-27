/**
 * AddressPartsInput
 *
 * Street / Street 2 / City / State / ZIP, filled by Google Places autocomplete on the street
 * line. The official IT-R gives each of those its own box, and a free-text address cannot be
 * split back into them reliably — so they are captured apart here and carried through to the
 * form untouched.
 *
 * It keeps the free-text `address` in step with the parts on every edit. That string remains the
 * required field the server validates, and it is what legacy matters and the on-screen workpaper
 * still read.
 *
 * The inputs are UNCONTROLLED for the same reason `questionnaire/fields/AddressField.tsx` says:
 * `google.maps.places.Autocomplete` attaches native listeners that suppress React 19's
 * controlled-input event flow across the whole group, silently dropping keystrokes. Refs are
 * synced when the value changes from outside (initial load, an autocomplete fill, a reset).
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { US_STATES } from '@/config/constants';
import { useAuth } from '@/hooks/useAuth';
import { useFirmBranding } from '@/hooks/useFirmBranding';
import { useGooglePlacesAutocomplete } from '@/hooks/useGooglePlacesAutocomplete';
import type { ITRAddressParts } from '@/types/inheritance-tax';

interface AddressPartsInputProps {
  /** Distinguishes the label/input ids when several of these are on one page. */
  idPrefix: string;
  parts: ITRAddressParts | undefined;
  /** The free-text address, used when nothing structured has been entered yet. */
  address: string;
  onChange: (next: { parts: ITRAddressParts; address: string }) => void;
  /** Called with the county Places reported, for pages that track it separately. */
  onCounty?: (county: string) => void;
}

/** One line, the way an envelope reads. This is what the server stores as `address`. */
function joinAddress(p: ITRAddressParts): string {
  const street = [p.street1, p.street2].filter(Boolean).join(', ');
  const tail = [p.city, [p.state, p.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [street, tail].filter(Boolean).join(', ');
}

const EMPTY: ITRAddressParts = { street1: '', city: '', state: 'NJ', zip: '' };

export function AddressPartsInput({ idPrefix, parts, address, onChange, onCounty }: AddressPartsInputProps) {
  const { userProfile } = useAuth();
  const { data: firmBranding } = useFirmBranding(userProfile?.firmId);

  // Before anything structured exists, seed the street line with the free text so an existing
  // matter does not appear to lose its address the moment this renders. Memoised because the
  // autocomplete callback depends on it — a fresh object each render would re-register the
  // Places listener.
  const current: ITRAddressParts = useMemo(
    () => parts ?? { ...EMPTY, street1: address },
    [parts, address],
  );

  const streetRef = useRef<HTMLInputElement>(null);
  const street2Ref = useRef<HTMLInputElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<HTMLSelectElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);

  const emit = useCallback((next: ITRAddressParts) => {
    onChange({ parts: next, address: joinAddress(next) });
  }, [onChange]);

  const handlePlaceSelect = useCallback((c: Partial<{ streetNumber: string; city: string; state: string; zip: string; county: string }>) => {
    const next: ITRAddressParts = {
      street1: c.streetNumber ?? current.street1,
      ...(current.street2 ? { street2: current.street2 } : {}),
      city: c.city ?? current.city,
      state: c.state ?? current.state,
      zip: c.zip ?? current.zip,
    };
    emit(next);
    if (c.county && onCounty) onCounty(c.county);
  }, [current, emit, onCounty]);

  useGooglePlacesAutocomplete(firmBranding?.googleMapsApiKey ?? undefined, streetRef, handlePlaceSelect);

  // Push external changes into the uncontrolled inputs.
  useEffect(() => {
    if (streetRef.current && streetRef.current.value !== current.street1) streetRef.current.value = current.street1;
    const s2 = current.street2 ?? '';
    if (street2Ref.current && street2Ref.current.value !== s2) street2Ref.current.value = s2;
    if (cityRef.current && cityRef.current.value !== current.city) cityRef.current.value = current.city;
    if (stateRef.current && stateRef.current.value !== current.state) stateRef.current.value = current.state;
    if (zipRef.current && zipRef.current.value !== current.zip) zipRef.current.value = current.zip;
  }, [current.street1, current.street2, current.city, current.state, current.zip]);

  return (
    <div className="grid gap-3 sm:grid-cols-6">
      <div className="sm:col-span-4">
        <Label htmlFor={`${idPrefix}-street1`}>Street</Label>
        <Input id={`${idPrefix}-street1`} ref={streetRef} defaultValue={current.street1}
          placeholder="Start typing — addresses autocomplete"
          onChange={(e) => emit({ ...current, street1: e.target.value })} />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor={`${idPrefix}-street2`}>Suite / c/o</Label>
        <Input id={`${idPrefix}-street2`} ref={street2Ref} defaultValue={current.street2 ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            const next = { ...current };
            if (v) next.street2 = v; else delete next.street2;
            emit(next);
          }} />
      </div>
      <div className="sm:col-span-3">
        <Label htmlFor={`${idPrefix}-city`}>City</Label>
        <Input id={`${idPrefix}-city`} ref={cityRef} defaultValue={current.city}
          onChange={(e) => emit({ ...current, city: e.target.value })} />
      </div>
      <div className="sm:col-span-1">
        <Label htmlFor={`${idPrefix}-state`}>State</Label>
        {/* A native select: the form takes a two-letter abbreviation and nothing else. */}
        <select id={`${idPrefix}-state`} ref={stateRef} defaultValue={current.state}
          className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
          onChange={(e) => emit({ ...current, state: e.target.value })}>
          {US_STATES.map((s) => <option key={s.abbr} value={s.abbr}>{s.abbr}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor={`${idPrefix}-zip`}>ZIP</Label>
        <Input id={`${idPrefix}-zip`} ref={zipRef} defaultValue={current.zip} inputMode="numeric"
          onChange={(e) => emit({ ...current, zip: e.target.value })} />
      </div>
    </div>
  );
}
