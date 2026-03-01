/**
 * SmartTooltip.tsx
 *
 * Context-sensitive help tooltips for questionnaire fields.
 * Shows a plain-English explanation when the user clicks the help icon
 * next to a field label. All content is hardcoded — no AI calls per request.
 *
 * Usage:
 *   <SmartTooltip fieldName="executor" questionText="Who should manage your estate?" />
 */

import { useState, useRef, useEffect } from 'react';
import { HelpCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Tooltip content map — 20+ estate planning terms
// ---------------------------------------------------------------------------

interface TooltipEntry {
  title: string;
  explanation: string;
  example?: string;
}

export const TOOLTIP_CONTENT: Record<string, TooltipEntry> = {
  // --- Fiduciaries ---
  executor: {
    title: 'Executor (Personal Representative)',
    explanation:
      'The executor is the person you name in your will to manage your estate after you pass away. They are responsible for gathering your assets, paying your debts and taxes, and distributing what remains to your beneficiaries according to your wishes.',
    example:
      'Example: If you name your spouse as executor, they will file your will with the court, collect your bank accounts, pay outstanding bills, and transfer property to your heirs.',
  },
  alternate_executor: {
    title: 'Alternate Executor',
    explanation:
      'The alternate executor steps in if your primary executor is unable or unwilling to serve — for example, if they predecease you, become incapacitated, or decline the role. Naming an alternate avoids court delay.',
    example: 'Example: Primary executor: Spouse. Alternate executor: Adult child.',
  },
  trustee: {
    title: 'Trustee',
    explanation:
      'A trustee manages assets held inside a trust on behalf of the beneficiaries. If you create a revocable living trust, you typically serve as your own initial trustee. You name a successor trustee to take over if you become incapacitated or pass away.',
    example:
      'Example: You are the initial trustee of your own revocable trust. Your adult daughter is the successor trustee.',
  },
  guardian: {
    title: 'Guardian',
    explanation:
      'A guardian is the person you name to care for your minor children if both parents are deceased or unable to care for them. The court must approve the appointment, but your nomination carries significant weight.',
    example:
      "Example: You name your sister as guardian for your two children, ages 7 and 10, if you and your spouse both pass away.",
  },
  guardianship: {
    title: 'Guardianship',
    explanation:
      "Guardianship is the legal arrangement by which a person (the guardian) is authorized to care for and make decisions for a minor child or incapacitated adult. In a will, you nominate a guardian for your minor children — the court formally appoints them.",
  },
  power_of_attorney: {
    title: 'Power of Attorney (Financial)',
    explanation:
      "A power of attorney (POA) is a legal document authorizing someone (your 'agent' or 'attorney-in-fact') to manage your financial affairs — like paying bills, filing taxes, managing investments, or selling property — on your behalf.",
    example:
      'Example: You become incapacitated in a car accident. Your POA agent can access your bank accounts to pay your mortgage and utilities.',
  },
  healthcare_proxy: {
    title: 'Healthcare Proxy / Healthcare Representative',
    explanation:
      'Your healthcare proxy (also called a healthcare representative in New Jersey) is the person authorized to make medical decisions for you if you are unable to speak for yourself. This is part of your Advance Directive for Health Care under N.J.S.A. 26:2H-55 et seq.',
    example:
      'Example: You are unconscious after surgery. Your healthcare proxy can authorize or refuse specific treatments based on your stated wishes.',
  },
  poa_agent: {
    title: 'POA Agent (Attorney-in-Fact)',
    explanation:
      'Your POA agent — also called your attorney-in-fact — is the person authorized under your Power of Attorney to act on your behalf for financial matters. They have a fiduciary duty to act in your best interests.',
  },
  durable_poa: {
    title: 'Durable Power of Attorney',
    explanation:
      "A durable POA remains effective even if you become mentally incapacitated. Under N.J.S.A. 46:2B-8.9, a POA is presumed durable unless it specifically states otherwise. This is the most common type for estate planning purposes.",
  },
  springing_poa: {
    title: 'Springing Power of Attorney',
    explanation:
      "A springing POA only becomes effective ('springs into action') upon a specific event, such as your incapacity as certified by one or two physicians. While this provides a safeguard, it can cause delays in an emergency.",
    example:
      'Example: Your agent cannot act until your doctor certifies in writing that you are incapacitated.',
  },

  // --- Trusts ---
  revocable_living_trust: {
    title: 'Revocable Living Trust',
    explanation:
      'A revocable living trust is a legal arrangement where you transfer ownership of your assets to a trust during your lifetime. You (as the initial trustee) continue to control the assets. At death, the assets pass to beneficiaries without going through probate, providing privacy and speed.',
    example:
      'Example: You transfer your house and investment accounts to a revocable trust. When you die, your successor trustee distributes them to your children without probate court.',
  },
  irrevocable_trust: {
    title: 'Irrevocable Trust',
    explanation:
      'Once created, an irrevocable trust generally cannot be changed or revoked without the beneficiaries\' consent. Assets transferred into it are removed from your taxable estate and protected from creditors. Used for Medicaid planning, asset protection, and estate tax reduction.',
    example:
      'Example: A Medicaid Asset Protection Trust (MAPT) is irrevocable. Assets placed in it five years before a Medicaid application are shielded from the Medicaid spend-down requirement.',
  },
  pour_over_will: {
    title: 'Pour-Over Will',
    explanation:
      "A pour-over will is used alongside a revocable living trust. It 'pours' any assets you owned at death that weren't already in your trust into the trust, ensuring everything is distributed under the trust's terms.",
    example:
      'Example: You forgot to retitle your savings account into your trust. The pour-over will directs that account into the trust at your death.',
  },
  living_will: {
    title: 'Living Will / Advance Directive',
    explanation:
      'A living will (formally called an Advance Directive for Health Care in New Jersey) documents your medical wishes — such as whether you want life-sustaining treatment if terminally ill or permanently unconscious. It also names your healthcare representative. Governed by N.J.S.A. 26:2H-55 et seq.',
  },
  testamentary_trust: {
    title: 'Testamentary Trust',
    explanation:
      'A testamentary trust is created inside your will and only comes into existence at your death. Unlike a living trust, it does go through probate. It is often used to hold assets for minor children until they reach a specified age.',
    example:
      'Example: Your will creates a testamentary trust that holds your children\'s inheritance until each reaches age 25.',
  },
  special_needs_trust: {
    title: 'Special Needs Trust (Supplemental Needs Trust)',
    explanation:
      'A special needs trust holds assets for a beneficiary with a disability without disqualifying them from government benefits like Medicaid or SSI. The trustee can pay for supplemental expenses (recreation, education, personal items) beyond what government programs cover.',
    example:
      'Example: You leave $200,000 in a special needs trust for your son with autism. He continues to receive Medicaid and SSI while the trust pays for therapies and activities.',
  },

  // --- Distribution concepts ---
  beneficiary: {
    title: 'Beneficiary',
    explanation:
      'A beneficiary is a person or organization designated to receive assets from your estate, trust, will, life insurance policy, or retirement account. You should name both a primary and a contingent beneficiary.',
    example:
      'Example: Primary beneficiary: Spouse. Contingent beneficiary: Children equally.',
  },
  contingent_beneficiary: {
    title: 'Contingent Beneficiary',
    explanation:
      'A contingent beneficiary inherits only if all primary beneficiaries have predeceased you or disclaim their inheritance. They are the backup recipients.',
    example:
      'Example: Primary beneficiary: Spouse. If your spouse predeceases you, the contingent beneficiaries (your children) inherit.',
  },
  per_stirpes: {
    title: 'Per Stirpes',
    explanation:
      "Per stirpes (Latin for 'by the branch') is a distribution method where a deceased beneficiary's share passes to their descendants rather than being divided among surviving beneficiaries. Protects grandchildren if a child predeceases you.",
    example:
      "Example: You have two children; one predeceases you leaving two grandchildren. Per stirpes: the deceased child's 50% share passes equally to the two grandchildren (25% each).",
  },

  // --- Other legal terms ---
  iolta: {
    title: 'IOLTA Account',
    explanation:
      "IOLTA stands for Interest on Lawyers' Trust Accounts. It is a special bank account attorneys use to hold client funds (such as retainers) that are nominal in amount or held for a short time. The interest earned goes to fund legal aid programs in New Jersey.",
  },
  fiduciary: {
    title: 'Fiduciary',
    explanation:
      'A fiduciary is a person with a legal obligation to act in your best interests — putting your interests above their own. In estate planning, your executor, trustee, and POA agent are all fiduciaries. They can be held legally liable for breaching this duty.',
  },
  utma: {
    title: 'UTMA (Uniform Transfers to Minors Act)',
    explanation:
      "Under New Jersey's UTMA, you can leave assets to a minor through a custodian who manages them until the child reaches the age of majority (18 or 21). Simpler and less expensive than a trust, but the child receives full control at the specified age.",
    example:
      'Example: You leave $50,000 to your nephew under UTMA with your sister as custodian, until he turns 21.',
  },
};

/** Fallback content for any fieldName not in the map */
const FALLBACK_ENTRY: TooltipEntry = {
  title: 'More Information',
  explanation:
    'Contact your attorney for specific guidance on this question. At Elias Counsel, LLC, we are happy to explain any aspect of your estate plan in plain English.',
};

/** Normalize a fieldName to look up in the map (lowercase, underscores) */
function normalizeKey(fieldName: string): string {
  return fieldName.toLowerCase().replace(/[\s\-\.]+/g, '_');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SmartTooltipProps {
  /** Key for looking up content, e.g. "executor", "irrevocable_trust" */
  fieldName: string;
  /** The question text being asked (displayed as context in the popover) */
  questionText?: string;
  /** Additional CSS class for the trigger button */
  className?: string;
}

export default function SmartTooltip({
  fieldName,
  questionText,
  className,
}: SmartTooltipProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const key = normalizeKey(fieldName);
  const entry = TOOLTIP_CONTENT[key] ?? FALLBACK_ENTRY;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  return (
    <span className="relative inline-flex items-center">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Help: ${entry.title}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center justify-center rounded-full',
          'h-4 w-4 text-[#2b6cb0] hover:text-[#1a365d]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2b6cb0] focus-visible:ring-offset-1',
          'transition-colors duration-150',
          className,
        )}
      >
        <HelpCircle className="h-4 w-4" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={entry.title}
          aria-modal="false"
          className={cn(
            // Position: appear below-right of trigger
            'absolute left-6 top-0 z-50',
            // Dimensions
            'w-[min(320px,calc(100vw-2rem))]',
            // Visual
            'rounded-md border border-[#1a365d]/20 bg-white shadow-md',
            'p-4',
          )}
        >
          {/* Header */}
          <div className="mb-2 flex items-start justify-between gap-2">
            <p className="text-sm font-semibold leading-snug text-[#1a365d]">
              {entry.title}
            </p>
            <button
              type="button"
              aria-label="Close help"
              onClick={() => setOpen(false)}
              className={cn(
                'flex-shrink-0 rounded p-0.5',
                'text-[#1a365d]/50 hover:text-[#1a365d]',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2b6cb0]',
                'transition-colors duration-150',
              )}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          {/* Context question (optional) */}
          {questionText && (
            <p className="mb-2 text-[11px] italic text-[#1a365d]/60 leading-snug">
              Re: "{questionText}"
            </p>
          )}

          {/* Explanation */}
          <p className="text-xs leading-relaxed text-[#1a365d]/80">
            {entry.explanation}
          </p>

          {/* Example (optional) */}
          {entry.example && (
            <p className="mt-2 rounded bg-[#ebf4ff] px-2 py-1.5 text-xs leading-relaxed text-[#1a365d]/70">
              {entry.example}
            </p>
          )}

          {/* Legal disclaimer */}
          <p className="mt-3 border-t border-[#1a365d]/10 pt-2 text-[10px] text-[#1a365d]/40 leading-tight">
            This explanation is for general reference only and does not constitute legal advice.
          </p>
        </div>
      )}
    </span>
  );
}
