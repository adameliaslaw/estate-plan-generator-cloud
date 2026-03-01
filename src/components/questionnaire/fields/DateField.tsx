/**
 * DateField
 *
 * Date picker using a native date input with a styled wrapper.
 * - Click to open the calendar picker
 * - Shows selected date formatted as human-readable text
 * - Stores as ISO date string (YYYY-MM-DD)
 * - Falls back gracefully on all browsers
 * - Keyboard accessible
 */

import { CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FieldConfig } from '@/types/questionnaire';

interface DateFieldProps {
  field: FieldConfig;
  value: string | undefined;
  onChange: (value: string) => void;
}

/**
 * Format an ISO date string (YYYY-MM-DD) to a human-readable date.
 * Returns empty string if input is empty/invalid.
 */
function formatDisplayDate(iso: string | undefined): string {
  if (!iso) return '';
  try {
    // Parse as UTC to avoid timezone-shift issues
    const [year, month, day] = iso.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function DateField({ field, value, onChange }: DateFieldProps) {
  const hasValue = !!value;

  return (
    <div className="relative">
      {/* Calendar icon */}
      <CalendarDays
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
        aria-hidden="true"
      />

      {/* Native date input — styled to look custom */}
      <input
        id={field.name}
        type="date"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        required={field.required}
        max="2100-12-31"
        min="1900-01-01"
        className={cn(
          // Base styles
          'w-full rounded-lg border border-gray-300 bg-white py-3 pl-11 pr-4 text-base',
          'focus:border-[#1a365d] focus:outline-none focus:ring-2 focus:ring-[#1a365d]/20',
          'transition-colors',
          // Color
          hasValue ? 'text-gray-900' : 'text-gray-400',
          // Date input specific
          '[&::-webkit-calendar-picker-indicator]:cursor-pointer',
          '[&::-webkit-calendar-picker-indicator]:opacity-60',
          '[&::-webkit-calendar-picker-indicator]:hover:opacity-100',
        )}
      />

      {/* Human-readable preview below the input */}
      {hasValue && (
        <p className="mt-1 text-xs text-[#1a365d]/70">
          {formatDisplayDate(value)}
        </p>
      )}
    </div>
  );
}
