/**
 * QuestionnaireComplete
 *
 * Final review page shown after the client selects a package. Displays a
 * summary of their answers and has a "Submit for Document Generation" button
 * that marks the questionnaire as completed.
 *
 * Flow: PackageSelector → QuestionnaireComplete → (thank-you / dashboard)
 */

import React, { useState } from 'react';
import {
  CheckCircle2,
  User,
  Users,
  Building2,
  Shield,
  FileText,
  ChevronDown,
  ChevronUp,
  Send,
  Eye,
  Star,
} from 'lucide-react';

import { useQuestionnaire } from '@/contexts/QuestionnaireContext';
import type { PackageType } from '@/types';
import { SECTION_META } from '@/types/questionnaire';
import { cn } from '@/lib/utils';

// ============================================================================
// Props
// ============================================================================

interface QuestionnaireCompleteProps {
  selectedPackage: PackageType;
  selectedTrustType?: string;
  onSubmit: () => Promise<void> | void;
}

// ============================================================================
// Helpers
// ============================================================================

const PACKAGE_LABELS: Record<PackageType, { name: string; tagline: string; color: string }> = {
  foundation: {
    name: 'The Foundation Plan',
    tagline: 'Will-Based Estate Plan',
    color: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  guardian: {
    name: 'The Guardian Plan',
    tagline: 'Revocable Living Trust Plan',
    color: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  },
  fortress: {
    name: 'The Fortress Plan',
    tagline: 'Irrevocable Trust / Asset Protection',
    color: 'bg-purple-100 text-purple-800 border-purple-200',
  },
};

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `$${Math.round(amount / 1_000)}K`;
  }
  return `$${amount.toLocaleString()}`;
}

function estimateTotal(data: ReturnType<typeof useQuestionnaire>['data']): number {
  let total = 0;
  for (const p of data.assets?.realEstate ?? []) total += p.estimatedValue ?? 0;
  for (const a of data.assets?.bankAccounts ?? []) total += (a as { estimatedBalance?: number }).estimatedBalance ?? 0;
  for (const a of data.assets?.investmentAccounts ?? []) total += (a as { estimatedValue?: number }).estimatedValue ?? 0;
  for (const r of data.assets?.retirementAccounts ?? []) total += (r as { estimatedValue?: number }).estimatedValue ?? 0;
  for (const l of data.assets?.lifeInsurance ?? []) total += l.faceValue ?? 0;
  for (const b of data.assets?.businessInterests ?? []) total += (b as { estimatedValue?: number }).estimatedValue ?? 0;
  return data.assets?.estimatedTotalEstate ?? total;
}

// ============================================================================
// Summary card
// ============================================================================

function SummaryCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#ebf4ff] text-[#1a365d]">
          {icon}
        </div>
        <h3 className="text-sm font-semibold text-[#1a365d]">{title}</h3>
      </div>
      {children}
    </div>
  );
}

// ============================================================================
// Review all answers — accordion
// ============================================================================

