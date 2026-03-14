/**
 * functions/src/template-engine.ts
 *
 * Handlebars-based template rendering engine for estate planning documents.
 *
 * Responsibilities:
 *  - Compile and render Handlebars templates with client context
 *  - Register custom helpers for legal document formatting
 *  - Fetch the appropriate template from Firestore (by docType + variant)
 *  - Extract template variables and map them to questionnaire fields
 *  - Validate client data against template requirements before rendering
 *  - Optional AI enhancement pass for hybrid mode
 */

import Handlebars from 'handlebars';
import * as admin from 'firebase-admin';
import { ClientContext } from './client-context-aggregator';
import { callAI, sanitizeObject } from './ai-client';
import { GeneratedDoc } from './generate-documents';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocumentTemplate {
  id: string;
  firmId: string;
  docType: string;
  name: string;
  description: string;
  variant: string;
  complexity: 1 | 2 | 3;
  version: number;
  content: string;
  isDefault: boolean;
  isActive: boolean;
  variables: string[];
  tags?: string[];
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  updatedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  createdBy: string;
  updatedBy: string;
}

export type GenerationMode = 'template' | 'ai' | 'hybrid';

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

export interface ValidationResult {
  valid: boolean;
  missing: Array<{ variable: string; label: string; section: string }>;
  available: Array<{ variable: string; label: string; value: unknown }>;
}

// ---------------------------------------------------------------------------
// Variable extraction — parse Handlebars templates to discover variables
// ---------------------------------------------------------------------------

/**
 * Known Handlebars helpers (built-in + custom).
 * These are NOT template variables and should be excluded from extraction.
 */
const KNOWN_HELPERS = new Set([
  // Built-in Handlebars
  'if', 'unless', 'each', 'with', 'lookup', 'log', 'else',
  // Special Handlebars keywords
  'this',
  // Custom helpers registered in registerHelpers()
  'formatDate', 'fullName', 'currency', 'upper', 'eq', 'gt', 'inc',
  'roman', 'ordinal', 'fillOrBlank', 'hasItems', 'join',
]);

/**
 * Extract all unique template variable paths from Handlebars template content.
 *
 * Handles:
 *  - Simple variables: `{{personalInfo.firstName}}`
 *  - Helper calls: `{{fullName fiduciaries.powerOfAttorney.agent}}`
 *  - Block helpers: `{{#if hasSpouse}}`, `{{#each children}}`
 *  - Nested sub-expressions: `{{#if (eq fiduciaries.powerOfAttorney.effectiveDate 'immediate')}}`
 *  - Ignores comments `{{!-- ... --}}` and `{{! ... }}`
 *  - Ignores string literals ('...' and "...")
 *  - Ignores closing tags `{{/if}}`, `{{/each}}`
 */
