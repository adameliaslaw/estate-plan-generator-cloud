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
import { getFormattingPreset } from './config/formatting-presets';

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
  /** Which Firestore collection the template was resolved from. Populated by
   *  getTemplate() so downstream callers (provenance, audit) don't have to
   *  re-derive the source. */
  _sourceCollection?: 'documentTemplates' | 'knowledgeBase' | 'legacyTemplates';
}

export type GenerationMode = 'template' | 'ai' | 'hybrid';

type TemplateCandidate = {
  id: string;
  data: FirebaseFirestore.DocumentData;
  source: 'documentTemplates' | 'knowledgeBase' | 'legacyTemplates';
};

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
  // Use the un-marked template data — markMissingFiduciaries() fills primary
  // slots with [MISSING: ...] placeholders for the rendering path, but for
  // validation we want to report the raw missing fields, not the filled-in
  // placeholders that would otherwise pass the truthiness check below.
  const templateData = buildTemplateData(ctx, { markMissing: false });
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
// Template formatting preservation
// ---------------------------------------------------------------------------

/**
 * Inline CSS equivalents for imported Word paragraph classes.
 *
 * Mammoth maps InteractiveLegal / drafting-software paragraph styles such as
 * TR_Title and TR_Body1 into HTML classes like tr-title and tr-body1. Some app
 * views and exported HTML fragments do not carry a separate stylesheet, so we
 * also write these styles inline before generation/saving. Existing inline
 * styles are appended after these defaults so template-specific styling wins.
 */
export const TEMPLATE_CLASS_INLINE_STYLES: Record<string, string> = {
  'tr-title': "text-align:center;text-decoration:underline;text-transform:uppercase;font-size:14pt;font-weight:bold;margin:0 0 18pt;page-break-after:avoid;font-family:'Times New Roman',Times,serif;",
  'tr-cover-title': "text-align:center;font-size:14pt;margin:36pt 0 18pt;font-family:'Times New Roman',Times,serif;",
  'tr-cover': "text-align:center;margin:0 0 6pt;font-family:'Times New Roman',Times,serif;",
  'tr-mem-header1': "text-align:center;text-decoration:underline;margin:24pt 0 14pt;page-break-after:avoid;font-family:'Times New Roman',Times,serif;",
  'tr-body1': "text-align:justify;margin:0 0 10pt;font-family:'Times New Roman',Times,serif;",
  'tr-body3': "text-align:justify;margin:10pt 0;font-family:'Times New Roman',Times,serif;",
  'tr-art1': "text-align:center;font-weight:bold;margin:24pt 0 14pt;page-break-after:avoid;font-family:'Times New Roman',Times,serif;",
  'tr-art2': "text-align:justify;margin:0 0 10pt;font-family:'Times New Roman',Times,serif;",
  'tr-art3b': "text-align:justify;text-indent:1in;margin:0 0 8pt;font-family:'Times New Roman',Times,serif;",
  'tr-art4b': "text-align:justify;text-indent:1.5in;margin:0 0 8pt;font-family:'Times New Roman',Times,serif;",
  'tr-sig-line': "margin-left:3.5in;margin-bottom:4pt;font-family:'Times New Roman',Times,serif;",
  'tr-sig-name': "margin-left:3.5in;font-weight:bold;margin-bottom:10pt;font-family:'Times New Roman',Times,serif;",
  'tr-affid': "margin:0 0 6pt;font-size:11pt;font-family:'Times New Roman',Times,serif;",
  'tr-base': "margin:0 0 6pt;min-height:1.5em;font-family:'Times New Roman',Times,serif;",
};

function styleForTemplateClasses(classValue: string): string {
  // Concatenate class style strings, then deduplicate so multi-class elements
  // ('tr-base tr-art1') produce a stable, last-wins style block. Without this,
  // the first pass would emit duplicate declarations and a second pass would
  // collapse them, breaking idempotency.
  const concatenated = classValue
    .split(/\s+/)
    .map((cls) => TEMPLATE_CLASS_INLINE_STYLES[cls])
    .filter((style): style is string => !!style)
    .join('');
  if (!concatenated) return '';
  return serializeStyleMap(parseStyleString(concatenated));
}

/**
 * Parse a CSS style string ("a:1;b:2;") into a property→value map. Preserves
 * the last occurrence of each property — matches CSS cascade semantics where
 * the rightmost declaration wins.
 */
function parseStyleString(style: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!style) return map;
  for (const decl of style.split(';')) {
    const colon = decl.indexOf(':');
    if (colon === -1) continue;
    const key = decl.slice(0, colon).trim().toLowerCase();
    const val = decl.slice(colon + 1).trim();
    if (key) map.set(key, val);
  }
  return map;
}

function serializeStyleMap(map: Map<string, string>): string {
  const parts: string[] = [];
  for (const [k, v] of map) parts.push(`${k}:${v}`);
  return parts.length > 0 ? parts.join(';') + ';' : '';
}

/**
 * Merge a class-derived style block into an existing inline style attribute.
 * Class defaults LOSE to existing inline declarations (per the function's
 * doc-comment: template-specific styling wins). Idempotent: re-running on a
 * tag that already has all class defaults present is a no-op.
 */
function mergeClassStyleIntoExisting(classStyle: string, existing: string): string {
  const classMap = parseStyleString(classStyle);
  const existingMap = parseStyleString(existing);
  const result = new Map<string, string>();
  // Class defaults first; existing inline declarations override.
  for (const [k, v] of classMap) result.set(k, v);
  for (const [k, v] of existingMap) result.set(k, v);
  return serializeStyleMap(result);
}

/**
 * Strip the em / en / hyphen dash suffix from "ARTICLE [ROMAN]" headers.
 * IL templates emit `ARTICLE I —` / `ARTICLE II - ` / `ARTICLE III –` style
 * headers with a trailing dash before the article subtitle. The user prefers
 * the dash removed throughout, so this normalizes them all.
 *
 * Matches: `ARTICLE` + whitespace + roman numeral + optional whitespace +
 * em/en/hyphen dash + optional trailing whitespace. Replaces with just the
 * `ARTICLE [ROMAN]` portion.
 */
export function stripArticleHeaderDashes(html: string): string {
  if (!html) return html;
  return html.replace(
    /\bARTICLE\s+([IVXLCDM]+)\s*[—–-]\s*/gi,
    'ARTICLE $1 ',
  );
}

/**
 * Uppercase every occurrence of every known person-name from the rendering
 * context inside the HTML body, AND ensure every occurrence is wrapped in
 * <strong>...</strong> for visual consistency. Names that are already inside
 * a <strong> tag are left alone (the existing wrap is preserved); bare text
 * occurrences get a fresh wrap so e.g. "I appoint my Brother, KAREN K. ELIAS,"
 * doesn't have one bold name and one plain.
 *
 * Names are extracted from clientFullName, spouseFullName, fiduciary names,
 * child names, firm attorney + witnesses. The longest names are replaced
 * first so substrings (e.g. last-name-only matches inside full names) don't
 * double-replace.
 *
 * Whitespace inside the name is normalized to \s+ in the regex so a name
 * stored as "John  Smith" (double-space) still matches the rendered single
 * space form. Word boundaries on each end prevent partial-word matches like
 * uppercasing "Anne" inside "Annette".
 */
export function uppercaseKnownNames(html: string, names: string[]): string {
  if (!html || names.length === 0) return html;
  // Dedupe + drop empties + sort longest first.
  const unique = Array.from(new Set(names.map((n) => (n ?? '').trim()).filter((n) => n.length >= 2)));
  unique.sort((a, b) => b.length - a.length);
  if (unique.length === 0) return html;

  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const namePatterns = unique.map((name) => {
    // Replace runs of whitespace in the name with \s+ so the regex tolerates
    // varying whitespace in the rendered output. Word boundaries on outsides.
    const flexible = escapeRegex(name).replace(/\s+/g, '\\s+');
    return new RegExp(`(?<![A-Za-z'-])${flexible}(?![A-Za-z'-])`, 'g');
  });

  // Walk the HTML — track whether we're inside a <strong> tag so name matches
  // there get uppercased without a redundant wrap. Bare-text matches outside
  // <strong> get wrapped with <strong>...</strong>.
  let out = '';
  let i = 0;
  let strongDepth = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const close = html.indexOf('>', i);
      if (close === -1) { out += html.slice(i); break; }
      const tag = html.slice(i, close + 1);
      // Track <strong> open/close (case-insensitive). Self-closing <strong/>
      // doesn't really exist in practice but we keep the math simple.
      if (/^<strong(\s|>)/i.test(tag)) strongDepth++;
      else if (/^<\/strong\s*>/i.test(tag)) strongDepth = Math.max(0, strongDepth - 1);
      out += tag;
      i = close + 1;
      continue;
    }
    const next = html.indexOf('<', i);
    const segEnd = next === -1 ? html.length : next;
    let segment = html.slice(i, segEnd);
    for (let k = 0; k < namePatterns.length; k++) {
      const re = namePatterns[k];
      re.lastIndex = 0;
      const upper = unique[k].toUpperCase();
      // Inside <strong>: just uppercase. Outside: uppercase + wrap.
      const replacement = strongDepth > 0 ? upper : `<strong>${upper}</strong>`;
      segment = segment.replace(re, replacement);
    }
    out += segment;
    i = segEnd;
  }
  return out;
}

/**
 * Strip empty inline-emphasis tags. After Handlebars renders a template
 * that wraps a name in <strong>{{name}}</strong> with no name set, we get
 * a literal `<strong></strong>` (or `<strong>  </strong>`). These eat
 * surrounding cleanup logic because the text-walk in cleanEmptyListSlots
 * skips tag tokens. Strip them once up front so the resulting text-only
 * stream looks like one continuous segment to the cleanup pass.
 */
