// ─── Primitives ──────────────────────────────────────────────────────────────

export type ISODate = string;     // "YYYY-MM-DD"
export type ISODateTime = string; // "YYYY-MM-DDTHH:mm:ss.sssZ"

export type NJCounty =
  | 'Atlantic' | 'Bergen' | 'Burlington' | 'Camden' | 'Cape May'
  | 'Cumberland' | 'Essex' | 'Gloucester' | 'Hudson' | 'Hunterdon'
  | 'Mercer' | 'Middlesex' | 'Monmouth' | 'Morris' | 'Ocean'
  | 'Passaic' | 'Salem' | 'Somerset' | 'Sussex' | 'Union' | 'Warren';

// ─── Beneficiary relationship → tax class ────────────────────────────────────

/**
 * Relationship to the decedent — drives tax-class assignment per N.J.S.A. 54:34-2.
 * Verified against official IT-R Instructions (nj.gov/treasury/taxation/pdf/other_forms/inheritance/it-rinst.pdf).
 *
 * Verified against N.J.A.C. 18:26-1.1 (recodified from 18:26-2.1 in the 2018 readoption,
 * 50 N.J.R. 1624(a), eff. 7/16/2018). Two additional Class D relationships identified
 * and added: stepchild_in_law and mutually_acknowledged_child_in_law.
 */
export type Relationship =
  // ── Class A (exempt) ── N.J.S.A. 54:34-2; IT-R Instructions "Beneficiary Tax Classes"
  | 'spouse'
  | 'civil_union_partner'              // after Feb 19 2007
  | 'domestic_partner'                 // after Jul 10 2004
  | 'child'                            // biological, legally adopted, or ART-conceived child (ART expressly confirmed as Class A by R.2025 d.152, eff. Dec 15 2025)
  | 'stepchild'                        // step-grandchild is Class D
  | 'grandchild'                       // grandchild and lineal descendants
  | 'great_grandchild'
  | 'parent'
  | 'grandparent'
  | 'mutually_acknowledged_child'
  // ── Class C ── $25,000 exemption; 11%–16% on excess
  | 'sibling'                          // includes half-siblings
  | 'child_in_law'                     // son-in-law/daughter-in-law of biological/adopted child only (NOT stepchild — see stepchild_in_law below)
  | 'child_civil_union_partner'        // civil union partner/surviving CU partner of decedent's child (after Feb 19 2007)
  // ── Class D ── 15%–16%; no per-beneficiary exemption; $499 de minimis
  | 'niece_nephew'
  | 'aunt_uncle'
  | 'cousin'
  | 'step_grandchild'                  // step-grandchild and their descendants
  | 'stepbrother_stepsister'
  | 'stepparent'
  | 'stepchild_in_law'                 // spouse/CU/DP of a stepchild — Class D (NOT Class C); N.J.A.C. 18:26-1.1
  | 'mutually_acknowledged_child_in_law' // spouse/CU/DP of a mutually acknowledged child — Class D; N.J.A.C. 18:26-1.1
  | 'ex_spouse'
  | 'friend'
  | 'non_certified_domestic_partner'   // live-in partner who is NOT a certified domestic partner
  | 'corporation_non_charitable'
  | 'other_individual'
  // ── Class E (exempt) ──
  | 'charity'                          // 501(c)(3) and qualified charities
  | 'religious_organization'
  | 'educational_organization'
  | 'medical_institution'
  | 'governmental_entity';             // State of NJ or its political subdivisions

/** NJ Transfer Inheritance Tax beneficiary class. */
export type TaxClass = 'A' | 'C' | 'D' | 'E';

// ─── Decedent ─────────────────────────────────────────────────────────────────

export interface Decedent {
  lastName: string;
  firstName: string;
  middleName?: string;
  aka?: string;
  /** Stored; masked in audit logs. */
  ssn: string;
  /** Drives applicable rule set — the entire computation is parameterized by this date. */
  dateOfDeath: ISODate;
  /**
   * County of residence at the time of death.
   * For nonresident decedents (isNJResident: false): use the NJ county most closely
   * associated with the NJ property (e.g., where NJ real property is located).
   */
  countyOfResidence: NJCounty;
  /**
   * Whether the decedent was domiciled in NJ at the time of death.
   * Defaults to true (NJ resident) when absent.
   * For nonresident decedents (false): NJ Transfer Inheritance Tax applies ONLY to
   * (1) NJ real property and (2) tangible personal property located in NJ per
   * N.J.A.C. 18:26-2.15. Intangible property (bank accounts, securities, bonds,
   * retirement accounts) is generally NOT subject to NJ inheritance tax for nonresidents.
   * Attorney must verify that all Matter schedules contain only NJ-situs property.
   */
  isNJResident?: boolean;
}

// ─── Bequests ─────────────────────────────────────────────────────────────────

/**
 * Maps to IT-R schedules.
 * Verified against IT-R (12-24) form and instructions (itrbk.pdf, it-rinst.pdf).
 * Note: B-1 covers savings/checking/CDs/IRAs/mutual funds/brokerage accounts.
 *       B-2 = Stocks/Co-ops. B-3 = Municipal and Corporate Bonds.
 *       B-4 = All Other Property (virtual currency, US Savings Bonds, autos, cash, etc.).
 *       All B-1 through B-4 totals roll up into Summary Page Line 3 via the B1-B4 Recap.
 */
export type BequestType =
  | 'nj_real_property'        // Schedule A — NJ real property
  | 'closely_held_business'   // Schedule B — closely held businesses
  | 'bank_account'            // Schedule B-1 — financial institution accounts (savings, checking, CDs, money market, credit union)
  | 'securities'              // Schedule B-2 — stocks and co-ops
  | 'bonds'                   // Schedule B-3 — municipal and corporate bonds (NOT US Savings Bonds — those are B-4)
  | 'retirement_account'      // Schedule B-1 — IRAs and qualified plan accounts held at financial institutions
  | 'virtual_currency'        // Schedule B-4 — convertible virtual currency (IT-R Cover Page Q5)
  | 'other_personal_property' // Schedule B-4 — all other property (US Savings Bonds, autos, tangible personal property, cash)
  | 'transfer';               // Schedule C — transfers (lifetime within 3 years, incomplete, payable-on-death)

/**
 * Schedule B-1, whose column (A) asks for "Name of Institution, Last Four Digits of Account
 * Number, and Registered Owners" — three facts a free-text description cannot be relied on to
 * carry in the order the State prints them.
 */
export interface AccountDetails {
  institutionName: string;
  /**
   * Last four digits only. The schedule asks for no more than that, so no more is stored:
   * a full account number on a legal record is a liability with no offsetting use.
   */
  accountNumberLast4?: string;
  /** "the names of all registered owner(s) and named beneficiaries on the account". */
  registeredOwners?: string;
}

/**
 * Schedule B-2 columns (A) through (E). (F) Total Market Value and (G) Decedent's Equity are the
 * value the model already holds, so they are not repeated here.
 */
