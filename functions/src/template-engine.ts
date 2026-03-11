/**
 * functions/src/template-engine.ts
 *
 * Handlebars-based template rendering engine for estate planning documents.
 *
 * Responsibilities:
 *  - Compile and render Handlebars templates with client context
 *  - Register custom helpers for legal document formatting
 *  - Fetch the appropriate template from Firestore (by docType + variant)
 *  - Optional AI enhancement pass for hybrid mode
 */

import Handlebars from 'handlebars';
import * as admin from 'firebase-admin';
import { ClientContext } from './client-context-aggregator';
import { callAI, sanitizeObject, parseAIJson } from './ai-client';
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
  createdAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  updatedAt: admin.firestore.Timestamp | admin.firestore.FieldValue;
  createdBy: string;
  updatedBy: string;
}

export type GenerationMode = 'template' | 'ai' | 'hybrid';

// ---------------------------------------------------------------------------
// Register custom Handlebars helpers
// ---------------------------------------------------------------------------

function registerHelpers(): void {
  // Format a date string or Timestamp to "Month Day, Year"
  Handlebars.registerHelper('formatDate', (dateVal: any) => {
    if (!dateVal) return '_______________';
    let d: Date;
    if (dateVal.toDate) {
      d = dateVal.toDate(); // Firestore Timestamp
    } else if (typeof dateVal === 'string') {
      d = new Date(dateVal);
    } else {
      d = new Date(dateVal);
    }
    if (isNaN(d.getTime())) return dateVal;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  });

  // Full name from a person object { firstName, middleName, lastName, suffix }
  Handlebars.registerHelper('fullName', (person: any) => {
    if (!person) return '_______________';
    return [person.firstName, person.middleName, person.lastName, person.suffix]
      .filter(Boolean)
      .join(' ');
  });

  // Currency formatting
  Handlebars.registerHelper('currency', (amount: any) => {
    if (amount == null || isNaN(Number(amount))) return '$0.00';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(amount));
  });

  // Uppercase
  Handlebars.registerHelper('upper', (str: any) => {
    return typeof str === 'string' ? str.toUpperCase() : '';
  });

  // Equality check
  Handlebars.registerHelper('eq', (a: any, b: any) => a === b);

  // Greater than
  Handlebars.registerHelper('gt', (a: any, b: any) => Number(a) > Number(b));

  // Increment
  Handlebars.registerHelper('inc', (val: any) => Number(val) + 1);

  // Roman numeral helper for article numbering
  Handlebars.registerHelper('roman', (num: any) => {
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
  Handlebars.registerHelper('ordinal', (num: any) => {
    const n = Number(num);
    if (isNaN(n)) return String(num);
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  });

  // Fill-in-blank helper (underscore line if value is empty)
  Handlebars.registerHelper('fillOrBlank', (val: any) => {
    if (!val || (typeof val === 'string' && val.trim() === '')) {
      return new Handlebars.SafeString('_______________');
    }
    return val;
  });

  // Conditional: has items in array
  Handlebars.registerHelper('hasItems', function (this: any, arr: any, options: any) {
    if (Array.isArray(arr) && arr.length > 0) {
      return options.fn(this);
    }
    return options.inverse(this);
  });

  // Join array with separator
  Handlebars.registerHelper('join', (arr: any[], sep: string) => {
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

  // If specific template ID provided, fetch directly
  if (templateId) {
    const snap = await col.doc(templateId).get();
    if (snap.exists) return snap.data() as DocumentTemplate;
    return null;
  }

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
  return snap.docs[0].data() as DocumentTemplate;
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
 * Render a Handlebars template with full client context.
 */
export function renderTemplate(
  templateContent: string,
  ctx: ClientContext,
): string {
  ensureHelpers();

  const compiled = Handlebars.compile(templateContent);

  // Build a flat-ish context for Handlebars
  const templateData = {
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

  // Build knowledge base context
  const kbContext = ctx.knowledgeResources
    .map((r) => `[${r.category}] ${r.title}${r.citation ? ` (${r.citation})` : ''}: ${r.content.slice(0, 500)}`)
    .join('\n\n');

  // Notes context
  const notesContext = ctx.notes
    .slice(0, 5)
    .map((n) => `[${n.noteType}] ${n.title ?? 'Note'}: ${(n.aiSummary ?? n.content ?? '').slice(0, 300)}`)
    .join('\n');

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
- Return ONLY the enhanced HTML content (no JSON wrapper, no markdown fences).
- Preserve all HTML tags and structure.`;

  const userPrompt = `Enhance this ${docType} document:

TEMPLATE-RENDERED DOCUMENT:
${templateHtml.slice(0, 12000)}

CLIENT NOTES:
${notesContext || 'No recent notes.'}

KNOWLEDGE BASE:
${kbContext || 'No specific resources available.'}

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
