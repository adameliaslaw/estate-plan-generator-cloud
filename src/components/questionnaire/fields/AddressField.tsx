/**
 * AddressField
 *
 * Composite address field group:
 * - Street Address (text)
 * - City (text)
 * - State (select — all US states, default NJ)
 * - ZIP (text, 5 digits)
 * - County (select — 21 NJ counties, only shown when state is NJ)
 *
 * All fields are read/written by spreading the parent path object.
 * The parent is responsible for the outer label (if any).
 */

import { cn } from '@/lib/utils';
import { NJ_COUNTIES, US_STATES } from '@/config/constants';
import { useAuth } from '@/hooks/useAuth';
import { useFirmBranding } from '@/hooks/useFirmBranding';
import { useGooglePlacesAutocomplete } from '@/hooks/useGooglePlacesAutocomplete';
import { useRef, useCallback, useEffect } from 'react';

interface AddressFieldProps {
  parentPath: string;
  value: Record<string, unknown> | undefined;
  onChange: (value: Record<string, unknown>) => void;
  required?: boolean;
  /** When provided AND parentPath isn't the client's own personalInfo path,
   *  shows a "Same as my address" button that copies these values into this
   *  fiduciary/spouse/child slot. Most household members share the testator's
   *  address; this saves five fields of redundant typing. */
  clientAddressSource?: Record<string, unknown>;
}

const NJ_COUNTY_OPTIONS = NJ_COUNTIES.map((c) => ({ label: c, value: c }));
const US_STATE_OPTIONS = US_STATES.map((s) => ({ label: s.name, value: s.abbr }));

function inputClass(hasValue: boolean) {
  return cn(
    'w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base text-gray-900',
    'placeholder:text-gray-400',
    'focus:border-[#1a365d] focus:outline-none focus:ring-2 focus:ring-[#1a365d]/20',
    'transition-colors',
    !hasValue && 'text-gray-400',
  );
}

function labelClass() {
  return 'block text-sm font-medium text-gray-700 mb-1.5';
}