export function extractTemplateVariables(content: string): string[] {
  const variables = new Set<string>();

  // Strip comments first: {{!-- ... --}} and {{! ... }}
  const noComments = content
    .replace(/\{\{!--[\s\S]*?--\}\}/g, '')
    .replace(/\{\{![\s\S]*?\}\}/g, '');

  // Match all Handlebars expressions: {{ ... }}
  const expressionRegex = /\{\{(#|\/)?([^}]+)\}\}/g;
  let match: RegExpExecArray | null;

  while ((match = expressionRegex.exec(noComments)) !== null) {
    const prefix = match[1]; // '#' for block open, '/' for block close, undefined for simple
    const body = match[2].trim();

    // Skip closing tags
    if (prefix === '/') continue;

    // Recursively extract variables from the body (handles sub-expressions)
    extractFromExpression(body, variables);
  }

  return Array.from(variables).sort();
}

/**
 * Extract variable paths from a single expression body.
 * Handles: `fullName person`, `eq a 'literal'`, `(eq a b)`, nested.
 */
function extractFromExpression(expr: string, variables: Set<string>): void {
  // First, recursively handle sub-expressions: (helperName arg1 arg2)
  // Replace them and process the inner content
  let processedExpr = expr;
  const subExprRegex = /\(([^()]+)\)/g;
  let subMatch: RegExpExecArray | null;
  while ((subMatch = subExprRegex.exec(expr)) !== null) {
    extractFromExpression(subMatch[1].trim(), variables);
    processedExpr = processedExpr.replace(subMatch[0], '');
  }

  // Tokenize the remaining expression (split by whitespace, respecting quotes)
  const tokens = tokenize(processedExpr);
  if (tokens.length === 0) return;

  const first = tokens[0];

  // If the first token is a known helper, remaining tokens are arguments
  if (KNOWN_HELPERS.has(first)) {
    for (let i = 1; i < tokens.length; i++) {
      addIfVariable(tokens[i], variables);
    }
  } else {
    // First token is itself a variable (simple expression like {{personalInfo.firstName}})
    // or a helper not in KNOWN_HELPERS (treat first as variable too)
    for (const token of tokens) {
      addIfVariable(token, variables);
    }
  }
}

/**
 * Tokenize an expression body, splitting on whitespace but preserving quoted strings.
 */
function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  const regex = /(?:"[^"]*"|'[^']*'|\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(expr)) !== null) {
    tokens.push(m[0]);
  }
  return tokens;
}

/**
 * Add a token to the variables set if it looks like a variable path.
 * Excludes: string literals, numbers, booleans, @data variables, known helpers.
 */
function addIfVariable(token: string, variables: Set<string>): void {
  // Skip string literals
  if ((token.startsWith("'") && token.endsWith("'")) ||
      (token.startsWith('"') && token.endsWith('"'))) {
    return;
  }
  // Skip numbers and booleans
  if (/^-?\d+(\.\d+)?$/.test(token)) return;
  if (token === 'true' || token === 'false' || token === 'null' || token === 'undefined') return;
  // Skip @data variables (@index, @key, etc.)
  if (token.startsWith('@')) return;
  // Skip known helpers
  if (KNOWN_HELPERS.has(token)) return;
  // Skip hash arguments (key=value)
  if (token.includes('=')) return;
  // Skip empty
  if (!token.trim()) return;

  variables.add(token);
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

// ---------------------------------------------------------------------------
// Template data validation
// ---------------------------------------------------------------------------

/**
 * Validate that a client context has data for all the variables a template requires.
 *
 * @param variables - Array of variable paths extracted from a template
 * @param ctx       - The client context to validate against
 * @returns ValidationResult with missing and available fields
 */
export function validateTemplateData(
  variables: string[],
  ctx: ClientContext,
): ValidationResult {
  const templateData = buildTemplateData(ctx);
  const missing: ValidationResult['missing'] = [];
  const available: ValidationResult['available'] = [];

  for (const variable of variables) {
    const mapping = VARIABLE_TO_QUESTIONNAIRE_MAP[variable];
    const label = mapping?.label ?? variable;
    const section = mapping?.section ?? 'unknown';

    // Resolve the value using dot-path traversal
    const value = resolveDotPath(templateData, variable);

    if (value === undefined || value === null || value === '') {
      missing.push({ variable, label, section });
    } else {
      available.push({ variable, label, value });
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    available,
  };
}

/**
 * Resolve a dot-separated path against an object.
 * e.g. resolveDotPath(obj, 'fiduciaries.powerOfAttorney.agent') → obj.fiduciaries.powerOfAttorney.agent
 */
function resolveDotPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ---------------------------------------------------------------------------
// Register custom Handlebars helpers
// ---------------------------------------------------------------------------

function registerHelpers(): void {
  // Format a date string or Timestamp to "Month Day, Year"
  Handlebars.registerHelper('formatDate', (dateVal: unknown) => {
    if (!dateVal) return '_______________';
    let d: Date;
    if (dateVal && typeof dateVal === 'object' && 'toDate' in dateVal && typeof (dateVal as Record<string, unknown>).toDate === 'function') {
      d = (dateVal as { toDate: () => Date }).toDate(); // Firestore Timestamp
    } else if (typeof dateVal === 'string') {
      d = new Date(dateVal);
    } else {
      d = new Date(dateVal as string | number);
    }
    if (isNaN(d.getTime())) return String(dateVal);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  });

  // Full name from a person object { firstName, middleName, lastName, suffix }
  Handlebars.registerHelper('fullName', (person: Record<string, unknown> | null | undefined) => {
    if (!person) return '_______________';
    return [person.firstName, person.middleName, person.lastName, person.suffix]
      .filter(Boolean)
      .join(' ');
  });

  // Currency formatting
  Handlebars.registerHelper('currency', (amount: unknown) => {
    if (amount == null || isNaN(Number(amount))) return '$0.00';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(amount));
  });

  // Uppercase
  Handlebars.registerHelper('upper', (str: unknown) => {
    return typeof str === 'string' ? str.toUpperCase() : '';
  });

  // Equality check
  Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);

  // Greater than
  Handlebars.registerHelper('gt', (a: unknown, b: unknown) => Number(a) > Number(b));

  // Increment
  Handlebars.registerHelper('inc', (val: unknown) => Number(val) + 1);

  // Roman numeral helper for article numbering
  Handlebars.registerHelper('roman', (num: unknown) => {
    const n = Number(num);
    if (isNaN(n) || n <= 0) return String(num);
    const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
    const syms = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
    let result = '';
    let remaining = n;
    for (let i = 0; i < vals.length; i++) {
      while (remaining >= vals[i]) {
        result += syms[i];
        remaining -= vals[i];
      }
    }
    return result;
  });

  // Ordinal number helper (1st, 2nd, 3rd, etc.)
  Handlebars.registerHelper('ordinal', (num: unknown) => {
    const n = Number(num);
    if (isNaN(n)) return String(num);
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  });

  // Fill-in-blank helper (underscore line if value is empty)
  Handlebars.registerHelper('fillOrBlank', (val: unknown) => {
    if (!val || (typeof val === 'string' && (val as string).trim() === '')) {
      return new Handlebars.SafeString('_______________');
    }
    return val;
  });

  // Conditional: has items in array
  Handlebars.registerHelper('hasItems', function (this: unknown, arr: unknown, options: Handlebars.HelperOptions) {
    if (Array.isArray(arr) && arr.length > 0) {
      return options.fn(this);
    }
    return options.inverse(this);
  });

  // Join array with separator
  Handlebars.registerHelper('join', (arr: unknown[], sep: string) => {
    if (!Array.isArray(arr)) return '';
    return arr.join(typeof sep === 'string' ? sep : ', ');
  });
}

// Initialize helpers once
let helpersRegistered = false;
function ensureHelpers() {
  if (!helpersRegistered) {
    registerHelpers();
    helpersRegistered = true;
  }
}

// ---------------------------------------------------------------------------
// Template fetching
// ---------------------------------------------------------------------------

/**
 * Fetch a template from Firestore by docType, optionally by specific templateId or variant.
 */
export async function getTemplate(
  firmId: string,
  docType: string,
  templateId?: string,
  variant?: string,
): Promise<DocumentTemplate | null> {
  const db = admin.firestore();
  const col = db.collection('firms').doc(firmId).collection('documentTemplates');

  let rawData: FirebaseFirestore.DocumentData | undefined;

  // If specific template ID provided, fetch directly
  if (templateId) {
    const snap = await col.doc(templateId).get();
    if (!snap.exists) return null;
    rawData = snap.data();
  } else {
    // Otherwise query by docType + variant or default
    let query = col
      .where('docType', '==', docType)
      .where('isActive', '==', true);

    if (variant) {
      query = query.where('variant', '==', variant);
    } else {
      query = query.where('isDefault', '==', true);
    }

    const snap = await query.limit(1).get();
    if (snap.empty) return null;
    rawData = snap.docs[0].data();
  }

  // Runtime validation: ensure required fields exist
  if (!rawData || typeof rawData.content !== 'string' || !rawData.content.trim()) {
    console.error(
      `[getTemplate] Template for docType="${docType}" is missing required "content" field. ` +
      `firmId=${firmId}, templateId=${templateId ?? '(query)'}`,
    );
    return null;
  }
  if (!rawData.docType || typeof rawData.docType !== 'string') {
    console.error(
      `[getTemplate] Template is missing required "docType" field. ` +
      `firmId=${firmId}, templateId=${templateId ?? '(query)'}`,
    );
    return null;
  }

  return rawData as DocumentTemplate;
}

/**
 * List all available template variants for a docType.
 */
export async function listTemplateVariants(
  firmId: string,
  docType: string,
): Promise<Array<{ id: string; name: string; variant: string; complexity: number; isDefault: boolean }>> {
  const db = admin.firestore();
  const snap = await db
    .collection('firms').doc(firmId).collection('documentTemplates')
    .where('docType', '==', docType)
    .where('isActive', '==', true)
    .orderBy('complexity')
    .get();

  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      name: data.name,
      variant: data.variant,
      complexity: data.complexity,
      isDefault: data.isDefault ?? false,
    };
  });
}

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------

