/**
 * functions/src/nj-inheritance-tax.ts
 *
 * New Jersey transfer inheritance tax — beneficiary classification, the rate
 * schedule, and the apportionment clause our documents were missing.
 *
 * WHY THIS EXISTS
 *
 * New Jersey repealed its ESTATE tax for decedents dying on or after
 * January 1, 2018. The TRANSFER INHERITANCE tax (N.J.S.A. 54:33-1 et seq.)
 * survived, and it is charged on the relationship between the decedent and
 * each beneficiary rather than on the size of the estate. A sibling, a niece,
 * or a friend pays 11–16% from the first dollar (Class C after a $25,000
 * exemption; Class D from $500).
 *
 * Two different default rules govern who bears which tax, and they do not
 * behave the same way:
 *
 *   FEDERAL ESTATE TAX — N.J.S.A. 3B:24-1 et seq. apportions it pro rata among
 *   the transferees absent a contrary direction. Note that chapter's own
 *   definition: 3B:24-1 defines "the tax" as taxes "imposing an estate tax."
 *   The transfer inheritance tax is therefore OUTSIDE that chapter.
 *
 *   NJ TRANSFER INHERITANCE TAX — N.J.S.A. 54:35-6 directs the fiduciary to
 *   "deduct the tax therefrom" before distributing, and provides the fiduciary
 *   "shall not deliver ... any such legacy or property to any person until he
 *   has collected such tax." The tax follows the property: each recipient
 *   bears the tax on their own share unless the instrument says otherwise.
 *
 * THE TRAP THIS MODULE EXISTS TO PREVENT
 *
 * The common boilerplate — "all death taxes shall be paid out of my residuary
 * estate as an expense of administration" — is not neutral in New Jersey. It
 * takes a Class C or Class D beneficiary's 11–16% tax off that beneficiary and
 * puts it on the residuary takers, who in a typical plan are the Class A
 * children who owe no inheritance tax at all. A $100,000 gift to a niece
 * silently costs the children about $15,000. Almost nobody intends that, and
 * almost nobody drafts around it.
 *
 * So the clause is offered in three deliberate modes rather than one default.
 * Choosing is the point.
 *
 * Sources (verified August 2026):
 *   NJ Division of Taxation, "Inheritance Tax Beneficiary Classes"
 *   NJ Division of Taxation, "Inheritance and Estate Tax: Tax Rates"
 *   N.J.S.A. 54:35-6; N.J.S.A. 3B:24-1, 3B:24-2, 3B:24-4
 *
 * ---------------------------------------------------------------------------
 * CLASSIFICATION AND RATES LIVE IN THE FILING ENGINE
 *
 * `functions/src/inheritance-tax/` is the source of truth for who is in which
 * class and what they owe: a typed Relationship enum, cents-exact bracket
 * arithmetic, and DATED rule sets (2002 / 2017 / 2018) so a death in an earlier
 * year is computed under the schedule in force then. This module does not
 * duplicate any of it — `njClassFor` below maps a free-text relationship onto
 * that enum and delegates.
 *
 * What lives here is the part the engine does not address: the apportionment
 * clause. The engine computes and FILES the tax; this decides who BEARS it.
 * ---------------------------------------------------------------------------
 */

import { classifyBeneficiary } from './inheritance-tax/engine/classify';
import type { Relationship, TaxClass } from './inheritance-tax/types';

// ---------------------------------------------------------------------------
// Relationship → the filing engine's typed enum
// ---------------------------------------------------------------------------

/**
 * Free-text relationship (as an intake form records it) → the filing engine's
 * typed Relationship.
 *
 * Only confident mappings belong here. Anything unrecognised returns null, and
 * null is NOT Class D — guessing would print an 11-16% tax warning about a
 * beneficiary who may owe nothing.
 *
 * The step-relations are the ones that catch drafters, and the engine's own
 * comments carry the authority: a stepCHILD is Class A, but a step-GRANDchild,
 * a stepPARENT, a stepSIBLING, and the spouse of a stepchild are all Class D
 * (N.J.A.C. 18:26-1.1) — even though the spouse of a natural child is Class C.
 */