export function AddressField({ value, onChange, required, parentPath, clientAddressSource }: AddressFieldProps) {
  const current = value ?? {};
  const { userProfile } = useAuth();
  const { data: firmBranding } = useFirmBranding(userProfile?.firmId);

  // "Same as my address" — only show when:
  //   (a) the caller passed a source (fiduciary / spouse / child step), AND
  //   (b) the source has a real street address to copy, AND
  //   (c) we're not on the client's own personalInfo step (no self-copy).
  const sourceAddress = clientAddressSource as Record<string, unknown> | undefined;
  const sourceStreet = typeof sourceAddress?.address === 'string' ? sourceAddress.address.trim() : '';
  const canCopy = !!sourceAddress && sourceStreet.length > 0 && parentPath !== 'personalInfo';
  const handleCopyFromClient = () => {
    if (!sourceAddress) return;
    onChange({
      ...current,
      address: sourceAddress.address ?? '',
      city: sourceAddress.city ?? '',
      state: sourceAddress.state ?? 'NJ',
      zip: sourceAddress.zip ?? '',
      county: sourceAddress.county ?? '',
    });
  };

  // The state <select> visually defaults to 'NJ', but unless the user actively
  // interacts with it, Firestore never sees the value. Any other address-field
  // edit (street, city, zip) below is going to flush through `update()`, so we
  // take that opportunity to bake the visible-default 'NJ' into the saved data.
  function update(field: string, val: unknown) {
    onChange({
      ...current,
      state: (current['state'] as string) || 'NJ',
      [field]: val,
    });
  }

  const inputRef = useRef<HTMLInputElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<HTMLSelectElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const countySelectRef = useRef<HTMLSelectElement>(null);
  const countyInputRef = useRef<HTMLInputElement>(null);

  const handlePlaceSelect = useCallback((components: Partial<{ streetNumber: string; route: string; city: string; state: string; zip: string; county: string }>) => {
    onChange({
      ...current,
      ...(components.streetNumber && { address: components.streetNumber }),
      ...(components.city && { city: components.city }),
      ...(components.state && { state: components.state }),
      ...(components.zip && { zip: components.zip }),
      ...(components.county && { county: components.county }),
    });
  }, [current, onChange]);

  useGooglePlacesAutocomplete(firmBranding?.googleMapsApiKey ?? undefined, inputRef, handlePlaceSelect);

  const addressValue = (current['address'] as string) ?? '';
  const cityValue = (current['city'] as string) ?? '';
  const stateValue = (current['state'] as string) || 'NJ';
  const zipValue = (current['zip'] as string) ?? '';
  const countyValue = (current['county'] as string) ?? '';

  // ALL AddressField inputs are UNCONTROLLED (defaultValue + onChange) because
  // google.maps.places.Autocomplete attaches native event listeners that
  // suppress React 19's controlled-input event flow across the entire
  // address sub-form, causing user keystrokes to silently drop. We sync
  // ref.current.value whenever the canonical value changes externally
  // (initial load, "Same as my address" button, autocomplete fill) and
  // the displayed value diverges from state.
  useEffect(() => {
    if (inputRef.current && inputRef.current.value !== addressValue) {
      inputRef.current.value = addressValue;
    }
    if (cityRef.current && cityRef.current.value !== cityValue) {
      cityRef.current.value = cityValue;
    }
    if (stateRef.current && stateRef.current.value !== stateValue) {
      stateRef.current.value = stateValue;
    }
    if (zipRef.current && zipRef.current.value !== zipValue) {
      zipRef.current.value = zipValue;
    }
    if (countySelectRef.current && countySelectRef.current.value !== countyValue) {
      countySelectRef.current.value = countyValue;
    }
    if (countyInputRef.current && countyInputRef.current.value !== countyValue) {
      countyInputRef.current.value = countyValue;
    }
  }, [addressValue, cityValue, stateValue, zipValue, countyValue]);

  const isNJ = stateValue === 'NJ';

  return (
    <div className="w-full space-y-4">
      {canCopy && (
        <div>
          <button
            type="button"
            onClick={handleCopyFromClient}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#1a365d]/30 bg-[#1a365d]/5 px-3 py-1.5 text-xs font-medium text-[#1a365d] hover:bg-[#1a365d]/10 hover:border-[#1a365d]/50 transition-colors"
          >
            Same as my address
          </button>
        </div>
      )}
      {/* Street address */}
      <div>
        <label className={labelClass()}>
          Street Address
          {required && <span className="ml-1 text-red-500">*</span>}
        </label>
        <input
          ref={inputRef}
          type="text"
          defaultValue={addressValue}
          onChange={(e) => update('address', e.target.value)}
          placeholder="123 Main Street"
          required={required}
          className={cn(
            'w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base text-gray-900',
            'placeholder:text-gray-400',
            'focus:border-[#1a365d] focus:outline-none focus:ring-2 focus:ring-[#1a365d]/20',
            'transition-colors',
          )}
        />
      </div>

      {/* City + State + ZIP row */}
      <div className="grid grid-cols-6 gap-3">
        {/* City */}
        <div className="col-span-3">
          <label className={labelClass()}>
            City
            {required && <span className="ml-1 text-red-500">*</span>}
          </label>
          <input
            ref={cityRef}
            type="text"
            defaultValue={cityValue}
            onChange={(e) => update('city', e.target.value)}
            placeholder="City"
            required={required}
            className={cn(
              'w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base text-gray-900',
              'placeholder:text-gray-400',
              'focus:border-[#1a365d] focus:outline-none focus:ring-2 focus:ring-[#1a365d]/20',
              'transition-colors',
            )}
          />
        </div>

        {/* State */}
        <div className="col-span-2">
          <label className={labelClass()}>
            State
            {required && <span className="ml-1 text-red-500">*</span>}
          </label>
          <select
            ref={stateRef}
            defaultValue={stateValue}
            onChange={(e) => {
              // Single write: setting state and clearing county in two separate
              // update() calls both rebuild from the same stale `current`
              // closure, and the second call's `state: current.state || 'NJ'`
              // reverts the just-picked state — making any non-NJ state
              // impossible to save. Write both fields at once instead.
              const newState = e.target.value;
              onChange({
                ...current,
                state: newState,
                // Clear county when switching away from NJ (NJ-county select only)
                ...(newState !== 'NJ' ? { county: '' } : {}),
              });
            }}
            required={required}
            className={inputClass(!!(current['state']))}
          >
            {US_STATE_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.value}
              </option>
            ))}
          </select>
        </div>

        {/* ZIP */}
        <div className="col-span-1">
          <label className={labelClass()}>
            ZIP
            {required && <span className="ml-1 text-red-500">*</span>}
          </label>
          <input
            ref={zipRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]{5}"
            maxLength={5}
            defaultValue={zipValue}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 5);
              // Reflect the sanitized value back to the input
              if (zipRef.current && zipRef.current.value !== digits) {
                zipRef.current.value = digits;
              }
              update('zip', digits);
            }}
            placeholder="08831"
            required={required}
            className={cn(
              'w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base text-gray-900',
              'placeholder:text-gray-400',
              'focus:border-[#1a365d] focus:outline-none focus:ring-2 focus:ring-[#1a365d]/20',
              'transition-colors',
            )}
          />
        </div>
      </div>

      {/* County — NJ shows validated dropdown, other states show auto-filled text input */}
      <div>
        <label className={labelClass()}>
          County
          {required && isNJ && <span className="ml-1 text-red-500">*</span>}
        </label>
        {isNJ ? (
          <select
            ref={countySelectRef}
            defaultValue={countyValue}
            onChange={(e) => update('county', e.target.value)}
            required={required && isNJ}
            className={inputClass(!!(current['county']))}
          >
            <option value="" disabled>
              Select county…
            </option>
            {NJ_COUNTY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            ref={countyInputRef}
            type="text"
            defaultValue={countyValue}
            onChange={(e) => update('county', e.target.value)}
            placeholder="Auto-detected from address"
            className={cn(
              'w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base text-gray-900',
              'placeholder:text-gray-400',
              'focus:border-[#1a365d] focus:outline-none focus:ring-2 focus:ring-[#1a365d]/20',
              'transition-colors',
            )}
          />
        )}
      </div>
    </div>
  );
}