/**
 * Build the flat template data object from a ClientContext.
 * Extracted so it can be reused by both renderTemplate and validateTemplateData.
 */
export function buildTemplateData(ctx: ClientContext): Record<string, unknown> {
  return {
    // Client data (full)
    client: ctx.client,
    personalInfo: ctx.client.personalInfo ?? {},
    spouseInfo: ctx.client.spouseInfo,
    children: ctx.client.children ?? [],
    assets: ctx.client.assets ?? {},
    liabilities: ctx.client.liabilities ?? {},
    fiduciaries: ctx.client.fiduciaries ?? {},
    distribution: ctx.client.distribution ?? {},
    healthcarePreferences: ctx.client.healthcarePreferences ?? {},
    trusts: ctx.client.trusts ?? [],
    specialConsiderations: ctx.client.specialConsiderations ?? {},
    packageDetails: ctx.client.packageDetails ?? {},

    // Questionnaire-only fields (not always on the client doc directly)
    hasChildren: ctx.client.hasChildren ?? (ctx.client.children?.length > 0),
    hasOtherDependents: ctx.client.hasOtherDependents ?? false,
    otherDependents: ctx.client.otherDependents ?? [],
    guardianPrimary: ctx.client.guardianPrimary ?? ctx.client.fiduciaries?.guardian?.primary ?? {},
    guardianAlternate: ctx.client.guardianAlternate ?? ctx.client.fiduciaries?.guardian?.alternate ?? {},
    distributionPlan: ctx.client.distributionPlan ?? '',
    burialPreference: ctx.client.burialPreference ?? '',
    burialDetails: ctx.client.burialDetails ?? '',
    isFemale: ctx.client.isFemale,

    // Computed
    ...ctx.computed,

    // Firm data
    firm: ctx.firm,
    firmName: ctx.firm.firmName ?? '',
    firmAddress: ctx.firm.firmAddress ?? '',
    firmPhone: ctx.firm.firmPhone ?? '',
    firmEmail: ctx.firm.firmEmail ?? '',
    firmWebsite: ctx.firm.firmWebsite ?? '',
    barNumber: ctx.firm.barNumber ?? '',

    // Notes summary (for AI context, not usually in templates)
    notesSummary: ctx.notes
      .slice(0, 5)
      .map((n) => `[${n.noteType}] ${n.title ?? ''}: ${(n.content ?? '').slice(0, 200)}`)
      .join('\n'),
  };
}

