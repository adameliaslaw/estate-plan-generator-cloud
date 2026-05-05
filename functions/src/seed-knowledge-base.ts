/**
 * functions/src/seed-knowledge-base.ts
 *
 * Cloud Function to bulk-seed the Knowledge Base with core NJ estate planning
 * statutes, case law, checklists, and practice notes. Idempotent — skips
 * resources that already exist (matched by citation or title).
 *
 * Firestore path: firms/{firmId}/knowledgeBase/{resourceId}
 */

import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// Types (reuse from knowledge-base.ts)
// ---------------------------------------------------------------------------

type KnowledgeCategory =
  | 'statute'
  | 'case_law'
  | 'cle_material'
  | 'checklist'
  | 'form_template'
  | 'practice_note'
  | 'custom';

interface SeedResource {
  category: KnowledgeCategory;
  title: string;
  citation: string;
  content: string;
  tags: string[];
  docTypes: string[];
}

// ---------------------------------------------------------------------------
// NJ Estate Planning Statutes
// ---------------------------------------------------------------------------

const NJ_STATUTES: SeedResource[] = [
  // ── WILLS ──────────────────────────────────────────────────────────────────
  {
    category: 'statute',
    title: 'NJ Wills — Execution Requirements',
    citation: 'N.J.S.A. 3B:3-2',
    content:
      'A will must be: (1) in writing; (2) signed by the testator, or in the testator\'s name by some other individual in the testator\'s conscious presence and at the testator\'s direction; and (3) signed by at least 2 persons, each of whom signed within a reasonable time after witnessing either the signing of the will or the testator\'s acknowledgment of that signature or acknowledgment of the will. Witnesses must be adults and should not be beneficiaries under the will to avoid statutory disqualification issues (N.J.S.A. 3B:3-7). The will need not be notarized to be valid, but a self-proving affidavit under N.J.S.A. 3B:3-4 is strongly recommended.',
    tags: ['will', 'execution', 'witnesses', 'formalities', 'signing'],
    docTypes: ['will', 'pourOverWill'],
  },
  {
    category: 'statute',
    title: 'NJ Wills — Self-Proving Affidavit',
    citation: 'N.J.S.A. 3B:3-4',
    content:
      'A will may be simultaneously executed, attested, and made self-proved by acknowledgment thereof by the testator and affidavits of the witnesses, each made before an officer authorized to administer oaths. A self-proving affidavit allows the will to be admitted to probate without requiring testimony from the witnesses. The statutory form must be substantially followed. The affidavit must be executed at the same time as the will signing ceremony. This eliminates the need to locate witnesses at probate, saving time and cost for the estate.',
    tags: ['will', 'self-proving', 'affidavit', 'probate', 'notary'],
    docTypes: ['will', 'pourOverWill'],
  },
  {
    category: 'statute',
    title: 'NJ Wills — Anti-Lapse Statute',
    citation: 'N.J.S.A. 3B:3-35',
    content:
      'If a devisee who is a grandparent, a descendant of a grandparent, or a stepchild of the testator fails to survive the testator, the devise lapses unless the devisee leaves surviving descendants. In that case, the gift passes to the devisee\'s descendants by representation (per stirpes) unless the will specifically states otherwise. This statute only applies to specified classes of relatives — bequests to non-relatives or trusts lapse if the beneficiary predeceases the testator, unless an alternate is named. Drafting tip: Always name alternate beneficiaries to supersede the anti-lapse statute and ensure the testator\'s actual intent is honored.',
    tags: ['will', 'anti-lapse', 'per-stirpes', 'predeceased', 'beneficiary'],
    docTypes: ['will', 'pourOverWill'],
  },
  {
    category: 'statute',
    title: 'NJ Wills — Omitted Spouse Protection',
    citation: 'N.J.S.A. 3B:5-15',
    content:
      'If a testator fails to provide by will for a surviving spouse who married the testator after the execution of the will, the omitted spouse shall receive the same share of the estate he or she would have received if the decedent left no will (intestate share), unless: (a) it appears from the will or other evidence that the will was made in contemplation of the testator\'s marriage to the surviving spouse, (b) the will expresses the intention that it is to be effective notwithstanding any subsequent marriage, or (c) the testator provided for the spouse outside the will with the intention that the transfer be in lieu of a testamentary provision. This is a critical consideration when clients remarry — the will should be updated or should explicitly address the new spouse.',
    tags: ['will', 'omitted-spouse', 'elective-share', 'marriage', 'intestate'],
    docTypes: ['will', 'pourOverWill'],
  },
  {
    category: 'statute',
    title: 'NJ Wills — Pretermitted Heir Protection',
    citation: 'N.J.S.A. 3B:5-16',
    content:
      'If a testator fails to provide in the will for a child born or adopted after the execution of the will (pretermitted heir), the omitted after-born or after-adopted child receives a share in the estate as follows: if the testator had no child living when the will was executed, the omitted child receives the intestate share; if the testator had one or more children alive when the will was executed and devised property to one or more of those children, the omitted child shares in the property devised to the other children. The will should explicitly acknowledge all children and state any intentional omissions.',
    tags: ['will', 'pretermitted-heir', 'omitted-child', 'after-born', 'intestate'],
    docTypes: ['will', 'pourOverWill'],
  },
  {
    category: 'statute',
    title: 'NJ Wills — Executor Powers',
    citation: 'N.J.S.A. 3B:14-23',
    content:
      'Unless otherwise directed by the will, a personal representative (executor/administrator) has broad statutory powers including: to retain assets; to receive assets from fiduciaries; to make investments; to acquire or dispose of assets including real property; to manage, develop, improve, exchange, partition, change character of, or abandon estate assets; to borrow money; to pay taxes, assessments, and expenses; to sell or exercise stock rights; to insure assets; to distribute in kind; to make tax elections; to employ professionals. The will should include a broad powers clause that tracks these statutory powers and may expand upon them.',
    tags: ['will', 'executor', 'powers', 'fiduciary', 'administration'],
    docTypes: ['will', 'pourOverWill'],
  },
  {
    category: 'statute',
    title: 'NJ Wills — Revocation',
    citation: 'N.J.S.A. 3B:3-13',
    content:
      'A will or any part thereof is revoked: (a) by a subsequent will that revokes the prior will or part expressly or by inconsistency; or (b) by being burned, torn, canceled, obliterated, or destroyed, with the intent and for the purpose of revocation by the testator or by another person in the testator\'s conscious presence and by the testator\'s direction. Divorce or annulment revokes any revocable provision in favor of a former spouse (N.J.S.A. 3B:3-14). Always include an explicit revocation clause in any new will.',
    tags: ['will', 'revocation', 'divorce', 'prior-will'],
    docTypes: ['will', 'pourOverWill'],
  },
  {
    category: 'statute',
    title: 'NJ Wills — Incorporation by Reference',
    citation: 'N.J.S.A. 3B:3-16',
    content:
      'A writing in existence when a will is executed may be incorporated by reference if the language of the will manifests this intent and describes the writing sufficiently to permit its identification. This is the statutory basis for pour-over wills that direct assets to a trust. The trust instrument must exist at the time the will is executed (or as amended per N.J.S.A. 3B:3-16.1). This provision enables the common pour-over will + revocable living trust structure.',
    tags: ['will', 'incorporation', 'pour-over', 'trust', 'reference'],
    docTypes: ['will', 'pourOverWill', 'trust'],
  },

  // ── TRUSTS ──────────────────────────────────────────────────────────────────
  {
    category: 'statute',
    title: 'NJ Uniform Trust Code — Generally',
    citation: 'N.J.S.A. 3B:31-1 et seq.',
    content:
      'New Jersey adopted a modified version of the Uniform Trust Code (UTC) effective July 2016. The NJ UTC governs creation, modification, termination, and administration of trusts. Key provisions: (1) A trust may be created during the settlor\'s lifetime (inter vivos) or at death (testamentary). (2) A valid trust requires a settlor with capacity, a present intent to create a trust, an ascertainable beneficiary (except charitable trusts), and duties for the trustee. (3) The statute provides default rules that can generally be overridden by the trust instrument. (4) NJ does not have a Rule Against Perpetuities for personal property trusts created after 2016 (dynasty trusts permitted).',
    tags: ['trust', 'UTC', 'creation', 'validity', 'general'],
    docTypes: ['trust'],
  },
  {
    category: 'statute',
    title: 'NJ Trusts — Revocable Trust Provisions',
    citation: 'N.J.S.A. 3B:31-38 to 31-43',
    content:
      'A settlor may revoke or amend a revocable trust unless the trust expressly provides otherwise. During the lifetime of the settlor, the rights of the beneficiaries are subject to the control of the settlor. A revocable trust is not subject to the rules of mental capacity for wills; the standard is general contractual capacity. Upon revocation, the trustee must deliver the trust property as directed by the settlor. Capacity to revoke is the capacity required to create a trust, not testamentary capacity. This distinction can be important if capacity is contested.',
    tags: ['trust', 'revocable', 'amendment', 'revocation', 'capacity'],
    docTypes: ['trust'],
  },
  {
    category: 'statute',
    title: 'NJ Trusts — Spendthrift Provisions',
    citation: 'N.J.S.A. 3B:31-57',
    content:
      'A spendthrift provision is valid under NJ law. A valid spendthrift provision restrains both voluntary and involuntary transfer of a beneficiary\'s interest. Exceptions: (1) a child\'s claim for support; (2) a judgment creditor who provided services for the protection of the beneficiary\'s interest in the trust; (3) a claim of the State of NJ. A settlor cannot use a spendthrift provision to protect their own interest — a creditor or assignee of the settlor can reach the maximum amount that can be distributed to or for the settlor\'s benefit.',
    tags: ['trust', 'spendthrift', 'creditor-protection', 'beneficiary'],
    docTypes: ['trust'],
  },
  {
    category: 'statute',
    title: 'NJ Trusts — Trustee Duties & Prudent Investor Rule',
    citation: 'N.J.S.A. 3B:31-62 to 31-76',
    content:
      'A trustee owes duties of loyalty (N.J.S.A. 3B:31-64), impartiality among beneficiaries (3B:31-65), and prudent administration (3B:31-66). Under the NJ Prudent Investor Rule (3B:31-67), the trustee must invest and manage trust assets as a prudent investor would, considering the trust\'s purposes, terms, distribution requirements, and other circumstances. Diversification is required unless special circumstances make it inadvisable. The trustee may delegate investment and management functions to qualified agents.',
    tags: ['trust', 'trustee', 'fiduciary-duty', 'prudent-investor', 'loyalty'],
    docTypes: ['trust'],
  },
  {
    category: 'statute',
    title: 'NJ Trusts — Dynasty Trust / Perpetuities',
    citation: 'N.J.S.A. 46:2F-9',
    content:
      'New Jersey abolished the Rule Against Perpetuities for interests in personal property held in trust created on or after July 9, 1999. Interests in real property in trust are still subject to a wait-and-see period. This means a properly drafted NJ trust holding personal property can last in perpetuity (dynasty trust). For fortress-level estate plans, dynasty trust provisions can protect wealth for multiple generations from creditors, divorce, and estate taxes.',
    tags: ['trust', 'dynasty', 'perpetuities', 'personal-property', 'wealth-transfer'],
    docTypes: ['trust'],
  },

  // ── POWER OF ATTORNEY ──────────────────────────────────────────────────────
  {
    category: 'statute',
    title: 'NJ Durable Power of Attorney Act',
    citation: 'N.J.S.A. 46:2B-8.1 to 8.13',
    content:
      'The NJ Durable Power of Attorney Act authorizes a competent adult to appoint an agent to act on their behalf. Key provisions: (1) A power of attorney is durable if it contains the words "This power of attorney shall not be affected by subsequent disability or incapacity of the principal" or substantially similar language. (2) Must be signed by the principal and acknowledged before a notary. (3) Two witnesses are recommended but not required by statute. (4) The agent has a fiduciary duty to the principal. (5) Third parties who refuse to honor a valid durable POA may be subject to court-ordered compliance and attorney\'s fees.',
    tags: ['poa', 'durable', 'agent', 'power', 'general'],
    docTypes: ['poa'],
  },
  {
    category: 'statute',
    title: 'NJ POA — Agent Powers and Limitations',
    citation: 'N.J.S.A. 46:2B-8.9',
    content:
      'An agent under a durable POA generally may exercise all powers that the principal could exercise personally, subject to limitations in the instrument. Specific powers that should be explicitly granted if desired: (1) gifts — gifting power must be expressly authorized and may be limited by amount or recipient; (2) self-dealing — the agent cannot benefit personally from transactions unless explicitly authorized; (3) real property transactions — should be specifically authorized; (4) creation or amendment of trusts; (5) beneficiary designation changes; (6) access to digital assets. Best practice: enumerate specific powers rather than relying on general language.',
    tags: ['poa', 'agent-powers', 'gifting', 'self-dealing', 'limitations'],
    docTypes: ['poa'],
  },
  {
    category: 'statute',
    title: 'NJ POA — Springing Powers',
    citation: 'N.J.S.A. 46:2B-8.1',
    content:
      'A durable power of attorney may be effective immediately upon execution or may "spring" into effect upon a specified event, typically the principal\'s incapacity as certified by one or more physicians. Drafting considerations: (1) Define the triggering event precisely (e.g., written certification by attending physician and one independent physician); (2) A springing POA avoids the risk of premature use but can cause delays when the agent needs to act quickly; (3) An immediately effective POA is simpler for third-party acceptance; (4) Consider a hybrid approach: immediately effective but with instructions that the agent should not act unless incapacity occurs.',
    tags: ['poa', 'springing', 'incapacity', 'effective-date', 'triggering-event'],
    docTypes: ['poa'],
  },
  {
    category: 'statute',
    title: 'NJ POA — Third-Party Acceptance',
    citation: 'N.J.S.A. 46:2B-8.9a',
    content:
      'A third party who is presented with a durable power of attorney must accept the POA within a reasonable time or face liability. If the third party refuses to accept, the agent or principal may bring a court action to compel acceptance. The court may award attorney\'s fees and costs against the unreasonably refusing party. This provision was enacted to address the common problem of banks and financial institutions refusing to honor valid POAs. Include the statutory citation in the POA document itself to put third parties on notice of their obligation.',
    tags: ['poa', 'third-party', 'acceptance', 'bank', 'enforcement'],
    docTypes: ['poa'],
  },
  {
    category: 'statute',
    title: 'NJ POA — Revocation',
    citation: 'N.J.S.A. 46:2B-8.5',
    content:
      'A durable power of attorney may be revoked by the principal at any time, provided the principal has capacity. Revocation should be: (1) in writing, (2) signed and acknowledged (notarized), (3) delivered to the agent, and (4) delivered to all third parties who have been dealing with the agent. The revocation is effective against the agent when received. Consider recording the revocation if real property transactions were authorized. Practical tip: advise clients that simply destroying the original POA is insufficient — third parties may have copies.',
    tags: ['poa', 'revocation', 'notice', 'effective-date'],
    docTypes: ['poa'],
  },

  // ── ADVANCE DIRECTIVES ─────────────────────────────────────────────────────
  {
    category: 'statute',
    title: 'NJ Advance Directives for Health Care Act',
    citation: 'N.J.S.A. 26:2H-53 to 26:2H-78',
    content:
      'The NJ Advance Directives Act allows a competent adult to execute: (1) a proxy directive (healthcare proxy) appointing an agent to make healthcare decisions; (2) an instruction directive (living will) documenting treatment preferences; or (3) a combined directive covering both. Requirements: must be signed by the declarant (or at direction), witnessed by two adults (who are not the healthcare representative), and the declarant\'s signature may be acknowledged before a notary in lieu of witnessing. The directive becomes operative when the attending physician determines the patient lacks capacity.',
    tags: ['advance-directive', 'living-will', 'healthcare-proxy', 'capacity', 'witnesses'],
    docTypes: ['livingWill'],
  },
  {
    category: 'statute',
    title: 'NJ Living Will — Life-Sustaining Treatment',
    citation: 'N.J.S.A. 26:2H-55 to 26:2H-57',
    content:
      'An instruction directive (living will) may address: (1) life-sustaining treatment including mechanical ventilation, CPR, dialysis; (2) artificially provided fluids and nutrition; (3) pain management preferences; (4) organ donation preferences; (5) any other healthcare decision. The living will must clearly state preferences for treatment in terminal conditions, permanent unconsciousness, and serious illness. NJ law distinguishes between withholding/withdrawing life-sustaining treatment (which may be directed) and active euthanasia (which is not permitted).',
    tags: ['living-will', 'life-sustaining', 'treatment', 'nutrition', 'terminal'],
    docTypes: ['livingWill'],
  },
  {
    category: 'statute',
    title: 'NJ Healthcare Proxy — Agent Authority',
    citation: 'N.J.S.A. 26:2H-58 to 26:2H-62',
    content:
      'A healthcare representative (proxy) has authority to make all healthcare decisions the principal could make, including decisions about life-sustaining treatment, subject to any limitations in the directive. The representative must: (1) act in accordance with the patient\'s wishes as expressed in the directive or otherwise communicated; (2) if the patient\'s wishes are unknown, act in the patient\'s best interest; (3) may not consent to voluntary admission to a psychiatric facility. An alternate representative should always be named in case the primary is unavailable or unwilling to serve.',
    tags: ['healthcare-proxy', 'agent', 'authority', 'decisions', 'best-interest'],
    docTypes: ['livingWill'],
  },

  // ── REAL PROPERTY / DEEDS ──────────────────────────────────────────────────
  {
    category: 'statute',
    title: 'NJ Deeds — Bargain and Sale',
    citation: 'N.J.S.A. 46:4-1 to 46:4-6',
    content:
      'New Jersey primarily uses bargain-and-sale deeds (with or without covenants against grantor\'s acts). A bargain-and-sale deed with covenants against grantor\'s acts is the standard deed form for residential transfers. It contains a representation that the grantor has not done anything to encumber the title but does not provide full warranties. Requirements for a valid deed: (1) in writing; (2) signed by the grantor; (3) acknowledged before a notary or other authorized officer; (4) delivered to and accepted by the grantee. Recording is not required for validity between the parties but is necessary to protect against subsequent bona fide purchasers.',
    tags: ['deed', 'bargain-sale', 'real-property', 'transfer', 'covenants'],
    docTypes: ['deed'],
  },
  {
    category: 'statute',
    title: 'NJ Realty Transfer Fee',
    citation: 'N.J.S.A. 46:15-7 to 46:15-10',
    content:
      'New Jersey imposes a Realty Transfer Fee (RTF) on the recording of deeds transferring real property. The fee is calculated on the consideration paid. Exemptions that are relevant to estate planning: (1) transfers between spouses; (2) transfers pursuant to a divorce settlement; (3) transfers to a trust where the grantor is the beneficiary; (4) transfers where the consideration is less than $100; (5) transfers to or from the United States or State of NJ. For estate plan transfers to a revocable living trust, use the exemption for transfers to a trust where the grantor is a beneficiary. File Form RTF-1 (or RTF-1EE for exempt transfers) with the deed.',
    tags: ['deed', 'transfer-fee', 'RTF', 'exemption', 'trust-transfer'],
    docTypes: ['deed', 'affidavitOfConsideration'],
  },
  {
    category: 'statute',
    title: 'NJ Affidavit of Consideration / Exemption',
    citation: 'N.J.S.A. 46:15-10',
    content:
      'Every deed recorded in NJ must be accompanied by an Affidavit of Consideration or an Affidavit of Exemption (Form RTF-1EE). For estate plan transfers to a revocable living trust, the appropriate exemption is generally code "e" (transfer between a person and a trust created by that person for no consideration). The affidavit must state the consideration paid (or the exemption claimed), be signed by the grantee or grantor\'s attorney, and be recorded with the deed. Failure to include the affidavit will result in rejection of the deed by the county recording office.',
    tags: ['deed', 'affidavit', 'consideration', 'exemption', 'recording'],
    docTypes: ['deed', 'affidavitOfConsideration'],
  },
  {
    category: 'statute',
    title: 'NJ GIT/REP-3 — Non-Resident Seller Withholding',
    citation: 'N.J.S.A. 54A:8-8.1',
    content:
      'When real property in NJ is transferred, the buyer/transferee must withhold and remit estimated gross income tax unless the seller/transferor provides a GIT/REP form certifying exemption. GIT/REP-3 is used for transactions involving trusts and estates. This form certifies that the seller is a NJ resident and not subject to withholding. For estate plan transfers to a revocable trust, complete GIT/REP-3 to certify the transfer is exempt. The form must be filed at closing and a copy recorded with the deed.',
    tags: ['deed', 'GIT-REP', 'tax', 'withholding', 'non-resident'],
    docTypes: ['deed', 'gitRep3'],
  },

  // ── GUARDIANSHIP ────────────────────────────────────────────────────────────
  {
    category: 'statute',
    title: 'NJ Guardianship of Minors',
    citation: 'N.J.S.A. 3B:12-1 et seq.',
    content:
      'A parent may appoint a guardian of a minor child by will. The appointment is effective upon the death of the appointing parent if: (1) there is no surviving parent willing to serve; or (2) if the will appoints a guardian in the event of the appointing parent\'s death. A testamentary guardian does not automatically receive custody — the Surrogate\'s Court must confirm the appointment, and the child\'s best interests are paramount. Both parents should designate the same guardian in their respective wills to avoid conflicts. Always name alternate guardians in case the primary is unable or unwilling to serve.',
    tags: ['guardian', 'minor', 'custody', 'will', 'appointment'],
    docTypes: ['will', 'pourOverWill'],
  },

  // ── INTESTATE SUCCESSION ────────────────────────────────────────────────────
  {
    category: 'statute',
    title: 'NJ Intestate Succession — Share of Surviving Spouse',
    citation: 'N.J.S.A. 3B:5-3',
    content:
      'If a decedent dies without a will, the surviving spouse receives: (1) the entire estate if there are no surviving descendants or parents; (2) the first 25% of the estate (but not less than $50,000 nor more than $200,000) plus 50% of the balance, if the descendants are also descendants of the surviving spouse; (3) 50% of the estate if there are descendants who are not descendants of the surviving spouse. Understanding intestate shares is essential for explaining to clients why they need a will — the default distribution may not match their wishes.',
    tags: ['intestate', 'surviving-spouse', 'distribution', 'no-will', 'default'],
    docTypes: ['will', 'pourOverWill', 'estatePlanSummary'],
  },
  {
    category: 'statute',
    title: 'NJ Elective Share of Surviving Spouse',
    citation: 'N.J.S.A. 3B:8-1',
    content:
      'Even if a will disinherits the surviving spouse, NJ law entitles the surviving spouse to elect against the will and receive one-third of the augmented estate. The augmented estate includes: the probate estate reduced by funeral and administration expenses, creditor claims, and family allowances; plus the value of non-probate transfers to persons other than the surviving spouse; plus the value of the surviving spouse\'s non-probate transfers to others. The election must be filed within 6 months of the Surrogate\'s appointment of the personal representative.',
    tags: ['elective-share', 'surviving-spouse', 'augmented-estate', 'disinheritance'],
    docTypes: ['will', 'pourOverWill', 'trust', 'estatePlanSummary'],
  },

  // ── PROBATE ──────────────────────────────────────────────────────────────────
  {
    category: 'statute',
    title: 'NJ Simplified Probate — Small Estates',
    citation: 'N.J.S.A. 3B:10-3 and 3B:10-4',
    content:
      'NJ allows simplified administration for small estates: (1) Summary Administration (3B:10-3): For estates where the entire estate passes to the surviving spouse, executrix/executor may seek summary judgment. (2) Small Estate Affidavit (3B:10-4): If the total value of the decedent\'s personally owned property (excluding real property) does not exceed $50,000 and at least 30 days have elapsed since death, the entitled person may collect assets by presenting a small estate affidavit to the holder of the property. This avoids the need for formal probate.',
    tags: ['probate', 'small-estate', 'simplified', 'affidavit', 'administration'],
    docTypes: ['estatePlanSummary'],
  },

  // ── CHECKLISTS ──────────────────────────────────────────────────────────────
  {
    category: 'checklist',
    title: 'Estate Plan Execution Ceremony Checklist',
    citation: '',
    content:
      'PRE-CEREMONY:\n□ All documents printed on legal-weight paper\n□ Blue ink pens available (blue distinguishes originals from copies)\n□ Two adult non-beneficiary witnesses present\n□ Notary public present with seal and journal\n□ Verify client identity (photo ID)\n□ Client has reviewed all documents\n\nWILL SIGNING:\n□ Client initials each page of the will\n□ Client signs at the bottom of the last page of dispositive provisions\n□ Both witnesses sign the attestation clause\n□ Self-proving affidavit signed by client and witnesses before notary\n\nTRUST SIGNING:\n□ Settlor signs each page\n□ Settlor signs signature page\n□ Trustee acceptance signed\n□ Notarize signature page\n\nPOWER OF ATTORNEY:\n□ Principal signs (client)\n□ Notarize principal\'s signature\n□ Agent acknowledgment signed (recommended)\n\nADVANCE DIRECTIVE:\n□ Client signs\n□ Two adult witnesses sign (may not be the healthcare proxy)\n□ May notarize in lieu of witnesses\n\nDEED:\n□ Grantor signs\n□ Notarize grantor\'s signature\n□ Attach RTF-1EE (exemption form)\n□ Attach GIT/REP-3\n□ Record with county clerk\n\nPOST-CEREMONY:\n□ Provide client with copies of all signed documents\n□ Store originals in secure location or client\'s safe deposit box\n□ Original will should be accessible — not locked in a safe deposit box only the decedent can access\n□ Remind client about trust funding (beneficiary designations, deed recording)\n□ Schedule 6-month follow-up for trust funding verification',
    tags: ['execution', 'ceremony', 'signing', 'checklist', 'witnesses', 'notary'],
    docTypes: ['will', 'pourOverWill', 'poa', 'livingWill', 'trust', 'deed'],
  },
  {
    category: 'checklist',
    title: 'Trust Funding Checklist',
    citation: '',
    content:
      'REAL PROPERTY:\n□ Deed prepared from individual name to trust\n□ RTF-1EE (exempt transfer) completed\n□ GIT/REP-3 (tax exemption) completed\n□ Deed recorded with county recording office\n□ Homeowner\'s insurance updated to reflect trust ownership\n□ Mortgage company notified (if applicable — most mortgages have due-on-sale clauses but exempt transfers to revocable trusts)\n\nBANK ACCOUNTS:\n□ Re-title checking/savings to trust name (or add POD/TOD to trust)\n□ New checks ordered with trust name\n□ Online banking access updated\n□ Safe deposit box re-titled\n\nINVESTMENT/BROKERAGE ACCOUNTS:\n□ Re-title to trust (or designate trust as TOD beneficiary)\n□ New account number/title reflects trust\n□ Updated investment authority documentation\n\nRETIREMENT ACCOUNTS (DO NOT TRANSFER TO TRUST):\n□ Update primary beneficiary designation (typically spouse)\n□ Update contingent beneficiary to trust (for IRA/401k stretch planning)\n□ Confirm with custodian that designations are on file\n\nLIFE INSURANCE:\n□ Change owner to ILIT (if applicable)\n□ Change beneficiary per estate plan instructions\n□ Confirm with insurance company\n\nBUSINESS INTERESTS:\n□ Assign LLC/partnership interests to trust\n□ Update operating agreement to reflect trust ownership\n□ Maintain personal guarantee obligations if required\n\nPERSONAL PROPERTY:\n□ Execute assignment of personal property to trust\n□ Vehicle titles generally NOT transferred (use TOD registration)\n\nDIGITAL ASSETS:\n□ Document digital asset inventory\n□ Include access credentials in secure location referenced in trust\n□ Consider digital asset trust provisions',
    tags: ['trust', 'funding', 'checklist', 'retitling', 'beneficiary-designation'],
    docTypes: ['trust', 'deed', 'estatePlanSummary'],
  },
  {
    category: 'checklist',
    title: 'Beneficiary Designation Review Checklist',
    citation: '',
    content:
      'LIFE INSURANCE POLICIES:\n□ List all policies (term, whole, universal, group through employer)\n□ Verify primary and contingent beneficiary for each policy\n□ Consider ILIT ownership for estate tax planning\n\nRETIREMENT ACCOUNTS:\n□ IRA / Roth IRA — verify primary and contingent beneficiaries\n□ 401(k) / 403(b) / 457 — verify beneficiary (spousal consent may be required for non-spouse)\n□ Pension plans — verify survivor benefit elections\n□ Annuities — verify beneficiary designations\n\nTRANSFER ON DEATH (TOD) / PAYABLE ON DEATH (POD):\n□ Brokerage accounts — TOD beneficiary registered\n□ Bank accounts — POD beneficiary designated\n□ NJ allows TOD for vehicle titles\n\nHEALTH SAVINGS ACCOUNTS (HSA):\n□ Verify beneficiary (surviving spouse can inherit as own HSA)\n\nCOMMON ISSUES:\n□ Stale beneficiaries (ex-spouse still listed)\n□ Minor children listed directly (should use UTMA or trust)\n□ Estate listed as beneficiary (causes probate, no stretch IRA)\n□ No contingent beneficiary listed\n□ Beneficiary designations that conflict with trust/will\n\nRECUMMENDATIONS:\n□ Review all beneficiary designations at least every 3 years\n□ Review immediately after: marriage, divorce, birth, adoption, death of beneficiary\n□ Keep copies of all submitted beneficiary designation forms\n□ Bring original designation forms to initial planning consultation',
    tags: ['beneficiary', 'designation', 'review', 'life-insurance', 'retirement', 'checklist'],
    docTypes: ['estatePlanSummary'],
  },

  // ── PRACTICE NOTES ──────────────────────────────────────────────────────────
  {
    category: 'practice_note',
    title: 'NJ Will Execution Ceremony — Best Practices',
    citation: '',
    content:
      'CEREMONY PROTOCOL:\n\n1. ENVIRONMENT: Conduct the ceremony in a quiet, private room. Only the testator, witnesses, notary, and attorney should be present. Potential beneficiaries should leave the room to avoid undue influence claims.\n\n2. CAPACITY CHECK: Before signing, ask the testator basic questions to document capacity: full name, date, address, family members, nature and extent of property, purpose of the documents being signed. Document the testator\'s responses in the file.\n\n3. PUBLICATION: The testator should declare to the witnesses: "This is my Last Will and Testament. I have read it, understand it, and it reflects my wishes. I ask you to serve as witnesses."\n\n4. SIGNING ORDER: (a) Testator signs first; (b) Each witness signs the attestation; (c) Testator and witnesses sign the self-proving affidavit before the notary.\n\n5. CONSISTENCY: All signatures should match the name as it appears in the document. Use the same pen (blue ink) throughout.\n\n6. NOTARY: The notary should observe all signatures and complete the self-proving affidavit notarization. The notary should NOT be a beneficiary, witness, or family member.\n\n7. POST-EXECUTION: Staple the will (do not remove staples — missing pages suggest tampering). Provide 2 copies to client. Original stored per firm policy.',
    tags: ['will', 'execution', 'ceremony', 'best-practice', 'capacity', 'witnesses'],
    docTypes: ['will', 'pourOverWill'],
  },
  {
    category: 'practice_note',
    title: 'Common Estate Planning Drafting Pitfalls — NJ',
    citation: '',
    content:
      '1. FAILING TO FUND THE TRUST: The #1 mistake. Creating a revocable living trust without re-titling assets into the trust means the trust provides no probate avoidance benefit. Always provide a trust funding checklist and schedule follow-up.\n\n2. INCONSISTENT BENEFICIARY DESIGNATIONS: Life insurance, retirement accounts, and TOD/POD accounts pass outside the will/trust. If these designations conflict with the estate plan, the account designation controls — not the will.\n\n3. NAMING MINORS DIRECTLY: Never name minor children as direct beneficiaries of life insurance, retirement accounts, or outright bequests in a will. Use a trust (testamentary or standalone) to hold assets for minors.\n\n4. FORGETTING TO ADDRESS DIGITAL ASSETS: NJ adopted the Revised Uniform Fiduciary Access to Digital Assets Act (N.J.S.A. 3B:14-71 to 14-82). Include digital asset provisions in POA and trust documents.\n\n5. STALE DOCUMENTS: Will naming ex-spouse as executor (N.J.S.A. 3B:3-14 revokes provisions for former spouse upon divorce, but explicit revocation is better practice). Outdated guardian nominations after children reach majority.\n\n6. MISSING ALTERNATE FIDUCIARIES: Always name primary, alternate, and successor for executor, trustee, guardian, POA agent, and healthcare proxy.\n\n7. UNCLEAR RESIDUARY CLAUSE: If the residuary clause doesn\'t account for all contingencies (all primary and alternate beneficiaries predecease), assets may pass by intestate succession despite having a will.\n\n8. INADEQUATE WITNESS PROCEDURES: Using beneficiaries as witnesses (NJ does not invalidate the will but may disqualify the witness-beneficiary from receiving their bequest under N.J.S.A. 3B:3-7).',
    tags: ['drafting', 'pitfalls', 'common-mistakes', 'best-practice', 'trust-funding'],
    docTypes: ['will', 'pourOverWill', 'trust', 'poa', 'livingWill', 'estatePlanSummary'],
  },
  {
    category: 'practice_note',
    title: 'NJ Estate Tax & Inheritance Tax Overview',
    citation: 'N.J.S.A. 54:34 et seq.',
    content:
      'ESTATE TAX: NJ repealed its estate tax effective January 1, 2018. Estates of decedents dying on or after January 1, 2018 are not subject to NJ estate tax. Federal estate tax still applies (2026 unified credit: $5.49M per person, subject to sunset).\n\nINHERITANCE TAX: NJ still imposes an inheritance tax (N.J.S.A. 54:34 et seq.) based on the relationship between the decedent and the beneficiary:\n• Class A (spouse, children, grandchildren, parents): exempt\n• Class C (siblings, spouse/widow of child): first $25,000 exempt, 11-16% on excess\n• Class D (all others, including friends, non-relatives, cousins): 15-16% on entire amount\n• Class E (charitable organizations, government): exempt\n\nPLANNING IMPLICATIONS:\n- Life insurance payable to Class A beneficiaries: no NJ inheritance tax\n- Life insurance payable to Class D beneficiaries (e.g., unmarried partner): consider ILIT to avoid both estate and inheritance tax\n- Transfers to trusts: the inheritance tax applies based on the relationship of the ultimate beneficiary, not the trust\n- Due date: 8 months from date of death; interest accrues from date of death',
    tags: ['estate-tax', 'inheritance-tax', 'NJ', 'tax-planning', 'exemptions'],
    docTypes: ['estatePlanSummary', 'trust', 'will'],
  },
  {
    category: 'practice_note',
    title: 'Digital Assets in NJ Estate Planning',
    citation: 'N.J.S.A. 3B:14-71 to 14-82',
    content:
      'NJ adopted the Revised Uniform Fiduciary Access to Digital Assets Act (RUFADAA) in 2017. Key provisions:\n\n1. PRIORITY: A user\'s directions in an online tool (e.g., Google Inactive Account Manager, Facebook Legacy Contact) override the estate plan. If no online tool direction exists, the estate plan controls. If neither exists, the platform\'s terms of service apply.\n\n2. FIDUCIARY ACCESS: With proper authorization, fiduciaries (executors, trustees, POA agents, guardians) may access digital assets including email, social media, financial accounts, cryptocurrency, domain names, and cloud-stored files.\n\n3. AUTHORIZATION: The POA, will, or trust should include specific language granting access to digital assets and overriding default terms of service.\n\n4. BEST PRACTICES:\n- Include digital asset provisions in all POAs and trust agreements\n- Maintain an encrypted digital asset inventory (not in the will — wills become public at probate)\n- Use a password manager and provide fiduciaries with access instructions\n- Consider separate digital asset memorandum referenced in the trust\n- Address cryptocurrency specifically (private keys, hardware wallets)',
    tags: ['digital-assets', 'RUFADAA', 'online-accounts', 'cryptocurrency', 'password-manager'],
    docTypes: ['poa', 'trust', 'will', 'estatePlanSummary'],
  },

  // ── CASE LAW ────────────────────────────────────────────────────────────────
  {
    category: 'case_law',
    title: 'In re Estate of Kuralt — Testamentary Intent via Letter',
    citation: 'In re Kuralt, 15 P.3d 931 (Mont. 2000)',
    content:
      'While not a NJ case, frequently cited in NJ CLE materials. CBS journalist Charles Kuralt wrote a letter to his companion expressing intent to transfer Montana property. The court held the letter constituted a valid holographic codicil because it demonstrated testamentary intent and was entirely in the testator\'s handwriting. NJ relevance: NJ does not recognize holographic wills (N.J.S.A. 3B:3-2 requires two witnesses), so informal writings cannot serve as testamentary instruments in NJ. This case illustrates why proper will execution formalities matter.',
    tags: ['case-law', 'testamentary-intent', 'holographic', 'formalities'],
    docTypes: ['will'],
  },
  {
    category: 'case_law',
    title: 'Haynes v. First National State Bank of NJ — Undue Influence',
    citation: 'Haynes v. First Nat\'l State Bank, 87 N.J. 163 (1981)',
    content:
      'The NJ Supreme Court established the framework for evaluating undue influence claims in will contests. The burden shifts to the proponent of the will when the contestant establishes a presumption of undue influence by showing: (1) the will beneficiary had a confidential relationship with the testator, and (2) there are suspicious circumstances. Suspicious circumstances include: the drafting attorney was selected by the beneficiary, the beneficiary had close involvement in the execution, the testator was of weakened intellect, and the dispositions depart from previously expressed intentions. Practice implication: document testamentary capacity at execution and ensure no beneficiary is involved in selecting the attorney or drafting the documents.',
    tags: ['case-law', 'undue-influence', 'will-contest', 'confidential-relationship', 'burden-of-proof'],
    docTypes: ['will', 'pourOverWill', 'trust'],
  },
  {
    category: 'case_law',
    title: 'Tannen v. Tannen — Trust Accounting & Fiduciary Duty',
    citation: 'Tannen v. Tannen, 416 N.J. Super. 248 (App. Div. 2010)',
    content:
      'The NJ Appellate Division held that a trustee owes a fiduciary duty to beneficiaries that includes: (1) duty to account — the trustee must maintain records and provide accountings to beneficiaries upon request; (2) duty of loyalty — the trustee must administer the trust solely in the interests of the beneficiaries; (3) duty of impartiality — when there are multiple beneficiaries, the trustee must act impartially. The court also addressed the standard for removal of a trustee, noting that removal may be warranted when the trustee\'s conduct substantially impairs a beneficiary\'s interest, even absent bad faith. Include clear accounting and reporting requirements in all trust instruments.',
    tags: ['case-law', 'trustee', 'fiduciary-duty', 'accounting', 'removal'],
    docTypes: ['trust'],
  },
];

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const seedKnowledgeBase = onCall(
  { region: 'us-east1', memory: '512MiB', timeoutSeconds: 120 },
  async (request: CallableRequest<unknown>) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    const { firmId } = request.data as { firmId: string };
    if (!firmId) {
      throw new HttpsError('invalid-argument', 'firmId is required.');
    }

    // Only admin and attorney roles
    const role = request.auth.token.role as string | undefined;
    if (!role || !['admin', 'attorney', 'paralegal'].includes(role)) {
      throw new HttpsError('permission-denied', 'Only staff members can seed the knowledge base.');
    }

    if ((request.auth.token['firmId'] as string | undefined) !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot seed knowledge base for a different firm.');
    }

    const db = admin.firestore();
    const kbCol = db.collection('firms').doc(firmId).collection('knowledgeBase');
    const now = admin.firestore.FieldValue.serverTimestamp();

    // Fetch existing resources to check for duplicates by citation or title
    const existingSnap = await kbCol.get();
    const existingCitations = new Set<string>();
    const existingTitles = new Set<string>();
    for (const doc of existingSnap.docs) {
      const data = doc.data();
      if (data.citation) existingCitations.add(data.citation);
      if (data.title) existingTitles.add(data.title);
    }

    // Batch writes (max 500 per batch)
    let batch = db.batch();
    let batchCount = 0;
    let inserted = 0;
    let skipped = 0;

    for (const seed of NJ_STATUTES) {
      // Idempotent: skip if already exists
      if (
        (seed.citation && existingCitations.has(seed.citation)) ||
        existingTitles.has(seed.title)
      ) {
        skipped++;
        continue;
      }

      const ref = kbCol.doc();
      batch.set(ref, {
        id: ref.id,
        firmId,
        category: seed.category,
        title: seed.title,
        citation: seed.citation,
        content: seed.content,
        tags: seed.tags,
        docTypes: seed.docTypes,
        jurisdiction: 'NJ',
        isActive: true,
        source: 'system-seed',
        sourceUrl: '',
        createdAt: now,
        updatedAt: now,
        createdBy: request.auth.uid,
        updatedBy: request.auth.uid,
      });

      inserted++;
      batchCount++;

      // Commit every 400 docs (under 500 limit)
      if (batchCount >= 400) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }

    // Final commit
    if (batchCount > 0) {
      await batch.commit();
    }

    console.log(`[seedKnowledgeBase] Seeded ${inserted} resources, skipped ${skipped} duplicates for firm ${firmId}`);

    return {
      success: true,
      inserted,
      skipped,
      total: NJ_STATUTES.length,
    };
  },
);
