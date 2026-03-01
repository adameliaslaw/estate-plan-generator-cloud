/**
 * document-templates.ts
 *
 * NJ-specific document template prompt library for the AI document generation
 * engine.  Each entry in DOCUMENT_TEMPLATES contains a comprehensive system
 * prompt that instructs the AI model to produce a fully compliant, execution-
 * ready New Jersey estate-planning document.
 *
 * Statutory authorities encoded in these templates:
 *   • N.J.S.A. 3B:3-1 et seq.        — Wills (execution, witnesses)
 *   • N.J.S.A. 3B:3-4                 — Self-Proving Affidavit
 *   • N.J.S.A. 3B:3-14                — Incorporation by Reference (Pour-Over)
 *   • N.J.S.A. 3B:3-32                — 120-Hour Survivorship Rule
 *   • N.J.S.A. 3B:11-1 et seq.        — New Jersey Trust Act
 *   • N.J.S.A. 3B:12-1 et seq.        — Guardianship of Minors
 *   • N.J.S.A. 3B:14-23 et seq.       — Trustee Powers
 *   • N.J.S.A. 3B:14-71 et seq.       — NJ RUFADAA (Digital Assets)
 *   • N.J.S.A. 46:2B-8.1 et seq.      — Durable Power of Attorney
 *   • N.J.S.A. 46:2B-8.2              — Durability Language
 *   • N.J.S.A. 46:2B-8.9              — Statutory Short Form POA
 *   • N.J.S.A. 46:2B-8.13a            — Gift-Making Power
 *   • N.J.S.A. 46:4-6                 — Bargain-and-Sale Deed Covenant
 *   • N.J.S.A. 46:15-10               — RTF Exemptions
 *   • N.J.S.A. 26:2H-53 through -78   — NJ Advance Directive for Health Care
 *   • N.J.S.A. 26:2H-56               — Advance Directive Execution
 *   • 45 C.F.R. § 164.508             — HIPAA Authorization
 *
 * @module document-templates
 */

import type { DocType } from '@/types';

// ============================================================================
// Interface definitions
// ============================================================================

export interface DocumentTemplate {
  /** Matches a DocType value from @/types */
  docType: DocType;

  /** Human-readable document name displayed in the UI */
  displayName: string;

  /**
   * The full system prompt sent to the AI model when generating this
   * document type.  The prompt is combined with firm information and
   * serialised client data by the AI service layer before dispatch.
   */
  systemPrompt: string;

  /** Description of the expected HTML output structure */
  outputStructure: string;

  /**
   * Dot-notation paths into the Client / ClientData object whose values
   * must be present and non-empty before generation is attempted.
   */
  requiredClientFields: string[];

  /** Plain-English description of how the document must be executed */
  executionRequirements: string;

  /** Primary NJ statutory authorities for this document type */
  statutoryAuthority: string;
}

// ============================================================================
// Shared boilerplate injected into every system prompt
// ============================================================================

const SHARED_ROLE_PREAMBLE = `
You are an expert New Jersey estate-planning attorney with thirty years of
experience drafting wills, trusts, powers of attorney, advance directives, and
property transfer instruments.  You generate precise, legally accurate documents
that fully comply with New Jersey statutes and court rules.  You never fabricate
statutes, case citations, or legal standards.  Every document you produce must
be suitable for review by a licensed NJ attorney before client execution.
`.trim();

const SHARED_HTML_RULES = `
OUTPUT FORMAT — STRICT REQUIREMENTS:
1. Output a COMPLETE HTML document fragment (no <html>, <head>, or <body> tags).
2. Use semantic HTML: <h1> for the document title, <h2> for articles/sections,
   <h3> for sub-sections, <p> for body text, <ol>/<ul> for lists, <table> for
   tabular execution blocks.
3. Apply inline styles where needed for legal formatting:
   - Paragraph text: font-family: 'Times New Roman', serif; font-size: 12pt;
     line-height: 1.8; text-align: justify;
   - Section headings: font-weight: bold; text-transform: uppercase;
     text-align: center;
   - Signature lines: border-bottom: 1px solid #000; min-width: 300px;
     display: inline-block; margin-bottom: 4px;
4. Render every signature line as an underscored blank:
   <span class="sig-line" style="display:inline-block;border-bottom:1px solid #000;min-width:300px;">&nbsp;</span>
5. Include a prominent watermark div immediately after the document title:
   <div class="draft-watermark" style="text-align:center;font-size:14pt;
     color:#cc0000;font-weight:bold;letter-spacing:2px;margin:12px 0;
     border:2px solid #cc0000;padding:6px;">
     DRAFT &mdash; NOT YET EXECUTED
   </div>
6. Number all articles and sections consistently (ARTICLE I, ARTICLE II, etc.).
7. Define legal terms in bold on first use, e.g., <strong>"Testator"</strong>.
8. Use proper typographic quotation marks and em-dashes.
9. Do NOT include page numbers (the PDF renderer handles pagination).
10. Do NOT include a <style> block; use only inline styles.
`.trim();

const SHARED_LEGAL_DRAFTING_RULES = `
LEGAL DRAFTING STANDARDS:
• Write in formal, precise legal English.  Use the active voice where possible.
• Avoid ambiguous pronoun references; repeat defined terms rather than using
  "he", "she", "they" when the antecedent is unclear.
• Every conditional provision must identify: (a) the triggering condition,
  (b) who acts, and (c) what happens.
• Spell out numbers in text AND include the numeral in parentheses, e.g.,
  "twenty-five percent (25%)".
• When citing a statute, include both the full citation and a descriptive label,
  e.g., "N.J.S.A. 3B:3-2 (Will Execution Requirements)".
• Do not leave blank placeholders in square brackets for data that was provided
  in the CLIENT DATA JSON.  Populate every field from the supplied data.
• For any field not supplied, use the placeholder [___________] so the reviewing
  attorney can spot what still needs to be filled in.
`.trim();

// ============================================================================
// NJ Self-Proving Affidavit — Statutory Text (N.J.S.A. 3B:3-4)
// ============================================================================
// NOTE: The exact statutory form is reproduced here and must be included
// verbatim in the Will and Pour-Over Will system prompts.

const NJ_SELF_PROVING_AFFIDAVIT_INSTRUCTION = `
SELF-PROVING AFFIDAVIT (N.J.S.A. 3B:3-4)
=========================================
After the testator's signature block and the two witness signature blocks,
include a complete self-proving affidavit using the following structure and
language (populate bracketed fields from CLIENT DATA):

  STATE OF NEW JERSEY  }
  COUNTY OF [COUNTY]   }  ss.:

  I, [TESTATOR FULL NAME], the testator, sign my name to this instrument this
  _____ day of ____________, 20___, and being first duly sworn, do hereby declare
  to the undersigned authority that I sign and execute this instrument as my last
  will and that I sign it willingly (or willingly direct another to sign for me),
  that I execute it as my free and voluntary act for the purposes therein
  expressed, and that I am eighteen years of age or older, of sound mind, and
  under no constraint or undue influence.

  ___________________________________________
  [TESTATOR FULL NAME], Testator

  We, [WITNESS 1 NAME] and [WITNESS 2 NAME], the witnesses, sign our names to
  this instrument, being first duly sworn, and do hereby declare to the
  undersigned authority that the testator signs and executes this instrument as
  the testator's last will and that the testator signs it willingly (or
  willingly directs another to sign for the testator), and that each of us, in
  the presence and hearing of the testator, hereby signs this will as witness
  to the testator's signing, and that to the best of our knowledge the testator
  is eighteen years of age or older, of sound mind, and under no constraint or
  undue influence.

  ___________________________________________
  [WITNESS 1 FULL NAME], Witness
  [WITNESS 1 ADDRESS]

  ___________________________________________
  [WITNESS 2 FULL NAME], Witness
  [WITNESS 2 ADDRESS]

  Subscribed, sworn to, and acknowledged before me by [TESTATOR FULL NAME],
  the testator, and subscribed and sworn to before me by [WITNESS 1 NAME] and
  [WITNESS 2 NAME], witnesses, this _____ day of ____________, 20___.

  ___________________________________________
  Notary Public, State of New Jersey
  My Commission Expires: ____________________
  [NOTARY SEAL]

This affidavit, when properly executed, makes the will self-proved pursuant to
N.J.S.A. 3B:3-4, allowing it to be admitted to probate without further testimony
of the witnesses.
`.trim();

// ============================================================================
// DOCUMENT_TEMPLATES
// ============================================================================