export interface SecurityDetails {
  /** Column (A) — "Name of Corporation/Registered Owner(s)". */
  corporationName: string;
  tickerSymbol?: string;
  /** Column (C) — the printed "Check Box if NJ". */
  isNJCorporation?: boolean;
  numberOfShares?: number;
  /** Column (E) — per-share value on the date of death. */
  perShareValue?: number;
  /**
   * Schedule B-2 Part II is "Co-ops", a separate block with its own columns — the registered
   * owner's name and address instead of a ticker and per-share value. Shares in a co-op belong
   * there, not in the stock table above it.
   */
  isCoOp?: boolean;
  /** Part II column (B) — "Registered Owner and Address of Co-op". */
  registeredOwners?: string;
}

/**
 * Schedule A column (A) — the block the State heads "Description of New Jersey Real Estate
 * (All fields required)". Every field it names has its own printed line, so each is captured
 * separately rather than being carved out of a description later.
 *
 * Only the county is required here. The rest are optional so a property entered before this
 * existed still validates and still prints its value; the form is delivered with live fields for
 * exactly that reason, and the attorney completes what intake did not capture before filing.
 */
export interface RealPropertyDetails {
  county: string;
  /** "Fractional or percent interest" — free text, because the form takes "1/2" or "50%". */
  fractionalInterest?: string;
  streetAddress?: string;
  lots?: string;
  block?: string;
  municipality?: string;
  ownersAndTitle?: string;
  /** "Check if there is a mortgage lien against this property reported on Schedule D." */
  hasMortgageLien?: boolean;
  /** Column (B) — tax assessed value for the year of death, for the entire property. */
  taxAssessedValue?: number;
  /** Column (C) — full market value at date of death, for the entire property. */
  fullMarketValue?: number;
}

/**
 * Schedule B column (A) — "Business Information". Column (B) is the market value of the entire
 * business; the decedent's share, column (C), is the bequest's own value.
 */
export interface BusinessDetails {
  businessName: string;
  federalEIN?: string;
  businessType?: string;
  /** The form asks outright: "Is this a Family Limited Partnership?" */
  isFamilyLimitedPartnership?: boolean;
  /** Free text — the form's line is "Decedent's percentage of ownership". */
  ownershipPercentage?: string;
  numberOfShares?: number;
  /** Column (B) — market value at date of death of the entire business. */
  entireBusinessValue?: number;
}

/** Schedule B-3 column (A) — "Name of Bond and Registered Owner", including the bond's terms. */
export interface BondDetails {
  issuerAndTerms: string;
  registeredOwners?: string;
}

/**
 * Which part of Schedule C a transfer is reported in. The parts total separately on the form and
 * each answers a different printed question, so this is the transfer's legal character, not a
 * presentation choice:
 *
 *   - `lifetime_within_3_years` — Part I, a transfer within 3 years of death for less than full
 *     consideration (the form's question 1);
 *   - `incomplete` — Part II, transferred while reserving the use, possession, enjoyment of, or
 *     income from the property (question 2);
 *   - `pod_to_beneficiary` / `pod_to_estate` — Part III Sections A and B, a plan, annuity,
 *     contract or policy payable on death to a named beneficiary or to the estate (question 3).
 */
export type TransferPart =
  | 'lifetime_within_3_years'
  | 'incomplete'
  | 'pod_to_beneficiary'
  | 'pod_to_estate';

/** Schedule C columns (A), (C) and (D), plus which Part the transfer belongs to. */
export interface TransferDetails {
  /** Defaults to Part I when absent, which is the schedule's ordinary case. */
  part?: TransferPart;
  /** ISO date. Part I/II column (A), "Date of Transfer". Not asked for in Part III. */
  dateOfTransfer?: string;
  /** Column (C) — "Name of Transferee", or in Part III "Name of Beneficiary". */
  transfereeName: string;
  /** Part III column (B) — "Name of Company Issuing Policy and Policy Number". */
  issuerName?: string;
  /** Column (D) — relationship of that person to the decedent. */
  transfereeRelationship?: string;
}

export interface Bequest {
  id: string;
  type: BequestType;
  description: string;
  /** Fair market value at date of death. */
  fairMarketValue: number;
  /**
   * Columns the official schedule asks for that a description cannot answer. Each is optional
   * and belongs to one schedule; a bequest carrying none prints exactly as it did before, with
   * the description in column (A) — the same fallback `addressParts` uses.
   */
  realPropertyDetails?: RealPropertyDetails;  // Schedule A
  businessDetails?: BusinessDetails;          // Schedule B
  accountDetails?: AccountDetails;            // Schedule B-1
  securityDetails?: SecurityDetails;          // Schedule B-2
  bondDetails?: BondDetails;                  // Schedule B-3
  transferDetails?: TransferDetails;          // Schedule C
}

// ─── Addresses ────────────────────────────────────────────────────────────────

/**
 * An address already broken into the parts the official forms ask for.
 *
 * The IT-R gives Street / City / State / ZIP their own boxes, and a free-text string cannot be
 * split back into them reliably — "c/o The Firm, Suite 4, Newark, NJ 07102" and
 * "1 Main St, Trenton, NJ 08600" do not share a shape. So the parts are captured at intake
 * (Google Places returns them pre-split) and carried through rather than parsed later.
 *
 * Optional everywhere it appears: matters created before this existed carry only the string,
 * and their frozen snapshots must keep rendering unchanged (FND-IMMUT). Consumers prefer the
 * parts when present and fall back to the string.
 */
export interface AddressParts {
  street1: string;
  /** Suite, floor, "c/o" line — whatever does not belong on the first line. */
  street2?: string;
  city: string;
  /** Two-letter USPS abbreviation. */
  state: string;
  zip: string;
}

// ─── Beneficiary ──────────────────────────────────────────────────────────────

export interface Beneficiary {
  id: string;
  lastName: string;
  firstName: string;
  address: string;
  /** Structured form of `address`, when intake captured it. See {@link AddressParts}. */
  addressParts?: AddressParts;
  relationship: Relationship;
  /** If set, overrides the computed tax class. Requires written reason + attorney. */
  taxClassOverride?: {
    taxClass: TaxClass;
    reason: string;
    overriddenBy: string; // attorney bar ID
    overriddenAt: ISODateTime;
  };
  bequests: Bequest[];
}

// ─── Deductions ───────────────────────────────────────────────────────────────

/**
 * Allowable deductions per N.J.A.C. 18:26-7.
 * Verified against N.J.A.C. 18:26-7 subchapter (NJ State Library PDF).
 * Federal estate tax is expressly NOT deductible (N.J.A.C. 18:26-7.16(b)).
 */
