/**
 * CurrencyField
 *
 * Currency input with dollar sign prefix.
 * - Formats number with commas as user types
 * - Stores as a plain number (dollars)
 * - "$" prefix displayed in the input
 */

import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { FieldConfig } from '@/types/questionnaire';

interface CurrencyFieldProps {
  field: FieldConfig;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}

/**
 * Format a raw number string to comma-separated format.
 * Strips non-numeric characters, preserves decimal.
 */
function formatCurrency(raw: string): string {
  // Remove everything except digits and one decimal point
  const cleaned = raw.replace(/[^\d.]/g, '');
  const parts = cleaned.split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (parts.length > 1) {
    return `${intPart}.${parts[1].slice(0, 2)}`;
  }
  return intPart;
}

/**
 * Parse a formatted string back to a number.
 */
function parseCurrency(display: string): number | undefined {
  const cleaned = display.replace(/,/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? undefined : n;
}

export function CurrencyField({ field, value, onChange }: CurrencyFieldProps) {
  // Internal display state (formatted string)
  const [display, setDisplay] = useState<string>(() => {
    if (value == null) return '';
    return formatCurrency(String(value));
  });

  // Sync display when value changes externally
  useEffect(() => {
    if (value == null) {
      setDisplay('');
    } else {
      // Only update if the parsed value differs (avoid cursor jumps)
      const parsed = parseCurrency(display);
      if (parsed !== value) {
        setDisplay(formatCurrency(String(value)));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const formatted = formatCurrency(raw);
    setDisplay(formatted);
    onChange(parseCurrency(formatted));
  }

  function handleBlur() {
    // Re-format on blur to ensure clean display
    if (value != null) {
      setDisplay(formatCurrency(String(value)));
    }
  }

  return (
    <div className="relative">
      {/* $ prefix */}
      <span
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base font-medium text-gray-500 select-none"
        aria-hidden="true"
      >
        $
      </span>

      <input
        id={field.name}
        type="text"
        inputMode="decimal"
        value={display}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={field.placeholder ?? '0'}
        required={field.required}
        className={cn(
          'w-full rounded-lg border border-gray-300 bg-white py-3 pl-9 pr-4 text-base text-gray-900',
          'placeholder:text-gray-400',
          'focus:border-[#1a365d] focus:outline-none focus:ring-2 focus:ring-[#1a365d]/20',
          'transition-colors',
        )}
        aria-label={field.label}
      />
    </div>
  );
}
