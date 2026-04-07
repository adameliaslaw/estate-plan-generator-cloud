/**
 * functions/src/template-map.ts
 *
 * Centralized mapping for estate document templates based on AI extraction.
 */

export interface TemplateSelectionData {
  is_married: boolean;
  has_trust: boolean;
}

/**
 * Determines the correct .docx filename based on the client's marital and trust status.
 *
 * @param data  The extracted data including marital status and trust requirement.
 * @returns     The filename of the corresponding .docx template.
 */
export function getTemplateName(data: TemplateSelectionData): string {
  if (data.is_married) {
    if (data.has_trust) {
      return 'Married_Trust_Will.docx';
    }
    return 'NJ_Will_Married.docx';
  } else {
    if (data.has_trust) {
      return 'Single_Trust_Will.docx';
    }
    return 'NJ_Will_Single.docx';
  }
}

/**
 * Potential fallback template if a specific match is not found.
 */
export const FALLBACK_TEMPLATE = 'Generic_Will.docx';