export type DeductionType =
  | 'funeral_expenses'          // N.J.A.C. 18:26-7.8: funeral costs
  | 'last_illness_expenses'     // N.J.A.C. 18:26-7.8: medical/nursing/hospital costs unpaid at death
  | 'administration_expenses'   // N.J.A.C. 18:26-7.1: general administration
  | 'debt_of_decedent'          // N.J.A.C. 18:26-7.1: debts/claims against estate
  | 'mortgage'                  // N.J.A.C. 18:26-7.4: mortgage balance on securing property
  | 'executor_commission'       // N.J.A.C. 18:26-7.10: 5%/3.5%/2% tiered schedule. RESTRICTION (R.2025 d.152, eff. Dec 15 2025): no deduction for executor commission on real estate transferred to a specifically devised beneficiary — attorney must confirm eligibility.
  | 'attorney_fee'              // N.J.A.C. 18:26-7.11: reasonable counsel fees
  | 'accounting_fee'            // subsumed in administration expenses (18:26-7.1)
  | 'accrued_property_taxes'    // N.J.A.C. 18:26-7.15: unpaid state/county/local taxes on NJ realty at death
  /**
   * N.J.A.C. 18:26-7.16: inheritance/succession/legacy taxes paid to other US states,
   * territories, D.C., or foreign countries.
   * ELIGIBILITY CONDITION: deductible ONLY when the property taxed by the other
   * jurisdiction is ALSO subject to NJ Transfer Inheritance Tax (N.J.A.C. 18:26-7.16).
   * Requires a TransferTaxEligibility attestation — validated by validateMatter().
   */
  | 'transfer_taxes_other_states'
  | 'other';                    // residual — document with description

/**
 * Required when deduction type is 'executor_commission'.
 * N.J.A.C. 18:26-7.10(d) (R.2025 d.152, eff. Dec 15 2025): executor commission
 * is allowable ONLY when (1) the real estate sold was residue property (NOT
 * specifically devised to a named beneficiary), AND (2) the executor/representative
 * made the sale on behalf of the estate (not the beneficiary).
 */
export interface ExecutorCommissionEligibility {
  /** Attorney attests the real estate sold was residue, not specifically devised. */
  propertyWasResidueNotSpecificallyDevised: boolean;
  /** Attorney attests the executor/representative (not the beneficiary) made the sale. */
  propertyWasSoldByExecutor: boolean;
  /** Attorney notes documenting the factual basis for the deduction. */
  notes: string;
}

/**
 * Required when deduction type is 'transfer_taxes_other_states'.
 * N.J.A.C. 18:26-7.16: the tax paid to another jurisdiction is deductible ONLY
 * when the property taxed by that jurisdiction is ALSO subject to NJ Transfer
 * Inheritance Tax. Attorney must attest eligibility and identify the jurisdiction.
 */
export interface TransferTaxEligibility {
  /** Attorney attests the property taxed by the other jurisdiction is also subject to NJ Transfer Inheritance Tax. */
  taxedPropertyIsAlsoNJTaxable: boolean;
  /** The other taxing jurisdiction (e.g., 'New York', 'Pennsylvania', 'United Kingdom'). */
  taxingJurisdiction: string;
  /** Attorney notes documenting the factual basis. */
  notes: string;
}

export interface Deduction {
  id: string;
  type: DeductionType;
  description: string;
  amount: number;
  /**
   * Column (B) of Schedule D — "Name of Business/Person Paid" (Parts I and III) or "Owed"
   * (Part II). Optional: matters entered before this field existed carry no payee, and the
   * schedule prints the row with that column blank rather than refusing to render.
   */
  payeeName?: string;
  /**
   * Required when type is 'executor_commission'.
   * Attorney must complete this to attest eligibility under N.J.A.C. 18:26-7.10(d).
   * Validated by validateMatter() — omitting it on an executor_commission deduction
   * for dateOfDeath >= 2025-12-15 is a validation error.
   */
  executorCommissionEligibility?: ExecutorCommissionEligibility;
  /**
   * Required when type is 'transfer_taxes_other_states'.
   * Attorney must attest eligibility under N.J.A.C. 18:26-7.16.
   * Validated by validateMatter() — omitting it is a validation error.
   */
  transferTaxEligibility?: TransferTaxEligibility;
}

// ─── Prior payments ─────────────────────────────────────────────────────────

/**
 * A single payment previously made to the NJ Division of Taxation before this
 * return is filed (IT-R Line 20, "Payments made prior to filing return").
 *
 * Estates frequently pay in installments. Recording each payment with its date
 * lets the engine reconcile Line 18 interest per period: interest accrues on the
 * unpaid tax balance, and each payment reduces that balance going forward
 * (N.J.S.A. 54:35-3 — 10% per annum on the unpaid tax). A payment dated on or
 * before the 8-month payment deadline reduces the principal before any interest
 * accrues; a payment between the deadline and the final payment date reduces the
 * balance for all subsequent periods.
 */
export interface PriorPayment {
  /** Stable identifier, unique within a matter's payment list. */
  id: string;
  /** Payment amount in dollars. Must be > 0. */
  amount: number;
  /**
   * Date the payment was made (YYYY-MM-DD). Required when a matter supplies the
   * dated array form. Omitted (date unknown) when a legacy scalar `priorPayments`
   * total is coerced — we never fabricate a date the attorney did not provide.
   * An undated payment counts toward the Line 20 total but does not reduce interim
   * Line 18 interest (it is treated as paid at the end of the late window).
   */
  paidOn?: ISODate;
}

// ─── Matter ───────────────────────────────────────────────────────────────────

