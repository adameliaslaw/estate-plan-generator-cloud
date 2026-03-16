/**
 * PrintableQuestionnaire.tsx
 *
 * Condensed ~5-page estate planning intake form designed for paper.
 *
 * CRITICAL DESIGN: Each "page" is an explicit fixed-height container that
 * maps 1:1 to a physical printed page. This prevents ANY page bleeding —
 * the browser never guesses where to break because we tell it exactly.
 *
 * Page geometry (letter portrait):
 *   Paper:     8.5in × 11in
 *   Margins:   0.6in top/bottom, 0.65in left/right
 *   Printable: 7.2in × 9.8in
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

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-2 border-b-2 border-[#1a365d] pb-0.5 pt-1">
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
// Page wrapper — each instance = exactly one printed page
// ---------------------------------------------------------------------------

function PrintPage({ children, isLast = false }: { children: React.ReactNode; isLast?: boolean }) {
  return (
    <div
      className="print-page"
      style={{
        boxSizing: 'border-box',
        marginBottom: isLast ? 0 : '2rem',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fiduciary block (stacked: name+relationship, then address+phone)
// ---------------------------------------------------------------------------

function FiduciaryBlock({ role, subtitle }: { role: string; subtitle?: string }) {
  return (
    <div className="border-b border-gray-300 pb-3 mb-3">
      <p className="text-[9pt] font-bold text-gray-700 uppercase tracking-wide mb-1">
        {role}
        {subtitle && <span className="ml-1 font-normal text-gray-500 normal-case">{subtitle}</span>}
      </p>
      <div className="grid grid-cols-2 gap-x-6">
        {/* Primary */}
        <div>
          <p className="text-[7pt] text-gray-400 uppercase font-semibold mb-1">Primary</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <LabeledField label="Full Name" />
            <LabeledField label="Relationship" />
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-2">
            <LabeledField label="Address" />
            <LabeledField label="Phone" />
          </div>
        </div>
        {/* Alternate */}
        <div>
          <p className="text-[7pt] text-gray-400 uppercase font-semibold mb-1">Alternate</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <LabeledField label="Full Name" />
            <LabeledField label="Relationship" />
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-2">
            <LabeledField label="Address" />
            <LabeledField label="Phone" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page footer
// ---------------------------------------------------------------------------

