/**
 * functions/src/spouse-swap.ts
 *
 * Spouse data swap for married-couple generation — extracted verbatim from
 * unified-generator.ts so other generation paths (e.g. high-fidelity .docx
 * package fills) can produce a spouse's document from the same client record
 * without duplicating this logic.
 *
 * Two entry points mirror the two shapes the pipeline carries:
 *  - swapClientDataForSpouse(clientData)   — the raw Firestore client record
 *    handed to generators. Returns a NEW object; the input is not mutated.
 *  - swapClientContextForSpouse(ctx)       — the aggregated ClientContext used
 *    by the template engine. MUTATES the given context (callers already work
 *    on a per-generation clone) including the computed name/title/pronoun
 *    fields.
 *
 * Behavior notes preserved from the original implementation:
 *  - Backfill: spouseInfo blocks typically lack address/gender; missing
 *    fields are backfilled from the original primary (shared household).
 *  - Gender inversion is a heteronormative-marriage heuristic. On the
 *    clientData side it is gated on maritalStatus === 'married' (R5-035);
 *    the context side predates that gate and inverts whenever the swapped
 *    personal has no gender — asymmetry kept as-is by this extraction
 *    (behavior-identical refactor; unify deliberately, not incidentally).
 *  - Spouse-tagged fiduciary slots are re-targeted at the new spouse and
 *    sibling/parent relationships translate to their in-law equivalents;
 *    Son/Daughter is deliberately left alone (could be joint child or
 *    stepchild — the data model can't distinguish).
 *  - Spouse title/pronouns derive from the original primary's actual gender,
 *    not by inverting the new testator's (R5-003 same-sex marriage fix).
 */

import * as admin from 'firebase-admin';
import { ClientContext } from './client-context-aggregator';

type Rec = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

/** Fields backfilled from the original primary when missing on the spouse. */
const BACKFILL_FIELDS = ['address', 'city', 'state', 'zip', 'county', 'lastName'] as const;

const HOUSEHOLD_REL = new Set(['spouse', 'husband', 'wife', 'partner', 'domestic partner']);

// Kinship terms that flip to "in-law" on the spouse-swap view. The original
// primary's blood relatives become the new testator's relatives-by-marriage.
// Scope intentionally limited to siblings + parents (the unambiguous cases).
const IN_LAW_TRANSLATION = new Map<string, string>([
  ['brother', 'Brother-in-Law'],
  ['sister', 'Sister-in-Law'],
  ['mother', 'Mother-in-Law'],
  ['father', 'Father-in-Law'],
]);

/** True when the client record has usable spouse data (R5-034 precondition). */
export function hasSpouseData(clientData: Rec | admin.firestore.DocumentData): boolean {
  const sp = clientData.spouseInfo as Rec | undefined;
  return !!sp && (!!sp.firstName || !!sp.lastName);
}

function backfillFromPrimary(swapped: Rec, originalPersonal: Rec): void {
  for (const field of BACKFILL_FIELDS) {
    const val = swapped[field];
    if ((val === undefined || val === null || val === '') && originalPersonal[field] !== undefined) {
      swapped[field] = originalPersonal[field];
    }
  }
}

/**
 * Re-target spouse-tagged fiduciary slots at the new spouse (the original
 * primary) and translate blood-relative labels to their in-law equivalents.
 */
function swapFiduciaries(
  raw: Rec | undefined,
  newSpouseFullName: string,
  newSpouseRelationship: string,
): Rec | undefined {
  if (!raw || typeof raw !== 'object') return raw;
  const out: Rec = { ...raw };
  for (const [role, roleVal] of Object.entries(out)) {
    if (!roleVal || typeof roleVal !== 'object') continue;
    const nextRole: Rec = { ...(roleVal as Rec) };
    for (const [tier, tierVal] of Object.entries(nextRole)) {
      if (!tierVal || typeof tierVal !== 'object') continue;
      const t = tierVal as Rec;
      const rel = typeof t.relationship === 'string' ? (t.relationship as string).trim().toLowerCase() : '';
      if (HOUSEHOLD_REL.has(rel)) {
        // Re-target this slot at the now-spouse (the original primary).
        nextRole[tier] = {
          ...t,
          name: newSpouseFullName || t.name,
          relationship: newSpouseRelationship,
          // Address fields auto-fill via the template-engine pass; clear
          // any stale ones tied to the previous person so the auto-fill
          // re-populates with the new testator's household address.
          address: '',
          city: '',
          state: '',
          zip: '',
          county: '',
        };
      } else if (IN_LAW_TRANSLATION.has(rel)) {
        // Same person, relabeled from the new testator's perspective.
        nextRole[tier] = {
          ...t,
          relationship: IN_LAW_TRANSLATION.get(rel),
        };
      }
    }
    out[role] = nextRole;
  }
  return out;
}

