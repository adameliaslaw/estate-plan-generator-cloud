/**
 * src/config/formatting-presets.ts
 *
 * Frontend formatting preset options for the Generate Documents dialog.
 * These mirror the backend FORMATTING_PRESETS but only contain the
 * value/label needed for the dropdown UI.
 */

export interface FormattingPresetOption {
  value: string;
  label: string;
}

/**
 * Available formatting presets shown in the Generation dialog dropdown.
 * The empty value means "use default / no custom formatting".
 */
export const FORMATTING_PRESET_OPTIONS: FormattingPresetOption[] = [
  { value: '',                 label: 'Default (no custom formatting)' },
  { value: 'interactivelegal', label: 'InteractiveLegal' },
  // Add new presets here as they are analyzed and defined in the backend config.
  // { value: 'beyondcounsel', label: 'BeyondCounsel' },
];

/**
 * Get the display label for a formatting preset value.
 */
export function getFormattingPresetLabel(value: string): string {
  const found = FORMATTING_PRESET_OPTIONS.find((p) => p.value === value);
  return found?.label ?? 'Default';
}
