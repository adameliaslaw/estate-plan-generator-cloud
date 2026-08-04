/**
 * §6.3 — the fill contract: mining placeholders (SCREAMING_SNAKE role/value
 * tokens) never reach the master template raw. This registry is the single
 * source of truth mapping every placeholder to one of:
 *   - an existing buildDocxTemplateData field (functions/src/docx-fidelity.ts
 *     — the verified flat camelCase contract; extensions go THERE, then here),
 *   - an intake-form field (src/facts-vocabulary.ts), or
 *   - 'attorney-supplied'.
 *
 * Canonicalization FAILS on any tag not in this registry (§6.3: no reliance
 * on nullGetter blanking at render time — fillDocxTemplate silently renders
 * '' for missing tags, verified).
 */

import { INTAKE_OBSERVABLE_FACTS } from './facts-vocabulary.js';

/** The verified flat contract of buildDocxTemplateData (docx-fidelity.ts:77-126). */
export const DOCX_TEMPLATE_FIELDS = [
  'clientFullName',
  'spouseFullName',
  'clientAddress',
  'clientCity',
  'clientCounty',
  'clientState',
  'clientZip',
  'clientDob',
  'maritalStatus',
  'executorName',
  'alternateExecutorName',
  'trusteeName',
  'alternateTrusteeName',
  'guardianName',
  'alternateGuardianName',
  'poaAgentName',
  'poaAlternateAgentName',
  'healthcareAgentName',
  'childCount',
  'childrenNames',
  'hasMinorChildren',
  'estimatedTotalAssets',
  'firmName',
  'attorneyName',
  'todayFormatted',
  'todayISO',
] as const;

export type DocxTemplateField = (typeof DOCX_TEMPLATE_FIELDS)[number];

export type PlaceholderKind =
  | 'party'
  | 'date'
  | 'amount'
  | 'percent'
  | 'duration'
  | 'fraction'
  | 'count'
  | 'age'
  | 'list'
  | 'chain'
  | 'xref'
  | 'jurisdiction'
  | 'redaction';

export type FillSource = 'clientContext' | 'intake' | 'attorney';

export interface PlaceholderRegistryEntry {
  kind: PlaceholderKind;
  fillSource: FillSource;
  /** Required for clientContext/intake; absent for attorney-supplied. */
  contractField?: string;
}

/**
 * Registry keyed by the placeholder BASE (ordinal suffixes fold:
 * {{TRUSTEE_2}} → TRUSTEE; {{XREF:Section 5.2}} → XREF).
 */
export const PLACEHOLDER_REGISTRY: Readonly<Record<string, PlaceholderRegistryEntry>> = {
  // --- party roles (gazetteer, §5.1) → ClientContext fields --------------
  GRANTOR_NAME: { kind: 'party', fillSource: 'clientContext', contractField: 'clientFullName' },
  GRANTOR: { kind: 'party', fillSource: 'clientContext', contractField: 'clientFullName' },
  SPOUSE_NAME: { kind: 'party', fillSource: 'clientContext', contractField: 'spouseFullName' },
  SPOUSE: { kind: 'party', fillSource: 'clientContext', contractField: 'spouseFullName' },
  TRUSTEE: { kind: 'party', fillSource: 'clientContext', contractField: 'trusteeName' },
  SUCCESSOR_TRUSTEE: {
    kind: 'party',
    fillSource: 'clientContext',
    contractField: 'alternateTrusteeName',
  },
  EXECUTOR: { kind: 'party', fillSource: 'clientContext', contractField: 'executorName' },
  GUARDIAN: { kind: 'party', fillSource: 'clientContext', contractField: 'guardianName' },
  AGENT: { kind: 'party', fillSource: 'clientContext', contractField: 'poaAgentName' },
  HEALTHCARE_AGENT: {
    kind: 'party',
    fillSource: 'clientContext',
    contractField: 'healthcareAgentName',
  },
  CHILD: { kind: 'party', fillSource: 'attorney' },
  CHILDREN_LIST: { kind: 'list', fillSource: 'clientContext', contractField: 'childrenNames' },
  CHILD_COUNT: { kind: 'count', fillSource: 'clientContext', contractField: 'childCount' },
  BENEFICIARY: { kind: 'party', fillSource: 'attorney' },
  WITNESS: { kind: 'party', fillSource: 'attorney' },
  NAME: { kind: 'party', fillSource: 'attorney' },
  // Run-level roster from STAGE=mine-misses: a client-specific name the
  // adjudicators attested to, with no per-doc role — the attorney supplies
  // the right party per matter. Unregistered, this tag failed 166 of 302
  // families' fill contracts on the first post-roster canonicalize.
  SUPPLEMENTAL_NAME: { kind: 'party', fillSource: 'attorney' },

  // --- typed values (§5.1(2)) -------------------------------------------
  DATE: { kind: 'date', fillSource: 'clientContext', contractField: 'todayFormatted' },
  AMOUNT: { kind: 'amount', fillSource: 'attorney' },
  PERCENT: { kind: 'percent', fillSource: 'attorney' },
  AGE: { kind: 'age', fillSource: 'attorney' },
  DURATION: { kind: 'duration', fillSource: 'attorney' },
  FRACTION: { kind: 'fraction', fillSource: 'attorney' },
  COUNT: { kind: 'count', fillSource: 'attorney' },
  COUNTY: { kind: 'jurisdiction', fillSource: 'clientContext', contractField: 'clientCounty' },
  STATE: { kind: 'jurisdiction', fillSource: 'clientContext', contractField: 'clientState' },
  ADDRESS: { kind: 'jurisdiction', fillSource: 'clientContext', contractField: 'clientAddress' },

  // --- structural -------------------------------------------------------
  SUCCESSOR_CHAIN: { kind: 'chain', fillSource: 'attorney' },
  CHAIN_DEPTH: { kind: 'count', fillSource: 'attorney' },
  XREF: { kind: 'xref', fillSource: 'attorney' },
  BLANK: { kind: 'redaction', fillSource: 'attorney' },
  REDACTED_SSN: { kind: 'redaction', fillSource: 'attorney' },
};