/** A single estate matter — the top-level unit of work. */
export interface Matter {
  matterId: string;
  /**
   * Server-bound owner identity: the NJ bar ID of the attorney who created the matter
   * via POST /matters. Stamped by the API from the authenticated identity — any
   * client-supplied value is overwritten (audit #43). The read/compute/forms/audit
   * routes reject other authenticated identities with 403.
   * Optional so matters created before ownership binding and store-injected fixtures
   * keep validating; absent = unowned/legacy (interim state — see audit #43).
   */
  ownerBarId?: string;
  /**
   * FND-AUTHZ (Phase 3): the firm that owns this matter, stamped by the API from the
   * creating attorney's firm (token-derived) on POST /matters. Review/approve are
   * restricted to attorneys of this firm. Optional so matters created before firm scoping
   * (or store-injected fixtures) keep validating; absent = unscoped/legacy (interim).
   */
  firmId?: string;
  createdAt: ISODateTime;
  decedent: Decedent;
  willExists: boolean;
  trustExists: boolean;
  /** Form 1040 filed for the full year prior to death? (IT-R cover question) */
  federalReturnFiled: boolean;
  virtualCurrencyExists: boolean;
  disclaimersExist: boolean;
  personalRepresentative: {
    name: string;
    title: 'Executor' | 'Administrator' | 'Heir-at-law';
    address: string;
    /** Structured form of `address`, when intake captured it. See {@link AddressParts}. */
    addressParts?: AddressParts;
    phone: string;
    email?: string;
  };
  beneficiaries: Beneficiary[];
  deductions: Deduction[];
  /**
   * Structured disclaimer records. When present and non-empty, disclaimersExist must also
   * be true. Each record cross-references a beneficiary and their bequests.
   * Authority: N.J.A.C. 18:26-2.11.
   */
  disclaimers?: Disclaimer[];
  /**
   * IT-R Line 8 — contingent, unliquidated, or disputed amounts already included
   * in the gross estate (Line 7) that cannot yet be determined with certainty.
   * Line 9 (Balance of Estate) = Line 7 minus Line 8.
   * Verified: IT-R (12-24) Summary Page, line labels verbatim from itrbk.pdf.
   * Defaults to 0 if omitted. Must be ≥ 0.
   */
  contingentAmounts?: number;
  /**
   * IT-R Line 15 — compromise tax provisionally assessed on the Line 8 contingent
   * amount. No interest accrues on this amount per the IT-R instructions.
   * Attorney-determined; engine cannot compute without knowing the contingent
   * beneficiaries' tax class. Defaults to 0 if omitted. Must be ≥ 0.
   */
  compromiseTax?: number;
  /**
   * IT-R Line 16 — contingent tax on amounts that become part of the estate
   * after the date of death. Attorney-determined. Defaults to 0 if omitted. Must be ≥ 0.
   */
  contingentTax?: number;
  /**
   * IT-R Line 18 — interest due on late payment.
   * Authority: N.J.S.A. 54:35-3 (10% per annum on total tax from 8-month due date).
   * No interest accrues on compromise tax (Line 15) per IT-R Instructions.
   * When paymentDate is provided, the engine auto-computes this field from
   * (totalTaxDue + contingentTax) × 10% per annum × daysLate/365; manual
   * interestDue is ignored in that case. If paymentDate is absent, this
   * attorney-provided field is used directly. Defaults to 0. Must be ≥ 0.
   * Attorney must verify: if prior partial payments were made before paymentDate,
   * interest accrues only on the unpaid balance — adjust interestDue manually in that case.
   */
  interestDue?: number;
  /**
   * Actual or expected date of tax payment. When provided, the engine auto-computes
   * Line 18 interest at 10% per annum (N.J.S.A. 54:35-3) on (totalTaxDue + contingentTax)
   * for the number of days paymentDate exceeds the original 8-month payment deadline.
   * If paymentDate ≤ filingDeadline, interest computes to $0.
   * Providing paymentDate overrides any manually set interestDue.
   */
  paymentDate?: ISODate;
  /**
   * IT-R Line 20 — payments previously made to the NJ Division of Taxation prior
   * to filing this return. Verified: IT-R (12-24) Line 20 label verbatim:
   * "Payments made prior to filing return."
   *
   * Each entry records an amount and the date it was paid so Line 18 interest can
   * be reconciled per period (see {@link PriorPayment}). Line 20 is the sum of all
   * entries. Defaults to no payments if omitted.
   *
   * Backward compatibility: validateMatter() also accepts a legacy scalar
   * (`priorPayments: <number>`) and coerces it to a single dateless payment so
   * existing matter JSON keeps validating. New matters should supply the array.
   */
  priorPayments?: PriorPayment[];
  notes?: string;
  /**
   * IT-EXT filing extension (N.J.A.C. 18:26-9.1(b)).
   * Extends the FILING deadline only — tax payment remains due within the original 8 months.
   * First extension: +4 months from original deadline.
   * Second extension (requires firstExtension): +2 additional months (total +6 months).
   * Further extensions require Director approval for exceptional circumstances.
   */
  itExtension?: ITExtension;
}

/**
 * IT-EXT filing extension election (N.J.A.C. 18:26-9.1(b)). Extends the FILING
 * deadline only — the tax payment remains due within the original 8 months.
 * First extension: +4 months. Second (requires first): +2 more (total +6).
 */
export interface ITExtension {
  firstExtension: boolean;
  secondExtension?: boolean;
  /** Attorney-stated reason for the extension, printed on the IT-EXT form. */
  reason?: string;
}

// ─── Tax rule structures (populated by versioned rule sets) ──────────────────

export interface TaxBracket {
  /** Cumulative transfer amount at which this rate begins (0-indexed from taxable base). */
  from: number;
  /** Upper bound (exclusive). null = no ceiling. */
  to: number | null;
  rate: number; // 0.0 – 1.0
}

export interface ClassCRules {
  exempt: false;
    /**
   * Per-beneficiary exemption before any tax applies.
   * Verified: $25,000 per IT-R Instructions (N.J.S.A. 54:34-2 / N.J.A.C. 18:26-3).
   * Brackets below are applied to the amount ABOVE this exemption.
   */
  exemptionPerBeneficiary: number;
  brackets: TaxBracket[]; // applied on amount above exemption
}

export interface ClassDRules {
  exempt: false;
  /**
   * If an individual Class D beneficiary receives strictly less than this amount,
   * no tax is due. If the bequest is at or above this threshold, the FULL amount
   * is taxable (the threshold is not subtracted).
   * Source: IT-R Instructions — "if an individual beneficiary is receiving less than
   * $500 ($0-$499), there is no tax due on that amount."
   */
  deMinimusThreshold: number; // 499 per IT-R Instructions
  brackets: TaxBracket[];
}

export interface ExemptClassRules {
  exempt: true;
}

export interface InheritanceTaxRules {
  classA: ExemptClassRules;
  classC: ClassCRules;
  classD: ClassDRules;
  classE: ExemptClassRules;
}

// ─── Computation results ──────────────────────────────────────────────────────

/** One line in a Schedule A, B, B-1, B-2, B-4, or C asset listing. */
export interface ScheduleItem {
  id: string;
  /** "First Last" from the Matter beneficiary record. */
  beneficiaryName: string;
  description: string;
  fairMarketValue: number;
  /**
   * The bequest's schedule-specific columns, frozen with the rest of the snapshot (FND-IMMUT).
   * Absent on items entered before the fields existed, and on schedules that ask for nothing
   * beyond a description.
   */
  realPropertyDetails?: RealPropertyDetails;
  businessDetails?: BusinessDetails;
  accountDetails?: AccountDetails;
  securityDetails?: SecurityDetails;
  bondDetails?: BondDetails;
  transferDetails?: TransferDetails;
}

/**
 * One disclaimer record — identifies who disclaimed what and when.
 * Authority: N.J.A.C. 18:26-2.11.
 * // VERIFY: NJ-specific deadline for qualified disclaimers
 * (federal qualified disclaimer: 9 months from date of transfer per I.R.C. § 2518).
 */
export interface Disclaimer {
  id: string;
  /** Beneficiary ID of the person who executed the disclaimer. */
  disclaimantBeneficiaryId: string;
  /**
   * Beneficiary ID of the person who takes the disclaimed property.
   * Must differ from disclaimantBeneficiaryId. Required so the engine can
   * reallocate the disclaimed bequests to the correct tax class (N.J.A.C. 18:26-2.11).
   */
  alternativeTakerId: string;
  /** IDs of the bequests on that beneficiary that are being disclaimed. Must be non-empty. */
  bequestIds: string[];
  /** Date the disclaimer was executed. Must be on or after decedent.dateOfDeath. */
  dateDisclaimed: ISODate;
  /** Attorney notes, e.g., documenting deadline verification (N.J.A.C. 18:26-2.11). */
  notes: string;
}

/** One row of the supplemental disclaimer log rendered alongside the IT-R. */
export interface DisclaimerScheduleItem {
  id: string;
  disclaimantName: string;
  bequestDescriptions: string[];
  dateDisclaimed: ISODate;
  notes: string;
}

/** One line in Schedule D (Allowable Deductions — N.J.A.C. 18:26-7). */
export interface ScheduleDeductionItem {
  id: string;
  type: DeductionType;
  description: string;
  amount: number;
  /** Schedule D column (B) — "Name of Business/Person Paid". Absent on older matters. */
  payeeName?: string;
  executorCommissionEligibility?: ExecutorCommissionEligibility;
  transferTaxEligibility?: TransferTaxEligibility;
}

