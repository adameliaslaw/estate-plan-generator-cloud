/**
 * PackageSelector
 *
 * Shown after the questionnaire questions are complete — before the final
 * review/submit screen. Uses the recommendation engine to display three
 * package cards and let the client confirm (or change) their selection.
 *
 * Flow: QuestionnaireShell (all steps done) → PackageSelector → QuestionnaireComplete
 */

import { useMemo, useState } from 'react';
import {
  Star,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Check,
  Info,
  ArrowRight,
} from 'lucide-react';

import { useQuestionnaire } from '@/contexts/QuestionnaireContext';
import {
  calculateRecommendation,
} from '@/services/recommendation-engine';
import type { PackageOption } from '@/services/recommendation-engine';
import type { PackageType } from '@/types';
import { TRUST_TYPES } from '@/config/constants';
import { cn } from '@/lib/utils';

// ============================================================================
// Props
// ============================================================================

interface PackageSelectorProps {
  onContinue: (selectedPackage: PackageType, selectedTrustType?: string) => void;
}

// ============================================================================
// Package Card
// ============================================================================

interface PackageCardProps {
  pkg: PackageOption;
  isSelected: boolean;
  onClick: () => void;
}

function PackageCard({ pkg, isSelected, onClick }: PackageCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex flex-col rounded-2xl border-2 p-6 text-left transition-all duration-200',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a365d] focus-visible:ring-offset-2',
        'hover:shadow-lg hover:-translate-y-0.5',
        isSelected
          ? 'border-[#1a365d] bg-white shadow-lg scale-[1.01]'
          : 'border-gray-200 bg-white shadow-sm hover:border-gray-300',
        pkg.isRecommended && !isSelected && 'border-[#2b6cb0]/50',
      )}
      aria-pressed={isSelected}
    >
      {/* Recommended badge */}
      {pkg.isRecommended && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#1a365d] px-3 py-1 text-xs font-semibold text-white shadow-sm whitespace-nowrap">
            <Star className="h-3 w-3 fill-current" />
            Recommended for You
          </span>
        </div>
      )}

      {/* Selected checkmark */}
      {isSelected && (
        <div className="absolute top-4 right-4">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1a365d]">
            <Check className="h-3.5 w-3.5 text-white" />
          </div>
        </div>
      )}

      {/* Header */}
      <div className={cn('mb-4', pkg.isRecommended && 'mt-2')}>
        <p className="text-xs font-semibold uppercase tracking-wider text-[#2b6cb0] mb-1">
          {pkg.tagline}
        </p>
        <h3 className="text-lg font-bold text-[#1a365d]">{pkg.name}</h3>
      </div>

      {/* Description */}
      <p className="text-sm text-gray-600 leading-relaxed mb-5">{pkg.description}</p>

      {/* Included documents */}
      <div className="mt-auto">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
          Included Documents
        </p>
        <ul className="space-y-1.5">
          {pkg.includedDocuments.map((doc, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#2b6cb0]" />
              <span>{doc}</span>
            </li>
          ))}
        </ul>
      </div>
    </button>
  );
}

// ============================================================================
// All packages include section
// ============================================================================

