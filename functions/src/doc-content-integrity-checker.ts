/**
 * functions/src/doc-content-integrity-checker.ts
 *
 * Post-generation CONTENT integrity checks. Complements
 * document-structure-validator.ts (which asks "does the legal instrument
 * have all required structural blocks?"). This module asks "does the
 * rendered content look clean — no template residue, no empty slots,
 * no missing client data?"
 *
 * Runs on EVERY generation mode (template, hybrid, ai, flex) because
 * these symptoms can leak through any path. The structural validator
 * intentionally skips template mode; this one does not.
 *
 * Findings are merged into the same `validationFindings` array on the
 * saved document — same Firestore schema, same UI badge.
 */

import type { ClientContext } from './client-context-aggregator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContentIntegrityFinding {
  name: string;
  severity: 'error' | 'warning';
  detail?: string;
}

export interface ContentIntegrityResult {
  findings: ContentIntegrityFinding[];
  passed: boolean;
}

// ---------------------------------------------------------------------------
// Universal checks (apply to all docs, all modes)
// ---------------------------------------------------------------------------

const UNRESOLVED_HBS = /\{\{[^}]+\}\}/g;
const DOUBLE_PERIOD = /\b[A-Za-z]+\.\./;
// Strict empty-slot pattern: three commas with only whitespace between them.
// Examples that should match: ", , ," / ",, ," / ", ,,"
// Examples that should NOT match: prose like "I, John Doe, of," (real commas with content)
const EMPTY_SLOT_COMMAS = /,\s*,\s*,/;
const EMPTY_APPOINTEE = /\bappoint\s+my\s*,\s*,/i;
const EMPTY_OXFORD_TAIL = /,\s+and\s*\./i;
const EMPTY_INLINE_STRONG = /<strong>\s*<\/strong>/i;
const EMPTY_INLINE_EM = /<em>\s*<\/em>/i;
const PAREN_NO_SPACE = /\)[A-Z][a-z]/;

function universalChecks(html: string): ContentIntegrityFinding[] {
  const findings: ContentIntegrityFinding[] = [];
  // Replace tags with spaces (not nothing) so block-element boundaries don't
  // concatenate adjacent text. Without this, `</p><p>` collapsing made
  // `(050422014)Attorney` (legitimate two-paragraph render) trip the
  // PAREN_NO_SPACE rule.
  const stripped = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  const hbs = html.match(UNRESOLVED_HBS);
  if (hbs && hbs.length > 0) {
    findings.push({
      name: 'Unresolved Handlebars variables',
      severity: 'error',
      detail: `${hbs.length} occurrence(s): ${hbs.slice(0, 3).join(', ')}`,
    });
  }

  if (EMPTY_SLOT_COMMAS.test(stripped)) {
    findings.push({
      name: 'Empty fiduciary/list slot pattern',
      severity: 'error',
      detail: 'Found ", , ," — usually a missing name or address that was not marked [MISSING].',
    });
  }

  if (EMPTY_APPOINTEE.test(stripped)) {
    findings.push({
      name: 'Empty appointment clause',
      severity: 'error',
      detail: '"appoint my , ..." with no name.',
    });
  }

  if (EMPTY_OXFORD_TAIL.test(stripped)) {
    findings.push({
      name: 'Trailing Oxford-list fragment',
      severity: 'warning',
      detail: '", and ." — last list item is empty.',
    });
  }

  if (DOUBLE_PERIOD.test(stripped)) {
    const m = stripped.match(DOUBLE_PERIOD);
    findings.push({
      name: 'Double-period typo',
      severity: 'warning',
      detail: m ? `Near "${m[0]}"` : undefined,
    });
  }

  if (EMPTY_INLINE_STRONG.test(html) || EMPTY_INLINE_EM.test(html)) {
    findings.push({
      name: 'Empty emphasis tag',
      severity: 'warning',
      detail: 'Empty <strong></strong> or <em></em> shells.',
    });
  }

  if (PAREN_NO_SPACE.test(stripped)) {
    findings.push({
      name: 'Missing space after parenthesis',
      severity: 'warning',
      detail: 'Pattern ")Word" — likely a typography pass missed this.',
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Client-data presence checks (run only when ClientContext is available)
// ---------------------------------------------------------------------------

const NAME_CHECK_EXEMPT_DOC_TYPES = new Set([
  // Summary/letter docs may legitimately reference the client only by role.
  'estatePlanSummary',
]);

function clientDataChecks(
  html: string,
  ctx: ClientContext,
  docType: string,
): ContentIntegrityFinding[] {
  const findings: ContentIntegrityFinding[] = [];

  if (NAME_CHECK_EXEMPT_DOC_TYPES.has(docType)) return findings;

  const personalInfo = (ctx as unknown as { personalInfo?: Record<string, unknown> }).personalInfo;
  const fullName = typeof personalInfo?.fullName === 'string' ? personalInfo.fullName.trim() : '';

  if (fullName) {
    const upperFullName = fullName.toUpperCase();
    const upperHtml = html.toUpperCase();
    if (!upperHtml.includes(upperFullName)) {
      findings.push({
        name: 'Client name missing',
        severity: 'error',
        detail: `Expected "${fullName}" to appear in the document but it does not.`,
      });
    }
  }

  const maritalStatus = typeof personalInfo?.maritalStatus === 'string' ? personalInfo.maritalStatus.toLowerCase() : '';
  if (maritalStatus === 'married') {
    const spouseInfo = (ctx as unknown as { spouseInfo?: Record<string, unknown> }).spouseInfo;
    const spouseName = typeof spouseInfo?.fullName === 'string' ? spouseInfo.fullName.trim() : '';
    if (spouseName && !html.toUpperCase().includes(spouseName.toUpperCase())) {
      findings.push({
        name: 'Spouse name missing',
        severity: 'warning',
        detail: `Married client — spouse "${spouseName}" not found in document.`,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function checkContentIntegrity(
  html: string,
  docType: string,
  ctx?: ClientContext | null,
): ContentIntegrityResult {
  const findings: ContentIntegrityFinding[] = [];
  findings.push(...universalChecks(html));
  if (ctx) {
    findings.push(...clientDataChecks(html, ctx, docType));
  }
  const passed = !findings.some((f) => f.severity === 'error');
  return { findings, passed };
}
