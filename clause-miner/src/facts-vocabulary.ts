/**
 * §7.1 — the shared fact vocabulary: ONE controlled-vocab module consumed by
 * both the Stage-3 mining extractor and (later) the recommender's intake
 * mapper. Facts are partitioned into classes, and the partition itself is
 * exported as data so downstream code (stats, cards, recommender rules)
 * enforces the circularity guard mechanically instead of by convention:
 *
 * - intake-observable: may appear in trigger-card rules[] — the recommender
 *   can evaluate them from QuestionnaireData/Client fields.
 * - document-derived: descriptive context only; drafting OUTCOMES —
 *   conditioning recommendations on them is circular (§7.1, risk #6).
 * - provisional: estateSizeBand — included only if the calibration sample
 *   shows Schedule A actually carries values (§7.1); until then it is
 *   computed but never a rule.
 *
 * 'unknown' handling is defined once, here: excluded from BOTH contingency
 * cells (§7.1).
 */

export const INTAKE_OBSERVABLE_FACTS = [
  'married',
  'childCountBand',
  'hasMinorChildren',
  'blendedFamily',
  'specialNeedsBeneficiary',
  'charitableBeneficiary',
  'businessInterests',
  'outOfStateRealProperty',
] as const;

export const DOCUMENT_DERIVED_FACTS = [
  'trustStructures',
  'distributionStandard',
  'fundedStatus',
] as const;

/** PROVISIONAL (§7.1): pending the Schedule-A calibration check. */
export const PROVISIONAL_FACTS = ['estateSizeBand'] as const;

export type IntakeObservableFact = (typeof INTAKE_OBSERVABLE_FACTS)[number];
export type DocumentDerivedFact = (typeof DOCUMENT_DERIVED_FACTS)[number];
export type ProvisionalFact = (typeof PROVISIONAL_FACTS)[number];
export type FactName = IntakeObservableFact | DocumentDerivedFact | ProvisionalFact;

export type FactClass = 'intake' | 'document' | 'provisional';

/** The partition, exported as data (§7.1). */
export const FACT_PARTITION: Readonly<Record<FactClass, readonly FactName[]>> = {
  intake: INTAKE_OBSERVABLE_FACTS,
  document: DOCUMENT_DERIVED_FACTS,
  provisional: PROVISIONAL_FACTS,
};

export function factClass(fact: string): FactClass | null {
  if ((INTAKE_OBSERVABLE_FACTS as readonly string[]).includes(fact)) return 'intake';
  if ((DOCUMENT_DERIVED_FACTS as readonly string[]).includes(fact)) return 'document';
  if ((PROVISIONAL_FACTS as readonly string[]).includes(fact)) return 'provisional';
  return null;
}

/** Only intake-observable facts may back recommender rules[] (§7.1, §7.4). */
export function isRuleEligible(fact: string): boolean {
  return factClass(fact) === 'intake';
}

/* ------------------------------------------------------------------ */
/* Value vocabularies                                                 */
/* ------------------------------------------------------------------ */

export const UNKNOWN_VALUE = 'unknown' as const;

export const CHILD_COUNT_BANDS = ['0', '1', '2', '3+', UNKNOWN_VALUE] as const;
export const BOOL_VALUES = ['true', 'false', UNKNOWN_VALUE] as const;
export const ESTATE_SIZE_BANDS = ['<1M', '1M-5M', '5M-13.6M', '>13.6M', UNKNOWN_VALUE] as const;
export const DISTRIBUTION_STANDARD_VALUES = [
  'HEMS',
  'Ascertainable',
  'Discretionary',
  'Mandatory',
  'Hybrid',
  'Other',
  UNKNOWN_VALUE,
] as const;
export const FUNDED_STATUS_VALUES = ['funded', 'unfunded', UNKNOWN_VALUE] as const;

/** Allowed values per scalar fact (trustStructures is a string[] and is
 *  validated against wills-schema TRUST_STRUCTURES by the extractor). */
export const FACT_VALUES: Readonly<Record<string, readonly string[]>> = {
  married: BOOL_VALUES,
  childCountBand: CHILD_COUNT_BANDS,
  hasMinorChildren: BOOL_VALUES,
  blendedFamily: BOOL_VALUES,
  specialNeedsBeneficiary: BOOL_VALUES,
  charitableBeneficiary: BOOL_VALUES,
  businessInterests: BOOL_VALUES,
  outOfStateRealProperty: BOOL_VALUES,
  distributionStandard: DISTRIBUTION_STANDARD_VALUES,
  fundedStatus: FUNDED_STATUS_VALUES,
  estateSizeBand: ESTATE_SIZE_BANDS,
};

/**
 * §7.1: 'unknown' (and missing) values are excluded from BOTH cells of a
 * contingency table — a doc with an unknown fact contributes to neither
 * the fact=value column nor the fact≠value column.
 */
export function isCountableFactValue(value: unknown): value is string {
  return typeof value === 'string' && value !== UNKNOWN_VALUE && value.length > 0;
}

/** A document's fact vector as extracted at Stage 3. */
export interface FactVector {
  married: string;
  childCountBand: string;
  hasMinorChildren: string;
  blendedFamily: string;
  specialNeedsBeneficiary: string;
  charitableBeneficiary: string;
  businessInterests: string;
  outOfStateRealProperty: string;
  trustStructures: string[];
  distributionStandard: string;
  fundedStatus: string;
  estateSizeBand: string;
}

/** Coerce untrusted extractor output to the vocabulary; off-vocab → unknown. */
export function sanitizeFactVector(raw: Record<string, unknown>): FactVector {
  const scalar = (fact: string): string => {
    const allowed = FACT_VALUES[fact] ?? [UNKNOWN_VALUE];
    const v = raw[fact];
    return typeof v === 'string' && (allowed as readonly string[]).includes(v)
      ? v
      : UNKNOWN_VALUE;
  };
  const structures = Array.isArray(raw.trustStructures)
    ? raw.trustStructures.filter((s): s is string => typeof s === 'string')
    : [];
  return {
    married: scalar('married'),
    childCountBand: scalar('childCountBand'),
    hasMinorChildren: scalar('hasMinorChildren'),
    blendedFamily: scalar('blendedFamily'),
    specialNeedsBeneficiary: scalar('specialNeedsBeneficiary'),
    charitableBeneficiary: scalar('charitableBeneficiary'),
    businessInterests: scalar('businessInterests'),
    outOfStateRealProperty: scalar('outOfStateRealProperty'),
    trustStructures: structures,
    distributionStandard: scalar('distributionStandard'),
    fundedStatus: scalar('fundedStatus'),
    estateSizeBand: scalar('estateSizeBand'),
  };
}
