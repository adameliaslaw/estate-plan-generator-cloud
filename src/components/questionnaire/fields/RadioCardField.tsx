/**
 * RadioCardField
 *
 * Radio buttons styled as selectable cards.
 * - Each option is a card with label and optional description
 * - Selected card has navy border and subtle background
 * - Keyboard accessible (arrow keys to navigate, space/enter to select)
 * - Works great for distribution plan, healthcare choices, etc.
 */

import React, { useRef } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FieldConfig } from '@/types/questionnaire';

interface RadioCardFieldProps {
  field: FieldConfig;
  value: string | undefined;
  onChange: (value: string) => void;
}

export function RadioCardField({ field, value, onChange }: RadioCardFieldProps) {
  const options = field.options ?? [];
  const containerRef = useRef<HTMLDivElement>(null);

  function handleKeyDown(e: React.KeyboardEvent, optionValue: string) {
    const currentIndex = options.findIndex((o) => o.value === optionValue);

    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next = options[(currentIndex + 1) % options.length];
      onChange(next.value);
      // Focus next button
      const buttons = containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
      buttons?.[(currentIndex + 1) % options.length]?.focus();
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = options[(currentIndex - 1 + options.length) % options.length];
      onChange(prev.value);
      const buttons = containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
      buttons?.[(currentIndex - 1 + options.length) % options.length]?.focus();
    }
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-3"
      role="radiogroup"
      aria-label={field.label}
    >
      {options.map((option) => {
        const isSelected = value === option.value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected || (!value && option === options[0]) ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => handleKeyDown(e, option.value)}
            className={cn(
              'flex w-full items-start gap-4 rounded-xl border-2 p-4 text-left',
              'transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a365d] focus-visible:ring-offset-2',
              'cursor-pointer',
              isSelected
                ? 'border-[#1a365d] bg-[#ebf4ff] shadow-sm'
                : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50',
            )}
          >
            {/* Radio indicator */}
            <div
              className={cn(
                'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                isSelected
                  ? 'border-[#1a365d] bg-[#1a365d]'
                  : 'border-gray-300 bg-white',
              )}
            >
              {isSelected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
            </div>

            {/* Label + description */}
            <div className="flex-1 min-w-0">
              <span
                className={cn(
                  'block text-base font-medium leading-snug',
                  isSelected ? 'text-[#1a365d]' : 'text-gray-800',
                )}
              >
                {option.label}
              </span>
              {option.description && (
                <span
                  className={cn(
                    'mt-1 block text-sm leading-relaxed',
                    isSelected ? 'text-[#1a365d]/70' : 'text-gray-500',
                  )}
                >
                  {option.description}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
