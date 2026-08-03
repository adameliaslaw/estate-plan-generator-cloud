/**
 * functions/src/bundled-templates.ts
 *
 * Last-resort template source: Handlebars templates that ship with the deploy.
 *
 * Templates in `functions/src/templates/*.hbs` were copied to `lib/templates`
 * by copy-templates.js on every build but had no runtime reader — getTemplate()
 * only ever consulted Firestore. This module is that reader.
 *
 * Resolution order in getTemplate() is unchanged ahead of this: an explicit
 * templateId, a softwareSource match, a variant, the firm default, vector
 * search, the knowledge base, then the legacy collection. Bundled templates are
 * consulted only when all of those miss, so a firm's own uploads always win.
 *
 * AMBIGUITY IS NOT RESOLVED BY GUESSING. A docType with more than one bundled
 * file (trust, poa) is addressable only by variant. Asked for a bare docType,
 * the lookup logs and returns null rather than picking one — serving a
 * single-settlor trust to a married couple is worse than falling through to AI.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type * as admin from 'firebase-admin';

/**
 * `docType` or `docType:variant` → filename under templates/.
 *
 * Keys with a variant suffix are addressable ONLY by that variant. A docType
 * appearing here without a suffix is served for a bare lookup.
 */
const BUNDLED_TEMPLATES: Readonly<Record<string, string>> = {
  'trust:joint': 'trust-joint.hbs',
  'trust:single': 'trust-single.hbs',
  'poa:simple': 'poa-simple.hbs',
  'poa:comprehensive': 'poa-comprehensive.hbs',
};

/** Resolved file contents, keyed by registry key. Read once per cold start. */
const cache = new Map<string, string | null>();

function templateDir(): string {
  // __dirname is functions/lib at runtime (compiled) and functions/src under
  // vitest (which imports the TypeScript directly). templates/ exists in both.
  return join(__dirname, 'templates');
}

function readTemplate(key: string): string | null {
  if (cache.has(key)) return cache.get(key)!;

  const file = BUNDLED_TEMPLATES[key];
  let content: string | null = null;

  if (file) {
    try {
      const text = readFileSync(join(templateDir(), file), 'utf8');
      content = text.trim() ? text : null;
      if (!content) {
        console.warn(`[bundledTemplates] "${file}" is present but empty — ignoring.`);
      }
    } catch {
      // Expected while a template is authored on a branch but not yet merged.
      // Not an error: the caller falls through to AI generation as before.
      console.info(`[bundledTemplates] No bundled file for key="${key}" (${file} not on disk).`);
    }
  }

  cache.set(key, content);
  return content;
}

/**
 * True when `docType` has bundled templates that require a variant to address.
 * Used to explain a miss in the logs rather than failing silently.
 */
function requiresVariant(docType: string): boolean {
  return Object.keys(BUNDLED_TEMPLATES).some((k) => k.startsWith(`${docType}:`));
}

/**
 * Derive the variant for docTypes whose bundled templates split on client
 * facts rather than on an attorney election.
 *
 * Only `trust` splits this way: the joint spine carries first-death and
 * second-death machinery that a single-settlor instrument has nowhere to put.
 * Returns undefined for everything else — poa's simple/comprehensive split is
 * an attorney choice and must be passed explicitly.
 */
export function deriveBundledVariant(
  docType: string,
  client: admin.firestore.DocumentData | undefined,
): string | undefined {
  if (docType !== 'trust' || !client) return undefined;
  const married = client.personalInfo?.maritalStatus === 'Married';
  return married && client.spouseInfo ? 'joint' : 'single';
}

/**
 * Load a bundled template as a DocumentTemplate-shaped record, or null.
 *
 * The returned shape mirrors what getTemplate()'s later validation expects:
 * `content` and `docType` are required downstream.
 */
export function loadBundledTemplate(
  docType: string,
  variant?: string,
): admin.firestore.DocumentData | null {
  const key = variant ? `${docType}:${variant}` : docType;
  const content = readTemplate(key);

  if (!content) {
    if (!variant && requiresVariant(docType)) {
      console.info(
        `[bundledTemplates] docType="${docType}" has bundled templates but they are ` +
        `variant-addressed. Refusing to guess which one applies — pass a variant.`,
      );
    }
    return null;
  }

  return {
    id: `bundled:${key}`,
    docType,
    ...(variant ? { variant } : {}),
    name: `Bundled ${docType}${variant ? ` (${variant})` : ''}`,
    content,
    isActive: true,
    isDefault: false,
    _sourceCollection: 'bundled',
  };
}

/** Test seam — clears the cold-start cache. */
export function __resetBundledTemplateCache(): void {
  cache.clear();
}
