/**
 * functions/src/template-variables.ts
 *
 * Variable-to-questionnaire mapping table for Handlebars templates.
 *
 * Extracted from template-engine.ts so the ~134-line mapping table is only
 * loaded when template rendering actually needs it, rather than on every
 * Cloud Function invocation (including AI-only mode).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VariableMapping {
  /** The variable path used in templates, e.g. 'personalInfo.firstName' */
  variable: string;
  /** Questionnaire section name, e.g. 'About You' */
  section: string;
  /** Human-readable field label, e.g. 'First Name' */
  label: string;
  /** Dot-path into QuestionnaireData or 'computed' */
  fieldPath: string;
}

// ---------------------------------------------------------------------------
// Variable → Questionnaire field mapping
// ---------------------------------------------------------------------------

/**
 * Maps template variable paths to their questionnaire section + label.
 * Built from the questionnaire step definitions + computed fields from
 * client-context-aggregator.ts.
 */
export const VARIABLE_TO_QUESTIONNAIRE_MAP: Record<string, VariableMapping> = {
  // ------ Section: About You (personalInfo) ------
  'personalInfo.firstName':     { variable: 'personalInfo.firstName',     section: 'About You',     label: 'First Name',           fieldPath: 'personalInfo.firstName' },
  'personalInfo.middleName':    { variable: 'personalInfo.middleName',    section: 'About You',     label: 'Middle Name',          fieldPath: 'personalInfo.middleName' },
  'personalInfo.lastName':      { variable: 'personalInfo.lastName',      section: 'About You',     label: 'Last Name',            fieldPath: 'personalInfo.lastName' },
  'personalInfo.suffix':        { variable: 'personalInfo.suffix',        section: 'About You',     label: 'Suffix',               fieldPath: 'personalInfo.suffix' },
  'personalInfo.dob':           { variable: 'personalInfo.dob',           section: 'About You',     label: 'Date of Birth',        fieldPath: 'personalInfo.dob' },
  'personalInfo.ssnLast4':      { variable: 'personalInfo.ssnLast4',      section: 'About You',     label: 'SSN Last 4',           fieldPath: 'personalInfo.ssnLast4' },
  'personalInfo.address':       { variable: 'personalInfo.address',       section: 'About You',     label: 'Street Address',       fieldPath: 'personalInfo.address' },
  'personalInfo.city':          { variable: 'personalInfo.city',          section: 'About You',     label: 'City',                 fieldPath: 'personalInfo.city' },
  'personalInfo.state':         { variable: 'personalInfo.state',         section: 'About You',     label: 'State',                fieldPath: 'personalInfo.state' },
  'personalInfo.zip':           { variable: 'personalInfo.zip',           section: 'About You',     label: 'ZIP Code',             fieldPath: 'personalInfo.zip' },
  'personalInfo.county':        { variable: 'personalInfo.county',        section: 'About You',     label: 'County',               fieldPath: 'personalInfo.county' },
  'personalInfo.email':         { variable: 'personalInfo.email',         section: 'About You',     label: 'Email Address',        fieldPath: 'personalInfo.email' },
  'personalInfo.phone':         { variable: 'personalInfo.phone',         section: 'About You',     label: 'Phone Number',         fieldPath: 'personalInfo.phone' },
  'personalInfo.maritalStatus': { variable: 'personalInfo.maritalStatus', section: 'About You',     label: 'Marital Status',       fieldPath: 'personalInfo.maritalStatus' },
  'personalInfo.citizenship':   { variable: 'personalInfo.citizenship',   section: 'About You',     label: 'Citizenship',          fieldPath: 'personalInfo.citizenship' },
  'personalInfo.occupation':    { variable: 'personalInfo.occupation',    section: 'About You',     label: 'Occupation',           fieldPath: 'personalInfo.occupation' },
  'personalInfo.employer':      { variable: 'personalInfo.employer',      section: 'About You',     label: 'Employer',             fieldPath: 'personalInfo.employer' },

  // ------ Section: Your Spouse ------
  'spouseInfo':                 { variable: 'spouseInfo',                 section: 'Your Spouse',   label: 'Spouse Information',   fieldPath: 'spouseInfo' },
  'spouseInfo.firstName':       { variable: 'spouseInfo.firstName',       section: 'Your Spouse',   label: 'Spouse First Name',    fieldPath: 'spouseInfo.firstName' },
  'spouseInfo.middleName':      { variable: 'spouseInfo.middleName',      section: 'Your Spouse',   label: 'Spouse Middle Name',   fieldPath: 'spouseInfo.middleName' },
  'spouseInfo.lastName':        { variable: 'spouseInfo.lastName',        section: 'Your Spouse',   label: 'Spouse Last Name',     fieldPath: 'spouseInfo.lastName' },
  'spouseInfo.dob':             { variable: 'spouseInfo.dob',             section: 'Your Spouse',   label: 'Spouse Date of Birth', fieldPath: 'spouseInfo.dob' },
  'spouseInfo.email':           { variable: 'spouseInfo.email',           section: 'Your Spouse',   label: 'Spouse Email',         fieldPath: 'spouseInfo.email' },
  'spouseInfo.phone':           { variable: 'spouseInfo.phone',           section: 'Your Spouse',   label: 'Spouse Phone',         fieldPath: 'spouseInfo.phone' },

  // ------ Section: Children & Dependents ------
  'children':                   { variable: 'children',                   section: 'Children',      label: 'Children List',        fieldPath: 'children' },
  'hasChildren':                { variable: 'hasChildren',                section: 'Children',      label: 'Has Children',         fieldPath: 'hasChildren' },
  'hasOtherDependents':         { variable: 'hasOtherDependents',         section: 'Children',      label: 'Has Other Dependents', fieldPath: 'hasOtherDependents' },
  'otherDependents':            { variable: 'otherDependents',            section: 'Children',      label: 'Other Dependents',     fieldPath: 'otherDependents' },
  'guardianPrimary':            { variable: 'guardianPrimary',            section: 'Children',      label: 'Primary Guardian',     fieldPath: 'guardianPrimary' },
  'guardianPrimary.name':       { variable: 'guardianPrimary.name',       section: 'Children',      label: 'Primary Guardian Name', fieldPath: 'guardianPrimary.name' },
  'guardianAlternate':          { variable: 'guardianAlternate',          section: 'Children',      label: 'Alternate Guardian',   fieldPath: 'guardianAlternate' },
  'guardianAlternate.name':     { variable: 'guardianAlternate.name',     section: 'Children',      label: 'Alternate Guardian Name', fieldPath: 'guardianAlternate.name' },

  // ------ Section: Fiduciaries ------
  'fiduciaries':                                        { variable: 'fiduciaries',                                        section: 'Fiduciaries', label: 'Fiduciaries',                  fieldPath: 'fiduciaries' },
  'fiduciaries.powerOfAttorney.agent':                  { variable: 'fiduciaries.powerOfAttorney.agent',                  section: 'Fiduciaries', label: 'POA Primary Agent',            fieldPath: 'fiduciaries.powerOfAttorney.agent' },
  'fiduciaries.powerOfAttorney.agent.address':          { variable: 'fiduciaries.powerOfAttorney.agent.address',          section: 'Fiduciaries', label: 'POA Agent Address',            fieldPath: 'fiduciaries.powerOfAttorney.agent.address' },
  'fiduciaries.powerOfAttorney.agent.city':             { variable: 'fiduciaries.powerOfAttorney.agent.city',             section: 'Fiduciaries', label: 'POA Agent City',               fieldPath: 'fiduciaries.powerOfAttorney.agent.city' },
  'fiduciaries.powerOfAttorney.agent.state':            { variable: 'fiduciaries.powerOfAttorney.agent.state',            section: 'Fiduciaries', label: 'POA Agent State',              fieldPath: 'fiduciaries.powerOfAttorney.agent.state' },
  'fiduciaries.powerOfAttorney.agent.zip':              { variable: 'fiduciaries.powerOfAttorney.agent.zip',              section: 'Fiduciaries', label: 'POA Agent ZIP',                fieldPath: 'fiduciaries.powerOfAttorney.agent.zip' },
  'fiduciaries.powerOfAttorney.agent.relationship':     { variable: 'fiduciaries.powerOfAttorney.agent.relationship',     section: 'Fiduciaries', label: 'POA Agent Relationship',       fieldPath: 'fiduciaries.powerOfAttorney.agent.relationship' },
  'fiduciaries.powerOfAttorney.alternateAgent':         { variable: 'fiduciaries.powerOfAttorney.alternateAgent',         section: 'Fiduciaries', label: 'POA Alternate Agent',          fieldPath: 'fiduciaries.powerOfAttorney.alternateAgent' },
  'fiduciaries.powerOfAttorney.alternateAgent.relationship': { variable: 'fiduciaries.powerOfAttorney.alternateAgent.relationship', section: 'Fiduciaries', label: 'POA Alternate Agent Relationship', fieldPath: 'fiduciaries.powerOfAttorney.alternateAgent.relationship' },
  'fiduciaries.powerOfAttorney.successorAgent':         { variable: 'fiduciaries.powerOfAttorney.successorAgent',         section: 'Fiduciaries', label: 'POA Successor Agent',          fieldPath: 'fiduciaries.powerOfAttorney.successorAgent' },
  'fiduciaries.powerOfAttorney.successorAgent.relationship': { variable: 'fiduciaries.powerOfAttorney.successorAgent.relationship', section: 'Fiduciaries', label: 'POA Successor Agent Relationship', fieldPath: 'fiduciaries.powerOfAttorney.successorAgent.relationship' },
  'fiduciaries.powerOfAttorney.effectiveDate':          { variable: 'fiduciaries.powerOfAttorney.effectiveDate',          section: 'Fiduciaries', label: 'POA Effective Date',           fieldPath: 'fiduciaries.powerOfAttorney.effectiveDate' },
  'fiduciaries.powerOfAttorney.giftingPower':           { variable: 'fiduciaries.powerOfAttorney.giftingPower',           section: 'Fiduciaries', label: 'POA Gifting Power',            fieldPath: 'fiduciaries.powerOfAttorney.giftingPower' },
  'fiduciaries.powerOfAttorney.selfDealingPower':       { variable: 'fiduciaries.powerOfAttorney.selfDealingPower',       section: 'Fiduciaries', label: 'POA Self-Dealing Power',       fieldPath: 'fiduciaries.powerOfAttorney.selfDealingPower' },
  'fiduciaries.powerOfAttorney.limitations':            { variable: 'fiduciaries.powerOfAttorney.limitations',            section: 'Fiduciaries', label: 'POA Limitations',              fieldPath: 'fiduciaries.powerOfAttorney.limitations' },
  'fiduciaries.executor.primary':                       { variable: 'fiduciaries.executor.primary',                       section: 'Fiduciaries', label: 'Primary Executor',             fieldPath: 'fiduciaries.executor.primary' },
  'fiduciaries.executor.alternate':                     { variable: 'fiduciaries.executor.alternate',                     section: 'Fiduciaries', label: 'Alternate Executor',           fieldPath: 'fiduciaries.executor.alternate' },
  'fiduciaries.trustee.primary':                        { variable: 'fiduciaries.trustee.primary',                        section: 'Fiduciaries', label: 'Primary Trustee',              fieldPath: 'fiduciaries.trustee.primary' },
  'fiduciaries.trustee.alternate':                      { variable: 'fiduciaries.trustee.alternate',                      section: 'Fiduciaries', label: 'Alternate Trustee',            fieldPath: 'fiduciaries.trustee.alternate' },
  'fiduciaries.guardian.primary':                       { variable: 'fiduciaries.guardian.primary',                       section: 'Fiduciaries', label: 'Primary Guardian (Fiduciary)', fieldPath: 'fiduciaries.guardian.primary' },
  'fiduciaries.guardian.alternate':                     { variable: 'fiduciaries.guardian.alternate',                     section: 'Fiduciaries', label: 'Alternate Guardian (Fiduciary)', fieldPath: 'fiduciaries.guardian.alternate' },
  'fiduciaries.healthcareProxy.primary':                { variable: 'fiduciaries.healthcareProxy.primary',                section: 'Fiduciaries', label: 'Primary Healthcare Proxy',     fieldPath: 'fiduciaries.healthcareProxy.primary' },
  'fiduciaries.healthcareProxy.alternate':              { variable: 'fiduciaries.healthcareProxy.alternate',              section: 'Fiduciaries', label: 'Alternate Healthcare Proxy',   fieldPath: 'fiduciaries.healthcareProxy.alternate' },

  // ------ Section: Assets ------
  'assets':                     { variable: 'assets',                     section: 'Assets',        label: 'Assets Overview',      fieldPath: 'assets' },
  'assets.realEstate':          { variable: 'assets.realEstate',          section: 'Assets',        label: 'Real Estate',          fieldPath: 'assets.realEstate' },
  'assets.bankAccounts':        { variable: 'assets.bankAccounts',        section: 'Assets',        label: 'Bank Accounts',        fieldPath: 'assets.bankAccounts' },
  'assets.investmentAccounts':  { variable: 'assets.investmentAccounts',  section: 'Assets',        label: 'Investment Accounts',  fieldPath: 'assets.investmentAccounts' },
  'assets.retirementAccounts':  { variable: 'assets.retirementAccounts',  section: 'Assets',        label: 'Retirement Accounts',  fieldPath: 'assets.retirementAccounts' },
  'assets.lifeInsurance':       { variable: 'assets.lifeInsurance',       section: 'Assets',        label: 'Life Insurance',       fieldPath: 'assets.lifeInsurance' },
  'assets.businessInterests':   { variable: 'assets.businessInterests',   section: 'Assets',        label: 'Business Interests',   fieldPath: 'assets.businessInterests' },
  'assets.personalProperty':    { variable: 'assets.personalProperty',    section: 'Assets',        label: 'Personal Property',    fieldPath: 'assets.personalProperty' },
  'liabilities':                { variable: 'liabilities',                section: 'Assets',        label: 'Liabilities',          fieldPath: 'liabilities' },

  // ------ Section: Distribution ------
  'distribution':               { variable: 'distribution',               section: 'Distribution',  label: 'Distribution Plan',    fieldPath: 'distribution' },
  'distributionPlan':           { variable: 'distributionPlan',           section: 'Distribution',  label: 'Distribution Plan Text', fieldPath: 'distributionPlan' },

  // ------ Section: Healthcare Preferences ------
  'healthcarePreferences':      { variable: 'healthcarePreferences',      section: 'Healthcare',    label: 'Healthcare Preferences', fieldPath: 'healthcarePreferences' },
  'burialPreference':           { variable: 'burialPreference',           section: 'Healthcare',    label: 'Burial Preference',    fieldPath: 'burialPreference' },
  'burialDetails':              { variable: 'burialDetails',              section: 'Healthcare',    label: 'Burial Details',       fieldPath: 'burialDetails' },

  // ------ Section: Trusts ------
  'trusts':                     { variable: 'trusts',                     section: 'Trusts',        label: 'Trust Information',    fieldPath: 'trusts' },

  // ------ Section: Special Considerations ------
  'specialConsiderations':      { variable: 'specialConsiderations',      section: 'Special Considerations', label: 'Special Considerations', fieldPath: 'specialConsiderations' },

  // ------ Section: Package Details ------
  'packageDetails':             { variable: 'packageDetails',             section: 'Package',       label: 'Package Details',      fieldPath: 'packageDetails' },

  // ------ Computed fields (auto-derived, not direct questionnaire input) ------
  'clientFullName':             { variable: 'clientFullName',             section: 'computed',      label: 'Client Full Name (auto)',        fieldPath: 'computed' },
  'spouseFullName':             { variable: 'spouseFullName',             section: 'computed',      label: 'Spouse Full Name (auto)',        fieldPath: 'computed' },
  'hasSpouse':                  { variable: 'hasSpouse',                  section: 'computed',      label: 'Has Spouse (auto)',              fieldPath: 'computed' },
  'hasMinorChildren':           { variable: 'hasMinorChildren',           section: 'computed',      label: 'Has Minor Children (auto)',      fieldPath: 'computed' },
  'hasSpecialNeedsChild':       { variable: 'hasSpecialNeedsChild',       section: 'computed',      label: 'Has Special Needs Child (auto)', fieldPath: 'computed' },
  'childCount':                 { variable: 'childCount',                 section: 'computed',      label: 'Number of Children (auto)',      fieldPath: 'computed' },
  'minorChildren':              { variable: 'minorChildren',              section: 'computed',      label: 'Minor Children List (auto)',     fieldPath: 'computed' },
  'adultChildren':              { variable: 'adultChildren',              section: 'computed',      label: 'Adult Children List (auto)',     fieldPath: 'computed' },
  'propertyCount':              { variable: 'propertyCount',              section: 'computed',      label: 'Property Count (auto)',          fieldPath: 'computed' },
  'propertiesForTrust':         { variable: 'propertiesForTrust',         section: 'computed',      label: 'Properties for Trust (auto)',    fieldPath: 'computed' },
  'estimatedTotalAssets':       { variable: 'estimatedTotalAssets',       section: 'computed',      label: 'Estimated Total Assets (auto)',  fieldPath: 'computed' },
  'primaryTrustName':           { variable: 'primaryTrustName',           section: 'computed',      label: 'Primary Trust Name (auto)',      fieldPath: 'computed' },
  'todayFormatted':             { variable: 'todayFormatted',             section: 'computed',      label: "Today's Date (auto)",            fieldPath: 'computed' },
  'todayISO':                   { variable: 'todayISO',                   section: 'computed',      label: "Today's Date ISO (auto)",        fieldPath: 'computed' },
  'packageType':                { variable: 'packageType',                section: 'computed',      label: 'Package Type (auto)',             fieldPath: 'computed' },
  'packageLabel':               { variable: 'packageLabel',               section: 'computed',      label: 'Package Label (auto)',            fieldPath: 'computed' },
  'isFemale':                   { variable: 'isFemale',                   section: 'computed',      label: 'Is Female (auto)',               fieldPath: 'computed' },
  // Relationship title computed fields
  'spouseTitle':                { variable: 'spouseTitle',                section: 'computed',      label: 'Spouse Title – husband/wife/partner (auto)', fieldPath: 'computed' },
  'clientTitle':                { variable: 'clientTitle',                section: 'computed',      label: 'Client Title – husband/wife/partner (auto)', fieldPath: 'computed' },
  'clientPronouns':             { variable: 'clientPronouns',             section: 'computed',      label: 'Client Pronouns (auto)',         fieldPath: 'computed' },
  'spousePronouns':             { variable: 'spousePronouns',             section: 'computed',      label: 'Spouse Pronouns (auto)',          fieldPath: 'computed' },
  'executorTitle':              { variable: 'executorTitle',              section: 'computed',      label: 'Executor Relationship Title (auto)', fieldPath: 'computed' },
  'alternateExecutorTitle':     { variable: 'alternateExecutorTitle',     section: 'computed',      label: 'Alternate Executor Relationship Title (auto)', fieldPath: 'computed' },
  'trusteeTitle':               { variable: 'trusteeTitle',               section: 'computed',      label: 'Trustee Relationship Title (auto)', fieldPath: 'computed' },
  'poaAgentTitle':              { variable: 'poaAgentTitle',              section: 'computed',      label: 'POA Agent Relationship Title (auto)', fieldPath: 'computed' },
  'healthcareRepTitle':         { variable: 'healthcareRepTitle',         section: 'computed',      label: 'Healthcare Rep Relationship Title (auto)', fieldPath: 'computed' },
  'guardianTitle':              { variable: 'guardianTitle',              section: 'computed',      label: 'Guardian Relationship Title (auto)', fieldPath: 'computed' },
  'childrenWithTitles':         { variable: 'childrenWithTitles',         section: 'computed',      label: 'Children with son/daughter titles (auto)', fieldPath: 'computed' },

  // ------ Firm data (from firm profile, not questionnaire) ------
  'firm':                       { variable: 'firm',                       section: 'Firm',          label: 'Firm Data',            fieldPath: 'firm' },
  'firmName':                   { variable: 'firmName',                   section: 'Firm',          label: 'Firm Name',            fieldPath: 'firm' },
  'firmAddress':                { variable: 'firmAddress',                section: 'Firm',          label: 'Firm Address',         fieldPath: 'firm' },
  'firmPhone':                  { variable: 'firmPhone',                  section: 'Firm',          label: 'Firm Phone',           fieldPath: 'firm' },
  'firmEmail':                  { variable: 'firmEmail',                  section: 'Firm',          label: 'Firm Email',           fieldPath: 'firm' },
  'firmWebsite':                { variable: 'firmWebsite',                section: 'Firm',          label: 'Firm Website',         fieldPath: 'firm' },
  'barNumber':                  { variable: 'barNumber',                  section: 'Firm',          label: 'Bar Number',           fieldPath: 'firm' },
  'notesSummary':               { variable: 'notesSummary',               section: 'Notes',         label: 'Notes Summary (auto)', fieldPath: 'notes' },
};
