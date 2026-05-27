/**
 * RepeaterField
 *
 * Dynamic add/remove section for arrays of items.
 * - "Add [item]" button appends a new blank item
 * - Each item rendered as a card with inner fields
 * - Remove button (trash icon) on each item
 * - Items receive an auto-generated client-side ID
 * - Handles nested field conditions within each item
 */

import React, { useRef } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FieldConfig } from '@/types/questionnaire';
import { evaluateCondition } from '@/contexts/QuestionnaireContext';

// Import leaf field renderers — we need to render inner fields inline
// without a full StepRenderer (which requires context)
import { YesNoField } from './YesNoField';
import { RadioCardField } from './RadioCardField';
import { CurrencyField } from './CurrencyField';
import { DateField } from './DateField';
import { ComboboxField } from './ComboboxField';
import { AddressField } from './AddressField';

interface RepeaterFieldProps {
  field: FieldConfig;
  value: Record<string, unknown>[];
  onChange: (value: Record<string, unknown>[]) => void;
  parentData?: Record<string, unknown>;
}

// ── Generate a simple client-side ID ──────────────────────────────────────

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Inner field renderer (simplified, no context dependency) ──────────────

interface InnerFieldProps {
  field: FieldConfig;
  itemData: Record<string, unknown>;
  onFieldChange: (name: string, val: unknown) => void;
  parentData?: Record<string, unknown>;
}

