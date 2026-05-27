/**
 * PersonPicker — shortcut dropdown rendered at the top of each fiduciary
 * slot. Lets the client pick someone already identified in the
 * questionnaire (spouse, child, other-dependent, or previously-named
 * fiduciary) and auto-fills the slot's name/relationship/phone/email +
 * address fields.
 *
 * Storage model: copy-at-selection. Picking does NOT create a live link;
 * later edits to the source person don't propagate. This is intentional
 * — keeps the data model simple and avoids surprising side effects when
 * a fiduciary's phone is updated and the original child's phone changes
 * along with it.
 *
 * Implementation: uses updateFields (multi-path dispatch) so one
 * selection fires a single state update instead of N separate dispatches
 * (which would hit the same stale-closure bug fixed in RepeaterField).
 */

import { useMemo } from 'react';
import { useQuestionnaire } from '@/contexts/QuestionnaireContext';
import { getAvailablePeople, type AvailablePerson } from '@/utils/getAvailablePeople';
import { cn } from '@/lib/utils';

interface PersonPickerProps {
  /**
   * Target fiduciary path, e.g. "fiduciaries.executor.primary" or
   * "guardianPrimary". Picking auto-fills <path>.name, .relationship,
   * .gender, .phone, .email, .address, .city, .state, .zip, .county.
   */
  targetPath: string;
  /** Label displayed above the dropdown. */
  label?: string;
  required?: boolean;
}

export function PersonPicker({ targetPath, label = 'Pick someone already in the questionnaire', required }: PersonPickerProps) {
  const { data, updateFields } = useQuestionnaire();

  // Re-derive available people on every render. Cheap (small lists)
  // and avoids cache-invalidation bugs when the source data changes.
  const people: AvailablePerson[] = useMemo(
    () => getAvailablePeople(data, targetPath),
    [data, targetPath],
  );

  function handleSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    if (id === '' || id === '__other') {
      // "Other" or default — clear the slot so user can enter manually.
      // We deliberately do NOT wipe non-address contact fields here;
      // the user might be switching from one source to OTHER mid-edit.
      // The slot fields remain in place; user edits them directly.
      // No-op: reset the dropdown to default for the next selection.
      e.target.value = '';
      return;
    }
    const person = people.find((p) => p.id === id);
    if (!person) return;

    // Single multi-path dispatch — fills name parts + contact fields at once.
    // We write BOTH the split parts and the joined .name so legacy templates
    // bound to {{...name}} keep rendering. The aggregator's deriveName step
    // will recompute .name from parts at generation time, but pre-filling it
    // here keeps the questionnaire UI consistent if the user inspects it.
    const updates: Record<string, unknown> = {};
    updates[`${targetPath}.name`] = person.data.name;
    if (person.data.firstName !== undefined) updates[`${targetPath}.firstName`] = person.data.firstName;
    if (person.data.middleName !== undefined) updates[`${targetPath}.middleName`] = person.data.middleName;
    if (person.data.lastName !== undefined) updates[`${targetPath}.lastName`] = person.data.lastName;
    if (person.data.suffix !== undefined) updates[`${targetPath}.suffix`] = person.data.suffix;
    if (person.data.relationship !== undefined) updates[`${targetPath}.relationship`] = person.data.relationship;
    if (person.data.gender !== undefined) updates[`${targetPath}.gender`] = person.data.gender;
    if (person.data.phone !== undefined) updates[`${targetPath}.phone`] = person.data.phone;
    if (person.data.email !== undefined) updates[`${targetPath}.email`] = person.data.email;
    if (person.data.address !== undefined) updates[`${targetPath}.address`] = person.data.address;
    if (person.data.city !== undefined) updates[`${targetPath}.city`] = person.data.city;
    if (person.data.state !== undefined) updates[`${targetPath}.state`] = person.data.state;
    if (person.data.zip !== undefined) updates[`${targetPath}.zip`] = person.data.zip;
    if (person.data.county !== undefined) updates[`${targetPath}.county`] = person.data.county;

    updateFields(updates);
    // Reset dropdown to default — selection is now "applied" to the slot.
    e.target.value = '';
  }

  if (people.length === 0) {
    // No people to pick from — render nothing. The user will fill in the
    // slot fields manually as before.
    return null;
  }

  return (
    <div className="w-full">
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>
      <select
        value=""
        onChange={handleSelect}
        className={cn(
          'w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base text-gray-900',
          'focus:border-[#1a365d] focus:outline-none focus:ring-2 focus:ring-[#1a365d]/20',
          'transition-colors',
        )}
      >
        <option value="">— Pick to auto-fill, or skip to enter manually —</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
            {p.data.address ? ` — ${p.data.address}` : ''}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-gray-500">
        Selecting copies the person's name and address into the fields below. You can still edit any field after selecting.
      </p>
    </div>
  );
}