/**
 * One row of Schedule E Part I — "Beneficiary and address of each person who has an interest
 * (vested, contingent, or otherwise) in this Estate". Every beneficiary appears, exempt classes
 * included, because the schedule lists interests rather than taxable ones.
 */
export interface ScheduleEBeneficiaryRow {
  name: string;
  address: string;
  addressParts?: AddressParts;
  relationship: Relationship;
  /** Column (C), which the form offers as a dropdown of exactly A / C / D / E. */
  taxClass: TaxClass;
  /**
   * Column (E) "Dollar Amount". This is `scaledBequeathed`, the same figure that feeds the
   * Summary Page's Total Distribution columns (lines 10–14) — so the schedule reconciles to the
   * summary rather than contradicting it by a deduction's worth.
   */
  dollarAmount: number;
}

/** One row in the Class C or D per-beneficiary worksheet. */
export interface BeneficiaryWorksheetRow {
  beneficiaryId: string;
  lastName: string;
  firstName: string;
  address: string;
  /** Structured form of `address`, when intake captured it. See {@link AddressParts}. */
  addressParts?: AddressParts;
  relationship: Relationship;
  result: BeneficiaryTaxResult;
}

export interface BeneficiaryTaxResult {
  beneficiaryId: string;
  taxClass: TaxClass;
  /** Gross FMV of all bequests as entered by the attorney. */
  totalBequeathed: number;
  /**
   * Proportional share of the IT-R Line 9 balance of estate.
   * Equals totalBequeathed × (balanceOfEstate / grossEstate).
   * When there are no deductions and no contingent amounts, scaledBequeathed = totalBequeathed.
   * Tax brackets are applied to scaledBequeathed (not totalBequeathed), consistent with
   * IT-R (12-24) Summary Page structure and N.J.A.C. 18:26-1.1 "clear market value" definition.
   */
  scaledBequeathed: number;
  exemption: number;    // applied against scaledBequeathed
  taxableAmount: number; // scaledBequeathed minus exemption
  taxDue: number;
  brackets: Array<{
    bracket: TaxBracket;
    amountInBracket: number;
    tax: number;
  }>;
  ruleSetId: string;
}

// ─── NJ Estate Tax (separate from the Transfer Inheritance Tax) ───────────────

/**
 * NJ Estate Tax computation for a pre-2018 death (N.J.S.A. 54:38-1). Repealed for
 * deaths on/after 2018-01-01. Two regimes:
 *
 *  - 2002-2016: filing threshold $675,000 (gross estate + adjusted taxable gifts).
 *    The Simplified Method (Form IT-Estate, Column A) is fully computable: the tax is
 *    a graduated schedule applied to (taxable estate − $60,000). Primary source: the
 *    official Form IT-Estate "Worksheet For New Jersey Simplified Form — Column A —
 *    Line 10(a)" tax table (nj.gov/treasury/taxation/pdf/other_forms/inheritance/itestate.pdf).
 *
 *  - 2017: filing threshold $2,000,000. The State requires its official calculator,
 *    which performs a circular computation applying the IRC §2058 State Death Tax
 *    Deduction to the taxable estate. We do NOT fabricate a rate schedule for this
 *    regime — taxDue is null and the attorney is directed to NJ's 2017 calculator.
 */
export interface NJEstateTaxComputation {
  /** Estate-tax regime governing the date of death. */
  regime: '2002-2016' | '2017';
  /** Computation method actually used. */
  method: 'simplified_column_a' | 'requires_official_2017_calculator';
  /** Filing threshold: gross estate + adjusted taxable gifts above this requires a return. */
  exemptionThreshold: number;
  /** Net taxable estate (IT-R Line 7: gross estate − deductions). */
  taxableEstate: number;
  /**
   * True when a NJ Estate Tax return must be filed. Based on gross estate exceeding the
   * threshold; adjusted taxable gifts are not tracked by this tool and may raise it further.
   */
  filingRequired: boolean;
  /**
   * NJ Estate Tax filing AND payment deadline: 9 months from date of death (distinct from
   * the 8-month inheritance-tax deadline), shifted past weekends/NJ holidays.
   */
  filingDeadline: ISODate;
  /**
   * Computed NJ Estate Tax. null for the 2017 regime, which must be computed with NJ's
   * official §2058 circular calculator — no rate schedule is fabricated for it.
   */
  taxDue: number | null;
  /** $60,000 statutory reduction before the Simplified Method table. Present for 2002-2016. */
  exemptionAmount?: number;
  /** taxableEstate − exemptionAmount: the Simplified Method table input. Present for 2002-2016. */
  adjustedTaxableEstate?: number;
  /** Primary-source citation for the computation. */
  citation: string;
  /** Plain-language guidance (e.g., directing the attorney to NJ's 2017 calculator). */
  note: string;
}

/**
 * FND-IMMUT (docs/IT-R-SPECIFICATION.md §10): everything the IT-R form needs from the
 * Matter, captured (frozen) at compute time so an approved return renders ONLY from the
 * attorney-approved snapshot. Post-approval edits to the live Matter therefore cannot
 * change an approved form's cover page, schedules, class buckets, or worksheets — the
 * form no longer re-reads the Matter for any of these.
 *
 * Optional on EstateComputation for backward compatibility: legacy snapshots produced
 * before enrichment lack it, and the form falls back to the live Matter for those
 * (clearly marked in buildITRFormData).
 */
export interface ITRFormSnapshot {
  decedent: {
    lastName: string;
    firstName: string;
    middleName?: string;
    aka?: string;
    ssn: string;
    dateOfDeath: ISODate;
    countyOfResidence: NJCounty;
    isNJResident: boolean;
  };
  willExists: boolean;
  trustExists: boolean;
  federalReturnFiled: boolean;
  virtualCurrencyExists: boolean;
  disclaimersExist: boolean;
  representative: Matter['personalRepresentative'];
  /**
   * Per-beneficiary identity used to split Class A Spouse (Line 10) vs. Other (Line 11)
   * and to build the Class C/D worksheets. Frozen so a post-approval relationship or
   * name edit cannot move a beneficiary between lines on an approved form.
   */
  beneficiaries: Array<{
    id: string;
    firstName: string;
    lastName: string;
    address: string;
    /** Structured form of `address`, frozen with the rest. See {@link AddressParts}. */
    addressParts?: AddressParts;
    relationship: Relationship;
    isSpouseOrCU: boolean;
  }>;
  scheduleA: ScheduleItem[];
  scheduleB: ScheduleItem[];
  scheduleB1: ScheduleItem[];
  scheduleB2: ScheduleItem[];
  scheduleB3: ScheduleItem[];
  scheduleB4: ScheduleItem[];
  scheduleC: ScheduleItem[];
  scheduleD: ScheduleDeductionItem[];
  disclaimerSchedule: DisclaimerScheduleItem[];
}

