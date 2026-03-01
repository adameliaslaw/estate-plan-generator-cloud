/**
 * PrintableQuestionnaire.tsx
 *
 * Renders all questionnaire sections and questions in a clean, print-friendly
 * format for clients who prefer to fill out the intake by hand.
 *
 * Features:
 * - Organized by section with numbered questions
 * - Multiple-choice questions show checkbox options
 * - Text questions show blank lines for handwriting
 * - "Print" button triggers window.print()
 * - CSS @media print for clean output with page numbers
 * - Header: "Estate Planning Questionnaire — Elias Counsel, LLC"
 * - Repeater fields show one blank block (with "Add additional on reverse if needed")
 *
 * Usage:
 *   <PrintableQuestionnaire clientName="Jane Smith" />
 */

import { useRef } from 'react';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QUESTIONNAIRE_STEPS } from '@/config/questionnaire-steps';
import type { QuestionnaireStep, FieldConfig } from '@/types/questionnaire';

// ---------------------------------------------------------------------------
// Section display names and ordering
// ---------------------------------------------------------------------------

const SECTION_LABELS: Record<string, string> = {
  aboutYou: 'Section 1: About You',
  spouse: 'Section 2: Your Spouse / Domestic Partner',
  children: 'Section 3: Your Children & Dependents',
  assets: 'Section 4: Your Assets',
  liabilities: 'Section 5: Your Liabilities',
  fiduciaries: 'Section 6: Your Fiduciaries',
  wishes: 'Section 7: Your Distribution Wishes',
  healthcare: 'Section 8: Healthcare Preferences',
  additional: 'Section 9: Additional Information',
};

const SECTION_ORDER = [
  'aboutYou',
  'spouse',
  'children',
  'assets',
  'liabilities',
  'fiduciaries',
  'wishes',
  'healthcare',
  'additional',
] as const;

// ---------------------------------------------------------------------------
// Helper: blank answer lines
// ---------------------------------------------------------------------------