function InnerField({ field, itemData, onFieldChange, parentData }: InnerFieldProps) {
  const value = itemData[field.name];

  // Check field-level condition against item data
  if (field.condition) {
    const show = evaluateCondition(
      field.condition,
      itemData as unknown as Parameters<typeof evaluateCondition>[1],
    );
    if (!show) return null;
  }

  function handleChange(val: unknown) {
    onFieldChange(field.name, val);
  }

  function baseInputClass() {
    return cn(
      'w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base text-gray-900',
      'placeholder:text-gray-400',
      'focus:border-[#1a365d] focus:outline-none focus:ring-2 focus:ring-[#1a365d]/20',
      'transition-colors',
    );
  }

  if (field.type === 'heading') {
    return (
      <div className="col-span-2 mt-2 mb-0">
        <h4 className="text-sm font-semibold text-[#1a365d]">{field.label}</h4>
        {field.helpText && <p className="text-xs text-gray-500">{field.helpText}</p>}
      </div>
    );
  }

  let input: React.ReactNode;

  switch (field.type) {
    case 'yesno':
      input = (
        <YesNoField
          field={field}
          value={value as boolean | undefined}
          onChange={handleChange}
        />
      );
      break;

    case 'radio':
      input = (
        <RadioCardField
          field={field}
          value={value as string | undefined}
          onChange={handleChange}
        />
      );
      break;

    case 'currency':
      input = (
        <CurrencyField
          field={field}
          value={value as number | undefined}
          onChange={handleChange}
        />
      );
      break;

    case 'date':
      input = (
        <DateField
          field={field}
          value={value as string | undefined}
          onChange={handleChange}
        />
      );
      break;

    case 'select': {
      // Resolve dynamic options from parentData if optionsFrom is configured
      let resolvedOptions = field.options ?? [];
      if (field.optionsFrom && parentData) {
        const sourceArray = parentData[field.optionsFrom.source];
        if (Array.isArray(sourceArray)) {
          resolvedOptions = sourceArray
            .filter((item: Record<string, unknown>) => item[field.optionsFrom!.labelField])
            .map((item: Record<string, unknown>) => ({
              label: String(item[field.optionsFrom!.labelField]),
              value: String(item[field.optionsFrom!.valueField]),
            }));
        }
      }
      input = (
        <select
          value={(value as string) ?? ''}
          onChange={(e) => handleChange(e.target.value)}
          required={field.required}
          className={cn(baseInputClass(), !(value) && 'text-gray-400')}
        >
          <option value="" disabled>
            {field.placeholder ?? 'Select…'}
          </option>
          {resolvedOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
      break;
    }

    case 'combobox': {
      // Resolve dynamic options from parentData if optionsFrom is configured
      let comboOptions = field.options ?? [];
      if (field.optionsFrom && parentData) {
        const sourceArray = parentData[field.optionsFrom.source];
        if (Array.isArray(sourceArray)) {
          comboOptions = sourceArray
            .filter((item: Record<string, unknown>) => item[field.optionsFrom!.labelField])
            .map((item: Record<string, unknown>) => ({
              label: String(item[field.optionsFrom!.labelField]),
              value: String(item[field.optionsFrom!.valueField]),
            }));
        }
      }
      input = (
        <ComboboxField
          field={field}
          value={value}
          onChange={handleChange}
          options={comboOptions}
        />
      );
      break;
    }

    case 'textarea':
      input = (
        <textarea
          value={(value as string) ?? ''}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={field.placeholder}
          rows={field.rows ?? 2}
          required={field.required}
          className={cn(baseInputClass(), 'resize-y')}
        />
      );
      break;

    case 'address': {
      // Address fields in a repeater item are written at the item level —
      // the address composite (address/city/state/zip/county) becomes
      // sibling keys of the item's other fields like name/dob.
      input = (
        <AddressField
          parentPath={field.name}
          value={itemData}
          onChange={(v) => {
            for (const k of ['address', 'city', 'state', 'zip', 'county']) {
              if (v[k] !== undefined) onFieldChange(k, v[k]);
            }
          }}
          clientAddressSource={parentData?.personalInfo as Record<string, unknown> | undefined}
        />
      );
      break;
    }

    case 'phone':
      input = (
        <input
          type="tel"
          value={(value as string) ?? ''}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
            let formatted = digits;
            if (digits.length > 6) {
              formatted = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
            } else if (digits.length > 3) {
              formatted = `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
            }
            handleChange(formatted);
          }}
          placeholder={field.placeholder ?? '(609) 555-0100'}
          className={baseInputClass()}
        />
      );
      break;

    default:
      input = (
        <input
          type={field.type === 'email' ? 'email' : 'text'}
          value={(value as string) ?? ''}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={field.placeholder}
          required={field.required}
          className={baseInputClass()}
        />
      );
  }

  const widthClass =
    field.width === 'half'
      ? 'col-span-1'
      : field.width === 'third'
      ? 'col-span-1'
      : 'col-span-2';

  return (
    <div className={cn(widthClass, 'flex flex-col gap-1.5')}>
      {field.label && field.type !== 'yesno' && field.type !== 'address' && (
        <label className="text-sm font-medium text-gray-600">
          {field.label}
          {field.required && (
            <span className="ml-1 text-red-500" aria-hidden="true">*</span>
          )}
        </label>
      )}
      {input}
      {field.helpText && field.type !== 'yesno' && (
        <p className="text-xs text-gray-500">{field.helpText}</p>
      )}
    </div>
  );
}

// ============================================================================
// RepeaterField component
// ============================================================================

export function RepeaterField({
  field,
  value,
  onChange,
  parentData,
}: RepeaterFieldProps) {
  const items = value ?? [];
  const innerFields = field.innerFields ?? [];
  const itemLabel = field.itemLabel ?? 'Item';

  // itemsRef holds the LATEST items array so that sequential updates within
  // the same tick (e.g. AddressField's 5 onFieldChange calls per "Same as my
  // address" click) each build on the previous update instead of clobbering
  // it from a stale closure. Without this, only the last-fired field's
  // update survives — the previous 4 are overwritten because all dispatches
  // start from the same closure-captured `items`.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  function addItem() {
    const updated = [...itemsRef.current, { id: generateId() }];
    itemsRef.current = updated;
    onChange(updated);
  }

  function removeItem(index: number) {
    const updated = itemsRef.current.filter((_, i) => i !== index);
    itemsRef.current = updated;
    onChange(updated);
  }

  function updateItem(index: number, fieldName: string, val: unknown) {
    const updated = itemsRef.current.map((item, i) => {
      if (i !== index) return item;
      return { ...item, [fieldName]: val };
    });
    itemsRef.current = updated;
    onChange(updated);
  }

  return (
    <div className="w-full space-y-4">
      {/* Existing items */}
      {items.map((item, index) => (
        <div
          key={(item['id'] as string) ?? index}
          className="relative rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
        >
          {/* Item header */}
          <div className="mb-4 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-[#1a365d]">
              {itemLabel} {index + 1}
            </h4>
            <button
              type="button"
              onClick={() => removeItem(index)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600',
                'hover:bg-red-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400',
              )}
              aria-label={`Remove ${itemLabel} ${index + 1}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </button>
          </div>

          {/* Inner fields grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            {innerFields.map((innerField) => (
              <InnerField
                key={innerField.name}
                field={innerField}
                itemData={item}
                onFieldChange={(name, val) => updateItem(index, name, val)}
                parentData={parentData}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Add button */}
      <button
        type="button"
        onClick={addItem}
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed',
          'border-[#1a365d]/30 bg-white py-4 px-6',
          'text-sm font-medium text-[#1a365d]',
          'hover:border-[#1a365d] hover:bg-[#f0f7ff] transition-all',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a365d]',
        )}
      >
        <Plus className="h-4 w-4" />
        Add {itemLabel}
      </button>

      {/* Help text */}
      {field.helpText && (
        <p className="text-xs text-gray-500">{field.helpText}</p>
      )}
    </div>
  );
}