export function stripEmptyInlineTags(html: string): string {
  if (!html) return html;
  let prev: string;
  let out = html;
  do {
    prev = out;
    // Empty <strong>, <em>, <b>, <i>, <u>, <span> with only whitespace inside.
    out = out.replace(/<(strong|em|b|i|u|span)(\s[^>]*)?>\s*<\/\1>/gi, '');
  } while (out !== prev);
  return out;
}

/**
 * Clean up empty list slots that leak through when a template enumerates a
 * fixed number of children/fiduciaries but the data has fewer. Patterns like
 * "Adam Jr., , Karen", "Adam Jr. and .", or "Adam Jr., and ." appear when
 * the template hardcodes {{children.[3].name}} or similar past the actual
 * array length. Compresses these in TEXT segments only — never inside tags.
 */
export function cleanEmptyListSlots(html: string): string {
  if (!html) return html;
  let out = '';
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const close = html.indexOf('>', i);
      if (close === -1) { out += html.slice(i); break; }
      out += html.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    const next = html.indexOf('<', i);
    const segEnd = next === -1 ? html.length : next;
    let segment = html.slice(i, segEnd);

    // BEFORE the generic cleanup runs, detect dangling-appointment patterns
    // produced when an IL template enumerates more fiduciary tiers than the
    // data model carries (e.g. 4 executor levels, only primary+alternate
    // populated) and inject [MISSING: ...] markers so the gap is visible to
    // the lawyer on the wet-sign doc instead of leaving "I appoint , of, to
    // serve as Executor". Runs once per segment, before the comma/space
    // collapses below would mangle the patterns past recognition.
    // Order matters within this block: more specific patterns first.
    // Executor — 2nd-level successor (name + address both empty).
    segment = segment.replace(
      /\bappoint\s*,\s*of\s*,\s*to serve as Executor\b/gi,
      'appoint [MISSING: successor executor name], of [MISSING: successor executor address], to serve as Executor',
    );
    // Executor — 3rd-level successor (name only, no address slot in template).
    segment = segment.replace(
      /\bappoint\s*,\s+to serve as Executor\b/gi,
      'appoint [MISSING: successor executor name], to serve as Executor',
    );
    // Trustee — primary slot blank, children list still meaningful.
    segment = segment.replace(
      /\bappoint\s+to serve as Trustee\b/gi,
      'appoint [MISSING: trustee name] to serve as Trustee',
    );
    // Guardian — primary "I appoint as guardian of the person".
    segment = segment.replace(
      /\bappoint\s+as guardian\b/gi,
      'appoint [MISSING: guardian name] as guardian',
    );
    // Guardian — alternate "I appoint, as guardians".
    segment = segment.replace(
      /\bappoint\s*,\s+as guardians\b/gi,
      'appoint [MISSING: alternate guardian name], as guardians',
    );
    // Guardian — successor "I appoint , , to be the successor guardians".
    segment = segment.replace(
      /\bappoint\s*,\s*,\s+to be the successor guardians\b/gi,
      'appoint [MISSING: successor guardian name], to be the successor guardians',
    );

    // Run the cleanups iteratively until the segment stabilises — multiple
    // empty slots in a row need multiple passes (e.g. ", , , " → ", , " → ", ").
    let prev: string;
    do {
      prev = segment;
      // Remove duplicate commas separated by whitespace (consecutive empties).
      segment = segment.replace(/,(\s*,)+/g, ',');
      // Remove trailing "and ." or "and . " (with optional comma+space before "and").
      segment = segment.replace(/,?\s+and\s*\.\s*/g, '. ');
      // Remove "and , " or "and  ," (orphan "and" before another empty).
      segment = segment.replace(/\s+and\s*,/g, ',');
      // Collapse ", ." (orphan comma right before a period) → ".".
      segment = segment.replace(/,\s*\./g, '.');
      // Strip an "I appoint my ," / "I appoint my [empty]," fragment by
      // dropping the dangling possessive: "appoint my , Karen" → "appoint Karen".
      segment = segment.replace(/\bappoint\s+my\s*,\s*/gi, 'appoint ');
      // Strip dangling "appoint my and my" / "appoint my and " when both
      // sides are empty (template hardcoded "my X and my Y" with both
      // slots vacant). Collapses to a clean "appoint" so the surrounding
      // "to serve as ..." text still reads.
      segment = segment.replace(/\bappoint\s+my(?:\s+and\s+my)+\b\s*/gi, 'appoint ');
      // Same for "appoint my [punct]" before " to " / "to be" / " as ".
      segment = segment.replace(/\bappoint\s+my(?=\s+(?:to|as|hereunder|in)\b)/gi, 'appoint');
      // Strip empty parenthetical inserts produced by missing fields, like
      // "(my "")" or "(my )" — surfaces around bar IDs etc.
      segment = segment.replace(/\(\s*\)/g, '');
      // Repeated commas that may have accumulated.
      segment = segment.replace(/,\s*,/g, ',');
      // Squeeze multiple spaces and " ," / " ." artifacts.
      segment = segment.replace(/[ \t]{2,}/g, ' ');
      segment = segment.replace(/\s+,/g, ',');
      segment = segment.replace(/\s+\./g, '.');
      // Trailing "and " or "and." at the end of a text segment (right
      // before the closing tag of an enclosing <strong> / <p>) — surfaces
      // when the template rendered "X, Y and {{empty}}".
      segment = segment.replace(/[,]?\s+and\s*$/i, '');
    } while (segment !== prev);

    out += segment;
    i = segEnd;
  }
  return out;
}

/**
 * Collect every person-name we should uppercase from the context.
 * Includes the client, spouse, every fiduciary tier across every role,
 * every child, the firm attorney, witnesses, and any computed names.
 */
function collectKnownNames(ctx: ClientContext): string[] {
  const names: string[] = [];
  const push = (n: unknown) => {
    if (typeof n === 'string' && n.trim().length >= 2) names.push(n.trim());
  };
  push(ctx.computed?.clientFullName);
  push(ctx.computed?.spouseFullName);
  const c = ctx.client as Record<string, unknown>;
  // First/last separately so e.g. "Karen" alone is uppercased too.
  const pi = (c.personalInfo ?? {}) as Record<string, unknown>;
  const si = (c.spouseInfo ?? {}) as Record<string, unknown>;
  push(pi.firstName);
  push(pi.lastName);
  push([pi.firstName, pi.middleName, pi.lastName].filter(Boolean).join(' '));
  push(si.firstName);
  push(si.lastName);
  push([si.firstName, si.middleName, si.lastName].filter(Boolean).join(' '));
  // Children
  for (const child of (c.children ?? []) as Array<Record<string, unknown>>) {
    push(child?.name);
  }
  // Fiduciaries — walk every role/tier
  const fid = (c.fiduciaries ?? {}) as Record<string, unknown>;
  for (const role of Object.values(fid)) {
    if (!role || typeof role !== 'object') continue;
    for (const tier of Object.values(role as Record<string, unknown>)) {
      if (!tier || typeof tier !== 'object') continue;
      push((tier as Record<string, unknown>).name);
    }
  }
  // Top-level guardian (different shape)
  push((c.guardianPrimary as Record<string, unknown> | undefined)?.name);
  push((c.guardianAlternate as Record<string, unknown> | undefined)?.name);
  // Firm
  const firm = (ctx.firm ?? {}) as Record<string, unknown>;
  push(firm.attorneyName);
  push(firm.witness1Name);
  push(firm.witness2Name);
  return names;
}

/**
 * Insert "and " before the last item in a run of 3+ comma-separated
 * <strong>...</strong> tags. The cleanup pass strips trailing "and ."
 * fragments from over-allocated template lists, but in doing so removes
 * the legitimate "and " before the actual final item too. Re-inserts it
 * so "ADDISON ELIAS, ALINA J. ELIAS, ADAM J. ELIAS, JR." renders as
 * "ADDISON ELIAS, ALINA J. ELIAS, and ADAM J. ELIAS, JR." (Oxford
 * comma + "and"). Runs after bold-wrapping so it can target the
 * <strong> boundaries rather than the bare names.
 *
 * Conservative match: only fires when there are 3+ <strong> elements
 * separated by ", " (three strongs minimum is the threshold for "and"
 * insertion in standard English). Two-item lists like "X and Y" are
 * left alone — this regex requires the comma separator pattern.
 */