export class FillContractError extends Error {}

const TAG_RE = /\{\{([^{}]+)\}\}/g;

/** Placeholder base: strip ordinal suffix and XREF target. */
export function placeholderBase(tag: string): string {
  const inner = tag.replace(/^\{\{|\}\}$/g, '');
  if (inner.startsWith('XREF:')) return 'XREF';
  return inner.replace(/_\d+$/, '');
}

/** All placeholder tags occurring in a text, deduplicated in order. */
export function extractPlaceholders(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(TAG_RE)) {
    const tag = `{{${m[1]}}}`;
    if (!seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

export interface FillContractMapping {
  tag: string;
  kind: PlaceholderKind;
  fillSource: FillSource;
  contractField?: string;
}

/**
 * Build (and validate) the fill contract for a canonical text.
 * THROWS FillContractError on any unregistered tag — canonicalization must
 * fail loudly rather than let a tag reach nullGetter blanking (§6.3).
 *
 * `overrides` lets the canonicalization model refine a mapping (e.g. an
 * indexed semantic tag like spendthrift_distribution_age → intake field),
 * but an override may only reference registered contract targets.
 */
export function buildFillContract(
  canonicalText: string,
  overrides: ReadonlyMap<string, FillContractMapping> = new Map(),
): FillContractMapping[] {
  const out: FillContractMapping[] = [];
  for (const tag of extractPlaceholders(canonicalText)) {
    const override = overrides.get(tag);
    if (override !== undefined) {
      validateMappingTarget(tag, override);
      out.push({ ...override, tag });
      continue;
    }
    const base = placeholderBase(tag);
    const entry = PLACEHOLDER_REGISTRY[base];
    if (entry === undefined) {
      throw new FillContractError(
        `Unregistered placeholder ${tag} (base ${base}) — register it in ` +
          `src/fill-contract.ts (and extend buildDocxTemplateData if clientContext-filled)`,
      );
    }
    out.push({
      tag,
      kind: entry.kind,
      fillSource: entry.fillSource,
      ...(entry.contractField !== undefined ? { contractField: entry.contractField } : {}),
    });
  }
  return out;
}

function validateMappingTarget(tag: string, mapping: FillContractMapping): void {
  if (mapping.fillSource === 'clientContext') {
    if (!(DOCX_TEMPLATE_FIELDS as readonly string[]).includes(mapping.contractField ?? '')) {
      throw new FillContractError(
        `${tag}: clientContext mapping targets unknown buildDocxTemplateData field ` +
          `'${mapping.contractField ?? ''}'`,
      );
    }
  } else if (mapping.fillSource === 'intake') {
    if (!(INTAKE_OBSERVABLE_FACTS as readonly string[]).includes(mapping.contractField ?? '')) {
      throw new FillContractError(
        `${tag}: intake mapping targets unknown fact '${mapping.contractField ?? ''}'`,
      );
    }
  }
  // attorney-supplied needs no target.
}