const RELATIONSHIP_PATTERNS: ReadonlyArray<[RegExp, Relationship]> = [
  // Order matters: the step- forms must be tested before their base forms.
  [/^(great[- ]?)?step[- ]?grand(child|son|daughter)$/, 'step_grandchild'],
  [/^step[- ]?(child|son|daughter)[- ]in[- ]law$/, 'stepchild_in_law'],
  [/^(spouse|widow|widower|civil union partner) of (a |my )?step[- ]?(child|son|daughter)$/, 'stepchild_in_law'],
  [/^mutually acknowledged child[- ]in[- ]law$/, 'mutually_acknowledged_child_in_law'],
  [/^step[- ]?(child|son|daughter)$/, 'stepchild'],
  [/^step[- ]?(parent|mother|father)$/, 'stepparent'],
  [/^step[- ]?(brother|sister|sibling)$/, 'stepbrother_stepsister'],
  [/^ex[- ]?(spouse|husband|wife)$/, 'ex_spouse'],

  [/^(spouse|husband|wife|widow|widower)$/, 'spouse'],
  [/^civil union partner$/, 'civil_union_partner'],
  [/^domestic partner$/, 'domestic_partner'],
  [/^(child|son|daughter|issue|(lineal )?descendant)$/, 'child'],
  [/^(legally )?adopted[- ]?(child|son|daughter)$/, 'child'],
  [/^mutually acknowledged child$/, 'mutually_acknowledged_child'],
  [/^grand(child|son|daughter)$/, 'grandchild'],
  [/^great[- ]?grand(child|son|daughter)$/, 'great_grandchild'],
  [/^(parent|mother|father)$/, 'parent'],
  [/^(grand|great[- ]?grand)(parent|mother|father)$/, 'grandparent'],

  [/^(brother|sister|sibling)$/, 'sibling'],
  [/^half[- ](brother|sister|sibling)$/, 'sibling'],
  [/^(son|daughter)[- ]in[- ]law$/, 'child_in_law'],
  [/^(spouse|widow|widower) of (a |my )?(child|son|daughter)$/, 'child_in_law'],

  [/^(great[- ]?)?(niece|nephew)$/, 'niece_nephew'],
  [/^(aunt|uncle)$/, 'aunt_uncle'],
  [/^cousin$/, 'cousin'],
  [/^(brother|sister)[- ]in[- ]law$/, 'other_individual'],
  [/^(parent|mother|father)[- ]in[- ]law$/, 'other_individual'],
  [/^(friend|godchild|neighbor|colleague)$/, 'friend'],
  [/^(unrelated|no relation|none)$/, 'other_individual'],

  [/^(qualified )?charit(y|able organization)$/, 'charity'],
  [/^religious (institution|organization)$/, 'religious_organization'],
  [/^educational (institution|organization)$/, 'educational_organization'],
  [/^medical institution$/, 'medical_institution'],
  [/^(the )?state of new jersey$/, 'governmental_entity'],
  [/^(municipality|county|political subdivision)$/, 'governmental_entity'],
];

/** Normalise a stated relationship to the engine's enum, or null if unknown. */
export function toRelationship(relationship: string): Relationship | null {
  const r = relationship.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.]/g, '');
  if (!r) return null;
  for (const [rx, rel] of RELATIONSHIP_PATTERNS) if (rx.test(r)) return rel;
  return null;
}

/**
 * NJ transfer inheritance tax class for a free-text relationship.
 *
 * Delegates to the filing engine's classifier so the two can never disagree.
 * Returns null when the relationship is not recognised — never a guess.
 */
export function njClassFor(relationship: string): TaxClass | null {
  const rel = toRelationship(relationship);
  return rel ? classifyBeneficiary(rel) : null;
}

// ---------------------------------------------------------------------------
// The apportionment clause
// ---------------------------------------------------------------------------

/**
 * Who bears death taxes.
 *
 *   residuary   All death taxes are an expense of administration paid from the
 *               residue. Traditional boilerplate. In New Jersey it shifts a
 *               Class C/D beneficiary's inheritance tax onto the residuary
 *               takers — usually the Class A children.
 *
 *   apportioned Each beneficiary bears the inheritance tax on their own share,
 *               tracking the default of N.J.S.A. 54:35-6, with federal estate
 *               tax apportioned under N.J.S.A. 3B:24-1 et seq.
 *
 *   hybrid      Class A shares pass free of tax from the residue; Class C and
 *               Class D beneficiaries bear the tax on their own transfers.
 *               Usually what clients actually mean, and rarely drafted.
 */