export function insertOxfordAnd(html: string): string {
  if (!html) return html;
  // Pre-normalize: insert ", " between adjacent <strong>...</strong> tags
  // that have no separator. The hybrid AI sometimes returns children/
  // fiduciary lists with names in separate strongs but missing the comma
  // between them (e.g. "<strong>ALINA J. ELIAS</strong><strong>ADAM J.
  // ELIAS, JR.</strong>" instead of "<strong>ALINA J. ELIAS</strong>,
  // <strong>ADAM J. ELIAS, JR.</strong>"). Without this normalization,
  // the Oxford-comma regex below sees fewer items than actually exist
  // and produces malformed output. Adjacent <strong>s are almost always
  // a missing-separator bug in a name list — legitimate consecutive
  // emphasis spans are rare enough that this is safe.
  let out = html.replace(/<\/strong>(\s*)<strong>/g, '</strong>, <strong>');
  // Also un-do any " and " the AI may have already inserted between
  // non-final pair of items in a 3+ list (e.g. "X and Y<strong>Z</strong>"
  // → after the adjacency-fix becomes "X and Y, Z"). Convert " and Y, Z"
  // back to ", Y, Z" so the Oxford-comma pass below can re-insert "and"
  // before the actual last item. Conservative: only touches "<strong>X</strong>
  //  and <strong>Y</strong>, <strong>Z</strong>" patterns.
  out = out.replace(
    /(<strong>[^<]+<\/strong>)\s+and\s+(<strong>[^<]+<\/strong>),\s+(<strong>[^<]+<\/strong>)/g,
    '$1, $2, $3',
  );
  // First: handle 3+ <strong> entries separated by ", " (Oxford comma).
  // "X, Y, Z" → "X, Y, and Z".
  out = out.replace(
    /((?:<strong>[^<]+<\/strong>,\s+){2,})(<strong>[^<]+<\/strong>)/g,
    (_match, lead: string, last: string) => {
      if (/\band\s*$/i.test(lead)) return lead + last;
      const trimmed = lead.replace(/,\s+$/, '');
      return `${trimmed}, and ${last}`;
    },
  );
  // Then: handle exactly 2 <strong> entries separated by ", ".
  // "X, Y" → "X and Y" (no Oxford comma for two items).
  // The negative lookbehind ensures we don't re-match the trailing pair
  // of a list we just rewrote (e.g. "X, Y, and Z" — Y/Z stay intact).
  out = out.replace(
    /(?<!,\s)(<strong>[^<]+<\/strong>),\s+(<strong>[^<]+<\/strong>)(?!\s*,\s*(?:and\s+)?<strong>)/g,
    '$1 and $2',
  );
  return out;
}

/**
 * Replace "my husband" / "my wife" / "my Husband" / "my Wife" with the
 * testator-correct spouse title. Catches IL-template hardcodings like
 * "if my husband survives" or "I appoint my Husband" that the AI
 * templatization missed converting to {{spouseTitle}}. Preserves the
 * original capitalization style of the matched word.
 *
 * Same treatment for "my Brother"/"my Sister" → use the actual fiduciary
 * relationship when known. Less aggressive: only substitute when we have
 * a fiduciary with a known relationship near the rendered text. (For now,
 * just handle husband/wife — sibling relationships are template-side.)
 */
export function normalizeSpouseTitles(html: string, spouseTitle: string): string {
  if (!html || !spouseTitle) return html;
  const lower = spouseTitle.toLowerCase();
  // Only spouse / husband / wife / partner are valid replacement targets.
  if (!['spouse', 'husband', 'wife', 'partner'].includes(lower)) return html;
  const cap = lower.charAt(0).toUpperCase() + lower.slice(1);

  // Walk in tag/text segments so attribute values aren't touched.
  let out = '';
  let i = 0;
  // Track whether the current text segment is inside a <strong>/<em>/<b> —
  // those are subheaders in IL templates ("If my husband Survives.") where
  // we want the spouse-title word AND the leading "my" to be capitalized.
  let inEmphasis = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const close = html.indexOf('>', i);
      if (close === -1) { out += html.slice(i); break; }
      const tag = html.slice(i, close + 1);
      if (/^<(strong|b|em|i)(\s|>)/i.test(tag)) inEmphasis++;
      else if (/^<\/(strong|b|em|i)\s*>/i.test(tag)) inEmphasis = Math.max(0, inEmphasis - 1);
      out += tag;
      i = close + 1;
      continue;
    }
    const next = html.indexOf('<', i);
    const segEnd = next === -1 ? html.length : next;
    let segment = html.slice(i, segEnd);

    // (1) Inside emphasis (subheader): title-case "If my husband/wife/spouse"
    // → "If My Husband/Wife/Spouse" so subheaders read as proper titles.
    // Anchored on "If" because that's the IL template's subheader pattern
    // ("If my husband Survives.", "If my wife Does Not Survive."). Generic
    // "my husband"/"my wife" outside this anchor stays mid-sentence.
    if (inEmphasis > 0) {
      segment = segment.replace(/\bIf\s+my\s+(husband|wife|spouse|partner)\b/gi, () => {
        return `If My ${cap}`;
      });
    }

    // (2) Anywhere: rewrite "my husband/wife/spouse/partner" to the
    // testator-correct title, preserving the first-letter case of the
    // matched word.
    segment = segment.replace(/\b(my)\s+(husband|wife|spouse|partner)\b/gi, (_match, my: string, word: string) => {
      const isCapital = word[0] === word[0].toUpperCase();
      const replacement = isCapital ? cap : lower;
      return `${my} ${replacement}`;
    });
    // (3) Subheading: "Gifts to Wife" / "Gifts to Husband" / "Gifts to
    // Spouse" / "Gifts to Partner" → rewrite to the testator-correct title.
    // Catches IL POA template hardcodings like "Gifts to Wife" where the
    // body says "gifts to or for the benefit of my husband". The heading
    // refers to the gift recipient (spouse), same as the body, so the
    // spouse-title is the right substitution.
    segment = segment.replace(/\bGifts to (Wife|Husband|Spouse|Partner)\b/g, () => `Gifts to ${cap}`);
    out += segment;
    i = segEnd;
  }
  return out;
}

/**
 * Replace stray "Testator" / "Testatrix" with the gender-correct form for
 * the current client. IL Will templates hardcode the term matching the
 * originally-templatized client's gender (e.g. Karen Elias → "Testatrix"
 * baked in), so when the same template renders for a male client the
 * notarial paragraphs read "ADAM J. ELIAS, the Testatrix above named".
 *
 * Source of truth: clientPronouns.subject — "he" → male → Testator,
 * "she" → female → Testatrix. Skips when pronoun source is missing or
 * non-binary (no safe substitution).
 *
 * Operates on text segments only — never touches tag attributes.
 */
export function normalizeTestatorTitle(html: string, pronounSubject: string | undefined): string {
  if (!html || !pronounSubject) return html;
  const subj = pronounSubject.toLowerCase().trim();
  let correct: string;
  let wrong: string;
  if (subj === 'he') { correct = 'Testator'; wrong = 'Testatrix'; }
  else if (subj === 'she') { correct = 'Testatrix'; wrong = 'Testator'; }
  else return html;

  let out = '';
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const close = html.indexOf('>', i);
      if (close === -1) { out += html.slice(i); break; }
      out += html.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    const next = html.indexOf('<', i);
    const segEnd = next === -1 ? html.length : next;
    let segment = html.slice(i, segEnd);
    // Word-boundary replace. The two words are unambiguous (no substrings
    // of other legal terms), so a global replace is safe.
    segment = segment.replace(new RegExp(`\\b${wrong}\\b`, 'g'), correct);
    out += segment;
    i = segEnd;
  }
  return out;
}

/**
 * Ensure every "ARTICLE [ROMAN]" header paragraph uses the tr-art1 class
 * (centered, bold, page-break-after-avoid). Some IL template paragraphs
 * mis-class an article header as tr-art2 (justified) — visible as a
 * left-aligned article heading among centered ones. Detects `<p class=
 * "tr-art2 ...">` whose only meaningful inner text starts with "ARTICLE"
 * and rewrites to tr-art1.
 */
export function normalizeArticleHeaderClasses(html: string): string {
  if (!html) return html;
  return html.replace(
    /<p\s+class=(["'])([^"']*\btr-art2\b[^"']*)\1([^>]*)>(\s*(?:<[^>]+>\s*)*)\s*(?:<strong>\s*)?ARTICLE\s+[IVXLCDM]+/gi,
    (match) => {
      // Replace "tr-art2" with "tr-art1" within the matched string.
      // Also swap the inline style block (tr-art2 = justify, tr-art1 = center).
      let updated = match.replace(/\btr-art2\b/, 'tr-art1');
      // If the inline style still says text-align:justify, flip to center.
      updated = updated.replace(/text-align\s*:\s*justify/, 'text-align:center');
      return updated;
    },
  );
}

/**
 * Apply user-requested document-wide formatting passes:
 *   1. Strip em-dashes from article headers
 *   2. Clean up empty list slots from fixed-arity template enumerations
 *      (e.g. "Adam Jr. and ." when a template hardcodes 4 child slots but
 *      the client has 3)
 *   3. Uppercase every known person name and bold-wrap each occurrence for
 *      visual consistency throughout the document
 *   4. Insert "and " before the last item in 3+ <strong> name lists so
 *      "X, Y, Z" reads as "X, Y, and Z" (Oxford-comma + "and")
 *
 * Runs at the very end of generation, on every return path. List cleanup
 * happens BEFORE name-bolding so we don't bold trailing-empty fragments.
 * Oxford-and runs LAST so the <strong> boundaries are stable.
 */
function applyFinalFormattingPasses(html: string, ctx: ClientContext): string {
  if (!html) return html;
  let out = stripArticleHeaderDashes(html);
  out = normalizeArticleHeaderClasses(out);
  out = normalizeSpouseTitles(out, ctx.computed?.spouseTitle ?? '');
  out = normalizeTestatorTitle(out, ctx.computed?.clientPronouns?.subject);
  out = stripEmptyInlineTags(out);
  out = cleanEmptyListSlots(out);
  out = repairAiArtifacts(out);
  out = uppercaseKnownNames(out, collectKnownNames(ctx));
  out = insertOxfordAnd(out);
  out = typographyCleanup(out);
  return out;
}

