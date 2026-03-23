/**
 * functions/src/client-data-serializer.ts
 *
 * Canonical client data serializer for document generation prompts.
 *
 * PROBLEM: Each of the 10 generators independently formats client data
 * (names, addresses, children, fiduciaries) into their user prompts,
 * resulting in subtly different representations of the same client across
 * documents — e.g. "John M. Smith" in the Will but "John Smith" in the POA.
 *
 * SOLUTION: This module provides a SINGLE `serializeClientData()` function
 * that every generator calls. It produces a standardized text block with
 * consistent formatting of all client data fields.
 *
 * @see unified-generator.ts — calls this module
 * @see generators/*.ts — each generator uses the output as its user prompt context
 */

import { sanitizeForPrompt, sanitizeObject } from './ai-client';
import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SerializedClientData {
  /** Complete formatted text block for embedding in AI prompts */
  text: string;
  /** The canonical full name used throughout — generators can reference this */
  clientFullName: string;
  /** Spouse full name (empty string if no spouse) */
  spouseFullName: string;
  /** Whether the client has a spouse */
  hasSpouse: boolean;
  /** Whether the client has minor children */
  hasMinorChildren: boolean;
  /** Whether the client has any children with special needs */
  hasSpecialNeedsChild: boolean;
  /** Number of children */
  childCount: number;
  /** Package type */
  packageType: string;
}

// ---------------------------------------------------------------------------
// Name formatting — THE canonical way to build a full name
// ---------------------------------------------------------------------------

/**
 * Build a full legal name from parts in a consistent order.
 * This is the ONLY function that should build display names across generators.
 */
export function formatFullName(
  person: Record<string, unknown> | null | undefined,
): string {
  if (!person) return '';
  // Handle flat name string
  if (typeof person === 'string') return person;
  // Handle {name: "..."} style (common in fiduciary entries)
  if (person.name && typeof person.name === 'string' && !person.firstName) {
    return person.name as string;
  }
  // Build from parts
  return [person.firstName, person.middleName, person.lastName, person.suffix]
    .filter(Boolean)
    .join(' ');
}

/**
 * Format an address from parts consistently.
 */
function formatAddress(obj: Record<string, unknown> | null | undefined): string {
  if (!obj) return 'Not provided';
  const parts = [obj.address, obj.city, obj.state].filter(Boolean);
  const base = parts.join(', ');
  const zip = obj.zip ? ` ${obj.zip}` : '';
  return base ? `${base}${zip}` : 'Not provided';
}

/**
 * Format a fiduciary entry (agent, executor, trustee, etc.) with name,
 * relationship, and address.
 */
function formatFiduciary(
  person: Record<string, unknown> | null | undefined,
  label: string,
): string {
  if (!person) return `  ${label}: Not designated`;
  const name = formatFullName(person) || 'Not designated';
  const rel = person.relationship ? `, ${person.relationship}` : '';
  const addr = person.address ? `, ${formatAddress(person)}` : '';
  return `  ${label}: ${name}${rel}${addr}`;
}

// ---------------------------------------------------------------------------
// Core serializer
// ---------------------------------------------------------------------------

/**
 * Serialize all client data into a standardized text block for AI prompts.
 *
 * Every generator should use this instead of building its own user prompt
 * context. This guarantees that the same client data is represented identically
 * across all document types.
 *
 * @param clientData - Raw client document from Firestore
 * @param firmData   - Raw firm document from Firestore
 * @param docType    - Target document type (used to include/exclude sections)
 * @returns Serialized data with text block and key derived flags
 */