export type ApportionmentMode = 'residuary' | 'apportioned' | 'hybrid';

export interface ApportionmentOptions {
  mode: ApportionmentMode;
  /** 'will' | 'trust' — selects fiduciary and instrument vocabulary. */
  instrument?: 'will' | 'trust';
  /** Section/article heading. Defaults to a generic one. */
  heading?: string;
}

function vocab(instrument: 'will' | 'trust') {
  return instrument === 'trust'
    ? { fiduciary: 'trustee', estate: 'trust estate', instrument: 'trust' }
    : { fiduciary: 'executor', estate: 'estate', instrument: 'Will' };
}

/** Shared closing paragraph: the recovery/lien mechanics the fiduciary needs. */
function recoveryParagraph(v: ReturnType<typeof vocab>): string {
  return (
    `<p>My ${v.fiduciary} shall have full authority to withhold from any distribution, ` +
    `or to recover from any recipient, the amount of any tax apportioned to that ` +
    `recipient under this Article, and shall not be required to deliver any property ` +
    `until that amount has been paid or secured, consistent with N.J.S.A. 54:35-6. ` +
    `My ${v.fiduciary} shall not be liable to any beneficiary for any good-faith ` +
    `determination made under this Article.</p>`
  );
}

/**
 * Render the apportionment clause as HTML.
 *
 * Fixed, attorney-reviewable prose — deliberately not generated by a model.
 * Statutory citations in generated text must be reproducible and identical on
 * every run, which is exactly what an LLM cannot promise.
 */