/**
 * Repair structural artifacts that surface when the hybrid AI augmentation
 * step (Sonnet) returns text that doesn't match what we expect from the
 * template. Three known patterns:
 *
 *   1. `<br />` between a word and a `<strong>` opening tag — orphaned
 *      template line break that DOCX export collapses to no-space, leaving
 *      "appoint[NAME]" or "Brother,ROGER" run-together text. Convert the
 *      `<br />` to a space when it follows word/punctuation (preserve real
 *      `<br />` in signature blocks where the preceding content is a long
 *      underscore line).
 *   2. Leading `, ` inside a `<strong>` — IL template renders the
 *      relationship+name pair as `<strong>{{rel}}, {{name}}</strong>`;
 *      when relationship is empty the strong inherits a leading comma
 *      ("<strong>, ROGER KONDOS</strong>"). Strip leading commas
 *      from strong contents.
 *   3. Single `<strong>` containing 3+ comma-separated names without an
 *      Oxford "and" — Sonnet sometimes consolidates a children/fiduciary
 *      list into one wrapped span. insertOxfordAnd's regex counts `<strong>`
 *      boundaries so it misses this. Inject "and " before the last name
 *      fragment, accounting for trailing suffix tokens like "JR." / "SR." /
 *      "III" / "ESQ." that contain their own commas.
 */