function ReviewAccordion() {
  const { data, visibleSteps } = useQuestionnaire();
  const [openSection, setOpenSection] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
      <div className="border-b border-gray-100 px-5 py-4">
        <h3 className="text-sm font-semibold text-[#1a365d]">Review Your Answers</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Click a section to expand and review your answers.
        </p>
      </div>

      {SECTION_META.map((section) => {
        const sectionSteps = visibleSteps.filter((s) => s.section === section.id);
        if (sectionSteps.length === 0) return null;
        const isOpen = openSection === section.id;

        return (
          <div key={section.id} className="border-b border-gray-100 last:border-0">
            <button
              onClick={() => setOpenSection(isOpen ? null : section.id)}
              className="flex w-full items-center justify-between px-5 py-3.5 text-left hover:bg-gray-50 transition-colors focus:outline-none focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-[#1a365d]"
            >
              <span className="text-sm font-medium text-gray-700">{section.title}</span>
              {isOpen ? (
                <ChevronUp className="h-4 w-4 text-gray-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-gray-400" />
              )}
            </button>

            {isOpen && (
              <div className="bg-gray-50 border-t border-gray-100 px-5 py-4 space-y-4">
                {sectionSteps.map((step) => (
                  <div key={step.id}>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
                      {step.title}
                    </p>
                    <div className="space-y-1">
                      {step.fields
                        .filter((f) => f.type !== 'heading' && f.type !== 'info')
                        .map((field) => {
                          const rawVal = field.name
                            .split('.')
                            .reduce<unknown>(
                              (obj, key) =>
                                obj != null && typeof obj === 'object'
                                  ? (obj as Record<string, unknown>)[key]
                                  : undefined,
                              data as unknown,
                            );

                          if (rawVal == null || rawVal === '' || rawVal === false) return null;
                          if (Array.isArray(rawVal) && rawVal.length === 0) return null;

                          let displayVal: string;
                          if (Array.isArray(rawVal)) {
                            displayVal = `${rawVal.length} item${rawVal.length !== 1 ? 's' : ''} entered`;
                          } else if (typeof rawVal === 'boolean') {
                            displayVal = rawVal ? 'Yes' : 'No';
                          } else {
                            displayVal = String(rawVal);
                          }

                          return (
                            <div key={field.name} className="flex items-start gap-2 text-sm">
                              <span className="min-w-[140px] shrink-0 text-gray-500 text-xs">
                                {field.label}
                              </span>
                              <span className="text-gray-800 font-medium text-xs">{displayVal}</span>
                            </div>
                          );
                        })
                        .filter(Boolean)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Main component
// ============================================================================

export function QuestionnaireComplete({
  selectedPackage,
  selectedTrustType,
  onSubmit,
}: QuestionnaireCompleteProps) {
  const { data } = useQuestionnaire();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showReview, setShowReview] = useState(false);

  const packageInfo = PACKAGE_LABELS[selectedPackage];
  const totalAssets = estimateTotal(data);

  const firstName = data.personalInfo?.firstName ?? '';
  const lastName = data.personalInfo?.lastName ?? '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || 'Not provided';
  const maritalStatus = data.personalInfo?.maritalStatus ?? '';
  const hasSpouse =
    maritalStatus === 'Married' || maritalStatus === 'Domestic Partnership';
  const spouseName =
    [data.spouseInfo?.firstName, data.spouseInfo?.lastName].filter(Boolean).join(' ') || '';
  const childCount = data.children?.length ?? 0;
  const minorCount = data.children?.filter((c) => {
    if (!c.dob) return false;
    const birth = new Date(c.dob);
    const now = new Date();
    const age =
      now.getFullYear() -
      birth.getFullYear() -
      (now < new Date(now.getFullYear(), birth.getMonth(), birth.getDate()) ? 1 : 0);
    return age < 18;
  }).length ?? 0;

  const executorName =
    (data.fiduciaries as { executor?: { primary?: { name?: string } } })?.executor?.primary
      ?.name ?? '';
  const poaName =
    (
      data.fiduciaries as {
        powerOfAttorney?: { agent?: { name?: string } };
      }
    )?.powerOfAttorney?.agent?.name ?? '';
  const hcpName =
    (
      data.fiduciaries as {
        healthcareProxy?: { agent?: { name?: string } };
      }
    )?.healthcareProxy?.agent?.name ?? '';

  async function handleSubmit() {
    setIsSubmitting(true);
    try {
      await onSubmit();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-8 pb-16">
      {/* Success header */}
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <CheckCircle2 className="h-9 w-9 text-green-600" />
        </div>
        <h1 className="text-2xl font-bold text-[#1a365d] sm:text-3xl">
          Questionnaire Complete!
        </h1>
        <p className="mt-2 text-base text-gray-500 max-w-lg mx-auto">
          Thank you{firstName ? `, ${firstName}` : ''}. Please review your information below,
          then submit to your attorney for document generation.
        </p>
      </div>

      {/* Summary cards grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Personal info */}
        <SummaryCard icon={<User className="h-4 w-4" />} title="Personal Information">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Name</dt>
              <dd className="font-medium text-gray-800 text-right">{fullName}</dd>
            </div>
            {maritalStatus && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Marital Status</dt>
                <dd className="font-medium text-gray-800">{maritalStatus}</dd>
              </div>
            )}
            {hasSpouse && spouseName && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Spouse / Partner</dt>
                <dd className="font-medium text-gray-800 text-right">{spouseName}</dd>
              </div>
            )}
          </dl>
        </SummaryCard>

        {/* Family */}
        <SummaryCard icon={<Users className="h-4 w-4" />} title="Family">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Children</dt>
              <dd className="font-medium text-gray-800">
                {childCount === 0 ? 'None' : childCount}
              </dd>
            </div>
            {minorCount > 0 && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Minor children</dt>
                <dd className="font-medium text-gray-800">{minorCount}</dd>
              </div>
            )}
            {data.hasOtherDependents && (data.otherDependents?.length ?? 0) > 0 && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Other dependents</dt>
                <dd className="font-medium text-gray-800">{data.otherDependents?.length}</dd>
              </div>
            )}
          </dl>
        </SummaryCard>

        {/* Assets */}
        <SummaryCard icon={<Building2 className="h-4 w-4" />} title="Estate Overview">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Estimated estate value</dt>
              <dd className="font-medium text-gray-800">
                {totalAssets > 0 ? formatCurrency(totalAssets) : 'Not entered'}
              </dd>
            </div>
            {(data.assets?.realEstate?.length ?? 0) > 0 && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Real estate properties</dt>
                <dd className="font-medium text-gray-800">{data.assets?.realEstate?.length}</dd>
              </div>
            )}
            {(data.assets?.retirementAccounts?.length ?? 0) > 0 && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Retirement accounts</dt>
                <dd className="font-medium text-gray-800">
                  {data.assets?.retirementAccounts?.length}
                </dd>
              </div>
            )}
            {(data.assets?.lifeInsurance?.length ?? 0) > 0 && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Life insurance policies</dt>
                <dd className="font-medium text-gray-800">
                  {data.assets?.lifeInsurance?.length}
                </dd>
              </div>
            )}
          </dl>
        </SummaryCard>

        {/* Key fiduciaries */}
        <SummaryCard icon={<Shield className="h-4 w-4" />} title="Key Fiduciaries">
          <dl className="space-y-1 text-sm">
            {executorName && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Executor</dt>
                <dd className="font-medium text-gray-800 text-right">{executorName}</dd>
              </div>
            )}
            {poaName && (
              <div className="flex justify-between">
                <dt className="text-gray-500">POA Agent</dt>
                <dd className="font-medium text-gray-800 text-right">{poaName}</dd>
              </div>
            )}
            {hcpName && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Healthcare Proxy</dt>
                <dd className="font-medium text-gray-800 text-right">{hcpName}</dd>
              </div>
            )}
            {!executorName && !poaName && !hcpName && (
              <p className="text-gray-400 text-xs">Not yet named</p>
            )}
          </dl>
        </SummaryCard>
      </div>

      {/* Selected package */}
      <div className="rounded-xl border border-[#1a365d]/20 bg-[#ebf4ff] px-5 py-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1a365d]">
            <Star className="h-5 w-5 text-white fill-current" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#1a365d]/60 mb-0.5">
              Selected Package
            </p>
            <p className="text-lg font-bold text-[#1a365d]">{packageInfo.name}</p>
            <p className="text-sm text-[#1a365d]/70">{packageInfo.tagline}</p>
            {selectedTrustType && (
              <p className="text-sm text-[#1a365d]/70 mt-1">
                Trust type: <span className="font-medium">{selectedTrustType}</span>
              </p>
            )}
          </div>
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold',
              packageInfo.color,
            )}
          >
            <FileText className="mr-1 h-3 w-3" />
            {selectedPackage.charAt(0).toUpperCase() + selectedPackage.slice(1)}
          </span>
        </div>
      </div>

      {/* Review all answers toggle */}
      <button
        onClick={() => setShowReview((v) => !v)}
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-3.5 text-sm font-medium text-[#1a365d]',
          'transition-all hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a365d]',
          'shadow-sm',
        )}
      >
        <Eye className="h-4 w-4" />
        {showReview ? 'Hide Answers' : 'Review All Answers'}
        {showReview ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>

      {showReview && <ReviewAccordion />}

      {/* Attorney notice */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
        <p className="text-sm text-amber-800">
          <span className="font-semibold">Note:</span> Your attorney will review your information
          and generate your estate planning documents. You will be contacted to schedule a signing
          appointment once your documents are ready.
        </p>
      </div>

      {/* Submit button */}
      <div className="flex flex-col items-center gap-3">
        <button
          onClick={() => void handleSubmit()}
          disabled={isSubmitting}
          className={cn(
            'flex items-center gap-2 rounded-xl bg-[#1a365d] px-8 py-3.5 text-base font-semibold text-white shadow-sm',
            'transition-all hover:bg-[#2b4a7a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a365d] focus-visible:ring-offset-2',
            'disabled:opacity-60 disabled:pointer-events-none',
          )}
        >
          {isSubmitting ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Submitting…
            </>
          ) : (
            <>
              <Send className="h-5 w-5" />
              Submit for Document Generation
            </>
          )}
        </button>
        <p className="text-xs text-gray-400 text-center max-w-sm">
          By submitting, you confirm that the information provided is accurate to the best of your
          knowledge.
        </p>
      </div>
    </div>
  );
}