export interface EstateComputation {
  matterId: string;
  computedAt: ISODateTime;
  ruleSetId: string;
  grossEstate: number;     // sum of all bequests
  totalDeductions: number;
  netEstate: number;       // grossEstate - totalDeductions
  beneficiaryResults: BeneficiaryTaxResult[];
  totalTaxDue: number;
  /**
   * Attorney-provided Matter inputs captured at compute time.
   * These are frozen in the computation snapshot so that form generation
   * reads only from the attorney-approved snapshot — never from a mutable Matter.
   * Defaults to 0 for any field not set on the Matter at computation time.
   */
  matterInputs: {
    contingentAmounts: number;
    compromiseTax: number;
    contingentTax: number;
    /**
     * Line 18 interest. Auto-computed from paymentDate when provided;
     * otherwise the attorney-provided interestDue value (default 0).
     */
    interestDue: number;
    /** All prior payments, frozen at compute time. Line 20 is the sum of these. */
    priorPayments: PriorPayment[];
    /** paymentDate from Matter, frozen at compute time. null when not provided. */
    paymentDate: ISODate | null;
    /**
     * IT-EXT extension elected at compute time, frozen so a generated IT-EXT agrees
     * with the approved extendedFilingDeadline. null when no extension was filed.
     */
    itExtension: ITExtension | null;
  };
  /**
   * 8 calendar months from date of death, shifted past weekends and NJ public holidays.
   * Statutory basis: N.J.S.A. 54:35-1 (tax due at death); N.J.S.A. 54:35-3
   * (interest accrues if unpaid within 8 months); N.J.A.C. 18:26-9.1 (filing
   * obligation within 8 months). Extensions of 4 + 2 months are available via
   * Form IT-EXT (N.J.A.C. 18:26-9.1(b)), but these extend the FILING deadline
   * only — the tax itself must be paid within the original 8 months.
   * NOTE: N.J.S.A. 54:35-5 is the LIEN DURATION statute (15 years), not the
   * filing deadline statute — prior citations were incorrect.
   * Weekend/holiday shift: N.J.A.C. 18:2-4.12 advances the deadline to the next
   * business day if it falls on a Saturday, Sunday, or NJ public holiday (N.J.S.A. 36:1-1).
   * Chains are resolved automatically (e.g. Sat → Sun → Mon holiday → Tue).
   */
  filingDeadline: ISODate;
  /**
   * Extended filing deadline when an IT-EXT extension is filed. null when no extension.
   * PAYMENT is always due by filingDeadline (the original 8-month deadline) — never extended.
   * N.J.A.C. 18:26-9.1(b): firstExtension = +4 months; firstExtension + secondExtension = +6 months.
   * Applied the same holiday-shift logic as filingDeadline.
   */
  extendedFilingDeadline: ISODate | null;
  /**
   * NJ Estate Tax computation when it applies to this date of death (pre-2018);
   * null for deaths on/after 2018-01-01 (estate tax repealed). Frozen in the snapshot.
   */
  njEstateTax: NJEstateTaxComputation | null;
  /**
   * FND-IMMUT: form-facing Matter data frozen at compute time. Optional for backward
   * compatibility (legacy snapshots lack it). When present, the IT-R renders ONLY from it.
   */
  formSnapshot?: ITRFormSnapshot;
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export type AuditAction =
  | 'matter_created'
  | 'matter_updated'
  | 'beneficiary_added'
  | 'beneficiary_updated'
  | 'deduction_added'
  | 'computation_run'
  | 'tax_class_override'
  | 'review_requested'
  | 'review_invited'
  | 'review_invitation_cancelled'
  | 'review_invitation_declined'
  | 'review_approved'
  /**
   * Sole-attorney finalization (solo deployments only) — the requesting attorney froze their own
   * checkpoint. DELIBERATELY distinct from 'review_approved': it is provenance, not an independent
   * review, and a reader of the chain must be able to tell the two apart. See
   * docs/PHASE-7-SOLO-FINALIZE-SPEC.md.
   */
  | 'matter_finalized'
  | 'review_rejected'
  | 'form_generated'
  | 'output_produced'
  | 'matter_purged';

export interface AuditEntry {
  entryId: string;
  matterId: string;
  timestamp: ISODateTime;
  actor: string; // attorney NJ bar ID or 'system'
  action: AuditAction;
  payload: Record<string, unknown>;
  /** Hash chain: SHA-256 of (previousHash + canonical JSON of this entry minus hash field). */
  hash: string;
  previousHash: string;
}

// ─── Review checkpoint ────────────────────────────────────────────────────────

export interface ReviewCheckpoint {
  checkpointId: string;
  matterId: string;
  requestedAt: ISODateTime;
  requestedBy: string; // NJ bar ID
  computationSnapshot: EstateComputation;
  status: 'pending' | 'approved' | 'rejected';
  reviewedAt?: ISODateTime;
  reviewedBy?: string; // NJ bar ID — must differ from requestedBy or same attorney on same matter
  notes?: string;
  /**
   * How output was unlocked (Phase 7 sole-attorney finalization).
   *   - 'two-attorney' — a different firm attorney approved (separation of duties);
   *   - 'solo'         — the requesting attorney finalized their own checkpoint in a solo
   *                      deployment. Provenance + a contemporaneous record, NOT an independent check.
   * Absent on checkpoints written before this phase, all of which passed the two-attorney gate —
   * so absent is unambiguously equivalent to 'two-attorney'.
   */
  finalizationKind?: FinalizationKind;
}

/** @see ReviewCheckpoint.finalizationKind */
export type FinalizationKind = 'two-attorney' | 'solo';

// ─── Reviewer invitation ──────────────────────────────────────────────────────

/**
 * Lifecycle of a review invitation (Phase 7 part 8).
 *   - `pending`   — the review is awaiting the invited reviewer;
 *   - `accepted`  — the invited reviewer approved this checkpoint;
 *   - `declined`  — reserved for a future explicit decline/reject wiring (round-trips today);
 *   - `cancelled` — the inviter (or matter owner) withdrew the invitation before it resolved.
 */
export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

/**
 * A named request for a specific attorney to review a specific checkpoint. An invitation is an
 * ADDRESSED POINTER, not a new authority: it records who was asked to review which checkpoint but
 * grants no power. The invited reviewer still approves through the existing firm-gated,
 * separation-of-duties `PATCH …/approve` route (ReviewGate re-verifies their bar ID and rejects a
 * self-approval). Firm-scoped like review — any same-firm attorney may be invited; cross-firm is
 * refused. Not part of the audit hash chain and carries no PII (bar IDs + an optional note).
 *
 * See docs/PHASE-7-REVIEWER-INVITATIONS-SPEC.md.
 */
export interface ReviewInvitation {
  invitationId: string;
  matterId: string;
  /** The specific ReviewCheckpoint the reviewer is asked to review. */
  checkpointId: string;
  /** The matter's firm at invite time (firm scoping). Absent = legacy/unscoped matter. */
  firmId?: string;
  /** Acting attorney's bar ID — token-derived, never client-asserted. */
  invitedBy: string;
  /** The named second reviewer's bar ID. */
  invitedReviewer: string;
  /** Optional free-text note to the reviewer (no PII expected). */
  note?: string;
  createdAt: ISODateTime;
  status: InvitationStatus;
  /** Set when the status leaves 'pending'. */
  resolvedAt?: ISODateTime;
  /** Bar ID that resolved it (approver / canceller). */
  resolvedBy?: string;
}

// ─── Form output ──────────────────────────────────────────────────────────────

/**
 * One row of the IT-R Summary Page tax class distribution table (Lines 10-14).
 * Each column matches the form verbatim (itrbk.pdf, IT-R (12-24)).
 */
export interface TaxClassLine {
  totalBeneficiaries: number;
  totalDistribution: number;
  totalExemption: number;
  totalTaxableAmount: number;
  taxDue: number;
}

/**
 * IT-R form data — line-for-line mapping to IT-R (12-24).
 * Line numbers and labels verified against itrbk.pdf (form) and it-rinst.pdf (instructions).
 * Source: nj.gov/treasury/taxation/pdf/other_forms/inheritance/itrbk.pdf (HTTP 200, Jun 2026).
 */
export interface ITRFormData {
  // Cover page
  decedentLastName: string;
  decedentFirstName: string;
  decedentMiddleName?: string;
  decedentAka?: string;
  decedentSSN: string;
  dateOfDeath: ISODate;
  countyOfResidence: NJCounty;
  /**
   * NJ domicile status. false = nonresident decedent (N.J.A.C. 18:26-2.15).
   * For nonresidents, NJ tax applies only to NJ real property and NJ tangible
   * personal property — attorney must verify schedules contain only NJ-situs property.
   */
  isNJResident: boolean;
  willExists: boolean;
  trustExists: boolean;
  federalReturnFiled: boolean;
  virtualCurrencyExists: boolean;
  disclaimersExist: boolean;
  /** Number of structured disclaimer records. 0 when no disclaimers field on the matter. */
  disclaimerCount: number;
  /** Supplemental disclaimer log. Present only when disclaimerCount > 0. */
  disclaimerSchedule?: DisclaimerScheduleItem[];
  representative: Matter['personalRepresentative'];

