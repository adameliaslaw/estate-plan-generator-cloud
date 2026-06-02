/**
 * src/config/software-sources.ts
 *
 * Shared list of external document-assembly software sources that can be
 * associated with uploaded templates. Used by AddTemplateDialog,
 * BulkTemplateUploadDialog, GenerateDocumentsButton, and KnowledgeBasePage.
 */

export interface SoftwareSourceOption {
  value: string;
  label: string;
}

/**
 * Predefined software sources for template categorization.
 * The `value` is stored in Firestore; the `label` is displayed in the UI.
 */
export const SOFTWARE_SOURCES: SoftwareSourceOption[] = [
  { value: '',               label: 'None / Uncategorized' },
  { value: 'interactivelegal', label: 'InteractiveLegal' },
  { value: 'beyondcounsel',    label: 'BeyondCounsel' },
  { value: 'bolsterbruderlegacy', label: 'BolsterBruderLegacy' },
  { value: 'lexisnexis',      label: 'LexisNexis' },
  { value: 'claude',          label: 'Claude' },
  { value: 'hotdocs',         label: 'HotDocs' },
  { value: 'wealthcounsel',   label: 'WealthCounsel' },
  { value: 'smokeball',       label: 'Smokeball' },
  { value: 'manual',          label: 'Manual / Custom' },
  { value: 'other',           label: 'Other' },
];

/**
 * Get the display label for a software source value.
 */
export function getSoftwareSourceLabel(value: string): string {
  const found = SOFTWARE_SOURCES.find((s) => s.value === value);
  return found?.label ?? (value || 'Uncategorized');
}
