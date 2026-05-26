/**
 * src/data/matter-comparables.ts
 *
 * Market-comparable flat fees and traditional time estimates for common NJ
 * estate-planning matter types. Used by the Value Billing Calculator to
 * suggest a flat fee from actual AI-assisted hours logged.
 *
 * Sources: NJSBA Family/Estate Section rate surveys, public-record firm fee
 * schedules, ABA solo practice benchmarks (2024–2025). Update as market
 * shifts.
 */

export interface MatterComparable {
  id: string;
  label: string;
  /** Median NJ flat fee, USD */
  flatFee: number;
  /** Typical hours required without AI assistance */
  traditionalHours: number;
}

export const MATTER_COMPARABLES: MatterComparable[] = [
  { id: 'simple_will',         label: 'Simple Will',                                       flatFee: 400,  traditionalHours: 3  },
  { id: 'poa_only',            label: 'Powers of Attorney only',                           flatFee: 300,  traditionalHours: 2  },
  { id: 'basic_estate_plan',   label: 'Basic Estate Plan (Will + POA + Healthcare)',       flatFee: 1500, traditionalHours: 8  },
  { id: 'revocable_trust_pkg', label: 'Revocable Living Trust package (full)',             flatFee: 3500, traditionalHours: 18 },
  { id: 'special_needs_trust', label: 'Special Needs Trust',                               flatFee: 3000, traditionalHours: 15 },
  { id: 'irrevocable_trust',   label: 'Irrevocable Trust (ILIT, GRAT, QPRT, etc.)',        flatFee: 4500, traditionalHours: 20 },
  { id: 'probate_simple',      label: 'Probate — uncontested',                             flatFee: 4500, traditionalHours: 25 },
  { id: 'estate_tax_706',      label: 'Estate Tax Return (Form 706)',                      flatFee: 5000, traditionalHours: 30 },
  { id: 'medicaid_planning',   label: 'Medicaid Planning + MAPT',                          flatFee: 6000, traditionalHours: 35 },
  { id: 'real_estate_deed',    label: 'Real Estate Deed Transfer',                         flatFee: 750,  traditionalHours: 4  },
  { id: 'business_succession', label: 'Business Succession Plan',                          flatFee: 7500, traditionalHours: 40 },
];

export interface AiToolSavings {
  id: string;
  label: string;
  description: string;
  /** Hours typically saved per matter when this tool is used */
  hoursSaved: number;
}

export const AI_TOOLS: AiToolSavings[] = [
  { id: 'doc_gen',     label: 'Document Generator',  description: 'Hybrid AI + template drafting', hoursSaved: 4.0 },
  { id: 'research',    label: 'Research Chat',       description: 'PageIndex RAG over your KB',     hoursSaved: 1.5 },
  { id: 'citation',    label: 'Citation Verifier',   description: 'CourtListener pre-flight check', hoursSaved: 0.5 },
  { id: 'brief',       label: 'Brief Analyzer',      description: 'Opposition prep + verification', hoursSaved: 1.5 },
  { id: 'review',      label: 'Document Review',     description: 'AI grounded compliance check',   hoursSaved: 1.0 },
  { id: 'automations', label: 'Follow-Up Engine',    description: 'Auto-chase outstanding items',   hoursSaved: 0.5 },
];