function fullNameOf(p: Rec): string {
  return [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ').trim();
}

function spouseRelationshipOf(originalPersonal: Rec): string {
  const og = typeof originalPersonal.gender === 'string' ? (originalPersonal.gender as string).trim().toLowerCase() : '';
  if (og === 'female') return 'Wife';
  if (og === 'male') return 'Husband';
  return 'Spouse';
}

// ---------------------------------------------------------------------------
// clientData swap (generator path)
// ---------------------------------------------------------------------------

/**
 * Swap personalInfo ↔ spouseInfo on the raw client record so generators treat
 * the spouse as the testator. Returns a new object; no-op (returns the input)
 * when there is no spouseInfo.
 */
export function swapClientDataForSpouse(
  clientData: admin.firestore.DocumentData,
): admin.firestore.DocumentData {
  if (!clientData.spouseInfo) return clientData;
  const originalPersonal = { ...(clientData.personalInfo as Rec) };
  const originalSpouse = { ...(clientData.spouseInfo as Rec) };

  const swappedPersonal: Rec = { ...originalSpouse };
  backfillFromPrimary(swappedPersonal, originalPersonal);

  // Gender inversion gated on 'Married' (R5-035) — for everything else leave
  // gender undefined so the user sets it explicitly.
  const originalMaritalStatus =
    typeof originalPersonal.maritalStatus === 'string'
      ? (originalPersonal.maritalStatus as string).trim().toLowerCase()
      : '';
  if (
    !swappedPersonal.gender &&
    typeof originalPersonal.gender === 'string' &&
    originalMaritalStatus === 'married'
  ) {
    const og = (originalPersonal.gender as string).trim().toLowerCase();
    if (og === 'female') swappedPersonal.gender = 'male';
    else if (og === 'male') swappedPersonal.gender = 'female';
  }

  const swappedFiduciaries = swapFiduciaries(
    clientData.fiduciaries as Rec | undefined,
    fullNameOf(originalPersonal),
    spouseRelationshipOf(originalPersonal),
  );

  return {
    ...clientData,
    personalInfo: swappedPersonal,
    spouseInfo: originalPersonal,
    fiduciaries: swappedFiduciaries ?? clientData.fiduciaries,
  };
}

// ---------------------------------------------------------------------------
// ClientContext swap (template-engine path)
// ---------------------------------------------------------------------------

/**
 * Mirror the spouse swap onto an aggregated ClientContext, including the
 * computed names, spouse/client titles, and all pronoun sets. Mutates the
 * given context (callers operate on a per-generation clone). No-op when the
 * context has no spouseInfo.
 */
export function swapClientContextForSpouse(clientContext: ClientContext): void {
  if (!clientContext?.client?.spouseInfo) return;

  const ctxOriginalPersonal = { ...(clientContext.client.personalInfo as Rec) };
  const ctxOriginalSpouse = { ...(clientContext.client.spouseInfo as Rec) };

  const ctxSwappedPersonal: Rec = { ...ctxOriginalSpouse };
  backfillFromPrimary(ctxSwappedPersonal, ctxOriginalPersonal);
  // NOTE: unlike the clientData side, this inversion has never been gated on
  // maritalStatus === 'married' — asymmetry preserved by the extraction.
  if (!ctxSwappedPersonal.gender && typeof ctxOriginalPersonal.gender === 'string') {
    const og = (ctxOriginalPersonal.gender as string).trim().toLowerCase();
    if (og === 'female') ctxSwappedPersonal.gender = 'male';
    else if (og === 'male') ctxSwappedPersonal.gender = 'female';
  }
  clientContext.client.personalInfo = ctxSwappedPersonal;
  clientContext.client.spouseInfo = ctxOriginalPersonal;

  const ctxSwappedFiduciaries = swapFiduciaries(
    clientContext.client.fiduciaries as Rec | undefined,
    fullNameOf(ctxOriginalPersonal),
    spouseRelationshipOf(ctxOriginalPersonal),
  );
  if (ctxSwappedFiduciaries) {
    clientContext.client.fiduciaries = ctxSwappedFiduciaries as never;
  }

  // Swap computed names
  const originalClientFullName = clientContext.computed.clientFullName;
  const originalSpouseFullName = clientContext.computed.spouseFullName;
  clientContext.computed.clientFullName = originalSpouseFullName;
  clientContext.computed.spouseFullName = originalClientFullName;

  // Reflip titles/pronouns from the now-current testator's perspective. The
  // new spouse IS the original primary, whose actual gender is reliably
  // captured — derive the spouse's title/pronouns from THAT, not by inverting
  // the new testator's gender (R5-003 same-sex marriage fix).
  const newGender = (ctxSwappedPersonal.gender as string | undefined)?.trim().toLowerCase();
  const newSpouseGender = (ctxOriginalPersonal.gender as string | undefined)?.trim().toLowerCase();
  const newClientIsFemale = newGender === 'female';
  const newSpouseIsFemale = newSpouseGender === 'female';
  const newMaritalStatus = (ctxSwappedPersonal.maritalStatus as string | undefined) ?? '';
  const isDP = newMaritalStatus === 'Domestic Partnership';
  if (isDP) {
    clientContext.computed.spouseTitle = 'partner';
    clientContext.computed.clientTitle = 'partner';
  } else {
    if (newSpouseGender) clientContext.computed.spouseTitle = newSpouseIsFemale ? 'wife' : 'husband';
    if (newGender) clientContext.computed.clientTitle = newClientIsFemale ? 'wife' : 'husband';
  }
  if (newGender || newSpouseGender) {
    const malePronouns = { subject: 'he', object: 'him', possessive: 'his' };
    const femalePronouns = { subject: 'she', object: 'her', possessive: 'her' };
    const neutralPronouns = { subject: 'they', object: 'them', possessive: 'their' };
    clientContext.computed.clientPronouns = newGender ? (newClientIsFemale ? femalePronouns : malePronouns) : neutralPronouns;
    clientContext.computed.spousePronouns = newSpouseGender ? (newSpouseIsFemale ? femalePronouns : malePronouns) : neutralPronouns;

    // Recompute fiduciary pronouns now that the testator perspective has
    // flipped. A spouse-tagged fiduciary slot now points at the new spouse
    // (the original primary), so its inferred pronoun must follow the new
    // spousePronouns. Any non-spouse slot retains its slot's explicit gender
    // if set, else neutral.
    // Same relationship-gender inference as client-context-aggregator — kept
    // inline so the spouse-swap rebuild stays self-contained.
    const FEMALE_REL = new Set([
      'wife', 'mother', 'daughter', 'sister', 'grandmother', 'granddaughter',
      'aunt', 'niece', 'mother-in-law', 'daughter-in-law', 'sister-in-law',
      'great-grandmother', 'great-granddaughter', 'great-aunt', 'great-niece',
      'great-great-grandmother', 'great-great-granddaughter',
    ]);
    const MALE_REL = new Set([
      'husband', 'father', 'son', 'brother', 'grandfather', 'grandson',
      'uncle', 'nephew', 'father-in-law', 'son-in-law', 'brother-in-law',
      'great-grandfather', 'great-grandson', 'great-uncle', 'great-nephew',
      'great-great-grandfather', 'great-great-grandson',
    ]);
    const newSpousePronouns = clientContext.computed.spousePronouns;
    const recompute = (slot: Rec | undefined) => {
      if (!slot || typeof slot !== 'object') return neutralPronouns;
      const explicit = typeof slot.gender === 'string' ? (slot.gender as string).trim().toLowerCase() : '';
      if (explicit === 'male') return malePronouns;
      if (explicit === 'female') return femalePronouns;
      const rel = typeof slot.relationship === 'string' ? (slot.relationship as string).trim().toLowerCase() : '';
      if (HOUSEHOLD_REL.has(rel)) return newSpousePronouns;
      if (FEMALE_REL.has(rel)) return femalePronouns;
      if (MALE_REL.has(rel)) return malePronouns;
      return neutralPronouns;
    };
    const fids = clientContext.client.fiduciaries as Record<string, Record<string, Rec | undefined> | undefined> | undefined;
    clientContext.computed.poaAgentPronouns = recompute(fids?.powerOfAttorney?.agent);
    clientContext.computed.poaAlternateAgentPronouns = recompute(fids?.powerOfAttorney?.alternateAgent);
    clientContext.computed.healthcareRepPronouns = recompute(fids?.healthcareProxy?.agent);
    clientContext.computed.healthcareRepAlternatePronouns = recompute(fids?.healthcareProxy?.alternateAgent);
    clientContext.computed.executorPronouns = recompute(fids?.executor?.primary);
    clientContext.computed.executorAlternatePronouns = recompute(fids?.executor?.alternate);
    clientContext.computed.trusteePronouns = recompute(fids?.trustee?.primary);
    clientContext.computed.trusteeAlternatePronouns = recompute(fids?.trustee?.alternate);
  }
}