/**
 * Render a Handlebars template with full client context.
 */
export function renderTemplate(
  templateContent: string,
  ctx: ClientContext,
): string {
  ensureHelpers();

  const compiled = Handlebars.compile(templateContent);
  const templateData = buildTemplateData(ctx);

  return compiled(templateData);
}

// ---------------------------------------------------------------------------
// Full generation pipeline
// ---------------------------------------------------------------------------

/**
 * Generate a document using the template engine pipeline.
 *
 * mode:
 *  - 'template': render template only (fast, deterministic)
 *  - 'ai': use existing AI generators (unchanged)
 *  - 'hybrid': render template, then pass to AI for enhancement/polishing
 */
export async function generateFromTemplate(
  ctx: ClientContext,
  docType: string,
  mode: GenerationMode,
  templateId?: string,
  variant?: string,
  aiGeneratorFn?: () => Promise<GeneratedDoc>,
): Promise<GeneratedDoc> {
  const firmId = ctx.firm.id ?? ctx.client.firmId;

  if (mode === 'ai') {
    // Delegate entirely to the existing AI generator
    if (!aiGeneratorFn) {
      throw new Error(`AI generator function not provided for docType=${docType}`);
    }
    return aiGeneratorFn();
  }

  // Fetch template
  const template = await getTemplate(firmId, docType, templateId, variant);
  if (!template) {
    if (mode === 'hybrid' && aiGeneratorFn) {
      console.warn(`[template-engine] No template found for ${docType}, falling back to AI.`);
      return aiGeneratorFn();
    }
    throw new Error(
      `No active template found for docType="${docType}"${variant ? ` variant="${variant}"` : ''}. ` +
      `Upload a template via the Knowledge Base admin, or switch to AI generation mode.`,
    );
  }

  // Render template
  const renderedHtml = renderTemplate(template.content, ctx);
  const title = `${template.name} — ${ctx.computed.clientFullName}`;

  if (mode === 'template') {
    return {
      docType,
      title,
      content: renderedHtml,
      status: 'draft',
    };
  }

  // Hybrid: template + AI enhancement
  if (mode === 'hybrid') {
    const enhanced = await enhanceWithAI(renderedHtml, ctx, docType);
    return {
      docType,
      title,
      content: enhanced,
      status: 'draft',
    };
  }

  // Should not reach here
  return { docType, title, content: renderedHtml, status: 'draft' };
}

