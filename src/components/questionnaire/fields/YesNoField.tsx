/**
 * YesNoField
 *
 * Large, accessible Yes/No toggle buttons.
 * - Two buttons side by side
 * - Selected state: firm-navy background, white text
 * - Unselected: white background, navy border
 * - Keyboard accessible (arrow keys, space, enter)
 */

import React, { useRef } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FieldConfig } from '@/types/questionnaire';

interface YesNoFieldProps {
  field: FieldConfig;
  value: boolean | undefined;
  onChange: (value: boolean) => void;
}

export function YesNoField({ field, value, onChange }: YesNoFieldProps) {
  const yesRef = useRef<HTMLButtonElement>(null);
  const noRef = useRef<HTMLButtonElement>(null);

  function handleKeyDown(e: React.KeyboardEvent, btnValue: boolean) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      // Toggle to the other option
      onChange(!btnValue);
      // Focus the other button
      if (btnValue) {
        noRef.current?.focus();
      } else {
        yesRef.current?.focus();
      }
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Label */}
      {field.label && (
        <span className="text-sm font-medium text-gray-700">
          {field.label}
          {field.required && (
            <span className="ml-1 text-red-500" aria-hidden="true">*</span>
          )}
        </span>
      )}

      {/* Buttons */}
      <div
        className="flex gap-3"
        role="group"
        aria-label={field.label}
      >
        {/* Yes */}
        <button
          ref={yesRef}
          type="button"
          role="radio"
          aria-checked={value === true}
          onClick={() => onChange(true)}
          onKeyDown={(e) => handleKeyDown(e, true)}
          className={cn(
            'flex flex-1 items-center justify-center gap-2 rounded-xl border-2 px-6 py-4 text-base font-semibold',
            'transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a365d] focus-visible:ring-offset-2',
            'min-w-[120px] cursor-pointer',
            value === true
              ? 'border-[#1a365d] bg-[#1a365d] text-white shadow-md'
              : 'border-[#1a365d]/30 bg-white text-[#1a365d] hover:border-[#1a365d] hover:bg-[#f0f7ff]',
          )}
        >
          {value === true && <Check className="h-4 w-4" />}
          Yes
        </button>

        {/* No */}
        <button
          ref={noRef}
          type="button"
          role="radio"
          aria-checked={value === false}
          onClick={() => onChange(false)}
          onKeyDown={(e) => handleKeyDown(e, false)}
          className={cn(
            'flex flex-1 items-center justify-center gap-2 rounded-xl border-2 px-6 py-4 text-base font-semibold',
            'transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a365d] focus-visible:ring-offset-2',
            'min-w-[120px] cursor-pointer',
            value === false
              ? 'border-[#1a365d] bg-[#1a365d] text-white shadow-md'
              : 'border-[#1a365d]/30 bg-white text-[#1a365d] hover:border-[#1a365d] hover:bg-[#f0f7ff]',
          )}
        >
          {value === false && <Check className="h-4 w-4" />}
          No
        </button>
      </div>

      {/* Help text */}
      {field.helpText && (
        <p className="text-xs text-gray-500">{field.helpText}</p>
      )}
    </div>
  );
}