function PageFooter({ pageNum, totalPages }: { pageNum: number; totalPages: number }) {
  return (
    <div className="mt-12 border-t border-gray-300 pt-2 text-center text-[7pt] text-gray-400">
      Estate Planning Questionnaire — Elias Counsel, LLC — (609) 655-3200 — Page {pageNum} of {totalPages}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface PrintableQuestionnaireProps {
  clientName?: string;
}

const TOTAL_PAGES = 5;

export default function PrintableQuestionnaire({
  clientName,
}: PrintableQuestionnaireProps) {
  return (
    <div className="printable-questionnaire-wrapper" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
      {/* ── Screen-only toolbar ─────────────────────────────────────────── */}
      <div className="print:hidden mb-6 flex items-center justify-between rounded-lg border border-[#1a365d]/15 bg-[#ebf4ff] px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-[#1a365d]">
            Printable Intake Form (Condensed)
          </p>
          <p className="text-xs text-[#1a365d]/60">
            {TOTAL_PAGES}-page version for in-person interviews and paper intake.
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

      {/* ── Printable pages ────────────────────────────────────────────── */}
      <div className="bg-white print:bg-white print:text-black" id="printable-questionnaire">

        {/* ================================================================
            PAGE 1: Header + Section 1 (About You) + Section 2 (Spouse)
            ================================================================ */}
        <PrintPage>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            {/* HEADER */}
            <header className="mb-2">
              <div className="flex items-start justify-between border-b-4 border-[#1a365d] pb-1.5">
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

              {/* Date / Client Name / Referral */}
              <div className="mt-2 grid grid-cols-[1fr_1.5fr_2fr] gap-3 rounded border border-gray-300 p-1.5">
                <div>
                  <p className="text-[7pt] font-semibold text-gray-500 uppercase">Date</p>
                  <BlankLine />
                </div>
                <div>
                  <p className="text-[7pt] font-semibold text-gray-500 uppercase">Client Name</p>
                  {clientName ? (
                    <p className="text-[10pt] font-medium text-gray-900 mt-0.5">{clientName}</p>
                  ) : (
                    <BlankLine />
                  )}
                </div>
                <div>
                  <p className="text-[7pt] font-semibold text-gray-500 uppercase">How did you hear about us?</p>
                  <div className="flex gap-2.5 flex-wrap mt-0.5">
                    <CheckOption label="Referral" />
                    <CheckOption label="Google" />
                    <CheckOption label="Social Media" />
                    <CheckOption label="Attorney" />
                    <CheckOption label="Other" />
                  </div>
                </div>
              </div>

              <p className="mt-1 text-[8pt] text-gray-500 italic">
                Please complete all applicable sections using black or blue ink.
                Leave blank any items that do not apply. Continue on a separate
                sheet if needed, noting the section number. CONFIDENTIAL.
              </p>
            </header>

            {/* SECTION 1: CLIENT INFORMATION */}
            <SectionHeader title="Section 1 — About You" />

            <div className="grid grid-cols-4 gap-x-3 gap-y-1">
              <LabeledField label="First Name" />
              <LabeledField label="Middle Name" />
              <LabeledField label="Last Name" />
              <LabeledField label="Suffix" />
            </div>
            <div className="grid grid-cols-4 gap-x-3 gap-y-1 mt-1">
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
            <div className="grid grid-cols-1 gap-y-1 mt-1">
              <LabeledField label="Street Address" />
            </div>
            <div className="grid grid-cols-4 gap-x-3 gap-y-1 mt-1">
              <LabeledField label="City" />
              <LabeledField label="State" />
              <LabeledField label="ZIP Code" />
              <LabeledField label="County" />
            </div>
            <div className="grid grid-cols-3 gap-x-3 gap-y-1 mt-1">
              <LabeledField label="Email" />
              <LabeledField label="Phone" />
              <LabeledField label="Alternate Phone" />
            </div>
            <div className="grid grid-cols-3 gap-x-3 gap-y-1 mt-1">
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
              <div className="space-y-1">
                <LabeledField label="Occupation" />
                <LabeledField label="Employer" />
              </div>
            </div>

            {/* SECTION 2: SPOUSE */}
            <SectionHeader title="Section 2 — Spouse / Domestic Partner" />
            <p className="text-[8pt] text-gray-500 italic mb-1">
              Complete only if married or in a domestic partnership.
            </p>

            <div className="grid grid-cols-4 gap-x-3 gap-y-1">
              <LabeledField label="First Name" />
              <LabeledField label="Middle Name" />
              <LabeledField label="Last Name" />
              <LabeledField label="Suffix" />
            </div>
            <div className="grid grid-cols-4 gap-x-3 gap-y-1 mt-1">
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
            <div className="mt-1">
              <div className="flex items-center gap-4 mb-0.5">
                <CheckOption label="Same address as client above" />
                <span className="text-[8pt] text-gray-400 italic">If not, complete below:</span>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-y-1 mt-0.5">
              <LabeledField label="Street Address" />
            </div>
            <div className="grid grid-cols-4 gap-x-3 gap-y-1 mt-1">
              <LabeledField label="City" />
              <LabeledField label="State" />
              <LabeledField label="ZIP Code" />
              <LabeledField label="County" />
            </div>
            <div className="grid grid-cols-3 gap-x-3 gap-y-1 mt-1">
              <LabeledField label="Email" />
              <LabeledField label="Phone" />
              <LabeledField label="Alternate Phone" />
            </div>
            <div className="grid grid-cols-3 gap-x-3 gap-y-1 mt-1">
              <div>{/* Empty column to match alignment with Marital Status in Section 1 */}</div>
              <div>
                <p className="text-[8pt] font-medium text-gray-600 mb-0.5">Citizenship</p>
                <div className="space-y-0.5">
                  <CheckOption label="U.S. Citizen" />
                  <CheckOption label="Permanent Resident" />
                  <CheckOption label="Non-Resident" />
                </div>
              </div>
              <div className="space-y-1">
                <LabeledField label="Occupation" />
                <LabeledField label="Employer" />
              </div>
            </div>

            <PageFooter pageNum={1} totalPages={TOTAL_PAGES} />
          </div>
        </PrintPage>

        {/* ================================================================
            PAGE 2: Section 3 (Children)
            ================================================================ */}
        <PrintPage>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            {/* SECTION 3: CHILDREN */}
            <SectionHeader title="Section 3 — Children & Dependents" />

            <table className="w-full text-[9pt] border-collapse mt-2">
              <thead>
                <tr className="border-b-2 border-gray-400">
                  <th className="text-left text-[7pt] font-semibold text-gray-500 uppercase pb-1 pr-2 w-4">#</th>
                  <th className="text-left text-[7pt] font-semibold text-gray-500 uppercase pb-1 pr-2">Full Name</th>
                  <th className="text-left text-[7pt] font-semibold text-gray-500 uppercase pb-1 pr-2 w-20">DOB</th>
                  <th className="text-left text-[7pt] font-semibold text-gray-500 uppercase pb-1 pr-2 w-10">M/F</th>
                  <th className="text-left text-[7pt] font-semibold text-gray-500 uppercase pb-1 pr-2 w-28">Relationship</th>
                  <th className="text-left text-[7pt] font-semibold text-gray-500 uppercase pb-1 w-20">Special Needs?</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4].flatMap((n) => [
                  <tr key={`child-${n}`}>
                    <td className="py-2.5 pr-2 text-gray-500 font-medium align-middle">{n}.</td>
                    <td className="py-2.5 pr-2"><BlankLine /></td>
                    <td className="py-2.5 pr-2"><BlankLine width="100%" /></td>
                    <td className="py-2.5 pr-2"><BlankLine width="100%" /></td>
                    <td className="py-2.5 pr-2"><BlankLine width="100%" /></td>
                    <td className="py-2.5">
                      <div className="flex gap-2">
                        <CheckOption label="Y" />
                        <CheckOption label="N" />
                      </div>
                    </td>
                  </tr>,
                  <tr key={`spouse-${n}`}>
                    <td></td>
                    <td className="py-1.5 pr-2">
                      <div className="flex items-end">
                        <span className="text-[7pt] text-gray-500 italic w-[64px] text-right pr-2 pb-[1px]">Spouse:</span>
                        <div className="flex-1"><BlankLine /></div>
                      </div>
                    </td>
                    <td className="py-1.5 pr-2"><BlankLine width="100%" /></td>
                    <td className="py-1.5 pr-2"><BlankLine width="100%" /></td>
                    <td className="py-1.5 pr-2"></td>
                    <td className="py-1.5"></td>
                  </tr>,
                  ...[1, 2, 3].map((g) => (
                    <tr key={`gc-${n}-${g}`} className={g === 3 && n !== 4 ? "border-b border-gray-300" : ""}>
                      <td></td>
                      <td className="py-1.5 pr-2">
                        <div className="flex items-end">
                          <span className="text-[7pt] text-gray-500 italic w-[64px] text-right pr-2 pb-[1px] whitespace-nowrap">Grandchild {g}:</span>
                          <div className="flex-1"><BlankLine /></div>
                        </div>
                      </td>
                      <td className="py-1.5 pr-2"><BlankLine width="100%" /></td>
                      <td className="py-1.5 pr-2"><BlankLine width="100%" /></td>
                      <td className="py-1.5 pr-2"></td>
                      <td className="py-1.5">
                        <div className="flex gap-2">
                          <CheckOption label="Y" />
                          <CheckOption label="N" />
                        </div>
                      </td>
                    </tr>
                  ))
                ])}
              </tbody>
            </table>
            <p className="text-[7pt] text-gray-400 italic mt-3 mb-4">
              Relationship: B = Biological, A = Adopted, S = Stepchild. Special Needs: indicate Y if child/grandchild has special needs requiring a trust.
            </p>

            {/* SECTION 3.5: PETS */}
            <div className="mt-2">
              <SectionHeader title="Section 3.5 — Pets" />
              <table className="w-full text-[9pt] border-collapse mt-2">
                <thead>
                  <tr className="border-b-2 border-gray-400">
                    <th className="text-left text-[7pt] font-semibold text-gray-500 uppercase pb-1 pr-2 w-4">#</th>
                    <th className="text-left text-[7pt] font-semibold text-gray-500 uppercase pb-1 pr-2 w-48">Pet Name</th>
                    <th className="text-left text-[7pt] font-semibold text-gray-500 uppercase pb-1 pr-2 w-32">Type / Breed</th>
                    <th className="text-left text-[7pt] font-semibold text-gray-500 uppercase pb-1">Primary Caretaker</th>
                  </tr>
                </thead>
                <tbody>
                  {[1, 2].map((n) => (
                    <tr key={`pet-${n}`} className={n === 1 ? "border-b border-gray-200" : ""}>
                      <td className="py-2.5 pr-2 text-gray-500 font-medium align-middle">{n}.</td>
                      <td className="py-2.5 pr-2"><BlankLine /></td>
                      <td className="py-2.5 pr-2"><BlankLine width="100%" /></td>
                      <td className="py-2.5"><BlankLine width="100%" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <PageFooter pageNum={2} totalPages={TOTAL_PAGES} />
          </div>
        </PrintPage>

        {/* ================================================================
            PAGE 3: Section 4 (Your Fiduciaries)
            ================================================================ */}
        <PrintPage>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <SectionHeader title="Section 4 — Your Fiduciaries" />
            <p className="text-[8pt] text-gray-500 italic mb-5">
              Name the people you trust to carry out your wishes. Provide primary and alternate for each role.
            </p>

            <div className="space-y-0">
              <FiduciaryBlock role="Trustee" />
              <FiduciaryBlock role="Executor" />
              <FiduciaryBlock role="Power of Attorney (Agent)" />
              <FiduciaryBlock role="Healthcare Representative" />
              <FiduciaryBlock role="Guardian" subtitle="(If Children or grandchildren under 18)" />
            </div>

            <PageFooter pageNum={3} totalPages={TOTAL_PAGES} />
          </div>
        </PrintPage>

        {/* ================================================================
            PAGE 4: Section 5 (Assets) & Section 6 (Healthcare)
            ================================================================ */}
        <PrintPage>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            
            <SectionHeader title="Section 5 — Assets & Liabilities (Summary)" />
            <p className="text-[8pt] text-gray-500 italic mb-2">
              Please list your major assets and liabilities below. Our office will gather detailed
              information during your consultation. Include approximate values where known.
            </p>

            <SubHeader title="Real Estate" />
            <p className="text-[7pt] text-gray-400 mb-0.5">
              List each property: address, estimated value, how titled (joint, individual, trust)
            </p>
            <BlankLines count={2} />

            <SubHeader title="Financial Accounts" />
            <p className="text-[7pt] text-gray-400 mb-0.5">
              Bank accounts, investments, retirement (401k, IRA), life insurance
            </p>
            <BlankLines count={2} />

            <SubHeader title="Business Interests" />
            <BlankLines count={2} />

            <SubHeader title="Significant Debts" />
            <p className="text-[7pt] text-gray-400 mb-0.5">
              Mortgages, loans, credit card debt, other obligations
            </p>
            <BlankLines count={2} />

            <div className="mt-4">
              <SectionHeader title="Section 6 — Healthcare Preferences" />

              <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-1">
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

              <div className="grid grid-cols-2 gap-x-6 mt-2">
                <div>
                  <SubHeader title="Burial / Funeral Preference" />
                  <div className="flex gap-3">
                    <CheckOption label="Burial" />
                    <CheckOption label="Cremation" />
                    <CheckOption label="No preference" />
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

              <div className="mt-2">
                <SubHeader title="Additional Healthcare Instructions" />
                <BlankLines count={2} />
              </div>
            </div>

            <PageFooter pageNum={4} totalPages={TOTAL_PAGES} />
          </div>
        </PrintPage>

        {/* ================================================================
            PAGE 5: Section 7 (Additional Info) + Distribution Wishes
            ================================================================ */}
        <PrintPage isLast>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            
            <SectionHeader title="Section 7 — Additional Information" />

            <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2">
              <div>
                <p className="text-[8pt] font-medium text-gray-600 mb-0.5">
                  Do you have existing estate planning documents?
                </p>
                <div className="flex gap-4">
                  <CheckOption label="Yes" />
                  <CheckOption label="No" />
                </div>
                <div className="mt-2">
                  <LabeledField label="If yes, describe (type and approximate date)" />
                </div>
              </div>
              <div>
                <p className="text-[8pt] font-medium text-gray-600 mb-0.5">
                  Any pending legal matters?
                </p>
                <div className="flex gap-4">
                  <CheckOption label="Yes" />
                  <CheckOption label="No" />
                </div>
                <div className="mt-2">
                  <LabeledField label="If yes, describe" />
                </div>
              </div>
            </div>

            <div className="mt-6 flex-1 flex flex-col">
              <SectionHeader title="Distribution Wishes (To be completed with your attorney)" />
              <p className="text-[8pt] text-gray-500 mb-3">
                This section is intended to be completed during your consultation. Your attorney will
                discuss your options and document your wishes below.
              </p>

              {/* Lined notes area — fills remaining page */}
              <div className="space-y-0 flex-1">
                {Array.from({ length: 25 }).map((_, i) => (
                  <div
                    key={i}
                    className="border-b border-gray-300"
                    style={{ height: '1.4rem' }}
                  />
                ))}
              </div>
            </div>

            <PageFooter pageNum={5} totalPages={TOTAL_PAGES} />
          </div>
        </PrintPage>

      </div>

      {/* ── Print CSS ──────────────────────────────────────────────────── */}
      <style>{`
        @media print {
          /* Zero @page margin — WE control all spacing via .print-page padding */
          @page {
            size: letter portrait;
            margin: 0;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            width: 8.5in !important;
            height: auto !important;
            overflow: visible !important;
          }
          body {
            font-size: 9pt;
            color: #000;
            background: #fff;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          body, * {
            font-family: Arial, Helvetica, sans-serif !important;
          }

          /* Hide screen-only elements */
          .print\\:hidden { display: none !important; }
          .print\\:!hidden { display: none !important; }
          .hidden.print\\:block { display: block !important; }

          /* Hide screen-only toolbar — must come BEFORE the container reset */
          .printable-questionnaire-wrapper > .print\\:hidden {
            display: none !important;
            height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
          }

          /* Reset ALL containers to be transparent */
          #root,
          .printable-questionnaire-wrapper,
          #printable-questionnaire {
            display: block !important;
            width: auto !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            height: auto !important;
            background: none !important;
            border: none !important;
            box-shadow: none !important;
          }

          /*
           * Each .print-page = exactly ONE physical printed page.
           * We make each one 8.5in × 11in with internal padding = page margins.
           * The content area = 8.5 - 2*0.65 = 7.2in wide, 11 - 2*0.6 = 9.8in tall.
           */
          .print-page {
            width: 8.5in;
            height: 11in;
            padding: 0.6in 0.65in;
            margin: 0 !important;
            box-sizing: border-box;
            overflow: hidden;
            display: flex !important;
            flex-direction: column !important;
            page-break-after: always;
            page-break-inside: avoid;
            break-after: page;
            break-inside: avoid;
            background: #fff !important;
            border: none !important;
            border-radius: 0 !important;
            box-shadow: none !important;
          }
          .print-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }

          /* Prevent elements from breaking across pages */
          h1, h2, h3, h4 { page-break-after: avoid; break-after: avoid; }
          tr { page-break-inside: avoid; break-inside: avoid; }

          /* Ink-friendly overrides */
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .border-gray-500 { border-color: #444 !important; }
          .border-b.border-gray-400 { border-bottom: 0.75pt solid #444 !important; }
          .border-b.border-gray-300 { border-bottom: 0.5pt solid #888 !important; }
          a { color: #000; text-decoration: none; }
        }

        /* ── Screen preview ─────────────────────────────────────────── */
        @media screen {
          .printable-questionnaire-wrapper {
            max-width: 8.5in;
            margin: 0 auto;
            padding: 1rem 0;
            background: #f1f5f9;
            min-height: 100vh;
          }
          .print-page {
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            padding: 0.65in;
            box-shadow: 0 1px 3px rgba(0,0,0,0.08);
            background: #fff;
            height: 11in !important;
            max-height: 11in !important;
            box-sizing: border-box;
            overflow: hidden !important;
          }
        }
      `}</style>
    </div>
  );
}