export function serializeClientData(
  clientData: admin.firestore.DocumentData,
  firmData: admin.firestore.DocumentData,
  docType: string,
): SerializedClientData {
  const safe = sanitizeObject(clientData);
  const safeFirm = sanitizeObject(firmData);

  const pi = safe.personalInfo ?? {};
  const spouse = safe.spouseInfo;
  const children: admin.firestore.DocumentData[] = safe.children ?? [];
  const fiduciaries = safe.fiduciaries ?? {};
  const distribution = safe.distribution ?? {};
  const assets = safe.assets ?? {};
  const specialConsiderations = safe.specialConsiderations ?? {};
  const trusts: admin.firestore.DocumentData[] = safe.trusts ?? [];
  const packageDetails = safe.packageDetails ?? {};

  // ── Canonical names ─────────────────────────────────────────────────────
  const clientFullName = formatFullName(pi);
  const spouseFullName = spouse ? formatFullName(spouse) : '';
  const hasSpouse = ['Married', 'Domestic Partnership'].includes(pi.maritalStatus);
  const hasMinorChildren = children.some(
    (c: admin.firestore.DocumentData) => c.isMinor === true,
  );
  const hasSpecialNeedsChild = children.some(
    (c: admin.firestore.DocumentData) => c.specialNeeds === true,
  );
  const packageType = packageDetails.packageType ?? 'foundation';

  // ── Gender / pronouns ───────────────────────────────────────────────────
  const isFemale = pi.gender === 'female' || (pi.gender == null && safe.isFemale === true);
  const pronouns = isFemale ? 'she/her/her' : 'he/him/his';

  // ── Build text sections ─────────────────────────────────────────────────
  const sections: string[] = [];

  // 1. Client identity
  sections.push(`CLIENT:
  Full legal name: ${clientFullName || 'NOT PROVIDED'}
  Gender: ${isFemale ? 'Female' : 'Male'} (pronouns: ${pronouns})
  Date of birth: ${pi.dob ?? 'Not provided'}
  Address: ${formatAddress(pi)}
  County: ${pi.county ?? 'Not provided'}
  Marital status: ${pi.maritalStatus ?? 'Not provided'}
  Citizenship: ${pi.citizenship ?? 'US Citizen'}
  Occupation: ${pi.occupation ?? 'Not provided'}
  Employer: ${pi.employer ?? 'Not provided'}
  Phone: ${pi.phone ?? 'Not provided'}
  Email: ${pi.email ?? 'Not provided'}`);

  // 2. Spouse (if applicable)
  if (hasSpouse && spouse) {
    sections.push(`SPOUSE:
  Full legal name: ${spouseFullName || 'NOT PROVIDED'}
  Date of birth: ${spouse.dob ?? 'Not provided'}
  Address: ${spouse.sameAddress ? 'Same as client' : formatAddress(spouse)}
  Phone: ${spouse.phone ?? 'Not provided'}
  Email: ${spouse.email ?? 'Not provided'}`);
  } else {
    sections.push('SPOUSE: None (single / not applicable)');
  }

  // 3. Children
  if (children.length > 0) {
    const childLines = children.map((c: admin.firestore.DocumentData, i: number) => {
      const name = sanitizeForPrompt(c.name ?? formatFullName(c));
      const age = c.isMinor ? 'minor' : 'adult';
      const flags: string[] = [];
      if (c.specialNeeds) flags.push('SPECIAL NEEDS');
      if (c.relationship === 'stepchild') flags.push('stepchild');
      const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
      const guardian = c.guardian ? `; guardian: ${sanitizeForPrompt(c.guardian)}` : '';
      const altGuardian = c.alternateGuardian ? `; alt guardian: ${sanitizeForPrompt(c.alternateGuardian)}` : '';
      return `  ${i + 1}. ${name}, DOB ${c.dob ?? 'unknown'}, ${age}${flagStr}${guardian}${altGuardian}`;
    });
    sections.push(`CHILDREN (${children.length}):\n${childLines.join('\n')}`);
  } else {
    sections.push('CHILDREN: None');
  }

  // 4. Fiduciaries
  const fid = fiduciaries;
  const executor = fid.executor ?? {};
  const trustee = fid.trustee ?? {};
  const poa = fid.powerOfAttorney ?? {};
  const healthcare = fid.healthcareProxy ?? {};
  const guardian = fid.guardian ?? {};

  const fidLines: string[] = ['FIDUCIARIES:'];

  // Executor
  fidLines.push(formatFiduciary(executor.primary, 'Executor (Primary)'));
  fidLines.push(formatFiduciary(executor.alternate, 'Executor (Alternate)'));
  if (executor.successor) fidLines.push(formatFiduciary(executor.successor, 'Executor (Successor)'));
  fidLines.push(`  Bond required: ${executor.bondRequired ? 'Yes' : 'No'}`);
  fidLines.push(`  Compensation: ${executor.compensation ?? 'statutory'}`);

  // Trustee
  fidLines.push(formatFiduciary(trustee.primary, 'Trustee (Primary)'));
  fidLines.push(formatFiduciary(trustee.alternate, 'Trustee (Alternate)'));
  if (trustee.successor) fidLines.push(formatFiduciary(trustee.successor, 'Trustee (Successor)'));
  if (trustee.coTrustee) fidLines.push(formatFiduciary(trustee.coTrustee, 'Co-Trustee'));
  fidLines.push(`  Bond required: ${trustee.bondRequired ? 'Yes' : 'No'}`);
  fidLines.push(`  Compensation: ${trustee.compensation ?? 'statutory'}`);

  // Power of Attorney
  fidLines.push(formatFiduciary(poa.agent, 'POA Agent (Primary)'));
  fidLines.push(formatFiduciary(poa.alternateAgent, 'POA Agent (Alternate)'));
  if (poa.successorAgent) fidLines.push(formatFiduciary(poa.successorAgent, 'POA Agent (Successor)'));
  fidLines.push(`  Effective date: ${poa.effectiveDate ?? 'immediate'}`);
  fidLines.push(`  Gifting power: ${poa.giftingPower ? 'Yes' : 'No'}`);
  fidLines.push(`  Self-dealing power: ${poa.selfDealingPower ? 'Yes' : 'No'}`);
  if (poa.limitations) fidLines.push(`  Limitations: ${sanitizeForPrompt(poa.limitations)}`);

  // Healthcare Proxy
  fidLines.push(formatFiduciary(healthcare.primary ?? healthcare.agent, 'Healthcare Proxy (Primary)'));
  fidLines.push(formatFiduciary(healthcare.alternate, 'Healthcare Proxy (Alternate)'));

  // Guardian (for minors)
  if (hasMinorChildren) {
    fidLines.push(formatFiduciary(guardian.primary ?? safe.guardianPrimary, 'Guardian (Primary)'));
    fidLines.push(formatFiduciary(guardian.alternate ?? safe.guardianAlternate, 'Guardian (Alternate)'));
  }

  sections.push(fidLines.join('\n'));

  // 5. Assets (included for doc types that need them)
  const assetDocTypes = new Set([
    'will', 'trust', 'deed', 'affidavitOfConsideration', 'gitRep3',
    'estatePlanSummary', 'actionSteps', 'pourOverWill',
  ]);
  if (assetDocTypes.has(docType)) {
    const assetLines: string[] = ['ASSETS:'];

    // Real estate
    const realEstate: admin.firestore.DocumentData[] = assets.realEstate ?? [];
    if (realEstate.length > 0) {
      assetLines.push('  Real Estate:');
      for (const r of realEstate) {
        const addr = sanitizeForPrompt(r.address ?? '');
        const city = sanitizeForPrompt(r.city ?? '');
        const val = r.estimatedValue ? ` ($${Number(r.estimatedValue).toLocaleString()})` : '';
        const trust = r.transferToTrust ? ' [Transfer to Trust]' : '';
        const block = r.blockLot ? `, Block/Lot: ${r.blockLot}` : '';
        assetLines.push(`    - ${addr}, ${city}, NJ${block}${val}${trust}`);
      }
    }

    // Bank accounts
    const bankAccounts: admin.firestore.DocumentData[] = assets.bankAccounts ?? [];
    if (bankAccounts.length > 0) {
      assetLines.push('  Bank Accounts:');
      for (const b of bankAccounts) {
        const inst = sanitizeForPrompt(b.institution ?? b.accountName ?? '');
        const type = b.accountType ? ` (${b.accountType})` : '';
        const bal = b.estimatedBalance ? ` — $${Number(b.estimatedBalance).toLocaleString()}` : '';
        const trust = b.transferToTrust ? ' [Transfer to Trust]' : '';
        assetLines.push(`    - ${inst}${type}${bal}${trust}`);
      }
    }

    // Investment accounts
    const investments: admin.firestore.DocumentData[] = assets.investmentAccounts ?? [];
    if (investments.length > 0) {
      assetLines.push('  Investment Accounts:');
      for (const i of investments) {
        const inst = sanitizeForPrompt(i.institution ?? '');
        const type = i.accountType ? ` (${i.accountType})` : '';
        const val = i.estimatedValue ? ` — $${Number(i.estimatedValue).toLocaleString()}` : '';
        assetLines.push(`    - ${inst}${type}${val}`);
      }
    }

    // Retirement accounts
    const retirement: admin.firestore.DocumentData[] = assets.retirementAccounts ?? [];
    if (retirement.length > 0) {
      assetLines.push('  Retirement Accounts:');
      for (const r of retirement) {
        const inst = sanitizeForPrompt(r.institution ?? r.accountName ?? '');
        const type = r.accountType ? ` (${r.accountType})` : '';
        const val = r.estimatedValue ? ` — $${Number(r.estimatedValue).toLocaleString()}` : '';
        assetLines.push(`    - ${inst}${type}${val}`);
      }
    }

    // Life insurance
    const insurance: admin.firestore.DocumentData[] = assets.lifeInsurance ?? [];
    if (insurance.length > 0) {
      assetLines.push('  Life Insurance:');
      for (const li of insurance) {
        const name = sanitizeForPrompt(li.policyName ?? li.company ?? '');
        const face = li.faceValue ? ` Face: $${Number(li.faceValue).toLocaleString()}` : '';
        const cash = li.cashValue ? ` Cash: $${Number(li.cashValue).toLocaleString()}` : '';
        assetLines.push(`    - ${name}${face}${cash}`);
      }
    }

    // Business interests
    const business: admin.firestore.DocumentData[] = assets.businessInterests ?? [];
    if (business.length > 0) {
      assetLines.push('  Business Interests:');
      for (const b of business) {
        const name = sanitizeForPrompt(b.businessName ?? '');
        const val = b.estimatedValue ? ` — $${Number(b.estimatedValue).toLocaleString()}` : '';
        assetLines.push(`    - ${name}${val}`);
      }
    }

    // Digital assets flag
    const digitalAssets: admin.firestore.DocumentData[] = assets.digitalAssets ?? [];
    if (digitalAssets.length > 0) {
      assetLines.push(`  Digital Assets: ${digitalAssets.length} items`);
    }

    if (assetLines.length === 1) {
      assetLines.push('  None specified');
    }

    sections.push(assetLines.join('\n'));
  }

  // 6. Distribution
  const distDocTypes = new Set([
    'will', 'trust', 'pourOverWill', 'estatePlanSummary', 'actionSteps',
  ]);
  if (distDocTypes.has(docType)) {
    const distLines: string[] = ['DISTRIBUTION PLAN:'];

    // Specific bequests
    const bequests: admin.firestore.DocumentData[] = distribution.specificBequests ?? [];
    if (bequests.length > 0) {
      distLines.push('  Specific Bequests:');
      for (let i = 0; i < bequests.length; i++) {
        const b = bequests[i];
        const desc = sanitizeForPrompt(b.description ?? '');
        const to = sanitizeForPrompt(b.recipient ?? '');
        const cond = b.condition ? `, provided that ${sanitizeForPrompt(b.condition)}` : '';
        const alt = b.alternateRecipient ? `; if predeceased, to ${sanitizeForPrompt(b.alternateRecipient)}` : '';
        distLines.push(`    ${i + 1}. "${desc}" to ${to}${cond}${alt}`);
      }
    }

    // Charitable bequests
    const charitable: admin.firestore.DocumentData[] = distribution.charitableBequests ?? [];
    if (charitable.length > 0) {
      distLines.push('  Charitable Bequests:');
      for (const c of charitable) {
        const org = sanitizeForPrompt(c.organizationName ?? '');
        const ein = c.ein ? ` (EIN: ${c.ein})` : '';
        const amount = c.amount ? ` $${Number(c.amount).toLocaleString()}` : '';
        const pct = c.percentage ? ` ${c.percentage}%` : '';
        const purpose = c.purpose ? ` for ${sanitizeForPrompt(c.purpose)}` : '';
        distLines.push(`    - ${org}${ein}:${amount}${pct}${purpose}`);
      }
    }

    // Residual distributions
    const residual: admin.firestore.DocumentData[] = distribution.residualDistributions ?? [];
    if (residual.length > 0) {
      distLines.push('  Residual Distribution:');
      for (const r of residual) {
        const recip = sanitizeForPrompt(r.recipient ?? '');
        const rel = r.recipientRelationship ? ` (${sanitizeForPrompt(r.recipientRelationship)})` : '';
        const pct = r.percentage ? ` — ${r.percentage}%` : '';
        const method = r.perStirpes ? ', per stirpes' : ', per capita';
        const alt = r.alternateRecipient ? `; alternate: ${sanitizeForPrompt(r.alternateRecipient)}` : '';
        distLines.push(`    - ${recip}${rel}${pct}${method}${alt}`);
      }
    } else {
      distLines.push('  Residual: 100% to spouse, if living, otherwise equally to children, per stirpes');
    }

    distLines.push(`  Survivorship period: ${distribution.survivorshipPeriod ?? 30} days`);
    distLines.push(`  No-contest clause: ${distribution.noContestClause ? 'Yes' : 'No'}`);
    distLines.push(`  Spendthrift provision: ${distribution.spendthriftProvision ? 'Yes' : 'No'}`);
    distLines.push(`  Pour-over to trust: ${distribution.pourOverToTrust ? `Yes — ${sanitizeForPrompt(distribution.trustName ?? 'the Revocable Living Trust')}` : 'No'}`);

    if (distribution.notes) {
      distLines.push(`  Additional notes: ${sanitizeForPrompt(distribution.notes)}`);
    }

    sections.push(distLines.join('\n'));
  }

  // 7. Trust info (for trust-related docs)
  const trustDocTypes = new Set(['trust', 'pourOverWill', 'deed', 'estatePlanSummary']);
  if (trustDocTypes.has(docType) && trusts.length > 0) {
    const primaryTrust = trusts[0];
    const trustName = sanitizeForPrompt(
      primaryTrust?.trustName ?? distribution.trustName ?? `The ${clientFullName} Revocable Living Trust`,
    );

    const trustLines: string[] = [`TRUST INFORMATION:
  Trust name: ${trustName}
  Trust type: ${sanitizeForPrompt(primaryTrust?.trustType ?? 'Revocable Living Trust')}
  Distribution standard: ${sanitizeForPrompt(primaryTrust?.distributionStandard ?? 'HEMS (health, education, maintenance, and support)')}
  Termination age for minor trusts: ${primaryTrust?.terminationAge ?? 25}`];

    // Beneficiaries
    const beneficiaries: admin.firestore.DocumentData[] = primaryTrust?.beneficiaries ?? [];
    if (beneficiaries.length > 0) {
      trustLines.push('  Beneficiaries:');
      for (const b of beneficiaries) {
        const name = sanitizeForPrompt(b.name ?? '');
        const rel = b.relationship ? ` (${sanitizeForPrompt(b.relationship)})` : '';
        const pct = b.percentage ? ` — ${b.percentage}%` : '';
        trustLines.push(`    - ${name}${rel}${pct}`);
      }
    }

    if (primaryTrust?.notes) {
      trustLines.push(`  Trust notes: ${sanitizeForPrompt(primaryTrust.notes)}`);
    }

    sections.push(trustLines.join('\n'));
  }

  // 8. Healthcare preferences (for advance directive / living will)
  const healthDocTypes = new Set(['livingWill', 'estatePlanSummary', 'actionSteps']);
  if (healthDocTypes.has(docType)) {
    const hp = safe.healthcarePreferences ?? {};
    sections.push(`HEALTHCARE PREFERENCES:
  Life-sustaining treatment: ${hp.lifeSustaining ?? 'Not specified'}
  Artificial nutrition/hydration: ${hp.artificialNutrition ?? 'Not specified'}
  Pain management: ${hp.painManagement ?? 'Not specified'}
  Organ donation: ${hp.organDonation ?? 'Not specified'}
  Burial preference: ${safe.burialPreference ?? 'Not specified'}
  Burial details: ${sanitizeForPrompt(safe.burialDetails ?? '')}`);
  }

  // 9. Special provisions
  const specialLines: string[] = ['SPECIAL PROVISIONS:'];
  const hasDigitalAssets = (assets.digitalAssets ?? []).length > 0;
  specialLines.push(`  Digital assets: ${hasDigitalAssets ? 'Yes — include digital assets provision' : 'No'}`);
  specialLines.push(`  Special needs child: ${hasSpecialNeedsChild ? `Yes — ${sanitizeForPrompt(specialConsiderations.specialNeedsDetails ?? '')}` : 'No'}`);
  specialLines.push(`  Medicaid planning: ${specialConsiderations.hasMedicaidPlanning ? `Yes — ${sanitizeForPrompt(specialConsiderations.medicaidPlanningDetails ?? '')}` : 'No'}`);
  specialLines.push(`  Pet provision: ${specialConsiderations.hasPetProvision ? `Yes — ${sanitizeForPrompt(specialConsiderations.petDetails ?? '')}; caretaker: ${sanitizeForPrompt(specialConsiderations.petCaretaker ?? 'TBD')}` : 'No'}`);
  specialLines.push(`  Charitable goals: ${specialConsiderations.hasCharitableGoals ? `Yes — ${sanitizeForPrompt(specialConsiderations.charitableGoalsDetails ?? '')}` : 'No'}`);

  // Custom instructions (injected by unified-generator when user provides them)
  if (safe._customInstructions) {
    specialLines.push(`  Custom instructions: ${sanitizeForPrompt(safe._customInstructions)}`);
  }

  sections.push(specialLines.join('\n'));

  // 10. Firm data
  sections.push(`FIRM:
  Name: ${sanitizeForPrompt(safeFirm.firmName ?? '')}
  Address: ${sanitizeForPrompt(safeFirm.firmAddress ?? '')}
  Phone: ${safeFirm.firmPhone ?? ''}
  Email: ${safeFirm.firmEmail ?? ''}
  Website: ${safeFirm.firmWebsite ?? ''}
  Attorney bar number: ${safeFirm.barNumber ?? ''}`);

  // ── Assemble final text ─────────────────────────────────────────────────
  const text = sections.join('\n\n');

  return {
    text,
    clientFullName,
    spouseFullName,
    hasSpouse,
    hasMinorChildren,
    hasSpecialNeedsChild,
    childCount: children.length,
    packageType,
  };
}