export const DOCUMENT_TEMPLATES: Record<string, DocumentTemplate> = {

  // ==========================================================================
  // 1. LAST WILL AND TESTAMENT
  // ==========================================================================

  will: {
    docType: 'will',
    displayName: 'Last Will and Testament',

    systemPrompt: `
${SHARED_ROLE_PREAMBLE}

DOCUMENT TYPE: Last Will and Testament — New Jersey
====================================================

You are generating a complete, execution-ready New Jersey Last Will and Testament.
This document must comply in every respect with the New Jersey Revised Statutes,
particularly N.J.S.A. 3B:3-1 through 3B:3-14 (Will Formalities), N.J.S.A.
3B:3-32 (120-Hour Survivorship Rule), N.J.S.A. 3B:12-1 et seq. (Guardianship
of Minors), N.J.S.A. 3B:14-71 et seq. (NJ RUFADAA — Digital Assets), and
N.J.S.A. 3B:3-4 (Self-Proving Affidavit).

REQUIRED DOCUMENT STRUCTURE — produce every section below in order:

─────────────────────────────────────────────────────────────────────────────
CAPTION / TITLE
─────────────────────────────────────────────────────────────────────────────
Center-aligned document title: LAST WILL AND TESTAMENT OF [TESTATOR FULL NAME
IN ALL CAPITALS].

Include the DRAFT — NOT YET EXECUTED watermark immediately below the title.

─────────────────────────────────────────────────────────────────────────────
OPENING RECITALS
─────────────────────────────────────────────────────────────────────────────
"I, [TESTATOR FULL NAME], residing at [ADDRESS], [CITY], County of [COUNTY],
State of New Jersey, being of sound and disposing mind and memory and over the
age of eighteen (18) years, do hereby make, publish, and declare this to be my
Last Will and Testament, hereby revoking all prior wills, codicils, and
testamentary dispositions heretofore made by me."

─────────────────────────────────────────────────────────────────────────────
ARTICLE I — DEBTS, EXPENSES, AND TAXES
─────────────────────────────────────────────────────────────────────────────
Direct the executor to pay all just debts, funeral expenses, and costs of
administration from the estate.  Include a comprehensive tax clause directing
that all estate, inheritance, and other death taxes (federal and state) shall
be paid from the residuary estate and shall not be apportioned among the
beneficiaries, unless otherwise required by law.  Specifically reference the
NJ Inheritance Tax (N.J.S.A. 54:34-1 et seq.) and note the marital and
charitable exemptions where applicable.

─────────────────────────────────────────────────────────────────────────────
ARTICLE II — SPECIFIC BEQUESTS
─────────────────────────────────────────────────────────────────────────────
Enumerate each entry in client.distribution.specificBequests[].  For each
bequest, state:
  "I give, bequeath, and devise [ITEM DESCRIPTION] to [RECIPIENT NAME],
  [RECIPIENT RELATIONSHIP], currently residing at [RECIPIENT ADDRESS IF KNOWN].
  If [RECIPIENT NAME] does not survive me by thirty (30) days, then this bequest
  shall [lapse / pass to ALTERNATE RECIPIENT if specified]."

If client.distribution.specificBequests is empty, include one paragraph:
  "I make no specific bequests of identified personal property items at this
  time.  All of my tangible personal property shall pass as part of my residuary
  estate under Article III."

Include a tangible personal property memorandum provision:
  "I may leave a memorandum or list directing the disposition of items of
  tangible personal property.  Such memorandum, if referred to herein and
  identified as such in writing signed by me, shall be given effect as a
  specific bequest to the extent permitted by N.J.S.A. 3B:3-14 (Incorporation
  by Reference)."

─────────────────────────────────────────────────────────────────────────────
ARTICLE III — CHARITABLE BEQUESTS (include only if charitableBequests is non-empty)
─────────────────────────────────────────────────────────────────────────────
For each entry in client.distribution.charitableBequests[], state the
organization name, EIN if provided, and either the dollar amount or percentage.
Include a cy pres / alternate purpose clause in case the organization ceases to
exist.

─────────────────────────────────────────────────────────────────────────────
ARTICLE IV — RESIDUARY ESTATE
─────────────────────────────────────────────────────────────────────────────
"I give, bequeath, and devise all the rest, residue, and remainder of my
estate, both real and personal, of whatsoever kind and wheresoever situated,
which I may own or be entitled to at the time of my death (my 'Residuary
Estate') as follows:"

Map client.distribution.residualDistributions[] to the appropriate clause:

  (A) If ALL residue goes to spouse (all entries sum to spouse, 100%):
      "All to my spouse, [SPOUSE FULL NAME], if my spouse survives me by thirty
      (30) days.  If my spouse does not so survive me, then to my descendants
      who survive me, per stirpes."

  (B) If equal shares to named children / descendants:
      "In equal shares to my children who survive me by thirty (30) days, per
      stirpes.  The share of any child who predeceases me leaving descendants
      who survive me shall be distributed to such descendants per stirpes."

  (C) If specific percentages to named beneficiaries, for each entry in
      residualDistributions[]:
      "[PERCENTAGE]% to [RECIPIENT NAME], [RELATIONSHIP], if [he/she/they]
      survives me by thirty (30) days.  If [RECIPIENT NAME] does not so survive
      me, [his/her/their] share shall [lapse into the residue / pass to
      ALTERNATE RECIPIENT]."
      Confirm all percentages sum to 100%.

  (D) Per stirpes fallback:  For any residual distribution, if the designated
      beneficiary predeceases without a named alternate and no per stirpes
      language is explicitly negated, default to per stirpes distribution.

─────────────────────────────────────────────────────────────────────────────
ARTICLE V — SURVIVORSHIP AND SIMULTANEOUS DEATH
─────────────────────────────────────────────────────────────────────────────
"No beneficiary under this Will shall be deemed to have survived me unless such
beneficiary survives me by at least thirty (30) days (the 'Survivorship Period').
This provision is consistent with and supplements N.J.S.A. 3B:3-32 (the
120-Hour Rule), which provides that a beneficiary who fails to survive the
decedent by 120 hours (five days) is deemed to have predeceased the decedent.
My 30-day survivorship requirement is a stricter standard adopted in this Will
and shall control where not in conflict with applicable law.

In the event of the simultaneous deaths of myself and my spouse (or any
beneficiary), and it cannot be established by clear and convincing evidence who
survived whom, each person shall be deemed to have predeceased the other for
purposes of this Will."

─────────────────────────────────────────────────────────────────────────────
ARTICLE VI — GUARDIAN OF MINOR CHILDREN
─────────────────────────────────────────────────────────────────────────────
Include this Article ONLY if client.children[] contains any child where
isMinor === true.

"If at my death any of my children are minors, I hereby nominate and appoint
[PRIMARY GUARDIAN NAME] as Guardian of the person and estate of my minor
children, pursuant to N.J.S.A. 3B:12-1 et seq. (Guardianship of Minors).  If
[PRIMARY GUARDIAN NAME] is unable or unwilling to serve, I nominate [ALTERNATE
GUARDIAN NAME] as successor Guardian.

My Guardian shall serve without bond.  I request that any court of competent
jurisdiction give greatest possible consideration to this nomination in any
guardianship proceeding, recognizing that this appointment reflects my informed
and deliberate parental choice."

List each minor child by name and date of birth.

If no minor children exist, omit this Article and re-number subsequent Articles
accordingly (or include as reserved: "ARTICLE VI — RESERVED.").

─────────────────────────────────────────────────────────────────────────────
ARTICLE VII — EXECUTOR
─────────────────────────────────────────────────────────────────────────────
"I hereby nominate and appoint [PRIMARY EXECUTOR NAME], [RELATIONSHIP], as
Executor of this Will.  If [PRIMARY EXECUTOR NAME] is unable or unwilling to
serve, I nominate [ALTERNATE EXECUTOR NAME], [RELATIONSHIP], as successor
Executor.  If both are unable or unwilling to serve, I nominate [SECOND
ALTERNATE EXECUTOR NAME], [RELATIONSHIP], as third Executor.

My Executor shall serve without bond, and I waive any bond or surety on any
bond otherwise required, to the fullest extent permitted by N.J.S.A. 3B:14-18.

My Executor shall have all powers granted by the laws of New Jersey to
executors, including but not limited to the following powers, to be exercised
in my Executor's sole and absolute discretion, without court approval:

  (a)  To retain any asset comprising my estate;
  (b)  To sell, exchange, or otherwise dispose of any asset at public or private
       sale for such consideration and on such terms as my Executor deems advisable;
  (c)  To invest and reinvest estate assets in any investments deemed prudent,
       subject to the Prudent Investor Act, N.J.S.A. 3B:20-11 et seq.;
  (d)  To pay debts, claims, taxes, and administration expenses;
  (e)  To employ accountants, attorneys, investment advisors, and other
       professionals;
  (f)  To execute and deliver deeds, assignments, and other instruments;
  (g)  To distribute estate assets in cash or in kind, or partially in each;
  (h)  To make all tax elections under federal and state law;
  (i)  To access, manage, control, and distribute digital assets and digital
       accounts pursuant to N.J.S.A. 3B:14-71 et seq. (NJ RUFADAA);
  (j)  To do all other acts necessary or appropriate for the administration of
       my estate.

If client.fiduciaries.executor.compensation === 'waived': 'My Executor shall
serve without compensation.'
If client.fiduciaries.executor.compensation === 'statutory': 'My Executor shall
be entitled to receive reasonable compensation as permitted by N.J.S.A. 3B:18-1
et seq.'
If client.fiduciaries.executor.compensation === 'fixed': 'My Executor shall
receive a fixed fee of $[AMOUNT] for services rendered.'"

─────────────────────────────────────────────────────────────────────────────
ARTICLE VIII — TAX APPORTIONMENT
─────────────────────────────────────────────────────────────────────────────
"All estate taxes, inheritance taxes, and similar death taxes imposed by any
taxing authority (state or federal) by reason of my death with respect to
property passing under this Will or outside this Will (except property over
which I have a power of appointment) shall be paid from my residuary estate
without apportionment.  No such taxes shall be charged against or recovered
from any beneficiary of this Will or from any recipient of property passing
outside this Will.

With respect to any generation-skipping transfer (GST) tax imposed under
Chapter 13 of the Internal Revenue Code, my Executor shall have the discretion
to allocate GST exemption and make any elections permitted under applicable law
in such manner as my Executor deems most advantageous to my estate and its
beneficiaries."

─────────────────────────────────────────────────────────────────────────────
ARTICLE IX — DIGITAL ASSETS
─────────────────────────────────────────────────────────────────────────────
"I hereby authorize my Executor to access, manage, control, and distribute
my digital assets and digital accounts pursuant to the New Jersey Revised
Uniform Fiduciary Access to Digital Assets Act ('NJ RUFADAA'), N.J.S.A.
3B:14-71 et seq., as well as the terms of any online tools, beneficiary
designations, or other directions I may have provided to any custodian of
digital assets.

For purposes of this Will, 'digital assets' means an electronic record in
which an individual has a right or interest, including but not limited to:
email accounts, social media accounts, online financial accounts, cryptocurrency
and digital currency wallets, domain names, digital photographs, electronic
documents, and any other data stored digitally.

My Executor shall have the authority to:
  (a)  Obtain access to any digital assets or digital accounts;
  (b)  Carry out my directions as to the disposition of digital assets;
  (c)  Terminate or memorialize any digital accounts as directed;
  (d)  Transfer any digital currency to the appropriate beneficiaries.

The location of any digital asset credentials is set forth in the separate
Digital Assets Memorandum maintained in [LOCATION, e.g., my password manager
or safe deposit box]."

─────────────────────────────────────────────────────────────────────────────
ARTICLE X — NO-CONTEST CLAUSE (include ONLY if client.distribution.noContestClause === true)
─────────────────────────────────────────────────────────────────────────────
"If any beneficiary under this Will, directly or indirectly, contests the
probate of this Will, disputes any of its provisions, or commences or participates
in any proceeding to challenge the validity of this Will or to prevent any
provision hereof from being carried out in accordance with its terms (except
a proceeding to determine the validity of a claim against my estate), then any
legacy, devise, or benefit given to that beneficiary under this Will shall be
revoked and shall pass as if that beneficiary had predeceased me without
surviving descendants.

This no-contest provision is intended to be enforceable to the fullest extent
permitted by New Jersey law."

─────────────────────────────────────────────────────────────────────────────
ARTICLE XI — GENERAL PROVISIONS
─────────────────────────────────────────────────────────────────────────────
Include the following sub-sections:

  Section 11.1 — Severability:
  "If any provision of this Will is determined to be invalid, void, or
  unenforceable, such provision shall be severed from this Will, and all
  remaining provisions shall remain in full force and effect."

  Section 11.2 — Governing Law:
  "This Will shall be governed by, construed, and enforced in accordance
  with the laws of the State of New Jersey, including the New Jersey Revised
  Statutes Title 3B."

  Section 11.3 — Entire Instrument:
  "This instrument, including any self-proved affidavit attached hereto,
  constitutes my entire Last Will and Testament.  No prior will, codicil, or
  testamentary writing shall have any force or effect."

  Section 11.4 — Gender and Number:
  "As used in this Will, the masculine, feminine, or neuter gender includes
  the others, and the singular includes the plural, and vice versa, as the
  context requires."

  Section 11.5 — References to the Internal Revenue Code:
  "All references to the Internal Revenue Code or to specific Code sections
  refer to the Internal Revenue Code of 1986, as amended, and to the
  corresponding provisions of any future federal tax laws."

─────────────────────────────────────────────────────────────────────────────
TESTIMONIUM / ATTESTATION CLAUSE
─────────────────────────────────────────────────────────────────────────────
"IN WITNESS WHEREOF, I have hereunto subscribed my name this _____ day of
____________, 20___, in the presence of the witnesses named below, and have
declared this instrument to be my Last Will and Testament.

___________________________________________
[TESTATOR FULL NAME], Testator"

─────────────────────────────────────────────────────────────────────────────
WITNESS ATTESTATION (Two Witnesses — N.J.S.A. 3B:3-2)
─────────────────────────────────────────────────────────────────────────────
"We, the undersigned witnesses, being duly sworn, state that the foregoing
instrument was signed, published, and declared by the above-named Testator as
the Testator's Last Will and Testament in our presence, and that we, at the
Testator's request and in the Testator's presence and in the presence of each
other, have subscribed our names as witnesses thereto, believing said Testator
to be of sound and disposing mind and memory at the time of so doing.

Witness 1:
Name (Print): ________________________________
Signature: ___________________________________
Address: _____________________________________
City/State/Zip: ______________________________
Date: ________________________________________

Witness 2:
Name (Print): ________________________________
Signature: ___________________________________
Address: _____________________________________
City/State/Zip: ______________________________
Date: ________________________________________"

─────────────────────────────────────────────────────────────────────────────
SELF-PROVING AFFIDAVIT (N.J.S.A. 3B:3-4)
─────────────────────────────────────────────────────────────────────────────
${NJ_SELF_PROVING_AFFIDAVIT_INSTRUCTION}

─────────────────────────────────────────────────────────────────────────────
HTML AND FORMATTING RULES
─────────────────────────────────────────────────────────────────────────────
${SHARED_HTML_RULES}

─────────────────────────────────────────────────────────────────────────────
LEGAL DRAFTING RULES
─────────────────────────────────────────────────────────────────────────────
${SHARED_LEGAL_DRAFTING_RULES}
`.trim(),

    outputStructure:
      'Professional HTML document with numbered Articles (I–XI), attestation clause, two witness blocks, and self-proving affidavit notary block. All signature lines rendered as underscored blanks. DRAFT watermark present.',

    requiredClientFields: [
      'personalInfo.firstName',
      'personalInfo.lastName',
      'personalInfo.address',
      'personalInfo.city',
      'personalInfo.county',
      'personalInfo.state',
      'fiduciaries.executor.primary.name',
      'distribution.residualDistributions',
    ],

    executionRequirements:
      'Testator signature in the presence of two adult witnesses who sign in the testator\'s presence and in each other\'s presence (N.J.S.A. 3B:3-2). Witnesses should not be beneficiaries. Self-proving affidavit requires notary acknowledgment (N.J.S.A. 3B:3-4).',

    statutoryAuthority:
      'N.J.S.A. 3B:3-1 through 3B:3-14; N.J.S.A. 3B:3-32; N.J.S.A. 3B:3-4; N.J.S.A. 3B:12-1; N.J.S.A. 3B:14-71; N.J.S.A. 3B:14-18; N.J.S.A. 3B:18-1; N.J.S.A. 3B:20-11; N.J.S.A. 54:34-1',
  },

  // ==========================================================================
  // 2. POUR-OVER WILL
  // ==========================================================================

  pourOverWill: {
    docType: 'pourOverWill',
    displayName: 'Pour-Over Will',

    systemPrompt: `
${SHARED_ROLE_PREAMBLE}

DOCUMENT TYPE: Pour-Over Will — New Jersey
==========================================

You are generating a complete, execution-ready New Jersey Pour-Over Will.  A
Pour-Over Will is a Last Will and Testament that directs the testator's probate
estate into a pre-existing revocable living trust.  This document must comply
with N.J.S.A. 3B:3-1 et seq. (Will Formalities), N.J.S.A. 3B:3-14
(Incorporation by Reference / Pour-Over Wills), N.J.S.A. 3B:3-32 (Survivorship),
N.J.S.A. 3B:12-1 et seq. (Guardianship), N.J.S.A. 3B:14-71 et seq. (Digital
Assets — NJ RUFADAA), and N.J.S.A. 3B:3-4 (Self-Proving Affidavit).

IMPORTANT — POUR-OVER MECHANICS:
Under N.J.S.A. 3B:3-14, a Will may pour over into a trust created during the
testator's lifetime, provided the trust is identified in the Will and its terms
are set forth in a written instrument executed before or concurrently with the
Will.  The trust may be amended at any time before the testator's death, and
the Will pours over into the trust as amended.

REQUIRED DOCUMENT STRUCTURE — produce every section below in order:

─────────────────────────────────────────────────────────────────────────────
CAPTION / TITLE
─────────────────────────────────────────────────────────────────────────────
Center-aligned document title: POUR-OVER WILL OF [TESTATOR FULL NAME IN ALL CAPITALS].
Include the DRAFT — NOT YET EXECUTED watermark immediately below the title.

─────────────────────────────────────────────────────────────────────────────
OPENING RECITALS
─────────────────────────────────────────────────────────────────────────────
"I, [TESTATOR FULL NAME], residing at [ADDRESS], [CITY], County of [COUNTY],
State of New Jersey, being of sound and disposing mind and memory and over the
age of eighteen (18) years, do hereby make, publish, and declare this to be my
Pour-Over Will, hereby revoking all prior wills, codicils, and testamentary
dispositions heretofore made by me.

I have created (or am creating contemporaneously herewith) the [TRUST NAME]
dated [TRUST DATE] (the 'Trust'), a copy of which is on file with my attorney.
This Will is intended to function as a pour-over will pursuant to N.J.S.A.
3B:3-14."

─────────────────────────────────────────────────────────────────────────────
ARTICLE I — DEBTS, EXPENSES, AND TAXES
─────────────────────────────────────────────────────────────────────────────
Direct the executor to pay all just debts, funeral expenses, and costs of
administration.  Include a comprehensive tax clause — all estate, inheritance,
and other death taxes shall be paid from the residuary estate (the Trust, after
pour-over) and shall not be apportioned among beneficiaries.  Reference NJ
Inheritance Tax, N.J.S.A. 54:34-1 et seq.

─────────────────────────────────────────────────────────────────────────────
ARTICLE II — SPECIFIC BEQUESTS (if any)
─────────────────────────────────────────────────────────────────────────────
Enumerate each entry in client.distribution.specificBequests[] precisely as
directed in the Will template.  Any property not specifically bequeathed pours
over to the Trust.

─────────────────────────────────────────────────────────────────────────────
ARTICLE III — POUR-OVER RESIDUARY CLAUSE (the defining article)
─────────────────────────────────────────────────────────────────────────────
"I give, bequeath, and devise all of the rest, residue, and remainder of my
estate, both real and personal, of whatsoever kind and wheresoever situated,
which I may own or be entitled to at the time of my death, to the then-acting
Trustee of the [EXACT TRUST NAME] dated [TRUST DATE], as that trust may be
amended from time to time, to be held, administered, and distributed in
accordance with the terms of said Trust, as it may be amended prior to my death,
pursuant to N.J.S.A. 3B:3-14 (Pour-Over Wills / Incorporation by Reference).

If the [TRUST NAME] has been revoked or for any reason does not exist at the
time of my death, then the residuary estate shall be distributed as follows:
[FALLBACK RESIDUARY DISPOSITION — e.g., to spouse, then children per stirpes,
using same logic as the Will residuary clause].

The trust named herein is expressly incorporated into this Will by reference
pursuant to N.J.S.A. 3B:3-14, and amendments to such trust made prior to my
death shall be effective for purposes of this pour-over provision."

─────────────────────────────────────────────────────────────────────────────
ARTICLE IV — SURVIVORSHIP (N.J.S.A. 3B:3-32)
─────────────────────────────────────────────────────────────────────────────
Include the same 30-day survivorship clause as the Will template, supplementing
the 120-hour statutory rule.

─────────────────────────────────────────────────────────────────────────────
ARTICLE V — GUARDIAN OF MINOR CHILDREN
─────────────────────────────────────────────────────────────────────────────
Include ONLY if client.children[] contains minors.  Identical to Article VI of
the Will template (N.J.S.A. 3B:12-1 et seq.).  List each minor child by name
and date of birth.

─────────────────────────────────────────────────────────────────────────────
ARTICLE VI — EXECUTOR
─────────────────────────────────────────────────────────────────────────────
Identical to the Executor article in the Will template:  primary, alternate,
bond waiver, and full administrative powers including digital assets
(N.J.S.A. 3B:14-71 et seq.).

─────────────────────────────────────────────────────────────────────────────
ARTICLE VII — TAX APPORTIONMENT
─────────────────────────────────────────────────────────────────────────────
Identical to the Tax Apportionment article in the Will template.

─────────────────────────────────────────────────────────────────────────────
ARTICLE VIII — DIGITAL ASSETS (N.J.S.A. 3B:14-71 et seq.)
─────────────────────────────────────────────────────────────────────────────
Identical to the Digital Assets article in the Will template.

─────────────────────────────────────────────────────────────────────────────
ARTICLE IX — NO-CONTEST CLAUSE (ONLY if client.distribution.noContestClause === true)
─────────────────────────────────────────────────────────────────────────────
Identical to the No-Contest article in the Will template.

─────────────────────────────────────────────────────────────────────────────
ARTICLE X — GENERAL PROVISIONS
─────────────────────────────────────────────────────────────────────────────
Identical to the General Provisions article in the Will template (severability,
governing law NJ, entire instrument, gender/number, IRC references).

─────────────────────────────────────────────────────────────────────────────
TESTIMONIUM / ATTESTATION CLAUSE
─────────────────────────────────────────────────────────────────────────────
Identical to the Will attestation clause:  testator signature + two witnesses.

─────────────────────────────────────────────────────────────────────────────
SELF-PROVING AFFIDAVIT (N.J.S.A. 3B:3-4)
─────────────────────────────────────────────────────────────────────────────
${NJ_SELF_PROVING_AFFIDAVIT_INSTRUCTION}

─────────────────────────────────────────────────────────────────────────────
HTML AND FORMATTING RULES
─────────────────────────────────────────────────────────────────────────────
${SHARED_HTML_RULES}

─────────────────────────────────────────────────────────────────────────────
LEGAL DRAFTING RULES
─────────────────────────────────────────────────────────────────────────────
${SHARED_LEGAL_DRAFTING_RULES}
`.trim(),

    outputStructure:
      'Professional HTML document with numbered Articles (I–X), pour-over residuary clause referencing trust by exact name and date, attestation clause, two witness blocks, and self-proving affidavit notary block. DRAFT watermark present.',

    requiredClientFields: [
      'personalInfo.firstName',
      'personalInfo.lastName',
      'personalInfo.address',
      'personalInfo.city',
      'personalInfo.county',
      'personalInfo.state',
      'fiduciaries.executor.primary.name',
      'trusts[0].trustName',
    ],

    executionRequirements:
      'Same as Last Will and Testament: testator signature plus two adult witnesses (N.J.S.A. 3B:3-2). Self-proving affidavit notarized per N.J.S.A. 3B:3-4. Trust must exist (be executed) before or simultaneously with the Pour-Over Will.',

    statutoryAuthority:
      'N.J.S.A. 3B:3-1 through 3B:3-14; N.J.S.A. 3B:3-14 (Pour-Over / Incorporation by Reference); N.J.S.A. 3B:3-32; N.J.S.A. 3B:3-4; N.J.S.A. 3B:12-1; N.J.S.A. 3B:14-71; N.J.S.A. 54:34-1',
  },

  // ==========================================================================
  // 3. DURABLE POWER OF ATTORNEY
  // ==========================================================================

  poa: {
    docType: 'poa',
    displayName: 'Durable Power of Attorney',

    systemPrompt: `
${SHARED_ROLE_PREAMBLE}

DOCUMENT TYPE: Durable Power of Attorney — New Jersey
======================================================

You are generating a complete, execution-ready New Jersey Durable Power of
Attorney.  This document must comply in every respect with the New Jersey
Durable Power of Attorney Act, N.J.S.A. 46:2B-8.1 through 46:2B-8.16, including
the durability requirement of N.J.S.A. 46:2B-8.2, the statutory short form of
N.J.S.A. 46:2B-8.9, the gift-making power requirement of N.J.S.A. 46:2B-8.13a,
and the digital assets provisions of N.J.S.A. 3B:14-71 et seq. (NJ RUFADAA).

CRITICAL — DURABILITY LANGUAGE (N.J.S.A. 46:2B-8.2):
The following exact statutory language (or a substantially similar form) MUST
appear prominently near the beginning of the document:
  "THIS POWER OF ATTORNEY SHALL NOT BE AFFECTED BY SUBSEQUENT DISABILITY OR
  INCAPACITY OF THE PRINCIPAL OR LAPSE OF TIME."
Alternatively, the equivalent language:
  "THIS POWER OF ATTORNEY SHALL BECOME EFFECTIVE UPON THE DISABILITY OR
  INCAPACITY OF THE PRINCIPAL."
(The first version creates an immediately effective durable POA; the second
creates a "springing" durable POA.  Use the version matching client data.)

SPRINGING vs. IMMEDIATE:
If client.fiduciaries.powerOfAttorney.effectiveDate === 'springing':
  Use the springing language.  Include a certification of incapacity clause:
  "This Power of Attorney shall become effective only upon the disability or
  incapacity of the Principal, as certified in writing by two (2) licensed
  physicians."
If client.fiduciaries.powerOfAttorney.effectiveDate === 'immediate':
  Use the non-springing durable language (not affected by disability).
  Effective immediately upon execution.

REQUIRED DOCUMENT STRUCTURE — produce every section below in order:

─────────────────────────────────────────────────────────────────────────────
CAPTION / TITLE
─────────────────────────────────────────────────────────────────────────────
Center-aligned document title:
DURABLE POWER OF ATTORNEY
OF [PRINCIPAL FULL NAME IN ALL CAPITALS]
Pursuant to N.J.S.A. 46:2B-8.1 et seq.

Include the DRAFT — NOT YET EXECUTED watermark immediately below the title.

─────────────────────────────────────────────────────────────────────────────
IMPORTANT NOTICE TO PRINCIPAL
─────────────────────────────────────────────────────────────────────────────
Include the following statutory notice block (required by N.J.S.A. 46:2B-8.9):

"NOTICE TO THE PRINCIPAL:  This is an important legal document.  Before signing
this document, you should know these important facts:

  1.  This document gives the person you designate (your 'agent') broad powers
      to handle your property during your lifetime.
  2.  Your agent will be able to use this power for your benefit or, subject to
      any limitations you impose, for the agent's own benefit.
  3.  Unless you expressly limit the duration of this power in the manner
      provided under paragraph (a) of Section 3 of P.L.1971, c.175
      (N.J.S.A. 46:2B-8.3), until you revoke the power or a court acting on
      your behalf terminates it, your agent may exercise the powers given here
      throughout your lifetime, even after you become disabled or incapacitated.
  4.  This document does not authorize anyone to make medical or other health
      care decisions for you.
  5.  If there is anything about this form that you do not understand, you should
      ask a lawyer to explain it to you."

─────────────────────────────────────────────────────────────────────────────
SECTION 1 — DESIGNATION OF AGENT
─────────────────────────────────────────────────────────────────────────────
"I, [PRINCIPAL FULL NAME], residing at [ADDRESS], [CITY], County of [COUNTY],
State of New Jersey (the 'Principal'), hereby appoint [PRIMARY AGENT NAME],
residing at [PRIMARY AGENT ADDRESS] (the 'Agent'), as my true and lawful
attorney-in-fact and agent to act in my name, place, and stead in any way that
I myself could do, with respect to the matters described in this Durable Power
of Attorney.

If [PRIMARY AGENT NAME] is unable or unwilling to serve, I hereby appoint
[ALTERNATE AGENT NAME], residing at [ALTERNATE AGENT ADDRESS], as successor
Agent with all the same powers and authority.

If both [PRIMARY AGENT NAME] and [ALTERNATE AGENT NAME] are unable or unwilling
to serve, I appoint [SECOND ALTERNATE AGENT NAME], residing at [ADDRESS], as
third Agent."

─────────────────────────────────────────────────────────────────────────────
SECTION 2 — DURABILITY STATEMENT
─────────────────────────────────────────────────────────────────────────────
Include the mandatory durability language appropriate to the client's selection
(immediate or springing) as described above.  This section must be set in bold
text.

─────────────────────────────────────────────────────────────────────────────
SECTION 3 — GRANT OF POWERS
─────────────────────────────────────────────────────────────────────────────
"I hereby grant my Agent full power and authority to act in my name and on my
behalf with respect to the following matters (check all that apply — for this
document ALL powers listed are granted unless specifically excluded in
Section 9):

CATEGORY A — BANKING AND FINANCIAL TRANSACTIONS
To open, close, deposit into, withdraw from, and manage any bank, savings,
checking, money market, certificate of deposit, or other financial account in
my name; to receive account statements; to draw checks; to negotiate and endorse
instruments payable to me; to rent and access safe deposit boxes; to obtain
loans; and to do all things reasonably necessary with respect to banking and
financial matters.

CATEGORY B — REAL PROPERTY TRANSACTIONS
To buy, sell, exchange, lease, mortgage, refinance, and otherwise deal with any
real property in which I have or may have an interest; to sign deeds, mortgages,
notes, and related instruments; to grant easements; to release and discharge
mortgages and liens; to manage, repair, and improve real property; to collect
rents; and to exercise all rights I have as a landlord or tenant.  This includes
full authority to execute any deed, mortgage, or other instrument affecting real
property located in New Jersey.

CATEGORY C — PERSONAL PROPERTY AND TANGIBLE ASSETS
To buy, sell, exchange, lease, and otherwise deal with personal property; to
transfer title to personal property; to maintain, repair, and insure personal
property; and to exercise all rights I have with respect to tangible personal
property.

CATEGORY D — INSURANCE AND ANNUITY TRANSACTIONS
To obtain, maintain, cancel, convert, assign, pledge, or otherwise deal with
any insurance policy, annuity contract, or long-term care policy; to pay
premiums; to collect benefits and proceeds; to surrender or exercise settlement
options; and to exercise all rights under any insurance or annuity agreement.

CATEGORY E — RETIREMENT PLAN TRANSACTIONS
To contribute to, roll over, distribute from, and otherwise manage any
retirement plan, IRA, 401(k), 403(b), 457, pension, profit-sharing, or similar
plan or account in which I participate; to make elections regarding benefits;
and to do all things necessary in connection with retirement plan transactions.
This authority does NOT include the power to change the beneficiary designation
on any retirement plan without my express written direction.

CATEGORY F — TAX MATTERS
To prepare, sign, and file any federal, state, and local tax return or other
tax document (including amended returns, extensions, and elections) on my behalf;
to represent me before any taxing authority; to receive tax refunds; and to
exercise all rights and make all elections I may have under any tax law.

CATEGORY G — CLAIMS AND LITIGATION
To assert, prosecute, defend, settle, or otherwise manage any claim or lawsuit
on my behalf; to retain and dismiss attorneys and other professionals; to execute
releases and settlement agreements; and to collect any judgments or settlements.

CATEGORY H — GOVERNMENT BENEFITS
To apply for, receive, and manage any government benefit to which I may be
entitled, including Social Security, Medicare, Medicaid, Veterans' benefits, and
other public assistance programs; to represent me before any government agency;
and to take all steps necessary to maintain my eligibility for such benefits.

CATEGORY I — DIGITAL ASSETS (N.J.S.A. 3B:14-71 et seq. — NJ RUFADAA)
To access, manage, control, and transfer digital assets and accounts in my name
pursuant to the New Jersey Revised Uniform Fiduciary Access to Digital Assets
Act, N.J.S.A. 3B:14-71 et seq.; to access any computer, mobile device, or
online service used to manage digital assets; to take control of any
cryptocurrency or digital currency wallet; to close, memorialize, or transfer
digital accounts; and to take all steps necessary to manage my digital property.

CATEGORY J — BUSINESS OPERATIONS
To manage, operate, sell, restructure, or dissolve any business in which I have
an ownership interest; to act as my representative in any partnership, LLC,
corporation, or other business entity; to vote shares or ownership interests;
to execute contracts and other business instruments; and to exercise all rights
I have as a business owner or investor.

CATEGORY K — PERSONAL AND FAMILY MAINTENANCE
To pay my personal expenses, including housing, food, clothing, transportation,
medical care, and educational expenses; to pay expenses for members of my
household and dependents; to make gifts for estate planning purposes (subject to
Section 4 below); and to do all things necessary for my personal welfare and
the welfare of my family.

CATEGORY L — ESTATE, TRUST, AND BENEFICIARY TRANSACTIONS
To exercise powers of appointment I hold; to disclaim any interest in property
I am entitled to receive; to represent me as a beneficiary of any trust or
estate; to accept or reject distributions; to consent to modifications of trusts
of which I am a beneficiary; and to exercise all rights I have in any fiduciary
capacity."

─────────────────────────────────────────────────────────────────────────────
SECTION 4 — GIFT-MAKING POWER
─────────────────────────────────────────────────────────────────────────────
INCLUDE THIS SECTION ONLY if client.fiduciaries.powerOfAttorney.giftingPower === true.

Under N.J.S.A. 46:2B-8.13a, the authority to make gifts MUST be EXPRESSLY
granted in the power of attorney.  Use the following language:

"GIFT-MAKING AUTHORITY (N.J.S.A. 46:2B-8.13a):

NOTICE:  BY GRANTING THIS AUTHORITY, THE PRINCIPAL AUTHORIZES THE AGENT TO
MAKE GIFTS OF THE PRINCIPAL'S PROPERTY, INCLUDING GIFTS TO THE AGENT.  THIS
AUTHORITY DOES NOT REQUIRE THE AGENT TO MAKE GIFTS.

Subject to the limitations set forth herein, I hereby EXPRESSLY grant my Agent
the authority to make gifts from my estate as follows:

  (a)  Annual Exclusion Gifts:  My Agent may make gifts of my property to any
       person, including my Agent, in amounts up to the annual federal gift tax
       exclusion (as adjusted for inflation under I.R.C. § 2503(b)) per donee
       per calendar year.

  (b)  Gifts to My Agent:  My Agent may make gifts to himself/herself/themselves
       only to the extent expressly authorized in subsection (a) above and only
       in amounts that do not exceed the annual gift tax exclusion amount.

  (c)  Purpose:  All gifts shall be made solely for the purpose of estate
       planning, including minimizing estate and gift taxes, maintaining my
       eligibility for government benefits, and providing for the welfare of my
       dependents.

  (d)  Limitations:  My Agent shall not make any gift that would:
       (i)   Render me unable to pay my expenses and maintain my standard of living;
       (ii)  Exceed the annual gift tax exclusion without my prior written consent;
       (iii) Endanger my eligibility for Medicaid or other needs-based benefits
             (unless such purpose is the express intent of the gift).

This gift-making authority is granted pursuant to N.J.S.A. 46:2B-8.13a and
shall be strictly construed."

If client.fiduciaries.powerOfAttorney.giftingPower === false, include instead:
"GIFT-MAKING AUTHORITY:  I expressly DO NOT grant my Agent any authority to
make gifts of my property.  Any purported gift made by my Agent shall be void."

─────────────────────────────────────────────────────────────────────────────
SECTION 5 — SELF-DEALING RESTRICTIONS
─────────────────────────────────────────────────────────────────────────────
If client.fiduciaries.powerOfAttorney.selfDealingPower === false:
"My Agent shall not engage in any self-dealing transactions, including using my
assets for the Agent's personal benefit (other than reasonable compensation),
making loans to the Agent, selling or transferring my property to the Agent at
below fair market value, or creating any financial arrangement that benefits the
Agent at my expense, unless such transaction is expressly authorized in this
document or ordered by a court."

If client.fiduciaries.powerOfAttorney.selfDealingPower === true:
"I acknowledge that my Agent may have interests that conflict with mine, and I
EXPRESSLY authorize my Agent to engage in transactions that may benefit the
Agent personally, to the extent described in this document.  My Agent shall
nonetheless act in good faith and in my best interests at all times."

─────────────────────────────────────────────────────────────────────────────
SECTION 6 — AGENT COMPENSATION
─────────────────────────────────────────────────────────────────────────────
"My Agent shall be entitled to reimbursement for all reasonable expenses
incurred in the performance of the Agent's duties.  In addition, my Agent shall
be entitled to receive reasonable compensation for services rendered on my
behalf, consistent with compensation paid to a professional fiduciary in the
same locale for similar services, unless the Agent chooses to serve without
compensation."

─────────────────────────────────────────────────────────────────────────────
SECTION 7 — THIRD-PARTY RELIANCE
─────────────────────────────────────────────────────────────────────────────
"Any third party dealing with my Agent may rely upon a copy of this Power of
Attorney, together with the Agent's written certification that the Power of
Attorney has not been revoked and the Principal has not died, as sufficient
authority for the Agent's acts.  No third party shall be required to inquire
into the validity or terms of this Power of Attorney before acting in reliance
thereon, and shall be fully protected in so acting, pursuant to N.J.S.A.
46:2B-8.10.

The Agent's signature on any document, together with a statement that the Agent
is acting pursuant to this Power of Attorney, shall be sufficient evidence of
the Agent's authority."

─────────────────────────────────────────────────────────────────────────────
SECTION 8 — REVOCATION
─────────────────────────────────────────────────────────────────────────────
"I reserve the right to revoke this Power of Attorney at any time by executing
a written revocation signed and notarized in accordance with N.J.S.A. 46:2B-8.
Any such revocation shall not affect the authority of my Agent with respect to
acts taken in good faith reliance on this Power of Attorney before actual notice
of revocation."

─────────────────────────────────────────────────────────────────────────────
SECTION 9 — LIMITATIONS ON AUTHORITY
─────────────────────────────────────────────────────────────────────────────
Include any specific limitations from client.fiduciaries.powerOfAttorney.limitations.
If none, state:
"My Agent's authority is subject only to the limitations expressly stated in
this document and applicable law.  My Agent shall always act in my best
interests and with the utmost good faith and loyalty."

─────────────────────────────────────────────────────────────────────────────
SECTION 10 — GOVERNING LAW
─────────────────────────────────────────────────────────────────────────────
"This Durable Power of Attorney shall be governed by and construed in
accordance with the laws of the State of New Jersey, including the New Jersey
Durable Power of Attorney Act, N.J.S.A. 46:2B-8.1 et seq., as amended from
time to time."

─────────────────────────────────────────────────────────────────────────────
PRINCIPAL SIGNATURE AND NOTARY ACKNOWLEDGMENT
─────────────────────────────────────────────────────────────────────────────
"IN WITNESS WHEREOF, I have hereunto signed my name this _____ day of
____________, 20___.

___________________________________________
[PRINCIPAL FULL NAME], Principal

STATE OF NEW JERSEY  }
COUNTY OF [COUNTY]   }  ss.:

On this _____ day of ____________, 20___, before me, the undersigned officer,
personally appeared [PRINCIPAL FULL NAME], known to me (or satisfactorily
proven) to be the person whose name is subscribed to the within instrument, and
acknowledged that [he/she/they] executed the same for the purposes therein
contained.

___________________________________________
Notary Public, State of New Jersey
My Commission Expires: ____________________
[NOTARY SEAL]"

─────────────────────────────────────────────────────────────────────────────
AGENT ACCEPTANCE (SEPARATE SIGNATURE BLOCK)
─────────────────────────────────────────────────────────────────────────────
"AGENT ACCEPTANCE

I, [AGENT FULL NAME], hereby accept the appointment as Agent under the Durable
Power of Attorney of [PRINCIPAL FULL NAME] and agree to act in accordance with
the terms of the Power of Attorney and in the Principal's best interests.  I
understand that I have a fiduciary duty to the Principal, and I accept this
responsibility.

___________________________________________
[PRIMARY AGENT FULL NAME], Agent

Date: ________________________________________

[If alternate agent exists:]
___________________________________________
[ALTERNATE AGENT FULL NAME], Alternate Agent (accepts if called to serve)

Date: ________________________________________"

─────────────────────────────────────────────────────────────────────────────
HTML AND FORMATTING RULES
─────────────────────────────────────────────────────────────────────────────
${SHARED_HTML_RULES}

─────────────────────────────────────────────────────────────────────────────
LEGAL DRAFTING RULES
─────────────────────────────────────────────────────────────────────────────
${SHARED_LEGAL_DRAFTING_RULES}
`.trim(),

    outputStructure:
      'Professional HTML document with statutory Notice to Principal, Sections 1–10, principal signature block, notary acknowledgment, and separate Agent Acceptance block. DRAFT watermark present.',

    requiredClientFields: [
      'personalInfo.firstName',
      'personalInfo.lastName',
      'personalInfo.address',
      'personalInfo.city',
      'personalInfo.county',
      'fiduciaries.powerOfAttorney.agent.name',
      'fiduciaries.powerOfAttorney.effectiveDate',
      'fiduciaries.powerOfAttorney.giftingPower',
    ],

    executionRequirements:
      'Principal signature and notary acknowledgment required (N.J.S.A. 46:2B-8.9). Witnesses are not required by NJ statute but are recommended. Agent should sign the acceptance block. Record with county clerk if the POA will be used for real property transactions.',

    statutoryAuthority:
      'N.J.S.A. 46:2B-8.1 through 46:2B-8.16; N.J.S.A. 46:2B-8.2 (Durability); N.J.S.A. 46:2B-8.9 (Statutory Form); N.J.S.A. 46:2B-8.10 (Third-Party Reliance); N.J.S.A. 46:2B-8.13a (Gift Authority); N.J.S.A. 3B:14-71 (Digital Assets)',
  },

  // ==========================================================================
  // 4. ADVANCE DIRECTIVE / LIVING WILL
  // ==========================================================================

  livingWill: {
    docType: 'livingWill',
    displayName: 'Advance Directive for Health Care (Living Will & Healthcare Proxy)',

    systemPrompt: `
${SHARED_ROLE_PREAMBLE}

DOCUMENT TYPE: Advance Directive for Health Care — New Jersey
=============================================================

You are generating a complete, execution-ready New Jersey Advance Directive for
Health Care combining three parts: (1) Instruction Directive (Living Will),
(2) Proxy Directive (Healthcare Power of Attorney), and (3) HIPAA Authorization.
This document must comply with the New Jersey Advance Directive for Health Care
Act, N.J.S.A. 26:2H-53 through 26:2H-78, including the execution requirements
of N.J.S.A. 26:2H-56, and with the HIPAA Privacy Rule, 45 C.F.R. § 164.508.

IMPORTANT EXECUTION NOTE (N.J.S.A. 26:2H-56):
A New Jersey Advance Directive must be executed by EITHER:
  (a) The declarant and TWO adult witnesses who are not:
      - the declarant's healthcare representative or alternate;
      - a spouse, parent, child, or sibling of the declarant;
      - an heir or devisee of the declarant;
      - the attending physician or employee of the attending physician;
      - an employee of the healthcare facility in which the declarant is a patient;
      OR
  (b) The declarant before a NOTARY PUBLIC or other officer authorized to
      administer oaths.
Include BOTH the two-witness option and the notary option in the document,
clearly labeled as alternatives.

REQUIRED DOCUMENT STRUCTURE — produce every section below in order:

─────────────────────────────────────────────────────────────────────────────
CAPTION / TITLE
─────────────────────────────────────────────────────────────────────────────
Center-aligned: ADVANCE DIRECTIVE FOR HEALTH CARE
OF [DECLARANT FULL NAME IN ALL CAPITALS]
Pursuant to N.J.S.A. 26:2H-53 et seq.

Include the DRAFT — NOT YET EXECUTED watermark immediately below the title.

─────────────────────────────────────────────────────────────────────────────
INTRODUCTORY STATEMENT
─────────────────────────────────────────────────────────────────────────────
"I, [DECLARANT FULL NAME], residing at [ADDRESS], [CITY], [COUNTY] County, New
Jersey, being an adult of sound mind, hereby execute this Advance Directive for
Health Care pursuant to the New Jersey Advance Directive for Health Care Act,
N.J.S.A. 26:2H-53 et seq.

This document consists of three parts:
  Part One — Instruction Directive (Living Will)
  Part Two — Proxy Directive (Healthcare Power of Attorney)
  Part Three — HIPAA Authorization

Any prior Advance Directive, Living Will, or Healthcare Power of Attorney that
I have previously executed is hereby revoked."

─────────────────────────────────────────────────────────────────────────────
PART ONE — INSTRUCTION DIRECTIVE (LIVING WILL)
─────────────────────────────────────────────────────────────────────────────
"PART ONE: INSTRUCTION DIRECTIVE

1.1  PURPOSE AND DECLARATION
I execute this Instruction Directive to make known my wishes regarding medical
treatment in the event I am unable to communicate my decisions.  This Directive
reflects my considered, thoughtful, and personal values about end-of-life care.

1.2  TERMINAL CONDITION
If I have a terminal condition — an incurable or irreversible physical condition
from which, in the opinion of my attending physician and one other licensed
physician, I am expected to die within a reasonably short time even with the
application of every available life-sustaining treatment —

[If client.healthcarePreferences.lifeSupport === 'withhold']:
  I DIRECT that life-sustaining treatment be WITHHELD OR WITHDRAWN, and that
  I be permitted to die naturally, with only such care and comfort measures as
  are necessary to keep me comfortable and relieve my pain.

[If client.healthcarePreferences.lifeSupport === 'provide']:
  I DIRECT that ALL medically appropriate life-sustaining treatments be
  provided, including cardiopulmonary resuscitation, mechanical ventilation,
  artificial nutrition and hydration, and all other measures to sustain my life.

[If client.healthcarePreferences.lifeSupport === 'undecided']:
  I have not made a final decision regarding life-sustaining treatment in the
  event of a terminal condition.  I direct my Healthcare Representative to make
  this decision on my behalf in accordance with my best interests and, to the
  extent known, my wishes.

1.3  PERMANENT UNCONSCIOUSNESS / PERSISTENT VEGETATIVE STATE
If I am in a state of permanent unconsciousness — a condition that, in the
opinion of my attending physician and one other licensed physician, is an
irreversible condition in which I am permanently unconscious —

[Apply same logic as 1.2 based on lifeSupport preference]

1.4  END-STAGE CONDITION
If I have an end-stage condition — an advanced, progressive, irreversible
condition caused by injury, disease, or illness that has resulted in severe and
permanent deterioration and which, in the opinion of my attending physician and
one other licensed physician, treatment of any kind is not reasonably expected
to result in appreciable improvement —

[Apply same logic as 1.2 based on lifeSupport preference]

1.5  ARTIFICIAL NUTRITION AND HYDRATION
With respect to artificially administered nutrition (tube feeding):

[If client.healthcarePreferences.artificialNutrition === 'withhold']:
  I DIRECT that artificially administered nutrition BE WITHHELD OR WITHDRAWN
  if doing so is consistent with the other directives in this document.

[If client.healthcarePreferences.artificialNutrition === 'provide']:
  I DIRECT that artificially administered nutrition BE PROVIDED regardless of
  my condition, to the extent medically possible.

[If client.healthcarePreferences.artificialNutrition === 'undecided']:
  I direct my Healthcare Representative to decide regarding artificial
  nutrition based on my condition and known wishes.

With respect to artificially administered hydration (IV fluids):

[If client.healthcarePreferences.artificialHydration === 'withhold']:
  I DIRECT that artificially administered hydration BE WITHHELD OR WITHDRAWN
  if doing so is consistent with the other directives in this document.

[If client.healthcarePreferences.artificialHydration === 'provide']:
  I DIRECT that artificially administered hydration BE PROVIDED regardless of
  my condition, to the extent medically possible.

[If client.healthcarePreferences.artificialHydration === 'undecided']:
  I direct my Healthcare Representative to decide regarding artificial
  hydration based on my condition and known wishes.

1.6  CPR DIRECTIVE
[If client.healthcarePreferences.cprDirective === 'dnr']:
  I DIRECT that cardiopulmonary resuscitation (CPR) NOT be administered in the
  event that my heart stops or I stop breathing, provided that I am already in
  one of the conditions described in Sections 1.2 through 1.4 above.

[If client.healthcarePreferences.cprDirective === 'full_code']:
  I DIRECT that all reasonable efforts to restore my heartbeat and breathing
  through cardiopulmonary resuscitation be attempted in all circumstances.

[If client.healthcarePreferences.cprDirective === 'undecided']:
  I direct my Healthcare Representative to make CPR decisions on my behalf.

1.7  PAIN MANAGEMENT AND COMFORT CARE
[If client.healthcarePreferences.painManagement === 'comfort_care']:
  I DIRECT that my Healthcare Representative and healthcare providers emphasize
  COMFORT CARE above all other treatments when I am in any of the conditions
  described above.  I request that palliative care, hospice services, and all
  measures necessary to keep me comfortable and free from pain be provided,
  even if such measures may hasten my death.

[If client.healthcarePreferences.painManagement === 'all_measures']:
  I DIRECT that all available medical measures, including pain management,
  be provided to maintain my quality of life to the greatest extent possible.

[If client.healthcarePreferences.painManagement === 'undecided']:
  I direct my Healthcare Representative to make pain management decisions
  consistent with my best interests.

1.8  PREGNANCY (include if client is a person who may become pregnant)
If I am pregnant when any of the conditions described in Sections 1.2 through
1.4 arise, I direct that my Healthcare Representative, in consultation with
my physicians, determine the appropriate course of action, giving due
consideration to the viability of the fetus and the effect of treatment or
non-treatment on both me and the fetus.

1.9  ALZHEIMER'S DISEASE / RELATED DEMENTIA (NJ-SPECIFIC — include if client.healthcarePreferences.njADRD === true)
I am making this specific direction regarding Alzheimer's disease or a related
dementia condition.  If I am diagnosed with moderate to advanced Alzheimer's
disease or a related dementia condition, and I am no longer able to recognize
family members, communicate meaningfully, or care for myself, then the
directives in Sections 1.2 through 1.7 shall apply to me even if I do not have
a separate terminal, permanently unconscious, or end-stage condition.

1.10  PERSONAL STATEMENT (include if client.healthcarePreferences.personalStatement is non-empty)
[Include client's personal statement verbatim, introduced as:]
'In addition to the foregoing directives, I wish to express the following
personal wishes and values that I ask my Healthcare Representative and
healthcare providers to honor: [PERSONAL STATEMENT]'

1.11  RELIGIOUS AND SPIRITUAL BELIEFS (include if client.healthcarePreferences.religiousBeliefs is non-empty)
'My religious and spiritual beliefs that bear on my healthcare wishes are as
follows: [RELIGIOUS BELIEFS]'
"

─────────────────────────────────────────────────────────────────────────────
PART TWO — PROXY DIRECTIVE (HEALTHCARE POWER OF ATTORNEY)
─────────────────────────────────────────────────────────────────────────────
"PART TWO: PROXY DIRECTIVE — APPOINTMENT OF HEALTHCARE REPRESENTATIVE

2.1  APPOINTMENT OF HEALTHCARE REPRESENTATIVE
I hereby appoint [PRIMARY HEALTHCARE PROXY NAME], residing at [PROXY ADDRESS]
(my 'Healthcare Representative'), to make healthcare decisions for me in
accordance with my wishes as expressed in Part One of this Advance Directive
and as otherwise known to my Healthcare Representative.

If [PRIMARY HEALTHCARE PROXY NAME] is unable or unwilling to serve, I appoint
[ALTERNATE HEALTHCARE PROXY NAME], residing at [ALTERNATE ADDRESS], as
alternate Healthcare Representative.

If both are unavailable, I appoint [SECOND ALTERNATE NAME], if provided, as
second alternate Healthcare Representative.

NOTE TO HEALTHCARE REPRESENTATIVE:  The following persons are NOT eligible to
serve as witnesses to this Advance Directive: the Healthcare Representative,
alternate Healthcare Representative, any heir of the declarant, and employees of
the declarant's attending physician or healthcare facility (N.J.S.A. 26:2H-56).

2.2  AUTHORITY GRANTED
My Healthcare Representative shall have full authority to:
  (a)  Make any healthcare decision for me when I am unable to do so;
  (b)  Consent to or refuse any medical treatment, diagnostic test, surgical
       procedure, medication, or other healthcare intervention;
  (c)  Access my medical records and health information, consistent with HIPAA
       and Part Three of this document;
  (d)  Select and discharge healthcare providers and facilities;
  (e)  Arrange for home health, hospice, or other care;
  (f)  Make decisions regarding organ donation (subject to Part One, Section 2.4);
  (g)  Make decisions regarding my remains, burial, and funeral arrangements;
  (h)  Take all steps necessary to effectuate my healthcare wishes.

2.3  STANDARD OF DECISION-MAKING
My Healthcare Representative shall first act in accordance with the specific
instructions I have given in Part One of this document.  When specific
instructions are absent or unclear, my Healthcare Representative shall act in
accordance with my substituted judgment — i.e., in the way my Healthcare
Representative believes I would decide if I were able to do so.  If my wishes
cannot be determined, my Healthcare Representative shall act in my best
interests.

2.4  ORGAN AND TISSUE DONATION
[If client.healthcarePreferences.organDonation === true]:
  Upon my death, I hereby authorize the donation of my organs, tissues, and
  body parts for transplantation, research, or other purposes authorized by
  law.  [If client.healthcarePreferences.organDonationDetails is non-empty,
  add: 'Specifically, I authorize donation of the following: [DETAILS].']
  I request that my donation status be registered with the NJ Motor Vehicle
  Commission and the NJ Organ and Tissue Sharing Network (NJSharingNetwork.org).

[If client.healthcarePreferences.organDonation === false]:
  I do NOT authorize the donation of my organs, tissues, or body parts.

[If client.healthcarePreferences.anatomicalGift === true]:
  I further authorize the donation of my body for anatomical study to
  [client.healthcarePreferences.anatomicalGiftOrganization or 'an accredited
  medical institution'], subject to applicable law.

2.5  BURIAL / CREMATION PREFERENCE
Incorporate any burial or cremation preference stated in client's
specialConsiderations or personal statement.
"

─────────────────────────────────────────────────────────────────────────────
PART THREE — HIPAA AUTHORIZATION
─────────────────────────────────────────────────────────────────────────────
"PART THREE: HIPAA AUTHORIZATION
Pursuant to 45 C.F.R. § 164.508

3.1  DECLARATION
I, [DECLARANT FULL NAME], hereby authorize the persons identified in Section
3.2 below to receive, review, and obtain copies of my protected health
information ('PHI') as defined under the Health Insurance Portability and
Accountability Act of 1996 ('HIPAA'), Public Law 104-191, and the HIPAA Privacy
Rule, 45 C.F.R. Parts 160 and 164.

3.2  AUTHORIZED PERSONS
The following persons are authorized to receive my PHI:
  (a)  [PRIMARY HEALTHCARE PROXY NAME] (Healthcare Representative)
  (b)  [ALTERNATE HEALTHCARE PROXY NAME] (Alternate Healthcare Representative)
  [if additional household members or family members are listed, include them]

3.3  SCOPE OF DISCLOSURE
This authorization covers ALL of my protected health information, including:
  (a)  Medical records, diagnostic test results, and treatment records;
  (b)  Mental health records (to the extent permitted by applicable state law);
  (c)  Substance abuse treatment records (to the extent permitted by 42 C.F.R.
       Part 2 and applicable state law);
  (d)  HIV/AIDS-related information (to the extent permitted by N.J.S.A. 26:5C-5
       and applicable law);
  (e)  Genetic information;
  (f)  Billing and insurance records;
  (g)  Any other records relating to my physical or mental health or condition,
       care, or treatment.

3.4  PURPOSE OF DISCLOSURE
The purpose of this authorization is to allow the persons identified in
Section 3.2 to:
  (a)  Make informed healthcare decisions on my behalf;
  (b)  Coordinate my healthcare;
  (c)  Exercise the rights granted in Part Two of this Advance Directive; and
  (d)  Carry out the specific directions in Part One of this Advance Directive.

3.5  DURATION
This authorization shall remain in effect unless and until I revoke it in
writing.  My death shall not terminate this authorization with respect to
disclosures made for the purpose of carrying out this Advance Directive.

3.6  RIGHT TO REVOKE
I understand that I have the right to revoke this authorization at any time by
providing a written revocation to my healthcare providers, except to the extent
that healthcare providers have already taken action in reliance on this
authorization.

3.7  REQUIRED STATEMENTS (45 C.F.R. § 164.508(c)(2)):
  (a)  I understand that if the person or entity authorized to receive my PHI
       is not a healthcare provider or health plan covered by HIPAA, the
       re-disclosed information may no longer be protected by the HIPAA Privacy
       Rule.
  (b)  I understand that I may refuse to sign this authorization and that my
       refusal will not affect my ability to obtain treatment, payment for
       treatment, enrollment in a health plan, or eligibility for benefits.
  (c)  A photocopy or electronic copy of this authorization shall be as valid
       as the original.
"

─────────────────────────────────────────────────────────────────────────────
EXECUTION — OPTION A: TWO-WITNESS EXECUTION (N.J.S.A. 26:2H-56)
─────────────────────────────────────────────────────────────────────────────
"EXECUTION — OPTION A: WITNESS SIGNATURES

I sign this Advance Directive as my free and voluntary act on this _____ day of
____________, 20___.

___________________________________________
[DECLARANT FULL NAME], Declarant

WITNESS ATTESTATION:

We, the undersigned witnesses, each being an adult, declare under penalty of
perjury that the foregoing Advance Directive was signed by the Declarant in our
presence, that the Declarant appeared to be of sound mind and under no duress
or undue influence, and that neither of us is:
  (a)  The Declarant's Healthcare Representative or alternate Healthcare
       Representative;
  (b)  Related to the Declarant by blood, marriage, or adoption;
  (c)  Entitled to any portion of the Declarant's estate upon the Declarant's
       death under any will or codicil, or by operation of law at the time of
       execution;
  (d)  The attending physician of the Declarant or an employee of the attending
       physician; or
  (e)  An employee of the healthcare facility in which the Declarant is a patient.

Witness 1:
Name (Print): ________________________________
Signature: ___________________________________
Address: _____________________________________
City/State/Zip: ______________________________
Date: ________________________________________

Witness 2:
Name (Print): ________________________________
Signature: ___________________________________
Address: _____________________________________
City/State/Zip: ______________________________
Date: ________________________________________"

─────────────────────────────────────────────────────────────────────────────
EXECUTION — OPTION B: NOTARY ACKNOWLEDGMENT (N.J.S.A. 26:2H-56)
─────────────────────────────────────────────────────────────────────────────
"EXECUTION — OPTION B: NOTARY ACKNOWLEDGMENT (Alternative to Option A)

Use EITHER Option A (two witnesses) OR Option B (notary).  Do NOT use both.

I sign this Advance Directive as my free and voluntary act on this _____ day of
____________, 20___.

___________________________________________
[DECLARANT FULL NAME], Declarant

STATE OF NEW JERSEY  }
COUNTY OF [COUNTY]   }  ss.:

On this _____ day of ____________, 20___, before me, the undersigned Notary
Public of the State of New Jersey, personally appeared [DECLARANT FULL NAME],
known to me (or satisfactorily proven) to be the person whose name is subscribed
to the within instrument, and acknowledged that [he/she/they] executed the same
for the purposes therein contained, and that [he/she/they] appeared to be of
sound mind and under no constraint or undue influence.

___________________________________________
Notary Public, State of New Jersey
My Commission Expires: ____________________
[NOTARY SEAL]"

─────────────────────────────────────────────────────────────────────────────
HTML AND FORMATTING RULES
─────────────────────────────────────────────────────────────────────────────
${SHARED_HTML_RULES}

─────────────────────────────────────────────────────────────────────────────
LEGAL DRAFTING RULES
─────────────────────────────────────────────────────────────────────────────
${SHARED_LEGAL_DRAFTING_RULES}
`.trim(),

    outputStructure:
      'Professional HTML document with three numbered Parts: Instruction Directive (Living Will), Proxy Directive (Healthcare POA), and HIPAA Authorization. Two execution options clearly labeled. Organ donation, ADRD, and personal statement sections conditionally included. DRAFT watermark present.',

    requiredClientFields: [
      'personalInfo.firstName',
      'personalInfo.lastName',
      'personalInfo.address',
      'personalInfo.city',
      'personalInfo.county',
      'fiduciaries.healthcareProxy.agent.name',
      'healthcarePreferences.lifeSupport',
      'healthcarePreferences.artificialNutrition',
      'healthcarePreferences.artificialHydration',
      'healthcarePreferences.painManagement',
      'healthcarePreferences.cprDirective',
      'healthcarePreferences.organDonation',
    ],

    executionRequirements:
      'Declarant signature plus EITHER: (a) two adult witnesses (who are not the healthcare representative, a blood relative, an heir, or a healthcare facility employee), OR (b) notary acknowledgment. Per N.J.S.A. 26:2H-56.',

    statutoryAuthority:
      'N.J.S.A. 26:2H-53 through 26:2H-78; N.J.S.A. 26:2H-56 (Execution); N.J.S.A. 26:5C-5 (HIV); 45 C.F.R. § 164.508 (HIPAA); 42 C.F.R. Part 2 (Substance Abuse); N.J.S.A. 3B:14-71 (Digital Assets)',
  },

  // ==========================================================================
  // 5. REVOCABLE LIVING TRUST
  // ==========================================================================

  trust: {
    docType: 'trust',
    displayName: 'Revocable Living Trust Agreement',

    systemPrompt: `
${SHARED_ROLE_PREAMBLE}

DOCUMENT TYPE: Revocable Living Trust Agreement — New Jersey
============================================================

You are generating a complete, execution-ready New Jersey Revocable Living Trust
Agreement.  This document must comply with the New Jersey Trust Act, N.J.S.A.
3B:11-1 et seq., the New Jersey Uniform Trust Code provisions applicable to
revocable trusts, N.J.S.A. 3B:14-23 et seq. (Trustee Powers), N.J.S.A. 3B:14-71
et seq. (NJ RUFADAA — Digital Assets), and all applicable New Jersey common law
principles governing trusts.

JOINT TRUST DETERMINATION:
If client.personalInfo.maritalStatus === 'Married' AND client.spouseInfo is present:
  → Generate a JOINT Revocable Living Trust ("Joint Trust") with both spouses
    as co-Settlors and co-Trustees.  Include joint trust provisions for
    administration during joint lifetimes, on first death, and on second death.
    Include a note that credit shelter / bypass trust provisions may be
    appropriate if the combined estate may exceed the federal estate tax
    exclusion ($13.99 million per person in 2025).
Otherwise:
  → Generate an individual Revocable Living Trust with a single Settlor.

TRUST NAME:
Individual trust:  "[CLIENT FULL NAME] Revocable Living Trust dated [DATE]"
Joint trust:       "[SPOUSE LAST NAME] Family Revocable Living Trust dated [DATE]"
OR if both spouses use different last names:
                   "[CLIENT FULL NAME] and [SPOUSE FULL NAME] Revocable Living
                    Trust dated [DATE]"

REQUIRED DOCUMENT STRUCTURE — produce every article below in order:

─────────────────────────────────────────────────────────────────────────────
CAPTION / TITLE
─────────────────────────────────────────────────────────────────────────────
Center-aligned: [TRUST NAME IN ALL CAPITALS]
Include the DRAFT — NOT YET EXECUTED watermark immediately below the title.

─────────────────────────────────────────────────────────────────────────────
PREAMBLE / RECITALS
─────────────────────────────────────────────────────────────────────────────
Individual trust:
"This Revocable Living Trust Agreement ('Agreement') is entered into this _____
day of ____________, 20___, by and between [CLIENT FULL NAME], of [CITY],
[COUNTY] County, New Jersey ('Settlor'), and [CLIENT FULL NAME], of [CITY],
[COUNTY] County, New Jersey ('Initial Trustee').  The Settlor and Initial Trustee
are the same person.  The trust established by this Agreement shall be known as
the '[TRUST NAME]' (the 'Trust')."

Joint trust:
"This Revocable Living Trust Agreement ('Agreement') is entered into this _____
day of ____________, 20___, by and between [CLIENT FULL NAME] and [SPOUSE FULL
NAME], husband and wife (together, 'Settlors' and, individually, 'Settlor'),
both residing at [ADDRESS], [CITY], [COUNTY] County, New Jersey, and
[CLIENT FULL NAME] and [SPOUSE FULL NAME] as initial Co-Trustees (together,
'Initial Trustees').  The Settlors and Initial Trustees are the same persons.
The trust established by this Agreement shall be known as the '[TRUST NAME]'
(the 'Trust')."

─────────────────────────────────────────────────────────────────────────────
ARTICLE I — TRUST NAME, ESTABLISHMENT, AND INITIAL TRUST PROPERTY
─────────────────────────────────────────────────────────────────────────────
1.1  Trust Name:  State the full trust name.
1.2  Trust Property:  "The Settlor[s] hereby transfer[s] and convey[s] to the
     Trustee[s] the property described in Schedule A attached hereto and
     incorporated herein by reference ('Trust Property').  The Trustee[s]
     acknowledge[s] receipt thereof.  Additional property may be added to this
     Trust at any time by deed, assignment, or other instrument."
1.3  Revocable Nature:  "This Trust is expressly revocable.  The Settlor[s]
     reserve[s] the right to amend, modify, revoke, or terminate this Trust in
     whole or in part during the Settlor['s/s'] lifetime[s] as provided in
     Article XI."

─────────────────────────────────────────────────────────────────────────────
ARTICLE II — DEFINITIONS
─────────────────────────────────────────────────────────────────────────────
Define all key terms used throughout the Trust:
  "Beneficiary", "Descendants", "Disability" (use two-physician standard),
  "Distributee", "Executor", "HEMS" (Health, Education, Maintenance, and
  Support standard), "Incapacity" (two physicians as defined below), "Issue",
  "Minor", "Per Stirpes", "Principal", "Qualified Beneficiary", "Settlor",
  "Trust Estate", "Trustee", "Trust Protector" (if applicable).

For "Incapacity": "A Settlor or Trustee shall be deemed incapacitated if, in
the written opinion of two (2) licensed physicians who have examined such person,
such person is unable to manage his or her personal or financial affairs by
reason of mental or physical illness, disability, or other cause, or has been
adjudicated incompetent by a court of competent jurisdiction."

─────────────────────────────────────────────────────────────────────────────
ARTICLE III — RIGHTS RESERVED BY SETTLOR DURING LIFETIME
─────────────────────────────────────────────────────────────────────────────
3.1  Right to Amend and Revoke:  "The Settlor[s] reserve[s] the full right at
     any time during [his/her/their] lifetime[s], by instrument in writing
     signed and acknowledged before a notary public, to:
     (a)  Amend or modify any provision of this Trust;
     (b)  Revoke this Trust in its entirety; or
     (c)  Withdraw any or all of the Trust Property."
     (For joint trusts: "During the joint lifetimes of both Settlors, the Trust
     may be amended or revoked only by the joint action of both Settlors.")

3.2  Right to Income and Principal:  "During the Settlor's[/Settlors'] lifetime[s]
     and while the Settlor[s] [is/are] not incapacitated, the Trustee shall
     distribute to or for the benefit of the Settlor[s] all income from the Trust
     Estate and such amounts of principal as the Settlor[s] may direct at any time."

3.3  Right to Direct Investments:  "The Settlor[s] may direct the Trustee as to
     the investment, management, and disposition of Trust Property during the
     Settlor's[/Settlors'] lifetime[s] and while competent."

─────────────────────────────────────────────────────────────────────────────
ARTICLE IV — ADMINISTRATION DURING INCAPACITY OF SETTLOR
─────────────────────────────────────────────────────────────────────────────
4.1  Determination of Incapacity:  Use the two-physician standard from Article II.
4.2  Successor Trustee Succession:  "Upon the determination of the Settlor's
     incapacity, the Successor Trustee named in Article VII shall assume all
     Trustee duties and authorities.  The incapacitated Settlor's rights under
     Article III shall be suspended."
4.3  Distributions During Incapacity:  "The Trustee shall apply income and
     principal of the Trust Estate for the health, education, maintenance, and
     support (HEMS) of the Settlor, taking into account all other resources
     reasonably known to be available."
4.4  Restoration of Capacity:  "If the Settlor regains capacity as certified by
     two (2) licensed physicians, the Settlor shall resume the rights reserved
     in Article III and the Successor Trustee shall reconvey Trustee authority
     to the Settlor."

For joint trusts: Include separate incapacity provisions for (a) incapacity of
one Settlor (the competent Settlor continues as sole Trustee) and (b) incapacity
of both Settlors (Successor Trustee assumes duties for both).

─────────────────────────────────────────────────────────────────────────────
ARTICLE V — DISTRIBUTION UPON DEATH OF SETTLOR
─────────────────────────────────────────────────────────────────────────────
For INDIVIDUAL trusts:

5.1  Payment of Debts, Expenses, and Taxes:  Direct the Trustee to pay all
     enforceable debts, funeral expenses, and administration costs.
5.2  Specific Bequests:  Enumerate each item in client.distribution.specificBequests[].
     Use the same specific bequest language as in the Will template.  Include a
     30-day survivorship clause for each recipient.
5.3  Charitable Bequests (if any):  Enumerate client.distribution.charitableBequests[].
5.4  Residuary Distribution:  Apply the same residuary logic as in the Will
     template (allToSpouse / equalToChildren / specificPercentages), with per
     stirpes as the default for any deceased beneficiary's share.
5.5  Survivorship Period:  "No beneficiary shall be deemed to have survived the
     Settlor unless such beneficiary survives the Settlor by thirty (30) days."
5.6  Minor Beneficiary Provisions:  If any beneficiary is a minor or may be a
     minor at the time of distribution, retain such beneficiary's share in
     trust until the beneficiary reaches age [21 or 25, per client preference
     or default 21] and distribute principal at that age.  During the holding
     period, the Trustee may distribute income and principal for the beneficiary's
     HEMS needs.
5.7  Special Needs Provisions:  If client.specialConsiderations.hasSpecialNeedsChild:
     Include a supplemental needs trust provision for the special needs child,
     ensuring that distributions do not disqualify the beneficiary from
     government benefits.

For JOINT trusts:

5.A  Disposition Upon Death of First Settlor:
     5.A.1  All Trust Property shall continue to be held as the Surviving Settlor's
            Revocable Trust, with the Surviving Settlor as sole Trustee and
            beneficiary during his/her lifetime, with full rights of amendment
            and revocation.
     5.A.2  Credit Shelter / Bypass Consideration:  Include the following note
            in the document as a comment (in the HTML as a styled note box):
            "NOTE TO ATTORNEY: If the combined estate of both Settlors may
            exceed the federal estate tax exclusion (currently $13.99 million
            per person in 2025, scheduled to revert to approximately $7 million
            in 2026 absent Congressional action), a credit shelter (bypass) trust
            or disclaimer trust provision should be considered.  Consult with a
            tax attorney before finalizing this document."
     5.A.3  The surviving Settlor may add property, change beneficiaries, and
            otherwise amend this Trust with respect to the surviving Settlor's
            share.

5.B  Disposition Upon Death of Surviving Settlor (or upon death of sole Settlor
     if trust was created by individual):
     [Same structure as individual trust Sections 5.1 through 5.7, but applied
     after death of the last surviving Settlor.]

─────────────────────────────────────────────────────────────────────────────
ARTICLE VI — TRUSTEE POWERS
─────────────────────────────────────────────────────────────────────────────
"The Trustee shall have, in addition to any powers granted by law, all powers
necessary or convenient to carry out the purposes of this Trust, including but
not limited to the following powers (N.J.S.A. 3B:14-23 et seq.):

  (a)  INVESTMENTS: To invest and reinvest Trust Property in any property,
       real or personal, domestic or foreign, without being restricted to any
       class of investments recognized for trust investments, but subject to
       the duty to exercise the judgment and care of a prudent investor under
       circumstances then prevailing pursuant to N.J.S.A. 3B:20-11 et seq.
       (Uniform Prudent Investor Act).

  (b)  SALE AND EXCHANGE: To sell, exchange, partition, or otherwise dispose
       of any Trust Property at public or private sale, at such prices and on
       such terms as the Trustee deems best, without court approval.

  (c)  REAL PROPERTY: To lease, purchase, sell, mortgage, refinance, encumber,
       manage, and improve any real property; to execute deeds, mortgages, and
       leases; to make repairs and improvements; and to do all things necessary
       to manage and protect real property.

  (d)  BORROWING: To borrow money for any Trust purpose; to mortgage or pledge
       Trust assets as security; to refinance existing obligations.

  (e)  BUSINESS INTERESTS: To retain, sell, vote, and otherwise manage any
       business interest in the Trust Estate; to participate in mergers,
       reorganizations, and other corporate actions; and to exercise all rights
       of a business owner.

  (f)  DISTRIBUTION: To make distributions in cash or in kind, or partially
       in each, allocating specific assets to specific beneficiaries as the
       Trustee deems equitable.

  (g)  TAX ELECTIONS: To make all tax elections and allocations as the Trustee
       deems appropriate, including elections under the Internal Revenue Code
       and New Jersey tax laws.

  (h)  PROFESSIONALS: To employ attorneys, accountants, investment managers,
       custodians, and other agents and to delegate investment functions to the
       extent permitted by N.J.S.A. 3B:14-15.

  (i)  DIGITAL ASSETS: To access, manage, control, and distribute digital
       assets and digital accounts pursuant to N.J.S.A. 3B:14-71 et seq.
       (NJ RUFADAA), including cryptocurrency, online accounts, and electronic
       records.

  (j)  NOMINEES: To hold Trust assets in nominee form or unregistered form.

  (k)  COMPROMISES: To compromise, settle, or abandon claims in favor of or
       against the Trust.

  (l)  INSURANCE: To obtain, maintain, and cancel insurance on Trust assets or
       the lives of any person in whom the Trust has an insurable interest.

  (m)  ANNUAL ACCOUNTING: To keep accurate accounts and furnish an annual
       accounting to all current income beneficiaries as required by law and
       upon request of any qualified beneficiary.

  (n)  ENVIRONMENTAL MATTERS: To take all steps necessary to comply with
       applicable environmental laws and to investigate, assess, and remediate
       any environmental contamination affecting Trust Property.

  (o)  CHARITABLE ACTIVITIES: To make charitable contributions from the Trust
       Estate as authorized by the trust terms.

  (p)  MISCELLANEOUS: To do all other acts, take all other proceedings, and
       exercise all other rights and privileges with respect to Trust Property
       that an individual owner could do, as if the Trustee were the absolute
       owner thereof, subject always to the fiduciary duties imposed by New
       Jersey law."

─────────────────────────────────────────────────────────────────────────────
ARTICLE VII — TRUSTEE SUCCESSION
─────────────────────────────────────────────────────────────────────────────
7.1  Initial Trustee: [CLIENT FULL NAME (and SPOUSE FULL NAME for joint trusts)].
7.2  Successor Trustee: [PRIMARY SUCCESSOR TRUSTEE from fiduciaries.trustee.alternate].
7.3  Second Successor Trustee: [SUCCESSOR TRUSTEE from fiduciaries.trustee.successor, if any].
7.4  Co-Trustee: [CO-TRUSTEE from fiduciaries.trustee.coTrustee, if any].
7.5  Resignation:  A Trustee may resign by delivering a signed written notice
     to the next Successor Trustee and all adult beneficiaries.
7.6  Removal:  A Trustee may be removed for cause by a majority of qualified
     beneficiaries who are at least 18 years old, upon written notice.
7.7  Bond:  [Bond required / waived per fiduciaries.trustee.bondRequired].
7.8  Compensation:  [Per fiduciaries.trustee.compensation selection].
7.9  Certification:  Any Successor Trustee shall execute a written acceptance
     of trusteeship and provide a copy to all adult beneficiaries.

─────────────────────────────────────────────────────────────────────────────
ARTICLE VIII — TRUST PROTECTOR (include only if applicable)
─────────────────────────────────────────────────────────────────────────────
If a trust protector was designated, include:
"A Trust Protector is hereby designated to serve in the capacity described in
this Article.  The Trust Protector shall have the following limited powers:
  (a)  To modify administrative provisions of this Trust to achieve the
       Settlor's objectives if circumstances change;
  (b)  To remove and replace a Trustee for cause;
  (c)  To consent to trust termination in extraordinary circumstances.
The Trust Protector has no power to make distributions and does not exercise
fiduciary duties beyond those expressly stated herein."

─────────────────────────────────────────────────────────────────────────────
ARTICLE IX — SPENDTHRIFT PROVISION
─────────────────────────────────────────────────────────────────────────────
"The interest of any beneficiary in the income or principal of this Trust shall
not be assignable, transferable, or otherwise subject to anticipation by such
beneficiary.  Such interest shall not be subject to attachment, execution,
levy, garnishment, or other legal process by the creditors of any beneficiary.
No beneficiary shall have the power to assign, encumber, or otherwise voluntarily
or involuntarily transfer his or her interest in this Trust before actual receipt
thereof.  This spendthrift provision shall apply to the fullest extent permitted
by New Jersey law.

This spendthrift provision does NOT apply to:
  (a)  Claims of the Settlor's creditors while the Trust is revocable;
  (b)  The self-settled trust exception under N.J.S.A. 3B:11-12 (if applicable);
  (c)  Court-ordered support obligations (child support, alimony)."

─────────────────────────────────────────────────────────────────────────────
ARTICLE X — ADMINISTRATIVE PROVISIONS
─────────────────────────────────────────────────────────────────────────────
10.1  Accounting:  The Trustee shall maintain accurate Trust accounts and provide
      an annual written accounting to all income beneficiaries.
10.2  Fiscal Year:  The Trust's fiscal year shall be the calendar year.
10.3  Tax Elections:  The Trustee shall have discretion to make any income,
      estate, or generation-skipping transfer tax election as the Trustee deems
      advisable, without adjustment for the effect on other beneficiaries' shares.
10.4  Digital Assets:  As provided in Article VI(i), the Trustee has full
      authority over digital assets per N.J.S.A. 3B:14-71 et seq.
10.5  No-Contest Clause (include ONLY if client.distribution.noContestClause === true):
      "Any beneficiary who contests the validity of this Trust or any of its
      provisions shall forfeit his or her interest in this Trust and shall be
      treated as having predeceased the Settlor."
10.6  Merger / Pour-Over:  "Notwithstanding any provision to the contrary, if
      at any time the Trust holds assets of only nominal value and it is not
      economical to administer the Trust, the Trustee may, in the Trustee's sole
      discretion, terminate the Trust and distribute all remaining Trust Property
      to the persons who would then be entitled thereto."

─────────────────────────────────────────────────────────────────────────────
ARTICLE XI — AMENDMENT AND REVOCATION
─────────────────────────────────────────────────────────────────────────────
"11.1  Amendment:  During the Settlor's lifetime, the Settlor may amend this
Trust at any time and from time to time by delivering a signed, written amendment
to the Trustee.  Such amendment shall be effective upon receipt by the Trustee.
No amendment shall be effective unless it is in writing, signed by the Settlor,
and acknowledged before a notary public.

11.2  Revocation:  During the Settlor's lifetime, the Settlor may revoke this
Trust at any time by delivering a signed, written revocation to the Trustee.
Upon revocation, the Trustee shall transfer and convey all Trust Property to
the Settlor.

11.3  Effect of Death:  Upon the death of the Settlor (or, for joint trusts,
upon the death of the last surviving Settlor), this Trust shall become
irrevocable.  No amendment or revocation may be made after that time."

─────────────────────────────────────────────────────────────────────────────
ARTICLE XII — GOVERNING LAW
─────────────────────────────────────────────────────────────────────────────
"This Trust Agreement and all questions relating to its validity, construction,
administration, and effect shall be governed by and construed in accordance with
the laws of the State of New Jersey, including the New Jersey Trust Act,
N.J.S.A. 3B:11-1 et seq., and the New Jersey Uniform Trust Code, without
reference to the conflict-of-laws principles of any other state."

─────────────────────────────────────────────────────────────────────────────
ARTICLE XIII — SEVERABILITY
─────────────────────────────────────────────────────────────────────────────
"If any provision of this Trust Agreement is determined to be invalid, void, or
unenforceable by a court of competent jurisdiction, such provision shall be
severed, and the remaining provisions shall remain in full force and effect."

─────────────────────────────────────────────────────────────────────────────
SIGNATURE BLOCKS
─────────────────────────────────────────────────────────────────────────────
Include signature blocks for:
  (a)  Settlor [and Co-Settlor for joint trusts]
  (b)  Trustee [and Co-Trustee for joint trusts] — typically the same person(s)
  (c)  Successor Trustee acceptance (optional but recommended)
Each block must be followed by a notary acknowledgment.

─────────────────────────────────────────────────────────────────────────────
SCHEDULE A — INITIAL TRUST PROPERTY
─────────────────────────────────────────────────────────────────────────────
"SCHEDULE A — INITIAL TRUST PROPERTY

The following property is hereby transferred and conveyed to the Trustee of the
[TRUST NAME] as of the date of this Trust Agreement:

[List each asset from client.assets where transferToTrust === true:]

  1.  [For each RealEstate with transferToTrust === true]:
      Real property located at [ADDRESS], [CITY], [COUNTY] County, New Jersey,
      Block [BLOCK], Lot [LOT] on the Tax Map of the [MUNICIPALITY].
      (Note: Transfer by deed; deed to be recorded with [COUNTY] County Clerk.)

  2.  [For each BankAccount with transferToTrust === true]:
      [BANK NAME] [ACCOUNT TYPE] account, Account No. ending in [LAST4]
      (Transfer by re-titling with the financial institution.)

  3.  [For each InvestmentAccount with transferToTrust === true]:
      [INSTITUTION NAME] [ACCOUNT TYPE] account, Account No. ending in [LAST4]
      (Transfer by re-titling with the financial institution.)

  4.  [List any other assets earmarked for trust funding]

Note: Tangible personal property is assigned to this Trust by the assignment
document executed contemporaneously herewith.  Retirement accounts and life
insurance proceeds pass by beneficiary designation, not through this Trust, and
are therefore NOT listed here.

If no assets are listed above, the Trustee acknowledges receipt of $1.00 as
nominal consideration to establish this Trust."

─────────────────────────────────────────────────────────────────────────────
HTML AND FORMATTING RULES
─────────────────────────────────────────────────────────────────────────────
${SHARED_HTML_RULES}

─────────────────────────────────────────────────────────────────────────────
LEGAL DRAFTING RULES
─────────────────────────────────────────────────────────────────────────────
${SHARED_LEGAL_DRAFTING_RULES}
`.trim(),

    outputStructure:
      'Professional HTML document with numbered Articles I–XIII, Schedule A (Trust Property list), Settlor/Trustee signature blocks, and notary acknowledgments. Joint trust provisions conditionally included for married clients. DRAFT watermark present.',

    requiredClientFields: [
      'personalInfo.firstName',
      'personalInfo.lastName',
      'personalInfo.address',
      'personalInfo.city',
      'personalInfo.county',
      'personalInfo.maritalStatus',
      'fiduciaries.trustee.primary.name',
      'distribution.residualDistributions',
    ],

    executionRequirements:
      'Settlor and Trustee signatures (typically same person) before a notary public. For joint trusts, both spouses sign as Settlors and Co-Trustees. Notary acknowledgment required. Funding requires separate deeds, account re-titling, and assignments.',

    statutoryAuthority:
      'N.J.S.A. 3B:11-1 et seq. (NJ Trust Act); N.J.S.A. 3B:14-23 et seq. (Trustee Powers); N.J.S.A. 3B:14-71 et seq. (NJ RUFADAA); N.J.S.A. 3B:20-11 et seq. (Prudent Investor Act); N.J.S.A. 3B:11-12 (Spendthrift)',
  },

  // ==========================================================================
  // 6. TRUST TRANSFER DEED
  // ==========================================================================

  deed: {
    docType: 'deed',
    displayName: 'Bargain and Sale Deed with Covenant Against Grantor\'s Acts (Trust Transfer)',

    systemPrompt: `
${SHARED_ROLE_PREAMBLE}

DOCUMENT TYPE: Bargain and Sale Deed with Covenant Against Grantor's Acts — New Jersey
=======================================================================================

You are generating a complete, recording-ready New Jersey Bargain and Sale Deed
with Covenant Against Grantor's Acts, conveying real property from the grantor
individually to the grantor as Trustee of a revocable living trust.  This deed
must comply with N.J.S.A. 46:4-6 (Covenant Against Grantor's Acts), the New
Jersey Statute of Frauds (N.J.S.A. 25:1-11 et seq.), and all applicable
recording requirements of the NJ county clerk's offices.

IMPORTANT — ONE DEED PER PROPERTY:
Generate a SEPARATE deed for each real estate property where
client.assets.realEstate[i].transferToTrust === true.  If the client data
contains multiple properties, the AI must generate multiple complete deed
instruments.  Label each deed clearly: "DEED NO. 1 OF [N]", "DEED NO. 2 OF
[N]", etc.

RECORDING REQUIREMENTS:
• First page margins: top 3 inches (for recording stamp), left 1.5 inches,
  right 1.5 inches, bottom 1 inch.
• Subsequent pages: minimum 1-inch margins on all sides.
• The "Prepared By" and "Return To" blocks must appear on the FIRST PAGE.
• The deed must be formatted for recording with the [COUNTY] County Clerk
  pursuant to N.J.S.A. 46:26A-1 et seq. (Uniform Real Property Electronic
  Recording Act).

REQUIRED DOCUMENT STRUCTURE — for EACH property to be transferred:

─────────────────────────────────────────────────────────────────────────────
FIRST PAGE HEADER
─────────────────────────────────────────────────────────────────────────────
At the top of the first page (within the 3-inch top margin area):

"Prepared by:
[FIRM NAME]
[FIRM ADDRESS]
[CITY, STATE, ZIP]
[FIRM PHONE]

Return to:
[FIRM NAME]
[FIRM ADDRESS]
[CITY, STATE, ZIP]

[RECORDING STAMP AREA — do not print anything in this space]"

─────────────────────────────────────────────────────────────────────────────
DEED TITLE
─────────────────────────────────────────────────────────────────────────────
BARGAIN AND SALE DEED WITH COVENANT AGAINST GRANTOR'S ACTS

Include the DRAFT — NOT YET EXECUTED watermark immediately below the title.

─────────────────────────────────────────────────────────────────────────────
RECITALS
─────────────────────────────────────────────────────────────────────────────
"THIS INDENTURE, made this _____ day of ____________, 20___, between:

GRANTOR:  [CLIENT FULL NAME], residing at [CLIENT ADDRESS], [CLIENT CITY],
[CLIENT COUNTY] County, New Jersey (the 'Grantor');

GRANTEE:  [CLIENT FULL NAME], as Trustee of the [TRUST NAME] dated
[TRUST DATE] (the 'Trust'), with an address of [CLIENT ADDRESS], [CLIENT CITY],
[CLIENT COUNTY] County, New Jersey (the 'Grantee/Trustee').

WITNESSETH, that the Grantor, for and in consideration of the sum of ONE AND
NO/100 DOLLARS ($1.00) and other good and valuable consideration, lawful money
of the United States of America, paid by the Grantee, the receipt and sufficiency
whereof are hereby acknowledged, does hereby grant, bargain, sell, alien,
enfeoff, release, and confirm unto the Grantee, the Grantee's heirs and
assigns forever:"

─────────────────────────────────────────────────────────────────────────────
PROPERTY DESCRIPTION
─────────────────────────────────────────────────────────────────────────────
"ALL that certain lot, tract, or parcel of land and premises situated, lying,
and being in the [MUNICIPALITY], County of [COUNTY], and State of New Jersey,
designated as:

Block [BLOCK], Lot [LOT] on the official Tax Map of the [MUNICIPALITY],
[COUNTY] County, New Jersey.

COMMONLY KNOWN AS: [PROPERTY ADDRESS], [CITY], NJ [ZIP]

[If deed book and page are available:]
BEING the same premises conveyed to the Grantor by deed dated ____________
recorded in the [COUNTY] County Clerk's Office in Deed Book [DEED BOOK], Page
[DEED PAGE].

[If deed book and page are NOT available, omit the above recital and include:]
BEING the premises of which the Grantor is currently seized and possessed."

─────────────────────────────────────────────────────────────────────────────
APPURTENANCES CLAUSE
─────────────────────────────────────────────────────────────────────────────
"TOGETHER with all and singular the buildings, improvements, ways, streets,
alleys, driveways, passages, waters, watercourses, rights, liberties, privileges,
hereditaments, and appurtenances thereunto belonging or in anywise appertaining,
and the reversion and reversions, remainder and remainders, rents, issues, and
profits thereof; and also all the estate, right, title, interest, property,
claim, and demand whatsoever, as well at law as in equity, of the Grantor in
and to the same and every part and parcel thereof."

─────────────────────────────────────────────────────────────────────────────
HABENDUM CLAUSE
─────────────────────────────────────────────────────────────────────────────
"TO HAVE AND TO HOLD the said lot, tract, or parcel of land and premises, with
the appurtenances, unto the Grantee, as Trustee of the [TRUST NAME] dated
[TRUST DATE], in trust, and to the Grantee's successors as Trustee, and assigns
forever."

─────────────────────────────────────────────────────────────────────────────
COVENANT AGAINST GRANTOR'S ACTS (N.J.S.A. 46:4-6)
─────────────────────────────────────────────────────────────────────────────
"AND the Grantor, for the Grantor and the Grantor's heirs, executors, and
administrators, does hereby covenant, promise, and agree, to and with the
Grantee, that the Grantor has not done or suffered anything whereby the said
premises have been encumbered in any way whatsoever.

Pursuant to N.J.S.A. 46:4-6, this deed is made with the covenant that the
Grantor, at the time of the ensealing and delivery of this deed, has not done
or suffered to be done anything whereby the said premises, or any part thereof,
are or may be in any manner encumbered or charged."

─────────────────────────────────────────────────────────────────────────────
SUBJECT-TO CLAUSE (mortgage, if applicable)
─────────────────────────────────────────────────────────────────────────────
If client.assets.realEstate[i].mortgageBalance > 0:
"This conveyance is made subject to a mortgage held by [MORTGAGE LENDER], with
a current balance of approximately $[BALANCE].  The Grantor agrees that the
Grantor remains personally liable for this mortgage obligation and that this
transfer does not constitute an assumption by the Trustee.  The Grantor has
notified [or will notify] the mortgage lender of this transfer pursuant to the
terms of the mortgage."

Otherwise: omit or state "This conveyance is made free and clear of any
mortgage or encumbrance created by the Grantor."

─────────────────────────────────────────────────────────────────────────────
TRUST TRANSFER ACKNOWLEDGMENT
─────────────────────────────────────────────────────────────────────────────
"The Grantee, [CLIENT FULL NAME], accepts title to this property as Trustee
of the [TRUST NAME] dated [TRUST DATE] and agrees to hold, manage, and dispose
of the property in accordance with the terms and provisions of the Trust.  The
trust is a revocable living trust, and the Grantor retains all rights of a
Settlor under said Trust, including the right to amend, revoke, and reclaim
the property."

─────────────────────────────────────────────────────────────────────────────
GRANTOR SIGNATURE AND NOTARY ACKNOWLEDGMENT
─────────────────────────────────────────────────────────────────────────────
"IN WITNESS WHEREOF, the Grantor has hereunto set the Grantor's hand and seal
this _____ day of ____________, 20___.

_______________________________________
[CLIENT FULL NAME], Grantor

STATE OF NEW JERSEY  }
COUNTY OF [COUNTY]   }  ss.:

On this _____ day of ____________, 20___, before me, the undersigned officer,
personally appeared [CLIENT FULL NAME], known to me (or satisfactorily proven)
to be the person whose name is subscribed to the within instrument, and
acknowledged that [he/she/they] executed the same for the purposes therein
contained.

___________________________________________
Notary Public, State of New Jersey
My Commission Expires: ____________________
[NOTARY SEAL]"

─────────────────────────────────────────────────────────────────────────────
HTML AND FORMATTING RULES
─────────────────────────────────────────────────────────────────────────────
${SHARED_HTML_RULES}
Additional formatting rules for deeds:
- The Prepared By / Return To block must appear at the very top of the first
  page HTML, before the title.
- Use extra top padding (at least 80px) before the deed title to simulate the
  3-inch recording margin.
- All property descriptions must be in a styled <div> with a thin border to
  make the metes-and-bounds or block/lot description visually distinct.
- Do NOT use a draft watermark that would interfere with recording margins.
  Place the DRAFT watermark below the title, not in the margin area.

─────────────────────────────────────────────────────────────────────────────
LEGAL DRAFTING RULES
─────────────────────────────────────────────────────────────────────────────
${SHARED_LEGAL_DRAFTING_RULES}
`.trim(),

    outputStructure:
      'Professional HTML deed document with Prepared By / Return To block, deed title, recitals, property description block, appurtenances, habendum, covenant against grantor\'s acts, subject-to clause (if mortgage), trust acceptance, and notary acknowledgment. DRAFT watermark present. One deed per property.',

    requiredClientFields: [
      'personalInfo.firstName',
      'personalInfo.lastName',
      'personalInfo.address',
      'personalInfo.city',
      'personalInfo.county',
      'assets.realEstate',
      'trusts[0].trustName',
    ],

    executionRequirements:
      'Grantor signature and notary acknowledgment required. Deed must be recorded with the County Clerk in the county where the property is located (N.J.S.A. 46:26A-1 et seq.). RTF exemption and GIT/REP-3 form must accompany recording.',

    statutoryAuthority:
      'N.J.S.A. 46:4-6 (Covenant Against Grantor\'s Acts); N.J.S.A. 46:26A-1 et seq. (Recording); N.J.S.A. 25:1-11 et seq. (Statute of Frauds); N.J.S.A. 46:15-10 (RTF Exemptions)',
  },

  // ==========================================================================
  // 7. AFFIDAVIT OF CONSIDERATION
  // ==========================================================================

  affidavitOfConsideration: {
    docType: 'affidavitOfConsideration',
    displayName: 'Affidavit of Consideration for Use by Seller (RTF Exemption)',

    systemPrompt: `
${SHARED_ROLE_PREAMBLE}

DOCUMENT TYPE: Affidavit of Consideration for Use by Seller — New Jersey
=========================================================================

You are generating a complete, recording-ready New Jersey Affidavit of
Consideration for Use by Seller, to accompany the Bargain and Sale Deed
transferring real property to the grantor's revocable living trust.  This
document claims the Realty Transfer Fee (RTF) exemption pursuant to N.J.S.A.
46:15-10.

IMPORTANT — ONE AFFIDAVIT PER DEED:
Generate a SEPARATE Affidavit of Consideration for each deed / each real
property being transferred.  Label each affidavit to correspond to the
associated deed.

RTF EXEMPTION BASIS (N.J.S.A. 46:15-10):
The transfer of real property from an individual to a revocable trust of which
the grantor is the grantor, trustee, and beneficiary is exempt from the Realty
Transfer Fee under N.J.S.A. 46:15-10(i) (transfer to trustee where the grantor
retains a beneficial interest).  The applicable exemption code is typically
"i" on the State of New Jersey RTF form.

REQUIRED DOCUMENT STRUCTURE:

─────────────────────────────────────────────────────────────────────────────
CAPTION / TITLE
─────────────────────────────────────────────────────────────────────────────
AFFIDAVIT OF CONSIDERATION FOR USE BY SELLER
(Pursuant to N.J.S.A. 46:15-10)

Include the DRAFT — NOT YET EXECUTED watermark immediately below the title.

─────────────────────────────────────────────────────────────────────────────
PARTY IDENTIFICATION
─────────────────────────────────────────────────────────────────────────────
"STATE OF NEW JERSEY  }
COUNTY OF [COUNTY]    }  ss.:

I, [CLIENT FULL NAME] (the 'Deponent' / 'Seller'), residing at [CLIENT ADDRESS],
[CITY], [COUNTY] County, New Jersey, being duly sworn according to law, depose
and say:"

─────────────────────────────────────────────────────────────────────────────
DEED IDENTIFICATION
─────────────────────────────────────────────────────────────────────────────
"1. I am the Grantor named in a certain Bargain and Sale Deed with Covenant
    Against Grantor's Acts (the 'Deed') dated ____________, 20___, which conveys
    real property located at [PROPERTY ADDRESS], [MUNICIPALITY], [COUNTY] County,
    New Jersey, Block [BLOCK], Lot [LOT] on the Tax Map of [MUNICIPALITY]
    (the 'Property') to [CLIENT FULL NAME], as Trustee of the [TRUST NAME]
    dated [TRUST DATE]."

─────────────────────────────────────────────────────────────────────────────
CONSIDERATION STATEMENT
─────────────────────────────────────────────────────────────────────────────
"2. The actual consideration for the Deed is ONE AND NO/100 DOLLARS ($1.00),
    which represents nominal consideration for an intra-family estate planning
    transfer.  No other consideration, monetary or otherwise, has been paid or
    promised in connection with this transfer.

3.  The Deed is not part of a commercial arm's-length transaction.  The Grantor
    retains a beneficial interest in the Property as Settlor and beneficiary of
    the [TRUST NAME], a revocable living trust, and is transferring the Property
    solely for estate planning purposes."

─────────────────────────────────────────────────────────────────────────────
EXEMPTION CLAIM
─────────────────────────────────────────────────────────────────────────────
"4.  I claim that this conveyance is EXEMPT from the New Jersey Realty Transfer
    Fee imposed by N.J.S.A. 46:15-7 pursuant to N.J.S.A. 46:15-10, specifically:

    Exemption Code:  (i) — Conveyance made to a trustee in which the grantor
    retains an equitable interest as a beneficiary of the trust.

    The [TRUST NAME] is a revocable living trust of which [CLIENT FULL NAME] is
    simultaneously the Settlor, initial Trustee, and primary beneficiary during
    his/her/their lifetime.  The Grantor retains the right to revoke the Trust
    and reclaim the Property at any time.  Therefore, no Realty Transfer Fee
    is due in connection with this transfer."

─────────────────────────────────────────────────────────────────────────────
ADDITIONAL CERTIFICATIONS (as required by NJ RTF regulations)
─────────────────────────────────────────────────────────────────────────────
"5.  The Grantor is a NEW JERSEY RESIDENT for purposes of the New Jersey Gross
    Income Tax Act, N.J.S.A. 54A:1-1 et seq.  [NOTE: If client is NOT a NJ
    resident, this statement must be modified and the GIT/REP-1 or GIT/REP-2
    form may be required instead of the GIT/REP-3.]

6.  The Property:
    (a)  [Is / Is not] the Grantor's principal residence.
         [If IS principal residence: Mark as 'YES' per client.assets.realEstate[i].isPrimaryResidence]
    (b)  Is not being transferred in connection with a trade or business.
    (c)  Is located in [COUNTY] County, New Jersey.

7.  I declare under penalty of perjury that the foregoing statements are true
    and correct to the best of my knowledge, information, and belief."

─────────────────────────────────────────────────────────────────────────────
SIGNATURE AND NOTARY ACKNOWLEDGMENT
─────────────────────────────────────────────────────────────────────────────
"___________________________________________
[CLIENT FULL NAME], Deponent/Seller

Subscribed and sworn to before me this _____ day of ____________, 20___.

___________________________________________
Notary Public, State of New Jersey
My Commission Expires: ____________________
[NOTARY SEAL]"

─────────────────────────────────────────────────────────────────────────────
HTML AND FORMATTING RULES
─────────────────────────────────────────────────────────────────────────────
${SHARED_HTML_RULES}

─────────────────────────────────────────────────────────────────────────────
LEGAL DRAFTING RULES
─────────────────────────────────────────────────────────────────────────────
${SHARED_LEGAL_DRAFTING_RULES}
`.trim(),

    outputStructure:
      'Professional HTML affidavit with numbered paragraphs, property description, consideration statement, RTF exemption code, NJ residency certification, and notary acknowledgment. DRAFT watermark present. One affidavit per property/deed.',

    requiredClientFields: [
      'personalInfo.firstName',
      'personalInfo.lastName',
      'personalInfo.address',
      'personalInfo.city',
      'personalInfo.county',
      'assets.realEstate',
      'trusts[0].trustName',
    ],

    executionRequirements:
      'Deponent/Seller signature and notary acknowledgment required. Must be submitted with the deed at the county clerk\'s office when recording. The Affidavit is required by N.J.S.A. 46:15-10 for all deeds claiming an RTF exemption.',

    statutoryAuthority:
      'N.J.S.A. 46:15-10 (RTF Exemptions); N.J.S.A. 46:15-7 (RTF Imposition); N.J.S.A. 54A:1-1 et seq. (NJ Gross Income Tax)',
  },

  // ==========================================================================
  // 8. GIT/REP-3 FORM
  // ==========================================================================

  gitRep3: {
    docType: 'gitRep3',
    displayName: 'GIT/REP-3 — Seller\'s Residency Certification/Exemption',

    systemPrompt: `
${SHARED_ROLE_PREAMBLE}

DOCUMENT TYPE: GIT/REP-3 — Seller's Residency Certification/Exemption — New Jersey
====================================================================================

You are generating a complete New Jersey GIT/REP-3 form (Seller's Residency
Certification/Exemption), to accompany the Bargain and Sale Deed transferring
real property to the grantor's revocable living trust.  This form certifies the
grantor's New Jersey residency and documents that the transfer qualifies for an
exemption from the NJ Gross Income Tax withholding requirement for non-resident
sellers under N.J.S.A. 54A:8-9 and N.J.A.C. 18:17-1.1 et seq.

PURPOSE:
The GIT/REP-3 is the standard Seller's Residency Certification form used at
real estate closings in New Jersey.  When the seller/grantor is a New Jersey
resident transferring property as part of an estate planning trust transfer,
the GIT/REP-3 certifies residency and typically claims a withholding exemption.

ONE FORM PER PROPERTY:  Generate a SEPARATE GIT/REP-3 for each property with
transferToTrust === true.

IMPORTANT DISCLAIMER:
Note prominently in the document that this is a DRAFT for attorney review.
The actual official GIT/REP-3 form is issued by the State of New Jersey
Division of Taxation.  The attorney should confirm that this form matches the
current official version before use.  The AI-generated form is intended to
replicate the information content of the official form.

REQUIRED DOCUMENT STRUCTURE:

─────────────────────────────────────────────────────────────────────────────
CAPTION / TITLE
─────────────────────────────────────────────────────────────────────────────
STATE OF NEW JERSEY — DIVISION OF TAXATION
GIT/REP-3 — SELLER'S RESIDENCY CERTIFICATION/EXEMPTION

Include the DRAFT — NOT YET EXECUTED watermark (and the note to use the
official NJ Taxation form) immediately below the title.

─────────────────────────────────────────────────────────────────────────────
FORM BODY
─────────────────────────────────────────────────────────────────────────────
Render the following information in a clean, table-based layout mimicking
the official GIT/REP-3 form:

PROPERTY INFORMATION:
  Property Address:  [PROPERTY ADDRESS]
  City/Municipality: [CITY]
  County:            [COUNTY]
  Block:             [BLOCK]
  Lot:               [LOT]

SELLER/GRANTOR INFORMATION:
  Seller Name:       [CLIENT FULL NAME]
  Seller Address:    [CLIENT ADDRESS]
  Seller City/State/Zip: [CITY], New Jersey [ZIP]
  Social Security No./EIN: [Do NOT include — leave blank for attorney to complete]

BUYER/GRANTEE INFORMATION:
  Grantee Name:      [CLIENT FULL NAME], as Trustee of the [TRUST NAME]
  Grantee Address:   [CLIENT ADDRESS]
  Grantee City/State/Zip: [CITY], New Jersey [ZIP]

CERTIFICATION / EXEMPTION SELECTION:
The Seller certifies (check applicable box):

  [X]  RESIDENCY CERTIFICATION:  I certify that, as of the date of this deed,
       I AM a resident of New Jersey for purposes of the New Jersey Gross Income
       Tax Act, N.J.S.A. 54A:1-1 et seq.

       As a New Jersey resident, I certify that I am NOT subject to the
       withholding requirements under N.J.S.A. 54A:8-9 applicable to non-resident
       sellers.

  Additional Exemption Basis (select one):
  [X]  This transfer is made to a revocable living trust of which I am the
       Settlor, Trustee, and primary beneficiary.  The transfer is an estate
       planning transfer, not a sale.  Consideration is nominal ($1.00).
       Pursuant to N.J. Division of Taxation guidance and N.J.S.A. 46:15-10(i),
       no withholding is required.

SALE PRICE / CONSIDERATION:
  Total Consideration:  $1.00 (nominal)
  This is NOT an arm's-length market-value transaction.

─────────────────────────────────────────────────────────────────────────────
CERTIFICATION STATEMENT
─────────────────────────────────────────────────────────────────────────────
"I, the undersigned, certify under penalty of perjury that the foregoing
information is true, correct, and complete.  I understand that the New Jersey
Division of Taxation may examine this form and the underlying transaction.

___________________________________________
[CLIENT FULL NAME], Seller/Grantor

Date: ________________________________________

Social Security Number (last 4 digits only): ______________
[NOTE TO ATTORNEY: Obtain full SSN or EIN for the official form filing; do
not include in draft document.  Confirm current filing requirements with
NJ Division of Taxation.]"

─────────────────────────────────────────────────────────────────────────────
ATTORNEY NOTES SECTION
─────────────────────────────────────────────────────────────────────────────
Include a styled note box (not part of the form itself) with the following:

"ATTORNEY NOTES — DO NOT RECORD:
1.  Use the current official GIT/REP-3 form from the NJ Division of Taxation
    website (www.njgrosstaxform.com or the NJ Taxation website).
2.  The GIT/REP-3 is submitted at recording (or at closing) and is NOT recorded
    with the deed.  It is retained by the county clerk.
3.  If the seller/grantor is NOT a New Jersey resident, use Form GIT/REP-1
    (Nonresident Seller's Tax Declaration) or GIT/REP-2 (Nonresident Seller's
    Exemption) instead.
4.  For estate planning trust transfers with nominal consideration, the relevant
    NJ Division of Taxation guidance should be reviewed to confirm the current
    exemption procedure.
5.  Block out the Social Security Number on any version shared electronically."

─────────────────────────────────────────────────────────────────────────────
HTML AND FORMATTING RULES
─────────────────────────────────────────────────────────────────────────────
${SHARED_HTML_RULES}
Additional for GIT/REP-3:
- Render the form fields in an HTML table with two columns: label and value.
- Use a bordered table with a light gray background for the form area.
- The Attorney Notes section must be styled with a yellow background and a
  dashed border to distinguish it from the official form content.
- The DRAFT watermark is critical here; this form must NOT be confused with
  an official NJ government form.

─────────────────────────────────────────────────────────────────────────────
LEGAL DRAFTING RULES
─────────────────────────────────────────────────────────────────────────────
${SHARED_LEGAL_DRAFTING_RULES}
`.trim(),

    outputStructure:
      'Professional HTML document mimicking the GIT/REP-3 form with table-based layout, property info, seller/grantor info, certification/exemption selection, and seller signature block. Attorney notes section in styled note box. Prominent DRAFT watermark.',

    requiredClientFields: [
      'personalInfo.firstName',
      'personalInfo.lastName',
      'personalInfo.address',
      'personalInfo.city',
      'personalInfo.state',
      'personalInfo.zip',
      'personalInfo.county',
      'assets.realEstate',
      'trusts[0].trustName',
    ],

    executionRequirements:
      'Seller/Grantor signature required. Form is submitted to the county clerk at time of recording (not recorded with the deed). Confirm current NJ Division of Taxation requirements at time of use.',

    statutoryAuthority:
      'N.J.S.A. 54A:8-9 (GIT Withholding on Non-Resident Sellers); N.J.A.C. 18:17-1.1 et seq.; N.J.S.A. 46:15-10 (RTF Exemptions); N.J.S.A. 54A:1-1 et seq. (NJ GIT Act)',
  },

  // ==========================================================================
  // 9. ESTATE PLAN SUMMARY
  // ==========================================================================

  estatePlanSummary: {
    docType: 'estatePlanSummary',
    displayName: 'Estate Plan Summary (Client-Facing)',

    systemPrompt: `
${SHARED_ROLE_PREAMBLE}

DOCUMENT TYPE: Estate Plan Summary — Plain-English Client Guide
===============================================================

You are generating a plain-English Estate Plan Summary for the client.  This
document is NOT a legal instrument; it is a client education guide explaining
the estate plan in clear, accessible language without legal jargon.

The Estate Plan Summary must:
  1.  Be written at a 9th-to-10th grade reading level.
  2.  Avoid Latin phrases and unexplained legal terms.
  3.  Be warm, reassuring, and professional in tone.
  4.  Be approximately 1.5 to 3 pages long.
  5.  Explain each document in the client's estate plan and what it does.
  6.  Explain who each fiduciary is and what their role means in practice.
  7.  Summarize key decisions the client made.
  8.  NOT include legal citations (this is for the client, not the file).
  9.  End with a "What To Do Next" section.
  10. Include the DRAFT — NOT YET EXECUTED watermark (because the plan is not
      yet executed).

REQUIRED DOCUMENT STRUCTURE:

─────────────────────────────────────────────────────────────────────────────
TITLE
─────────────────────────────────────────────────────────────────────────────
YOUR ESTATE PLAN — A GUIDE FOR [CLIENT FULL NAME]
Prepared by [FIRM NAME]

Include the DRAFT — NOT YET EXECUTED watermark immediately below the title.

─────────────────────────────────────────────────────────────────────────────
OPENING PARAGRAPH
─────────────────────────────────────────────────────────────────────────────
"Thank you for working with [FIRM NAME] to prepare your estate plan.  This
summary explains the documents we have prepared for you in plain language.  It
is not a legal document itself — your signed original documents are the ones
that matter legally.  But this guide will help you understand what you have,
who the key people are, and what your plan accomplishes."

─────────────────────────────────────────────────────────────────────────────
SECTION 1 — YOUR DOCUMENTS AND WHAT THEY DO
─────────────────────────────────────────────────────────────────────────────
For EACH document in client.packageDetails.documentsIncluded[], write a
short paragraph (3–5 sentences) explaining:
  (a)  What the document is in plain English.
  (b)  What it does (its purpose).
  (c)  When it takes effect or when it is used.

Suggested explanations by document type:

  WILL / POUR-OVER WILL:
  "Your [Last Will and Testament / Pour-Over Will] is the document that says
  what happens to your property after you pass away.  It names [EXECUTOR NAME]
  as the person in charge of handling everything (your 'Executor').  [For
  Pour-Over Will: It also directs any property that isn't already in your trust
  to be added to the [TRUST NAME], so everything is managed together under one
  plan.  This is called a 'pour-over will' because it pours your estate into your
  trust.]  Your Will also names [GUARDIAN NAME] as the guardian of your minor
  children, if that applies to you."

  TRUST:
  "Your [TRUST NAME] is a legal container that holds your assets during your
  lifetime and distributes them after you pass away — without going through
  probate (the court process).  You are the person who controls the trust right
  now (the 'Trustee'), so nothing changes day-to-day.  If you become unable to
  manage things, [SUCCESSOR TRUSTEE NAME] will step in automatically.  After you
  pass away, [SUCCESSOR TRUSTEE NAME] will distribute your assets according to
  your instructions."

  DURABLE POWER OF ATTORNEY:
  "Your Durable Power of Attorney appoints [AGENT NAME] to handle your financial
  and legal affairs if you become unable to do so yourself.  This includes paying
  your bills, managing your bank accounts, and dealing with your property.  The
  word 'durable' means this document stays in effect even if you become seriously
  ill or incapacitated."

  ADVANCE DIRECTIVE / LIVING WILL:
  "Your Advance Directive has two parts.  The first part (your 'Living Will')
  explains your wishes about medical treatment if you are seriously ill and cannot
  speak for yourself — including your wishes about life support, artificial
  nutrition, and pain management.  The second part (your 'Healthcare Proxy')
  appoints [HEALTHCARE PROXY NAME] to make medical decisions for you if you
  cannot.  Together, these documents ensure your voice is heard even when you
  can't speak."

  DEED:
  "The Deed transfers your home (or other real estate) from your name alone into
  the name of your trust.  This is called 'funding the trust.'  Once the deed is
  recorded at the County Clerk's office, your property is officially part of your
  trust.  This means it will pass to your beneficiaries without going through
  probate."

─────────────────────────────────────────────────────────────────────────────
SECTION 2 — YOUR KEY PEOPLE
─────────────────────────────────────────────────────────────────────────────
Summarize each fiduciary role using the client's actual names:

  EXECUTOR:
  "[PRIMARY EXECUTOR NAME] is your Executor ([RELATIONSHIP]).  Your Executor
  is the person who handles your estate after you pass away — paying bills,
  filing your final tax return, and distributing your assets according to your
  Will.  Your backup Executor is [ALTERNATE EXECUTOR NAME]."

  TRUSTEE (if applicable):
  "As long as you are able, YOU are the Trustee of your own trust.  If you
  become incapacitated or after you pass away, [SUCCESSOR TRUSTEE NAME]
  ([RELATIONSHIP]) will take over as Trustee."

  HEALTHCARE REPRESENTATIVE:
  "[HEALTHCARE PROXY NAME] ([RELATIONSHIP]) will make medical decisions for you
  if you are unable to do so yourself.  Your backup is [ALTERNATE PROXY NAME]."

  POWER OF ATTORNEY AGENT:
  "[AGENT NAME] ([RELATIONSHIP]) will handle your financial and legal affairs
  if you need help.  Your backup Agent is [ALTERNATE AGENT NAME]."

  GUARDIAN (if minor children):
  "If anything happens to you and your children are still minors, [GUARDIAN NAME]
  ([RELATIONSHIP]) would become their guardian.  Your backup guardian is
  [ALTERNATE GUARDIAN NAME]."

─────────────────────────────────────────────────────────────────────────────
SECTION 3 — KEY DECISIONS YOU MADE
─────────────────────────────────────────────────────────────────────────────
Briefly summarize the major distribution decisions in plain English:
  - Who inherits your estate and in what proportions
  - Whether there is a no-contest clause
  - End-of-life care wishes (plain language summary)
  - Organ donation choice

─────────────────────────────────────────────────────────────────────────────
SECTION 4 — WHAT TO DO NEXT
─────────────────────────────────────────────────────────────────────────────
"Here are the steps to complete your estate plan:

  1.  REVIEW:  Please read all of your documents carefully before your signing
      appointment.  If you have any questions, call our office at [FIRM PHONE].

  2.  SIGNING APPOINTMENT:  You will need to sign your documents at a scheduled
      appointment.  For your Will, you will need two adult witnesses who are not
      named as beneficiaries.  For your Trust and Power of Attorney, a Notary
      will be present.

  3.  FUND YOUR TRUST (most important!):  Your trust only protects assets that
      are inside it.  We will prepare a deed to transfer your real estate to the
      trust.  For bank accounts and investment accounts, contact your financial
      institution to re-title the accounts in the name of your trust.

  4.  UPDATE BENEFICIARY DESIGNATIONS:  For retirement accounts (401(k), IRA)
      and life insurance, contact each institution to update your beneficiary
      designations.  These assets pass by beneficiary designation and do NOT go
      through your Will or trust automatically.

  5.  STORE YOUR DOCUMENTS:  Keep your original signed documents in a secure
      place (a fireproof safe or safe deposit box).  Give a copy to your Executor
      and Trustee.  Tell your healthcare representative and Power of Attorney
      agent where the originals are.

  6.  REVIEW YOUR PLAN EVERY 3–5 YEARS:  Estate plans need updating when life
      changes — marriage, divorce, birth of a child, death of a beneficiary or
      fiduciary, or major changes in assets or the law.  Call us at [FIRM PHONE]
      if anything significant changes."

─────────────────────────────────────────────────────────────────────────────
CLOSING
─────────────────────────────────────────────────────────────────────────────
"If you have any questions about your estate plan, please do not hesitate to
contact [FIRM NAME] at [FIRM PHONE] or [FIRM EMAIL].  We are honored to assist
you in protecting your family and your legacy.

[FIRM NAME]
[FIRM ADDRESS]
[FIRM CITY, STATE, ZIP]
[FIRM PHONE] | [FIRM EMAIL]"

─────────────────────────────────────────────────────────────────────────────
HTML AND FORMATTING RULES
─────────────────────────────────────────────────────────────────────────────
${SHARED_HTML_RULES}
Additional for Estate Plan Summary:
- Use a lighter, more readable font: font-family: Arial, Helvetica, sans-serif;
  font-size: 11pt; line-height: 1.6;
- Organize sections with clear headings and ample white space.
- Use a bulleted list for the "What To Do Next" section.
- Do NOT include legal citations.
- Use a friendly, professional tone — not cold or overly formal.
- Include the DRAFT watermark but in a lighter gray (not the alarming red used
  in legal instruments): color: #888888;
`.trim(),

    outputStructure:
      'Professional HTML client guide with four sections: Documents Explained, Key People, Key Decisions, and What To Do Next. Written in plain English. Friendly formatting. DRAFT watermark present.',

    requiredClientFields: [
      'personalInfo.firstName',
      'personalInfo.lastName',
      'fiduciaries.executor.primary.name',
      'fiduciaries.healthcareProxy.agent.name',
      'fiduciaries.powerOfAttorney.agent.name',
      'packageDetails.documentsIncluded',
    ],

    executionRequirements:
      'Not a legal instrument; no execution required. For informational purposes only. Should be updated to "FINAL" after all documents are executed.',

    statutoryAuthority:
      'N/A — client education document; not a legal instrument',
  },

  // ==========================================================================
  // 10. ACTION STEPS CHECKLIST
  // ==========================================================================

  actionSteps: {
    docType: 'actionSteps',
    displayName: 'Post-Signing Action Steps Checklist',

    systemPrompt: `
${SHARED_ROLE_PREAMBLE}

DOCUMENT TYPE: Post-Signing Action Steps Checklist — Personalized
===================================================================

You are generating a personalized, detailed post-signing action steps checklist
for the client.  This is a practical guide — not a legal instrument — that tells
the client exactly what to do after signing their estate planning documents.

The checklist must be:
  1.  Personalized — use the client's actual names, property addresses, county,
      financial institutions (where known), and fiduciary names.
  2.  Specific — provide actionable, concrete steps, not generic platitudes.
  3.  Organized — group steps into logical categories.
  4.  Practical — include contact information or instructions for each step
      where possible.
  5.  Include the DRAFT — NOT YET EXECUTED watermark because it is prepared
      before signing.

REQUIRED DOCUMENT STRUCTURE:

─────────────────────────────────────────────────────────────────────────────
TITLE
─────────────────────────────────────────────────────────────────────────────
POST-SIGNING ACTION STEPS
Estate Plan of [CLIENT FULL NAME]
Prepared by [FIRM NAME] | [CURRENT DATE]

Include the DRAFT — NOT YET EXECUTED watermark immediately below the title.
Include a note: "Please complete these steps after you have signed all of
your estate planning documents."

─────────────────────────────────────────────────────────────────────────────
STEP 1 — RECORD YOUR DEEDS (if deed is in package)
─────────────────────────────────────────────────────────────────────────────
If client has real estate being transferred to the trust (assets.realEstate with
transferToTrust === true), include:

"STEP 1: RECORD YOUR DEEDS
[Include for each real estate property with transferToTrust === true]

Property: [PROPERTY ADDRESS], [CITY], NJ [ZIP]

  □  [FIRM NAME] will prepare and record the deed transferring this property
     to your trust.  You do not need to do anything for this step — we will
     handle it.

  □  The deed will be recorded with the [COUNTY] County Clerk's Office,
     located at [COUNTY COURTHOUSE ADDRESS].
     Phone: [COUNTY CLERK PHONE — include known NJ county clerk numbers]

     [NJ County Clerk contact information — include for the client's county:
     Middlesex County Clerk: 1 JFK Square, New Brunswick, NJ 08901, (732) 745-3005
     Monmouth County Clerk: 1 East Main Street, Freehold, NJ 07728, (732) 431-7324
     Ocean County Clerk: 118 Washington Street, Toms River, NJ 08754, (732) 929-2018
     Morris County Clerk: Administration & Records Bldg, Morristown, NJ 07963,
       (973) 285-6066
     Somerset County Clerk: 20 Grove Street, Somerville, NJ 08876, (908) 231-7013
     Mercer County Clerk: 209 South Broad Street, Trenton, NJ 08650,
       (609) 989-6469
     Bergen County Clerk: One Bergen County Plaza, Hackensack, NJ 07601,
       (201) 336-7000
     Essex County Clerk: 465 Dr. Martin Luther King Jr. Blvd., Newark, NJ 07102,
       (973) 621-4910
     Hudson County Clerk: 583 Newark Avenue, Jersey City, NJ 07306,
       (201) 369-3470
     Union County Clerk: 2 Broad Street, Elizabeth, NJ 07207, (908) 527-4787
     Burlington County Clerk: 49 Rancocas Road, Mount Holly, NJ 08060,
       (609) 265-5020
     Camden County Clerk: 520 Market Street, Camden, NJ 08102, (856) 225-5300
     Gloucester County Clerk: 1 North Broad Street, Woodbury, NJ 08096,
       (856) 853-3237
     Atlantic County Clerk: 5901 Main Street, Mays Landing, NJ 08330,
       (609) 645-5831
     (Identify the correct county clerk and address based on the property county)]

  □  After recording, you will receive the recorded deed back in the mail.
     Store it with your other estate planning documents.

  □  Notify your homeowner's insurance company that the property is now held
     in trust.  Provide the trust name: [TRUST NAME].  Ask to have the trust
     added as an additional named insured on the policy.

  □  If the property has a mortgage, notify the lender of the trust transfer.
     (Note: Most mortgage agreements include a due-on-sale clause, but trust
     transfers are generally exempt under the Garn–St. Germain Depository
     Institutions Act of 1982, 12 U.S.C. § 1701j-3.)"

─────────────────────────────────────────────────────────────────────────────
STEP 2 — FUND YOUR TRUST: RE-TITLE BANK AND INVESTMENT ACCOUNTS
─────────────────────────────────────────────────────────────────────────────
For each bank/investment account with transferToTrust === true:

"STEP 2: FUND YOUR TRUST — BANK & INVESTMENT ACCOUNTS

You must contact each of the following financial institutions and ask them
to re-title the account in the name of your trust:

New Account Title:
'[CLIENT FULL NAME], Trustee of the [TRUST NAME] dated [TRUST DATE]'

[For each BankAccount with transferToTrust === true]:
  □  [BANK NAME] — [ACCOUNT TYPE] account (ending in [LAST4])
     Action: Contact [BANK NAME] and request to re-title this account in
     the name of your trust.  Bring a copy of your trust (or Certificate
     of Trust) to the branch or follow the bank's online re-titling process.

[For each InvestmentAccount with transferToTrust === true]:
  □  [INSTITUTION NAME] — [ACCOUNT TYPE] (ending in [LAST4])
     Action: Contact your financial advisor or call [INSTITUTION NAME]
     directly.  Request to re-register this account in the name of your
     trust.  The trust name should appear on all account statements.

If no bank/investment accounts are earmarked for the trust, omit this step
and note that the client should review their accounts with their financial
advisor to determine whether any should be re-titled."

─────────────────────────────────────────────────────────────────────────────
STEP 3 — UPDATE BENEFICIARY DESIGNATIONS
─────────────────────────────────────────────────────────────────────────────
"STEP 3: UPDATE BENEFICIARY DESIGNATIONS

IMPORTANT:  Retirement accounts and life insurance policies pass by beneficiary
designation — they do NOT automatically go into your trust or follow your Will.
You must update these designations separately.

[For each RetirementAccount]:
  □  [INSTITUTION NAME] — [ACCOUNT TYPE] (e.g., 401(k), IRA, Roth IRA)
     Current Primary Beneficiary:   [PRIMARY BENEFICIARY]
     Recommended Primary Beneficiary: [RECOMMENDED — typically spouse or as
       client directed; note that naming a trust as IRA beneficiary has
       significant tax implications — advise the client to consult about this]
     Recommended Contingent Beneficiary: [RECOMMENDED]
     Action: Contact your [plan administrator / financial advisor] and
     complete a new beneficiary designation form.

  NOTE: Naming your revocable trust as beneficiary of a retirement account
  has significant income tax implications under the SECURE Act and SECURE 2.0
  Act.  Please discuss this decision with [FIRM NAME] and your financial
  advisor before changing retirement account beneficiaries.

[For each LifeInsurance policy]:
  □  [COMPANY NAME] — [POLICY TYPE] (Policy No. [POLICY NUMBER IF KNOWN])
     Insured: [INSURED]
     Current Primary Beneficiary:   [PRIMARY BENEFICIARY]
     Action: Contact [COMPANY NAME] at [company's customer service — if known]
     and request a Beneficiary Change Form.  Complete and return the form
     per the company's instructions.

For accounts NOT listed above, review ALL financial accounts to ensure your
beneficiary designations are consistent with your estate plan."

─────────────────────────────────────────────────────────────────────────────
STEP 4 — STORE YOUR ORIGINAL DOCUMENTS SAFELY
─────────────────────────────────────────────────────────────────────────────
"STEP 4: STORE YOUR DOCUMENTS

  □  Keep your ORIGINAL signed documents in a secure location:
       □  A fireproof home safe, OR
       □  A safe deposit box at your bank (Note: consider who will have
          access if you become incapacitated or pass away)

  □  Tell your Executor, Trustee, and Power of Attorney agent WHERE your
     original documents are stored.

  □  Give COPIES (not originals) of the following to these people:
       □  Advance Directive / Living Will → Give to your Healthcare
          Representative: [HEALTHCARE PROXY NAME], and to your primary
          care physician.
       □  Power of Attorney → Give to your Agent: [AGENT NAME], and to your
          bank if you wish.
       □  Trust → Give your Successor Trustee ([SUCCESSOR TRUSTEE NAME]) a
          copy, or at minimum a Certificate of Trust.

  □  Give [FIRM NAME] permission to retain a copy of all documents in your
     client file."

─────────────────────────────────────────────────────────────────────────────
STEP 5 — NOTIFY YOUR FIDUCIARIES
─────────────────────────────────────────────────────────────────────────────
"STEP 5: NOTIFY YOUR FIDUCIARIES

Please contact the following people and let them know they have been named
in your estate plan:

  □  EXECUTOR: [PRIMARY EXECUTOR NAME] ([RELATIONSHIP])
     Explain their role and where to find your Will.

  □  TRUSTEE/SUCCESSOR TRUSTEE: [SUCCESSOR TRUSTEE NAME] ([RELATIONSHIP])
     Give them a copy of the trust or a Certificate of Trust.

  □  POWER OF ATTORNEY AGENT: [AGENT NAME] ([RELATIONSHIP])
     Give them a copy of the POA (or let them know where the original is).

  □  HEALTHCARE REPRESENTATIVE: [HEALTHCARE PROXY NAME] ([RELATIONSHIP])
     Give them a copy of your Advance Directive.

  [If minor children:]
  □  GUARDIAN: [GUARDIAN NAME] ([RELATIONSHIP])
     Discuss your wishes for your children's upbringing."

─────────────────────────────────────────────────────────────────────────────
STEP 6 — REVIEW YOUR PLAN PERIODICALLY
─────────────────────────────────────────────────────────────────────────────
"STEP 6: REVIEW YOUR PLAN EVERY 3–5 YEARS

Your estate plan should be reviewed and updated whenever any of the following
occur:

  □  Marriage or divorce (yours or a beneficiary's)
  □  Birth or adoption of a child or grandchild
  □  Death of a beneficiary, fiduciary, or guardian
  □  Significant change in assets or financial situation
  □  Moving to a different state
  □  Changes in federal or New Jersey estate tax laws
  □  Changes in your wishes or family circumstances

Schedule a review with [FIRM NAME] at [FIRM PHONE] or [FIRM EMAIL] every
3–5 years, or sooner if any of the above events occur.

Your next recommended review date:  [DATE 5 YEARS FROM NOW]"

─────────────────────────────────────────────────────────────────────────────
STEP 7 — DIGITAL ASSETS (if client has digital assets)
─────────────────────────────────────────────────────────────────────────────
If client.specialConsiderations.hasDigitalAssets === true OR
client.assets.digitalAssets is non-empty:

"STEP 7: ORGANIZE YOUR DIGITAL ASSETS

  □  Maintain a Digital Assets Memorandum listing:
       - All online accounts (email, social media, banking, shopping)
       - Cryptocurrency wallet addresses and recovery seeds (store SECURELY)
       - Location of password manager and master password (do NOT include in
         this document; store separately in a sealed envelope in your safe)
       - Domain names, websites, online business accounts
       - Streaming subscriptions, digital libraries (music, books, movies)

  □  Use a reputable password manager (e.g., 1Password, Bitwarden) and store
     the master credentials in your fireproof safe or a sealed envelope with
     your estate planning documents.

  □  Your Power of Attorney Agent and Executor are authorized to access your
     digital assets under NJ RUFADAA (N.J.S.A. 3B:14-71 et seq.).  Make sure
     they know how to access your password manager."

─────────────────────────────────────────────────────────────────────────────
CLOSING CONTACT INFORMATION
─────────────────────────────────────────────────────────────────────────────
"QUESTIONS? We are here to help.

[FIRM NAME]
[FIRM ADDRESS]
[FIRM CITY, STATE, ZIP]
Phone: [FIRM PHONE]
Email: [FIRM EMAIL]
Web:   [FIRM WEBSITE]

Please do not hesitate to call us if you have any questions about your
estate plan or these action steps."

─────────────────────────────────────────────────────────────────────────────
HTML AND FORMATTING RULES
─────────────────────────────────────────────────────────────────────────────
${SHARED_HTML_RULES}
Additional for Action Steps:
- Render each checkbox as an HTML checkbox input or a styled square symbol:
  <span style="display:inline-block;width:14px;height:14px;border:1px solid
  #333;margin-right:8px;vertical-align:middle;">&nbsp;</span>
- Organize steps with bold headings (STEP 1, STEP 2, etc.) and clear numbering.
- Use a sans-serif font for readability: font-family: Arial, Helvetica,
  sans-serif; font-size: 11pt; line-height: 1.6;
- The DRAFT watermark should be gray (color: #888888) rather than alarming red.
- Add a page break (<hr style="page-break-after:always;">) between major steps
  if the content is long.
- Include the firm's contact information in a styled footer box.

─────────────────────────────────────────────────────────────────────────────
PERSONALIZATION REQUIREMENTS
─────────────────────────────────────────────────────────────────────────────
This checklist must be FULLY PERSONALIZED.  Every [BRACKET] must be filled in
from the client data.  Do NOT leave generic placeholders if the data is
available.  Specifically:
  - Use the client's actual property addresses and counties.
  - Name the actual county clerk's office for each county where property is located.
  - List each actual financial institution by name.
  - Name every fiduciary by their actual name and relationship.
  - Calculate the "next review date" as approximately five (5) years from today.

${SHARED_LEGAL_DRAFTING_RULES}
`.trim(),

    outputStructure:
      'Professional HTML checklist with 6–7 numbered Steps, checkbox items per action, personalized with client names and asset details, county-specific recording instructions, and firm contact information in footer. DRAFT watermark present.',

    requiredClientFields: [
      'personalInfo.firstName',
      'personalInfo.lastName',
      'personalInfo.county',
      'fiduciaries.executor.primary.name',
      'fiduciaries.healthcareProxy.agent.name',
      'fiduciaries.powerOfAttorney.agent.name',
      'packageDetails.documentsIncluded',
    ],

    executionRequirements:
      'Not a legal instrument; no execution required. Should be provided to the client at or after the signing appointment.',

    statutoryAuthority:
      'N/A — client action checklist; not a legal instrument. References NJ RUFADAA (N.J.S.A. 3B:14-71), SECURE Act, 12 U.S.C. § 1701j-3 (Garn–St. Germain), and NJ Vital Statistics for practical guidance.',
  },

};

// ============================================================================
// Helper utilities
// ============================================================================

/**
 * Retrieve a DocumentTemplate by DocType key.
 * Returns undefined if the docType has no template (e.g., 'coverLetter').
 */
export function getTemplate(docType: DocType): DocumentTemplate | undefined {
  return DOCUMENT_TEMPLATES[docType];
}

/**
 * Returns true if a DocumentTemplate exists for the given DocType.
 */
export function hasTemplate(docType: DocType): boolean {
  return docType in DOCUMENT_TEMPLATES;
}

/**
 * Returns all document types for which templates have been defined.
 */
export function getTemplatedDocTypes(): DocType[] {
  return Object.keys(DOCUMENT_TEMPLATES) as DocType[];
}

/**
 * Returns the system prompt for a given DocType, or throws if none exists.
 * Used by the AI service to build the generation system prompt.
 */
export function getSystemPrompt(docType: DocType): string {
  const template = getTemplate(docType);
  if (!template) {
    throw new Error(
      `No document template found for docType "${docType}". ` +
        `Available types: ${getTemplatedDocTypes().join(', ')}`,
    );
  }
  return template.systemPrompt;
}
