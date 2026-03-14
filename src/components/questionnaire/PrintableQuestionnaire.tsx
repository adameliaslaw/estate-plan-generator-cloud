/**
 * PrintableQuestionnaire.tsx
 *
 * Condensed ~4-5 page estate planning intake form designed for paper.
 *
 * Design decisions:
 * - Dense table layouts instead of one-field-per-row
 * - Assets/liabilities → free-text summary boxes (not structured repeaters)
 * - Fiduciaries → compact table (name + relationship only, no address/phone)
 * - All conditional logic flattened (paper can't branch)
 * - Pre-allocated rows for children (5), bequests (3), beneficiaries (3)
 * - Professional legal intake appearance with firm branding
 *
 * Usage:
 *   <PrintableQuestionnaire />                       — blank form
 *   <PrintableQuestionnaire clientName="J. Smith" />  — headed form
 */

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function BlankLine({ width = '100%' }: { width?: string }) {
  return (
    <div
      className="border-b border-gray-400"
      style={{ height: '1.25rem', width }}
    />
  );
}

function BlankLines({ count = 1 }: { count?: number }) {
  return (
    <div className="space-y-0.5">
      {Array.from({ length: count }).map((_, i) => (
        <BlankLine key={i} />
      ))}
    </div>
  );
}

function CheckOption({ label }: { label: string }) {
  return (
    <div className="flex items-start gap-1.5">
      <div className="mt-[2px] h-3 w-3 flex-shrink-0 border border-gray-500 rounded-sm" />
      <span className="text-[9pt] leading-tight text-gray-800">{label}</span>
    </div>
  );
}

function LabeledField({
  label,
  width = '100%',
  inline = false,
}: {
  label: string;
  width?: string;
  inline?: boolean;
}) {
  if (inline) {
    return (
      <div className="flex items-end gap-1" style={{ width }}>
        <span className="text-[8pt] text-gray-500 whitespace-nowrap pb-0.5">{label}:</span>
        <div className="flex-1 border-b border-gray-400" style={{ height: '1.15rem' }} />
      </div>
    );
  }
  return (
    <div style={{ width }}>
      <p className="text-[8pt] font-medium text-gray-600 mb-0.5">{label}</p>
      <BlankLine />
    </div>
  );
}

function SectionHeader({ title, subtitle, forcePageBreak }: { title: string; subtitle?: string; forcePageBreak?: boolean }) {
  return (
    <div className={`mt-5 mb-2 border-b-2 border-[#1a365d] pb-0.5 pt-1 ${forcePageBreak ? 'print-page-break' : ''}`}>
      <h2 className="text-[10pt] font-bold text-[#1a365d] uppercase" style={{ letterSpacing: '0.03em' }}>
        {title}
      </h2>
      {subtitle && (
        <p className="text-[8pt] text-gray-500 italic mt-0.5">{subtitle}</p>
      )}
    </div>
  );
}

