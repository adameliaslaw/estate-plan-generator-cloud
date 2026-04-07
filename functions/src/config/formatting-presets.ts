/**
 * functions/src/config/formatting-presets.ts
 *
 * Defines formatting presets — named style vocabularies that control how
 * AI-generated documents are tagged with CSS classes for DOCX/PDF export.
 *
 * Each software source can have its own formatting conventions. When a user
 * selects a formatting preset during generation, the corresponding promptBlock
 * is injected into the AI system prompt so it outputs semantically tagged HTML.
 *
 * To add a new preset:
 *   1. Analyze sample documents from the source (fonts, spacing, hierarchy)
 *   2. Define a class prefix and the full promptBlock with class descriptions
 *   3. Add matching style entries to TR_STYLE_MAP in export-docx.ts
 *   4. Add matching CSS rules to buildLegalDocumentHtml() in export-pdf.ts
 */

export interface FormattingPreset {
  /** Internal key — matches software source value (e.g. 'interactivelegal') */
  value: string;
  /** Display label for UI dropdown */
  label: string;
  /** CSS class prefix used by this preset (e.g. 'tr') */
  classPrefix: string;
  /**
   * The full PARAGRAPH FORMATTING CLASSES instruction block injected into
   * the AI system prompt. If empty, no formatting classes are used and the
   * AI generates generic HTML.
   */
  promptBlock: string;
}

// ── InteractiveLegal prompt block ────────────────────────────────────────────

const INTERACTIVELEGAL_PROMPT_BLOCK = `PARAGRAPH FORMATTING CLASSES — REQUIRED:
You MUST use these CSS classes on every <p> element to control formatting in the exported document.
Map each paragraph to the appropriate class based on its role:

  <p class="tr-title">       → Document title (centered, underlined, uppercase).
                                Example: "LAST WILL AND TESTAMENT OF JOHN DOE"
  <p class="tr-cover-title">  → Cover page title (centered, multi-line: title / OF / name).
  <p class="tr-cover">        → Cover page info lines (attorney name, firm, address, phone). Centered.
  <p class="tr-mem-header1">  → Section sub-headers like "STATEMENT OF WITNESSES", "ACKNOWLEDGMENT",
                                "SELF-PROVING AFFIDAVIT". Centered, underlined.
  <p class="tr-body1">        → Primary body text — introductory paragraphs, general provisions. Justified.
  <p class="tr-body3">        → Witness/attestation ceremonial text (e.g., "IN WITNESS WHEREOF").
  <p class="tr-art1">         → Article-level headings (centered, bold). Used for both "ARTICLE I" and titles like "FAMILY INFORMATION".
  <p class="tr-art2">         → Sub-article provisions — substantive justified clauses with inline bold sub-headings.
                                Use text-indent for lettered sub-sections (A., B., C.).
  <p class="tr-art3b">        → Sub-sub-article items — numbered items (1., 2., 3.) under Art2 sections.
                                Indented further than Art2.
  <p class="tr-art4b">        → Fourth-level nested items (rare, for deeply nested trust provisions).
  <p class="tr-sig-line">     → Signature line: "____________________________________" (right-aligned block at 3.5" indent).
  <p class="tr-sig-name">     → Name printed below signature line (e.g., "JOHN DOE"). Same 3.5" indent, bold.
  <p class="tr-affid">        → Affidavit jurisdiction block (STATE OF NEW JERSEY / COUNTY format with tab layout).
  <p class="tr-base">         → Blank spacer/separator paragraphs between sections.

TEXT FORMATTING RULES:
- Wrap the principal's full name in <strong> on first reference and in signature blocks.
- Wrap ALL appointed persons' names (executors, trustees, guardians, agents, healthcare reps) in <strong>.
- Wrap article numbers in <strong> when they appear in tr-art1 headings.
- Wrap sub-section heading text in <strong> within tr-art2 paragraphs.
- Use <u> for the document title text inside tr-title and for section headers inside tr-mem-header1.
- Do NOT use <h1>, <h2>, <h3> tags. Use ONLY <p class="tr-*"> for all content.`;

// ── Preset registry ──────────────────────────────────────────────────────────

export const FORMATTING_PRESETS: FormattingPreset[] = [
  {
    value: 'interactivelegal',
    label: 'InteractiveLegal',
    classPrefix: 'tr',
    promptBlock: INTERACTIVELEGAL_PROMPT_BLOCK,
  },
  // Future presets:
  // {
  //   value: 'beyondcounsel',
  //   label: 'BeyondCounsel',
  //   classPrefix: 'bc',
  //   promptBlock: BEYONDCOUNSEL_PROMPT_BLOCK,
  // },
];

/**
 * Look up a formatting preset by its value (software source key).
 * Returns undefined if no preset is defined for that source.
 */
export function getFormattingPreset(value: string): FormattingPreset | undefined {
  return FORMATTING_PRESETS.find((p) => p.value === value);
}
