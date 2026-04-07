/**
 * functions/src/template-map.ts
 *
 * Centralized mapping for estate document templates based on AI extraction.
 */

export interface TemplateSelectionData {
  is_married: boolean;
  has_trust: boolean;
  doc_type?: 'will' | 'poa' | 'hc' | 'trust' | 'pourOverWill';
}

/**
 * Determines the correct .docx filename based on the client's status and document type.
 */
export function getTemplateName(data: TemplateSelectionData): string {
  const type = data.doc_type || 'will';

  if (type === 'poa') {
    return data.is_married ? 'NJ_POA_Married.docx' : 'NJ_POA_Single.docx';
  }

  if (type === 'hc') {
    return data.is_married ? 'NJ_HC_Married.docx' : 'NJ_HC_Single.docx';
  }

  if (type === 'trust') {
    // Current legacy samples only have Married Trust, fallback to it if needed
    return data.is_married ? 'Married_Trust.docx' : 'Married_Trust.docx'; 
  }

  if (type === 'pourOverWill') {
    return 'NJ_Pourover_Will.docx';
  }

  // Default to Will logic
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