function SubHeader({ title }: { title: string }) {
  return (
    <p className="text-[8pt] font-bold uppercase text-gray-600 mt-3 mb-1" style={{ letterSpacing: '0.03em' }}>
      {title}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Fiduciary block (stacked: name+relationship, then address+phone)
// ---------------------------------------------------------------------------

function FiduciaryBlock({ role }: { role: string }) {
  return (
    <div className="border-b border-gray-300 pb-1.5 mb-1.5" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
      <p className="text-[8pt] font-bold text-gray-700 uppercase tracking-wide mb-0.5">{role}</p>
      <div className="grid grid-cols-2 gap-x-4">
        {/* Primary */}
        <div className="space-y-0.5">
          <p className="text-[7pt] text-gray-400 uppercase">Primary</p>
          <div className="grid grid-cols-2 gap-x-2">
            <LabeledField label="Full Name" />
            <LabeledField label="Relationship" />
          </div>
          <div className="grid grid-cols-2 gap-x-2">
            <LabeledField label="Address" />
            <LabeledField label="Phone" />
          </div>
        </div>
        {/* Alternate */}
        <div className="space-y-0.5">
          <p className="text-[7pt] text-gray-400 uppercase">Alternate</p>
          <div className="grid grid-cols-2 gap-x-2">
            <LabeledField label="Full Name" />
            <LabeledField label="Relationship" />
          </div>
          <div className="grid grid-cols-2 gap-x-2">
            <LabeledField label="Address" />
            <LabeledField label="Phone" />
          </div>
        </div>
      </div>
    </div>
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
  return (
    <div style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
      {/* ── Screen-only toolbar ─────────────────────────────────────────── */}
      <div className="print:hidden mb-6 flex items-center justify-between rounded-lg border border-[#1a365d]/15 bg-[#ebf4ff] px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-[#1a365d]">
            Printable Intake Form (Condensed)
          </p>
          <p className="text-xs text-[#1a365d]/60">
            4-5 page version for in-person interviews and paper intake.
          </p>
        </div>
        <Button
          onClick={() => window.print()}
          className="gap-2 bg-[#1a365d] hover:bg-[#2b6cb0] text-white"
        >
          <Printer className="h-4 w-4" />
          Print Form
        </Button>
      </div>

      {/* ── Printable document ──────────────────────────────────────────── */}
      <div className="bg-white print:bg-white print:text-black" id="printable-questionnaire">
        {/* ============================================================= */}
        {/* HEADER                                                        */}
        {/* ============================================================= */}
        <header className="mb-4">
          <div className="flex items-start justify-between border-b-4 border-[#1a365d] pb-2">
            <div>
              <h1 className="text-[14pt] font-bold text-[#1a365d]">
                Estate Planning Questionnaire
              </h1>
              <p className="text-[10pt] font-medium text-[#2b6cb0]">
                Elias Counsel, LLC
              </p>
            </div>
            <div className="text-right text-[8pt] text-gray-500">
              <p>168 Prospect Plains Road</p>
              <p>Monroe Township, NJ 08831</p>
              <p>(609) 655-3200</p>
            </div>
          </div>

          {/* Client / Date / File No */}
          <div className="mt-3 grid grid-cols-3 gap-3 rounded border border-gray-300 p-2">
            <div>
              <p className="text-[7pt] font-semibold text-gray-500 uppercase">Client Name</p>
              {clientName ? (
                <p className="text-[10pt] font-medium text-gray-900 mt-0.5">{clientName}</p>
              ) : (
                <BlankLine />
              )}
            </div>
            <div>
              <p className="text-[7pt] font-semibold text-gray-500 uppercase">Date</p>
              <BlankLine />
            </div>
            <div>
              <p className="text-[7pt] font-semibold text-gray-500 uppercase">File No.</p>
              <BlankLine />
            </div>
          </div>

          <p className="mt-2 text-[8pt] text-gray-500 italic">
            Please complete all applicable sections using black or blue ink.
            Leave blank any items that do not apply. Continue on a separate
            sheet if needed, noting the section number. CONFIDENTIAL.
          </p>
        </header>

        {/* ============================================================= */}
        {/* SECTION 1: CLIENT INFORMATION                                  */}
        {/* ============================================================= */}
        <SectionHeader title="Section 1 — About You" />

        <div className="grid grid-cols-4 gap-x-3 gap-y-2">
          <LabeledField label="First Name" />
          <LabeledField label="Middle Name" />
          <LabeledField label="Last Name" />
          <LabeledField label="Suffix" />
        </div>
        <div className="grid grid-cols-4 gap-x-3 gap-y-2 mt-2">
          <LabeledField label="Date of Birth" />
          <LabeledField label="Last 4 SSN" width="60%" />
          <div className="col-span-2">
            <p className="text-[8pt] font-medium text-gray-600 mb-0.5">Gender</p>
            <div className="flex gap-4">
              <CheckOption label="Male" />
              <CheckOption label="Female" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-y-2 mt-2">
          <LabeledField label="Street Address" />
        </div>
        <div className="grid grid-cols-4 gap-x-3 gap-y-2 mt-2">
          <LabeledField label="City" />
          <LabeledField label="State" />
          <LabeledField label="ZIP Code" />
          <LabeledField label="County" />
        </div>
        <div className="grid grid-cols-3 gap-x-3 gap-y-2 mt-2">
          <LabeledField label="Email" />
          <LabeledField label="Phone" />
          <LabeledField label="Alternate Phone" />
        </div>
        <div className="grid grid-cols-3 gap-x-3 gap-y-2 mt-2">
          <div>
            <p className="text-[8pt] font-medium text-gray-600 mb-0.5">Marital Status</p>
            <div className="space-y-0.5">
              <CheckOption label="Single" />
              <CheckOption label="Married" />
              <CheckOption label="Domestic Partnership" />
              <CheckOption label="Divorced" />
              <CheckOption label="Widowed" />
              <CheckOption label="Separated" />
            </div>
          </div>
          <div>
            <p className="text-[8pt] font-medium text-gray-600 mb-0.5">Citizenship</p>
            <div className="space-y-0.5">
              <CheckOption label="U.S. Citizen" />
              <CheckOption label="Permanent Resident" />
              <CheckOption label="Non-Resident" />
            </div>
          </div>
          <div className="space-y-2">
            <LabeledField label="Occupation" />
            <LabeledField label="Employer" />
          </div>
        </div>

        {/* ============================================================= */}
        {/* SECTION 2: SPOUSE                                              */}
        {/* ============================================================= */}
        <SectionHeader title="Section 2 — Spouse / Domestic Partner" />
        <p className="text-[8pt] text-gray-500 italic mb-2">
          Complete only if married or in a domestic partnership.
        </p>

        <div className="grid grid-cols-4 gap-x-3 gap-y-2">
          <LabeledField label="First Name" />
          <LabeledField label="Middle Name" />
          <LabeledField label="Last Name" />
          <LabeledField label="Suffix" />
        </div>
        <div className="grid grid-cols-4 gap-x-3 gap-y-2 mt-2">
          <LabeledField label="Date of Birth" />
          <LabeledField label="Last 4 SSN" width="60%" />
          <div className="col-span-2 flex items-end gap-4 pb-0.5">
            <CheckOption label="Same address as above" />
            <span className="text-[8pt] text-gray-400 italic">If not, provide address below:</span>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-y-2 mt-1">
          <LabeledField label="Spouse Address (if different)" />
        </div>

        {/* ============================================================= */}
        {/* SECTION 3: CHILDREN                                            */}
        {/* ============================================================= */}
        <SectionHeader title="Section 3 — Children & Dependents" />

        <table className="w-full text-[9pt] border-collapse mt-1">
          <thead>
            <tr className="border-b border-gray-400">
              <th className="text-left text-[7pt] font-semibold text-gray-500 uppercase pb-1 pr-2">#</th>
              <th className="text-left text-[7pt] font-semibold text-gray-500 uppercase pb-1 pr-2">Full Name</th>
              <th className="text-left text-[7pt] font-semibold text-gray-500 uppercase pb-1 pr-2">DOB</th>
              <th className="text-left text-[7pt] font-semibold text-gray-500 uppercase pb-1 pr-2">M/F</th>
              <th className="text-left text-[7pt] font-semibold text-gray-500 uppercase pb-1 pr-2">Relationship</th>
              <th className="text-left text-[7pt] font-semibold text-gray-500 uppercase pb-1">Special Needs?</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4, 5].map((n) => (
              <tr key={n} className="border-b border-gray-300">
                <td className="py-1.5 pr-2 text-gray-400">{n}.</td>
                <td className="py-1.5 pr-2"><BlankLine /></td>
                <td className="py-1.5 pr-2"><BlankLine width="5rem" /></td>
                <td className="py-1.5 pr-2"><BlankLine width="2rem" /></td>
                <td className="py-1.5 pr-2"><BlankLine width="5rem" /></td>
                <td className="py-1.5">
                  <div className="flex gap-2">
                    <CheckOption label="Y" />
                    <CheckOption label="N" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[7pt] text-gray-400 italic mt-1">
          Relationship: B = Biological, A = Adopted, S = Stepchild. Special Needs: indicate Y if child has special needs requiring a special needs trust.
        </p>

        {/* ============================================================= */}
        {/* SECTION 4: FIDUCIARIES                                         */}
        {/* ============================================================= */}
        <SectionHeader title="Section 4 — Your Fiduciaries" />
        <p className="text-[8pt] text-gray-500 italic mb-1">
          Name the people you trust to carry out your wishes. Provide primary and alternate for each role.
        </p>

        <div className="space-y-0">
          <FiduciaryBlock role="Executor" />
          <FiduciaryBlock role="Trustee" />
          <FiduciaryBlock role="POA Agent" />
          <FiduciaryBlock role="Healthcare Rep" />
          <FiduciaryBlock role="Guardian" />
        </div>

        {/* Distribution section moved to last page below */}

        {/* ============================================================= */}
        {/* SECTION 6: HEALTHCARE DIRECTIVES                               */}
        {/* ============================================================= */}
        <SectionHeader title="Section 5 — Healthcare Preferences" forcePageBreak />

        <div className="grid grid-cols-2 gap-x-6 gap-y-3" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
          <div>
            <SubHeader title="Life-Sustaining Treatment" />
            <div className="space-y-0.5">
              <CheckOption label="Provide all possible measures" />
              <CheckOption label="Withhold if terminally ill or permanently unconscious" />
              <CheckOption label="Trial period, then withdraw if no improvement" />
              <CheckOption label="My healthcare representative decides" />
            </div>
          </div>
          <div>
            <SubHeader title="Artificial Nutrition & Hydration" />
            <div className="space-y-0.5">
              <CheckOption label="Continue in all circumstances" />
              <CheckOption label="Withhold if terminally ill or permanently unconscious" />
              <CheckOption label="My healthcare representative decides" />
            </div>
          </div>
          <div>
            <SubHeader title="Pain Management" />
            <div className="space-y-0.5">
              <CheckOption label="Maximum relief, even if it may hasten death" />
              <CheckOption label="Relief that does not risk hastening death" />
              <CheckOption label="My healthcare representative decides" />
            </div>
          </div>
          <div>
            <SubHeader title="Organ Donation" />
            <div className="space-y-0.5">
              <CheckOption label="Yes — all organs and tissues" />
              <CheckOption label="Yes — specific organs only" />
              <CheckOption label="No" />
              <CheckOption label="Already registered" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 mt-3" style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
          <div>
            <SubHeader title="Burial / Funeral Preference" />
            <div className="flex gap-3">
              <CheckOption label="Burial" />
              <CheckOption label="Cremation" />
              <CheckOption label="No preference" />
              <CheckOption label="Other" />
            </div>
          </div>
          <div>
            <SubHeader title="Pregnancy Provision (if applicable)" />
            <div className="space-y-0.5">
              <CheckOption label="Follow directive even if pregnant" />
              <CheckOption label="Do not follow if pregnant" />
              <CheckOption label="My representative decides" />
            </div>
          </div>
        </div>

        <div style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}>
          <SubHeader title="Additional Healthcare Instructions" />
          <BlankLines count={3} />
        </div>

        {/* ============================================================= */}
        {/* SECTION 7: ASSETS & LIABILITIES (SUMMARY)                      */}
        {/* ============================================================= */}
        <SectionHeader title="Section 6 — Assets & Liabilities (Summary)" forcePageBreak />
        <p className="text-[8pt] text-gray-500 italic mb-2">
          Please list your major assets and liabilities below. Our office will gather detailed
          information during your consultation. Include approximate values where known.
        </p>

        <SubHeader title="Real Estate" />
        <p className="text-[7pt] text-gray-400 mb-0.5">
          List each property: address, estimated value, how titled (joint, individual, trust)
        </p>
        <BlankLines count={4} />

        <SubHeader title="Financial Accounts" />
        <p className="text-[7pt] text-gray-400 mb-0.5">
          Bank accounts, investments, retirement (401k, IRA), life insurance
        </p>
        <BlankLines count={4} />

        <SubHeader title="Business Interests" />
        <BlankLines count={2} />

        <SubHeader title="Significant Debts" />
        <p className="text-[7pt] text-gray-400 mb-0.5">
          Mortgages, loans, credit card debt, other obligations
        </p>
        <BlankLines count={3} />

        {/* ============================================================= */}
        {/* SECTION 8: ADDITIONAL INFORMATION                              */}
        {/* ============================================================= */}
        <SectionHeader title="Section 7 — Additional Information" />

        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <div>
            <p className="text-[8pt] font-medium text-gray-600 mb-0.5">
              Do you have existing estate planning documents?
            </p>
            <div className="flex gap-4">
              <CheckOption label="Yes" />
              <CheckOption label="No" />
            </div>
            <LabeledField label="If yes, describe (type and approximate date)" />
          </div>
          <div>
            <p className="text-[8pt] font-medium text-gray-600 mb-0.5">
              Any pending legal matters?
            </p>
            <div className="flex gap-4">
              <CheckOption label="Yes" />
              <CheckOption label="No" />
            </div>
            <LabeledField label="If yes, describe" />
          </div>
        </div>

        <SubHeader title="Additional Notes" />
        <p className="text-[7pt] text-gray-400 mb-0.5">
          Special circumstances, family dynamics, concerns about a specific beneficiary, pets, property in other states, etc.
        </p>
        <BlankLines count={4} />

        <div className="mt-2">
          <p className="text-[8pt] font-medium text-gray-600 mb-0.5">How did you hear about us?</p>
          <div className="flex gap-3 flex-wrap">
            <CheckOption label="Referral" />
            <CheckOption label="Google" />
            <CheckOption label="Social Media" />
            <CheckOption label="Attorney Referral" />
            <CheckOption label="Other" />
          </div>
        </div>


        {/* ============================================================= */}
        {/* LAST PAGE: DISTRIBUTION WISHES (attorney consultation)         */}
        {/* ============================================================= */}
        <SectionHeader
          title="Distribution Wishes (To be completed with your attorney)"
          forcePageBreak
        />
        <p className="text-[8pt] text-gray-500 mb-3">
          This section is intended to be completed during your consultation. Your attorney will
          discuss your options and document your wishes below.
        </p>

        {/* Lined notes area — fills remaining page */}
        <div className="space-y-0">
          {Array.from({ length: 32 }).map((_, i) => (
            <div
              key={i}
              className="border-b border-gray-300"
              style={{ height: '1.4rem' }}
            />
          ))}
        </div>

        {/* Print footer — static (not fixed) to avoid overlapping content */}
        <div className="mt-8 text-center text-[7pt] text-gray-400 py-1 print:break-inside-avoid">
          Estate Planning Questionnaire — Elias Counsel, LLC — (609) 655-3200
        </div>
      </div>

      {/* ── Print CSS ──────────────────────────────────────────────────── */}
      <style>{`
        @media print {
          @page {
            size: letter portrait;
            margin: 0.75in 0.75in 0.75in 0.75in;
          }
          body, * {
            font-family: Arial, Helvetica, sans-serif !important;
          }
          body {
            font-size: 9pt;
            color: #000;
            background: #fff;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .print\\:hidden { display: none !important; }
          .hidden.print\\:block { display: block !important; }
          h1, h2, h3, h4 { page-break-after: avoid; }
          .print\\:break-inside-avoid { break-inside: avoid; }
          .print-page-break { page-break-before: always; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .border-gray-500 { border-color: #444 !important; }
          .border-b.border-gray-400 { border-bottom: 0.75pt solid #444 !important; }
          .border-b.border-gray-300 { border-bottom: 0.5pt solid #888 !important; }
          a { color: #000; text-decoration: none; }
        }
      `}</style>
    </div>
  );
}