export function renderApportionmentClause(options: ApportionmentOptions): string {
  const instrument = options.instrument ?? 'will';
  const v = vocab(instrument);
  const heading = options.heading ?? 'Payment and Apportionment of Death Taxes';

  const preamble =
    `<p>As used in this Article, "death taxes" means all estate, inheritance, ` +
    `succession, transfer, and similar taxes, together with any interest and penalties ` +
    `thereon, payable by reason of my death, including the New Jersey transfer ` +
    `inheritance tax imposed under N.J.S.A. 54:33-1 et seq. and any federal estate tax. ` +
    `"Death taxes" does not include any generation-skipping transfer tax, which shall ` +
    `be payable as provided in I.R.C. § 2603, or any additional tax imposed under ` +
    `I.R.C. § 2032A.</p>`;

  let body: string;

  switch (options.mode) {
    case 'residuary':
      body =
        `<p>I direct that all death taxes payable by reason of my death, whether ` +
        `attributable to property passing under this ${v.instrument} or to property ` +
        `passing outside it, shall be paid by my ${v.fiduciary} out of the residue of my ` +
        `${v.estate} as an expense of administration, without apportionment and without ` +
        `contribution or reimbursement from any beneficiary. I intend by this direction ` +
        `to relieve every beneficiary of the burden of death taxes on their transfer, ` +
        `and to override the apportionment that would otherwise apply under N.J.S.A. ` +
        `3B:24-1 et seq. and the deduction and collection otherwise required of my ` +
        `${v.fiduciary} by N.J.S.A. 54:35-6.</p>` +
        `<p>I have been advised and understand that because the New Jersey transfer ` +
        `inheritance tax is imposed by reference to each beneficiary's relationship to ` +
        `me, this direction causes any inheritance tax attributable to a transfer to a ` +
        `Class C or Class D beneficiary to be borne by the residuary beneficiaries of my ` +
        `${v.estate}, and I so intend.</p>`;
      break;

    case 'apportioned':
      body =
        `<p>I direct that death taxes be apportioned so that each transfer bears its own ` +
        `tax. Any New Jersey transfer inheritance tax attributable to a transfer to or ` +
        `for the benefit of any beneficiary shall be charged against and paid from that ` +
        `beneficiary's transfer, and my ${v.fiduciary} shall deduct or collect that tax ` +
        `before distribution as provided in N.J.S.A. 54:35-6. Any federal estate tax ` +
        `shall be apportioned among the persons interested in my ${v.estate} in ` +
        `accordance with N.J.S.A. 3B:24-1 et seq.</p>` +
        `<p>No beneficiary shall be entitled to contribution or reimbursement from the ` +
        `residue of my ${v.estate} on account of any tax charged against that ` +
        `beneficiary's transfer under this Article.</p>`;
      break;

    case 'hybrid':
      body =
        `<p>I direct that death taxes be borne as follows.</p>` +
        `<p><em>Class A transfers.</em> Any death taxes attributable to a transfer to a ` +
        `beneficiary who is a Class A beneficiary for purposes of the New Jersey ` +
        `transfer inheritance tax shall be paid by my ${v.fiduciary} out of the residue ` +
        `of my ${v.estate} as an expense of administration, without apportionment and ` +
        `without contribution from that beneficiary, so that the transfer passes free of ` +
        `death taxes.</p>` +
        `<p><em>Class C and Class D transfers.</em> Any New Jersey transfer inheritance ` +
        `tax attributable to a transfer to a beneficiary who is a Class C or Class D ` +
        `beneficiary shall be charged against and paid from that beneficiary's own ` +
        `transfer, and my ${v.fiduciary} shall deduct or collect that tax before ` +
        `distribution as provided in N.J.S.A. 54:35-6. No such beneficiary shall be ` +
        `entitled to contribution or reimbursement from the residue of my ${v.estate}.</p>` +
        `<p><em>Classification.</em> The classification of a beneficiary shall be ` +
        `determined under N.J.S.A. 54:34-2 and the regulations thereunder as in effect at ` +
        `my death. I direct my ${v.fiduciary}'s good-faith determination of a ` +
        `beneficiary's class, made in reliance on the published positions of the New ` +
        `Jersey Division of Taxation, to be binding on all persons interested in my ` +
        `${v.estate}.</p>` +
        `<p><em>Federal estate tax.</em> Any federal estate tax shall be apportioned ` +
        `among the persons interested in my ${v.estate} in accordance with N.J.S.A. ` +
        `3B:24-1 et seq.</p>`;
      break;
  }

  return `<h2>${heading}</h2>\n${preamble}\n${body}\n${recoveryParagraph(v)}`;
}

/**
 * Plain-text explanation of a mode, for the drafting UI and for the client
 * summary. Says what the choice costs, not just what it does.
 */
export const APPORTIONMENT_EXPLANATIONS: Record<ApportionmentMode, string> = {
  residuary:
    'All death taxes come out of the residue as an administration expense. Every ' +
    'beneficiary receives their gift whole. In New Jersey this means the residuary ' +
    'beneficiaries — usually the children, who owe no inheritance tax themselves — ' +
    'pay the 11–16% tax generated by gifts to siblings, nieces, nephews, or friends.',
  apportioned:
    "Each beneficiary bears the inheritance tax on their own share, which is what New " +
    'Jersey law does by default. A gift to a Class C or Class D beneficiary arrives ' +
    'reduced by their tax. The residue is not charged for anyone else’s tax.',
  hybrid:
    'Gifts to Class A beneficiaries (spouse, children, grandchildren, stepchildren, ' +
    'parents) pass free of tax from the residue; Class C and Class D beneficiaries bear ' +
    'their own inheritance tax. This is usually what clients mean when they say they ' +
    'want gifts to pass "free of tax," and it is rarely drafted.',
};

/**
 * Prompt block for the AI generators, instructing them to reproduce the clause
 * exactly rather than compose their own.
 */
export function buildApportionmentPromptBlock(options: ApportionmentOptions): string {
  return [
    'REQUIRED ARTICLE — DEATH TAX APPORTIONMENT (New Jersey):',
    'Include the following article VERBATIM. Do not reword it, renumber its citations,',
    'summarize it, or omit any paragraph. Place it immediately after the article that',
    'pays debts and expenses. You may change only the <h2> heading text to match the',
    "document's article numbering scheme.",
    '',
    renderApportionmentClause(options),
  ].join('\n');
}
