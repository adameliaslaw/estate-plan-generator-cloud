/**
 * Recommendation Engine for the NJ Estate Plan Generator
 *
 * Scores each of the three packages (Foundation, Guardian, Fortress) based on
 * the questionnaire data and returns a ranked recommendation with plain-English
 * reasons and full package option objects.
 */

import type { QuestionnaireData } from '@/types/questionnaire';
import type { PackageType } from '@/types';

// ============================================================================
// Public types
// ============================================================================

export interface PackageRecommendation {
  recommended: PackageType;
  scores: Record<PackageType, number>;
  reasons: string[];               // plain-English reasons for the recommendation
  allPackages: PackageOption[];
}

export interface PackageOption {
  type: PackageType;
  name: string;          // "The Foundation Plan", "The Guardian Plan", "The Fortress Plan"
  tagline: string;       // "Will-Based", "Revocable Trust Plan", "Irrevocable / Protection Plan"
  description: string;
  includedDocuments: string[];
  score: number;
  isRecommended: boolean;
  defaultTrustType?: string;  // for guardian / fortress
}

// ============================================================================
// Main export
// ============================================================================

export function calculateRecommendation(data: QuestionnaireData): PackageRecommendation {
  let foundationScore = 0;
  let guardianScore = 0;
  let fortressScore = 0;

  // ── Derived flags ─────────────────────────────────────────────────────────

  const totalAssets = estimateTotalAssets(data);
  const isSimpleEstate   = totalAssets < 500_000;
  const isModerateEstate = totalAssets >= 500_000 && totalAssets < 2_000_000;
  const isLargeEstate    = totalAssets >= 2_000_000;

  const realEstateList = data.assets?.realEstate ?? [];
  const hasOutOfStateRealEstate = realEstateList.some(
    (p) => p.state && p.state !== 'NJ' && p.state !== 'New Jersey',
  );
  const hasRealEstate = realEstateList.length > 0;

  const hasNonClassABeneficiaries = checkForNonClassABeneficiaries(data);

  const hasMinorChildren = (data.children ?? []).some((c) => isMinor(c.dob));
  const hasSpecialNeedsChild = (data.children ?? []).some((c) => c.specialNeeds);

  const wantsMedicaidPlanning =
    (data as unknown as { specialConsiderations?: { hasMedicaidPlanning?: boolean } })
      .specialConsiderations?.hasMedicaidPlanning ?? false;

  const hasBlendedFamily =
    (data as unknown as { specialConsiderations?: { hasBlendedFamily?: boolean } })
      .specialConsiderations?.hasBlendedFamily ?? false;

  const hasSignificantLifeInsurance = (data.assets?.lifeInsurance ?? []).some(
    (p) => (p.faceValue ?? 0) > 250_000,
  );

  // ── Scoring ───────────────────────────────────────────────────────────────

  // Foundation: best for simple, single-person/couple estates with no trust needs
  if (isSimpleEstate)     foundationScore += 3;
  if (isModerateEstate)   foundationScore += 1;
  if (!hasOutOfStateRealEstate) foundationScore += 1;

  // Guardian: trust-centered plan — avoids probate, handles real estate, minor children
  if (hasOutOfStateRealEstate) guardianScore += 3;  // avoid ancillary probate
  if (hasRealEstate)           guardianScore += 1;   // probate-avoidance benefit
  if (hasMinorChildren)        guardianScore += 2;   // long-term trust for minors
  if (hasBlendedFamily)        guardianScore += 2;   // controlled inheritance for blended families
  if (hasNonClassABeneficiaries) guardianScore += 2; // NJ inheritance tax waiver timing
  if (isModerateEstate || isLargeEstate) guardianScore += 1;

  // Fortress: irrevocable / advanced planning for Medicaid, asset protection, SNT
  if (wantsMedicaidPlanning)    fortressScore += 3;
  if (hasSpecialNeedsChild)     fortressScore += 2;
  if (isLargeEstate)            fortressScore += 1;
  if (hasSignificantLifeInsurance) fortressScore += 1; // ILIT candidate

  // ── Determine winner ──────────────────────────────────────────────────────

  const scores: Record<PackageType, number> = {
    foundation: foundationScore,
    guardian:   guardianScore,
    fortress:   fortressScore,
  };

  const recommended = (
    Object.entries(scores).sort(([, a], [, b]) => b - a)[0][0] as PackageType
  );

  // ── Build plain-English reasons ───────────────────────────────────────────

  const reasons: string[] = [];

  if (recommended === 'foundation') {
    if (isSimpleEstate) {
      reasons.push(
        'Your estimated estate value is under $500,000, which is well-suited to a will-based plan.',
      );
    }
    if (!hasRealEstate) {
      reasons.push(
        'You have no real estate, so avoiding probate through a trust is less critical.',
      );
    }
    if (!hasMinorChildren && !hasSpecialNeedsChild) {
      reasons.push(
        'You do not have minor or special-needs children who would benefit from a long-term trust.',
      );
    }
    reasons.push(
      'A will-based plan provides complete protection at the most streamlined cost for your situation.',
    );
  }

  if (recommended === 'guardian') {
    if (hasOutOfStateRealEstate) {
      reasons.push(
        'You own real estate outside New Jersey. A revocable trust avoids the need for ancillary probate proceedings in those other states.',
      );
    }
    if (hasRealEstate && !hasOutOfStateRealEstate) {
      reasons.push(
        'You own New Jersey real estate. Transferring it to a revocable trust avoids NJ probate on those properties.',
      );
    }
    if (hasMinorChildren) {
      reasons.push(
        'You have minor children. A trust allows you to manage how and when they receive their inheritance instead of having the court supervise a Uniform Transfers to Minors account.',
      );
    }
    if (hasBlendedFamily) {
      reasons.push(
        'A blended family situation benefits from the precise control a revocable trust provides over who receives what and when.',
      );
    }
    if (hasNonClassABeneficiaries) {
      reasons.push(
        'Some of your beneficiaries may be subject to New Jersey inheritance tax (Class C/D). A trust can simplify the inheritance tax waiver process.',
      );
    }
    if (isModerateEstate) {
      reasons.push(
        'With an estimated estate in the $500K–$2M range, a trust-based plan provides meaningful probate-avoidance benefits.',
      );
    }
  }

  if (recommended === 'fortress') {
    if (wantsMedicaidPlanning) {
      reasons.push(
        'You have indicated an interest in Medicaid planning. An Irrevocable Medicaid Asset Protection Trust (MAPT) can shelter assets from the Medicaid spend-down requirement, subject to the five-year look-back period.',
      );
    }
    if (hasSpecialNeedsChild) {
      reasons.push(
        'You have a child with special needs. A Special Needs Trust (SNT) or Supplemental Needs Trust preserves their eligibility for government benefits such as SSI and Medicaid.',
      );
    }
    if (isLargeEstate) {
      reasons.push(
        'Your estate exceeds $2 million. Advanced irrevocable trust strategies can reduce estate and inheritance tax exposure for your heirs.',
      );
    }
    if (hasSignificantLifeInsurance) {
      reasons.push(
        'You have significant life insurance. An Irrevocable Life Insurance Trust (ILIT) can keep the death benefit outside your taxable estate.',
      );
    }
  }

  // ── Build package option objects ──────────────────────────────────────────

  const allPackages: PackageOption[] = [
    {
      type: 'foundation',
      name: 'Basic Estate Plan Package',
      tagline: 'Will-Based Estate Plan',
      description:
        'A comprehensive will-based estate plan for individuals and couples with straightforward estate planning needs. Your Last Will and Testament directs how your assets are distributed, while a Durable Power of Attorney and Advance Directive protect you during your lifetime. Probate, when needed, is handled in NJ Surrogate Court — typically a smooth process for well-drafted wills. This plan is the right fit when your estate is manageable, you own NJ property only, and you don\'t need the advanced asset-protection features of a trust.',
      includedDocuments: [
        'Last Will and Testament (with Self-Proving Affidavit)',
        'Durable Financial Power of Attorney',
        'Advance Directive / Living Will (Healthcare Proxy + HIPAA Authorization)',
        'Estate Plan Summary',
        'Action Steps Checklist',
      ],
      score: foundationScore,
      isRecommended: recommended === 'foundation',
    },
    {
      type: 'guardian',
      name: 'Revocable Trust Package',
      tagline: 'Revocable Living Trust Plan',
      description:
        'A trust-centered estate plan that avoids probate, manages out-of-state real estate, and gives you precise control over how and when beneficiaries inherit. Your Revocable Living Trust holds your assets during your lifetime and distributes them seamlessly at death — without court involvement. A Pour-Over Will acts as a backstop for any assets not yet in the trust. Trust Transfer Deeds are prepared to retitle real estate into the trust, eliminating the need for probate in every state where you own property. This plan is ideal for families with real estate, minor children, or blended-family situations.',
      includedDocuments: [
        'Revocable Living Trust',
        'Pour-Over Last Will and Testament (with Self-Proving Affidavit)',
        'Durable Financial Power of Attorney',
        'Advance Directive / Living Will (Healthcare Proxy + HIPAA Authorization)',
        'Certificate of Trust',
        'Trust Transfer Deed(s) + Affidavit(s) of Consideration + GIT/REP-3',
        'Assignment of Personal Property to Trust',
        'Estate Plan Summary',
        'Action Steps Checklist',
      ],
      score: guardianScore,
      isRecommended: recommended === 'guardian',
      defaultTrustType: 'Revocable Living Trust',
    },
    {
      type: 'fortress',
      name: 'Irrevocable Trust Package',
      tagline: 'Irrevocable Trust / Asset Protection Plan',
      description:
        'An advanced estate plan built around an irrevocable trust for clients with Medicaid planning goals, special-needs beneficiaries, significant life insurance, or large taxable estates. Unlike a revocable trust, an irrevocable trust removes assets from your estate — protecting them from Medicaid spend-down requirements, creditors, and estate taxes. The most common type for NJ clients is the Medicaid Asset Protection Trust (MAPT), but the trust type is tailored to your specific goals. A Pour-Over Will, full suite of planning documents, and real estate transfer documents are included.',
      includedDocuments: [
        'Irrevocable Trust (type selected based on your goals)',
        'Pour-Over Last Will and Testament (with Self-Proving Affidavit)',
        'Durable Financial Power of Attorney',
        'Advance Directive / Living Will (Healthcare Proxy + HIPAA Authorization)',
        'Certificate of Trust',
        'Trust Transfer Deed(s) + Affidavit(s) of Consideration + GIT/REP-3',
        'Assignment of Personal Property to Trust',
        'Memorandum / Certification of Trust',
        'Estate Plan Summary',
        'Action Steps Checklist',
      ],
      score: fortressScore,
      isRecommended: recommended === 'fortress',
      defaultTrustType: 'Medicaid Asset Protection Trust (MAPT)',
    },
  ];

  return { recommended, scores, reasons, allPackages };
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Estimate gross asset value from all asset categories.
 * Uses estimatedValue / estimatedBalance fields; falls back to 0 when absent.
 */
function estimateTotalAssets(data: QuestionnaireData): number {
  let total = 0;

  for (const prop of data.assets?.realEstate ?? []) {
    total += prop.estimatedValue ?? 0;
  }
  for (const acct of data.assets?.bankAccounts ?? []) {
    total += (acct as { estimatedBalance?: number }).estimatedBalance ?? 0;
  }
  for (const acct of data.assets?.investmentAccounts ?? []) {
    total += (acct as { estimatedValue?: number }).estimatedValue ?? 0;
  }
  for (const acct of data.assets?.retirementAccounts ?? []) {
    total += (acct as { estimatedValue?: number }).estimatedValue ?? 0;
  }
  for (const pol of data.assets?.lifeInsurance ?? []) {
    // Use cash value for estate calculation (not face value), but fall back to face value
    total += pol.cashValue ?? pol.faceValue ?? 0;
  }
  for (const biz of data.assets?.businessInterests ?? []) {
    total += (biz as { estimatedValue?: number }).estimatedValue ?? 0;
  }
  for (const pp of data.assets?.personalProperty ?? []) {
    total += (pp as { estimatedValue?: number }).estimatedValue ?? 0;
  }

  // If the user or system set an explicit total, prefer that
  const explicit = data.assets?.estimatedTotalEstate;
  if (typeof explicit === 'number' && explicit > 0) {
    return explicit;
  }

  return total;
}

/**
 * Check if any beneficiary appears to be a non-Class-A beneficiary under
 * NJ inheritance tax rules.
 *
 * Class A (exempt): spouse/domestic partner, civil union partner, lineal
 * descendants (children, grandchildren), lineal ancestors (parents,
 * grandparents), and stepchildren.
 *
 * Class C/D (taxable): siblings, nieces/nephews, cousins, friends, etc.
 *
 * We look at:
 * 1. Specific bequest recipients whose relationship is not Class A
 * 2. Distribution notes / referral source isn't meaningful — skip
 * 3. We rely on the distribution plan for a proxy signal
 */
function checkForNonClassABeneficiaries(data: QuestionnaireData): boolean {
  const classARelationships = [
    'spouse',
    'wife',
    'husband',
    'partner',
    'domestic partner',
    'child',
    'children',
    'son',
    'daughter',
    'grandchild',
    'grandchildren',
    'grandson',
    'granddaughter',
    'parent',
    'mother',
    'father',
    'stepchild',
    'stepson',
    'stepdaughter',
    'lineal',
  ];

  // Check specific bequests
  const bequests = data.distribution?.specificBequests ?? [];
  for (const b of bequests) {
    const rel = (b.recipientRelationship ?? '').toLowerCase();
    if (rel && !classARelationships.some((r) => rel.includes(r))) {
      return true;
    }
  }

  // Check residual distributions
  const residual = data.distribution?.residualDistributions ?? [];
  for (const r of residual) {
    const rel = (r.recipientRelationship ?? '').toLowerCase();
    if (rel && !classARelationships.some((a) => rel.includes(a))) {
      return true;
    }
  }

  // Check other dependents — if they exist and have non-Class-A relationships
  for (const dep of data.otherDependents ?? []) {
    const rel = (dep.relationship ?? '').toLowerCase();
    if (rel && !classARelationships.some((a) => rel.includes(a))) {
      return true;
    }
  }

  return false;
}

/**
 * Determine if a date of birth string represents a minor (under 18).
 * Accepts ISO 8601 date strings (YYYY-MM-DD).
 */
function isMinor(dob?: string): boolean {
  if (!dob) return false;
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return false;
  const now = new Date();
  const age =
    now.getFullYear() -
    birth.getFullYear() -
    (now < new Date(now.getFullYear(), birth.getMonth(), birth.getDate()) ? 1 : 0);
  return age < 18;
}
