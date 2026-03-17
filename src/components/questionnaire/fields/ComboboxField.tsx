/**
 * ComboboxField
 *
 * A searchable typeahead input that filters options as the user types.
 * Falls back to showing all options when the input is empty/focused.
 * Supports freeform "Other" text when no option matches.
 */

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';
import type { FieldConfig, SelectOption } from '@/types/questionnaire';

interface ComboboxFieldProps {
  field: FieldConfig;
  value: unknown;
  onChange: (value: unknown) => void;
  options?: SelectOption[]; // Allow override (e.g., resolved from optionsFrom)
}

export function ComboboxField({ field, value, onChange, options: overrideOptions }: ComboboxFieldProps) {
  const rawOptions = overrideOptions ?? field.options ?? [];
  const optionsKey = JSON.stringify(rawOptions);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const resolvedOptions = useMemo(() => rawOptions, [optionsKey]);
  const currentValue = (value as string) ?? '';

  // Derive initial input text from value
  const initialLabel = useMemo(() => {
    const opt = resolvedOptions.find((o) => o.value === currentValue);
    return opt?.label ?? currentValue;
  }, [currentValue, resolvedOptions]);

  const [inputText, setInputText] = useState(initialLabel);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  // Sync inputText when value changes externally
  const prevValueRef = useRef(currentValue);
  if (prevValueRef.current !== currentValue) {
    prevValueRef.current = currentValue;
    const opt = resolvedOptions.find((o) => o.value === currentValue);
    // Only sync during render — no setState in effect
    if ((opt?.label ?? currentValue) !== inputText) {
      setInputText(opt?.label ?? currentValue);
    }
  }

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Filter options
  const query = inputText.toLowerCase().trim();
  const filtered = query
    ? resolvedOptions.filter(
        (opt) =>
          opt.label.toLowerCase().includes(query) ||
          opt.value.toLowerCase().includes(query),
      )
    : resolvedOptions;

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        const trimmed = inputText.trim();
        const opt = resolvedOptions.find((o) => o.label.toLowerCase() === trimmed.toLowerCase());
        if (opt) {
          // Exact match — store the canonical value
          onChange(opt.value);
          setInputText(opt.label);
        } else if (trimmed) {
          // Freeform text — store it as-is so document templates get the value
          onChange(trimmed);
        } else {
          // Empty input — clear
          onChange('');
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [inputText, resolvedOptions, onChange]);

  function selectOption(opt: SelectOption) {
    onChange(opt.value);
    setInputText(opt.label);
    setIsOpen(false);
    setHighlightIndex(-1);
    inputRef.current?.blur();
  }

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const el = listRef.current.children[highlightIndex] as HTMLElement;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIndex]);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputText(e.target.value);
    setIsOpen(true);
    setHighlightIndex(-1);
    // Clear value if user is typing (will be set when they select)
    if (currentValue) {
      onChange('');
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setIsOpen(true);
        setHighlightIndex((prev) => Math.min(prev + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightIndex >= 0 && highlightIndex < filtered.length) {
          selectOption(filtered[highlightIndex]);
        } else if (filtered.length === 1) {
          selectOption(filtered[0]);
        } else if (inputText.trim()) {
          // Freeform text — store as-is and close
          onChange(inputText.trim());
          setIsOpen(false);
          setHighlightIndex(-1);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setHighlightIndex(-1);
        inputRef.current?.blur();
        break;
      case 'Tab':
        if (highlightIndex >= 0 && highlightIndex < filtered.length) {
          selectOption(filtered[highlightIndex]);
        } else if (inputText.trim()) {
          // Freeform text on tab-out
          onChange(inputText.trim());
        }
        setIsOpen(false);
        break;
    }
  }

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Input with chevron */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={field.placeholder ?? 'Type to search…'}
          required={field.required}
          autoComplete="off"
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          className={cn(
            'w-full rounded-lg border border-gray-300 bg-white px-4 py-3 pr-10 text-base text-gray-900',
            'placeholder:text-gray-400',
            'focus:border-[#1a365d] focus:outline-none focus:ring-2 focus:ring-[#1a365d]/20',
            'transition-colors',
          )}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            setIsOpen(!isOpen);
            inputRef.current?.focus();
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          aria-label="Toggle options"
        >
          <ChevronDown
            className={cn(
              'h-4 w-4 transition-transform duration-200',
              isOpen && 'rotate-180',
            )}
          />
        </button>
      </div>

      {/* Dropdown list */}
      {isOpen && filtered.length > 0 && (
        <ul
          ref={listRef}
          role="listbox"
          className={cn(
            'absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-gray-200',
            'bg-white py-1 shadow-lg',
            'scrollbar-thin scrollbar-thumb-gray-300',
          )}
        >
          {filtered.map((opt, idx) => (
            <li
              key={opt.value}
              role="option"
              aria-selected={opt.value === currentValue}
              onClick={() => selectOption(opt)}
              onMouseEnter={() => setHighlightIndex(idx)}
              className={cn(
                'cursor-pointer px-4 py-2.5 text-sm transition-colors',
                idx === highlightIndex && 'bg-[#ebf4ff] text-[#1a365d]',
                opt.value === currentValue && idx !== highlightIndex && 'bg-gray-50 font-medium text-[#1a365d]',
                idx !== highlightIndex && opt.value !== currentValue && 'text-gray-700 hover:bg-gray-50',
              )}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}

      {/* No matches message */}
      {isOpen && filtered.length === 0 && inputText.trim() && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-lg">
          <p className="text-sm text-gray-500">
            No match found. The entered text will be used as-is.
          </p>
        </div>
      )}
    </div>
  );
}