function AllPackagesInclude() {
  return (
    <div className="rounded-xl border border-[#2b6cb0]/20 bg-[#ebf4ff] px-5 py-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-[#1a365d]/60 mb-2">
        All packages include
      </p>
      <ul className="flex flex-wrap gap-x-6 gap-y-1.5">
        {[
          'Estate Plan Summary',
          'Action Steps Checklist',
          'Attorney review & consultation',
          'Signing ceremony coordination',
          'Secure document storage',
        ].map((item) => (
          <li key={item} className="flex items-center gap-1.5 text-sm text-[#1a365d]">
            <Check className="h-3.5 w-3.5 text-[#2b6cb0]" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================================
// Why this recommendation — expandable
// ============================================================================

interface WhyPanelProps {
  reasons: string[];
}

function WhyPanel({ reasons }: WhyPanelProps) {
  const [open, setOpen] = useState(false);

  if (reasons.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-5 py-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a365d]"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-[#1a365d]">
          <Info className="h-4 w-4" />
          Why this recommendation?
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-400" />
        )}
      </button>
      {open && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-2">
          {reasons.map((reason, i) => (
            <p key={i} className="flex items-start gap-2 text-sm text-gray-600">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#2b6cb0]" />
              {reason}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Trust type selector (for Guardian / Fortress)
// ============================================================================

interface TrustTypeSelectorProps {
  value: string;
  onChange: (v: string) => void;
  packageType: PackageType;
}

function TrustTypeSelector({ value, onChange, packageType }: TrustTypeSelectorProps) {
  // Filter trust types by package:
  // Guardian → revocable trusts are sensible; Fortress → any irrevocable trust
  const revocableTrusts = ['Revocable Living Trust', 'Testamentary Trust', 'Land Trust'];
  const options =
    packageType === 'guardian'
      ? [
          'Revocable Living Trust',
          ...TRUST_TYPES.filter(
            (t) => !revocableTrusts.includes(t) === false && t !== 'Revocable Living Trust',
          ),
        ]
      : TRUST_TYPES.filter((t) => !revocableTrusts.includes(t) || t === value);

  return (
    <div className="rounded-xl border border-[#2b6cb0]/30 bg-[#ebf4ff] px-5 py-4">
      <label
        htmlFor="trust-type-select"
        className="block text-sm font-semibold text-[#1a365d] mb-2"
      >
        Trust Type
        <span className="ml-2 text-xs font-normal text-gray-500">
          (your attorney may refine this after reviewing your answers)
        </span>
      </label>
      <select
        id="trust-type-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full rounded-lg border border-[#2b6cb0]/30 bg-white px-4 py-2.5 text-sm text-[#1a365d]',
          'focus:outline-none focus:ring-2 focus:ring-[#1a365d] focus:border-transparent',
        )}
      >
        {options.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
        {/* Also include all trust types in case the selected value is not in the filtered list */}
        {!options.includes(value) && (
          <option value={value}>{value}</option>
        )}
      </select>
    </div>
  );
}

// ============================================================================
// Main component
// ============================================================================

export function PackageSelector({ onContinue }: PackageSelectorProps) {
  const { data } = useQuestionnaire();

  const recommendation = useMemo(() => calculateRecommendation(data), [data]);

  const [selectedPackage, setSelectedPackage] = useState<PackageType>(
    recommendation.recommended,
  );
  const [selectedTrustType, setSelectedTrustType] = useState<string>(() => {
    const pkg = recommendation.allPackages.find((p) => p.type === recommendation.recommended);
    return pkg?.defaultTrustType ?? '';
  });

  // When user switches packages, update trust type default
  function handleSelectPackage(type: PackageType) {
    setSelectedPackage(type);
    const pkg = recommendation.allPackages.find((p) => p.type === type);
    if (pkg?.defaultTrustType) {
      setSelectedTrustType(pkg.defaultTrustType);
    }
  }

  const needsTrustType = selectedPackage === 'guardian' || selectedPackage === 'fortress';

  const firstName = data.personalInfo?.firstName ?? '';
  const subtitle = firstName
    ? `Based on your answers, ${firstName}, here is our recommendation for your estate plan.`
    : 'Based on your answers, here is our recommendation for your estate plan.';

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-[#1a365d] sm:text-3xl">
          Your Recommended Estate Plan
        </h1>
        <p className="mt-2 text-base text-gray-500 max-w-xl mx-auto">{subtitle}</p>
        <p className="mt-1 text-sm text-gray-400">
          You can change your selection below. Your attorney will confirm the best fit after
          reviewing your information.
        </p>
      </div>

      {/* Package cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3 sm:gap-4">
        {recommendation.allPackages.map((pkg) => (
          <PackageCard
            key={pkg.type}
            pkg={pkg}
            isSelected={selectedPackage === pkg.type}
            onClick={() => handleSelectPackage(pkg.type)}
          />
        ))}
      </div>

      {/* Trust type selector — only for Guardian / Fortress */}
      {needsTrustType && (
        <TrustTypeSelector
          value={selectedTrustType}
          onChange={setSelectedTrustType}
          packageType={selectedPackage}
        />
      )}

      {/* Why this recommendation */}
      <WhyPanel reasons={recommendation.reasons} />

      {/* All packages include */}
      <AllPackagesInclude />

      {/* Continue button */}
      <div className="flex flex-col items-center gap-3">
        <button
          onClick={() =>
            onContinue(selectedPackage, needsTrustType ? selectedTrustType : undefined)
          }
          className={cn(
            'flex items-center gap-2 rounded-xl bg-[#1a365d] px-8 py-3.5 text-base font-semibold text-white shadow-sm',
            'transition-all hover:bg-[#2b4a7a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a365d] focus-visible:ring-offset-2',
          )}
        >
          Continue with{' '}
          {recommendation.allPackages.find((p) => p.type === selectedPackage)?.name ??
            'Selected Plan'}
          <ArrowRight className="h-5 w-5" />
        </button>
        <p className="text-xs text-gray-400">
          You can still change your selection at any time before submitting.
        </p>
      </div>
    </div>
  );
}
