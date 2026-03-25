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


/**
 * Strip markdown code fences that AI models frequently wrap HTML in.
 * Handles ```html, ```HTML, and bare ``` fences.
 */
function stripHtmlFences(text: string): string {
  let cleaned = text.trim();
  // Strip leading ```html or ```
  cleaned = cleaned.replace(/^```(?:html)?\s*\n?/i, '');
  // Strip trailing ```
  cleaned = cleaned.replace(/\n?\s*```\s*$/i, '');
  return cleaned.trim();
}
import { ClientContext } from './client-context-aggregator';
import { callAI, sanitizeObject } from './ai-client';
import { searchTemplatesByDocType } from './kb-vector-search';
import { compareHtmlStructure } from './template-fidelity-validator';
import { GeneratedDoc } from './generate-documents';
import { buildStandardTitle } from './unified-generator';
import { computePromptHash } from './unified-generator';
import { VARIABLE_TO_QUESTIONNAIRE_MAP } from './template-variables';

// Re-export so downstream consumers (tests, etc.) don't break
export type { VariableMapping } from './template-variables';
export { VARIABLE_TO_QUESTIONNAIRE_MAP } from './template-variables';

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
  softwareSource?: string;
  folder?: string;
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  updatedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  createdBy: string;
  updatedBy: string;
}

export type GenerationMode = 'template' | 'ai' | 'hybrid';

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
  // Also handles flat name strings (common in fiduciary entries: { name: "John Doe" })
  Handlebars.registerHelper('fullName', (person: Record<string, unknown> | string | null | undefined) => {
    if (!person) return '_______________';
    // If it's already a string (flat name), return it directly
    if (typeof person === 'string') return person;
    // If the object has firstName, build the full name from parts
    if (person.firstName) {
      return [person.firstName, person.middleName, person.lastName, person.suffix]
        .filter(Boolean)
        .join(' ');
    }
    // Fallback: if object has a flat .name property, use that
    if (person.name && typeof person.name === 'string') return person.name;
    return '_______________';
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
  // Also extracts .name from person objects so {{fillOrBlank fiduciaries.executor.primary}} works
  Handlebars.registerHelper('fillOrBlank', (val: unknown) => {
    if (!val || (typeof val === 'string' && (val as string).trim() === '')) {
      return new Handlebars.SafeString('_______________');
    }
    // If value is an object, try to extract a name
    if (typeof val === 'object' && val !== null) {
      const obj = val as Record<string, unknown>;
      if (obj.firstName) {
        return [obj.firstName, obj.middleName, obj.lastName, obj.suffix].filter(Boolean).join(' ');
      }
      if (obj.name && typeof obj.name === 'string') return obj.name;
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
 * Fetch a template from Firestore by docType, optionally by specific templateId, variant,
 * or softwareSource. When softwareSource is provided but no match is found, falls back
 * to a query without the software filter (auto-fallback).
 */
export async function getTemplate(
  firmId: string,
  docType: string,
  templateId?: string,
  variant?: string,
  softwareSource?: string,
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
    // Build a base query for docType + isActive
    const buildBaseQuery = () =>
      col.where('docType', '==', docType).where('isActive', '==', true);

    if (softwareSource) {
      // When a specific software source is requested, find ANY active template
      // for that source (no isDefault requirement — bulk-uploaded templates are
      // often not marked as default).
      const sourceSnap = await buildBaseQuery()
        .where('softwareSource', '==', softwareSource)
        .limit(1)
        .get();

      if (!sourceSnap.empty) {
        rawData = sourceSnap.docs[0].data();
      } else {
        // No template for this software source — fall back to isDefault=true
        // without the software filter.
        console.info(
          `[getTemplate] No template found for docType="${docType}" softwareSource="${softwareSource}", falling back.`,
        );
        const fallbackSnap = await buildBaseQuery()
          .where('isDefault', '==', true)
          .limit(1)
          .get();
        if (!fallbackSnap.empty) {
          rawData = fallbackSnap.docs[0].data();
        }
      }
    } else if (variant) {
      // Specific variant requested
      const snap = await buildBaseQuery()
        .where('variant', '==', variant)
        .limit(1)
        .get();
      if (!snap.empty) rawData = snap.docs[0].data();
    } else {
      // No software source or variant — use the default template
      const snap = await buildBaseQuery()
        .where('isDefault', '==', true)
        .limit(1)
        .get();
      if (!snap.empty) rawData = snap.docs[0].data();
    }
  }

  // ── Vector search fallback ────────────────────────────────────────────────
  // If exact-match queries found nothing, try semantic vector search against
  // the documentTemplates collection. This catches cases where templates exist
  // but don't have the right softwareSource or aren't marked as default.
  if (!rawData && !templateId) {
    const vectorMatch = await searchTemplatesByDocType(firmId, docType);
    if (vectorMatch) {
      console.info(
        `[getTemplate] Vector search fallback found template: "${vectorMatch.name}" ` +
        `(id=${vectorMatch.id}, similarity=${vectorMatch.similarity.toFixed(3)}) for docType="${docType}"`,
      );
      const vectorSnap = await col.doc(vectorMatch.id).get();
      if (vectorSnap.exists) {
        rawData = vectorSnap.data();
      }
    }
  }

  // Runtime validation: ensure required fields exist.
  // Support both 'content' (canonical) and 'editorContent' (editor-saved) field names.
  if (rawData && !rawData.content?.trim() && rawData.editorContent?.trim()) {
    rawData = { ...rawData, content: rawData.editorContent };
  }
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
  softwareSource?: string,
  formattingPreset?: string,
): Promise<GeneratedDoc> {
  const firmId = ctx.firm.id ?? ctx.client.firmId;

  if (mode === 'ai') {
    // Delegate entirely to the existing AI generator
    if (!aiGeneratorFn) {
      throw new Error(`AI generator function not provided for docType=${docType}`);
    }
    return aiGeneratorFn();
  }

  // Fetch template (with optional software source filtering + auto-fallback)
  const template = await getTemplate(firmId, docType, templateId, variant, softwareSource);
  if (!template) {
    if (aiGeneratorFn) {
      console.warn(`[template-engine] No template found for ${docType} (mode=${mode}), falling back to AI generation.`);
      return aiGeneratorFn();
    }
    throw new Error(
      `No active template found for docType="${docType}"${variant ? ` variant="${variant}"` : ''}. ` +
      `Upload a template via the Knowledge Base admin, or switch to AI generation mode.`,
    );
  }

  // Compute prompt version hash from the template content
  const promptVersion = computePromptHash(template.content);

  // ── Smart routing ──────────────────────────────────────────────────────────
  // Uploaded DOCX templates (softwareSource set, no Handlebars variables)
  // should skip Handlebars entirely — the template is a complete document for
  // a sample client with no {{variables}} to substitute. Route directly to
  // template-referenced AI which uses the template as a formatting guide.
  const isRawUploadedTemplate =
    !!template.softwareSource &&
    (!template.variables || template.variables.length === 0);

  if (isRawUploadedTemplate) {
    const title = buildStandardTitle(docType, ctx.computed.clientFullName);

    if (mode === 'hybrid') {
      // Hybrid mode: focused text substitution only — preserves HTML structure
      console.info(
        `[template-engine] Smart route: raw uploaded template for ${docType} ` +
        `(source=${template.softwareSource}) → focused substitution (hybrid)`,
      );
      const content = await substituteTemplateValues(template.content, ctx, docType, formattingPreset);
      return { docType, title, content, status: 'draft', promptVersion, templateBaseline: template.content };
    }

    // Template mode: serve the raw uploaded HTML directly (fast — no AI call).
    // The template is a complete document from a sample client.
    console.info(
      `[template-engine] Smart route: raw uploaded template for ${docType} ` +
      `(source=${template.softwareSource}) → serving raw HTML (template mode)`,
    );
    return { docType, title, content: template.content, status: 'draft', promptVersion };
  }

  // ── Handlebars rendering (for templates WITH variables) ─────────────────
  // Render template — guard against invalid Handlebars syntax in uploaded templates
  let renderedHtml: string;
  try {
    renderedHtml = renderTemplate(template.content, ctx);
  } catch (renderErr) {
    const errMsg = renderErr instanceof Error ? renderErr.message : String(renderErr);
    console.warn(
      `[template-engine] Handlebars render failed for docType="${docType}" ` +
      `(template="${template.name}"): ${errMsg.slice(0, 200)}`,
    );
    if (mode === 'hybrid') {
      // Template has invalid HBS syntax — use focused text substitution
      // to preserve the template's formatting while swapping client data
      console.info(`[template-engine] Using focused substitution for ${docType} (HBS failed)`);
      const substituted = await substituteTemplateValues(
        template.content,
        ctx,
        docType,
        formattingPreset,
      );
      return {
        docType,
        title: buildStandardTitle(docType, ctx.computed.clientFullName),
        content: substituted,
        status: 'draft',
        promptVersion,
        templateBaseline: template.content,
      };
    }
    // In template mode, serve the raw unrendered HTML so the user gets something
    renderedHtml = template.content;
  }

  // ── Post-render: flag any unresolved {{variables}} ────────────────────────
  // Handlebars silently outputs '' for missing variables. But if double-braces
  // leak through (e.g. from triple-stash {{{var}}} or partial syntax), flag them
  // so the attorney sees [MISSING: ...] instead of a silent blank.
  const unresolvedPattern = /\{\{([^}]+)\}\}/g;
  const unresolvedVars: string[] = [];
  let unresolvedMatch: RegExpExecArray | null;
  while ((unresolvedMatch = unresolvedPattern.exec(renderedHtml)) !== null) {
    unresolvedVars.push(unresolvedMatch[1].trim());
  }
  if (unresolvedVars.length > 0) {
    console.warn(
      `[template-engine] ${unresolvedVars.length} unresolved variables in ${docType}: ` +
      unresolvedVars.slice(0, 10).join(', '),
    );
    renderedHtml = renderedHtml.replace(unresolvedPattern, (_match, varName: string) =>
      `<span style="background:#fff3cd;color:#856404;padding:0 4px;border-radius:2px;" title="Unresolved template variable">[MISSING: ${varName.trim()}]</span>`,
    );
  }
  const title = buildStandardTitle(docType, ctx.computed.clientFullName);

  if (mode === 'template') {
    return {
      docType,
      title,
      content: renderedHtml,
      status: 'draft',
      promptVersion,
    };
  }

  // Hybrid: template + AI enhancement
  if (mode === 'hybrid') {
    // Skip AI enhancement if template rendered perfectly (no missing vars).
    // When the template filled every field cleanly, enhancement adds ~6,000
    // tokens of cost (3K input + 3K output) with marginal value.
    if (unresolvedVars.length === 0) {
      console.info(
        `[template-engine] Skipping AI enhancement for ${docType} — ` +
        `template rendered with zero unresolved variables (saving ~6,000 tokens)`,
      );
      return {
        docType,
        title,
        content: renderedHtml,
        status: 'draft',
        promptVersion,
      };
    }
    const enhanced = await enhanceWithAI(renderedHtml, ctx, docType);
    return {
      docType,
      title,
      content: enhanced,
      status: 'draft',
      promptVersion,
      templateBaseline: renderedHtml,
    };
  }

  return { docType, title, content: renderedHtml, status: 'draft', promptVersion };
}

// ---------------------------------------------------------------------------
// Focused text substitution for raw templates (preserves HTML structure)
// ---------------------------------------------------------------------------

/**
 * Substitute client-specific text values in a raw template WITHOUT altering
 * the HTML structure. Unlike the old `generateFromTemplateReference()` which
 * asked AI to regenerate the entire document (losing formatting), this function
 * tells the AI to change ONLY text content while preserving every HTML tag,
 * attribute, CSS class, and structural element exactly as-is.
 *
 * If the substitution corrupts the structure (fidelity < 85%), falls back to
 * the raw template with [NEEDS EDITING] markers.
 */
async function substituteTemplateValues(
  rawTemplateHtml: string,
  ctx: ClientContext,
  docType: string,
  _formattingPreset?: string,
): Promise<string> {
  const safeFirm = sanitizeObject(ctx.firm);
  const templateData = buildTemplateData(ctx);

  // Extract and preserve <style> blocks — AI should not touch these
  const styleRegex = /<style[^>]*>[\s\S]*?<\/style>/gi;
  const styleBlocks = rawTemplateHtml.match(styleRegex) ?? [];
  const preservedStyles = styleBlocks.join('\n');

  // Strip styles from the template before sending to AI (reduces tokens)
  const templateWithoutStyles = rawTemplateHtml.replace(styleRegex, '');

  // Build the substitution map: original text → replacement text
  const pi = templateData.personalInfo as Record<string, unknown> ?? {};
  const spouse = templateData.spouseInfo as Record<string, unknown>;
  const children = templateData.children as Array<Record<string, unknown>> ?? [];
  const fiduciaries = templateData.fiduciaries as Record<string, unknown> ?? {};
  const distribution = templateData.distribution as Record<string, unknown> ?? {};
  const healthPrefs = templateData.healthcarePreferences as Record<string, unknown> ?? {};

  const clientFullName = ctx.computed.clientFullName;
  const isFemale = ctx.client.isFemale;

  const clientDataBlock = `
NEW CLIENT DATA (replace ALL sample/template client data with these values):
  Full Name: ${clientFullName}
  Gender: ${isFemale ? 'Female' : 'Male'} (use ${isFemale ? 'she/her/hers' : 'he/his/him'} pronouns)
  Date of Birth: ${pi.dob ?? pi.dateOfBirth ?? '_______________'}
  Address: ${pi.address ?? '_______________'}, ${pi.city ?? '_______________'}, ${pi.state ?? 'NJ'} ${pi.zip ?? '_______________'}
  County: ${pi.county ?? '_______________'}
  Marital Status: ${pi.maritalStatus ?? '_______________'}
  ${spouse ? `Spouse: ${(spouse as Record<string, unknown>).firstName ?? ''} ${(spouse as Record<string, unknown>).middleName ?? ''} ${(spouse as Record<string, unknown>).lastName ?? ''}`.trim() : 'Spouse: N/A'}

CHILDREN (${children.length}):
${children.length === 0 ? '  None.' : children.map((c) =>
    `  • ${c.name ?? 'Unknown'}, born ${c.dob ?? 'unknown'}, ${c.isMinor ? 'minor' : 'adult'}${c.specialNeeds ? ' [Special Needs]' : ''}`
  ).join('\n')}

FIDUCIARIES:
${JSON.stringify(fiduciaries, null, 2).slice(0, 2000)}

DISTRIBUTION PLAN:
${JSON.stringify(distribution, null, 2).slice(0, 1500)}

HEALTHCARE PREFERENCES:
${JSON.stringify(healthPrefs, null, 2).slice(0, 800)}

FIRM: ${safeFirm.firmName ?? ''}
  Phone: ${safeFirm.firmPhone ?? ''}
  Email: ${safeFirm.firmEmail ?? ''}
`.trim();

  const systemPrompt = `You are an expert editor performing TEXT-ONLY substitutions on a legal document.

CRITICAL RULES — FOLLOW EXACTLY:
1. You will receive an HTML document with a sample client's data.
2. Replace ONLY the sample client's names, addresses, dates, fiduciary names, and personal details with the new client's data provided below.
3. Adjust gender-specific language (he/she, his/her, husband/wife, etc.) to match the new client.
4. DO NOT change, add, remove, or reorder ANY HTML tags (<p>, <div>, <strong>, <u>, etc.).
5. DO NOT change ANY CSS classes, inline styles, or tag attributes.
6. DO NOT add or remove any sections, articles, or paragraphs.
7. DO NOT add new legal provisions, headings, or content not in the original.
8. DO NOT wrap output in markdown code fences.
9. Preserve ALL whitespace patterns, line breaks within text, and blank paragraphs.
10. If a piece of data is not available, use "_______________" as a placeholder blank line.
11. Return the COMPLETE HTML document with ONLY the text values changed.
12. The output MUST have the exact same number and type of HTML tags as the input.

Think of yourself as a find-and-replace tool — you change text content only, never structure.`;

  const userPrompt = `Substitute the sample client data in this ${docType} document with the new client's data.

${clientDataBlock}

HTML DOCUMENT (change ONLY the text content, preserve ALL HTML tags exactly):
${templateWithoutStyles}

Return the complete HTML with substitutions applied. Do NOT include <style> blocks.`;

  if (rawTemplateHtml.length > 50000) {
    console.warn(
      `[template-engine] Large template for ${docType}: ${rawTemplateHtml.length} chars (~${Math.round(rawTemplateHtml.length / 4)} tokens). ` +
      `Output quality may degrade for extremely long templates.`,
    );
  }

  try {
    let result = await callAI(systemPrompt, userPrompt, safeFirm, {
      model: safeFirm?.documentDraftingModel || 'gpt-5.4',
      temperature: 0.05, // Very low temp for faithful substitution
      maxTokens: 32768,
    });

    if (result) {
      result = stripHtmlFences(result);
    }

    if (!result || result.trim().length < 100) {
      console.warn(`[template-engine] Substitution output too short for ${docType}, using raw template`);
      return rawTemplateHtml;
    }

    // ── Structural fidelity validation ─────────────────────────────
    // Verify the AI didn't alter the HTML structure during substitution
    const fidelity = compareHtmlStructure(templateWithoutStyles, result);
    console.info(
      `[template-engine] Substitution fidelity for ${docType}: ${(fidelity.score * 100).toFixed(1)}% ` +
      `(tags: ${fidelity.originalTagCount} → ${fidelity.modifiedTagCount})`,
    );

    if (!fidelity.passes) {
      console.warn(
        `[template-engine] Substitution corrupted structure for ${docType} ` +
        `(score=${(fidelity.score * 100).toFixed(1)}%). ` +
        `Falling back to raw template with editing markers.`,
      );
      // Return raw template with a visible editing notice
      const notice = '<div style="background:#fff3cd;color:#856404;padding:12px;margin:0 0 16px 0;border:1px solid #ffc107;border-radius:4px;font-weight:bold;">⚠️ This document contains sample client data. Please review and edit all names, addresses, and personal details for the actual client.</div>';
      return preservedStyles + '\n' + notice + '\n' + templateWithoutStyles;
    }

    // Restore preserved styles
    if (preservedStyles) {
      const hasStyles = /<style[^>]*>[\s\S]*?<\/style>/gi.test(result);
      if (!hasStyles) {
        result = preservedStyles + '\n' + result;
      }
    }

    return result;
  } catch (err) {
    console.error('[template-engine] Focused substitution failed:', err);
    // Fallback to raw template
    return rawTemplateHtml;
  }
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

ABSOLUTE RULES — VIOLATION OF THESE WILL PRODUCE REJECTED OUTPUT:
- NEVER restructure, reorder, or remove sections — the template structure is intentional and legally reviewed.
- NEVER alter client names, addresses, dates, or fiduciary designations from the template.
- NEVER remove existing clauses, signature blocks, witness attestation blocks, self-proving affidavits, or notary acknowledgments.
- NEVER insert placeholder text ([INSERT], [TBD], [TODO], blanks). Every field must use actual client data.
- NEVER fabricate statutory citations. Only cite N.J.S.A. references you find in the KNOWLEDGE BASE below.
- NEVER add new substantive legal provisions not present in the template.

PERMITTED ENHANCEMENTS:
- Add relevant N.J.S.A. citations from the knowledge base to strengthen existing clauses.
- Incorporate relevant client notes or special considerations into existing provision language.
- Smooth legal prose for clarity and professionalism within existing sections.
- Fill remaining template blanks with proper client data (names, dates, addresses).
- Add transitional language between existing sections for readability.

OUTPUT FORMAT:
- Return ONLY the enhanced HTML content (no JSON wrapper, no markdown fences, no preamble).
- Preserve ALL HTML tags, CSS classes, inline styles, and document structure exactly.
- The output must be a COMPLETE document — do not truncate or omit closing tags.

KNOWLEDGE BASE:
${kbContext || 'No specific resources available.'}

CLIENT NOTES:
${notesContext || 'No recent notes.'}`;

  const userPrompt = `Enhance this ${docType} document. Follow all ABSOLUTE RULES above — structure, names, and signature blocks must remain exactly as they appear:

TEMPLATE-RENDERED DOCUMENT:
${templateHtml}

Return the enhanced HTML document.`;

  // Log a warning for very large rendered templates
  if (templateHtml.length > 50000) {
    console.warn(
      `[template-engine] Large rendered document for ${docType}: ${templateHtml.length} chars (~${Math.round(templateHtml.length / 4)} tokens). ` +
      `Output quality may degrade for extremely long documents.`,
    );
  }

  try {
    let enhanced = await callAI(systemPrompt, userPrompt, safeFirm, {
      model: safeFirm?.documentDraftingModel || 'gpt-5.4',
      temperature: 0.15,
      maxTokens: 32768,
    });

    // Strip markdown fences — AI often wraps HTML in ```html ... ```
    if (enhanced) {
      enhanced = stripHtmlFences(enhanced);
    }

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
