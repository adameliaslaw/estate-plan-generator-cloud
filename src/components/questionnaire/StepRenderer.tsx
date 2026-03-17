/**
 * StepRenderer
 *
 * Renders all fields for a given QuestionnaireStep.
 * Reads/writes values via QuestionnaireContext.
 * Applies field-level conditions (show/hide).
 * Routes each FieldType to the correct input component.
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { useQuestionnaire, getNestedValue, evaluateCondition } from '@/contexts/QuestionnaireContext';
import type { FieldConfig, QuestionnaireStep } from '@/types/questionnaire';

// Field components
import { YesNoField } from './fields/YesNoField';
import { RadioCardField } from './fields/RadioCardField';
import { CurrencyField } from './fields/CurrencyField';
import { AddressField } from './fields/AddressField';
import { RepeaterField } from './fields/RepeaterField';
import { DateField } from './fields/DateField';
import { ComboboxField } from './fields/ComboboxField';

// ============================================================================
// Props
// ============================================================================

interface StepRendererProps {
  step: QuestionnaireStep;
}

// ============================================================================
// Field wrapper (label + help text + error)
// ============================================================================

interface FieldWrapperProps {
  field: FieldConfig;
  children: React.ReactNode;
  error?: string;
}

function FieldWrapper({ field, children, error }: FieldWrapperProps) {
  const widthClass =
    field.width === 'half'
      ? 'col-span-1'
      : field.width === 'third'
      ? 'col-span-1'
      : 'col-span-2';

  // Heading and info types don't get a label wrapper
  if (field.type === 'heading') {
    return (
      <div className={cn('col-span-2', 'mt-4 mb-1')}>
        <h3 className="text-base font-semibold text-[#1a365d]">{field.label}</h3>
        {field.helpText && (
          <p className="text-sm text-gray-500 mt-0.5">{field.helpText}</p>
        )}
      </div>
    );
  }

  if (field.type === 'info') {
    return (
      <div className="col-span-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
        <p className="text-sm text-blue-700">{field.label}</p>
      </div>
    );
  }

  return (
    <div className={cn(widthClass, 'flex flex-col gap-1.5')}>
      {field.label && field.type !== 'yesno' && field.type !== 'address' && (
        <label
          htmlFor={field.name}
          className="text-sm font-medium text-gray-700"
        >
          {field.label}
          {field.required && (
            <span className="ml-1 text-red-500" aria-hidden="true">*</span>
          )}
        </label>
      )}
      {children}
      {field.helpText && field.type !== 'yesno' && (
        <p className="text-xs text-gray-500">{field.helpText}</p>
      )}
      {error && (
        <p className="text-xs text-red-600" role="alert">{error}</p>
      )}
    </div>
  );
}

// ============================================================================
// Individual field renderers
// ============================================================================

interface FieldProps {
  field: FieldConfig;
  value: unknown;
  onChange: (value: unknown) => void;
}

function TextField({ field, value, onChange }: FieldProps) {
  return (
    <input
      id={field.name}
      type={field.type === 'email' ? 'email' : 'text'}
      value={(value as string) ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      required={field.required}
      className={cn(
        'w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base text-gray-900',
        'placeholder:text-gray-400',
        'focus:border-[#1a365d] focus:outline-none focus:ring-2 focus:ring-[#1a365d]/20',
        'transition-colors',
      )}
    />
  );
}

function PhoneField({ field, value, onChange }: FieldProps) {
  function formatPhone(raw: string): string {
    const digits = raw.replace(/\D/g, '').slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  return (
    <input
      id={field.name}
      type="tel"
      value={formatPhone((value as string) ?? '')}
      onChange={(e) => onChange(formatPhone(e.target.value))}
      placeholder={field.placeholder ?? '(609) 555-0100'}
      required={field.required}
      className={cn(
        'w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base text-gray-900',
        'placeholder:text-gray-400',
        'focus:border-[#1a365d] focus:outline-none focus:ring-2 focus:ring-[#1a365d]/20',
        'transition-colors',
      )}
    />
  );
}

function TextareaField({ field, value, onChange }: FieldProps) {
  return (
    <textarea
      id={field.name}
      value={(value as string) ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      rows={field.rows ?? 3}
      required={field.required}
      className={cn(
        'w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base text-gray-900',
        'placeholder:text-gray-400 resize-y',
        'focus:border-[#1a365d] focus:outline-none focus:ring-2 focus:ring-[#1a365d]/20',
        'transition-colors',
      )}
    />
  );
}

function NumberField({ field, value, onChange }: FieldProps) {
  return (
    <input
      id={field.name}
      type="number"
      value={(value as number) ?? ''}
      onChange={(e) =>
        onChange(e.target.value === '' ? undefined : Number(e.target.value))
      }
      placeholder={field.placeholder}
      min={field.min}
      max={field.max}
      required={field.required}
      className={cn(
        'w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base text-gray-900',
        'placeholder:text-gray-400',
        'focus:border-[#1a365d] focus:outline-none focus:ring-2 focus:ring-[#1a365d]/20',
        'transition-colors',
      )}
    />
  );
}

function SelectField({ field, value, onChange }: FieldProps) {
  return (
    <select
      id={field.name}
      value={(value as string) ?? ''}
      onChange={(e) => onChange(e.target.value)}
      required={field.required}
      className={cn(
        'w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base text-gray-900',
        'focus:border-[#1a365d] focus:outline-none focus:ring-2 focus:ring-[#1a365d]/20',
        'transition-colors cursor-pointer',
        !value && 'text-gray-400',
      )}
    >
      <option value="" disabled>
        {field.placeholder ?? 'Select an option…'}
      </option>
      {field.options?.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function CheckboxGroupField({ field, value, onChange }: FieldProps) {
  const selected = Array.isArray(value) ? (value as string[]) : [];

  function toggle(val: string) {
    if (selected.includes(val)) {
      onChange(selected.filter((v) => v !== val));
    } else {
      onChange([...selected, val]);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {field.options?.map((opt) => (
        <label
          key={opt.value}
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
            selected.includes(opt.value)
              ? 'border-[#1a365d] bg-[#ebf4ff]'
              : 'border-gray-200 bg-white hover:border-gray-300',
          )}
        >
          <input
            type="checkbox"
            checked={selected.includes(opt.value)}
            onChange={() => toggle(opt.value)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#1a365d] focus:ring-[#1a365d]/30"
          />
          <span className="text-sm text-gray-700">{opt.label}</span>
        </label>
      ))}
    </div>
  );
}

function SSN4Field({ field, value, onChange }: FieldProps) {
  return (
    <div className="relative w-full sm:w-48">
      <input
        id={field.name}
        type="password"
        inputMode="numeric"
        pattern="[0-9]{4}"
        maxLength={4}
        value={(value as string) ?? ''}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
          onChange(digits);
        }}
        placeholder="••••"
        required={field.required}
        className={cn(
          'w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base text-center tracking-[0.5em]',
          'placeholder:tracking-normal placeholder:text-gray-400',
          'focus:border-[#1a365d] focus:outline-none focus:ring-2 focus:ring-[#1a365d]/20',
          'transition-colors',
        )}
      />
    </div>
  );
}

// ============================================================================
// Main StepRenderer
// ============================================================================

export function StepRenderer({ step }: StepRendererProps) {
  const { data, updateField } = useQuestionnaire();

  function handleChange(fieldName: string, value: unknown) {
    updateField(fieldName, value);
  }

  function shouldShowField(field: FieldConfig): boolean {
    if (!field.condition) return true;
    return evaluateCondition(field.condition, data);
  }

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6">
      {step.fields.map((field) => {
        if (!shouldShowField(field)) return null;

        const value = getNestedValue(
          data as unknown as Record<string, unknown>,
          field.name,
        );

        function onChange(val: unknown) {
          handleChange(field.name, val);
        }

        // ── Route to correct component ─────────────────────────────

        let input: React.ReactNode;

        switch (field.type) {
          case 'heading':
          case 'info':
            // Handled inside FieldWrapper
            input = null;
            break;

          case 'yesno':
            input = (
              <YesNoField
                field={field}
                value={value as boolean | undefined}
                onChange={(v) => onChange(v)}
              />
            );
            break;

          case 'radio':
            input = (
              <RadioCardField
                field={field}
                value={value as string | undefined}
                onChange={(v) => onChange(v)}
              />
            );
            break;

          case 'currency':
            input = (
              <CurrencyField
                field={field}
                value={value as number | undefined}
                onChange={(v) => onChange(v)}
              />
            );
            break;

          case 'address':
            input = (
              <AddressField
                parentPath={field.name}
                value={value as Record<string, unknown> | undefined}
                onChange={(v) => onChange(v)}
              />
            );
            break;

          case 'repeater':
            input = (
              <RepeaterField
                field={field}
                value={Array.isArray(value) ? (value as Record<string, unknown>[]) : []}
                onChange={(v) => onChange(v)}
                parentData={data as unknown as Record<string, unknown>}
              />
            );
            break;

          case 'date':
            input = (
              <DateField
                field={field}
                value={value as string | undefined}
                onChange={(v) => onChange(v)}
              />
            );
            break;

          case 'text':
          case 'email':
            input = <TextField field={field} value={value} onChange={onChange} />;
            break;

          case 'phone':
            input = <PhoneField field={field} value={value} onChange={onChange} />;
            break;

          case 'textarea':
            input = <TextareaField field={field} value={value} onChange={onChange} />;
            break;

          case 'number':
            input = <NumberField field={field} value={value} onChange={onChange} />;
            break;

          case 'select':
            input = <SelectField field={field} value={value} onChange={onChange} />;
            break;

          case 'combobox':
            input = <ComboboxField field={field} value={value} onChange={onChange} />;
            break;

          case 'checkbox':
          case 'multiselect':
            input = (
              <CheckboxGroupField field={field} value={value} onChange={onChange} />
            );
            break;

          case 'ssn4':
            input = <SSN4Field field={field} value={value} onChange={onChange} />;
            break;

          default:
            input = <TextField field={field} value={value} onChange={onChange} />;
        }

        return (
          <FieldWrapper key={field.name} field={field}>
            {input}
          </FieldWrapper>
        );
      })}
    </div>
  );
}