function BlankLines({ count = 1 }: { count?: number }) {
  return (
    <div className="mt-1 space-y-1">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border-b border-gray-400" style={{ height: '1.5rem' }} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: render a single field in print format
// ---------------------------------------------------------------------------

function PrintField({
  field,
  questionNumber,
}: {
  field: FieldConfig;
  questionNumber?: number;
}) {
  // Skip internal heading and info fields
  if (field.type === 'heading' || field.type === 'info') {
    if (field.type === 'heading' && field.label) {
      return (
        <div className="mt-3 mb-1">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-600 print:text-[9pt]">
            {field.label}
          </p>
        </div>
      );
    }
    return null;
  }

  const labelText = field.label || field.name;
  const showNumber = questionNumber != null;

  return (
    <div className="mb-4 print:mb-3">
      {/* Label */}
      <label className="block text-sm font-medium text-gray-900 print:text-[10pt]">
        {showNumber && (
          <span className="mr-1 text-gray-500 print:text-[10pt]">{questionNumber}.</span>
        )}
        {labelText}
        {field.required && (
          <span className="ml-1 text-gray-400 text-xs print:text-[9pt]">(required)</span>
        )}
      </label>

      {/* Help text */}
      {field.helpText && (
        <p className="mt-0.5 text-xs text-gray-500 italic print:text-[8pt]">{field.helpText}</p>
      )}

      {/* Answer area based on field type */}
      {renderAnswerArea(field)}
    </div>
  );
}

function renderAnswerArea(field: FieldConfig) {
  const type = field.type;

  // Radio / select with options — show checkboxes
  if ((type === 'radio' || type === 'select') && field.options && field.options.length > 0) {
    return (
      <div className="mt-1 space-y-1">
        {field.options.map((opt) => (
          <div key={opt.value} className="flex items-start gap-2">
            <div
              className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 rounded-sm border border-gray-500 print:h-3 print:w-3"
              aria-hidden="true"
            />
            <div>
              <span className="text-sm text-gray-800 print:text-[10pt]">{opt.label}</span>
              {'description' in opt && opt.description && (
                <p className="text-xs text-gray-500 leading-tight print:text-[8pt]">
                  {opt.description}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Yes/No
  if (type === 'yesno') {
    return (
      <div className="mt-1 flex items-center gap-6">
        <div className="flex items-center gap-1.5">
          <div className="h-3.5 w-3.5 rounded-sm border border-gray-500 print:h-3 print:w-3" />
          <span className="text-sm print:text-[10pt]">Yes</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3.5 w-3.5 rounded-sm border border-gray-500 print:h-3 print:w-3" />
          <span className="text-sm print:text-[10pt]">No</span>
        </div>
      </div>
    );
  }

  // Textarea — multiple lines
  if (type === 'textarea') {
    const rows = field.rows ?? 4;
    return <BlankLines count={rows} />;
  }

  // Repeater — render a compact sub-form
  if (type === 'repeater' && field.repeaterConfig) {
    const { itemLabel, fields: subFields = [] } = field.repeaterConfig;
    return (
      <div className="mt-2 border border-gray-300 rounded p-3 print:border-gray-400">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 print:text-[8pt]">
          {itemLabel} 1
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 print:gap-y-2">
          {subFields
            .filter((sf) => sf.type !== 'heading' && sf.type !== 'info')
            .map((sf) => (
              <div
                key={sf.name}
                className={
                  sf.width === 'full' || sf.type === 'textarea' || sf.type === 'yesno'
                    ? 'col-span-2'
                    : 'col-span-1'
                }
              >
                <label className="block text-xs font-medium text-gray-700 print:text-[9pt]">
                  {sf.label}
                </label>
                {renderAnswerArea(sf)}
              </div>
            ))}
        </div>
        <p className="mt-3 text-[10px] text-gray-400 italic print:text-[8pt]">
          Add additional {itemLabel?.toLowerCase() ?? 'items'} on a separate sheet if needed.
        </p>
      </div>
    );
  }

  // Date field
  if (type === 'date') {
    return (
      <div className="mt-1 flex items-end gap-1">
        <div>
          <p className="text-[9px] text-gray-400 mb-0.5">Month</p>
          <div className="w-10 border-b border-gray-400" style={{ height: '1.4rem' }} />
        </div>
        <p className="text-gray-400 mb-1">/</p>
        <div>
          <p className="text-[9px] text-gray-400 mb-0.5">Day</p>
          <div className="w-10 border-b border-gray-400" style={{ height: '1.4rem' }} />
        </div>
        <p className="text-gray-400 mb-1">/</p>
        <div>
          <p className="text-[9px] text-gray-400 mb-0.5">Year</p>
          <div className="w-16 border-b border-gray-400" style={{ height: '1.4rem' }} />
        </div>
      </div>
    );
  }

  // Number
  if (type === 'number') {
    return <BlankLines count={1} />;
  }

  // Currency
  if (type === 'currency') {
    return (
      <div className="mt-1 flex items-end gap-1">
        <span className="text-sm text-gray-500 mb-0.5">$</span>
        <div className="flex-1 border-b border-gray-400" style={{ height: '1.5rem' }} />
      </div>
    );
  }

  // Phone
  if (type === 'phone') {
    return (
      <div className="mt-1 flex items-end gap-1">
        <span className="text-sm text-gray-500 mb-0.5">(</span>
        <div className="w-8 border-b border-gray-400" style={{ height: '1.5rem' }} />
        <span className="text-sm text-gray-500 mb-0.5">)</span>
        <div className="w-12 border-b border-gray-400" style={{ height: '1.5rem' }} />
        <span className="text-sm text-gray-500 mb-0.5">-</span>
        <div className="w-16 border-b border-gray-400" style={{ height: '1.5rem' }} />
      </div>
    );
  }

  // SSN last 4
  if (type === 'ssn4') {
    return (
      <div className="mt-1 flex items-end gap-1">
        <span className="text-sm text-gray-500 mb-0.5">XXX - XX -</span>
        <div className="w-14 border-b border-gray-400" style={{ height: '1.5rem' }} />
      </div>
    );
  }

  // Default: single blank line (text, email, etc.)
  return <BlankLines count={1} />;
}

// ---------------------------------------------------------------------------
// Section renderer
// ---------------------------------------------------------------------------

function PrintSection({
  section,
  steps,
  globalQuestionRef,
}: {
  section: string;
  steps: QuestionnaireStep[];
  globalQuestionRef: { current: number };
}) {
  if (steps.length === 0) return null;

  const sectionLabel = SECTION_LABELS[section] ?? `Section: ${section}`;

  return (
    <section className="mb-8 print:mb-6 print:break-inside-avoid-page">
      {/* Section header */}
      <div className="mb-4 border-b-2 border-[#1a365d] pb-1 print:border-[#1a365d]">
        <h2 className="text-base font-bold text-[#1a365d] uppercase tracking-wide print:text-[11pt]">
          {sectionLabel}
        </h2>
        {/* Section-level condition note */}
        {steps[0].condition && (
          <p className="text-[11px] text-gray-500 italic print:text-[8pt]">
            Complete this section only if applicable to your situation.
          </p>
        )}
      </div>

      {/* Steps within the section */}
      <div className="space-y-5 print:space-y-3">
        {steps.map((step) => {
          // Skip steps with no renderable fields
          const renderableFields = step.fields.filter(
            (f) => f.type !== 'info' || f.type === 'info',
          );
          if (renderableFields.length === 0) return null;

          return (
            <div key={step.id} className="print:break-inside-avoid">
              {/* Step title */}
              {step.title && step.title !== '' && (
                <p className="mb-2 text-sm font-semibold text-gray-900 print:text-[10pt]">
                  {step.title}
                </p>
              )}
              {step.subtitle && (
                <p className="mb-2 text-xs text-gray-500 italic print:text-[9pt]">
                  {step.subtitle}
                </p>
              )}

              {/* Conditional note */}
              {step.condition && (
                <p className="mb-2 text-[10px] text-gray-400 bg-gray-50 px-2 py-1 rounded print:text-[8pt]">
                  Note: Complete only if applicable.
                </p>
              )}

              {/* Fields */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-0 print:gap-x-4">
                {step.fields.map((field) => {
                  // Headings span full width
                  if (field.type === 'heading') {
                    return (
                      <div key={field.name} className="col-span-2">
                        <PrintField field={field} />
                      </div>
                    );
                  }
                  // Info fields — skip (they're instructional)
                  if (field.type === 'info') {
                    return null;
                  }

                  // Full-width fields
                  const isFullWidth =
                    field.width === 'full' ||
                    field.type === 'textarea' ||
                    field.type === 'repeater' ||
                    (field.type === 'radio' && field.options && field.options.length > 3) ||
                    field.type === 'yesno';

                  // Increment global question counter for non-heading, non-info fields
                  globalQuestionRef.current += 1;
                  const qNum = globalQuestionRef.current;

                  return (
                    <div
                      key={field.name}
                      className={isFullWidth ? 'col-span-2' : 'col-span-1'}
                    >
                      <PrintField field={field} questionNumber={qNum} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface PrintableQuestionnaireProps {
  clientName?: string;
}

export default function PrintableQuestionnaire({
  clientName,
}: PrintableQuestionnaireProps) {
  const printRef = useRef<HTMLDivElement>(null);

  // Group steps by section, preserving order
  const stepsBySection: Record<string, QuestionnaireStep[]> = {};
  for (const section of SECTION_ORDER) {
    stepsBySection[section] = QUESTIONNAIRE_STEPS.filter((s) => s.section === section);
  }

  // Global question counter (mutable ref, reset per render)
  const globalQuestionRef = { current: 0 };

  return (
    <div>
      {/* Screen-only toolbar */}
      <div className="print:hidden mb-6 flex items-center justify-between rounded-lg border border-[#1a365d]/15 bg-[#ebf4ff] px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-[#1a365d]">Printable Questionnaire</p>
          <p className="text-xs text-[#1a365d]/60">
            Print and complete by hand, then return to our office.
          </p>
        </div>
        <Button
          onClick={() => window.print()}
          className="gap-2 bg-[#1a365d] hover:bg-[#2b6cb0] text-white"
        >
          <Printer className="h-4 w-4" />
          Print Questionnaire
        </Button>
      </div>

      {/* Printable document */}
      <div
        ref={printRef}
        className="bg-white print:bg-white print:text-black"
        id="printable-questionnaire"
      >
        {/* Document header */}
        <header className="mb-6 print:mb-4">
          {/* Firm branding line */}
          <div className="flex items-start justify-between border-b-4 border-[#1a365d] pb-3 print:border-[#1a365d]">
            <div>
              <h1 className="text-lg font-bold text-[#1a365d] print:text-[14pt]">
                Estate Planning Questionnaire
              </h1>
              <p className="text-sm font-medium text-[#2b6cb0] print:text-[11pt]">
                Elias Counsel, LLC
              </p>
            </div>
            <div className="text-right text-xs text-gray-500 print:text-[8pt]">
              <p>168 Prospect Plains Road</p>
              <p>Monroe Township, NJ 08831</p>
              <p>(609) 655-3200</p>
              <p>info@adameliaslaw.com</p>
            </div>
          </div>

          {/* Client info box */}
          <div className="mt-4 grid grid-cols-3 gap-4 rounded border border-gray-300 p-3 print:border-gray-400">
            <div>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide print:text-[8pt]">
                Client Name
              </p>
              {clientName ? (
                <p className="mt-0.5 text-sm font-medium text-gray-900 print:text-[10pt]">
                  {clientName}
                </p>
              ) : (
                <div className="mt-1 border-b border-gray-400" style={{ height: '1.4rem' }} />
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide print:text-[8pt]">
                Date Completed
              </p>
              <div className="mt-1 border-b border-gray-400" style={{ height: '1.4rem' }} />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide print:text-[8pt]">
                File No.
              </p>
              <div className="mt-1 border-b border-gray-400" style={{ height: '1.4rem' }} />
            </div>
          </div>

          {/* Instructions */}
          <div className="mt-4 rounded bg-gray-50 border border-gray-200 px-4 py-3 text-xs text-gray-600 leading-relaxed print:bg-white print:border-gray-300 print:text-[9pt]">
            <p className="font-semibold text-gray-800 mb-1 print:text-[9pt]">Instructions</p>
            <p>
              Please complete all applicable sections. Leave blank any items that do not apply to
              your situation. Use black or blue ink. Print legibly. If you need additional space,
              continue on a separate sheet and indicate the question number. Return the completed
              questionnaire to our office or upload it to your client portal at{' '}
              <span className="font-medium">eliascounsel.com</span>.
            </p>
            <p className="mt-1 text-gray-500 italic">
              CONFIDENTIAL: This document contains personal and legal information protected by the
              attorney-client privilege upon execution of an engagement letter.
            </p>
          </div>
        </header>

        {/* Sections */}
        {SECTION_ORDER.map((section) => (
          <PrintSection
            key={section}
            section={section}
            steps={stepsBySection[section] ?? []}
            globalQuestionRef={globalQuestionRef}
          />
        ))}

        {/* Signature block */}
        <section className="mt-8 print:mt-6 print:break-inside-avoid">
          <div className="border-t-2 border-[#1a365d] pt-4">
            <h2 className="mb-4 text-base font-bold text-[#1a365d] uppercase tracking-wide print:text-[11pt]">
              Certification
            </h2>
            <p className="mb-6 text-sm text-gray-700 print:text-[10pt]">
              I certify that the information provided in this questionnaire is true and accurate to
              the best of my knowledge. I understand that this information will be used to prepare
              my estate planning documents and that any material omissions or inaccuracies may
              affect the validity or effectiveness of those documents.
            </p>
            <div className="grid grid-cols-2 gap-8 print:gap-6">
              <div>
                <div className="border-b border-gray-400" style={{ height: '2rem' }} />
                <p className="mt-1 text-xs text-gray-500 print:text-[8pt]">Client Signature</p>
              </div>
              <div>
                <div className="border-b border-gray-400" style={{ height: '2rem' }} />
                <p className="mt-1 text-xs text-gray-500 print:text-[8pt]">Date</p>
              </div>
              <div>
                <div className="border-b border-gray-400" style={{ height: '2rem' }} />
                <p className="mt-1 text-xs text-gray-500 print:text-[8pt]">Print Name</p>
              </div>
              <div>
                {/* spacer */}
              </div>
            </div>
          </div>
        </section>

        {/* Print footer with page numbers via CSS counters */}
        <div className="hidden print:block print:fixed print:bottom-0 print:left-0 print:right-0 print:text-center print:text-[8pt] print:text-gray-400 print:py-2 print:border-t print:border-gray-200">
          Estate Planning Questionnaire — Elias Counsel, LLC — 168 Prospect Plains Road, Monroe
          Township, NJ 08831 — (609) 655-3200
        </div>
      </div>

      {/* Print CSS */}
      <style>{`
        @media print {
          /* Page setup */
          @page {
            size: letter portrait;
            margin: 0.75in 0.75in 1in 0.75in;

            /* Page number in footer */
            @bottom-center {
              content: "Page " counter(page) " of " counter(pages);
              font-size: 8pt;
              color: #888;
            }
          }

          /* Reset */
          body {
            font-size: 10pt;
            color: #000;
            background: #fff;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          /* Hide screen-only elements */
          .print\\:hidden { display: none !important; }

          /* Show print-only elements */
          .hidden.print\\:block { display: block !important; }

          /* Avoid orphaned headings */
          h1, h2, h3, h4 { page-break-after: avoid; }

          /* Keep section content together where possible */
          section { page-break-inside: avoid; }

          /* Borders and backgrounds */
          * {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          /* Checkbox squares */
          .rounded-sm.border { border: 1.5pt solid #444 !important; }

          /* Blank lines */
          .border-b.border-gray-400 { border-bottom: 1pt solid #444 !important; }

          /* Links: no blue color */
          a { color: #000; text-decoration: none; }
        }
      `}</style>
    </div>
  );
}