  // Summary page — Lines 1-9 (Estate Value Calculation)
  // Labels verbatim from IT-R (12-24) Summary Page.
  line1_njRealProperty: number;          // "New Jersey Real Property… Total from Schedule A"
  line2_closelyHeldBusiness: number;     // "Closely Held Businesses… Total from Schedule B"
  line3_allOtherPersonalProperty: number;// "All Other Personal Property.. Total from Schedule B1–B4 Recap"
  line4_transfers: number;               // "Transfers… Total from Schedule C"
  line5_grossEstate: number;             // "Gross Estate… Total lines 1 through 4"
  line6_deductions: number;              // "Deductions… Total from Schedule D"
  line7_netEstate: number;               // "Net Estate… Subtract line 6 from line 5"
  line8_contingentAmount: number;        // "Contingent Amount included on line 7"
  line9_balanceOfEstate: number;         // "Balance of Estate – Subtract line 8 from line 7"

  // Tax class distribution table — Lines 10-14
  // Each row: Total Beneficiaries | Total Distribution | Total Exemption | Total Taxable Amount | Tax Calculation
  line10_classA_spouse: TaxClassLine;    // "A – Spouse" (includes Civil Union Partners; one beneficiary only)
  line11_classA_other: TaxClassLine;     // "A – Other" (all other Class A: children, parents, etc.)
  line12_classC: TaxClassLine;           // "C" — 11%–16% after $25,000 per-beneficiary exemption
  line13_classD: TaxClassLine;           // "D" — 15%–16%; no exemption (< $500 de minimis)
  line14_classE: TaxClassLine;           // "E" (exempt charities, religious/educational orgs, etc.)

  // Lines 15-16 — contingent/compromise tax (attorney-determined; defaults to 0)
  line15_compromiseTax: number;          // "Compromise Tax Due on Line 8 Amount" (no interest accrues)
  line16_contingentTax: number;          // "Contingent Tax"

  line17_totalTax: number;               // "Total Tax Due (Total lines 10 through 16)"
  line18_interestDue: number;            // "Interest Due (if applicable)" — 10%/yr on unpaid tax
  line19_totalAmountDue: number;         // "Total Amount Due (Add line 17 and line 18)"
  line20_priorPayments: number;          // "Payments made prior to filing return" (sum of schedule)
  /** Individual prior payments backing Line 20, for itemized rendering. */
  line20_priorPaymentSchedule: PriorPayment[];
  line21_balanceDue: number;             // "If line 20 is less than line 19, enter balance due"
  line22_refund: number;                 // "If line 20 is more than line 19, enter refund amount"

  /** Per-beneficiary breakdown — attorney review aid (not a numbered IT-R line) */
  taxClassBreakdown: BeneficiaryTaxResult[];

  // Schedules — per-item detail supporting the Summary Page totals
  /** Schedule A: NJ Real Property (feeds Line 1). */
  scheduleA: ScheduleItem[];
  /** Schedule B: Closely Held Businesses (feeds Line 2). */
  scheduleB: ScheduleItem[];
  /** Schedule B-1: Financial institution accounts — savings, checking, CDs, IRAs (feeds B-1–B-4 Recap → Line 3). */
  scheduleB1: ScheduleItem[];
  /** Schedule B-2: Stocks and co-ops (feeds B-1–B-4 Recap → Line 3). */
  scheduleB2: ScheduleItem[];
  /** Schedule B-3: Municipal and corporate bonds — NOT US Savings Bonds, which are B-4 (feeds B-1–B-4 Recap → Line 3). */
  scheduleB3: ScheduleItem[];
  /** Schedule B-4: All other personal property including virtual currency (feeds B-1–B-4 Recap → Line 3). */
  scheduleB4: ScheduleItem[];
  /** Schedule C: Transfers subject to tax (feeds Line 4). */
  scheduleC: ScheduleItem[];
  /** Schedule D: Allowable deductions (feeds Line 6). N.J.A.C. 18:26-7. */
  scheduleD: ScheduleDeductionItem[];
  /** Schedule E Part I: every beneficiary's interest in the estate, exempt classes included. */
  scheduleE: ScheduleEBeneficiaryRow[];
  /** Class C Beneficiary Worksheet: per-beneficiary detail for Class C (sibling, child-in-law). */
  classCWorksheet: BeneficiaryWorksheetRow[];
  /** Class D Beneficiary Worksheet: per-beneficiary detail for Class D (niece/nephew, unrelated, etc.). */
  classDWorksheet: BeneficiaryWorksheetRow[];

  /** 8 months from date of death — this is ALWAYS the payment deadline */
  filingDeadline: ISODate;
  /**
   * Extended filing deadline when IT-EXT filed. null when no extension was filed.
   * Payment is ALWAYS due by filingDeadline — extensions apply to filing only.
   * N.J.A.C. 18:26-9.1(b): +4 months (firstExtension) or +6 months (both extensions).
   */
  extendedFilingDeadline: ISODate | null;
  /** Rule set that governed this computation */
  ruleSetId: string;