// ---------------------------------------------------------------------------
// AI enhancement for hybrid mode
// ---------------------------------------------------------------------------

async function enhanceWithAI(
  templateHtml: string,
  ctx: ClientContext,
  docType: string,
): Promise<string> {
  const safeFirm = sanitizeObject(ctx.firm);

  // Build knowledge base context (full content — no truncation)
  const kbContext = ctx.knowledgeResources
    .map((r) => `[${r.category}] ${r.title}${r.citation ? ` (${r.citation})` : ''}:\n${r.content}`)
    .join('\n\n');

  // Notes context (full AI summaries)
  const notesContext = ctx.notes
    .slice(0, 5)
    .map((n) => `[${n.noteType}] ${n.title ?? 'Note'}: ${n.aiSummary ?? n.content ?? ''}`)
    .join('\n');

  // Prompt ordered for cache-friendliness: static system instructions first,
  // then KB context (stable), then client-specific data (varies)
  const systemPrompt = `You are an expert New Jersey estate planning attorney reviewing and enhancing a legal document.

You are given a template-rendered document that is structurally correct but may benefit from:
1. Client-specific nuances based on their notes and existing documents
2. Additional statutory references from the knowledge base
3. Smoother legal prose and professional formatting
4. Filling any remaining blanks with appropriate language

RULES:
- Do NOT restructure the document — the template structure is intentional.
- Do NOT remove any existing clauses or statutory citations.
- DO add relevant statutory citations from the knowledge base context provided.
- DO incorporate any relevant notes or special considerations.
- Cite the specific statute (N.J.S.A.) for every legal claim or provision. Do NOT fabricate citations.
- Return ONLY the enhanced HTML content (no JSON wrapper, no markdown fences).
- Preserve all HTML tags and structure.

KNOWLEDGE BASE:
${kbContext || 'No specific resources available.'}

CLIENT NOTES:
${notesContext || 'No recent notes.'}`;

  const userPrompt = `Enhance this ${docType} document:

TEMPLATE-RENDERED DOCUMENT:
${templateHtml.slice(0, 12000)}

Return the enhanced HTML document.`;

  try {
    const enhanced = await callAI(systemPrompt, userPrompt, safeFirm, {
      model: safeFirm?.documentDraftingModel || 'gpt-4.1',
      temperature: 0.15,
      maxTokens: 12000,
    });

    // If AI returned something reasonable, use it; otherwise fall back to template
    if (enhanced && enhanced.trim().length > 100) {
      return enhanced;
    }
    return templateHtml;
  } catch (err) {
    console.error('[template-engine] AI enhancement failed, returning template output:', err);
    return templateHtml;
  }
}