function repairAiArtifacts(html: string): string {
  if (!html) return html;
  let out = html;

  // (1) `word<br /><strong>` or `word,<br /><strong>` → `word <strong>`.
  // Capture letters / numbers / common punctuation but NOT underscores
  // (signature lines like ___________________ should keep their `<br />`).
  out = out.replace(
    /([A-Za-z][A-Za-z0-9.,;:'\-]*)\s*<br\s*\/?>\s*<strong>/g,
    '$1 <strong>',
  );

  // (2) Strip leading `, ` (one or more commas + whitespace) immediately
  // inside a <strong> opening tag. Repeats with do-while in case multiple
  // commas accumulated.
  let prev: string;
  do {
    prev = out;
    out = out.replace(/<strong>\s*,\s*/g, '<strong>');
  } while (out !== prev);

  // (3) Single <strong> containing 3+ comma-separated name tokens without
  // an Oxford "and": inject ", and " before the last name. Suffix-aware:
  // tokens ending in JR/SR/II/III/IV/ESQ/MD/PHD (with optional period)
  // are treated as part of the preceding name (they contain a comma like
  // "ADAM J. ELIAS, JR.").
  const NAME_SUFFIX = /^(JR|SR|II|III|IV|V|ESQ|MD|M\.D|PHD|PH\.D|JD|J\.D)\.?$/i;
  out = out.replace(/<strong>([^<]+)<\/strong>/g, (whole, content: string) => {
    if (/\band\b/i.test(content)) return whole; // already has "and"
    if (!content.includes(',')) return whole;
    // Split on ", " then re-join suffix fragments back into the prior name.
    const parts = content.split(/,\s+/).map((s) => s.trim()).filter(Boolean);
    const merged: string[] = [];
    for (const part of parts) {
      if (merged.length > 0 && NAME_SUFFIX.test(part)) {
        merged[merged.length - 1] = `${merged[merged.length - 1]}, ${part}`;
      } else {
        merged.push(part);
      }
    }
    if (merged.length < 3) return whole; // 2-name lists handled by insertOxfordAnd
    // Each merged item must look like a Title Case or ALL CAPS name (heuristic
    // to avoid mangling non-name content like statutory text inside <strong>).
    const looksLikeName = (s: string) => /^[A-Z][A-Z .,'-]*[A-Z.]$/i.test(s) && s.length >= 2;
    if (!merged.every(looksLikeName)) return whole;
    const last = merged.pop()!;
    return `<strong>${merged.join(', ')}, and ${last}</strong>`;
  });

  return out;
}

/**
 * General typography fixes that apply after all data injection and name
 * uppercasing. Each pass operates on text segments only — never mutates
 * tag contents — so attributes like class="x,y" or style="font-size:1em"
 * are preserved.
 *
 * Passes:
 *   1. Collapse `JR..` / `SR..` / `M.D..` / `ESQ..` etc. to a single period
 *      when an abbreviation already ending in `.` collides with the
 *      sentence-ending period.
 *   2. Insert a space after `,` when followed by a letter (e.g. IL template
 *      emits `, NJ,as my` — should read `, NJ, as my`). Skips digits so
 *      `1,000` is not mangled.
 *   3. Insert a space after `)` when followed by a capital letter without
 *      one — e.g. `(050422014)Attorney at Law` → `(050422014) Attorney at
 *      Law`. The IL notary block emits the bar number paren and the
 *      attorney title with no separating whitespace.
 *   4. Insert a space between `ARTICLE [ROMAN]` and an immediately-following
 *      capitalized word — e.g. `ARTICLE XIINo Contest` → `ARTICLE XII No
 *      Contest`. The IL Will template misformatted Article XII heading.
 */
export function typographyCleanup(html: string): string {
  if (!html) return html;

  // Cross-tag passes (operate on the full HTML, before segment-walking) —
  // catch patterns where a closing inline tag splits text that should
  // collapse together.
  // (a) Abbreviation period + closing tag + sentence period:
  //     `JR.</strong>.` → `JR.</strong>` (drop the trailing sentence period
  //     when the abbrev already ends in one). The abbreviation pattern
  //     allows mixed case so "Jr.", "Sr.", "Esq.", "Inc." all qualify, not
  //     just all-caps "JR." (which is what uppercaseKnownNames produces for
  //     names but child-name lists from the data may be title-case).
  html = html.replace(/([A-Z][A-Za-z]{0,5}\.)(<\/(?:strong|b|em|i|u)>)\.(\s|<|$)/g, '$1$2$3');
  // (b) ARTICLE [ROMAN] followed by tag(s) then a Title-Case word: insert
  //     a space before the first inline tag so the heading reads
  //     `ARTICLE XII No Contest` instead of `ARTICLE XIINo Contest`.
  //     Allows arbitrary intermediate tags like <br/> + <a id="..."></a>.
  html = html.replace(/(ARTICLE\s+[IVXLCDM]+)((?:<[^>]+>)+)([A-Z][a-z])/g, '$1 $2$3');

  let out = '';
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const close = html.indexOf('>', i);
      if (close === -1) { out += html.slice(i); break; }
      out += html.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    const next = html.indexOf('<', i);
    const segEnd = next === -1 ? html.length : next;
    let segment = html.slice(i, segEnd);

    // 1. Abbreviation period + sentence period collision: `JR..` → `JR.`.
    segment = segment.replace(/([A-Z]+\.)\./g, '$1');
    // 2. Comma without space before a letter: `NJ,as` → `NJ, as`.
    segment = segment.replace(/,(?=[A-Za-z])/g, ', ');
    // 3. Closing paren without space before a capital letter: `)Attorney` → `) Attorney`.
    segment = segment.replace(/\)(?=[A-Z])/g, ') ');
    // 4. ARTICLE [ROMAN] glued to next word: `ARTICLE XIINo` → `ARTICLE XII No`.
    segment = segment.replace(/(ARTICLE\s+[IVXLCDM]+)([A-Z][a-z])/g, '$1 $2');

    out += segment;
    i = segEnd;
  }
  return out;
}

/**
 * Repair tags where AI templatization concatenated an attribute name to the
 * tag name with no whitespace (`<pclass="...">` instead of `<p class="...">`).
 * This pattern silently breaks downstream HTML parsers that require whitespace
 * after the tag name. Idempotent: well-formed HTML passes through unchanged.
 */
export function sanitizeMalformedTags(html: string): string {
  if (!html) return html;
  return html.replace(
    /<([a-z][\w-]*?)(class|style|id|href|src|alt|title|name|type|value|data-[\w-]+|aria-[\w-]+|role|rel|target|width|height|colspan|rowspan|align|valign)=/gi,
    '<$1 $2=',
  );
}

/**
 * Add inline styles for known template classes so formatting survives outside
 * the original upload preview CSS. Idempotent — re-running on already-styled
 * content is a no-op even if the AI introduces additional tr-* classes between
 * passes. Existing inline style declarations always override class defaults.
 *
 * Also sanitizes any `<TAGattribute=` malformed tags introduced by AI
 * templatization so downstream consumers (DOCX export, etc.) parse correctly.
 */
export function applyTemplateFormattingStyles(html: string): string {
  if (!html) return html;
  html = sanitizeMalformedTags(html);
  if (!/\btr-[a-z0-9-]+\b/i.test(html)) return html;

  return html.replace(/<([a-z][\w:-]*)([^>]*\bclass=(["'])([^"']*\btr-[^"']*)\3[^>]*)>/gi,
    (fullTag: string, tagName: string, attrs: string, quote: string, classValue: string) => {
      const classStyle = styleForTemplateClasses(classValue);
      if (!classStyle) return fullTag;

      const styleAttr = attrs.match(/\bstyle=(["'])(.*?)\1/i);
      if (styleAttr) {
        const merged = mergeClassStyleIntoExisting(classStyle, styleAttr[2]);
        // Idempotency: if the merged style equals the existing one (modulo
        // trailing-semicolon normalization), skip rewriting the tag.
        const normalize = (s: string) => s.replace(/\s+/g, '').replace(/;+$/, '');
        if (normalize(merged) === normalize(styleAttr[2])) return fullTag;
        const nextAttrs = attrs.replace(styleAttr[0], `style=${styleAttr[1]}${merged}${styleAttr[1]}`);
        return `<${tagName}${nextAttrs}>`;
      }
      const nextAttrs = `${attrs} style=${quote}${classStyle}${quote}`;
      return `<${tagName}${nextAttrs}>`;
    });
}

// ---------------------------------------------------------------------------
// Template fetching
// ---------------------------------------------------------------------------

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

function hasHandlebarsSyntax(content: string): boolean {
  return /\{\{[#/]?[^}]+\}\}/.test(content);
}

function isRawTemplateContent(template: DocumentTemplate): boolean {
  return normalizeStringArray(template.variables).length === 0
    && !hasHandlebarsSyntax(template.content);
}

function getTemplateContentField(data: FirebaseFirestore.DocumentData): string {
  const candidates = [
    data.content,
    data.editorContent,
    data.htmlContent,
    data.rawContent,
    data.extractedHtml,
  ];
  const content = candidates.find((candidate) =>
    typeof candidate === 'string' && candidate.trim(),
  );
  return typeof content === 'string' ? content : '';
}

function adaptCandidateToTemplate(
  candidate: TemplateCandidate,
  firmId: string,
  docType: string,
): FirebaseFirestore.DocumentData | undefined {
  const content = getTemplateContentField(candidate.data);
  if (!content.trim()) return undefined;

  if (candidate.source === 'documentTemplates') {
    return {
      ...candidate.data,
      id: candidate.data.id ?? candidate.id,
      firmId: candidate.data.firmId ?? firmId,
      content,
      _sourceCollection: candidate.source,
    };
  }

  const tags = normalizeStringArray(candidate.data.tags);
  const docTypes = normalizeStringArray(candidate.data.docTypes);
  const name = candidate.data.name ?? candidate.data.title ?? candidate.id;

  return {
    id: candidate.data.id ?? candidate.id,
    firmId,
    docType: candidate.data.docType ?? docTypes[0] ?? docType,
    name,
    description: candidate.data.description ?? candidate.data.summary ?? '',
    variant: candidate.data.variant ?? 'knowledge-base',
    complexity: candidate.data.complexity ?? 2,
    version: candidate.data.version ?? 1,
    content,
    isDefault: candidate.data.isDefault ?? false,
    isActive: candidate.data.isActive ?? true,
    variables: normalizeStringArray(candidate.data.variables),
    tags,
    softwareSource: candidate.data.softwareSource ?? candidate.data.source ?? '',
    folder: candidate.source === 'knowledgeBase' ? 'Knowledge Base' : candidate.data.folder ?? '',
    createdAt: candidate.data.createdAt ?? admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: candidate.data.updatedAt ?? admin.firestore.FieldValue.serverTimestamp(),
    createdBy: candidate.data.createdBy ?? 'system',
    updatedBy: candidate.data.updatedBy ?? 'system',
    _sourceCollection: candidate.source,
  };
}

function scoreTemplateCandidate(
  candidate: TemplateCandidate,
  opts: { softwareSource?: string; variant?: string; preferDefault?: boolean },
): number {
  const data = candidate.data;
  let score = 0;

  if (candidate.source === 'documentTemplates') score += 30;
  if (candidate.source === 'knowledgeBase') score += 20;
  if (candidate.source === 'legacyTemplates') score += 10;

  if (data.isDefault === true) score += opts.preferDefault ? 100 : 25;
  if (opts.softwareSource && (data.softwareSource === opts.softwareSource || data.source === opts.softwareSource)) score += 80;
  if (opts.variant && data.variant === opts.variant) score += 60;

  const content = getTemplateContentField(data);
  if (hasHandlebarsSyntax(content)) score += 15;
  if (normalizeStringArray(data.variables).length > 0) score += 10;
  if (content.length > 1000) score += 5;

  return score;
}

function pickBestTemplateCandidate(
  candidates: TemplateCandidate[],
  opts: { softwareSource?: string; variant?: string; preferDefault?: boolean } = {},
): TemplateCandidate | undefined {
  return candidates
    .map((candidate) => ({
      candidate,
      score: scoreTemplateCandidate(candidate, opts),
    }))
    .sort((a, b) => b.score - a.score)[0]?.candidate;
}

async function fetchKnowledgeBaseTemplateCandidates(
  firmId: string,
  docType: string,
): Promise<TemplateCandidate[]> {
  const db = admin.firestore();
  const snap = await db
    .collection('firms').doc(firmId).collection('knowledgeBase')
    .where('category', '==', 'form_template')
    .limit(100)
    .get();

  return snap.docs
    .map((doc) => ({ id: doc.id, data: doc.data(), source: 'knowledgeBase' as const }))
    .filter((candidate) => {
      const data = candidate.data;
      const docTypes = normalizeStringArray(data.docTypes);
      return data.isActive !== false && (docTypes.length === 0 || docTypes.includes(docType));
    });
}

async function fetchLegacyTemplateCandidates(
  firmId: string,
  docType: string,
): Promise<TemplateCandidate[]> {
  const db = admin.firestore();
  const snap = await db
    .collection('firms').doc(firmId).collection('templates')
    .limit(100)
    .get();

  return snap.docs
    .map((doc) => ({ id: doc.id, data: doc.data(), source: 'legacyTemplates' as const }))
    .filter((candidate) => {
      const data = candidate.data;
      const docTypes = normalizeStringArray(data.docTypes);
      return data.isActive !== false && (data.docType === docType || docTypes.includes(docType));
    });
}

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
  let rawCandidate: TemplateCandidate | undefined;

  // If specific template ID provided, fetch directly
  if (templateId) {
    const snap = await col.doc(templateId).get();
    if (!snap.exists) return null;
    rawCandidate = { id: snap.id, data: snap.data()!, source: 'documentTemplates' };
    rawData = rawCandidate.data;
  } else {
    // Build a base query for docType + isActive
    const buildBaseQuery = () =>
      col.where('docType', '==', docType).where('isActive', '==', true);

    if (softwareSource) {
      // softwareSource is a HARD REQUIREMENT (Phase 1.4 decision). When the
      // caller specifies a software source, only return a template that
      // actually matches it. No fallback to isDefault, no vector search, no
      // knowledgeBase, no legacy collection — those would silently substitute
      // a different software's template, producing plausible but wrong output.
      // Callers see null and surface a structured error so the firm can
      // upload the missing template before retrying.
      const sourceSnap = await buildBaseQuery()
        .where('softwareSource', '==', softwareSource)
        .limit(25)
        .get();

      if (!sourceSnap.empty) {
        const candidates = sourceSnap.docs.map((doc) => ({
          id: doc.id,
          data: doc.data(),
          source: 'documentTemplates' as const,
        }));
        rawCandidate = pickBestTemplateCandidate(candidates, { softwareSource });
        rawData = rawCandidate?.data;
      } else {
        console.warn(
          `[getTemplate] No template for docType="${docType}" softwareSource="${softwareSource}". ` +
          `softwareSource is a hard requirement — refusing to fall back to other sources. ` +
          `Caller should upload a matching template or omit softwareSource to allow fallbacks.`,
        );
        return null;
      }
    } else if (variant) {
      // Specific variant requested
      const snap = await buildBaseQuery()
        .where('variant', '==', variant)
        .limit(25)
        .get();
      if (!snap.empty) {
        const candidates = snap.docs.map((doc) => ({
          id: doc.id,
          data: doc.data(),
          source: 'documentTemplates' as const,
        }));
        rawCandidate = pickBestTemplateCandidate(candidates, { variant });
        rawData = rawCandidate?.data;
      }
    } else {
      // No software source or variant — use the default template
      const snap = await buildBaseQuery()
        .where('isDefault', '==', true)
        .limit(25)
        .get();
      if (!snap.empty) {
        const candidates = snap.docs.map((doc) => ({
          id: doc.id,
          data: doc.data(),
          source: 'documentTemplates' as const,
        }));
        rawCandidate = pickBestTemplateCandidate(candidates, { preferDefault: true });
        rawData = rawCandidate?.data;
      } else {
        const anySnap = await buildBaseQuery().limit(50).get();
        if (!anySnap.empty) {
          const candidates = anySnap.docs.map((doc) => ({
            id: doc.id,
            data: doc.data(),
            source: 'documentTemplates' as const,
          }));
          rawCandidate = pickBestTemplateCandidate(candidates);
          rawData = rawCandidate?.data;
        }
      }
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
        rawCandidate = { id: vectorSnap.id, data: vectorSnap.data()!, source: 'documentTemplates' };
        rawData = rawCandidate.data;
      }
    }
  }

  // Knowledge Base fallback: older imports and manually added "Document
  // Template" resources live under knowledgeBase/category=form_template rather
  // than documentTemplates. Use them as templates before falling back to AI.
  if (!rawData && !templateId) {
    const kbCandidates = await fetchKnowledgeBaseTemplateCandidates(firmId, docType);
    const best = pickBestTemplateCandidate(kbCandidates, { softwareSource, variant });
    const adapted = best ? adaptCandidateToTemplate(best, firmId, docType) : undefined;
    if (best && adapted) {
      console.info(
        `[getTemplate] Knowledge Base form_template fallback found "${best.data.title ?? best.data.name ?? best.id}" ` +
        `for docType="${docType}"`,
      );
      rawCandidate = { id: best.id, data: adapted, source: 'knowledgeBase' };
      rawData = rawCandidate.data;
    }
  }

  // Legacy fallback for the old firms/{firmId}/templates collection referenced
  // by earlier migration utilities.
  if (!rawData && !templateId) {
    const legacyCandidates = await fetchLegacyTemplateCandidates(firmId, docType);
    const best = pickBestTemplateCandidate(legacyCandidates, { softwareSource, variant });
    const adapted = best ? adaptCandidateToTemplate(best, firmId, docType) : undefined;
    if (best && adapted) {
      console.info(
        `[getTemplate] Legacy templates fallback found "${best.data.name ?? best.id}" ` +
        `for docType="${docType}"`,
      );
      rawCandidate = { id: best.id, data: adapted, source: 'legacyTemplates' };
      rawData = rawCandidate.data;
    }
  }

  // Runtime validation: ensure required fields exist.
  // Support both 'content' (canonical) and 'editorContent' (editor-saved) field names.
  if (rawData && !rawData.content?.trim()) {
    const content = getTemplateContentField(rawData);
    if (content.trim()) {
      rawData = { ...rawData, content };
    }
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

  if (!rawData.id && rawCandidate) {
    rawData = { ...rawData, id: rawCandidate.id };
  }
  // Ensure _sourceCollection is always populated for downstream provenance
  // (Phase 2.1). adaptCandidateToTemplate sets it for KB / legacy paths;
  // direct documentTemplates fetches without adaptation might miss it.
  if (rawCandidate && !rawData._sourceCollection) {
    rawData = { ...rawData, _sourceCollection: rawCandidate.source };
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
 * Critical legal fields that must be non-blank for a valid estate plan document.
 * When the client's Firestore data is missing one of these, Handlebars would
 * silently render it as "" — indistinguishable from intentional whitespace.
 * We inject "[MISSING: label]" into the template context before rendering so
 * the attorney sees a visible placeholder rather than a silent blank.
 */
// Paths reflect the actual data shape written by the questionnaire — verified
// against src/types/questionnaire.ts. Note that the questionnaire stores
// healthcareProxy under `.agent` / `.alternateAgent` (not `.primary`) and the
// guardian under top-level `guardianPrimary` / `guardianAlternate` (not
// `fiduciaries.guardian.*`). The buildTemplateData() helper falls back from
// top-level guardianPrimary into fiduciaries.guardian.primary, so to keep
// markMissingFiduciaries() consistent we don't include guardian here — its
// missing-marker is handled separately at the top-level paths if needed.
const CRITICAL_LEGAL_FIELDS: { path: string[]; label: string; force?: boolean }[] = [
  // Names — primary slots are mandatory; alternates skipped silently if absent.
  { path: ['executor', 'primary', 'name'],            label: 'executor name' },
  { path: ['executor', 'alternate', 'name'],          label: 'alternate executor name' },
  { path: ['trustee', 'primary', 'name'],             label: 'trustee name' },
  { path: ['trustee', 'alternate', 'name'],           label: 'alternate trustee name' },
  { path: ['powerOfAttorney', 'agent', 'name'],       label: 'POA agent name' },
  { path: ['powerOfAttorney', 'alternateAgent', 'name'], label: 'alternate POA agent name' },
  { path: ['healthcareProxy', 'agent', 'name'],       label: 'healthcare proxy name' },
  { path: ['healthcareProxy', 'alternateAgent', 'name'], label: 'alternate healthcare proxy name' },
  // Addresses — primary fiduciary addresses are required for legal validity in
  // most templates (executor/trustee blocks include "[Name], [Address]"). When
  // the questionnaire doesn't capture an address (HOMEWORK #5), this surfaces
  // a [MISSING: ...] marker instead of a silent blank line in the wet-sign doc.
  { path: ['executor', 'primary', 'address'],         label: 'executor address' },
  { path: ['executor', 'alternate', 'address'],       label: 'alternate executor address' },
  { path: ['trustee', 'primary', 'address'],          label: 'trustee address' },
  { path: ['trustee', 'alternate', 'address'],        label: 'alternate trustee address' },
  { path: ['powerOfAttorney', 'agent', 'address'],    label: 'POA agent address' },
  { path: ['powerOfAttorney', 'alternateAgent', 'address'], label: 'alternate POA agent address' },
  { path: ['healthcareProxy', 'agent', 'address'],    label: 'healthcare proxy address' },
  { path: ['healthcareProxy', 'alternateAgent', 'address'], label: 'alternate healthcare proxy address' },
  // Successor tiers — IL templates always render these paragraphs (4-tier
  // executor chain, 3-tier guardian chain) even when the data model only
  // carries primary + alternate. Without `force: true` markers, unfilled
  // successor slots render as bare "I appoint , of, to serve as Executor"
  // — visible to the user as a silent gap. force=true bypasses the
  // !slotHasName skip in markMissingFiduciaries() so these always emit
  // [MISSING: ...] markers prompting the lawyer to fill them.
  { path: ['executor', 'successor', 'name'],          label: 'second successor executor name', force: true },
  { path: ['executor', 'successor', 'address'],       label: 'second successor executor address', force: true },
  { path: ['executor', 'secondSuccessor', 'name'],    label: 'third successor executor name', force: true },
  { path: ['executor', 'secondSuccessor', 'address'], label: 'third successor executor address', force: true },
  { path: ['guardian', 'successor', 'name'],          label: 'successor guardian name', force: true },
  { path: ['guardian', 'successor', 'address'],       label: 'successor guardian address', force: true },
];

/**
 * Deep-clone `fiduciaries` and replace null/undefined/"" in critical paths with
 * a visible "[MISSING: label]" marker.  Only alternate/successor slots are
 * skipped when they are absent — only the PRIMARY executor, trustee, proxy, and
 * guardian are truly mandatory for legal validity.
 *
 * The clone is intentionally shallow-at-depth-1 to avoid mutating ctx.client.
 */
/**
 * If a fiduciary has relationship='Spouse' and no address, copy the client's
 * own address into the fiduciary slot. Couples typically share a residence
 * and lawyers shouldn't have to enter the same address twice. Only fills
 * fields that are blank — never overwrites a fiduciary-specific address.
 */
function autoFillSpouseFiduciaryAddresses(
  fiduciaries: Record<string, unknown>,
  personalInfo: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!personalInfo) return fiduciaries;
  const clientAddress = {
    address: personalInfo.address,
    city: personalInfo.city,
    state: personalInfo.state,
    zip: personalInfo.zip,
    county: personalInfo.county,
  };
  // Only proceed if the client has a meaningful address to copy from.
  const hasClientAddress =
    typeof clientAddress.address === 'string' && clientAddress.address.trim().length > 0;
  if (!hasClientAddress) return fiduciaries;

  // The fiduciary tiers we may want to fill.
  const tiers: Array<[string, string]> = [
    ['executor', 'primary'], ['executor', 'alternate'], ['executor', 'successor'],
    ['trustee', 'primary'], ['trustee', 'alternate'], ['trustee', 'successor'],
    ['powerOfAttorney', 'agent'], ['powerOfAttorney', 'alternateAgent'],
    ['healthcareProxy', 'agent'], ['healthcareProxy', 'alternateAgent'],
  ];

  // Only auto-fill when the user has explicitly indicated the fiduciary is
  // their spouse / partner. Inferring "same household" from a shared
  // surname is reckless — adult children who moved out, estranged siblings,
  // and ex-spouses can all share a surname but not the testator's address.
  const HOUSEHOLD_RELATIONSHIPS = new Set([
    'spouse', 'husband', 'wife', 'partner', 'domestic partner',
  ]);

  let mutated = fiduciaries as Record<string, unknown>;

  for (const [role, level] of tiers) {
    const roleObj = mutated[role] as Record<string, unknown> | undefined;
    if (!roleObj) continue;
    const levelObj = roleObj[level] as Record<string, unknown> | undefined;
    if (!levelObj) continue;

    const relationship = typeof levelObj.relationship === 'string'
      ? (levelObj.relationship as string).toLowerCase().trim()
      : '';
    if (!HOUSEHOLD_RELATIONSHIPS.has(relationship)) continue;

    const hasFiduciaryAddress = typeof levelObj.address === 'string'
      && (levelObj.address as string).trim().length > 0;
    if (hasFiduciaryAddress) continue;

    // Build a new object tree so we don't mutate the caller's data.
    if (mutated === fiduciaries) mutated = { ...fiduciaries };
    const nextRole = { ...(mutated[role] as Record<string, unknown>) };
    nextRole[level] = {
      ...levelObj,
      address: clientAddress.address ?? '',
      city: levelObj.city ?? clientAddress.city ?? '',
      state: levelObj.state ?? clientAddress.state ?? '',
      zip: levelObj.zip ?? clientAddress.zip ?? '',
      county: levelObj.county ?? clientAddress.county ?? '',
    };
    mutated[role] = nextRole;
  }
  return mutated;
}

/**
 * IL templates that reference the spouse — most notably the Healthcare
 * Directive's primary HC rep paragraph — interpolate
 * `{{spouseInfo.address}}, {{spouseInfo.city}}, {{spouseInfo.state}}` directly
 * rather than going through `fiduciaries.healthcareProxy.agent.address`. The
 * questionnaire's spouse step captures name/DOB/SSN/email/phone but does NOT
 * ask for a separate spouse address (the household-shared assumption is baked
 * in everywhere else). Result: married clients render their spouse with no
 * address on the HC directive even though the Will + POA fill correctly via
 * `autoFillSpouseFiduciaryAddresses`. Mirror that household auto-fill here so
 * spouseInfo carries the testator's address into any template that reads it.
 */
function autoFillSpouseInfoAddress(
  spouseInfo: Record<string, unknown> | undefined,
  personalInfo: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!spouseInfo || !personalInfo) return spouseInfo;

  const maritalStatus = typeof personalInfo.maritalStatus === 'string'
    ? (personalInfo.maritalStatus as string).toLowerCase().trim()
    : '';
  if (maritalStatus !== 'married') return spouseInfo;

  const spouseHasAddress = typeof spouseInfo.address === 'string'
    && (spouseInfo.address as string).trim().length > 0;
  if (spouseHasAddress) return spouseInfo;

  const piAddress = typeof personalInfo.address === 'string'
    ? (personalInfo.address as string)
    : '';
  if (piAddress.trim().length === 0) return spouseInfo;

  return {
    ...spouseInfo,
    address: piAddress,
    city: spouseInfo.city ?? personalInfo.city ?? '',
    state: spouseInfo.state ?? personalInfo.state ?? '',
    zip: spouseInfo.zip ?? personalInfo.zip ?? '',
    county: spouseInfo.county ?? personalInfo.county ?? '',
  };
}

function markMissingFiduciaries(
  fiduciaries: Record<string, unknown>,
): Record<string, unknown> {
  // Shallow clone at depth-1 so we don't mutate the shared ctx object
  const result: Record<string, unknown> = { ...fiduciaries };

  for (const { path, label, force } of CRITICAL_LEGAL_FIELDS) {
    const [role, level, field] = path as [string, string, string];

    // The "primary"-equivalent levels across roles: executor/trustee use
    // 'primary'; powerOfAttorney + healthcareProxy use 'agent'. Anything else
    // (alternate, alternateAgent, successor) is optional — skip the missing
    // marker if the slot isn't filled at all. UNLESS the field is flagged
    // force=true, in which case the template references the slot regardless
    // of data presence (IL successor tiers).
    const isPrimary = level === 'primary' || level === 'agent';
    if (!isPrimary && !force && !fiduciaries[role]) continue;

    // Read from `result` (the accumulator) so successive iterations on the
    // same slot accumulate markers instead of clobbering each other. The
    // previous version spread from `fiduciaries[role]` (the original input)
    // every iteration, so when both .name and .address were missing on the
    // same slot, the later marker wiped the earlier one — producing e.g.
    // trustee.primary = { address: '[MISSING: trustee address]' } with the
    // name marker silently lost. Visible bug: empty <strong></strong> in
    // the rendered Will trustee paragraph instead of "[MISSING: trustee name]".
    const roleObj = (result[role] ?? fiduciaries[role] ?? {}) as Record<string, unknown>;
    const levelObj = (roleObj[level] ?? {}) as Record<string, unknown>;
    const value = levelObj[field];

    // For non-primary tiers, only mark fields if the slot is partially
    // populated (a name is set). Without this, an alternate executor with a
    // name but no address renders as "Roger Kondos, of , to serve" — the
    // questionnaire-side blank silently bleeds into the document. With this,
    // the same case renders as "Roger Kondos, of [MISSING: alt exec address],
    // to serve" so the lawyer sees the gap.
    const slotHasName = typeof levelObj.name === 'string' && (levelObj.name as string).trim().length > 0;

    if (value === null || value === undefined || value === '') {
      // Primary slots are always required. Non-primary slots are only required
      // when a name has been set (i.e. the lawyer started filling in this tier).
      // force=true bypasses the slotHasName guard so successor tiers always
      // get markers regardless of whether any data is present.
      if (!isPrimary && !force && !slotHasName) continue;

      result[role] = {
        ...roleObj,
        [level]: {
          ...levelObj,
          [field]: `[MISSING: ${label}]`,
        },
      };
      console.warn(`[template-engine] Marking missing critical field: fiduciaries.${role}.${level}.${field}`);
    }
  }

  return result;
}

/**
 * Build the flat template data object from a ClientContext.
 * Extracted so it can be reused by both renderTemplate and validateTemplateData.
 *
 * @param opts.markMissing — when true (default), fills missing primary
 *   fiduciary slots with [MISSING: …] placeholders. The validator turns this
 *   off so it can report the raw missing variables rather than the filled-in
 *   placeholders.
 */
export function buildTemplateData(
  ctx: ClientContext,
  opts: { markMissing?: boolean } = {},
): Record<string, unknown> {
  const markMissing = opts.markMissing !== false;
  const fiduciariesRaw = autoFillSpouseFiduciaryAddresses(
    (ctx.client.fiduciaries ?? {}) as Record<string, unknown>,
    ctx.client.personalInfo as Record<string, unknown> | undefined,
  );
  const spouseInfoFilled = autoFillSpouseInfoAddress(
    ctx.client.spouseInfo as Record<string, unknown> | undefined,
    ctx.client.personalInfo as Record<string, unknown> | undefined,
  );

  // Filter empty / partial children entries before render. The questionnaire
  // can persist trailing blank entries (e.g. user added a 4th child slot but
  // never filled in the name). Without this filter the template renders
  // "Addison Elias, Alina Elias, Adam Elias, Jr. and ." with a trailing empty
  // slot that bleeds into every children-list interpolation.
  const childrenRaw = (ctx.client.children ?? []) as Array<Record<string, unknown>>;
  const children = childrenRaw.filter((c) => {
    if (!c || typeof c !== 'object') return false;
    const name = c.name;
    return typeof name === 'string' && name.trim().length > 0;
  });

  return {
    // Client data (full)
    client: ctx.client,
    personalInfo: ctx.client.personalInfo ?? {},
    spouseInfo: spouseInfoFilled,
    children,
    assets: ctx.client.assets ?? {},
    liabilities: ctx.client.liabilities ?? {},
    fiduciaries: markMissing
      ? markMissingFiduciaries(fiduciariesRaw)
      : fiduciariesRaw,
    distribution: ctx.client.distribution ?? {},
    healthcarePreferences: ctx.client.healthcarePreferences ?? {},
    trusts: ctx.client.trusts ?? [],
    specialConsiderations: ctx.client.specialConsiderations ?? {},
    packageDetails: ctx.client.packageDetails ?? {},

    // Questionnaire-only fields (not always on the client doc directly)
    hasChildren: ctx.client.hasChildren ?? (children.length > 0),
    hasOtherDependents: ctx.client.hasOtherDependents ?? false,
    otherDependents: ctx.client.otherDependents ?? [],
    guardianPrimary: ctx.client.guardianPrimary ?? ctx.client.fiduciaries?.guardian?.primary ?? {},
    guardianAlternate: ctx.client.guardianAlternate ?? ctx.client.fiduciaries?.guardian?.alternate ?? {},
    distributionPlan: ctx.client.distributionPlan ?? '',
    burialPreference: ctx.client.burialPreference ?? '',
    burialDetails: ctx.client.burialDetails ?? '',
    // Prefer explicit personalInfo.gender (canonical); fall back to legacy top-level isFemale.
    // Case+whitespace-tolerant match.
    isFemale: (() => {
      const g = ctx.client.personalInfo?.gender;
      const n = typeof g === 'string' ? g.trim().toLowerCase() : undefined;
      return n === 'female' || (n == null && ctx.client.isFemale === true);
    })(),

    // Computed
    ...ctx.computed,

    // Firm data — with aliased keys so both {{firmName}} and {{firm.name}} resolve
    firm: {
      ...ctx.firm,
      // Aliases: retemplatize prompt uses firm.name, firm.address, etc.
      // while the Firestore doc stores firmName, firmAddress, etc.
      name: ctx.firm.firmName ?? ctx.firm.name ?? '',
      address: ctx.firm.firmAddress ?? ctx.firm.address ?? '',
      city: ctx.firm.firmCity ?? ctx.firm.city ?? '',
      state: ctx.firm.firmState ?? ctx.firm.state ?? '',
      zip: ctx.firm.firmZip ?? ctx.firm.zip ?? '',
      phone: ctx.firm.firmPhone ?? ctx.firm.phone ?? '',
      email: ctx.firm.firmEmail ?? ctx.firm.email ?? '',
      website: ctx.firm.firmWebsite ?? ctx.firm.website ?? '',
      // Attorney & witness data
      attorneyName: ctx.firm.attorneyName ?? '',
      attorneyId: ctx.firm.barNumber ?? ctx.firm.attorneyId ?? '',
      witness1Name: ctx.firm.witness1Name ?? '',
      witness1Address: ctx.firm.witness1Address ?? '',
      witness2Name: ctx.firm.witness2Name ?? '',
      witness2Address: ctx.firm.witness2Address ?? '',
    },
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
  additionalData?: Record<string, unknown>,
): string {
  ensureHelpers();

  const compiled = Handlebars.compile(templateContent);
  const baseData = buildTemplateData(ctx);
  const finalData = additionalData ? { ...baseData, ...additionalData } : baseData;

  return compiled(finalData);
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
  additionalData?: Record<string, unknown>,
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

  // Provenance — emitted on every return so the save layer can persist
  // (Phase 2.1). resolvedMode reflects the actual mode used; resolvedTemplateId
  // names the matched template; resolvedTemplateSource indicates which
  // collection it came from.
  const provenance = {
    resolvedMode: mode,
    resolvedTemplateId: template.id,
    resolvedTemplateSource: template._sourceCollection ?? 'documentTemplates',
    resolvedSoftwareSource: softwareSource ?? template.softwareSource ?? null,
  } as const;

  // ── Smart routing ──────────────────────────────────────────────────────────
  // Variable-free templates are complete documents, often imported from DOCX or
  // PDF files. Skip Handlebars and do focused text substitution so the output
  // keeps the existing template structure instead of serving sample data.
  const isRawUploadedTemplate = isRawTemplateContent(template);

  if (isRawUploadedTemplate) {
    const title = buildStandardTitle(docType, ctx.computed.clientFullName);

    console.info(
      `[template-engine] Smart route: raw uploaded template for ${docType} ` +
      `(source=${template.softwareSource || template.folder || 'knowledge-base'}) → focused substitution (${mode})`,
    );
    const content = applyFinalFormattingPasses(
      applyTemplateFormattingStyles(
        await substituteTemplateValues(
          applyTemplateFormattingStyles(template.content),
          ctx,
          docType,
          formattingPreset,
        ),
      ),
      ctx,
    );

    // For hybrid mode, we might optionally want to do an enhancement pass later, but right now
    // substituteTemplateValues focuses purely on client data injection.
    return { docType, title, content, status: 'draft', promptVersion, templateBaseline: template.content, ...provenance };
  }

  // ── Handlebars rendering (for templates WITH variables) ─────────────────
  // Render template — guard against invalid Handlebars syntax in uploaded templates
  let renderedHtml: string;
  try {
    renderedHtml = renderTemplate(template.content, ctx, additionalData);
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
      const substituted = applyFinalFormattingPasses(
        applyTemplateFormattingStyles(await substituteTemplateValues(
          applyTemplateFormattingStyles(template.content),
          ctx,
          docType,
          formattingPreset,
        )),
        ctx,
      );
      return {
        docType,
        title: buildStandardTitle(docType, ctx.computed.clientFullName),
        content: substituted,
        status: 'draft',
        promptVersion,
        templateBaseline: template.content,
        ...provenance,
      };
    }
    // In template mode, fall back to focused text substitution (same as hybrid)
    // rather than serving raw unrendered HTML with {{variables}} visible
    console.info(`[template-engine] Using focused substitution for ${docType} (HBS failed, template mode)`);
    const substituted = applyFinalFormattingPasses(
      applyTemplateFormattingStyles(await substituteTemplateValues(
        applyTemplateFormattingStyles(template.content),
        ctx,
        docType,
        formattingPreset,
      )),
      ctx,
    );
    return {
      docType,
      title: buildStandardTitle(docType, ctx.computed.clientFullName),
      content: substituted,
      status: 'draft',
      promptVersion,
      templateBaseline: template.content,
      ...provenance,
    };
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

  // Always preserve the raw (pre-render) template as templateBaseline so the
  // editor's compare-mode can show "raw template with {{vars}}" vs "rendered
  // for this client" on every saved doc. Previously only the AI-enhanced
  // hybrid path saved a baseline, so docs that rendered cleanly (zero
  // unresolved vars) had no compare option in the editor.
  if (mode === 'template') {
    return {
      docType,
      title,
      content: applyFinalFormattingPasses(applyTemplateFormattingStyles(renderedHtml), ctx),
      status: 'draft',
      promptVersion,
      templateBaseline: template.content,
      ...provenance,
    };
  }

  // Hybrid: template + AI enhancement
  if (mode === 'hybrid') {
    // Skip AI enhancement ONLY when (a) template rendered cleanly AND (b)
    // there's no KB context to enrich with. Previously we skipped on (a)
    // alone, which silently bypassed the entire RAG pipeline whenever the
    // template substituted every variable — making hybrid mode equivalent
    // to template mode for any well-formed template. With KB resources
    // present, the AI step adds meaningful value (citations, smoothed
    // prose, KB-aware language) even on cleanly-rendered templates.
    if (unresolvedVars.length === 0 && (ctx.knowledgeResources?.length ?? 0) === 0) {
      console.info(
        `[template-engine] Skipping AI enhancement for ${docType} — ` +
        `clean template + zero KB resources (saving ~6,000 tokens)`,
      );
      return {
        docType,
        title,
        content: applyFinalFormattingPasses(applyTemplateFormattingStyles(renderedHtml), ctx),
        status: 'draft',
        promptVersion,
        templateBaseline: template.content,
        ...provenance,
      };
    }
    // Pre-AI cleanup: strip empty inline tag wrappers and inject [MISSING:]
    // markers BEFORE the AI sees the rendered template. Without this, the
    // AI would receive `<strong></strong>, of, ` patterns that defeat the
    // segment-walker regexes in applyFinalFormattingPasses (the AI tends
    // to preserve all wrappers, leaving empty strongs that split text
    // segments and prevent the post-AI cleanup from matching).
    const preCleaned = cleanEmptyListSlots(stripEmptyInlineTags(renderedHtml));
    const enhanced = await enhanceWithAI(applyTemplateFormattingStyles(preCleaned), ctx, docType, formattingPreset);
    return {
      docType,
      title,
      content: applyFinalFormattingPasses(applyTemplateFormattingStyles(enhanced), ctx),
      status: 'draft',
      promptVersion,
      templateBaseline: renderedHtml,
      ...provenance,
    };
  }

  return {
    docType,
    title,
    content: applyFinalFormattingPasses(applyTemplateFormattingStyles(renderedHtml), ctx),
    status: 'draft',
    promptVersion,
    templateBaseline: template.content,
    ...provenance,
  };
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

  // Resolve gender with explicit fail-loud on unknown. Prefer the canonical
  // personalInfo.gender; fall back to the legacy top-level isFemale. If both
  // are unset, throw so the caller fixes the data rather than generating a
  // document with silently-wrong pronouns.
  // Normalize case + whitespace — "Female", " female ", "FEMALE" all match.
  const rawGender = ctx.client.personalInfo?.gender;
  const gender =
    typeof rawGender === 'string' ? rawGender.trim().toLowerCase() : undefined;
  let isFemale: boolean;
  if (gender === 'female') isFemale = true;
  else if (gender === 'male') isFemale = false;
  else if (ctx.client.isFemale === true) isFemale = true;
  else if (ctx.client.isFemale === false) isFemale = false;
  else {
    throw new Error(
      `Gender is required to generate this document but is not set on the client record. ` +
      `Set personalInfo.gender ('male' or 'female') on the client's questionnaire, then retry.`,
    );
  }

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
      model: 'gpt-4o', // Explicitly use gpt-4o which supports up to 16,384 output tokens instead of proxy fallback
      temperature: 0.05, // Very low temp for faithful substitution
      maxTokens: 16384,
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
  formattingPreset?: string,
): Promise<string> {
  const safeFirm = sanitizeObject(ctx.firm);

  // Resolve the formatting preset for the chosen template source. When the
  // AI augmentation step adds new prose (transitional language, smoothed
  // clauses, KB-citation insertions), it needs to know the CSS class
  // vocabulary the document uses — otherwise the new <p> tags ship without
  // tr-* classes and render as unstyled text in DOCX/PDF export. Falls back
  // gracefully to no preset block when unset / unrecognized.
  const preset = formattingPreset ? getFormattingPreset(formattingPreset) : undefined;
  const formattingBlock = preset?.promptBlock
    ? `\n\n${preset.promptBlock}\n\nWhen you ADD any new <p> elements during enhancement (e.g. transitional language, KB-citation insertions, smoothed clauses), tag them with the appropriate tr-* class from the list above. When you MODIFY existing prose, preserve the existing class on the surrounding <p> exactly.`
    : '';

  // Build knowledge base context. Sized for clause/draft generation use case
  // where the AI needs to see whole sample documents and complete model
  // clauses, not snippets. Per-resource cap large enough to fit a full
  // sample will (~12-15K chars); aggregate cap leaves room for 5+ full
  // exemplars per generation. Claude Sonnet 4 takes 200K input tokens — at
  // 100K char cap we use ~12% of that on KB context. Truncation is logged
  // so we can spot when firms grow individual resources past 20K.
  // Cost note: ~$0.02 → ~$0.10 per generation in Anthropic input tokens.
  const PER_RESOURCE_CAP = 20000;
  const TOTAL_KB_CAP = 100000;
  let kbBudget = TOTAL_KB_CAP;
  let perResourceTruncations = 0;
  let totalTruncated = false;
  const kbParts: string[] = [];
  for (const r of ctx.knowledgeResources) {
    if (kbBudget <= 0) {
      totalTruncated = true;
      break;
    }
    const header = `[${r.category}] ${r.title}${r.citation ? ` (${r.citation})` : ''}:\n`;
    const remaining = kbBudget - header.length;
    if (remaining <= 0) {
      totalTruncated = true;
      break;
    }
    const cap = Math.min(PER_RESOURCE_CAP, remaining);
    let body = r.content ?? '';
    if (body.length > cap) {
      body = body.slice(0, cap) + '… [truncated]';
      perResourceTruncations++;
    }
    const part = header + body;
    kbParts.push(part);
    kbBudget -= part.length;
  }
  if (totalTruncated || perResourceTruncations > 0) {
    console.info(
      `[template-engine] hybrid KB context truncated for ${docType}: ` +
      `included ${kbParts.length}/${ctx.knowledgeResources.length} resources, ` +
      `per-resource truncations=${perResourceTruncations}, ` +
      `total cap hit=${totalTruncated}`,
    );
  }
  const kbContext = kbParts.join('\n\n');

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
- PRESERVE every [MISSING: ...] marker EXACTLY as it appears. These are intentional placeholders flagging gaps in client data that the attorney must fill manually. Do not remove, reword, or replace them with guessed values.

PERMITTED ENHANCEMENTS:
- Add relevant N.J.S.A. citations from the knowledge base to strengthen existing clauses.
- Incorporate relevant client notes or special considerations into existing provision language.
- Smooth legal prose for clarity and professionalism within existing sections.
- Fill remaining template blanks with proper client data (names, dates, addresses).
- Add transitional language between existing sections for readability.

OUTPUT FORMAT:
- Return ONLY the enhanced HTML content (no JSON wrapper, no markdown fences, no preamble).
- Preserve ALL HTML tags, CSS classes, inline styles, and document structure exactly.
- The output must be a COMPLETE document — do not truncate or omit closing tags.${formattingBlock}

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
    // maxTokens sized to the actual workload: a Will is ~5K input tokens;
    // hybrid enhancement should output 5-8K tokens (preserves structure,
    // adds citations, smooths prose). 16K cap gives generous headroom
    // while keeping completion under ~3 min.
    //
    // Model: Haiku 4.5 is hardcoded for hybrid augmentation. The firm's
    // documentDraftingModel preference (often Opus) is appropriate for
    // AI-only mode (fresh-draft) but is too slow for hybrid augmentation:
    // with 25K input + 16K max output, Opus runs ~400-500s and routinely
    // times out the 540s function window. Sonnet 4.6 ran the same workload
    // in ~120-180s but Haiku 4.5 does it in ~50-70s with comparable quality
    // for this "preserve structure + add KB citations + smooth prose" job
    // (it's a surgical augmentation, not fresh drafting). Opus / Sonnet
    // quality matters for full-draft generation, not for this path.
    let enhanced = await callAI(systemPrompt, userPrompt, safeFirm, {
      model: 'claude-haiku-4-5-20251001',
      temperature: 0.15,
      maxTokens: 16384,
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