  /**
   * True when the NJ Estate Tax applied to this date of death (pre-2018).
   * When true, the rendered form includes a prominent notice directing the attorney
   * to compute and file Form IT-Estate separately. The engine does NOT compute
   * NJ Estate Tax — that calculation requires a separate attorney determination.
   */
  njEstateTaxApplies: boolean;
  /**
   * NJ Estate Tax exemption amount for this date of death. Present only when
   * njEstateTaxApplies is true. The attorney should use this as a reference
   * when computing the estate tax on Form IT-Estate.
   * VERIFY: rate tables not confirmed from primary source — see rule set file.
   */
  njEstateTaxExemption?: number;

  // Provenance
  approvedCheckpointId: string;
  disclaimer: string;
  generatedAt: ISODateTime;
}

// ─── IT-EXT (Application for Extension of Time to File) ───────────────────────

/**
 * Data model for Form IT-EXT (12-24) — Application for Extension of Time to File a
 * NJ Transfer Inheritance / Estate Tax Return. Statutory basis: N.J.A.C. 18:26-9.1(b).
 *
 * Critical: an IT-EXT extends the FILING deadline only. The tax payment remains due
 * within the original 8 months (originalDeadline); interest accrues on any unpaid
 * balance past that date regardless of the extension (N.J.S.A. 54:35-3).
 *
 * Deadlines are read from the approved computation snapshot (frozen at compute time);
 * the extension flags and reason are descriptive inputs taken from the live Matter.
 */
export interface ITEXTFormData {
  decedentLastName: string;
  decedentFirstName: string;
  decedentMiddleName?: string;
  decedentSSN: string;
  dateOfDeath: ISODate;
  countyOfResidence: NJCounty;
  isNJResident: boolean;
  /**
   * The official IT-EXT asks the estate to mark itself Testate or Intestate, which is the
   * same fact as `Matter.willExists`. Carried here so the PDF filler need not reach past the
   * form data to the matter.
   */
  willExists: boolean;

  /** Estate representative — signature block. */
  representative: Matter['personalRepresentative'];

  /** Original 8-month filing AND payment deadline. Payment is never extended. */
  originalDeadline: ISODate;
  /** Extended FILING deadline granted by this IT-EXT (filing only). */
  extendedFilingDeadline: ISODate;
  /** Total additional months past the original deadline: 4 (first) or 6 (both). */
  extensionMonths: number;
  /** Always true — an IT-EXT requires at least a first extension. */
  firstExtension: boolean;
  /** True when the second (+2 month) extension has also been elected. */
  secondExtension: boolean;
  /** Attorney-stated reason for the extension, if provided. */
  reason?: string;

  // Provenance
  approvedCheckpointId: string;
  disclaimer: string;
  generatedAt: ISODateTime;
}

// ─── IT-Estate (NJ Estate Tax Return) ─────────────────────────────────────────

/**
 * Data model for Form IT-Estate (NJ Resident Decedent Estate Tax Return) for a pre-2018
 * death. Statutory basis: N.J.S.A. 54:38-1. Mirrors the Simplified Method (Column A) of
 * the official form for 2002-2016 deaths; for 2017 deaths it carries the directive to use
 * NJ's official §2058 circular calculator (tentativeTax/netEstateTaxDue are null).
 */
export interface ITEstateFormData {
  decedentLastName: string;
  decedentFirstName: string;
  decedentMiddleName?: string;
  decedentSSN: string;
  dateOfDeath: ISODate;
  countyOfResidence: NJCounty;
  isNJResident: boolean;

  /** Estate representative — signature block. */
  representative: Matter['personalRepresentative'];

  regime: NJEstateTaxComputation['regime'];
  method: NJEstateTaxComputation['method'];
  exemptionThreshold: number;
  taxableEstate: number;
  /** $60,000 reduction (Simplified Method, 2002-2016). */
  exemptionAmount?: number;
  /** taxableEstate − exemptionAmount (Simplified Method, 2002-2016). */
  adjustedTaxableEstate?: number;

  /** Tentative NJ Estate Tax (IT-Estate line 10(a)). null for the 2017 regime. */
  tentativeTax: number | null;
  /** Credit for NJ Inheritance Tax paid (IT-Estate line 11(a)) — the IT-R inheritance tax. */
  inheritanceTaxCredit: number;
  /** Net NJ Estate Tax Due (IT-Estate line 13(a)) = max(0, tentative − credit). null for 2017. */
  netEstateTaxDue: number | null;

  filingRequired: boolean;
  /** 9-month estate-tax filing/payment deadline. */
  estateTaxDeadline: ISODate;
  citation: string;
  note: string;

  // Provenance
  approvedCheckpointId: string;
  disclaimer: string;
  generatedAt: ISODateTime;
}

// ─── L-9 / L-9(A) (Affidavit Requesting Real Property Tax Waiver) ──────────────

/** One beneficiary row on the L-9 affidavit. */
export interface L9ABeneficiaryRow {
  fullName: string;
  relationship: Relationship;
  taxClass: TaxClass;
  /** Total fair market value passing to this beneficiary. */
  interestValue: number;
}

/** One NJ real-property parcel whose lien the waiver releases (from Schedule A). */
export interface L9ARealProperty {
  description: string;
  fairMarketValue: number;
  beneficiaryName: string;
  /**
   * The parcel as the official L-9 asks for it — County, Street and Number, Lot, Block,
   * Municipality, Owner(s) of Record. These are the same columns Schedule A of the IT-R asks
   * for, so they are carried straight from the bequest's `realPropertyDetails`.
   *
   * Every one is optional: a matter entered before those fields existed has only a description,
   * and the affidavit prints the box blank for the attorney rather than guessing a lot and
   * block. A wrong block on a lien release is worse than an empty one.
   */
  county?: string;
  streetAddress?: string;
  lots?: string;
  block?: string;
  municipality?: string;
  ownersAndTitle?: string;
}

/**
 * Data model for the NJ Affidavit Requesting Real Property Tax Waiver — Form L-9(A) for
 * deaths before 2018-01-01, Form L-9 for deaths on/after. This affidavit releases the NJ
 * Inheritance/Estate Tax lien on real property (N.J.S.A. 54:35-5; N.J.A.C. 18:26-11.1) so
 * the property can transfer WITHOUT filing a full return — usable only when all
 * beneficiaries are Class A and no inheritance or estate tax is due.
 */
export interface L9AFormData {
  /** 'L-9(A)' for deaths before 2018-01-01; 'L-9' for deaths on/after. */
  formDesignation: 'L-9(A)' | 'L-9';
  decedentLastName: string;
  decedentFirstName: string;
  decedentMiddleName?: string;
  decedentSSN: string;
  dateOfDeath: ISODate;
  countyOfResidence: NJCounty;
  /** True when a will exists (Testate); false = Intestate. */
  testate: boolean;

  representative: Matter['personalRepresentative'];
  beneficiaries: L9ABeneficiaryRow[];
  realProperties: L9ARealProperty[];

  /** Documents that must accompany the affidavit. */
  requiredAttachments: string[];
  /** Division of Taxation mailing address for the affidavit. */
  mailingAddress: string;
  /** Filing guidance (no fee; not a tax waiver; do not file with the County Clerk). */
  filingNote: string;
  citation: string;

  // Provenance
  approvedCheckpointId: string;
  disclaimer: string;
  generatedAt: ISODateTime;
}
